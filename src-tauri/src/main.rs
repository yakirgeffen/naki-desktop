#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{Connection, OpenFlags, Result as SqlResult};
use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

#[derive(Serialize)]
struct ChatInfo {
    jid: String,
    name: String,
    size_bytes: u64,
    last_active: Option<f64>,
}

fn get_whatsapp_container_path() -> Option<PathBuf> {
    let home = env::var("HOME").ok()?;
    let path = PathBuf::from(home).join("Library/Group Containers/group.net.whatsapp.WhatsApp.shared");
    if path.exists() { Some(path) } else { None }
}

#[tauri::command]
async fn scan_chats() -> Result<Vec<ChatInfo>, String> {
    let base_path = get_whatsapp_container_path().ok_or("WhatsApp Desktop directory not found.")?;
    
    let original_db_path = base_path.join("ChatStorage.sqlite");
    if !original_db_path.exists() {
        return Err("Could not find ChatStorage.sqlite. Please ensure WhatsApp Desktop is installed and synced on this Mac.".to_string());
    }

    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    let temp_dir = env::temp_dir().join(format!("whatscleaner_temp_{}", timestamp));
    
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Temp directory error: {}", e))?;
    
    let main_dst = temp_dir.join("ChatStorage.sqlite");
    fs::copy(&original_db_path, &main_dst).map_err(|e| format!("Failed to copy main database: {}", e))?;

    for sidecar in ["ChatStorage.sqlite-wal", "ChatStorage.sqlite-shm"] {
        let s_src = base_path.join(sidecar);
        if s_src.exists() {
            let _ = fs::copy(&s_src, temp_dir.join(sidecar));
        }
    }

    let conn = Connection::open_with_flags(
        &main_dst,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    ).map_err(|e| format!("Database lock error: {}", e))?;

    let mut stmt = conn.prepare(
        "SELECT ZCONTACTJID, ZPARTNERNAME, ZLASTMESSAGEDATE 
         FROM ZWACHATSESSION 
         WHERE ZSESSIONTYPE = 1 OR ZCONTACTJID LIKE '%@g.us'"
    ).map_err(|e| format!("Database query failed: {}", e))?;

    let chat_iter = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "(Unknown Group)".to_string()),
            row.get::<_, Option<f64>>(2)?,
        ))
    }).map_err(|e| format!("Failed to parse database rows: {}", e))?;

    let mut chats = Vec::new();
    let media_base_path = base_path.join("Message/Media");

    for chat_result in chat_iter {
        if let Ok((jid, name, last_active)) = chat_result {
            let media_path = media_base_path.join(&jid);
            let mut size_bytes = 0;

            if media_path.exists() {
                for entry in WalkDir::new(&media_path).into_iter().filter_map(|e| e.ok()) {
                    if let Ok(metadata) = entry.metadata() {
                        if metadata.is_file() {
                            size_bytes += metadata.len();
                        }
                    }
                }
            }

            if size_bytes > 0 {
                chats.push(ChatInfo { jid, name, size_bytes, last_active });
            }
        }
    }

    chats.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let _ = fs::remove_dir_all(&temp_dir);

    Ok(chats)
}

#[tauri::command]
async fn delete_media(jids: Vec<String>) -> Result<(), String> {
    let base_path = get_whatsapp_container_path().ok_or("WhatsApp Desktop directory not found.")?;
    let media_base_path = base_path.join("Message/Media");

    for jid in jids {
        // Essential Guardrail: Prevent directory traversal injection
        if jid.contains('/') || jid.contains('\\') || jid.contains("..") {
            continue; 
        }

        let target_path = media_base_path.join(&jid);
        
        // Safely move the exact media folder to the macOS Trash
        if target_path.exists() {
            trash::delete(&target_path).map_err(|e| format!("Failed to trash media for {}: {}", jid, e))?;
        }
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init()) 
        .invoke_handler(tauri::generate_handler![scan_chats, delete_media]) // <-- Registered here
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}