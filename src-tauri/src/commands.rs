//! Tauri commands for PTY management.

use crate::state::AppState;
use serde_json::Value;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use xuya_core::{PtyChunk, SessionSpec};
use xuya_pty::PtySession;

/// Open a new PTY session. Returns the session ID.
#[tauri::command]
pub async fn pty_open(
    spec: SessionSpec,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (tx, mut rx) = mpsc::channel::<PtyChunk>(256);

    let session = PtySession::spawn(
        spec.shell_kind,
        spec.cwd.as_deref(),
        spec.rows,
        spec.cols,
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
) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        find_latest_agent_session_inner(&agent_command, cwd.as_deref(), since_ms)
    })
    .await
    .map_err(|e| format!("Session lookup failed: {e}"))?
}

fn find_latest_agent_session_inner(
    agent_command: &str,
    cwd: Option<&str>,
    since_ms: u64,
) -> Result<Option<String>, String> {
    let since = system_time_from_millis(since_ms).unwrap_or(UNIX_EPOCH);
    let since = since
        .checked_sub(Duration::from_secs(15))
        .unwrap_or(UNIX_EPOCH);

    match agent_command {
        "claude" => latest_claude_session(cwd, since),
        "codex" => latest_codex_session(cwd, since),
        "opencode" => latest_opencode_session(cwd, since),
        _ => Ok(None),
    }
}

fn latest_claude_session(cwd: Option<&str>, since: SystemTime) -> Result<Option<String>, String> {
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
        if best.as_ref().map_or(true, |(time, _)| modified > *time) {
            best = Some((modified, session_id));
        }
    }

    Ok(best.map(|(_, id)| id))
}

fn latest_codex_session(cwd: Option<&str>, since: SystemTime) -> Result<Option<String>, String> {
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
        if best.as_ref().map_or(true, |(time, _)| modified > *time) {
            best = Some((modified, session_id.to_string()));
        }
    }

    Ok(best.map(|(_, id)| id))
}

fn latest_opencode_session(cwd: Option<&str>, since: SystemTime) -> Result<Option<String>, String> {
    if let Some(id) = latest_opencode_session_from_cli(cwd, since)? {
        return Ok(Some(id));
    }

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
        if best.as_ref().map_or(true, |(time, _)| modified > *time) {
            best = Some((modified, session_id.to_string()));
        }
    }

    Ok(best.map(|(_, id)| id))
}

fn latest_opencode_session_from_cli(
    cwd: Option<&str>,
    since: SystemTime,
) -> Result<Option<String>, String> {
    let mut cmd = Command::new("opencode");
    cmd.arg("session")
        .arg("list")
        .arg("--format")
        .arg("json")
        .arg("--max-count")
        .arg("5");
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }

    let output = match cmd.output() {
        Ok(output) => output,
        Err(_) => return Ok(None),
    };
    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let text = stdout.trim();
    if text.is_empty() {
        return Ok(None);
    }
    let parsed: Value = serde_json::from_str(text)
        .map_err(|e| format!("Failed to parse opencode sessions: {e}"))?;
    let sessions = match parsed.as_array() {
        Some(items) => items,
        None => return Ok(None),
    };

    let mut best: Option<(SystemTime, String)> = None;
    for item in sessions {
        let Some(updated) = json_time(item).filter(|time| *time >= since) else {
            continue;
        };
        let Some(session_id) = item
            .get("id")
            .or_else(|| item.get("sessionID"))
            .or_else(|| item.get("sessionId"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if best.as_ref().map_or(true, |(time, _)| updated > *time) {
            best = Some((updated, session_id.to_string()));
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

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn system_time_from_millis(ms: u64) -> Option<SystemTime> {
    UNIX_EPOCH.checked_add(Duration::from_millis(ms))
}

fn json_time(value: &Value) -> Option<SystemTime> {
    [
        value.get("updated"),
        value.get("updatedAt"),
        value.get("time").and_then(|time| time.get("updated")),
        value.get("time").and_then(|time| time.get("updatedAt")),
        value.get("created"),
        value.get("createdAt"),
    ]
    .into_iter()
    .flatten()
    .find_map(value_to_system_time)
}

fn value_to_system_time(value: &Value) -> Option<SystemTime> {
    if let Some(ms) = value.as_u64() {
        return system_time_from_millis(ms);
    }

    let text = value.as_str()?;
    parse_simple_rfc3339(text)
}

fn parse_simple_rfc3339(value: &str) -> Option<SystemTime> {
    let value = value.strip_suffix('Z').unwrap_or(value);
    let (date, time) = value.split_once('T')?;
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i32>().ok()?;
    let month = date_parts.next()?.parse::<u32>().ok()?;
    let day = date_parts.next()?.parse::<u32>().ok()?;

    let mut time_parts = time.split(':');
    let hour = time_parts.next()?.parse::<u32>().ok()?;
    let minute = time_parts.next()?.parse::<u32>().ok()?;
    let second_text = time_parts.next()?.split('.').next()?;
    let second = second_text.parse::<u32>().ok()?;

    let days = days_from_civil(year, month, day)?;
    let seconds = days
        .checked_mul(86_400)?
        .checked_add((hour as i64).checked_mul(3_600)?)?
        .checked_add((minute as i64).checked_mul(60)?)?
        .checked_add(second as i64)?;

    if seconds < 0 {
        return None;
    }

    UNIX_EPOCH.checked_add(Duration::from_secs(seconds as u64))
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let year = year - i32::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month as i32;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;

    Some((era * 146_097 + doe - 719_468) as i64)
}

fn normalize_path_text(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn claude_project_key(path: &str) -> String {
    path.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect()
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
