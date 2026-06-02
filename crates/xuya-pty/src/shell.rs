//! Windows shell resolution.
//!
//! Maps [`ShellKind`] to a [`CommandBuilder`] with the correct executable path and arguments.

use anyhow::{bail, Context, Result};
use portable_pty::CommandBuilder;
use std::path::PathBuf;
use xuya_core::ShellKind;

/// Resolve a [`ShellKind`] into a [`CommandBuilder`] ready to spawn.
pub fn resolve_command(kind: &ShellKind, startup_command: Option<&str>) -> Result<CommandBuilder> {
    match kind {
        ShellKind::Pwsh => {
            let exe = find_executable("pwsh.exe")
                .or_else(|_| {
                    let fallback =
                        PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe");
                    if fallback.exists() {
                        Ok(fallback)
                    } else {
                        bail!("pwsh.exe not found on PATH or in default location")
                    }
                })
                .context("PowerShell 7 (pwsh) not found")?;
            let mut cmd = CommandBuilder::new(exe);
            cmd.arg("-NoLogo");
            if let Some(command) = startup_command {
                cmd.arg("-NoExit");
                cmd.arg("-Command");
                cmd.arg(delayed_powershell_command(command));
            }
            Ok(cmd)
        }
        ShellKind::PowerShell => {
            let exe = find_executable("powershell.exe")
                .or_else(|_| {
                    let fallback = PathBuf::from(
                        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
                    );
                    if fallback.exists() {
                        Ok(fallback)
                    } else {
                        bail!("powershell.exe not found")
                    }
                })
                .context("Windows PowerShell not found")?;
            let mut cmd = CommandBuilder::new(exe);
            cmd.arg("-NoLogo");
            if let Some(command) = startup_command {
                cmd.arg("-NoExit");
                cmd.arg("-Command");
                cmd.arg(delayed_powershell_command(command));
            }
            Ok(cmd)
        }
        ShellKind::Cmd => {
            let exe = find_executable("cmd.exe").context("cmd.exe not found")?;
            let mut cmd = CommandBuilder::new(exe);
            if let Some(command) = startup_command {
                cmd.arg("/K");
                cmd.arg(format!("timeout /t 1 /nobreak >nul & {command}"));
            }
            Ok(cmd)
        }
        ShellKind::Wsl => {
            let exe =
                find_executable("wsl.exe").context("wsl.exe not found — is WSL installed?")?;
            let mut cmd = CommandBuilder::new(exe);
            cmd.arg("-d");
            cmd.arg("Ubuntu");
            if let Some(command) = startup_command {
                cmd.arg("--exec");
                cmd.arg("sh");
                cmd.arg("-lc");
                cmd.arg(format!("sleep 1; {command}; exec sh"));
            }
            Ok(cmd)
        }
        ShellKind::GitBash => {
            let candidates = [
                r"C:\Program Files\Git\bin\bash.exe",
                r"C:\Program Files (x86)\Git\bin\bash.exe",
                r"C:\Git\bin\bash.exe",
            ];
            let exe = candidates
                .iter()
                .find(|p| PathBuf::from(p).exists())
                .map(PathBuf::from)
                .or_else(|| find_executable("bash.exe").ok())
                .context(
                    "Git Bash (bash.exe) not found — is Git for Windows installed?",
                )?;
            let mut cmd = CommandBuilder::new(exe);
            cmd.arg("--login");
            cmd.arg("-i");
            if let Some(command) = startup_command {
                cmd.arg("-c");
                cmd.arg(format!("sleep 1; {command}; exec bash --login -i"));
            }
            Ok(cmd)
        }
    }
}

fn delayed_powershell_command(command: &str) -> String {
    format!("Start-Sleep -Milliseconds 700; {command}")
}

/// Human-readable name for a shell kind.
pub fn shell_display_name(kind: &ShellKind) -> &'static str {
    match kind {
        ShellKind::Pwsh => "PowerShell 7",
        ShellKind::PowerShell => "Windows PowerShell",
        ShellKind::Cmd => "Command Prompt",
        ShellKind::Wsl => "WSL (Ubuntu)",
        ShellKind::GitBash => "Git Bash",
    }
}

/// Search for an executable on PATH using Windows `where` command.
fn find_executable(name: &str) -> Result<PathBuf> {
    // 1. Check standard Windows locations directly to avoid running `where.exe`
    // (which can be blocked by security policies or fail for non-admin users).
    let standard_paths = match name {
        "cmd.exe" => vec![PathBuf::from(r"C:\Windows\System32\cmd.exe")],
        "powershell.exe" => vec![PathBuf::from(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")],
        "wsl.exe" => vec![PathBuf::from(r"C:\Windows\System32\wsl.exe")],
        "pwsh.exe" => vec![
            PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe"),
            PathBuf::from(r"C:\Program Files\PowerShell\6\pwsh.exe"),
        ],
        "bash.exe" => vec![
            PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"),
            PathBuf::from(r"C:\Git\bin\bash.exe"),
        ],
        _ => vec![],
    };

    for path in standard_paths {
        if path.exists() {
            return Ok(path);
        }
    }

    // 2. Fallback to `where` command if not in standard paths.
    let output = std::process::Command::new("where")
        .arg(name)
        .output()
        .context("failed to run `where` command")?;

    if !output.status.success() {
        bail!("`where {}` failed", name);
    }

    let path_str = String::from_utf8_lossy(&output.stdout);
    let first_line = path_str.lines().next().unwrap_or("").trim();

    if first_line.is_empty() {
        bail!("`where {}` returned empty path", name);
    }

    Ok(PathBuf::from(first_line))
}
