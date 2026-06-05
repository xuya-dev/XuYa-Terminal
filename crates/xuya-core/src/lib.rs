//! XuYa core types shared across all crates.

use serde::Serialize;

/// Unique identifier for a PTY session (UUID v4).
pub type SessionId = String;

/// Frame marker bytes for the binary IPC channel. The first byte of every
/// chunk the frontend receives identifies how to decode the rest.
pub const FRAME_DATA: u8 = 0x00;
pub const FRAME_EXIT: u8 = 0x01;

/// A chunk of data flowing from the PTY to the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "type")]
pub enum PtyChunk {
    /// Raw bytes from the PTY (ANSI-encoded terminal output).
    Data { data: Vec<u8> },
    /// The child process has exited.
    Exit { code: Option<i32> },
}

impl PtyChunk {
    /// Encode this chunk into a length-tagged byte frame for the binary IPC
    /// channel. Data frames are `[FRAME_DATA, ..bytes]` (a single prefix byte
    /// over the raw PTY output — far cheaper than the old JSON number array).
    /// Exit frames are `[FRAME_EXIT, has_code, i32_le×4]`.
    pub fn encode(self) -> Vec<u8> {
        match self {
            PtyChunk::Data { data } => {
                let mut frame = Vec::with_capacity(data.len() + 1);
                frame.push(FRAME_DATA);
                frame.extend_from_slice(&data);
                frame
            }
            PtyChunk::Exit { code } => {
                let mut frame = Vec::with_capacity(6);
                frame.push(FRAME_EXIT);
                match code {
                    Some(value) => {
                        frame.push(1);
                        frame.extend_from_slice(&value.to_le_bytes());
                    }
                    None => {
                        frame.push(0);
                        frame.extend_from_slice(&[0, 0, 0, 0]);
                    }
                }
                frame
            }
        }
    }
}

/// Specification for creating a new PTY session.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSpec {
    /// Optional frontend-provided session id used for event subscription.
    pub id: Option<String>,
    /// Which shell to launch.
    pub shell_kind: ShellKind,
    /// Working directory for the new shell. `None` = inherit current.
    pub cwd: Option<String>,
    /// Initial terminal rows.
    pub rows: u16,
    /// Initial terminal columns.
    pub cols: u16,
    /// Optional full command line to launch instead of the selected shell.
    pub launch_command: Option<String>,
    /// Optional command to run after the shell has started.
    pub startup_command: Option<String>,
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
