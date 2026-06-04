//! Tauri commands for PTY management.

use crate::state::AppState;
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

const CLAUDE_MANAGED_ENV_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "API_TIMEOUT_MS",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderConfigRequest {
    tool: String,
    provider_id: String,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
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
    token_configured: bool,
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

fn read_agent_config_state() -> Result<AgentConfigState, String> {
    let home = home_dir().ok_or_else(|| "Failed to locate home directory".to_string())?;
    let claude_path = claude_settings_path(&home);
    let codex_path = codex_config_path(&home);

    Ok(AgentConfigState {
        claude: read_claude_config_state(&claude_path),
        codex: read_codex_config_state(&codex_path),
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

fn apply_claude_provider_config(
    home: &Path,
    request: AgentProviderConfigRequest,
) -> Result<AgentConfigApplyResult, String> {
    let path = claude_settings_path(home);
    let provider_id = request.provider_id.trim().to_string();
    if provider_id.is_empty() {
        return Err("Provider is required".to_string());
    }

    let mut settings = read_json_or_empty_object(&path)?;
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
    let existing_api_key = env
        .get("ANTHROPIC_AUTH_TOKEN")
        .or_else(|| env.get("ANTHROPIC_API_KEY"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    for key in CLAUDE_MANAGED_ENV_KEYS {
        env.remove(*key);
    }

    let (base_url, endpoint) = if provider_id == "official" {
        (None, None)
    } else {
        let base_url = normalize_claude_base_url(
            request
                .base_url
                .as_deref()
                .ok_or_else(|| "Claude base URL is required".to_string())?,
        )?;
        let api_key = clean_optional_text(request.api_key.as_deref())
            .or(existing_api_key)
            .ok_or_else(|| "Claude API Key is required".to_string())?;
        env.insert(
            "ANTHROPIC_BASE_URL".to_string(),
            Value::String(base_url.clone()),
        );
        env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), Value::String(api_key));

        if let Some(model) = clean_optional_text(request.model.as_deref()) {
            env.insert("ANTHROPIC_MODEL".to_string(), Value::String(model.clone()));
            env.insert(
                "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
                Value::String(model.clone()),
            );
            env.insert(
                "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
                Value::String(model.clone()),
            );
            env.insert(
                "ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(),
                Value::String(model),
            );
        }

        let endpoint = claude_messages_endpoint(&base_url);
        (Some(base_url), Some(endpoint))
    };

    write_json_pretty_atomic(&path, &settings)?;

    Ok(AgentConfigApplyResult {
        tool: "claude".to_string(),
        provider_id,
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

    let current = fs::read_to_string(&path).unwrap_or_default();
    let existing_api_key = extract_codex_provider_string(
        &current,
        XUYA_CODEX_PROVIDER_ID,
        "experimental_bearer_token",
    )
    .or_else(|| extract_top_level_toml_string(&current, "experimental_bearer_token"));
    let preserved = strip_codex_managed_config(&current);
    let model =
        clean_optional_text(request.model.as_deref()).unwrap_or_else(|| "gpt-5-codex".to_string());

    let (prefix, base_url, endpoint) = if provider_id == "official" {
        (
            format!(
                "model_provider = \"openai\"\nmodel = {}\n",
                toml_string(&model)
            ),
            None,
            None,
        )
    } else {
        let base_url = normalize_codex_base_url(
            request
                .base_url
                .as_deref()
                .ok_or_else(|| "Codex base URL is required".to_string())?,
        )?;
        let api_key = clean_optional_text(request.api_key.as_deref())
            .or(existing_api_key)
            .ok_or_else(|| "Codex API Key is required".to_string())?;
        let prefix = format!(
            "# Managed by XuYa Terminal.\nmodel_provider = \"{provider_id}\"\nmodel = {}\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.{provider_id}]\nname = \"XuYa Custom\"\nbase_url = {}\nwire_api = \"responses\"\nexperimental_bearer_token = {}\n",
            toml_string(&model),
            toml_string(&base_url),
            toml_string(&api_key),
            provider_id = XUYA_CODEX_PROVIDER_ID,
        );
        let endpoint = codex_responses_endpoint(&base_url);
        (prefix, Some(base_url), Some(endpoint))
    };

    let next = merge_codex_config(prefix, preserved);
    write_text_atomic(&path, &next)?;

    Ok(AgentConfigApplyResult {
        tool: "codex".to_string(),
        provider_id,
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

fn read_claude_config_state(path: &Path) -> AgentToolConfigState {
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
    let token_configured = env.is_some_and(|env| {
        env.get("ANTHROPIC_AUTH_TOKEN")
            .or_else(|| env.get("ANTHROPIC_API_KEY"))
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
    });
    let active_provider = if let Some(base_url) = base_url.as_deref() {
        Some(
            known_claude_provider_id(base_url)
                .unwrap_or("custom")
                .to_string(),
        )
    } else if token_configured {
        Some("custom".to_string())
    } else if exists {
        Some("official".to_string())
    } else {
        None
    };
    let endpoint = base_url.as_deref().map(claude_messages_endpoint);

    AgentToolConfigState {
        path: path_to_string(path),
        exists,
        active_provider,
        base_url,
        endpoint,
        model,
        token_configured,
    }
}

fn read_codex_config_state(path: &Path) -> AgentToolConfigState {
    let exists = path.exists();
    let text = fs::read_to_string(path).unwrap_or_default();
    let active_provider = extract_top_level_toml_string(&text, "model_provider");
    let model = extract_top_level_toml_string(&text, "model");
    let base_url = active_provider
        .as_deref()
        .and_then(|provider| extract_codex_provider_string(&text, provider, "base_url"));
    let token_configured = active_provider
        .as_deref()
        .and_then(|provider| {
            extract_codex_provider_string(&text, provider, "experimental_bearer_token")
        })
        .or_else(|| extract_top_level_toml_string(&text, "experimental_bearer_token"))
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let endpoint = base_url.as_deref().map(codex_responses_endpoint);

    AgentToolConfigState {
        path: path_to_string(path),
        exists,
        active_provider,
        base_url,
        endpoint,
        model,
        token_configured,
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

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "# Managed by XuYa Terminal." {
            continue;
        }

        if let Some(header) = parse_toml_section_header(trimmed) {
            section = Some(header.clone());
            skipping_managed_section =
                header == format!("model_providers.{XUYA_CODEX_PROVIDER_ID}");
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

fn merge_codex_config(prefix: String, preserved: String) -> String {
    let prefix = prefix.trim();
    let preserved = preserved.trim();
    if preserved.is_empty() {
        format!("{prefix}\n")
    } else {
        format!("{prefix}\n\n{preserved}\n")
    }
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
