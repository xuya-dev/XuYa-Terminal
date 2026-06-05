//! PTY session management.
//!
//! [`PtySession`] wraps a ConPTY child process with a blocking reader thread
//! that forwards output chunks through a bounded mpsc channel.

use crate::shell::{resolve_command, resolve_launch_command};
use anyhow::{Context, Result};
use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use xuya_core::{PtyChunk, SessionId, ShellKind};

/// Sender half returned to the caller — bridge task reads from the paired receiver.
type ChunkSender = mpsc::Sender<PtyChunk>;

/// A live PTY session.
///
/// Owns the master PTY handle, a writer for sending input, and the child
/// process handle. Output is streamed asynchronously via the bounded mpsc
/// channel created at spawn time.
///
/// All handles are wrapped in `Mutex` because `portable-pty` types are
/// `Send` but not `Sync`.
pub struct PtySession {
    /// Unique session identifier.
    pub id: SessionId,
    /// The master PTY (used for resize). Mutex because MasterPty is !Sync.
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// Writer to send bytes into the PTY (keyboard input).
    writer: Mutex<Box<dyn Write + Send>>,
    /// Child process handle (used for kill / wait).
    child: Mutex<Box<dyn Child + Send>>,
    /// Cancellation flag — shared with the reader thread via Arc.
    cancelled: Arc<AtomicBool>,
}

impl PtySession {
    /// Spawn a new PTY session.
    ///
    /// `tx` is a bounded mpsc sender; the caller should hold the receiver and
    /// forward [`PtyChunk`]s to the frontend. The reader runs on a **dedicated
    /// blocking thread** so it never stalls the tokio runtime.
    pub fn spawn(
        id: Option<&str>,
        shell_kind: ShellKind,
        cwd: Option<&str>,
        rows: u16,
        cols: u16,
        launch_command: Option<&str>,
        startup_command: Option<&str>,
        tx: ChunkSender,
    ) -> Result<Self> {
        let id = id
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        // Build the shell command.
        let mut cmd = match launch_command {
            Some(command) if !command.trim().is_empty() => resolve_launch_command(command)?,
            _ => resolve_command(&shell_kind, startup_command)?,
        };

        // Set working directory.
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        // Open PTY pair with requested size.
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to open PTY pair")?;

        // Spawn the child process.
        let child = pair
            .slave
            .spawn_command(cmd)
            .context("failed to spawn shell in PTY")?;

        // Take writer for input.
        let writer = pair
            .master
            .take_writer()
            .context("failed to take PTY writer")?;

        // Clone reader for the output thread.
        let reader = pair
            .master
            .try_clone_reader()
            .context("failed to clone PTY reader")?;

        let cancelled = Arc::new(AtomicBool::new(false));
        let cancelled_reader = Arc::clone(&cancelled);

        // Spawn dedicated blocking reader thread.
        std::thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || {
                reader_loop(reader, tx, &cancelled_reader);
            })
            .context("failed to spawn PTY reader thread")?;

        Ok(Self {
            id,
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            cancelled,
        })
    }

    /// Write bytes (user input) into the PTY.
    pub fn write(&self, bytes: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(bytes).context("PTY write failed")
    }

    /// Resize the PTY to the given dimensions.
    pub fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        let master = self.master.lock().unwrap();
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("PTY resize failed")
    }

    /// Kill the child process and signal the reader thread to stop.
    pub fn kill(&self) -> Result<()> {
        self.cancelled.store(true, Ordering::Relaxed);
        let mut child = self.child.lock().unwrap();
        child.kill().context("failed to kill PTY child process")
    }
}

/// Blocking reader loop — runs on a dedicated thread.
///
/// Reads raw bytes from the PTY master and forwards them as [`PtyChunk::Data`]
/// through the bounded mpsc channel. When the child exits or the reader hits
/// EOF, sends [`PtyChunk::Exit`].
///
/// **Backpressure:** the mpsc channel is bounded (256 chunks). When full, the
/// reader does coalescing — it keeps reading into a local buffer and ships a
/// merged chunk on the next successful send window.
fn reader_loop(
    mut reader: Box<dyn Read + Send>,
    tx: ChunkSender,
    cancelled: &AtomicBool,
) {
    let mut buf = [0u8; 8192];
    let mut overflow: Vec<u8> = Vec::new();

    loop {
        // Check cancellation.
        if cancelled.load(Ordering::Relaxed) {
            break;
        }

        match reader.read(&mut buf) {
            Ok(0) => {
                // EOF — child exited.
                let _ = tx.blocking_send(PtyChunk::Exit { code: None });
                break;
            }
            Ok(n) => {
                let data = &buf[..n];

                // If we have overflow from a previous blocked send, coalesce.
                if overflow.is_empty() {
                    match tx.try_send(PtyChunk::Data {
                        data: data.to_vec(),
                    }) {
                        Ok(()) => {}
                        Err(tokio::sync::mpsc::error::TrySendError::Full(chunk)) => {
                            // Channel full — start coalescing.
                            if let PtyChunk::Data { data: d } = chunk {
                                overflow.extend_from_slice(&d);
                            }
                            overflow.extend_from_slice(data);
                        }
                        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => break,
                    }
                } else {
                    // Already coalescing — append, then try to flush every
                    // iteration. The previous code only flushed once overflow
                    // reached 8 KiB, so a small tail packet could linger
                    // unsent until the next (blocking) read returned — e.g.
                    // when an agent prints a short line then waits for input.
                    overflow.extend_from_slice(data);

                    match tx.try_send(PtyChunk::Data {
                        data: overflow.clone(),
                    }) {
                        Ok(()) => overflow.clear(),
                        Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                            // Still backed up — keep coalescing, capped at 1 MiB
                            // to prevent unbounded growth (OOM).
                            if overflow.len() > 1024 * 1024 {
                                overflow.drain(..8192);
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
            Err(e) => {
                log::debug!("PTY reader error: {e}");
                let _ = tx.blocking_send(PtyChunk::Exit { code: None });
                break;
            }
        }
    }

    // Flush remaining overflow on exit.
    if !overflow.is_empty() {
        let _ = tx.blocking_send(PtyChunk::Data { data: overflow });
    }
}
