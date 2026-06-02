//! Tauri commands for PTY management.

use crate::state::AppState;
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
            if app.emit(&format!("pty-chunk-{session_id}"), &chunk).is_err() {
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
    session.write(&data).map_err(|e| format!("Write failed: {e}"))
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
pub async fn pty_close(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some((_, session)) = state.sessions.remove(&id) {
        session.kill().map_err(|e| format!("Kill failed: {e}"))?;
    }
    Ok(())
}
