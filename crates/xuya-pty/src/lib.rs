//! XuYa PTY session management.
//!
//! Provides [`PtySession`] for spawning interactive shells on Windows via ConPTY.

pub mod session;
pub mod shell;

pub use session::PtySession;
