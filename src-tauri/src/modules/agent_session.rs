//! Agent 会话发现:在 Claude Code / Codex / OpenCode 写出的 session 文件里,
//! 找到最近的那一个会话 ID,供终端标签在重开时 `--resume <id>` 恢复对话。
//!
//! 移植自 1.0.0 前的老版本(`commands.rs` 中的 `find_latest_agent_session`),
//! 适配新版模块结构。Claude/Codex 扫各自 session 文件;OpenCode 改读 SQLite
//! (`~/.local/share/opencode/opencode.db` 的 session 表,全平台含 Windows 一致),
//! 以 `data_dir` 作兜底。

use rusqlite::{params, Connection, OpenFlags};
use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 查找指定 agent 自 `since_ms` 以来最新的 session id。
///
/// 前端以 camelCase 调用:`invoke("find_latest_agent_session", { agentCommand, cwd, sinceMs, excludeIds })`。
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

fn find_latest_agent_session_inner(
    agent_command: &str,
    cwd: Option<&str>,
    since_ms: u64,
    exclude_ids: &HashSet<String>,
) -> Result<Option<String>, String> {
    let since = system_time_from_millis(since_ms).unwrap_or(UNIX_EPOCH);
    // 留 15s 容差:agent 写 session 文件的时间可能与命令发起时刻略有偏差。
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
    let Some(home) = home_dir() else {
        return Ok(None);
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
        let Some(session_id) = file
            .file_stem()
            .and_then(|name| name.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        if exclude_ids.contains(&session_id) {
            continue;
        }
        if best.as_ref().is_none_or(|(time, _)| modified > *time) {
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
    let Some(home) = home_dir() else {
        return Ok(None);
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
        if best.as_ref().is_none_or(|(time, _)| modified > *time) {
            best = Some((modified, session_id.to_string()));
        }
    }

    Ok(best.map(|(_, id)| id))
}

fn latest_opencode_session(
    cwd: Option<&str>,
    since: SystemTime,
    exclude_ids: &HashSet<String>,
) -> Result<Option<String>, String> {
    let Some(home) = home_dir() else {
        return Ok(None);
    };
    let since_ms = since
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // OpenCode 把会话存到 SQLite(~/.local/share/opencode/opencode.db),session 表的
    // time_updated(ms)、directory、id;全平台一致(含 Windows),data_dir 兜底。
    // 只读连接 + busy_timeout,避免与运行中的 opencode 抢锁。
    let db_paths: [Option<PathBuf>; 2] = [
        Some(
            home.join(".local")
                .join("share")
                .join("opencode")
                .join("opencode.db"),
        ),
        dirs::data_dir().map(|d| d.join("opencode").join("opencode.db")),
    ];

    for db_path in db_paths.into_iter().flatten() {
        if !db_path.exists() {
            continue;
        }
        let Ok(conn) = Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) else {
            continue;
        };
        let _ = conn.busy_timeout(Duration::from_secs(1));
        let Ok(mut stmt) = conn.prepare(
            "SELECT id, directory FROM session \
             WHERE time_updated >= ?1 AND time_archived IS NULL \
             ORDER BY time_updated DESC",
        ) else {
            continue;
        };
        let target = cwd.map(normalize_path_text);
        let Ok(rows) = stmt.query_map(params![since_ms], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) else {
            continue;
        };
        for r in rows.flatten() {
            let (id, dir) = r;
            if exclude_ids.contains(&id) {
                continue;
            }
            if target
                .as_ref()
                .is_some_and(|t| normalize_path_text(&dir) != *t)
            {
                continue;
            }
            return Ok(Some(id));
        }
        return Ok(None);
    }

    Ok(None)
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
    dirs::home_dir()
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
