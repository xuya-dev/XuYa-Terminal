// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::pty_open,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::save_temp_image,
            commands::clipboard_has_image,
            commands::find_latest_agent_session,
            commands::get_agent_config_state,
            commands::apply_agent_provider_config,
            commands::save_agent_custom_provider,
            commands::save_agent_builtin_provider,
            commands::delete_agent_custom_provider,
            commands::fetch_agent_provider_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XuYa");
}
