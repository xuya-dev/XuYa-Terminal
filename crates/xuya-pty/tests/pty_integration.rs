//! Integration test: verify PTY spawn, read, write, and kill on Windows.

use std::time::Duration;
use tokio::sync::mpsc;
use xuya_core::{PtyChunk, ShellKind};
use xuya_pty::PtySession;

#[tokio::test]
async fn spawn_powershell_and_read_prompt() {
    let (tx, mut rx) = mpsc::channel::<PtyChunk>(256);

    let session = PtySession::spawn(None, ShellKind::PowerShell, None, 24, 80, None, tx)
        .expect("Failed to spawn powershell");

    // Wait for the prompt output with a timeout.
    let mut output = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);

    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
            Ok(Some(PtyChunk::Data { data })) => {
                output.extend_from_slice(&data);
                if output.len() > 10 {
                    break;
                }
            }
            Ok(Some(PtyChunk::Exit { .. })) => {
                panic!("PTY exited unexpectedly");
            }
            Ok(None) => {
                panic!("Channel closed");
            }
            Err(_) => {
                if output.len() > 10 {
                    break;
                }
            }
        }
    }

    let text = String::from_utf8_lossy(&output);
    assert!(
        !text.is_empty(),
        "Expected some output from powershell, got nothing"
    );
    println!(
        "powershell output (first 200 chars): {}",
        &text[..text.len().min(200)]
    );

    // Clean up.
    session.kill().expect("Failed to kill session");
}

#[test]
fn resolve_powershell_command() {
    let cmd = xuya_pty::shell::resolve_command(&ShellKind::PowerShell, None);
    assert!(
        cmd.is_ok(),
        "Failed to resolve powershell: {:?}",
        cmd.err()
    );
}

#[test]
fn resolve_cmd_command() {
    let cmd = xuya_pty::shell::resolve_command(&ShellKind::Cmd, None);
    assert!(cmd.is_ok(), "Failed to resolve cmd: {:?}", cmd.err());
}
