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
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
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
const MODEL_FETCH_ERROR_BODY_MAX_CHARS: usize = 512;

const CLAUDE_MANAGED_ENV_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
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
    ("kimi", "https://api.moonshot.cn/anthropic"),
    ("deepseek", "https://api.deepseek.com/anthropic"),
    ("xiaomimimo", "https://api.xiaomimimo.com/anthropic"),
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
    sonnet_model: Option<String>,
    opus_model: Option<String>,
    extra_config: Option<String>,
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
    sonnet_model: Option<String>,
    opus_model: Option<String>,
    extra_config: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelFetchRequest {
    tool: String,
    provider_id: String,
    base_url: Option<String>,
    api_key: Option<String>,
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
    sonnet_model: Option<String>,
    #[serde(default)]
    opus_model: Option<String>,
    #[serde(default)]
    extra_config: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCustomProviderStore {
    #[serde(default)]
    providers: Vec<AgentCustomProvider>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCustomProviderSummary {
    id: String,
    name: String,
    base_url: String,
    endpoint: String,
    model: Option<String>,
    haiku_model: Option<String>,
    sonnet_model: Option<String>,
    opus_model: Option<String>,
    extra_config: Option<String>,
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
    sonnet_model: Option<String>,
    opus_model: Option<String>,
    extra_config: Option<String>,
    token_configured: bool,
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
#[tauri::command]
pub async fn pty_open(
    spec: SessionSpec,
    app: AppHandle,
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
            if app
                .emit(&format!("pty-chunk-{session_id}"), &chunk)
                .is_err()
            {
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

fn read_agent_config_state() -> Result<AgentConfigState, String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    let claude_path = claude_settings_path(&home);
    let codex_path = codex_config_path(&home);
    let claude_store = read_custom_provider_store(&home, "claude")?;
    let codex_store = read_custom_provider_store(&home, "codex")?;

    Ok(AgentConfigState {
        claude: read_claude_config_state(&claude_path, &claude_store.providers),
        codex: read_codex_config_state(&codex_path, &codex_store.providers),
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
    let sonnet_model = normalize_claude_role_model(tool, request.sonnet_model.as_deref());
    let opus_model = normalize_claude_role_model(tool, request.opus_model.as_deref());
    let extra_config = normalize_full_config(tool, request.extra_config.as_deref())?;
    let id = requested_id.unwrap_or_else(|| unique_custom_provider_id(&store.providers, &name));

    let provider = AgentCustomProvider {
        id: id.clone(),
        name,
        base_url,
        api_key,
        model,
        haiku_model,
        sonnet_model,
        opus_model,
        extra_config,
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
    let raw_base_url = clean_optional_text(request.base_url.as_deref())
        .or_else(|| stored_custom.map(|provider| provider.base_url.clone()))
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
                .or_else(|| claude_known_provider_base_url(&provider_id).map(str::to_string))
                .ok_or_else(|| "Claude base URL is required".to_string())?;
            let base_url = normalize_claude_base_url(&raw_base_url)?;
            let api_key = clean_optional_text(request.api_key.as_deref())
                .or_else(|| {
                    stored_custom
                        .as_ref()
                        .and_then(|provider| clean_optional_text(Some(provider.api_key.as_str())))
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

        let model = clean_optional_text(request.model.as_deref()).or_else(|| {
            stored_custom
                .as_ref()
                .and_then(|provider| provider.model.clone())
        });
        let haiku_model = clean_optional_text(request.haiku_model.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.haiku_model.clone())
            })
            .or_else(|| model.clone());
        let sonnet_model = clean_optional_text(request.sonnet_model.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.sonnet_model.clone())
            })
            .or_else(|| model.clone());
        let opus_model = clean_optional_text(request.opus_model.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| provider.opus_model.clone())
            })
            .or_else(|| model.clone());

        if let Some(model) = model {
            env.insert("ANTHROPIC_MODEL".to_string(), Value::String(model));
        }
        if let Some(model) = haiku_model {
            env.insert(
                "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
                Value::String(model),
            );
        }
        if let Some(model) = sonnet_model {
            env.insert(
                "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
                Value::String(model),
            );
        }
        if let Some(model) = opus_model {
            env.insert(
                "ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(),
                Value::String(model),
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
    let result_provider_id = custom_id
        .as_deref()
        .map(|id| format!("{CUSTOM_PROVIDER_SELECTOR_PREFIX}{id}"))
        .unwrap_or_else(|| provider_id.clone());
    let full_config =
        normalize_full_config("codex", request.extra_config.as_deref())?.or_else(|| {
            stored_custom.as_ref().and_then(|provider| {
                normalize_full_config("codex", provider.extra_config.as_deref())
                    .ok()
                    .flatten()
            })
        });
    let current = fs::read_to_string(&path).unwrap_or_default();
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
            .ok_or_else(|| "Codex base URL is required".to_string())?;
        let base_url = normalize_codex_base_url(&raw_base_url)?;
        let api_key = clean_optional_text(request.api_key.as_deref())
            .or_else(|| {
                stored_custom
                    .as_ref()
                    .and_then(|provider| clean_optional_text(Some(provider.api_key.as_str())))
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

    let mut next = full_config.unwrap_or_else(|| {
        let preserved = strip_codex_managed_config(&current);
        merge_codex_config(generated_config, String::new(), preserved)
    });
    if let Some(api_key) = api_key {
        let token_provider_id =
            extract_top_level_toml_string(&next, "model_provider").unwrap_or(codex_provider_id);
        next = set_codex_provider_token(&next, &token_provider_id, &api_key);
    }
    if !next.ends_with('\n') {
        next.push('\n');
    }
    write_text_atomic(&path, &next)?;

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

fn file_modified(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

fn claude_settings_path(home: &Path) -> PathBuf {
    home.join(".claude").join("settings.json")
}

fn codex_config_path(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
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
            "SELECT id, name, base_url, api_key, model, haiku_model, sonnet_model, opus_model, extra_config
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
                sonnet_model: row.get(6)?,
                opus_model: row.get(7)?,
                extra_config: row.get(8)?,
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
                tool, id, name, base_url, api_key, model, haiku_model, sonnet_model, opus_model, extra_config
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                tool,
                provider.id,
                provider.name,
                provider.base_url,
                provider.api_key,
                provider.model,
                provider.haiku_model,
                provider.sonnet_model,
                provider.opus_model,
                provider.extra_config,
            ],
        )
        .map_err(|e| format!("Failed to save custom provider {}: {e}", provider.id))?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit custom providers: {e}"))
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
            sonnet_model TEXT,
            opus_model TEXT,
            extra_config TEXT,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (tool, id)
        );",
    )
    .map_err(|e| format!("Failed to initialize provider database: {e}"))?;
    Ok(conn)
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
                tool, id, name, base_url, api_key, model, haiku_model, sonnet_model, opus_model, extra_config
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                tool,
                provider.id,
                provider.name,
                provider.base_url,
                provider.api_key,
                provider.model,
                provider.haiku_model,
                provider.sonnet_model,
                provider.opus_model,
                provider.extra_config,
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
        model: provider.model.clone(),
        haiku_model: provider.haiku_model.clone(),
        sonnet_model: provider.sonnet_model.clone(),
        opus_model: provider.opus_model.clone(),
        extra_config,
        token_configured: is_real_token(&provider.api_key, ""),
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
        "claude" => sanitize_claude_full_config(&full_config).map(Some),
        "codex" => Ok(Some(sanitize_codex_full_config(&full_config))),
        other => Err(format!("Unsupported agent config target: {other}")),
    }
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

fn sanitize_claude_full_config(full_config: &str) -> Result<String, String> {
    let value = parse_claude_full_config(full_config)?;
    stringify_sanitized_claude_config(value)
}

fn stringify_sanitized_claude_config(mut value: Value) -> Result<String, String> {
    if let Some(env) = value.get_mut("env").and_then(Value::as_object_mut) {
        for key in ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] {
            if env
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .is_some_and(|token| !token.is_empty())
            {
                env.insert(
                    key.to_string(),
                    Value::String(CLAUDE_TOKEN_PLACEHOLDER.to_string()),
                );
            }
        }
    }
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

fn is_real_token(value: &str, placeholder: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && (placeholder.is_empty() || value != placeholder)
}

fn clean_codex_token(value: Option<String>) -> Option<String> {
    value
        .and_then(|value| clean_optional_text(Some(value.as_str())))
        .filter(|value| value != CODEX_TOKEN_PLACEHOLDER)
}

fn current_agent_api_key(home: &Path, tool: &str, custom_id: Option<&str>) -> Option<String> {
    match tool {
        "claude" => read_json_or_empty_object(&claude_settings_path(home))
            .ok()
            .and_then(|settings| extract_claude_api_key(&settings)),
        "codex" => {
            let current = fs::read_to_string(codex_config_path(home)).ok()?;
            let current_provider = extract_top_level_toml_string(&current, "model_provider");
            let target_provider = custom_id.map(codex_custom_provider_id);
            target_provider
                .as_deref()
                .and_then(|provider| {
                    clean_codex_token(extract_codex_provider_string(
                        &current,
                        provider,
                        "experimental_bearer_token",
                    ))
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

fn sanitize_codex_full_config(full_config: &str) -> String {
    full_config
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if toml_line_key(trimmed).is_some_and(|key| key == "experimental_bearer_token") {
                let indent = line
                    .chars()
                    .take_while(|ch| ch.is_whitespace())
                    .collect::<String>();
                format!(
                    "{indent}experimental_bearer_token = {}",
                    toml_string(CODEX_TOKEN_PLACEHOLDER)
                )
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
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

fn normalize_path_text(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn claude_project_key(path: &str) -> String {
    path.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect()
}

fn read_claude_config_state(
    path: &Path,
    custom_providers: &[AgentCustomProvider],
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
    let sonnet_model = env
        .and_then(|env| env.get("ANTHROPIC_DEFAULT_SONNET_MODEL"))
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
    let token_configured = env.is_some_and(|env| {
        env.get("ANTHROPIC_AUTH_TOKEN")
            .or_else(|| env.get("ANTHROPIC_API_KEY"))
            .and_then(Value::as_str)
            .is_some_and(|value| is_real_token(value, CLAUDE_TOKEN_PLACEHOLDER))
    });
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
    let extra_config = settings.and_then(|value| stringify_sanitized_claude_config(value).ok());

    AgentToolConfigState {
        path: path_to_string(path),
        exists,
        active_provider,
        base_url,
        endpoint,
        model,
        haiku_model,
        sonnet_model,
        opus_model,
        extra_config,
        token_configured,
        custom_providers: custom_provider_summaries("claude", custom_providers),
    }
}

fn read_codex_config_state(
    path: &Path,
    custom_providers: &[AgentCustomProvider],
) -> AgentToolConfigState {
    let exists = path.exists();
    let text = fs::read_to_string(path).unwrap_or_default();
    let active_config_provider = extract_top_level_toml_string(&text, "model_provider");
    let model = extract_top_level_toml_string(&text, "model");
    let base_url = active_config_provider
        .as_deref()
        .and_then(|provider| extract_codex_provider_string(&text, provider, "base_url"));
    let token_configured = active_config_provider
        .as_deref()
        .and_then(|provider| {
            extract_codex_provider_string(&text, provider, "experimental_bearer_token")
        })
        .or_else(|| extract_top_level_toml_string(&text, "experimental_bearer_token"))
        .as_deref()
        .is_some_and(|value| is_real_token(value, CODEX_TOKEN_PLACEHOLDER));
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
    let extra_config = clean_optional_text(Some(sanitize_codex_full_config(&text).as_str()));

    AgentToolConfigState {
        path: path_to_string(path),
        exists,
        active_provider,
        base_url,
        endpoint,
        model,
        haiku_model: None,
        sonnet_model: None,
        opus_model: None,
        extra_config,
        token_configured,
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
            skipping_managed_section = is_xuya_codex_provider_section(&header);
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

fn is_xuya_codex_provider_section(section: &str) -> bool {
    section
        .strip_prefix("model_providers.")
        .is_some_and(|provider| {
            provider == XUYA_CODEX_PROVIDER_ID
                || provider.starts_with(&format!("{XUYA_CODEX_PROVIDER_ID}_"))
        })
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
