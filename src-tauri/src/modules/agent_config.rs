//! Agent configuration management for Claude Code and Codex.
//!
//! This module provides commands to manage external Claude Code and Codex
//! configurations, including provider selection, API key management, and
//! model configuration.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ── Constants ────────────────────────────────────────────────────────────────

const XUYA_CODEX_PROVIDER_ID: &str = "xuya_custom";
const CUSTOM_PROVIDER_SELECTOR_PREFIX: &str = "custom:";
const CLAUDE_TOKEN_PLACEHOLDER: &str = "${ANTHROPIC_AUTH_TOKEN}";
const CODEX_TOKEN_PLACEHOLDER: &str = "${CODEX_API_KEY}";
const CODEX_DEFAULT_MODEL: &str = "gpt-5.5";
const MODEL_FETCH_TIMEOUT_SECS: u64 = 15;
const AGENT_QUOTA_TIMEOUT_SECS: u64 = 12;

const CLAUDE_MANAGED_ENV_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
];

const CODEX_MANAGED_TOP_LEVEL_KEYS: &[&str] = &[
    "base_url",
    "disable_response_storage",
    "env_key",
    "experimental_bearer_token",
    "model_provider",
    "model",
    "model_reasoning_effort",
    "requires_openai_auth",
    "wire_api",
];

const CLAUDE_KNOWN_PROVIDERS: &[(&str, &str)] = &[
    ("zhipu", "https://open.bigmodel.cn/api/anthropic"),
    ("minimax", "https://api.minimaxi.com/anthropic"),
    ("kimi", "https://api.kimi.com/coding"),
    ("deepseek", "https://api.deepseek.com/anthropic"),
    (
        "xiaomimimo",
        "https://token-plan-cn.xiaomimimo.com/anthropic",
    ),
];

// ── Request/Response Types ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderConfigRequest {
    pub tool: String,
    pub provider_id: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub haiku_model: Option<String>,
    pub haiku_model_name: Option<String>,
    pub sonnet_model: Option<String>,
    pub sonnet_model_name: Option<String>,
    pub opus_model: Option<String>,
    pub opus_model_name: Option<String>,
    pub extra_config: Option<String>,
    pub auth_config: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCustomProviderSaveRequest {
    pub tool: String,
    pub provider_id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub haiku_model: Option<String>,
    pub haiku_model_name: Option<String>,
    pub sonnet_model: Option<String>,
    pub sonnet_model_name: Option<String>,
    pub opus_model: Option<String>,
    pub opus_model_name: Option<String>,
    pub extra_config: Option<String>,
    pub quota_provider_type: Option<String>,
    pub quota_base_url: Option<String>,
    pub quota_api_key: Option<String>,
    pub quota_access_token: Option<String>,
    pub quota_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBuiltInProviderSaveRequest {
    pub tool: String,
    pub provider_id: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub haiku_model: Option<String>,
    pub haiku_model_name: Option<String>,
    pub sonnet_model: Option<String>,
    pub sonnet_model_name: Option<String>,
    pub opus_model: Option<String>,
    pub opus_model_name: Option<String>,
    pub extra_config: Option<String>,
    pub auth_config: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelFetchRequest {
    pub tool: String,
    pub provider_id: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderQuotaRequest {
    pub tool: String,
    pub provider_id: String,
}

// ── Internal Types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCustomProvider {
    id: String,
    name: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    haiku_model: Option<String>,
    #[serde(default)]
    haiku_model_name: Option<String>,
    #[serde(default)]
    sonnet_model: Option<String>,
    #[serde(default)]
    sonnet_model_name: Option<String>,
    #[serde(default)]
    opus_model: Option<String>,
    #[serde(default)]
    opus_model_name: Option<String>,
    #[serde(default)]
    extra_config: Option<String>,
    #[serde(default)]
    quota_provider_type: Option<String>,
    #[serde(default)]
    quota_base_url: Option<String>,
    #[serde(default)]
    quota_api_key: Option<String>,
    #[serde(default)]
    quota_access_token: Option<String>,
    #[serde(default)]
    quota_user_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCustomProviderStore {
    #[serde(default)]
    providers: Vec<AgentCustomProvider>,
}

#[derive(Debug, Clone)]
struct AgentBuiltInProvider {
    id: String,
    base_url: String,
    api_key: String,
    model: Option<String>,
    haiku_model: Option<String>,
    haiku_model_name: Option<String>,
    sonnet_model: Option<String>,
    sonnet_model_name: Option<String>,
    opus_model: Option<String>,
    opus_model_name: Option<String>,
    extra_config: Option<String>,
    auth_config: Option<String>,
}

// ── Public Response Types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCustomProviderSummary {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub endpoint: String,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub haiku_model: Option<String>,
    pub haiku_model_name: Option<String>,
    pub sonnet_model: Option<String>,
    pub sonnet_model_name: Option<String>,
    pub opus_model: Option<String>,
    pub opus_model_name: Option<String>,
    pub extra_config: Option<String>,
    pub quota_provider_type: Option<String>,
    pub quota_base_url: Option<String>,
    pub quota_api_key: Option<String>,
    pub quota_access_token: Option<String>,
    pub quota_user_id: Option<String>,
    pub token_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBuiltInProviderSummary {
    pub id: String,
    pub base_url: String,
    pub endpoint: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub haiku_model: Option<String>,
    pub haiku_model_name: Option<String>,
    pub sonnet_model: Option<String>,
    pub sonnet_model_name: Option<String>,
    pub opus_model: Option<String>,
    pub opus_model_name: Option<String>,
    pub extra_config: Option<String>,
    pub auth_config: Option<String>,
    pub token_configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolConfigState {
    pub path: String,
    pub exists: bool,
    pub active_provider: Option<String>,
    pub base_url: Option<String>,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub haiku_model: Option<String>,
    pub haiku_model_name: Option<String>,
    pub sonnet_model: Option<String>,
    pub sonnet_model_name: Option<String>,
    pub opus_model: Option<String>,
    pub opus_model_name: Option<String>,
    pub extra_config: Option<String>,
    pub auth_path: Option<String>,
    pub auth_exists: bool,
    pub auth_config: Option<String>,
    pub api_key: Option<String>,
    pub token_configured: bool,
    pub built_in_providers: Vec<AgentBuiltInProviderSummary>,
    pub custom_providers: Vec<AgentCustomProviderSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigState {
    pub claude: AgentToolConfigState,
    pub codex: AgentToolConfigState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigApplyResult {
    pub tool: String,
    pub provider_id: String,
    pub path: String,
    pub base_url: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFetchedModel {
    pub id: String,
    pub owned_by: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelFetchResult {
    pub endpoint: String,
    pub models: Vec<AgentFetchedModel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderQuotaResult {
    pub tool: String,
    pub provider_id: String,
    pub provider_name: String,
    pub quota_provider_type: Option<String>,
    pub configured: bool,
    pub success: bool,
    pub plan_name: Option<String>,
    pub total: Option<f64>,
    pub used: Option<f64>,
    pub remaining: Option<f64>,
    pub unit: Option<String>,
    pub tiers: Vec<AgentProviderQuotaTier>,
    pub queried_at: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderQuotaTier {
    pub name: String,
    pub utilization: Option<f64>,
    pub total: Option<f64>,
    pub used: Option<f64>,
    pub remaining: Option<f64>,
    pub unit: Option<String>,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionUsage {
    pub agent: String,
    pub session_id: Option<String>,
    pub source: String,
    pub context_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_creation_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub context_window: Option<u64>,
    pub updated_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Option<Vec<ModelEntry>>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: String,
    owned_by: Option<String>,
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_agent_config_state() -> Result<AgentConfigState, String> {
    tokio::task::spawn_blocking(read_agent_config_state)
        .await
        .map_err(|e| format!("Agent config state lookup failed: {e}"))?
}

#[tauri::command]
pub async fn apply_agent_provider_config(
    request: AgentProviderConfigRequest,
) -> Result<AgentConfigApplyResult, String> {
    tokio::task::spawn_blocking(move || apply_agent_provider_config_inner(request))
        .await
        .map_err(|e| format!("Agent config update failed: {e}"))?
}

#[tauri::command]
pub async fn save_agent_custom_provider(
    request: AgentCustomProviderSaveRequest,
) -> Result<AgentCustomProviderSummary, String> {
    tokio::task::spawn_blocking(move || save_agent_custom_provider_inner(request))
        .await
        .map_err(|e| format!("Custom provider save failed: {e}"))?
}

#[tauri::command]
pub async fn save_agent_builtin_provider(
    request: AgentBuiltInProviderSaveRequest,
) -> Result<AgentBuiltInProviderSummary, String> {
    tokio::task::spawn_blocking(move || save_agent_builtin_provider_inner(request))
        .await
        .map_err(|e| format!("Built-in provider save failed: {e}"))?
}

#[tauri::command]
pub async fn delete_agent_custom_provider(tool: String, provider_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || delete_agent_custom_provider_inner(&tool, &provider_id))
        .await
        .map_err(|e| format!("Custom provider delete failed: {e}"))?
}

#[tauri::command]
pub async fn fetch_agent_provider_models(
    request: AgentModelFetchRequest,
) -> Result<AgentModelFetchResult, String> {
    fetch_agent_provider_models_inner(request).await
}

#[tauri::command]
pub async fn fetch_agent_provider_quota(
    request: AgentProviderQuotaRequest,
) -> Result<AgentProviderQuotaResult, String> {
    fetch_agent_provider_quota_inner(request).await
}

// ── Core Implementation ──────────────────────────────────────────────────────

fn read_agent_config_state() -> Result<AgentConfigState, String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    let claude_path = claude_settings_path(&home);
    let codex_path = codex_config_path(&home);
    let codex_auth_file_path = codex_auth_path(&home);
    let claude_store = read_custom_provider_store(&home, "claude")?;
    let codex_store = read_custom_provider_store(&home, "codex")?;
    let claude_built_in = read_builtin_provider_store(&home, "claude")?;
    let codex_built_in = read_builtin_provider_store(&home, "codex")?;

    Ok(AgentConfigState {
        claude: read_claude_config_state(&claude_path, &claude_store.providers, &claude_built_in),
        codex: read_codex_config_state(
            &codex_path,
            &codex_auth_file_path,
            &codex_store.providers,
            &codex_built_in,
        ),
    })
}

fn apply_agent_provider_config_inner(
    request: AgentProviderConfigRequest,
) -> Result<AgentConfigApplyResult, String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    match request.tool.as_str() {
        "claude" => apply_claude_provider_config(&home, request),
        "codex" => apply_codex_provider_config(&home, request),
        other => Err(format!("Unsupported agent config target: {other}")),
    }
}

fn save_agent_custom_provider_inner(
    request: AgentCustomProviderSaveRequest,
) -> Result<AgentCustomProviderSummary, String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    let tool = parse_agent_tool(&request.tool)?;
    let mut store = read_custom_provider_store(&home, tool)?;
    let name = clean_optional_text(Some(request.name.as_str()))
        .ok_or_else(|| "Custom provider name is required".to_string())?;
    let base_url = normalize_agent_base_url(tool, &request.base_url)?;
    let requested_id = request
        .provider_id
        .as_deref()
        .and_then(custom_provider_id_from_selector)
        .or_else(|| clean_optional_text(request.provider_id.as_deref()));
    let existing_index = requested_id.as_deref().and_then(|id| {
        store
            .providers
            .iter()
            .position(|provider| provider.id == id)
    });
    let existing_api_key = existing_index
        .and_then(|index| clean_optional_text(Some(store.providers[index].api_key.as_str())));
    let current_config_api_key = current_agent_api_key(&home, tool, requested_id.as_deref());
    let api_key = clean_optional_text(request.api_key.as_deref())
        .or(existing_api_key)
        .or(current_config_api_key)
        .ok_or_else(|| "API Key is required for custom providers".to_string())?;
    let model = normalize_agent_model(tool, request.model.as_deref());
    let haiku_model = normalize_claude_role_model(tool, request.haiku_model.as_deref());
    let haiku_model_name = normalize_claude_role_model(tool, request.haiku_model_name.as_deref());
    let sonnet_model = normalize_claude_role_model(tool, request.sonnet_model.as_deref());
    let sonnet_model_name = normalize_claude_role_model(tool, request.sonnet_model_name.as_deref());
    let opus_model = normalize_claude_role_model(tool, request.opus_model.as_deref());
    let opus_model_name = normalize_claude_role_model(tool, request.opus_model_name.as_deref());
    let extra_config = normalize_full_config(tool, request.extra_config.as_deref())?;
    let quota_provider_type = normalize_quota_provider_type(request.quota_provider_type.as_deref());
    let id = requested_id.unwrap_or_else(|| unique_custom_provider_id(&store.providers, &name));

    let provider = AgentCustomProvider {
        id: id.clone(),
        name,
        base_url,
        api_key,
        model,
        haiku_model,
        haiku_model_name,
        sonnet_model,
        sonnet_model_name,
        opus_model,
        opus_model_name,
        extra_config,
        quota_provider_type,
        quota_base_url: clean_optional_text(request.quota_base_url.as_deref()),
        quota_api_key: clean_optional_text(request.quota_api_key.as_deref()),
        quota_access_token: clean_optional_text(request.quota_access_token.as_deref()),
        quota_user_id: clean_optional_text(request.quota_user_id.as_deref()),
    };

    if let Some(index) = store
        .providers
        .iter()
        .position(|stored| stored.id == provider.id)
    {
        store.providers[index] = provider.clone();
    } else {
        store.providers.push(provider.clone());
    }

    write_custom_provider_store(&home, tool, &store)?;
    summarize_custom_provider(tool, &provider)
}

fn save_agent_builtin_provider_inner(
    request: AgentBuiltInProviderSaveRequest,
) -> Result<AgentBuiltInProviderSummary, String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    let tool = parse_agent_tool(&request.tool)?;
    let provider_id = clean_optional_text(Some(request.provider_id.as_str()))
        .ok_or_else(|| "Provider is required".to_string())?;
    if provider_id == "custom" || custom_provider_id_from_selector(&provider_id).is_some() {
        return Err("Built-in provider id is required".to_string());
    }

    let existing = read_builtin_provider(&home, tool, &provider_id)?;
    let base_url = if provider_id == "official" {
        clean_optional_text(request.base_url.as_deref()).unwrap_or_default()
    } else {
        let raw_base_url = clean_optional_text(request.base_url.as_deref())
            .or_else(|| {
                existing
                    .as_ref()
                    .and_then(|provider| clean_optional_text(Some(provider.base_url.as_str())))
            })
            .or_else(|| {
                if tool == "claude" {
                    claude_known_provider_base_url(&provider_id).map(str::to_string)
                } else {
                    None
                }
            })
            .ok_or_else(|| "Base URL is required".to_string())?;
        normalize_agent_base_url(tool, &raw_base_url)?
    };

    let existing_api_key = existing
        .as_ref()
        .and_then(|provider| clean_agent_api_key(tool, Some(provider.api_key.as_str())));
    let api_key = clean_agent_api_key(tool, request.api_key.as_deref())
        .or(existing_api_key)
        .unwrap_or_default();
    if provider_id != "official" && api_key.is_empty() {
        return Err("API Key is required".to_string());
    }
    let model = normalize_builtin_agent_model(tool, &provider_id, request.model.as_deref());

    let provider = AgentBuiltInProvider {
        id: provider_id,
        base_url,
        api_key,
        model,
        haiku_model: normalize_claude_role_model(tool, request.haiku_model.as_deref()),
        haiku_model_name: normalize_claude_role_model(tool, request.haiku_model_name.as_deref()),
        sonnet_model: normalize_claude_role_model(tool, request.sonnet_model.as_deref()),
        sonnet_model_name: normalize_claude_role_model(tool, request.sonnet_model_name.as_deref()),
        opus_model: normalize_claude_role_model(tool, request.opus_model.as_deref()),
        opus_model_name: normalize_claude_role_model(tool, request.opus_model_name.as_deref()),
        extra_config: normalize_full_config(tool, request.extra_config.as_deref())?,
        auth_config: normalize_agent_auth_config(tool, request.auth_config.as_deref())?,
    };

    write_builtin_provider(&home, tool, &provider)?;
    summarize_builtin_provider(tool, &provider)
}

fn delete_agent_custom_provider_inner(tool: &str, provider_id: &str) -> Result<(), String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    let tool = parse_agent_tool(tool)?;
    let mut store = read_custom_provider_store(&home, tool)?;
    let target_id = custom_provider_id_from_selector(provider_id)
        .or_else(|| clean_optional_text(Some(provider_id)))
        .ok_or_else(|| "Custom provider id is required".to_string())?;

    store.providers.retain(|provider| provider.id != target_id);
    write_custom_provider_store(&home, tool, &store)
}

async fn fetch_agent_provider_models_inner(
    request: AgentModelFetchRequest,
) -> Result<AgentModelFetchResult, String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    let tool = parse_agent_tool(&request.tool)?;
    let provider_id = request.provider_id.trim();
    if provider_id.is_empty() {
        return Err("Provider is required".to_string());
    }

    let store = read_custom_provider_store(&home, tool)?;
    let custom_id = custom_provider_id_from_selector(provider_id);
    let stored_custom = custom_id
        .as_deref()
        .and_then(|id| find_custom_provider(&store.providers, id));
    let stored_built_in = if custom_id.is_none() {
        read_builtin_provider(&home, tool, provider_id)?
    } else {
        None
    };
    let raw_base_url = clean_optional_text(request.base_url.as_deref())
        .or_else(|| stored_custom.map(|provider| provider.base_url.clone()))
        .or_else(|| {
            stored_built_in
                .as_ref()
                .map(|provider| provider.base_url.clone())
        })
        .or_else(|| {
            if tool == "claude" {
                claude_known_provider_base_url(provider_id).map(str::to_string)
            } else {
                None
            }
        })
        .ok_or_else(|| "Base URL is required to fetch models".to_string())?;
    let base_url = normalize_agent_base_url(tool, &raw_base_url)?;
    let api_key = clean_optional_text(request.api_key.as_deref())
        .or_else(|| {
            stored_custom.and_then(|provider| clean_optional_text(Some(provider.api_key.as_str())))
        })
        .or_else(|| {
            stored_built_in
                .as_ref()
                .and_then(|provider| clean_agent_api_key(tool, Some(provider.api_key.as_str())))
        })
        .or_else(|| current_agent_api_key(&home, tool, custom_id.as_deref()))
        .ok_or_else(|| "API Key is required to fetch models".to_string())?;

    let (endpoint, models) = fetch_openai_compatible_models(&base_url, &api_key).await?;
    Ok(AgentModelFetchResult { endpoint, models })
}

fn apply_claude_provider_config(
    home: &Path,
    request: AgentProviderConfigRequest,
) -> Result<AgentConfigApplyResult, String> {
    let path = claude_settings_path(home);
    let provider_id = request.provider_id.trim().to_string();
    if provider_id.is_empty() {
        return Err("Provider is required".to_string());
    }
    let custom_store = read_custom_provider_store(home, "claude")?;
    let custom_id = custom_provider_id_from_selector(&provider_id);
    let stored_custom = custom_id
        .as_deref()
        .and_then(|id| find_custom_provider(&custom_store.providers, id))
        .cloned();
    let stored_built_in = if custom_id.is_none() {
        read_builtin_provider(home, "claude", &provider_id)?
    } else {
        None
    };
    let result_provider_id = custom_id
        .as_deref()
        .map(|id| format!("{CUSTOM_PROVIDER_SELECTOR_PREFIX}{id}"))
        .unwrap_or_else(|| provider_id.clone());
    let current_settings = read_json_or_empty_object(&path)?;
    let mut settings = clean_optional_text(request.extra_config.as_deref())
        .or_else(|| {
            stored_custom
                .as_ref()
                .and_then(|provider| provider.extra_config.clone())
        })
        .or_else(|| {
            stored_built_in
                .as_ref()
                .and_then(|provider| provider.extra_config.clone())
        })
        .map(|config| parse_claude_full_config(&config))
        .transpose()?
        .unwrap_or_else(|| current_settings.clone());
    let editor_api_key = extract_claude_api_key(&settings);
    let (base_url, endpoint) = {
        let root = ensure_json_object(&mut settings);
        let env_value = root
            .entry("env".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !env_value.is_object() {
            *env_value = Value::Object(Map::new());
        }
        let env = env_value
            .as_object_mut()
            .ok_or_else(|| "Failed to access Claude env settings".to_string())?;
        let existing_api_key = extract_claude_api_key(&current_settings).or(editor_api_key);

        for key in CLAUDE_MANAGED_ENV_KEYS {
            env.remove(*key);
        }

        let (base_url, endpoint) = if provider_id == "official" {
            (None, None)
        } else {
            let raw_base_url = clean_optional_text(request.base_url.as_deref())
                .or_else(|| {
                    stored_custom
                        .as_ref()
                        .map(|provider| provider.base_url.clone())
                })
                .or_else(|| {
                    stored_built_in
                        .as_ref()
                        .map(|provider| provider.base_url.clone())
                })
                .or_else(|| claude_known_provider_base_url(&provider_id).map(str::to_string))
                .ok_or_else(|| "Claude base URL is required".to_string())?;
            let base_url = normalize_claude_base_url(&raw_base_url)?;
            let api_key = clean_optional_text(request.api_key.as_deref())
                .or_else(|| {
                    stored_custom
                        .as_ref()
                        .and_then(|provider| clean_optional_text(Some(provider.api_key.as_str())))
                })
                .or_else(|| {
                    stored_built_in.as_ref().and_then(|provider| {
                        clean_agent_api_key("claude", Some(provider.api_key.as_str()))
                    })
                })
                .or(existing_api_key)
                .ok_or_else(|| "Claude API Key is required".to_string())?;
            env.insert(
                "ANTHROPIC_BASE_URL".to_string(),
                Value::String(base_url.clone()),
            );
            env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), Value::String(api_key));

            let endpoint = claude_messages_endpoint(&base_url);
            (Some(base_url), Some(endpoint))
        };

        let model = clean_optional_text(request.model.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.model.clone())
            })
            .or_else(|| {
                stored_built_in.as_ref().and_then(|provider| {
                    normalize_builtin_agent_model("claude", &provider_id, provider.model.as_deref())
                })
            });
        let haiku_model = clean_optional_text(request.haiku_model.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.haiku_model.clone())
            })
            .or_else(|| {
                stored_built_in
                    .as_ref()
                    .and_then(|provider| provider.haiku_model.clone())
            })
            .or_else(|| model.clone());
        let haiku_model_name = clean_optional_text(request.haiku_model_name.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.haiku_model_name.clone())
            })
            .or_else(|| {
                stored_built_in
                    .as_ref()
                    .and_then(|provider| provider.haiku_model_name.clone())
            });
        let sonnet_model = clean_optional_text(request.sonnet_model.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.sonnet_model.clone())
            })
            .or_else(|| {
                stored_built_in
                    .as_ref()
                    .and_then(|provider| provider.sonnet_model.clone())
            })
            .or_else(|| model.clone());
        let sonnet_model_name = clean_optional_text(request.sonnet_model_name.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.sonnet_model_name.clone())
            })
            .or_else(|| {
                stored_built_in
                    .as_ref()
                    .and_then(|provider| provider.sonnet_model_name.clone())
            });
        let opus_model = clean_optional_text(request.opus_model.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.opus_model.clone())
            })
            .or_else(|| {
                stored_built_in
                    .as_ref()
                    .and_then(|provider| provider.opus_model.clone())
            })
            .or_else(|| model.clone());
        let opus_model_name = clean_optional_text(request.opus_model_name.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.opus_model_name.clone())
            })
            .or_else(|| {
                stored_built_in
                    .as_ref()
                    .and_then(|provider| provider.opus_model_name.clone())
            });

        if let Some(model) = model {
            env.insert("ANTHROPIC_MODEL".to_string(), Value::String(model));
        }
        if let Some(model) = haiku_model {
            env.insert(
                "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
                Value::String(model),
            );
        }
        if let Some(model_name) = haiku_model_name {
            env.insert(
                "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME".to_string(),
                Value::String(model_name),
            );
        }
        if let Some(model) = sonnet_model {
            env.insert(
                "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
                Value::String(model),
            );
        }
        if let Some(model_name) = sonnet_model_name {
            env.insert(
                "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME".to_string(),
                Value::String(model_name),
            );
        }
        if let Some(model) = opus_model {
            env.insert(
                "ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(),
                Value::String(model),
            );
        }
        if let Some(model_name) = opus_model_name {
            env.insert(
                "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME".to_string(),
                Value::String(model_name),
            );
        }

        (base_url, endpoint)
    };

    write_json_pretty_atomic(&path, &settings)?;

    Ok(AgentConfigApplyResult {
        tool: "claude".to_string(),
        provider_id: result_provider_id,
        path: path_to_string(&path),
        base_url,
        endpoint,
    })
}

fn apply_codex_provider_config(
    home: &Path,
    request: AgentProviderConfigRequest,
) -> Result<AgentConfigApplyResult, String> {
    let path = codex_config_path(home);
    let auth_path = codex_auth_path(home);
    let provider_id = request.provider_id.trim().to_string();
    if provider_id.is_empty() {
        return Err("Provider is required".to_string());
    }

    let custom_store = read_custom_provider_store(home, "codex")?;
    let custom_id = custom_provider_id_from_selector(&provider_id);
    let stored_custom = custom_id
        .as_deref()
        .and_then(|id| find_custom_provider(&custom_store.providers, id))
        .cloned();
    let stored_built_in = if custom_id.is_none() {
        read_builtin_provider(home, "codex", &provider_id)?
    } else {
        None
    };
    let result_provider_id = custom_id
        .as_deref()
        .map(|id| format!("{CUSTOM_PROVIDER_SELECTOR_PREFIX}{id}"))
        .unwrap_or_else(|| provider_id.clone());
    let full_config = normalize_full_config("codex", request.extra_config.as_deref())?
        .or_else(|| {
            stored_custom.as_ref().and_then(|provider| {
                normalize_full_config("codex", provider.extra_config.as_deref())
                    .ok()
                    .flatten()
            })
        })
        .or_else(|| {
            stored_built_in.as_ref().and_then(|provider| {
                normalize_full_config("codex", provider.extra_config.as_deref())
                    .ok()
                    .flatten()
            })
        });
    let provided_auth_config = clean_optional_text(request.auth_config.as_deref())
        .or_else(|| {
            stored_built_in
                .as_ref()
                .and_then(|provider| provider.auth_config.clone())
        })
        .map(|config| parse_codex_auth_config(&config))
        .transpose()?;
    let provided_auth_api_key = provided_auth_config
        .as_ref()
        .and_then(extract_codex_auth_api_key);
    let current = fs::read_to_string(&path).unwrap_or_default();
    let current_auth = read_json_or_empty_object(&auth_path)?;
    let current_auth_api_key = extract_codex_auth_api_key(&current_auth);
    let current_provider = extract_top_level_toml_string(&current, "model_provider");
    let existing_api_key = clean_codex_token(current_provider.as_deref().and_then(|provider| {
        extract_codex_provider_string(&current, provider, "experimental_bearer_token")
    }))
    .or_else(|| {
        clean_codex_token(extract_codex_provider_string(
            &current,
            XUYA_CODEX_PROVIDER_ID,
            "experimental_bearer_token",
        ))
    })
    .or_else(|| {
        stored_custom
            .as_ref()
            .and_then(|provider| clean_codex_token(Some(provider.api_key.clone())))
    })
    .or_else(|| {
        stored_built_in
            .as_ref()
            .and_then(|provider| clean_codex_token(Some(provider.api_key.clone())))
    })
    .or(provided_auth_api_key)
    .or_else(|| current_auth_api_key.clone())
    .or_else(|| {
        clean_codex_token(extract_top_level_toml_string(
            &current,
            "experimental_bearer_token",
        ))
    });
    let model = clean_optional_text(request.model.as_deref())
        .or_else(|| {
            stored_custom
                .as_ref()
                .and_then(|provider| provider.model.clone())
        })
        .or_else(|| {
            stored_built_in
                .as_ref()
                .and_then(|provider| provider.model.clone())
        })
        .unwrap_or_else(|| CODEX_DEFAULT_MODEL.to_string());
    let codex_provider_id = custom_id
        .as_deref()
        .map(codex_custom_provider_id)
        .unwrap_or_else(|| XUYA_CODEX_PROVIDER_ID.to_string());

    let (generated_config, base_url, endpoint, api_key) = if provider_id == "official" {
        (
            format!(
                "model_provider = \"openai\"\nmodel = {}\n",
                toml_string(&model)
            ),
            None,
            None,
            None,
        )
    } else {
        let raw_base_url = clean_optional_text(request.base_url.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .map(|provider| provider.base_url.clone())
            })
            .or_else(|| {
                stored_built_in
                    .as_ref()
                    .map(|provider| provider.base_url.clone())
            })
            .ok_or_else(|| "Codex base URL is required".to_string())?;
        let base_url = normalize_codex_base_url(&raw_base_url)?;
        let api_key = clean_optional_text(request.api_key.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| clean_optional_text(Some(provider.api_key.as_str())))
            })
            .or_else(|| {
                stored_built_in.as_ref().and_then(|provider| {
                    clean_agent_api_key("codex", Some(provider.api_key.as_str()))
                })
            })
            .or(existing_api_key)
            .ok_or_else(|| "Codex API Key is required".to_string())?;
        let provider_name = stored_custom
            .as_ref()
            .map(|provider| provider.name.as_str())
            .unwrap_or("XuYa Custom");
        let prefix = format!(
            "# Managed by XuYa Terminal.\nmodel_provider = \"{provider_id}\"\nmodel = {}\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.{provider_id}]\nname = {}\nbase_url = {}\nwire_api = \"responses\"\nexperimental_bearer_token = {}\n",
            toml_string(&model),
            toml_string(provider_name),
            toml_string(&base_url),
            toml_string(&api_key),
            provider_id = codex_provider_id,
        );
        let endpoint = codex_responses_endpoint(&base_url);
        (prefix, Some(base_url), Some(endpoint), Some(api_key))
    };

    let preserved_source = full_config.as_deref().unwrap_or(&current);
    let preserved = strip_codex_managed_config(preserved_source);
    let mut next = merge_codex_config(generated_config, String::new(), preserved);
    if let Some(api_key) = api_key {
        let token_provider_id =
            extract_top_level_toml_string(&next, "model_provider").unwrap_or(codex_provider_id);
        next = set_codex_provider_token(&next, &token_provider_id, &api_key);
    }
    if !next.ends_with('\n') {
        next.push('\n');
    }
    write_text_atomic(&path, &next)?;

    let auth_to_write = if provider_id == "official" {
        provided_auth_config
    } else {
        let api_key = clean_optional_text(request.api_key.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| clean_optional_text(Some(provider.api_key.as_str())))
            })
            .or_else(|| {
                stored_built_in.as_ref().and_then(|provider| {
                    clean_agent_api_key("codex", Some(provider.api_key.as_str()))
                })
            })
            .or(current_auth_api_key)
            .or_else(|| {
                extract_top_level_toml_string(&next, "model_provider")
                    .as_deref()
                    .and_then(|provider| {
                        clean_codex_token(extract_codex_provider_string(
                            &next,
                            provider,
                            "experimental_bearer_token",
                        ))
                    })
            })
            .or_else(|| {
                clean_codex_token(extract_top_level_toml_string(
                    &next,
                    "experimental_bearer_token",
                ))
            });
        api_key.map(|api_key| {
            let mut auth = provided_auth_config.unwrap_or(current_auth);
            ensure_json_object(&mut auth)
                .insert("OPENAI_API_KEY".to_string(), Value::String(api_key));
            auth
        })
    };
    if let Some(auth) = auth_to_write {
        write_json_pretty_atomic(&auth_path, &auth)?;
    }

    Ok(AgentConfigApplyResult {
        tool: "codex".to_string(),
        provider_id: result_provider_id,
        path: path_to_string(&path),
        base_url,
        endpoint,
    })
}

// ── Helper Functions ──────────────────────────────────────────────────────────

fn read_claude_config_state(
    path: &Path,
    custom_providers: &[AgentCustomProvider],
    built_in_providers: &[AgentBuiltInProvider],
) -> AgentToolConfigState {
    let exists = path.exists();
    let settings = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let env = settings
        .as_ref()
        .and_then(|value| value.get("env"))
        .and_then(Value::as_object);
    let base_url = env
        .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let model = env
        .and_then(|env| env.get("ANTHROPIC_MODEL"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let haiku_model = env
        .and_then(|env| env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let haiku_model_name = env
        .and_then(|env| env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let sonnet_model = env
        .and_then(|env| env.get("ANTHROPIC_DEFAULT_SONNET_MODEL"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let sonnet_model_name = env
        .and_then(|env| env.get("ANTHROPIC_DEFAULT_SONNET_MODEL_NAME"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let opus_model = env
        .and_then(|env| env.get("ANTHROPIC_DEFAULT_OPUS_MODEL"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let opus_model_name = env
        .and_then(|env| env.get("ANTHROPIC_DEFAULT_OPUS_MODEL_NAME"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let api_key = settings.as_ref().and_then(extract_claude_api_key);
    let token_configured = api_key.is_some();
    let active_provider = if let Some(base_url) = base_url.as_deref() {
        Some(
            known_claude_provider_id(base_url)
                .map(str::to_string)
                .or_else(|| {
                    custom_provider_selector_by_base_url("claude", base_url, custom_providers)
                })
                .unwrap_or_else(|| "custom".to_string()),
        )
    } else if token_configured {
        Some("custom".to_string())
    } else if exists {
        Some("official".to_string())
    } else {
        None
    };
    let endpoint = base_url.as_deref().map(claude_messages_endpoint);
    let extra_config = settings.and_then(|value| stringify_claude_config(value).ok());

    AgentToolConfigState {
        path: path_to_string(path),
        exists,
        active_provider,
        base_url,
        endpoint,
        model,
        haiku_model,
        haiku_model_name,
        sonnet_model,
        sonnet_model_name,
        opus_model,
        opus_model_name,
        extra_config,
        auth_path: None,
        auth_exists: false,
        auth_config: None,
        api_key,
        token_configured,
        built_in_providers: builtin_provider_summaries("claude", built_in_providers),
        custom_providers: custom_provider_summaries("claude", custom_providers),
    }
}

fn read_codex_config_state(
    path: &Path,
    auth_path: &Path,
    custom_providers: &[AgentCustomProvider],
    built_in_providers: &[AgentBuiltInProvider],
) -> AgentToolConfigState {
    let exists = path.exists();
    let text = fs::read_to_string(path).unwrap_or_default();
    let auth_exists = auth_path.exists();
    let auth_text = fs::read_to_string(auth_path).unwrap_or_default();
    let auth = if auth_text.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str::<Value>(&auth_text).unwrap_or_else(|_| Value::Object(Map::new()))
    };
    let active_config_provider = extract_top_level_toml_string(&text, "model_provider");
    let model = extract_top_level_toml_string(&text, "model");
    let base_url = active_config_provider
        .as_deref()
        .and_then(|provider| extract_codex_provider_string(&text, provider, "base_url"));
    let api_key = active_config_provider
        .as_deref()
        .and_then(|provider| {
            clean_codex_token(extract_codex_provider_string(
                &text,
                provider,
                "experimental_bearer_token",
            ))
        })
        .or_else(|| {
            clean_codex_token(extract_top_level_toml_string(
                &text,
                "experimental_bearer_token",
            ))
        });
    let api_key = extract_codex_auth_api_key(&auth).or(api_key);
    let token_configured = api_key.is_some();
    let endpoint = base_url.as_deref().map(codex_responses_endpoint);
    let active_provider = active_config_provider.as_deref().map(|provider| {
        if provider == "openai" {
            "official".to_string()
        } else if let Some(id) = custom_provider_id_from_codex_provider_id(provider) {
            format!("{CUSTOM_PROVIDER_SELECTOR_PREFIX}{id}")
        } else {
            base_url
                .as_deref()
                .and_then(|url| {
                    custom_provider_selector_by_base_url("codex", url, custom_providers)
                })
                .unwrap_or_else(|| "custom".to_string())
        }
    });
    let extra_config = clean_optional_text(Some(text.as_str()));

    AgentToolConfigState {
        path: path_to_string(path),
        exists,
        active_provider,
        base_url,
        endpoint,
        model,
        haiku_model: None,
        haiku_model_name: None,
        sonnet_model: None,
        sonnet_model_name: None,
        opus_model: None,
        opus_model_name: None,
        extra_config,
        auth_path: Some(path_to_string(auth_path)),
        auth_exists,
        auth_config: clean_optional_text(Some(auth_text.as_str()))
            .or_else(|| stringify_codex_auth_config(auth).ok()),
        api_key,
        token_configured,
        built_in_providers: builtin_provider_summaries("codex", built_in_providers),
        custom_providers: custom_provider_summaries("codex", custom_providers),
    }
}

fn summarize_custom_provider(
    tool: &str,
    provider: &AgentCustomProvider,
) -> Result<AgentCustomProviderSummary, String> {
    let base_url = normalize_agent_base_url(tool, &provider.base_url)?;
    let endpoint = match tool {
        "claude" => claude_messages_endpoint(&base_url),
        "codex" => codex_responses_endpoint(&base_url),
        _ => return Err(format!("Unsupported agent config target: {tool}")),
    };

    let extra_config = provider
        .extra_config
        .as_deref()
        .and_then(|config| normalize_full_config(tool, Some(config)).ok().flatten());

    Ok(AgentCustomProviderSummary {
        id: provider.id.clone(),
        name: provider.name.clone(),
        base_url,
        endpoint,
        api_key: clean_optional_text(Some(provider.api_key.as_str())),
        model: provider.model.clone(),
        haiku_model: provider.haiku_model.clone(),
        haiku_model_name: provider.haiku_model_name.clone(),
        sonnet_model: provider.sonnet_model.clone(),
        sonnet_model_name: provider.sonnet_model_name.clone(),
        opus_model: provider.opus_model.clone(),
        opus_model_name: provider.opus_model_name.clone(),
        extra_config,
        quota_provider_type: normalize_quota_provider_type(provider.quota_provider_type.as_deref()),
        quota_base_url: provider.quota_base_url.clone(),
        quota_api_key: provider.quota_api_key.clone(),
        quota_access_token: provider.quota_access_token.clone(),
        quota_user_id: provider.quota_user_id.clone(),
        token_configured: is_real_token(&provider.api_key, ""),
    })
}

fn summarize_builtin_provider(
    tool: &str,
    provider: &AgentBuiltInProvider,
) -> Result<AgentBuiltInProviderSummary, String> {
    let base_url = clean_optional_text(Some(provider.base_url.as_str()))
        .map(|value| normalize_agent_base_url(tool, &value))
        .transpose()?
        .unwrap_or_default();
    let endpoint = if base_url.is_empty() {
        None
    } else {
        Some(match tool {
            "claude" => claude_messages_endpoint(&base_url),
            "codex" => codex_responses_endpoint(&base_url),
            _ => return Err(format!("Unsupported agent config target: {tool}")),
        })
    };
    let api_key = clean_agent_api_key(tool, Some(provider.api_key.as_str()));
    let extra_config = provider
        .extra_config
        .as_deref()
        .and_then(|config| normalize_full_config(tool, Some(config)).ok().flatten());
    let auth_config = if tool == "codex" {
        provider.auth_config.clone()
    } else {
        None
    };

    Ok(AgentBuiltInProviderSummary {
        id: provider.id.clone(),
        base_url,
        endpoint,
        api_key: api_key.clone(),
        model: provider.model.clone(),
        haiku_model: provider.haiku_model.clone(),
        haiku_model_name: provider.haiku_model_name.clone(),
        sonnet_model: provider.sonnet_model.clone(),
        sonnet_model_name: provider.sonnet_model_name.clone(),
        opus_model: provider.opus_model.clone(),
        opus_model_name: provider.opus_model_name.clone(),
        extra_config,
        auth_config,
        token_configured: api_key.is_some(),
    })
}

fn custom_provider_summaries(
    tool: &str,
    providers: &[AgentCustomProvider],
) -> Vec<AgentCustomProviderSummary> {
    providers
        .iter()
        .filter_map(|provider| summarize_custom_provider(tool, provider).ok())
        .collect()
}

fn builtin_provider_summaries(
    tool: &str,
    providers: &[AgentBuiltInProvider],
) -> Vec<AgentBuiltInProviderSummary> {
    providers
        .iter()
        .filter_map(|provider| summarize_builtin_provider(tool, provider).ok())
        .collect()
}

fn find_custom_provider<'a>(
    providers: &'a [AgentCustomProvider],
    id: &str,
) -> Option<&'a AgentCustomProvider> {
    providers.iter().find(|provider| provider.id == id)
}

fn custom_provider_selector_by_base_url(
    tool: &str,
    base_url: &str,
    providers: &[AgentCustomProvider],
) -> Option<String> {
    let normalized = normalize_agent_base_url(tool, base_url).ok()?;
    providers
        .iter()
        .find(|provider| {
            normalize_agent_base_url(tool, &provider.base_url)
                .map(|value| value.eq_ignore_ascii_case(&normalized))
                .unwrap_or(false)
        })
        .map(|provider| format!("{CUSTOM_PROVIDER_SELECTOR_PREFIX}{}", provider.id))
}

fn custom_provider_id_from_selector(provider_id: &str) -> Option<String> {
    provider_id
        .trim()
        .strip_prefix(CUSTOM_PROVIDER_SELECTOR_PREFIX)
        .and_then(|value| clean_optional_text(Some(value)))
}

fn normalize_agent_base_url(tool: &str, value: &str) -> Result<String, String> {
    match tool {
        "claude" => normalize_claude_base_url(value),
        "codex" => normalize_codex_base_url(value),
        other => Err(format!("Unsupported agent config target: {other}")),
    }
}

fn normalize_agent_model(tool: &str, model: Option<&str>) -> Option<String> {
    clean_optional_text(model).or_else(|| {
        if tool == "codex" {
            Some(CODEX_DEFAULT_MODEL.to_string())
        } else {
            None
        }
    })
}

fn normalize_builtin_agent_model(
    tool: &str,
    provider_id: &str,
    model: Option<&str>,
) -> Option<String> {
    let model = normalize_agent_model(tool, model)?;
    if tool == "claude"
        && claude_legacy_builtin_fallback_model(provider_id).is_some_and(|legacy| legacy == model)
    {
        return None;
    }
    Some(model)
}

fn claude_legacy_builtin_fallback_model(provider_id: &str) -> Option<&'static str> {
    match provider_id {
        "zhipu" => Some("glm-5.1"),
        "minimax" => Some("MiniMax-M2.7"),
        "kimi" => Some("kimi-k2.6"),
        "deepseek" => Some("deepseek-v4-pro"),
        "xiaomimimo" => Some("mimo-v2.5-pro"),
        _ => None,
    }
}

fn normalize_claude_role_model(tool: &str, model: Option<&str>) -> Option<String> {
    if tool == "claude" {
        clean_optional_text(model)
    } else {
        None
    }
}

fn normalize_full_config(tool: &str, full_config: Option<&str>) -> Result<Option<String>, String> {
    let Some(full_config) = clean_optional_text(full_config) else {
        return Ok(None);
    };
    match tool {
        "claude" => stringify_claude_config(parse_claude_full_config(&full_config)?).map(Some),
        "codex" => Ok(Some(full_config)),
        other => Err(format!("Unsupported agent config target: {other}")),
    }
}

fn normalize_agent_auth_config(
    tool: &str,
    auth_config: Option<&str>,
) -> Result<Option<String>, String> {
    if tool != "codex" {
        return Ok(None);
    }
    let Some(auth_config) = clean_optional_text(auth_config) else {
        return Ok(None);
    };
    stringify_codex_auth_config(parse_codex_auth_config(&auth_config)?).map(Some)
}

fn parse_claude_full_config(full_config: &str) -> Result<Value, String> {
    let value = serde_json::from_str::<Value>(full_config)
        .map_err(|e| format!("Claude config must be a JSON object: {e}"))?;
    if !value.is_object() {
        return Err("Claude config must be a JSON object".to_string());
    }
    if value.get("env").is_some_and(|env| !env.is_object()) {
        return Err("Claude config env must be a JSON object".to_string());
    }
    Ok(value)
}

fn stringify_claude_config(value: Value) -> Result<String, String> {
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Failed to serialize Claude config: {e}"))
}

fn extract_claude_api_key(settings: &Value) -> Option<String> {
    settings
        .get("env")
        .and_then(Value::as_object)
        .and_then(|env| {
            env.get("ANTHROPIC_AUTH_TOKEN")
                .or_else(|| env.get("ANTHROPIC_API_KEY"))
        })
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != CLAUDE_TOKEN_PLACEHOLDER)
        .map(str::to_string)
}

fn extract_codex_auth_api_key(auth: &Value) -> Option<String> {
    auth.get("OPENAI_API_KEY")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != CODEX_TOKEN_PLACEHOLDER)
        .map(str::to_string)
}

fn parse_codex_auth_config(auth_config: &str) -> Result<Value, String> {
    let value = serde_json::from_str::<Value>(auth_config)
        .map_err(|e| format!("Codex auth.json must be a JSON object: {e}"))?;
    if !value.is_object() {
        return Err("Codex auth.json must be a JSON object".to_string());
    }
    Ok(value)
}

fn stringify_codex_auth_config(value: Value) -> Result<String, String> {
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Failed to serialize Codex auth.json: {e}"))
}

fn is_real_token(value: &str, placeholder: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && (placeholder.is_empty() || value != placeholder)
}

fn clean_codex_token(value: Option<String>) -> Option<String> {
    value
        .and_then(|value| clean_optional_text(Some(value.as_str())))
        .filter(|value| value != CODEX_TOKEN_PLACEHOLDER)
}

fn clean_agent_api_key(tool: &str, value: Option<&str>) -> Option<String> {
    clean_optional_text(value).filter(|value| match tool {
        "claude" => value != CLAUDE_TOKEN_PLACEHOLDER,
        "codex" => value != CODEX_TOKEN_PLACEHOLDER,
        _ => true,
    })
}

fn current_agent_api_key(home: &Path, tool: &str, custom_id: Option<&str>) -> Option<String> {
    match tool {
        "claude" => read_json_or_empty_object(&claude_settings_path(home))
            .ok()
            .and_then(|settings| extract_claude_api_key(&settings)),
        "codex" => {
            let current = fs::read_to_string(codex_config_path(home)).unwrap_or_default();
            let auth_key = read_json_or_empty_object(&codex_auth_path(home))
                .ok()
                .and_then(|auth| extract_codex_auth_api_key(&auth));
            let current_provider = extract_top_level_toml_string(&current, "model_provider");
            let target_provider = custom_id.map(codex_custom_provider_id);
            auth_key
                .or_else(|| {
                    target_provider.as_deref().and_then(|provider| {
                        clean_codex_token(extract_codex_provider_string(
                            &current,
                            provider,
                            "experimental_bearer_token",
                        ))
                    })
                })
                .or_else(|| {
                    current_provider.as_deref().and_then(|provider| {
                        clean_codex_token(extract_codex_provider_string(
                            &current,
                            provider,
                            "experimental_bearer_token",
                        ))
                    })
                })
                .or_else(|| {
                    clean_codex_token(extract_top_level_toml_string(
                        &current,
                        "experimental_bearer_token",
                    ))
                })
        }
        _ => None,
    }
}

async fn fetch_openai_compatible_models(
    base_url: &str,
    api_key: &str,
) -> Result<(String, Vec<AgentFetchedModel>), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(MODEL_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let url = openai_compatible_models_url(base_url)?;
    let response = client
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let status = response.status();

    if status.is_success() {
        let resp = response
            .json::<ModelsResponse>()
            .await
            .map_err(|e| format!("Failed to parse models response: {e}"))?;
        let mut models = resp
            .data
            .unwrap_or_default()
            .into_iter()
            .filter_map(|model| {
                clean_optional_text(Some(model.id.as_str())).map(|id| AgentFetchedModel {
                    id,
                    owned_by: model.owned_by,
                })
            })
            .collect::<Vec<_>>();
        models.sort_by(|a, b| a.id.cmp(&b.id));
        return Ok((url, models));
    }

    let body = response.text().await.unwrap_or_default();
    Err(format!("HTTP {status}: {body}"))
}

async fn fetch_agent_provider_quota_inner(
    request: AgentProviderQuotaRequest,
) -> Result<AgentProviderQuotaResult, String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    let tool = parse_agent_tool(&request.tool)?.to_string();
    let provider_id = clean_optional_text(Some(request.provider_id.as_str()))
        .ok_or_else(|| "Provider is required".to_string())?;

    if provider_id == "official" {
        return Ok(AgentProviderQuotaResult {
            tool,
            provider_id,
            provider_name: "官方".to_string(),
            quota_provider_type: None,
            configured: false,
            success: false,
            plan_name: None,
            total: None,
            used: None,
            remaining: None,
            unit: None,
            tiers: Vec::new(),
            queried_at: current_unix_secs(),
            error: Some("官方代理商不支持额度查询".to_string()),
        });
    }

    let custom_id = custom_provider_id_from_selector(&provider_id);
    let store = read_custom_provider_store(&home, &tool)?;
    let provider = if let Some(custom_id) = custom_id {
        store.providers.into_iter().find(|p| p.id == custom_id)
    } else {
        None
    };

    let Some(provider) = provider else {
        return Ok(AgentProviderQuotaResult {
            tool,
            provider_id,
            provider_name: "未知".to_string(),
            quota_provider_type: None,
            configured: false,
            success: false,
            plan_name: None,
            total: None,
            used: None,
            remaining: None,
            unit: None,
            tiers: Vec::new(),
            queried_at: current_unix_secs(),
            error: Some("未找到代理商配置".to_string()),
        });
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(AGENT_QUOTA_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let kind = normalize_quota_provider_type(provider.quota_provider_type.as_deref());
    let Some(kind) = kind else {
        return Ok(AgentProviderQuotaResult {
            tool,
            provider_id,
            provider_name: provider.name,
            quota_provider_type: None,
            configured: false,
            success: false,
            plan_name: None,
            total: None,
            used: None,
            remaining: None,
            unit: None,
            tiers: Vec::new(),
            queried_at: current_unix_secs(),
            error: Some("当前代理商未配置额度查询".to_string()),
        });
    };

    match kind.as_str() {
        "sub2api" => {
            fetch_sub2api_quota(&client, &tool, &provider_id, &provider).await
        }
        "newapi" => fetch_newapi_quota(&client, &tool, &provider_id, &provider).await,
        _ => Ok(AgentProviderQuotaResult {
            tool,
            provider_id,
            provider_name: provider.name,
            quota_provider_type: Some(kind),
            configured: false,
            success: false,
            plan_name: None,
            total: None,
            used: None,
            remaining: None,
            unit: None,
            tiers: Vec::new(),
            queried_at: current_unix_secs(),
            error: Some("不支持的额度查询类型".to_string()),
        }),
    }
}

async fn fetch_sub2api_quota(
    client: &reqwest::Client,
    tool: &str,
    provider_id: &str,
    provider: &AgentCustomProvider,
) -> Result<AgentProviderQuotaResult, String> {
    let kind = Some("sub2api".to_string());
    let base_url = provider.base_url.clone();
    let api_key = clean_optional_text(Some(provider.api_key.as_str()));
    let Some(api_key) = api_key else {
        return Ok(AgentProviderQuotaResult {
            tool: tool.to_string(),
            provider_id: provider_id.to_string(),
            provider_name: provider.name.clone(),
            quota_provider_type: kind,
            configured: false,
            success: false,
            plan_name: None,
            total: None,
            used: None,
            remaining: None,
            unit: None,
            tiers: Vec::new(),
            queried_at: current_unix_secs(),
            error: Some("Sub2API 额度 Key 未配置".to_string()),
        });
    };

    let url = sub2api_usage_url(&base_url)?;
    let response = client
        .get(&url)
        .bearer_auth(api_key)
        .header("User-Agent", "XuYa Terminal")
        .send()
        .await
        .map_err(|e| format!("Quota request failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(AgentProviderQuotaResult {
            tool: tool.to_string(),
            provider_id: provider_id.to_string(),
            provider_name: provider.name.clone(),
            quota_provider_type: kind,
            configured: true,
            success: false,
            plan_name: None,
            total: None,
            used: None,
            remaining: None,
            unit: None,
            tiers: Vec::new(),
            queried_at: current_unix_secs(),
            error: Some(format!("HTTP {status}: {body}")),
        });
    }

    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Sub2API quota response: {e}"))?;
    let remaining = value_number_path(&json, &["remaining"])
        .or_else(|| value_number_path(&json, &["balance"]));
    let used = value_number_path(&json, &["quota", "used"])
        .or_else(|| value_number_path(&json, &["usage", "total", "cost"]));
    let total = value_number_path(&json, &["quota", "limit"])
        .or_else(|| {
            used.zip(remaining)
                .map(|(used, remaining)| used + remaining)
        });
    let unit = value_string_path(&json, &["unit"])
        .or_else(|| value_string_path(&json, &["quota", "unit"]))
        .unwrap_or_else(|| "USD".to_string());

    Ok(AgentProviderQuotaResult {
        tool: tool.to_string(),
        provider_id: provider_id.to_string(),
        provider_name: provider.name.clone(),
        quota_provider_type: kind,
        configured: true,
        success: true,
        plan_name: value_string_path(&json, &["planName"])
            .or_else(|| value_string_path(&json, &["mode"])),
        total,
        used,
        remaining,
        unit: Some(unit),
        tiers: Vec::new(),
        queried_at: current_unix_secs(),
        error: None,
    })
}

async fn fetch_newapi_quota(
    client: &reqwest::Client,
    tool: &str,
    provider_id: &str,
    provider: &AgentCustomProvider,
) -> Result<AgentProviderQuotaResult, String> {
    let kind = Some("newapi".to_string());
    let base_url = provider.base_url.clone();
    let access_token = clean_optional_text(provider.quota_access_token.as_deref());
    let user_id = clean_optional_text(provider.quota_user_id.as_deref());
    let (Some(access_token), Some(user_id)) = (access_token, user_id) else {
        return Ok(AgentProviderQuotaResult {
            tool: tool.to_string(),
            provider_id: provider_id.to_string(),
            provider_name: provider.name.clone(),
            quota_provider_type: kind,
            configured: false,
            success: false,
            plan_name: None,
            total: None,
            used: None,
            remaining: None,
            unit: None,
            tiers: Vec::new(),
            queried_at: current_unix_secs(),
            error: Some("New API 额度 Token 或用户 ID 未配置".to_string()),
        });
    };

    let mut base = base_url.trim_end_matches('/').to_string();
    for suffix in [
        "/v1/chat/completions",
        "/v1/responses",
        "/v1/messages",
        "/v1",
    ] {
        if base.ends_with(suffix) {
            base = base[..base.len() - suffix.len()].to_string();
        }
    }
    let url = format!("{}/api/user/self", base.trim_end_matches('/'));

    let response = client
        .get(&url)
        .bearer_auth(access_token)
        .header("Content-Type", "application/json")
        .header("User-Agent", "XuYa Terminal")
        .header("New-Api-User", user_id)
        .send()
        .await
        .map_err(|e| format!("Quota request failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(AgentProviderQuotaResult {
            tool: tool.to_string(),
            provider_id: provider_id.to_string(),
            provider_name: provider.name.clone(),
            quota_provider_type: kind,
            configured: true,
            success: false,
            plan_name: None,
            total: None,
            used: None,
            remaining: None,
            unit: None,
            tiers: Vec::new(),
            queried_at: current_unix_secs(),
            error: Some(format!("HTTP {status}: {body}")),
        });
    }

    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse New API quota response: {e}"))?;
    if value_bool_path(&json, &["success"]) == Some(false) {
        let message = value_string_path(&json, &["message"])
            .or_else(|| value_string_path(&json, &["error"]))
            .unwrap_or_else(|| "New API 返回失败".to_string());
        return Ok(AgentProviderQuotaResult {
            tool: tool.to_string(),
            provider_id: provider_id.to_string(),
            provider_name: provider.name.clone(),
            quota_provider_type: kind,
            configured: true,
            success: false,
            plan_name: None,
            total: None,
            used: None,
            remaining: None,
            unit: None,
            tiers: Vec::new(),
            queried_at: current_unix_secs(),
            error: Some(message),
        });
    }

    let quota = value_number_path(&json, &["data", "quota"]).unwrap_or(0.0) / 500_000.0;
    let used_quota = value_number_path(&json, &["data", "used_quota"]).unwrap_or(0.0) / 500_000.0;
    let plan_name = value_string_path(&json, &["data", "group"]);

    Ok(AgentProviderQuotaResult {
        tool: tool.to_string(),
        provider_id: provider_id.to_string(),
        provider_name: provider.name.clone(),
        quota_provider_type: kind,
        configured: true,
        success: true,
        plan_name,
        total: Some(quota + used_quota),
        used: Some(used_quota),
        remaining: Some(quota),
        unit: Some("USD".to_string()),
        tiers: Vec::new(),
        queried_at: current_unix_secs(),
        error: None,
    })
}

// ── Database Operations ──────────────────────────────────────────────────────

fn read_custom_provider_store(home: &Path, tool: &str) -> Result<AgentCustomProviderStore, String> {
    let conn = open_agent_provider_db(home)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, base_url, api_key, model,
                    haiku_model, haiku_model_name,
                    sonnet_model, sonnet_model_name,
                    opus_model, opus_model_name,
                    extra_config,
                    quota_provider_type, quota_base_url, quota_api_key,
                    quota_access_token, quota_user_id
             FROM agent_providers
             WHERE tool = ?1
             ORDER BY name COLLATE NOCASE, id",
        )
        .map_err(|e| format!("Failed to prepare provider query: {e}"))?;
    let rows = stmt
        .query_map(params![tool], |row| {
            Ok(AgentCustomProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model: row.get(4)?,
                haiku_model: row.get(5)?,
                haiku_model_name: row.get(6)?,
                sonnet_model: row.get(7)?,
                sonnet_model_name: row.get(8)?,
                opus_model: row.get(9)?,
                opus_model_name: row.get(10)?,
                extra_config: row.get(11)?,
                quota_provider_type: row.get(12)?,
                quota_base_url: row.get(13)?,
                quota_api_key: row.get(14)?,
                quota_access_token: row.get(15)?,
                quota_user_id: row.get(16)?,
            })
        })
        .map_err(|e| format!("Failed to read custom providers: {e}"))?;

    let mut providers = Vec::new();
    for row in rows {
        providers.push(row.map_err(|e| format!("Failed to decode custom provider: {e}"))?);
    }
    Ok(AgentCustomProviderStore { providers })
}

fn write_custom_provider_store(
    home: &Path,
    tool: &str,
    store: &AgentCustomProviderStore,
) -> Result<(), String> {
    let mut conn = open_agent_provider_db(home)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to open provider transaction: {e}"))?;
    tx.execute("DELETE FROM agent_providers WHERE tool = ?1", params![tool])
        .map_err(|e| format!("Failed to clear custom providers: {e}"))?;
    for provider in &store.providers {
        tx.execute(
            "INSERT INTO agent_providers (
                tool, id, name, base_url, api_key, model,
                haiku_model, haiku_model_name,
                sonnet_model, sonnet_model_name,
                opus_model, opus_model_name,
                extra_config, quota_provider_type, quota_base_url,
                quota_api_key, quota_access_token, quota_user_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                tool,
                provider.id,
                provider.name,
                provider.base_url,
                provider.api_key,
                provider.model,
                provider.haiku_model,
                provider.haiku_model_name,
                provider.sonnet_model,
                provider.sonnet_model_name,
                provider.opus_model,
                provider.opus_model_name,
                provider.extra_config,
                provider.quota_provider_type,
                provider.quota_base_url,
                provider.quota_api_key,
                provider.quota_access_token,
                provider.quota_user_id,
            ],
        )
        .map_err(|e| format!("Failed to save custom provider {}: {e}", provider.id))?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit custom providers: {e}"))
}

fn read_builtin_provider_store(
    home: &Path,
    tool: &str,
) -> Result<Vec<AgentBuiltInProvider>, String> {
    let conn = open_agent_provider_db(home)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, base_url, api_key, model,
                    haiku_model, haiku_model_name,
                    sonnet_model, sonnet_model_name,
                    opus_model, opus_model_name,
                    extra_config, auth_config
             FROM agent_builtin_providers
             WHERE tool = ?1
             ORDER BY id",
        )
        .map_err(|e| format!("Failed to prepare built-in provider query: {e}"))?;
    let rows = stmt
        .query_map(params![tool], |row| {
            Ok(AgentBuiltInProvider {
                id: row.get(0)?,
                base_url: row.get(1)?,
                api_key: row.get(2)?,
                model: row.get(3)?,
                haiku_model: row.get(4)?,
                haiku_model_name: row.get(5)?,
                sonnet_model: row.get(6)?,
                sonnet_model_name: row.get(7)?,
                opus_model: row.get(8)?,
                opus_model_name: row.get(9)?,
                extra_config: row.get(10)?,
                auth_config: row.get(11)?,
            })
        })
        .map_err(|e| format!("Failed to read built-in providers: {e}"))?;

    let mut providers = Vec::new();
    for row in rows {
        providers.push(row.map_err(|e| format!("Failed to decode built-in provider: {e}"))?);
    }
    Ok(providers)
}

fn read_builtin_provider(
    home: &Path,
    tool: &str,
    provider_id: &str,
) -> Result<Option<AgentBuiltInProvider>, String> {
    Ok(read_builtin_provider_store(home, tool)?
        .into_iter()
        .find(|provider| provider.id == provider_id))
}

fn write_builtin_provider(
    home: &Path,
    tool: &str,
    provider: &AgentBuiltInProvider,
) -> Result<(), String> {
    let conn = open_agent_provider_db(home)?;
    conn.execute(
        "INSERT INTO agent_builtin_providers (
            tool, id, base_url, api_key, model,
            haiku_model, haiku_model_name,
            sonnet_model, sonnet_model_name,
            opus_model, opus_model_name,
            extra_config, auth_config, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, strftime('%s', 'now'))
         ON CONFLICT(tool, id) DO UPDATE SET
            base_url = excluded.base_url,
            api_key = excluded.api_key,
            model = excluded.model,
            haiku_model = excluded.haiku_model,
            haiku_model_name = excluded.haiku_model_name,
            sonnet_model = excluded.sonnet_model,
            sonnet_model_name = excluded.sonnet_model_name,
            opus_model = excluded.opus_model,
            opus_model_name = excluded.opus_model_name,
            extra_config = excluded.extra_config,
            auth_config = excluded.auth_config,
            updated_at = excluded.updated_at",
        params![
            tool,
            provider.id,
            provider.base_url,
            provider.api_key,
            provider.model,
            provider.haiku_model,
            provider.haiku_model_name,
            provider.sonnet_model,
            provider.sonnet_model_name,
            provider.opus_model,
            provider.opus_model_name,
            provider.extra_config,
            provider.auth_config,
        ],
    )
    .map_err(|e| format!("Failed to save built-in provider {}: {e}", provider.id))?;
    Ok(())
}

fn open_agent_provider_db(home: &Path) -> Result<Connection, String> {
    let path = agent_provider_db_path(home);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    let conn =
        Connection::open(&path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_providers (
            tool TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL DEFAULT '',
            model TEXT,
            haiku_model TEXT,
            haiku_model_name TEXT,
            sonnet_model TEXT,
            sonnet_model_name TEXT,
            opus_model TEXT,
            opus_model_name TEXT,
            extra_config TEXT,
            quota_provider_type TEXT,
            quota_base_url TEXT,
            quota_api_key TEXT,
            quota_access_token TEXT,
            quota_user_id TEXT,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (tool, id)
        );
        CREATE TABLE IF NOT EXISTS agent_builtin_providers (
            tool TEXT NOT NULL,
            id TEXT NOT NULL,
            base_url TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT '',
            model TEXT,
            haiku_model TEXT,
            haiku_model_name TEXT,
            sonnet_model TEXT,
            sonnet_model_name TEXT,
            opus_model TEXT,
            opus_model_name TEXT,
            extra_config TEXT,
            auth_config TEXT,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (tool, id)
        );",
    )
    .map_err(|e| format!("Failed to initialize provider database: {e}"))?;
    ensure_agent_provider_columns(&conn)?;
    ensure_agent_builtin_provider_columns(&conn)?;
    Ok(conn)
}

fn ensure_agent_provider_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(agent_providers)")
        .map_err(|e| format!("Failed to inspect provider database schema: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to read provider database schema: {e}"))?;
    let mut columns = HashSet::new();
    for row in rows {
        columns.insert(row.map_err(|e| format!("Failed to decode provider column: {e}"))?);
    }

    for column in [
        "haiku_model_name",
        "sonnet_model_name",
        "opus_model_name",
        "quota_provider_type",
        "quota_base_url",
        "quota_api_key",
        "quota_access_token",
        "quota_user_id",
    ] {
        if !columns.contains(column) {
            conn.execute(
                &format!("ALTER TABLE agent_providers ADD COLUMN {column} TEXT"),
                [],
            )
            .map_err(|e| format!("Failed to add provider column {column}: {e}"))?;
        }
    }
    Ok(())
}

fn ensure_agent_builtin_provider_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(agent_builtin_providers)")
        .map_err(|e| format!("Failed to inspect built-in provider database schema: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to read built-in provider database schema: {e}"))?;
    let mut columns = HashSet::new();
    for row in rows {
        columns.insert(row.map_err(|e| format!("Failed to decode built-in column: {e}"))?);
    }

    for column in [
        "haiku_model_name",
        "sonnet_model_name",
        "opus_model_name",
        "auth_config",
    ] {
        if !columns.contains(column) {
            conn.execute(
                &format!("ALTER TABLE agent_builtin_providers ADD COLUMN {column} TEXT"),
                [],
            )
            .map_err(|e| format!("Failed to add built-in provider column {column}: {e}"))?;
        }
    }
    Ok(())
}

// ── Path Utilities ───────────────────────────────────────────────────────────

fn claude_settings_path(home: &Path) -> PathBuf {
    home.join(".claude").join("settings.json")
}

fn codex_config_path(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}

fn codex_auth_path(home: &Path) -> PathBuf {
    home.join(".codex").join("auth.json")
}

fn agent_provider_db_path(home: &Path) -> PathBuf {
    home.join(".xuya").join("agent-providers.sqlite")
}

fn parse_agent_tool(tool: &str) -> Result<&'static str, String> {
    match tool.trim() {
        "claude" => Ok("claude"),
        "codex" => Ok("codex"),
        other => Err(format!("Unsupported agent config target: {other}")),
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

// ── Text Utilities ───────────────────────────────────────────────────────────

fn clean_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_quota_provider_type(value: Option<&str>) -> Option<String> {
    match value?.trim().to_ascii_lowercase().as_str() {
        "newapi" | "new-api" | "new_api" => Some("newapi".to_string()),
        "sub2api" | "sub2-api" | "sub2_api" => Some("sub2api".to_string()),
        "none" | "off" | "disabled" => None,
        _ => None,
    }
}

fn normalize_claude_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return Err("Claude base URL is required".to_string());
    }
    let base = strip_suffix_ignore_ascii(&trimmed, "/v1/messages")
        .or_else(|| strip_suffix_ignore_ascii(&trimmed, "/messages"))
        .or_else(|| strip_suffix_ignore_ascii(&trimmed, "/v1"))
        .unwrap_or(trimmed);
    Ok(base.trim_end_matches('/').to_string())
}

fn normalize_codex_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return Err("Codex base URL is required".to_string());
    }
    let mut base = strip_suffix_ignore_ascii(&trimmed, "/responses").unwrap_or(trimmed);
    if !base.to_ascii_lowercase().ends_with("/v1") {
        base = format!("{}/v1", base.trim_end_matches('/'));
    }
    Ok(base.trim_end_matches('/').to_string())
}

fn strip_suffix_ignore_ascii(value: &str, suffix: &str) -> Option<String> {
    value
        .to_ascii_lowercase()
        .ends_with(&suffix.to_ascii_lowercase())
        .then(|| value[..value.len() - suffix.len()].to_string())
}

fn claude_messages_endpoint(base_url: &str) -> String {
    format!("{}/v1/messages", base_url.trim_end_matches('/'))
}

fn codex_responses_endpoint(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.to_ascii_lowercase().ends_with("/v1") {
        format!("{base}/responses")
    } else {
        format!("{base}/v1/responses")
    }
}

fn openai_compatible_models_url(base_url: &str) -> Result<String, String> {
    let mut base = clean_optional_text(Some(base_url))
        .ok_or_else(|| "Base URL is required to fetch models".to_string())?
        .trim_end_matches('/')
        .to_string();
    for suffix in [
        "/v1/models",
        "/models",
        "/v1/chat/completions",
        "/v1/responses",
        "/v1/messages",
    ] {
        while let Some(stripped) = strip_suffix_ignore_ascii(&base, suffix) {
            base = stripped.trim_end_matches('/').to_string();
        }
    }
    if base.to_ascii_lowercase().ends_with("/v1") {
        Ok(format!("{base}/models"))
    } else {
        Ok(format!("{base}/v1/models"))
    }
}

fn sub2api_usage_url(base_url: &str) -> Result<String, String> {
    let mut base = clean_optional_text(Some(base_url))
        .ok_or_else(|| "Sub2API 额度地址未配置".to_string())?
        .trim_end_matches('/')
        .to_string();
    for suffix in ["/v1/usage", "/usage", "/v1"] {
        while let Some(stripped) = strip_suffix_ignore_ascii(&base, suffix) {
            base = stripped.trim_end_matches('/').to_string();
        }
    }
    Ok(format!("{base}/v1/usage"))
}

fn claude_known_provider_base_url(provider_id: &str) -> Option<&'static str> {
    CLAUDE_KNOWN_PROVIDERS
        .iter()
        .find(|(id, _)| *id == provider_id)
        .map(|(_, url)| *url)
}

fn known_claude_provider_id(base_url: &str) -> Option<&'static str> {
    let normalized = normalize_claude_base_url(base_url).ok()?;
    CLAUDE_KNOWN_PROVIDERS
        .iter()
        .find(|(_, provider_url)| {
            normalize_claude_base_url(provider_url)
                .map(|value| value.eq_ignore_ascii_case(&normalized))
                .unwrap_or(false)
        })
        .map(|(id, _)| *id)
}

fn unique_custom_provider_id(providers: &[AgentCustomProvider], name: &str) -> String {
    let base = slugify_custom_provider_id(name);
    let base = if base.is_empty() {
        "custom".to_string()
    } else {
        base
    };
    let mut candidate = base.clone();
    let mut index = 2;
    while providers.iter().any(|provider| provider.id == candidate) {
        candidate = format!("{base}-{index}");
        index += 1;
    }
    candidate
}

fn slugify_custom_provider_id(value: &str) -> String {
    let mut output = String::new();
    let mut last_dash = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            output.push('-');
            last_dash = true;
        }
    }
    output.trim_matches('-').to_string()
}

fn codex_custom_provider_id(custom_id: &str) -> String {
    let id = slugify_custom_provider_id(custom_id);
    if id.is_empty() {
        XUYA_CODEX_PROVIDER_ID.to_string()
    } else {
        format!("{XUYA_CODEX_PROVIDER_ID}_{id}")
    }
}

fn custom_provider_id_from_codex_provider_id(provider_id: &str) -> Option<String> {
    if provider_id == XUYA_CODEX_PROVIDER_ID {
        return None;
    }
    provider_id
        .strip_prefix(&format!("{XUYA_CODEX_PROVIDER_ID}_"))
        .and_then(|value| clean_optional_text(Some(value)))
}

// ── JSON/TOML Utilities ──────────────────────────────────────────────────────

fn read_json_or_empty_object(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let text =
        fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    if text.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

fn ensure_json_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value
        .as_object_mut()
        .expect("value was normalized as object")
}

fn value_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn value_number_path(value: &Value, path: &[&str]) -> Option<f64> {
    let value = value_path(value, path)?;
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    value.as_str()?.trim().parse::<f64>().ok()
}

fn value_string_path(value: &Value, path: &[&str]) -> Option<String> {
    let value = value_path(value, path)?;
    value
        .as_str()
        .and_then(|text| clean_optional_text(Some(text)))
}

fn value_bool_path(value: &Value, path: &[&str]) -> Option<bool> {
    value_path(value, path)?.as_bool()
}

fn extract_top_level_toml_string(text: &str, key: &str) -> Option<String> {
    let mut in_section = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_section = true;
        }
        if in_section {
            continue;
        }
        if toml_line_key(trimmed).is_some_and(|line_key| line_key == key) {
            return parse_toml_string_value(trimmed);
        }
    }
    None
}

fn extract_codex_provider_string(text: &str, provider: &str, key: &str) -> Option<String> {
    let target_section = format!("model_providers.{provider}");
    let mut in_target_section = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(section) = parse_toml_section_header(trimmed) {
            in_target_section = section == target_section;
            continue;
        }
        if in_target_section && toml_line_key(trimmed).is_some_and(|line_key| line_key == key) {
            return parse_toml_string_value(trimmed);
        }
    }
    None
}

fn parse_toml_string_value(trimmed: &str) -> Option<String> {
    let (_, raw_value) = trimmed.split_once('=')?;
    let raw_value = raw_value.split('#').next().unwrap_or(raw_value).trim();
    serde_json::from_str::<String>(raw_value).ok().or_else(|| {
        raw_value
            .strip_prefix('"')?
            .strip_suffix('"')
            .map(str::to_string)
    })
}

fn toml_line_key(trimmed: &str) -> Option<&str> {
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('[') {
        return None;
    }
    trimmed
        .split_once('=')
        .map(|(key, _)| key.trim())
        .filter(|key| !key.is_empty())
}

fn parse_toml_section_header(trimmed: &str) -> Option<String> {
    trimmed
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn set_codex_provider_token(text: &str, provider_id: &str, api_key: &str) -> String {
    let target_section = format!("model_providers.{provider_id}");
    let mut lines = text.lines().map(str::to_string).collect::<Vec<_>>();
    let mut section_start = None;
    let mut section_end = lines.len();
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if let Some(section) = parse_toml_section_header(trimmed) {
            if section_start.is_some() {
                section_end = index;
                break;
            }
            if section == target_section {
                section_start = Some(index);
            }
        }
    }

    let token_line = format!("experimental_bearer_token = {}", toml_string(api_key));
    if let Some(section_start) = section_start {
        for index in section_start + 1..section_end {
            if toml_line_key(lines[index].trim())
                .is_some_and(|key| key == "experimental_bearer_token")
            {
                lines[index] = token_line;
                return lines.join("\n");
            }
        }
        lines.insert(section_end, token_line);
        return lines.join("\n");
    }

    if !lines.is_empty() && !lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.push(String::new());
    }
    lines.push(format!("[{target_section}]"));
    lines.push(token_line);
    lines.join("\n")
}

fn strip_codex_managed_config(text: &str) -> String {
    let mut output = Vec::new();
    let mut section: Option<String> = None;
    let mut skipping_managed_section = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "# Managed by XuYa Terminal." {
            continue;
        }

        if let Some(header) = parse_toml_section_header(trimmed) {
            section = Some(header.clone());
            skipping_managed_section = is_codex_provider_section(&header);
        }

        if skipping_managed_section {
            continue;
        }

        if section.is_none() && toml_line_key(trimmed).is_some_and(is_codex_managed_top_level_key) {
            continue;
        }

        output.push(line);
    }

    output.join("\n").trim().to_string()
}

fn merge_codex_config(prefix: String, extra_config: String, preserved: String) -> String {
    let prefix = prefix.trim();
    let extra_config = extra_config.trim();
    let preserved = preserved.trim();
    let mut blocks = vec![prefix.to_string()];
    if !extra_config.is_empty() {
        blocks.push(extra_config.to_string());
    }
    if !preserved.is_empty() {
        blocks.push(preserved.to_string());
    }
    format!("{}\n", blocks.join("\n\n"))
}

fn is_codex_provider_section(section: &str) -> bool {
    section == "model_providers" || section.starts_with("model_providers.")
}

fn is_codex_managed_top_level_key(key: &str) -> bool {
    CODEX_MANAGED_TOP_LEVEL_KEYS.contains(&key)
}

fn write_json_pretty_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize JSON for {}: {e}", path.display()))?;
    write_text_atomic(path, &format!("{text}\n"))
}

fn write_text_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }

    let tmp_path = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&tmp_path, text)
        .map_err(|e| format!("Failed to write {}: {e}", tmp_path.display()))?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Failed to replace {}: {e}", path.display()))?;
    }
    fs::rename(&tmp_path, path).map_err(|e| format!("Failed to move {}: {e}", path.display()))?;
    Ok(())
}
