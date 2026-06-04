//! Windows shell resolution.
//!
//! Maps [`ShellKind`] to a [`CommandBuilder`] with the correct executable path and arguments.

use anyhow::{bail, Context, Result};
use portable_pty::CommandBuilder;
use std::env;
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
                cmd.arg("-ExecutionPolicy");
                cmd.arg("Bypass");
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
                cmd.arg("-ExecutionPolicy");
                cmd.arg("Bypass");
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

/// Resolve a user-provided full command line into a [`CommandBuilder`].
pub fn resolve_launch_command(command_line: &str) -> Result<CommandBuilder> {
    let mut parts = split_command_line(command_line)?;
    if parts.is_empty() {
        bail!("launch command is empty");
    }

    let executable = parts.remove(0);
    let exe = resolve_executable(&executable)?;
    let mut cmd = CommandBuilder::new(exe);
    for arg in parts {
        cmd.arg(arg);
    }
    Ok(cmd)
}

fn delayed_powershell_command(command: &str) -> String {
    format!("Start-Sleep -Milliseconds 500; & {command}")
}

fn resolve_executable(value: &str) -> Result<PathBuf> {
    let path = PathBuf::from(value);
    if path.is_absolute() || value.contains('\\') || value.contains('/') {
        if path.exists() {
            return Ok(path);
        }
        bail!("launch executable not found: {value}");
    }

    find_executable(value).or_else(|_| {
        if value.contains('.') {
            bail!("launch executable not found on PATH: {value}");
        }
        find_executable(&format!("{value}.exe"))
            .or_else(|_| find_executable(&format!("{value}.cmd")))
            .or_else(|_| find_executable(&format!("{value}.bat")))
            .with_context(|| format!("launch executable not found on PATH: {value}"))
    })
}

fn split_command_line(command_line: &str) -> Result<Vec<String>> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = command_line.trim().chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match ch {
            '"' | '\'' if quote.is_none() => quote = Some(ch),
            '"' | '\'' if quote == Some(ch) => quote = None,
            '\\' if quote == Some('"') && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            ch if ch.is_whitespace() && quote.is_none() => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }

    if quote.is_some() {
        bail!("launch command has an unterminated quote");
    }
    if !current.is_empty() {
        parts.push(current);
    }
    Ok(parts)
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

    // 2. Search PATH directly instead of spawning `where.exe`. Launching
    // console tools from a GUI app can flash an external console window.
    find_on_path(name).with_context(|| format!("executable not found on PATH: {name}"))
}

fn find_on_path(name: &str) -> Result<PathBuf> {
    let candidate = PathBuf::from(name);
    if candidate.is_absolute() || name.contains('\\') || name.contains('/') {
        if candidate.exists() {
            return Ok(candidate);
        }
        bail!("path does not exist: {name}");
    }

    let path_exts = path_extensions(name);
    let Some(paths) = env::var_os("PATH") else {
        bail!("PATH is not set");
    };

    for dir in env::split_paths(&paths) {
        for ext in &path_exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    bail!("not found on PATH: {name}");
}

fn path_extensions(name: &str) -> Vec<String> {
    if PathBuf::from(name).extension().is_some() {
        return vec![String::new()];
    }

    let raw = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    let mut exts = vec![String::new()];
    exts.extend(
        raw.split(';')
            .map(str::trim)
            .filter(|ext| !ext.is_empty())
            .map(|ext| {
                if ext.starts_with('.') {
                    ext.to_string()
                } else {
                    format!(".{ext}")
                }
            }),
    );
    exts
}
