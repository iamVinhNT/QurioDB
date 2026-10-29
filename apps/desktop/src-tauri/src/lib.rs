//! @file lib.rs
//! @description Main Tauri application setup and Linux WebView configuration.

mod backend;
mod update;

use backend::{BackendManager, BackendStatus};
use tauri::{Manager, RunEvent, State, WindowEvent};

#[cfg(target_os = "linux")]
fn configure_linux_webkit_ime(app: &tauri::App) -> tauri::Result<()> {
    use webkit2gtk::{InputMethodContextExt, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        log::warn!("Main webview window not found; skipping Linux IME configuration.");
        return Ok(());
    };

    window.with_webview(|webview| {
        if let Some(input_method_context) = webview.inner().input_method_context() {
            input_method_context.set_enable_preedit(true);
            log::info!("Enabled Linux WebKitGTK IME preedit.");
        } else {
            log::warn!("Linux WebKitGTK input method context unavailable.");
        }
    })?;

    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webkit_ime(_app: &tauri::App) -> tauri::Result<()> {
    Ok(())
}

#[tauri::command]
fn get_backend_status(state: State<'_, BackendManager>) -> BackendStatus {
    state.status()
}

#[tauri::command]
fn restart_backend(app: tauri::AppHandle) -> Result<BackendStatus, String> {
    backend::restart_backend(app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .manage(BackendManager::default())
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            restart_backend,
            update::check_for_update,
            update::open_release_page
        ])
        .setup(|app| {
            configure_linux_webkit_ime(app)?;
            if let Err(error) = backend::start_backend(app.handle().clone()) {
                log::error!("Initial backend startup failed: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { .. },
                ..
            }
            | RunEvent::Exit => {
                let manager = app_handle.state::<BackendManager>();
                backend::shutdown_backend(&manager);
            }
            _ => {}
        });
}
