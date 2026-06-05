//! Tauri commands for PTY management.

use crate::state::AppState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Map;
use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;
use xuya_core::{PtyChunk, SessionSpec};
use xuya_pty::PtySession;

const XUYA_CODEX_PROVIDER_ID: &str = "xuya_custom";
const CUSTOM_PROVIDER_SELECTOR_PREFIX: &str = "custom:";
const XUYA_CODEX_EXTRA_BEGIN: &str = "# XuYa custom config begin";
const XUYA_CODEX_EXTRA_END: &str = "# XuYa custom config end";
const CLAUDE_TOKEN_PLACEHOLDER: &str = "${ANTHROPIC_AUTH_TOKEN}";
const CODEX_TOKEN_PLACEHOLDER: &str = "${CODEX_API_KEY}";
const CODEX_DEFAULT_MODEL: &str = "gpt-5.5";
const MODEL_FETCH_TIMEOUT_SECS: u64 = 15;
const AGENT_QUOTA_TIMEOUT_SECS: u64 = 12;
const MODEL_FETCH_ERROR_BODY_MAX_CHARS: usize = 512;

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

const MODEL_FETCH_COMPAT_SUFFIXES: &[&str] = &[
    "/api/claudecode",
    "/api/anthropic",
    "/apps/anthropic",
    "/api/coding",
    "/claudecode",
    "/anthropic",
    "/step_plan",
    "/coding",
    "/claude",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderConfigRequest {
    tool: String,
    provider_id: String,
    base_url: Option<String>,
    api_key: Option<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCustomProviderSaveRequest {
    tool: String,
    provider_id: Option<String>,
    name: String,
    base_url: String,
    api_key: Option<String>,
    model: Option<String>,
    haiku_model: Option<String>,
    haiku_model_name: Option<String>,
    sonnet_model: Option<String>,
    sonnet_model_name: Option<String>,
    opus_model: Option<String>,
    opus_model_name: Option<String>,
    extra_config: Option<String>,
    quota_provider_type: Option<String>,
    quota_base_url: Option<String>,
    quota_api_key: Option<String>,
    quota_access_token: Option<String>,
    quota_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBuiltInProviderSaveRequest {
    tool: String,
    provider_id: String,
    base_url: Option<String>,
    api_key: Option<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelFetchRequest {
    tool: String,
    provider_id: String,
    base_url: Option<String>,
    api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderQuotaRequest {
    tool: String,
    provider_id: String,
}

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCustomProviderSummary {
    id: String,
    name: String,
    base_url: String,
    endpoint: String,
    api_key: Option<String>,
    model: Option<String>,
    haiku_model: Option<String>,
    haiku_model_name: Option<String>,
    sonnet_model: Option<String>,
    sonnet_model_name: Option<String>,
    opus_model: Option<String>,
    opus_model_name: Option<String>,
    extra_config: Option<String>,
    quota_provider_type: Option<String>,
    quota_base_url: Option<String>,
    quota_api_key: Option<String>,
    quota_access_token: Option<String>,
    quota_user_id: Option<String>,
    token_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBuiltInProviderSummary {
    id: String,
    base_url: String,
    endpoint: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    haiku_model: Option<String>,
    haiku_model_name: Option<String>,
    sonnet_model: Option<String>,
    sonnet_model_name: Option<String>,
    opus_model: Option<String>,
    opus_model_name: Option<String>,
    extra_config: Option<String>,
    auth_config: Option<String>,
    token_configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolConfigState {
    path: String,
    exists: bool,
    active_provider: Option<String>,
    base_url: Option<String>,
    endpoint: Option<String>,
    model: Option<String>,
    haiku_model: Option<String>,
    haiku_model_name: Option<String>,
    sonnet_model: Option<String>,
    sonnet_model_name: Option<String>,
    opus_model: Option<String>,
    opus_model_name: Option<String>,
    extra_config: Option<String>,
    auth_path: Option<String>,
    auth_exists: bool,
    auth_config: Option<String>,
    api_key: Option<String>,
    token_configured: bool,
    built_in_providers: Vec<AgentBuiltInProviderSummary>,
    custom_providers: Vec<AgentCustomProviderSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigState {
    claude: AgentToolConfigState,
    codex: AgentToolConfigState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigApplyResult {
    tool: String,
    provider_id: String,
    path: String,
    base_url: Option<String>,
    endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFetchedModel {
    id: String,
    owned_by: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelFetchResult {
    endpoint: String,
    models: Vec<AgentFetchedModel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderQuotaResult {
    tool: String,
    provider_id: String,
    provider_name: String,
    quota_provider_type: Option<String>,
    configured: bool,
    success: bool,
    plan_name: Option<String>,
    total: Option<f64>,
    used: Option<f64>,
    remaining: Option<f64>,
    unit: Option<String>,
    tiers: Vec<AgentProviderQuotaTier>,
    queried_at: u64,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderQuotaTier {
    name: String,
    utilization: Option<f64>,
    total: Option<f64>,
    used: Option<f64>,
    remaining: Option<f64>,
    unit: Option<String>,
    resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionUsage {
    agent: String,
    session_id: Option<String>,
    source: String,
    context_tokens: Option<u64>,
    total_tokens: Option<u64>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_creation_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    context_window: Option<u64>,
    updated_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeStatus {
    branch: Option<String>,
    staged: usize,
    modified: usize,
    deleted: usize,
    untracked: usize,
    conflicts: usize,
    clean: bool,
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

/// Open a new PTY session. Returns the session ID.
///
/// PTY output is streamed to the frontend over a binary [`Channel`] as
/// length-tagged byte frames (see [`PtyChunk::encode`]). This replaces the old
/// `emit`/`listen` JSON path, which serialized every byte as a decimal number
/// in a JSON array (2–4× inflation plus serialize/parse on the hot path).
#[tauri::command]
pub async fn pty_open(
    spec: SessionSpec,
    on_chunk: Channel<Vec<u8>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (tx, mut rx) = mpsc::channel::<PtyChunk>(256);

    let session = PtySession::spawn(
        spec.id.as_deref(),
        spec.shell_kind,
        spec.cwd.as_deref(),
        spec.rows,
        spec.cols,
        spec.launch_command.as_deref(),
        spec.startup_command.as_deref(),
        tx,
    )
    .map_err(|e| format!("Failed to spawn PTY: {e}"))?;

    let id = session.id.clone();
    state.sessions.insert(id.clone(), session);

    let session_id = id.clone();
    let sessions = state.sessions.clone();
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            if on_chunk.send(chunk.encode()).is_err() {
                break;
            }
        }
        sessions.remove(&session_id);
    });

    Ok(id)
}

#[tauri::command]
pub async fn pty_write(
    id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .get(&id)
        .ok_or_else(|| format!("Session not found: {id}"))?;
    session
        .write(&data)
        .map_err(|e| format!("Write failed: {e}"))
}

#[tauri::command]
pub async fn pty_resize(
    id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .get(&id)
        .ok_or_else(|| format!("Session not found: {id}"))?;
    session
        .resize(rows, cols)
        .map_err(|e| format!("Resize failed: {e}"))
}

#[tauri::command]
pub async fn pty_close(id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some((_, session)) = state.sessions.remove(&id) {
        session.kill().map_err(|e| format!("Kill failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_path_in_file_manager(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || open_path_in_file_manager_inner(&path))
        .await
        .map_err(|e| format!("Open path failed: {e}"))?
}

#[tauri::command]
pub async fn git_worktree_status(cwd: String) -> Result<Option<GitWorktreeStatus>, String> {
    tokio::task::spawn_blocking(move || git_worktree_status_inner(&cwd))
        .await
        .map_err(|e| format!("Git status failed: {e}"))?
}

/// Save clipboard image bytes to a unique temp file and return its path.
#[tauri::command]
pub async fn save_temp_image(name: String, data: Vec<u8>) -> Result<String, String> {
    use std::fs::File;
    use std::io::Write;
    use uuid::Uuid;

    let temp_dir = std::env::temp_dir();
    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("png");

    let unique_name = format!("xuya_{}.{}", Uuid::new_v4(), extension);
    let file_path = temp_dir.join(unique_name);

    let mut file =
        File::create(&file_path).map_err(|e| format!("Failed to create temp file: {e}"))?;
    file.write_all(&data)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;

    let path_str = file_path
        .to_str()
        .ok_or_else(|| "Failed to convert path to UTF-8 string".to_string())?
        .to_string();

    Ok(path_str)
}

/// Return true when the native Windows clipboard currently exposes image data.
#[tauri::command]
pub async fn clipboard_has_image() -> Result<bool, String> {
    Ok(native_clipboard_has_image())
}

#[tauri::command]
pub async fn find_latest_agent_session(
    agent_command: String,
    cwd: Option<String>,
    since_ms: u64,
    exclude_ids: Vec<String>,
) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let exclude_ids = exclude_ids.into_iter().collect::<HashSet<_>>();
        find_latest_agent_session_inner(&agent_command, cwd.as_deref(), since_ms, &exclude_ids)
    })
    .await
    .map_err(|e| format!("Session lookup failed: {e}"))?
}

#[tauri::command]
pub async fn agent_session_usage(
    agent_command: String,
    cwd: Option<String>,
    session_id: Option<String>,
) -> Result<Option<AgentSessionUsage>, String> {
    tokio::task::spawn_blocking(move || {
        agent_session_usage_inner(&agent_command, cwd.as_deref(), session_id.as_deref())
    })
    .await
    .map_err(|e| format!("Session usage lookup failed: {e}"))?
}

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
    .or_else(|| provided_auth_api_key.clone())
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
            .or(provided_auth_api_key)
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

fn find_latest_agent_session_inner(
    agent_command: &str,
    cwd: Option<&str>,
    since_ms: u64,
    exclude_ids: &HashSet<String>,
) -> Result<Option<String>, String> {
    let since = system_time_from_millis(since_ms).unwrap_or(UNIX_EPOCH);
    let since = since
        .checked_sub(Duration::from_secs(15))
        .unwrap_or(UNIX_EPOCH);

    match agent_command {
        "claude" => latest_claude_session(cwd, since, exclude_ids),
        "codex" => latest_codex_session(cwd, since, exclude_ids),
        "opencode" => latest_opencode_session(cwd, since, exclude_ids),
        _ => Ok(None),
    }
}

fn latest_claude_session(
    cwd: Option<&str>,
    since: SystemTime,
    exclude_ids: &HashSet<String>,
) -> Result<Option<String>, String> {
    let home = match home_dir() {
        Some(path) => path,
        None => return Ok(None),
    };
    let project_dir = cwd
        .map(claude_project_key)
        .map(|key| home.join(".claude").join("projects").join(key))
        .unwrap_or_else(|| home.join(".claude").join("projects"));

    let files = collect_files(&project_dir, "jsonl")?;
    let mut best: Option<(SystemTime, String)> = None;
    for file in files {
        let modified = match file_modified(&file) {
            Some(time) if time >= since => time,
            _ => continue,
        };
        let session_id = file
            .file_stem()
            .and_then(|name| name.to_str())
            .map(str::to_string);
        let Some(session_id) = session_id else {
            continue;
        };
        if exclude_ids.contains(&session_id) {
            continue;
        }
        if best.as_ref().map_or(true, |(time, _)| modified > *time) {
            best = Some((modified, session_id));
        }
    }

    Ok(best.map(|(_, id)| id))
}

fn latest_codex_session(
    cwd: Option<&str>,
    since: SystemTime,
    exclude_ids: &HashSet<String>,
) -> Result<Option<String>, String> {
    let home = match home_dir() {
        Some(path) => path,
        None => return Ok(None),
    };
    let sessions_dir = home.join(".codex").join("sessions");
    let target_cwd = cwd.map(normalize_path_text);
    let files = collect_files(&sessions_dir, "jsonl")?;
    let mut best: Option<(SystemTime, String)> = None;

    for file in files {
        let modified = match file_modified(&file) {
            Some(time) if time >= since => time,
            _ => continue,
        };
        let Some(meta) = read_first_json_line(&file) else {
            continue;
        };
        if meta.get("type").and_then(Value::as_str) != Some("session_meta") {
            continue;
        }
        let payload = &meta["payload"];
        if let Some(target) = &target_cwd {
            let Some(session_cwd) = payload.get("cwd").and_then(Value::as_str) else {
                continue;
            };
            if normalize_path_text(session_cwd) != *target {
                continue;
            }
        }
        let Some(session_id) = payload.get("id").and_then(Value::as_str) else {
            continue;
        };
        if exclude_ids.contains(session_id) {
            continue;
        }
        if best.as_ref().map_or(true, |(time, _)| modified > *time) {
            best = Some((modified, session_id.to_string()));
        }
    }

    Ok(best.map(|(_, id)| id))
}

fn latest_opencode_session(
    _cwd: Option<&str>,
    since: SystemTime,
    exclude_ids: &HashSet<String>,
) -> Result<Option<String>, String> {
    let home = match home_dir() {
        Some(path) => path,
        None => return Ok(None),
    };
    let diff_dir = home
        .join(".local")
        .join("share")
        .join("opencode")
        .join("storage")
        .join("session_diff");
    let files = collect_files(&diff_dir, "json")?;
    let mut best: Option<(SystemTime, String)> = None;

    for file in files {
        let modified = match file_modified(&file) {
            Some(time) if time >= since => time,
            _ => continue,
        };
        let Some(session_id) = file.file_stem().and_then(|name| name.to_str()) else {
            continue;
        };
        if exclude_ids.contains(session_id) {
            continue;
        }
        if best.as_ref().map_or(true, |(time, _)| modified > *time) {
            best = Some((modified, session_id.to_string()));
        }
    }

    Ok(best.map(|(_, id)| id))
}

fn collect_files(root: &Path, extension: &str) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    collect_files_inner(root, extension, &mut files)?;
    Ok(files)
}

fn collect_files_inner(
    root: &Path,
    extension: &str,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("Failed to read {}: {e}", root.display())),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files_inner(&path, extension, files)?;
        } else if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
        {
            files.push(path);
        }
    }

    Ok(())
}

fn read_first_json_line(path: &Path) -> Option<Value> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    serde_json::from_str(line.trim()).ok()
}

fn agent_session_usage_inner(
    agent_command: &str,
    cwd: Option<&str>,
    session_id: Option<&str>,
) -> Result<Option<AgentSessionUsage>, String> {
    match agent_command.trim() {
        "claude" => {
            let Some(path) = claude_session_file(cwd, session_id)? else {
                return Ok(None);
            };
            parse_claude_session_usage(&path, session_id)
        }
        "codex" => {
            let Some(path) = codex_session_file(cwd, session_id)? else {
                return Ok(None);
            };
            parse_codex_session_usage(&path, session_id)
        }
        "opencode" => {
            let Some(path) = opencode_session_file(session_id)? else {
                return Ok(None);
            };
            parse_opencode_session_usage(&path, session_id)
        }
        _ => Ok(None),
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct TokenUsageNumbers {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_creation_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    total_tokens: Option<u64>,
    context_tokens: Option<u64>,
    context_window: Option<u64>,
}

impl TokenUsageNumbers {
    fn has_any(self) -> bool {
        self.input_tokens.is_some()
            || self.output_tokens.is_some()
            || self.cache_read_tokens.is_some()
            || self.cache_creation_tokens.is_some()
            || self.reasoning_tokens.is_some()
            || self.total_tokens.is_some()
            || self.context_tokens.is_some()
            || self.context_window.is_some()
    }

    fn total(self) -> Option<u64> {
        self.total_tokens.or_else(|| {
            sum_present(&[
                self.input_tokens,
                self.output_tokens,
                self.cache_read_tokens,
                self.cache_creation_tokens,
                self.reasoning_tokens,
            ])
        })
    }

    fn context(self) -> Option<u64> {
        self.context_tokens.or_else(|| {
            sum_present(&[
                self.input_tokens,
                self.cache_read_tokens,
                self.cache_creation_tokens,
            ])
        })
    }
}

#[derive(Debug, Clone, Default)]
struct TokenUsageAggregate {
    input_tokens: u64,
    has_input_tokens: bool,
    output_tokens: u64,
    has_output_tokens: bool,
    cache_read_tokens: u64,
    has_cache_read_tokens: bool,
    cache_creation_tokens: u64,
    has_cache_creation_tokens: bool,
    reasoning_tokens: u64,
    has_reasoning_tokens: bool,
    total_tokens: u64,
    has_total_tokens: bool,
}

impl TokenUsageAggregate {
    fn from_usage(usage: TokenUsageNumbers) -> Self {
        let mut aggregate = Self::default();
        aggregate.add_usage(usage);
        aggregate
    }

    fn add_usage(&mut self, usage: TokenUsageNumbers) {
        add_optional_u64(
            &mut self.input_tokens,
            &mut self.has_input_tokens,
            usage.input_tokens,
        );
        add_optional_u64(
            &mut self.output_tokens,
            &mut self.has_output_tokens,
            usage.output_tokens,
        );
        add_optional_u64(
            &mut self.cache_read_tokens,
            &mut self.has_cache_read_tokens,
            usage.cache_read_tokens,
        );
        add_optional_u64(
            &mut self.cache_creation_tokens,
            &mut self.has_cache_creation_tokens,
            usage.cache_creation_tokens,
        );
        add_optional_u64(
            &mut self.reasoning_tokens,
            &mut self.has_reasoning_tokens,
            usage.reasoning_tokens,
        );
        add_optional_u64(
            &mut self.total_tokens,
            &mut self.has_total_tokens,
            usage.total(),
        );
    }

    fn has_any(&self) -> bool {
        self.has_input_tokens
            || self.has_output_tokens
            || self.has_cache_read_tokens
            || self.has_cache_creation_tokens
            || self.has_reasoning_tokens
            || self.has_total_tokens
    }
}

fn claude_session_file(
    cwd: Option<&str>,
    session_id: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let home = match home_dir() {
        Some(path) => path,
        None => return Ok(None),
    };
    let projects_dir = home.join(".claude").join("projects");
    let project_dir = cwd
        .map(claude_project_key)
        .map(|key| projects_dir.join(key));

    if let Some(session_id) = clean_optional_text(session_id) {
        if let Some(project_dir) = &project_dir {
            let direct = project_dir.join(format!("{session_id}.jsonl"));
            if direct.exists() {
                return Ok(Some(direct));
            }
        }

        for file in collect_files(&projects_dir, "jsonl")? {
            if path_stem_eq(&file, &session_id) {
                return Ok(Some(file));
            }
        }
        return Ok(None);
    }

    latest_file_by_modified(project_dir.as_deref().unwrap_or(&projects_dir), "jsonl")
}

fn codex_session_file(
    cwd: Option<&str>,
    session_id: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let home = match home_dir() {
        Some(path) => path,
        None => return Ok(None),
    };
    let sessions_dir = home.join(".codex").join("sessions");
    let files = collect_files(&sessions_dir, "jsonl")?;

    if let Some(session_id) = clean_optional_text(session_id) {
        for file in files {
            if path_stem_eq(&file, &session_id) {
                return Ok(Some(file));
            }
            if codex_file_session_meta(&file)
                .as_ref()
                .is_some_and(|(id, _)| id == &session_id)
            {
                return Ok(Some(file));
            }
        }
        return Ok(None);
    }

    let target_cwd = cwd.map(normalize_path_text);
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for file in files {
        let Some(modified) = file_modified(&file) else {
            continue;
        };
        if let Some(target) = &target_cwd {
            let Some((_, session_cwd)) = codex_file_session_meta(&file) else {
                continue;
            };
            let Some(session_cwd) = session_cwd else {
                continue;
            };
            if normalize_path_text(&session_cwd) != *target {
                continue;
            }
        }
        if best.as_ref().map_or(true, |(time, _)| modified > *time) {
            best = Some((modified, file));
        }
    }

    Ok(best.map(|(_, path)| path))
}

fn opencode_session_file(session_id: Option<&str>) -> Result<Option<PathBuf>, String> {
    let home = match home_dir() {
        Some(path) => path,
        None => return Ok(None),
    };
    let diff_dir = home
        .join(".local")
        .join("share")
        .join("opencode")
        .join("storage")
        .join("session_diff");

    if let Some(session_id) = clean_optional_text(session_id) {
        let direct = diff_dir.join(format!("{session_id}.json"));
        if direct.exists() {
            return Ok(Some(direct));
        }
        for file in collect_files(&diff_dir, "json")? {
            if path_stem_eq(&file, &session_id) {
                return Ok(Some(file));
            }
        }
        return Ok(None);
    }

    latest_file_by_modified(&diff_dir, "json")
}

fn parse_claude_session_usage(
    path: &Path,
    session_id: Option<&str>,
) -> Result<Option<AgentSessionUsage>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let reader = BufReader::new(file);
    let mut aggregate = TokenUsageAggregate::default();
    let mut latest_context_tokens = None;
    let mut context_window = None;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if let Some(usage) = first_usage_at_paths(&value, &[&["message", "usage"], &["usage"]]) {
            latest_context_tokens = usage.context().or(latest_context_tokens);
            context_window = usage.context_window.or(context_window);
            aggregate.add_usage(usage);
        }
    }

    Ok(build_agent_session_usage(
        "claude",
        path,
        session_id,
        "claude-jsonl",
        aggregate,
        latest_context_tokens,
        context_window,
    ))
}

fn parse_codex_session_usage(
    path: &Path,
    session_id: Option<&str>,
) -> Result<Option<AgentSessionUsage>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let reader = BufReader::new(file);
    let mut cumulative: Option<TokenUsageAggregate> = None;
    let mut summed = TokenUsageAggregate::default();
    let mut latest_context_tokens = None;
    let mut context_window = None;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if let Some(window) = first_token_number_at_paths(
            &value,
            &[
                &["payload", "info", "model_context_window"],
                &["payload", "info", "modelContextWindow"],
                &["payload", "model_context_window"],
                &["payload", "modelContextWindow"],
                &["model_context_window"],
                &["modelContextWindow"],
                &["context_window"],
                &["contextWindow"],
            ],
        ) {
            context_window = Some(window);
        }

        if let Some(total_usage) = first_usage_at_paths(
            &value,
            &[
                &["payload", "info", "total_token_usage"],
                &["payload", "info", "totalTokenUsage"],
                &["payload", "total_token_usage"],
                &["payload", "totalTokenUsage"],
                &["total_token_usage"],
                &["totalTokenUsage"],
            ],
        ) {
            context_window = total_usage.context_window.or(context_window);
            cumulative = Some(TokenUsageAggregate::from_usage(total_usage));
        }

        if let Some(last_usage) = first_usage_at_paths(
            &value,
            &[
                &["payload", "info", "last_token_usage"],
                &["payload", "info", "lastTokenUsage"],
                &["payload", "last_token_usage"],
                &["payload", "lastTokenUsage"],
                &["last_token_usage"],
                &["lastTokenUsage"],
            ],
        ) {
            latest_context_tokens = last_usage.context().or(latest_context_tokens);
            context_window = last_usage.context_window.or(context_window);
        }

        if let Some(usage) = first_usage_at_paths(
            &value,
            &[
                &["payload", "response", "usage"],
                &["payload", "event", "usage"],
                &["payload", "message", "usage"],
                &["payload", "usage"],
                &["response", "usage"],
                &["event", "usage"],
                &["message", "usage"],
                &["usage"],
            ],
        ) {
            latest_context_tokens = usage.context().or(latest_context_tokens);
            context_window = usage.context_window.or(context_window);
            if cumulative.is_none() {
                summed.add_usage(usage);
            }
        }
    }

    Ok(build_agent_session_usage(
        "codex",
        path,
        session_id,
        "codex-jsonl",
        cumulative.unwrap_or(summed),
        latest_context_tokens,
        context_window,
    ))
}

fn parse_opencode_session_usage(
    path: &Path,
    session_id: Option<&str>,
) -> Result<Option<AgentSessionUsage>, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;
    let mut aggregate = TokenUsageAggregate::default();
    let mut latest_context_tokens = None;
    let mut context_window = None;
    collect_json_usage_values(
        &value,
        &mut aggregate,
        &mut latest_context_tokens,
        &mut context_window,
    );

    Ok(build_agent_session_usage(
        "opencode",
        path,
        session_id,
        "opencode-json",
        aggregate,
        latest_context_tokens,
        context_window,
    ))
}

fn collect_json_usage_values(
    value: &Value,
    aggregate: &mut TokenUsageAggregate,
    latest_context_tokens: &mut Option<u64>,
    context_window: &mut Option<u64>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_json_usage_values(item, aggregate, latest_context_tokens, context_window);
            }
        }
        Value::Object(_) => {
            if let Some(usage) = first_usage_at_paths(
                value,
                &[
                    &["usage"],
                    &["tokenUsage"],
                    &["tokens"],
                    &["response", "usage"],
                    &["message", "usage"],
                    &["cost", "usage"],
                    &["info", "usage"],
                ],
            ) {
                *latest_context_tokens = usage.context().or(*latest_context_tokens);
                *context_window = usage.context_window.or(*context_window);
                aggregate.add_usage(usage);
            }
            if let Some(items) = value.as_object() {
                for child in items.values() {
                    collect_json_usage_values(
                        child,
                        aggregate,
                        latest_context_tokens,
                        context_window,
                    );
                }
            }
        }
        _ => {}
    }
}

fn build_agent_session_usage(
    agent: &str,
    path: &Path,
    session_id: Option<&str>,
    source: &str,
    aggregate: TokenUsageAggregate,
    context_tokens: Option<u64>,
    context_window: Option<u64>,
) -> Option<AgentSessionUsage> {
    if !aggregate.has_any() && context_tokens.is_none() && context_window.is_none() {
        return None;
    }

    Some(AgentSessionUsage {
        agent: agent.to_string(),
        session_id: clean_optional_text(session_id).or_else(|| file_stem(path)),
        source: source.to_string(),
        context_tokens,
        total_tokens: aggregate.has_total_tokens.then_some(aggregate.total_tokens),
        input_tokens: aggregate.has_input_tokens.then_some(aggregate.input_tokens),
        output_tokens: aggregate
            .has_output_tokens
            .then_some(aggregate.output_tokens),
        cache_read_tokens: aggregate
            .has_cache_read_tokens
            .then_some(aggregate.cache_read_tokens),
        cache_creation_tokens: aggregate
            .has_cache_creation_tokens
            .then_some(aggregate.cache_creation_tokens),
        reasoning_tokens: aggregate
            .has_reasoning_tokens
            .then_some(aggregate.reasoning_tokens),
        context_window,
        updated_at: file_modified(path).and_then(system_time_to_millis),
    })
}

fn codex_file_session_meta(path: &Path) -> Option<(String, Option<String>)> {
    let meta = read_first_json_line(path)?;
    if meta.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let payload = &meta["payload"];
    let id = payload.get("id").and_then(Value::as_str)?.to_string();
    let cwd = payload
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some((id, cwd))
}

fn latest_file_by_modified(root: &Path, extension: &str) -> Result<Option<PathBuf>, String> {
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for file in collect_files(root, extension)? {
        let Some(modified) = file_modified(&file) else {
            continue;
        };
        if best.as_ref().map_or(true, |(time, _)| modified > *time) {
            best = Some((modified, file));
        }
    }
    Ok(best.map(|(_, path)| path))
}

fn first_usage_at_paths(value: &Value, paths: &[&[&str]]) -> Option<TokenUsageNumbers> {
    paths.iter().find_map(|path| {
        let usage = value_path(value, path)?;
        let usage = token_usage_numbers(usage)?;
        usage.has_any().then_some(usage)
    })
}

fn first_token_number_at_paths(value: &Value, paths: &[&[&str]]) -> Option<u64> {
    paths
        .iter()
        .find_map(|path| token_number_path_u64(value, path))
}

fn token_usage_numbers(value: &Value) -> Option<TokenUsageNumbers> {
    let input_tokens = first_token_number_key(
        value,
        &[
            "input_tokens",
            "prompt_tokens",
            "inputTokens",
            "promptTokens",
        ],
    );
    let output_tokens = first_token_number_key(
        value,
        &[
            "output_tokens",
            "completion_tokens",
            "outputTokens",
            "completionTokens",
        ],
    );
    let cache_read_tokens = first_token_number_key(
        value,
        &[
            "cache_read_input_tokens",
            "cached_input_tokens",
            "cacheReadInputTokens",
            "cachedInputTokens",
            "cacheReadTokens",
            "cachedTokens",
        ],
    )
    .or_else(|| token_number_path_u64(value, &["input_token_details", "cached_tokens"]))
    .or_else(|| token_number_path_u64(value, &["inputTokenDetails", "cachedTokens"]))
    .or_else(|| token_number_path_u64(value, &["prompt_tokens_details", "cached_tokens"]))
    .or_else(|| token_number_path_u64(value, &["promptTokensDetails", "cachedTokens"]));
    let cache_creation_tokens = first_token_number_key(
        value,
        &[
            "cache_creation_input_tokens",
            "cacheCreationInputTokens",
            "cacheCreationTokens",
        ],
    );
    let reasoning_tokens = first_token_number_key(
        value,
        &[
            "reasoning_tokens",
            "reasoning_output_tokens",
            "reasoningTokens",
            "reasoningOutputTokens",
        ],
    )
    .or_else(|| token_number_path_u64(value, &["output_tokens_details", "reasoning_tokens"]))
    .or_else(|| token_number_path_u64(value, &["outputTokenDetails", "reasoningTokens"]))
    .or_else(|| token_number_path_u64(value, &["completion_tokens_details", "reasoning_tokens"]))
    .or_else(|| token_number_path_u64(value, &["completionTokensDetails", "reasoningTokens"]));
    let total_tokens = first_token_number_key(
        value,
        &["total_tokens", "totalTokens", "tokens_total", "tokensTotal"],
    );
    let context_tokens = first_token_number_key(
        value,
        &[
            "context_tokens",
            "contextTokens",
            "context_length",
            "contextLength",
            "prompt_context_tokens",
            "promptContextTokens",
        ],
    );
    let context_window = first_token_number_key(
        value,
        &[
            "context_window",
            "contextWindow",
            "model_context_window",
            "modelContextWindow",
        ],
    );
    let usage = TokenUsageNumbers {
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
        reasoning_tokens,
        total_tokens,
        context_tokens,
        context_window,
    };
    usage.has_any().then_some(usage)
}

fn first_token_number_key(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(token_value_to_u64))
}

fn token_number_path_u64(value: &Value, path: &[&str]) -> Option<u64> {
    value_path(value, path).and_then(token_value_to_u64)
}

fn token_value_to_u64(value: &Value) -> Option<u64> {
    if let Some(number) = value.as_u64() {
        return Some(number);
    }
    if let Some(number) = value.as_i64() {
        return (number >= 0).then_some(number as u64);
    }
    if let Some(number) = value.as_f64() {
        return (number.is_finite() && number >= 0.0).then_some(number.round() as u64);
    }
    let text = value.as_str()?.trim().replace(',', "");
    text.parse::<u64>().ok()
}

fn sum_present(values: &[Option<u64>]) -> Option<u64> {
    let mut total = 0_u64;
    let mut has_value = false;
    for value in values.iter().flatten() {
        total = total.saturating_add(*value);
        has_value = true;
    }
    has_value.then_some(total)
}

fn add_optional_u64(total: &mut u64, has_value: &mut bool, value: Option<u64>) {
    if let Some(value) = value {
        *total = total.saturating_add(value);
        *has_value = true;
    }
}

fn path_stem_eq(path: &Path, expected: &str) -> bool {
    path.file_stem()
        .and_then(|name| name.to_str())
        .is_some_and(|stem| stem == expected)
}

fn file_stem(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(str::to_string)
}

fn file_modified(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

fn claude_settings_path(home: &Path) -> PathBuf {
    home.join(".claude").join("settings.json")
}

fn codex_config_path(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}

fn codex_auth_path(home: &Path) -> PathBuf {
    home.join(".codex").join("auth.json")
}

fn claude_providers_path(home: &Path) -> PathBuf {
    home.join(".claude").join("xuya-providers.json")
}

fn codex_providers_path(home: &Path) -> PathBuf {
    home.join(".codex").join("xuya-providers.json")
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

fn read_custom_provider_store(home: &Path, tool: &str) -> Result<AgentCustomProviderStore, String> {
    let conn = open_agent_provider_db(home)?;
    migrate_legacy_provider_store(home, tool, &conn)?;

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

fn migrate_legacy_provider_store(home: &Path, tool: &str, conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_providers WHERE tool = ?1",
            params![tool],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to inspect provider database: {e}"))?;
    if count > 0 {
        return Ok(());
    }

    let legacy_path = match tool {
        "claude" => claude_providers_path(home),
        "codex" => codex_providers_path(home),
        _ => return Ok(()),
    };
    if !legacy_path.exists() {
        return Ok(());
    }

    let text = fs::read_to_string(&legacy_path)
        .map_err(|e| format!("Failed to read {}: {e}", legacy_path.display()))?;
    if text.trim().is_empty() {
        return Ok(());
    }
    let store = serde_json::from_str::<AgentCustomProviderStore>(&text)
        .map_err(|e| format!("Failed to parse {}: {e}", legacy_path.display()))?;
    for provider in store.providers {
        conn.execute(
            "INSERT OR IGNORE INTO agent_providers (
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
        .map_err(|e| format!("Failed to migrate custom provider: {e}"))?;
    }
    Ok(())
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
    let candidates = build_models_url_candidates(base_url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(MODEL_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;
    let mut last_err: Option<String> = None;

    for url in candidates {
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

        let body = truncate_model_fetch_body(response.text().await.unwrap_or_default());
        if status == reqwest::StatusCode::NOT_FOUND
            || status == reqwest::StatusCode::METHOD_NOT_ALLOWED
        {
            last_err = Some(format!("HTTP {status}: {body}"));
            continue;
        }
        return Err(format!("HTTP {status}: {body}"));
    }

    Err(format!(
        "All model endpoints failed: {}",
        last_err.unwrap_or_else(|| "no candidates".to_string())
    ))
}

async fn fetch_agent_provider_quota_inner(
    request: AgentProviderQuotaRequest,
) -> Result<AgentProviderQuotaResult, String> {
    let lookup = tokio::task::spawn_blocking(move || resolve_agent_quota_lookup(request))
        .await
        .map_err(|e| format!("Quota provider lookup failed: {e}"))??;

    let Some(provider) = lookup.provider else {
        return Ok(AgentProviderQuotaResult {
            tool: lookup.tool,
            provider_id: lookup.provider_id,
            provider_name: lookup.provider_name,
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(AGENT_QUOTA_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let explicit_kind = normalize_quota_provider_type(provider.quota_provider_type.as_deref());
    let is_custom_provider = lookup
        .provider_id
        .starts_with(CUSTOM_PROVIDER_SELECTOR_PREFIX);
    let kind = if is_custom_provider {
        explicit_kind
    } else {
        explicit_kind.or_else(|| detect_agent_quota_provider(&provider.base_url))
    };
    let Some(kind) = kind else {
        let error = if is_custom_provider {
            "当前代理商未配置额度查询"
        } else {
            "当前代理商暂不支持自动额度查询"
        };
        return Ok(quota_error_result(
            &lookup.tool,
            &lookup.provider_id,
            &provider.name,
            None,
            false,
            error,
        ));
    };

    match kind.as_str() {
        "sub2api" => {
            fetch_sub2api_quota(&client, &lookup.tool, &lookup.provider_id, &provider).await
        }
        "newapi" => fetch_newapi_quota(&client, &lookup.tool, &lookup.provider_id, &provider).await,
        "balance" => {
            fetch_balance_provider_quota(&client, &lookup.tool, &lookup.provider_id, &provider)
                .await
        }
        "coding_plan" => {
            fetch_coding_plan_provider_quota(&client, &lookup.tool, &lookup.provider_id, &provider)
                .await
        }
        _ => Ok(quota_error_result(
            &lookup.tool,
            &lookup.provider_id,
            &provider.name,
            Some(kind),
            false,
            "不支持的额度查询类型",
        )),
    }
}

#[derive(Debug)]
struct AgentQuotaLookup {
    tool: String,
    provider_id: String,
    provider_name: String,
    provider: Option<AgentCustomProvider>,
}

fn resolve_agent_quota_lookup(
    request: AgentProviderQuotaRequest,
) -> Result<AgentQuotaLookup, String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    let tool = parse_agent_tool(&request.tool)?.to_string();
    let provider_id = clean_optional_text(Some(request.provider_id.as_str()))
        .ok_or_else(|| "Provider is required".to_string())?;
    if provider_id == "official" {
        return Ok(AgentQuotaLookup {
            tool,
            provider_id,
            provider_name: "官方".to_string(),
            provider: None,
        });
    }

    let custom_id = custom_provider_id_from_selector(&provider_id);
    let Some(custom_id) = custom_id else {
        let built_in_providers = read_builtin_provider_store(&home, &tool)?;
        let stored_built_in = built_in_providers
            .iter()
            .find(|provider| provider.id == provider_id);
        let custom_store = read_custom_provider_store(&home, &tool)?;
        let tool_state = if tool == "claude" {
            read_claude_config_state(
                &claude_settings_path(&home),
                &custom_store.providers,
                &built_in_providers,
            )
        } else {
            read_codex_config_state(
                &codex_config_path(&home),
                &codex_auth_path(&home),
                &custom_store.providers,
                &built_in_providers,
            )
        };
        let is_current = tool_state
            .active_provider
            .as_deref()
            .is_some_and(|active| active == provider_id);
        let base_url = stored_built_in
            .and_then(|provider| clean_optional_text(Some(provider.base_url.as_str())))
            .or_else(|| {
                is_current
                    .then(|| tool_state.base_url.clone())
                    .flatten()
                    .and_then(|value| clean_optional_text(Some(value.as_str())))
            })
            .or_else(|| {
                if tool == "claude" {
                    claude_known_provider_base_url(&provider_id).map(str::to_string)
                } else {
                    None
                }
            });
        let api_key = stored_built_in
            .and_then(|provider| clean_agent_api_key(&tool, Some(provider.api_key.as_str())))
            .or_else(|| {
                is_current
                    .then(|| tool_state.api_key.clone())
                    .flatten()
                    .and_then(|value| clean_agent_api_key(&tool, Some(value.as_str())))
            })
            .unwrap_or_default();

        let Some(base_url) = base_url else {
            return Ok(AgentQuotaLookup {
                tool,
                provider_id: provider_id.clone(),
                provider_name: built_in_provider_display_name(&provider_id).to_string(),
                provider: None,
            });
        };

        let provider = AgentCustomProvider {
            id: provider_id.clone(),
            name: built_in_provider_display_name(&provider_id).to_string(),
            base_url,
            api_key,
            model: None,
            haiku_model: None,
            haiku_model_name: None,
            sonnet_model: None,
            sonnet_model_name: None,
            opus_model: None,
            opus_model_name: None,
            extra_config: None,
            quota_provider_type: None,
            quota_base_url: None,
            quota_api_key: None,
            quota_access_token: None,
            quota_user_id: None,
        };

        return Ok(AgentQuotaLookup {
            tool,
            provider_id,
            provider_name: provider.name.clone(),
            provider: Some(provider),
        });
    };

    let store = read_custom_provider_store(&home, &tool)?;
    let provider = store
        .providers
        .into_iter()
        .find(|provider| provider.id == custom_id)
        .ok_or_else(|| "自定义代理商不存在".to_string())?;
    Ok(AgentQuotaLookup {
        tool,
        provider_id: format!("{CUSTOM_PROVIDER_SELECTOR_PREFIX}{}", provider.id),
        provider_name: provider.name.clone(),
        provider: Some(provider),
    })
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
        return Ok(quota_error_result(
            tool,
            provider_id,
            &provider.name,
            kind,
            false,
            "Sub2API 额度 Key 未配置",
        ));
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
        return Ok(quota_error_result(
            tool,
            provider_id,
            &provider.name,
            kind,
            true,
            &format!("HTTP {status}: {}", truncate_model_fetch_body(body)),
        ));
    }

    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Sub2API quota response: {e}"))?;
    let remaining = value_number_path(&json, &["remaining"])
        .or_else(|| value_number_path(&json, &["quota", "remaining"]))
        .or_else(|| value_number_path(&json, &["balance"]));
    let used = value_number_path(&json, &["quota", "used"])
        .or_else(|| value_number_path(&json, &["usage", "total", "cost"]))
        .or_else(|| value_number_path(&json, &["subscription", "monthly_usage_usd"]))
        .or_else(|| value_number_path(&json, &["subscription", "weekly_usage_usd"]))
        .or_else(|| value_number_path(&json, &["subscription", "daily_usage_usd"]));
    let total = value_number_path(&json, &["quota", "limit"])
        .or_else(|| value_number_path(&json, &["subscription", "monthly_limit_usd"]))
        .or_else(|| value_number_path(&json, &["subscription", "weekly_limit_usd"]))
        .or_else(|| value_number_path(&json, &["subscription", "daily_limit_usd"]))
        .or_else(|| {
            used.zip(remaining)
                .map(|(used, remaining)| used + remaining)
        });
    let unit = value_string_path(&json, &["unit"])
        .or_else(|| value_string_path(&json, &["quota", "unit"]))
        .unwrap_or_else(|| "USD".to_string());
    let plan_name = value_string_path(&json, &["planName"])
        .or_else(|| value_string_path(&json, &["mode"]))
        .or_else(|| value_string_path(&json, &["status"]));
    let tiers = sub2api_quota_tiers(&json, &unit);

    Ok(AgentProviderQuotaResult {
        tool: tool.to_string(),
        provider_id: provider_id.to_string(),
        provider_name: provider.name.clone(),
        quota_provider_type: kind,
        configured: true,
        success: true,
        plan_name,
        total,
        used,
        remaining,
        unit: Some(unit),
        tiers,
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
        return Ok(quota_error_result(
            tool,
            provider_id,
            &provider.name,
            kind,
            false,
            "New API 额度 Token 或用户 ID 未配置",
        ));
    };
    let url = newapi_user_self_url(&base_url)?;
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
        return Ok(quota_error_result(
            tool,
            provider_id,
            &provider.name,
            kind,
            true,
            &format!("HTTP {status}: {}", truncate_model_fetch_body(body)),
        ));
    }

    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse New API quota response: {e}"))?;
    if value_bool_path(&json, &["success"]) == Some(false) {
        let message = value_string_path(&json, &["message"])
            .or_else(|| value_string_path(&json, &["error"]))
            .unwrap_or_else(|| "New API 返回失败".to_string());
        return Ok(quota_error_result(
            tool,
            provider_id,
            &provider.name,
            kind,
            true,
            &message,
        ));
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

async fn fetch_balance_provider_quota(
    client: &reqwest::Client,
    tool: &str,
    provider_id: &str,
    provider: &AgentCustomProvider,
) -> Result<AgentProviderQuotaResult, String> {
    let api_key = clean_optional_text(Some(provider.api_key.as_str()));
    let Some(api_key) = api_key else {
        return Ok(quota_error_result(
            tool,
            provider_id,
            &provider.name,
            Some("balance".to_string()),
            false,
            "API Key 未配置",
        ));
    };
    let url = provider.base_url.to_ascii_lowercase();

    if url.contains("api.deepseek.com") {
        let json = match quota_json_get(
            client,
            "https://api.deepseek.com/user/balance",
            vec![("Authorization", format!("Bearer {api_key}"))],
        )
        .await
        {
            Ok(json) => json,
            Err(error) => {
                return Ok(quota_error_result(
                    tool,
                    provider_id,
                    &provider.name,
                    Some("balance".to_string()),
                    true,
                    &error,
                ))
            }
        };
        let info = json
            .get("balance_infos")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first());
        let remaining = info.and_then(|item| value_number_path(item, &["total_balance"]));
        let unit = info
            .and_then(|item| value_string_path(item, &["currency"]))
            .unwrap_or_else(|| "CNY".to_string());
        return Ok(quota_success_result(
            tool,
            provider_id,
            &provider.name,
            Some("balance".to_string()),
            Some("DeepSeek".to_string()),
            None,
            None,
            remaining,
            Some(unit),
        ));
    }

    if url.contains("api.stepfun.ai") || url.contains("api.stepfun.com") {
        let json = match quota_json_get(
            client,
            "https://api.stepfun.com/v1/accounts",
            vec![("Authorization", format!("Bearer {api_key}"))],
        )
        .await
        {
            Ok(json) => json,
            Err(error) => {
                return Ok(quota_error_result(
                    tool,
                    provider_id,
                    &provider.name,
                    Some("balance".to_string()),
                    true,
                    &error,
                ))
            }
        };
        return Ok(quota_success_result(
            tool,
            provider_id,
            &provider.name,
            Some("balance".to_string()),
            Some("StepFun".to_string()),
            None,
            None,
            value_number_path(&json, &["balance"]),
            Some("CNY".to_string()),
        ));
    }

    if url.contains("api.siliconflow.cn") || url.contains("api.siliconflow.com") {
        let is_cn = url.contains("api.siliconflow.cn");
        let endpoint = if is_cn {
            "https://api.siliconflow.cn/v1/user/info"
        } else {
            "https://api.siliconflow.com/v1/user/info"
        };
        let json = match quota_json_get(
            client,
            endpoint,
            vec![("Authorization", format!("Bearer {api_key}"))],
        )
        .await
        {
            Ok(json) => json,
            Err(error) => {
                return Ok(quota_error_result(
                    tool,
                    provider_id,
                    &provider.name,
                    Some("balance".to_string()),
                    true,
                    &error,
                ))
            }
        };
        return Ok(quota_success_result(
            tool,
            provider_id,
            &provider.name,
            Some("balance".to_string()),
            Some("SiliconFlow".to_string()),
            None,
            None,
            value_number_path(&json, &["data", "totalBalance"]),
            Some(if is_cn { "CNY" } else { "USD" }.to_string()),
        ));
    }

    if url.contains("openrouter.ai") {
        let json = match quota_json_get(
            client,
            "https://openrouter.ai/api/v1/credits",
            vec![("Authorization", format!("Bearer {api_key}"))],
        )
        .await
        {
            Ok(json) => json,
            Err(error) => {
                return Ok(quota_error_result(
                    tool,
                    provider_id,
                    &provider.name,
                    Some("balance".to_string()),
                    true,
                    &error,
                ))
            }
        };
        let total = value_number_path(&json, &["data", "total_credits"]);
        let used = value_number_path(&json, &["data", "total_usage"]);
        let remaining = total.zip(used).map(|(total, used)| total - used);
        return Ok(quota_success_result(
            tool,
            provider_id,
            &provider.name,
            Some("balance".to_string()),
            Some("OpenRouter".to_string()),
            total,
            used,
            remaining,
            Some("USD".to_string()),
        ));
    }

    if url.contains("api.novita.ai") {
        let json = match quota_json_get(
            client,
            "https://api.novita.ai/v3/user/balance",
            vec![("Authorization", format!("Bearer {api_key}"))],
        )
        .await
        {
            Ok(json) => json,
            Err(error) => {
                return Ok(quota_error_result(
                    tool,
                    provider_id,
                    &provider.name,
                    Some("balance".to_string()),
                    true,
                    &error,
                ))
            }
        };
        let remaining =
            value_number_path(&json, &["availableBalance"]).map(|value| value / 10000.0);
        return Ok(quota_success_result(
            tool,
            provider_id,
            &provider.name,
            Some("balance".to_string()),
            Some("Novita AI".to_string()),
            None,
            None,
            remaining,
            Some("USD".to_string()),
        ));
    }

    Ok(quota_error_result(
        tool,
        provider_id,
        &provider.name,
        Some("balance".to_string()),
        false,
        "未知余额查询代理商",
    ))
}

async fn fetch_coding_plan_provider_quota(
    client: &reqwest::Client,
    tool: &str,
    provider_id: &str,
    provider: &AgentCustomProvider,
) -> Result<AgentProviderQuotaResult, String> {
    let api_key = clean_optional_text(Some(provider.api_key.as_str()));
    let Some(api_key) = api_key else {
        return Ok(quota_error_result(
            tool,
            provider_id,
            &provider.name,
            Some("coding_plan".to_string()),
            false,
            "API Key 未配置",
        ));
    };
    let url = provider.base_url.to_ascii_lowercase();

    if url.contains("api.kimi.com/coding") {
        let json = match quota_json_get(
            client,
            "https://api.kimi.com/coding/v1/usages",
            vec![("Authorization", format!("Bearer {api_key}"))],
        )
        .await
        {
            Ok(json) => json,
            Err(error) => {
                return Ok(quota_error_result(
                    tool,
                    provider_id,
                    &provider.name,
                    Some("coding_plan".to_string()),
                    true,
                    &error,
                ))
            }
        };
        let detail = json
            .get("limits")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .and_then(|item| item.get("detail"));
        let mut tiers = Vec::new();
        if let Some(detail) = detail {
            if let Some(tier) = quota_limit_remaining_percent_tier(
                "five_hour",
                value_number_path(detail, &["limit"]),
                value_number_path(detail, &["remaining"]),
                value_reset_time_path(detail, &["resetTime"]),
            ) {
                tiers.push(tier);
            }
        }
        if let Some(usage) = json.get("usage") {
            if let Some(tier) = quota_limit_remaining_percent_tier(
                "weekly_limit",
                value_number_path(usage, &["limit"]),
                value_number_path(usage, &["remaining"]),
                value_reset_time_path(usage, &["resetTime"]),
            ) {
                tiers.push(tier);
            }
        }
        return Ok(quota_success_result_with_tiers(
            tool,
            provider_id,
            &provider.name,
            Some("coding_plan".to_string()),
            Some("Kimi Coding".to_string()),
            tiers,
        ));
    }

    if url.contains("open.bigmodel.cn") || url.contains("bigmodel.cn") || url.contains("api.z.ai") {
        let json = match quota_json_get(
            client,
            "https://api.z.ai/api/monitor/usage/quota/limit",
            vec![
                ("Authorization", api_key),
                ("Content-Type", "application/json".to_string()),
                ("Accept-Language", "en-US,en".to_string()),
            ],
        )
        .await
        {
            Ok(json) => json,
            Err(error) => {
                return Ok(quota_error_result(
                    tool,
                    provider_id,
                    &provider.name,
                    Some("coding_plan".to_string()),
                    true,
                    &error,
                ))
            }
        };
        if value_bool_path(&json, &["success"]) == Some(false) {
            let message = value_string_path(&json, &["msg"])
                .unwrap_or_else(|| "智谱额度接口返回失败".to_string());
            return Ok(quota_error_result(
                tool,
                provider_id,
                &provider.name,
                Some("coding_plan".to_string()),
                true,
                &message,
            ));
        }
        let data = json.get("data").unwrap_or(&json);
        let mut token_limits = Vec::new();
        if let Some(limits) = data.get("limits").and_then(|value| value.as_array()) {
            for limit in limits {
                let Some(limit_type) = value_string_path(limit, &["type"]) else {
                    continue;
                };
                if !limit_type.eq_ignore_ascii_case("TOKENS_LIMIT") {
                    continue;
                }
                let Some(percentage) = value_number_path(limit, &["percentage"]) else {
                    continue;
                };
                token_limits.push((value_reset_time_path(limit, &["nextResetTime"]), percentage));
            }
        }
        token_limits.sort_by_key(|(reset, _)| (reset.is_some(), reset.clone()));
        let mut tiers = Vec::new();
        for (index, (reset, percentage)) in token_limits.into_iter().take(2).enumerate() {
            let name = if index == 0 {
                "five_hour"
            } else {
                "weekly_limit"
            };
            if let Some(tier) = quota_percent_tier(name, percentage, reset) {
                tiers.push(tier);
            }
        }
        return Ok(quota_success_result_with_tiers(
            tool,
            provider_id,
            &provider.name,
            Some("coding_plan".to_string()),
            value_string_path(data, &["level"]).or_else(|| Some("Zhipu GLM".to_string())),
            tiers,
        ));
    }

    if url.contains("api.minimaxi.com") || url.contains("api.minimax.io") {
        let endpoint = if url.contains("api.minimaxi.com") {
            "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains"
        } else {
            "https://api.minimax.io/v1/api/openplatform/coding_plan/remains"
        };
        let json = match quota_json_get(
            client,
            endpoint,
            vec![
                ("Authorization", format!("Bearer {api_key}")),
                ("Content-Type", "application/json".to_string()),
            ],
        )
        .await
        {
            Ok(json) => json,
            Err(error) => {
                return Ok(quota_error_result(
                    tool,
                    provider_id,
                    &provider.name,
                    Some("coding_plan".to_string()),
                    true,
                    &error,
                ))
            }
        };
        let general = json
            .get("model_remains")
            .and_then(|value| value.as_array())
            .and_then(|items| {
                items.iter().find(|item| {
                    value_string_path(item, &["model_name"]).is_some_and(|name| name == "general")
                })
            });
        let mut tiers = Vec::new();
        if let Some(general) = general {
            if let Some(remaining) =
                value_number_path(general, &["current_interval_remaining_percent"])
            {
                if let Some(tier) = quota_percent_remaining_tier(
                    "five_hour",
                    remaining,
                    value_reset_time_path(general, &["end_time"]),
                ) {
                    tiers.push(tier);
                }
            }
            let weekly_status =
                value_number_path(general, &["current_weekly_status"]).unwrap_or_default();
            if weekly_status == 1.0 {
                if let Some(remaining) =
                    value_number_path(general, &["current_weekly_remaining_percent"])
                {
                    if let Some(tier) = quota_percent_remaining_tier(
                        "weekly_limit",
                        remaining,
                        value_reset_time_path(general, &["weekly_end_time"]),
                    ) {
                        tiers.push(tier);
                    }
                }
            }
        }
        return Ok(quota_success_result_with_tiers(
            tool,
            provider_id,
            &provider.name,
            Some("coding_plan".to_string()),
            Some("MiniMax Coding".to_string()),
            tiers,
        ));
    }

    if url.contains("zenmux") {
        let json = match quota_json_get(
            client,
            provider.base_url.as_str(),
            vec![("Authorization", format!("Bearer {api_key}"))],
        )
        .await
        {
            Ok(json) => json,
            Err(error) => {
                return Ok(quota_error_result(
                    tool,
                    provider_id,
                    &provider.name,
                    Some("coding_plan".to_string()),
                    true,
                    &error,
                ))
            }
        };
        let data = json.get("data").unwrap_or(&json);
        let mut tiers = Vec::new();
        if let Some(quota) = data.get("quota_5_hour") {
            if let Some(tier) = zenmux_quota_tier("five_hour", quota) {
                tiers.push(tier);
            }
        }
        if let Some(quota) = data.get("quota_7_day") {
            if let Some(tier) = zenmux_quota_tier("weekly_limit", quota) {
                tiers.push(tier);
            }
        }
        let plan_name =
            value_string_path(data, &["plan", "tier"]).or_else(|| Some("ZenMux".to_string()));
        return Ok(quota_success_result_with_tiers(
            tool,
            provider_id,
            &provider.name,
            Some("coding_plan".to_string()),
            plan_name,
            tiers,
        ));
    }

    Ok(quota_error_result(
        tool,
        provider_id,
        &provider.name,
        Some("coding_plan".to_string()),
        false,
        "未知 Coding Plan 代理商",
    ))
}

fn quota_success_result(
    tool: &str,
    provider_id: &str,
    provider_name: &str,
    quota_provider_type: Option<String>,
    plan_name: Option<String>,
    total: Option<f64>,
    used: Option<f64>,
    remaining: Option<f64>,
    unit: Option<String>,
) -> AgentProviderQuotaResult {
    AgentProviderQuotaResult {
        tool: tool.to_string(),
        provider_id: provider_id.to_string(),
        provider_name: provider_name.to_string(),
        quota_provider_type,
        configured: true,
        success: true,
        plan_name,
        total,
        used,
        remaining,
        unit,
        tiers: Vec::new(),
        queried_at: current_unix_secs(),
        error: None,
    }
}

fn quota_success_result_with_tiers(
    tool: &str,
    provider_id: &str,
    provider_name: &str,
    quota_provider_type: Option<String>,
    plan_name: Option<String>,
    tiers: Vec<AgentProviderQuotaTier>,
) -> AgentProviderQuotaResult {
    let (total, used, remaining, unit) = quota_tier_fields(tiers.first());
    let mut result = quota_success_result(
        tool,
        provider_id,
        provider_name,
        quota_provider_type,
        plan_name,
        total,
        used,
        remaining,
        unit,
    );
    result.tiers = tiers;
    result
}

fn quota_tier_fields(
    tier: Option<&AgentProviderQuotaTier>,
) -> (Option<f64>, Option<f64>, Option<f64>, Option<String>) {
    let Some(tier) = tier else {
        return (None, None, None, None);
    };
    (tier.total, tier.used, tier.remaining, tier.unit.clone())
}

fn quota_percent_tier(
    name: &str,
    utilization: f64,
    resets_at: Option<String>,
) -> Option<AgentProviderQuotaTier> {
    let utilization = normalized_percent(utilization)?;
    Some(AgentProviderQuotaTier {
        name: name.to_string(),
        utilization: Some(utilization),
        total: Some(100.0),
        used: Some(utilization),
        remaining: Some((100.0 - utilization).max(0.0)),
        unit: Some("%".to_string()),
        resets_at,
    })
}

fn quota_percent_remaining_tier(
    name: &str,
    remaining: f64,
    resets_at: Option<String>,
) -> Option<AgentProviderQuotaTier> {
    let remaining = normalized_percent(remaining)?;
    Some(AgentProviderQuotaTier {
        name: name.to_string(),
        utilization: Some((100.0 - remaining).max(0.0)),
        total: Some(100.0),
        used: Some((100.0 - remaining).max(0.0)),
        remaining: Some(remaining),
        unit: Some("%".to_string()),
        resets_at,
    })
}

fn quota_limit_remaining_percent_tier(
    name: &str,
    limit: Option<f64>,
    remaining: Option<f64>,
    resets_at: Option<String>,
) -> Option<AgentProviderQuotaTier> {
    let limit = limit?;
    let remaining = remaining?;
    if !limit.is_finite() || !remaining.is_finite() || limit <= 0.0 {
        return None;
    }
    let utilization = ((limit - remaining).max(0.0) / limit) * 100.0;
    quota_percent_tier(name, utilization, resets_at)
}

fn quota_value_tier(
    name: &str,
    total: Option<f64>,
    used: Option<f64>,
    remaining: Option<f64>,
    unit: Option<String>,
    resets_at: Option<String>,
) -> Option<AgentProviderQuotaTier> {
    if total.is_none() && used.is_none() && remaining.is_none() {
        return None;
    }
    let utilization = total
        .zip(used)
        .and_then(|(total, used)| {
            (total.is_finite() && used.is_finite() && total > 0.0).then(|| (used / total) * 100.0)
        })
        .and_then(normalized_percent);
    Some(AgentProviderQuotaTier {
        name: name.to_string(),
        utilization,
        total,
        used,
        remaining,
        unit,
        resets_at,
    })
}

fn normalized_percent(value: f64) -> Option<f64> {
    if !value.is_finite() {
        return None;
    }
    Some(value.clamp(0.0, 100.0))
}

fn zenmux_quota_tier(name: &str, quota: &Value) -> Option<AgentProviderQuotaTier> {
    let resets_at = value_reset_time_path(quota, &["resets_at"]);
    let used = value_number_path(quota, &["used_value_usd"]);
    let total = value_number_path(quota, &["max_value_usd"]);
    if let (Some(used), Some(total)) = (used, total) {
        return quota_value_tier(
            name,
            Some(total),
            Some(used),
            Some((total - used).max(0.0)),
            Some("USD".to_string()),
            resets_at,
        );
    }
    value_number_path(quota, &["usage_percentage"])
        .and_then(|percentage| quota_percent_tier(name, percentage * 100.0, resets_at))
}

fn sub2api_quota_tiers(json: &Value, default_unit: &str) -> Vec<AgentProviderQuotaTier> {
    let mut tiers = Vec::new();
    if let Some(rate_limits) = json.get("rate_limits").and_then(|value| value.as_array()) {
        for rate_limit in rate_limits {
            let name = value_string_path(rate_limit, &["window"])
                .map(|window| sub2api_window_name(&window))
                .unwrap_or_else(|| "rate_limit".to_string());
            let total = value_number_path(rate_limit, &["limit"]);
            let used = value_number_path(rate_limit, &["used"]);
            let remaining = value_number_path(rate_limit, &["remaining"])
                .or_else(|| total.zip(used).map(|(total, used)| (total - used).max(0.0)));
            let unit =
                value_string_path(rate_limit, &["unit"]).or_else(|| Some(default_unit.to_string()));
            if let Some(tier) = quota_value_tier(
                &name,
                total,
                used,
                remaining,
                unit,
                value_reset_time_path(rate_limit, &["reset_at"]),
            ) {
                tiers.push(tier);
            }
        }
    }

    let has_weekly = tiers.iter().any(|tier| tier.name == "weekly_limit");
    let Some(subscription) = json.get("subscription") else {
        return tiers;
    };
    push_sub2api_subscription_tier(
        &mut tiers,
        "daily_limit",
        subscription,
        "daily_usage_usd",
        "daily_limit_usd",
        None,
    );
    if !has_weekly {
        push_sub2api_subscription_tier(
            &mut tiers,
            "weekly_limit",
            subscription,
            "weekly_usage_usd",
            "weekly_limit_usd",
            value_reset_time_path(subscription, &["weekly_window_resets_at"]),
        );
    }
    push_sub2api_subscription_tier(
        &mut tiers,
        "monthly_limit",
        subscription,
        "monthly_usage_usd",
        "monthly_limit_usd",
        None,
    );
    tiers
}

fn sub2api_window_name(window: &str) -> String {
    match window {
        "5h" => "five_hour".to_string(),
        "7d" => "weekly_limit".to_string(),
        "1d" => "daily_limit".to_string(),
        other => format!("rate_limit_{other}"),
    }
}

fn push_sub2api_subscription_tier(
    tiers: &mut Vec<AgentProviderQuotaTier>,
    name: &str,
    subscription: &Value,
    usage_key: &str,
    limit_key: &str,
    resets_at: Option<String>,
) {
    let used = value_number_path(subscription, &[usage_key]);
    let total = value_number_path(subscription, &[limit_key]);
    let remaining = total.zip(used).map(|(total, used)| (total - used).max(0.0));
    if let Some(tier) = quota_value_tier(
        name,
        total,
        used,
        remaining,
        Some("USD".to_string()),
        resets_at,
    ) {
        tiers.push(tier);
    }
}

fn quota_error_result(
    tool: &str,
    provider_id: &str,
    provider_name: &str,
    quota_provider_type: Option<String>,
    configured: bool,
    error: &str,
) -> AgentProviderQuotaResult {
    AgentProviderQuotaResult {
        tool: tool.to_string(),
        provider_id: provider_id.to_string(),
        provider_name: provider_name.to_string(),
        quota_provider_type,
        configured,
        success: false,
        plan_name: None,
        total: None,
        used: None,
        remaining: None,
        unit: None,
        tiers: Vec::new(),
        queried_at: current_unix_secs(),
        error: Some(error.to_string()),
    }
}

async fn quota_json_get(
    client: &reqwest::Client,
    url: &str,
    headers: Vec<(&'static str, String)>,
) -> Result<Value, String> {
    let mut request = client
        .get(url)
        .header("Accept", "application/json")
        .header("User-Agent", "XuYa Terminal");
    for (key, value) in headers {
        request = request.header(key, value);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Quota request failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "HTTP {status}: {}",
            truncate_model_fetch_body(body)
        ));
    }
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse quota response: {e}"))
}

fn detect_agent_quota_provider(base_url: &str) -> Option<String> {
    let url = base_url.to_ascii_lowercase();
    if url.contains("api.deepseek.com")
        || url.contains("api.stepfun.ai")
        || url.contains("api.stepfun.com")
        || url.contains("api.siliconflow.cn")
        || url.contains("api.siliconflow.com")
        || url.contains("openrouter.ai")
        || url.contains("api.novita.ai")
    {
        return Some("balance".to_string());
    }
    if url.contains("api.kimi.com/coding")
        || url.contains("open.bigmodel.cn")
        || url.contains("bigmodel.cn")
        || url.contains("api.z.ai")
        || url.contains("api.minimaxi.com")
        || url.contains("api.minimax.io")
        || url.contains("zenmux")
    {
        return Some("coding_plan".to_string());
    }
    None
}

fn built_in_provider_display_name(provider_id: &str) -> &str {
    match provider_id {
        "official" => "官方",
        "zhipu" => "ZhiPu GLM",
        "minimax" => "MiniMax",
        "kimi" => "Kimi",
        "deepseek" => "DeepSeek",
        "xiaomimimo" => "XiaoMi MiMo",
        other => other,
    }
}

fn sub2api_usage_url(base_url: &str) -> Result<String, String> {
    let mut base = clean_optional_text(Some(base_url))
        .ok_or_else(|| "Sub2API 额度地址未配置".to_string())?
        .trim_end_matches('/')
        .to_string();
    if base.to_ascii_lowercase().ends_with("/v1") {
        base = base[..base.len() - 3].trim_end_matches('/').to_string();
    }
    Ok(format!("{base}/v1/usage"))
}

fn newapi_user_self_url(base_url: &str) -> Result<String, String> {
    let mut base = clean_optional_text(Some(base_url))
        .ok_or_else(|| "New API 额度地址未配置".to_string())?
        .trim_end_matches('/')
        .to_string();
    for suffix in [
        "/api/user/self",
        "/v1/chat/completions",
        "/v1/responses",
        "/v1/messages",
        "/api/claudecode",
        "/api/anthropic",
        "/api/coding",
        "/apps/anthropic",
        "/claudecode",
        "/anthropic",
        "/coding",
        "/v1",
        "/api",
    ] {
        while let Some(stripped) = strip_suffix_ignore_ascii(&base, suffix) {
            base = stripped.trim_end_matches('/').to_string();
        }
    }
    Ok(format!("{base}/api/user/self"))
}

fn build_models_url_candidates(base_url: &str) -> Result<Vec<String>, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL is empty".to_string());
    }

    let mut candidates = Vec::new();
    if ends_with_version_segment(trimmed) {
        candidates.push(format!("{trimmed}/models"));
        if !trimmed.ends_with("/v1") {
            candidates.push(format!("{trimmed}/v1/models"));
        }
    } else {
        candidates.push(format!("{trimmed}/v1/models"));
    }

    if let Some(stripped) = strip_model_fetch_compat_suffix(trimmed) {
        let root = stripped.trim_end_matches('/');
        if !root.is_empty() && root.contains("://") {
            candidates.push(format!("{root}/v1/models"));
            candidates.push(format!("{root}/models"));
        }
    }

    let mut unique = Vec::with_capacity(candidates.len());
    for url in candidates {
        if !unique.iter().any(|item| item == &url) {
            unique.push(url);
        }
    }
    Ok(unique)
}

fn truncate_model_fetch_body(body: String) -> String {
    if body.chars().count() <= MODEL_FETCH_ERROR_BODY_MAX_CHARS {
        body
    } else {
        let mut output = body
            .chars()
            .take(MODEL_FETCH_ERROR_BODY_MAX_CHARS)
            .collect::<String>();
        output.push_str("...");
        output
    }
}

fn strip_model_fetch_compat_suffix(base_url: &str) -> Option<&str> {
    for suffix in MODEL_FETCH_COMPAT_SUFFIXES {
        if base_url.ends_with(*suffix) {
            return Some(&base_url[..base_url.len() - suffix.len()]);
        }
    }
    None
}

fn ends_with_version_segment(url: &str) -> bool {
    let last = url.rsplit('/').next().unwrap_or("");
    last.strip_prefix('v')
        .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
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

fn claude_known_provider_base_url(provider_id: &str) -> Option<&'static str> {
    CLAUDE_KNOWN_PROVIDERS
        .iter()
        .find(|(id, _)| *id == provider_id)
        .map(|(_, url)| *url)
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

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn system_time_from_millis(ms: u64) -> Option<SystemTime> {
    UNIX_EPOCH.checked_add(Duration::from_millis(ms))
}

fn system_time_to_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn normalize_path_text(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn open_path_in_file_manager_inner(path: &str) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(format!("Path does not exist: {}", target.display()));
    }

    let folder = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .ok_or_else(|| format!("Path has no parent folder: {}", target.display()))?
            .to_path_buf()
    };

    open_folder(&folder)
}

fn git_worktree_status_inner(cwd: &str) -> Result<Option<GitWorktreeStatus>, String> {
    let cwd = PathBuf::from(cwd);
    if !cwd.is_dir() {
        return Ok(None);
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("-b")
        .output()
        .map_err(|e| format!("Failed to run git status: {e}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    Ok(Some(parse_git_worktree_status(&text)))
}

fn parse_git_worktree_status(text: &str) -> GitWorktreeStatus {
    let mut branch = None;
    let mut staged = 0;
    let mut modified = 0;
    let mut deleted = 0;
    let mut untracked = 0;
    let mut conflicts = 0;

    for line in text.lines() {
        if let Some(next_branch) = parse_git_branch(line) {
            branch = Some(next_branch);
            continue;
        }

        let mut chars = line.chars();
        let index = chars.next().unwrap_or(' ');
        let worktree = chars.next().unwrap_or(' ');

        if matches!((index, worktree), ('?', '?')) {
            untracked += 1;
            continue;
        }
        if matches!((index, worktree), ('!', '!')) {
            continue;
        }
        if is_git_conflict_status(index, worktree) {
            conflicts += 1;
            continue;
        }

        if !matches!(index, ' ' | '?' | '!') {
            staged += 1;
        }
        if index == 'D' || worktree == 'D' {
            deleted += 1;
        } else if !matches!(worktree, ' ' | '?' | '!') {
            modified += 1;
        }
    }

    let clean = staged == 0 && modified == 0 && deleted == 0 && untracked == 0 && conflicts == 0;
    GitWorktreeStatus {
        branch,
        staged,
        modified,
        deleted,
        untracked,
        conflicts,
        clean,
    }
}

fn parse_git_branch(line: &str) -> Option<String> {
    let head = line.strip_prefix("## ")?.trim();
    let head = head
        .strip_prefix("No commits yet on ")
        .or_else(|| head.strip_prefix("Initial commit on "))
        .unwrap_or(head);
    let branch = head.split("...").next().unwrap_or(head).trim();
    if branch.is_empty() {
        None
    } else {
        Some(branch.to_string())
    }
}

fn is_git_conflict_status(index: char, worktree: char) -> bool {
    matches!(
        (index, worktree),
        ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U')
    )
}

#[cfg(target_os = "windows")]
fn open_folder(path: &Path) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|e| format!("Failed to open Explorer for {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_folder(path: &Path) -> Result<(), String> {
    Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| format!("Failed to open Finder for {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_folder(path: &Path) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|e| format!("Failed to open file manager for {}: {e}", path.display()))?;
    Ok(())
}

fn claude_project_key(path: &str) -> String {
    path.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect()
}

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

fn value_reset_time_path(value: &Value, path: &[&str]) -> Option<String> {
    let value = value_path(value, path)?;
    if let Some(text) = value.as_str() {
        return clean_optional_text(Some(text));
    }
    if let Some(number) = value.as_i64() {
        return Some(number.to_string());
    }
    value.as_f64().map(|number| number.to_string())
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
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

fn strip_codex_managed_config(text: &str) -> String {
    let mut output = Vec::new();
    let mut section: Option<String> = None;
    let mut skipping_managed_section = false;
    let mut skipping_extra_config = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == XUYA_CODEX_EXTRA_BEGIN {
            skipping_extra_config = true;
            continue;
        }
        if trimmed == XUYA_CODEX_EXTRA_END {
            skipping_extra_config = false;
            continue;
        }
        if skipping_extra_config {
            continue;
        }
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

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
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

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(windows)]
fn native_clipboard_has_image() -> bool {
    use windows_sys::Win32::System::DataExchange::IsClipboardFormatAvailable;
    use windows_sys::Win32::System::Ole::{CF_BITMAP, CF_DIB, CF_DIBV5};

    unsafe {
        IsClipboardFormatAvailable(CF_DIBV5 as u32) != 0
            || IsClipboardFormatAvailable(CF_DIB as u32) != 0
            || IsClipboardFormatAvailable(CF_BITMAP as u32) != 0
    }
}

#[cfg(not(windows))]
fn native_clipboard_has_image() -> bool {
    false
}
