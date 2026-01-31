#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Manager, WindowEvent};

struct ApiProcess(Arc<Mutex<Option<Child>>>);

fn spawn_api(app: &tauri::AppHandle) -> Result<Child, Box<dyn std::error::Error>> {
  let resource_dir = app
    .path()
    .resource_dir()
    .map_err(|err| -> Box<dyn std::error::Error> { Box::new(err) })?;
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|err| -> Box<dyn std::error::Error> { Box::new(err) })?;
  fs::create_dir_all(&app_data_dir)?;

  let api_dir = resource_dir.join("api");
  let entry = api_dir.join("dist").join("index.js");
  let node_modules = resource_dir.join("node_modules");
  let storage_root = app_data_dir.join("storage");
  let memory_root = app_data_dir.join("memory");
  fs::create_dir_all(&storage_root)?;
  fs::create_dir_all(&memory_root)?;

  let db_path = app_data_dir.join("pro-chat.db");
  let db_url = format!(
    "file://{}",
    db_path.to_string_lossy().replace(' ', "%20")
  );

  if !entry.exists() {
    return Err(format!("API entry not found at {}", entry.display()).into());
  }

  let bundled_node = resource_dir.join("bin").join("node");
  let node_command: PathBuf = if bundled_node.exists() {
    bundled_node
  } else {
    PathBuf::from("node")
  };

  let child = Command::new(node_command)
    .arg(entry)
    .current_dir(&api_dir)
    .env("NODE_PATH", &node_modules)
    .env("DATABASE_URL", db_url)
    .env("STORAGE_PATH", storage_root)
    .env("MEMORY_PATH", memory_root)
    .stdin(Stdio::null())
    .stdout(Stdio::inherit())
    .stderr(Stdio::inherit())
    .spawn()?;

  Ok(child)
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      if !cfg!(debug_assertions) {
        match spawn_api(&app.handle()) {
          Ok(child) => {
            app.manage(ApiProcess(Arc::new(Mutex::new(Some(child)))));
          }
          Err(err) => {
            eprintln!("Failed to start API server: {err}");
          }
        }
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { .. } = event {
        if let Some(state) = window.app_handle().try_state::<ApiProcess>() {
          if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
              let _ = child.kill();
            }
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
