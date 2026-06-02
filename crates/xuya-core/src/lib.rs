//! XuYa core types shared across all crates.

use serde::Serialize;

/// Unique identifier for a PTY session (UUID v4).
pub type SessionId = String;

/// A chunk of data flowing from the PTY to the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "type")]
pub enum PtyChunk {
    /// Raw bytes from the PTY (ANSI-encoded terminal output).
    Data { data: Vec<u8> },
    /// The child process has exited.
    Exit { code: Option<i32> },
}

/// Specification for creating a new PTY session.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSpec {
    /// Which shell to launch.
    pub shell_kind: ShellKind,
    /// Working directory for the new shell. `None` = inherit current.
    pub cwd: Option<String>,
    /// Initial terminal rows.
    pub rows: u16,
    /// Initial terminal columns.
    pub cols: u16,
}

/// Supported shell types on Windows.
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShellKind {
    /// PowerShell 7+ (pwsh.exe)
    Pwsh,
    /// Windows PowerShell 5.1 (powershell.exe)
    PowerShell,
    /// Command Prompt (cmd.exe)
    Cmd,
    /// Windows Subsystem for Linux
    Wsl,
    /// Git Bash
    GitBash,
}

impl Default for ShellKind {
    fn default() -> Self {
        Self::PowerShell
    }
}
