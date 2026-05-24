#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::Connection;
use serde::Serialize;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

#[derive(Serialize)]
struct MediaBreakdown {
    videos: u64,
    images: u64,
    audio: u64,
    documents: u64,
    other: u64,
}

#[derive(Serialize)]
struct ChatInfo {
    jid: String,
    name: String,
    is_group: bool,
    size_bytes: u64,
    breakdown: MediaBreakdown,
    last_active: Option<f64>,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct AppConfig {
    has_used_free_sweep: bool,
    is_pro: bool,
    #[serde(default)]
    hardware_fingerprint: Option<String>,
}

// --- Helper Functions for Config ---

fn get_config_path(app: &AppHandle) -> PathBuf {
    let app_dir = app.path().app_data_dir().unwrap_or_else(|_| env::temp_dir());
    if !app_dir.exists() {
        let _ = fs::create_dir_all(&app_dir);
    }
    app_dir.join("naki_config.json")
}

fn read_config(app: &AppHandle) -> AppConfig {
    let path = get_config_path(app);
    if let Ok(mut file) = fs::File::open(path) {
        let mut contents = String::new();
        if file.read_to_string(&mut contents).is_ok() {
            if let Ok(config) = serde_json::from_str(&contents) {
                return config;
            }
        }
    }
    AppConfig::default()
}

fn save_config(app: &AppHandle, config: &AppConfig) {
    let path = get_config_path(app);
    if let Ok(mut file) = fs::File::create(path) {
        let json = serde_json::to_string(config).unwrap_or_default();
        let _ = file.write_all(json.as_bytes());
    }
}

// --- Tauri Commands ---

fn get_whatsapp_container_path() -> Option<PathBuf> {
    let home = env::var("HOME").ok()?;
    let path = PathBuf::from(home).join("Library/Group Containers/group.net.whatsapp.WhatsApp.shared");
    if path.exists() { Some(path) } else { None }
}

fn get_hardware_fingerprint() -> String {
    use std::process::Command;
    use sha2::{Sha256, Digest};

    let stdout = Command::new("/usr/sbin/system_profiler")
        .args(["SPHardwareDataType"])
        .output()
        .map(|o| o.stdout)
        .unwrap_or_default();

    let raw = String::from_utf8_lossy(&stdout);
    let serial = raw.lines()
        .find(|l| l.contains("Serial Number"))
        .and_then(|l| l.split(':').nth(1))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let host = Command::new("/bin/hostname").output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|_| "unknown-host".to_string());
            let osver = Command::new("/usr/bin/sw_vers").args(["-productVersion"]).output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|_| "unknown-os".to_string());
            format!("fallback:{}:{}", host, osver)
        });

    let mut hasher = Sha256::new();
    hasher.update(serial.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[tauri::command]
async fn scan_chats() -> Result<Vec<ChatInfo>, String> {
    let base_path = get_whatsapp_container_path().ok_or("WhatsApp Desktop directory not found.")?;
    
    let original_db_path = base_path.join("ChatStorage.sqlite");
    if !original_db_path.exists() {
        return Err("Could not find ChatStorage.sqlite. Please ensure WhatsApp Desktop is installed and synced on this Mac.".to_string());
    }

    // THE UPGRADE: Connect directly to the live database as a concurrent reader.
    // This completely removes the need for temporary files and prevents the "Torn WAL" crash.
    let conn = Connection::open_with_flags(
        &original_db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ).map_err(|e| format!("Database open error: {}", e))?;

    // Wait up to 5 seconds if WhatsApp is actively checkpointing data
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    // Grab every single chat. Let the file system check (media_path.exists) do the filtering.
    let mut stmt = conn.prepare(
        "SELECT ZCONTACTJID, ZPARTNERNAME, ZLASTMESSAGEDATE 
         FROM ZWACHATSESSION 
         WHERE ZCONTACTJID IS NOT NULL"
    ).map_err(|e| format!("Database query failed: {}", e))?;

    let chat_iter = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "(Unknown)".to_string()),
            row.get::<_, Option<f64>>(2)?,
        ))
    }).map_err(|e| format!("Failed to parse database rows: {}", e))?;

    let mut chats = Vec::new();
    let media_base_path = base_path.join("Message/Media");

    for chat_result in chat_iter {
        if let Ok((jid, name, last_active)) = chat_result {
            let is_group = jid.ends_with("@g.us"); 
            let media_path = media_base_path.join(&jid);
            let mut size_bytes = 0;
            
            let mut breakdown = MediaBreakdown {
                videos: 0,
                images: 0,
                audio: 0,
                documents: 0,
                other: 0,
            };

            if media_path.exists() {
                for entry in WalkDir::new(&media_path).into_iter().filter_map(|e| e.ok()) {
                    let path = entry.path();
                    if let Ok(metadata) = entry.metadata() {
                        if metadata.is_file() {
                            let len = metadata.len();
                            size_bytes += len;
                            
                            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                                match ext.to_lowercase().as_str() {
                                    "mp4" | "mov" | "avi" | "mkv" => breakdown.videos += len,
                                    "jpg" | "jpeg" | "png" | "heic" | "webp" | "gif" => breakdown.images += len,
                                    "opus" | "m4a" | "mp3" | "ogg" | "wav" | "aac" => breakdown.audio += len,
                                    "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" => breakdown.documents += len,
                                    _ => breakdown.other += len,
                                }
                            } else {
                                breakdown.other += len;
                            }
                        }
                    }
                }
            }

            if size_bytes > 0 {
                chats.push(ChatInfo { jid, name, is_group, size_bytes, breakdown, last_active });
            }
        }
    }

    chats.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Ok(chats)
}

#[tauri::command]
async fn delete_media(app: AppHandle, jids: Vec<String>) -> Result<(), String> {
    // Freemium gate — server-side enforcement with machine binding (CSO-Security)
    let mut config = read_config(&app);
    let current_fp = get_hardware_fingerprint();
    if !config.is_pro && config.has_used_free_sweep {
        match config.hardware_fingerprint.as_deref() {
            Some(stored) if stored == current_fp => {
                return Err("Free sweep already used on this machine. Upgrade to Pro for unlimited sweeps.".into());
            }
            _ => {
                return Err("License not valid for this machine.".into());
            }
        }
    }
    if config.hardware_fingerprint.is_none() {
        config.hardware_fingerprint = Some(current_fp);
        save_config(&app, &config);
    }

    let base_path = get_whatsapp_container_path().ok_or("WhatsApp Desktop directory not found.")?;
    let media_base_path = base_path.join("Message/Media");

    for jid in jids {
        if jid.contains('/') || jid.contains('\\') || jid.contains("..") {
            continue; 
        }

        let target_path = media_base_path.join(&jid);
        if target_path.exists() {
            trash::delete(&target_path).map_err(|e| format!("Failed to trash media for {}: {}", jid, e))?;
        }
    }

    let mut config = read_config(&app);
    if !config.has_used_free_sweep {
        config.has_used_free_sweep = true;
        save_config(&app, &config);
    }

    Ok(())
}

#[tauri::command]
fn get_license_state(app: AppHandle) -> AppConfig {
    let mut config = read_config(&app);
    if config.hardware_fingerprint.is_none() {
        config.hardware_fingerprint = Some(get_hardware_fingerprint());
        save_config(&app, &config);
    }
    config
}

#[tauri::command]
async fn verify_gumroad_license(app: AppHandle, license_key: String) -> Result<bool, String> {
    let product_permalink = "naki"; 
    
    let url = "https://api.gumroad.com/v2/licenses/verify";
    let client = reqwest::Client::new();
    
    let res = client.post(url)
        .form(&[
            ("product_permalink", product_permalink),
            ("license_key", &license_key)
        ])
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.map_err(|_| "Failed to parse Gumroad response")?;
        
        if json["success"].as_bool().unwrap_or(false) {
            let mut config = read_config(&app);
            config.is_pro = true;
            save_config(&app, &config);
            return Ok(true);
        }
    }
    
    Ok(false)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init()) 
        .invoke_handler(tauri::generate_handler![
            scan_chats, 
            delete_media, 
            get_license_state, 
            verify_gumroad_license
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}