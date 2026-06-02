//! Application state shared across Tauri commands.

use dashmap::DashMap;
use std::sync::Arc;
use xuya_pty::PtySession;

/// Global application state managed by Tauri.
pub struct AppState {
    /// Active PTY sessions keyed by session ID.
    pub sessions: Arc<DashMap<String, PtySession>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
        }
    }
}
