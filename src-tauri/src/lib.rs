use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};

const IMG_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MdFile {
    name: String,
    content: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFiles {
    project_json: Option<String>,
    recovered_from_backup: bool,
    entities: Vec<MdFile>,
    research: Vec<MdFile>,
    documents: Vec<MdFile>,
    /// assets/ 下的图片,content 为 base64
    assets: Vec<MdFile>,
}

/// 只吃 entity-*(实体头像)小图。资源原文件(asset-*)体积可能很大,
/// 不随项目加载整读进内存,由 list_asset_files / read_asset_file 按需访问;
/// 外部放进 assets/ 的其他文件也因此不进 knownManaged 差量删除集合。
fn read_asset_dir(dir: &Path) -> Result<Vec<MdFile>, String> {
    let mut out = Vec::new();
    if dir.is_dir() {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_img = path
                .extension()
                .map(|e| IMG_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
                .unwrap_or(false);
            if path.is_file() && is_img && name.starts_with("entity-") {
                let bytes = fs::read(&path).map_err(|e| format!("{name}: {e}"))?;
                out.push(MdFile {
                    name,
                    content: base64::engine::general_purpose::STANDARD.encode(bytes),
                });
            }
        }
    }
    Ok(out)
}

/* ---------- 资源原文件(R8):assets/asset-*.*,按内容哈希命名,增量单文件读写 ---------- */

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetFileInfo {
    name: String,
    size: u64,
}

/// 原文件名白名单:asset- 前缀 + 字母数字 . _ -,杜绝路径穿越
fn valid_asset_name(name: &str) -> bool {
    name.starts_with("asset-")
        && name.len() <= 120
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn asset_path(dir: &str, name: &str) -> Result<PathBuf, String> {
    if !valid_asset_name(name) {
        return Err(format!("非法资源文件名:{name}"));
    }
    Ok(PathBuf::from(dir).join("assets").join(name))
}

/// 列出 assets/ 下所有资源原文件(名称 + 字节数),不读内容
#[tauri::command]
fn list_asset_files(dir: String) -> Result<Vec<AssetFileInfo>, String> {
    let base = PathBuf::from(&dir).join("assets");
    let mut out = Vec::new();
    if base.is_dir() {
        for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_file() && valid_asset_name(&name) {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                out.push(AssetFileInfo { name, size });
            }
        }
    }
    Ok(out)
}

/// 读取单个资源原文件,返回 base64
#[tauri::command]
fn read_asset_file(dir: String, name: String) -> Result<String, String> {
    let path = asset_path(&dir, &name)?;
    let bytes = fs::read(&path).map_err(|e| format!("{name}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// 写入单个资源原文件(base64)。文件按内容哈希命名,同名即同内容,已存在时直接跳过
#[tauri::command]
fn write_asset_file(dir: String, name: String, content: String) -> Result<(), String> {
    let path = asset_path(&dir, &name)?;
    if path.is_file() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&content)
        .map_err(|e| format!("{name}: {e}"))?;
    replace_file(&path, &bytes).map_err(|e| format!("{name}: {e}"))
}

/// 删除一组资源原文件(仅 asset-* 名称;供「清理未引用原文件」显式调用)
#[tauri::command]
fn delete_asset_files(dir: String, names: Vec<String>) -> Result<(), String> {
    for name in &names {
        let path = asset_path(&dir, name)?;
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| format!("{name}: {e}"))?;
        }
    }
    Ok(())
}

fn read_md_dir(dir: &Path) -> Result<Vec<MdFile>, String> {
    let mut out = Vec::new();
    if dir.is_dir() {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let is_md = path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("md"))
                .unwrap_or(false);
            if path.is_file() && is_md {
                let name = entry.file_name().to_string_lossy().to_string();
                let content = fs::read_to_string(&path).map_err(|e| format!("{name}: {e}"))?;
                out.push(MdFile { name, content });
            }
        }
    }
    Ok(out)
}

/// 读取项目文件夹:project.json + entities/*.md + research/*.md + documents/*.md
#[tauri::command]
fn load_project_dir(dir: String) -> Result<ProjectFiles, String> {
    let base = PathBuf::from(&dir);
    if !base.is_dir() {
        return Err(format!("目录不存在:{dir}"));
    }
    let primary = fs::read_to_string(base.join("project.json")).ok();
    let backup = fs::read_to_string(base.join("project.json.bak")).ok();
    let primary_valid = primary.as_deref().map(valid_project_json).unwrap_or(false);
    let backup_valid = backup.as_deref().map(valid_project_json).unwrap_or(false);
    let recovered_from_backup = !primary_valid && backup_valid;
    let project_json = if primary_valid {
        primary
    } else if backup_valid {
        backup
    } else {
        primary.or(backup)
    };
    Ok(ProjectFiles {
        project_json,
        recovered_from_backup,
        entities: read_md_dir(&base.join("entities"))?,
        research: read_md_dir(&base.join("research"))?,
        documents: read_md_dir(&base.join("documents"))?,
        assets: read_asset_dir(&base.join("assets"))?,
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteSpec {
    rel_path: String,
    content: String,
    /// true 时 content 为 base64,按二进制写入
    #[serde(default)]
    base64: bool,
}

fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.contains("..") || rel.starts_with(['/', '\\']) || rel.contains(':') {
        return Err(format!("非法路径:{rel}"));
    }
    Ok(base.join(rel))
}

const MANAGED_DIRS: [&str; 4] = ["entities/", "research/", "documents/", "assets/"];
const PROJECT_BACKUP_INTERVAL_SECS: u64 = 10 * 60;

fn valid_project_json(data: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
        return false;
    };
    value.get("version").and_then(|version| version.as_u64()) == Some(1)
        && value.get("name").and_then(|name| name.as_str()).is_some()
        && value
            .get("flows")
            .and_then(|flows| flows.as_array())
            .is_some()
}

fn replace_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let temp = path.with_file_name(format!(".{name}.theloom-tmp"));
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    if path.exists() {
        if let Err(error) = fs::remove_file(path) {
            fs::remove_file(&temp).ok();
            return Err(error.to_string());
        }
    }
    if let Err(error) = fs::rename(&temp, path) {
        fs::remove_file(&temp).ok();
        return Err(error.to_string());
    }
    Ok(())
}

fn maybe_backup_project(path: &Path) -> Result<(), String> {
    let Ok(previous) = fs::read_to_string(path) else {
        return Ok(());
    };
    if !valid_project_json(&previous) {
        return Ok(());
    }
    let backup = path.with_file_name("project.json.bak");
    let should_refresh = if !backup.exists() {
        true
    } else {
        backup
            .metadata()
            .and_then(|meta| meta.modified())
            .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
            .map(|elapsed| elapsed.as_secs() >= PROJECT_BACKUP_INTERVAL_SECS)
            .unwrap_or(false)
    };
    if should_refresh {
        replace_file(&backup, previous.as_bytes())?;
    }
    Ok(())
}

/// 写入项目文件夹,并删除前端明确指出的已删除条目
/// (只删本会话加载过 / 写入过的文件,外部新建的文件不受影响)
#[tauri::command]
fn save_project_dir(
    dir: String,
    files: Vec<WriteSpec>,
    delete_files: Vec<String>,
) -> Result<(), String> {
    let base = PathBuf::from(&dir);
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;

    for f in &files {
        let path = safe_join(&base, &f.rel_path)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if f.rel_path == "project.json" {
            maybe_backup_project(&path)?;
        }
        let bytes = if f.base64 {
            base64::engine::general_purpose::STANDARD
                .decode(&f.content)
                .map_err(|e| format!("{}: {e}", f.rel_path))?
        } else {
            f.content.as_bytes().to_vec()
        };
        replace_file(&path, &bytes).map_err(|e| format!("{}: {e}", f.rel_path))?;
    }

    for rel in &delete_files {
        if !MANAGED_DIRS.iter().any(|d| rel.starts_with(d)) {
            return Err(format!("拒绝删除受管目录之外的文件:{rel}"));
        }
        let path = safe_join(&base, rel)?;
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| format!("{rel}: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_then_load_roundtrip_and_cleanup() {
        let dir = std::env::temp_dir().join(format!("theloom-test-{}", std::process::id()));
        let dir_s = dir.to_string_lossy().to_string();

        let png_b64 = base64::engine::general_purpose::STANDARD.encode([137u8, 80, 78, 71]);
        save_project_dir(
            dir_s.clone(),
            vec![
                WriteSpec {
                    rel_path: "project.json".into(),
                    content: "{\"version\":1,\"name\":\"first\",\"flows\":[]}".into(),
                    base64: false,
                },
                WriteSpec {
                    rel_path: "entities/林晚.md".into(),
                    content: "---\nid: e1\n---\n简介".into(),
                    base64: false,
                },
                WriteSpec {
                    rel_path: "research/织机.md".into(),
                    content: "---\nid: c1\n---\n正文".into(),
                    base64: false,
                },
                WriteSpec {
                    rel_path: "documents/草稿.md".into(),
                    content: "---\nid: d1\n---\n正文".into(),
                    base64: false,
                },
                WriteSpec {
                    rel_path: "assets/entity-e1.png".into(),
                    content: png_b64.clone(),
                    base64: true,
                },
            ],
            vec![],
        )
        .unwrap();

        let loaded = load_project_dir(dir_s.clone()).unwrap();
        assert_eq!(
            loaded.project_json.as_deref(),
            Some("{\"version\":1,\"name\":\"first\",\"flows\":[]}")
        );
        assert!(!loaded.recovered_from_backup);
        assert_eq!(loaded.entities.len(), 1);
        assert_eq!(loaded.entities[0].name, "林晚.md");
        assert_eq!(loaded.research.len(), 1);
        assert_eq!(loaded.documents.len(), 1);
        assert_eq!(loaded.documents[0].name, "草稿.md");
        assert_eq!(loaded.assets.len(), 1);
        assert_eq!(loaded.assets[0].content, png_b64); // 二进制往返一致

        // 外部(如 Obsidian)新建的 md 不在删除列表里,必须原样保留
        fs::write(dir.join("entities/外部新建.md"), "---\n---\n手写").unwrap();

        // 实体被删除后,前端明确列出要清理的 md 与头像图片
        save_project_dir(
            dir_s.clone(),
            vec![WriteSpec {
                rel_path: "project.json".into(),
                content: "{\"version\":1,\"name\":\"second\",\"flows\":[]}".into(),
                base64: false,
            }],
            vec![
                "entities/林晚.md".into(),
                "documents/草稿.md".into(),
                "assets/entity-e1.png".into(),
            ],
        )
        .unwrap();
        let loaded = load_project_dir(dir_s.clone()).unwrap();
        assert_eq!(loaded.entities.len(), 1); // 外部新建的保留
        assert_eq!(loaded.entities[0].name, "外部新建.md");
        assert_eq!(loaded.research.len(), 1); // 未列入删除的保留
        assert_eq!(loaded.documents.len(), 0); // 删除已生效
        assert_eq!(loaded.assets.len(), 0);

        fs::write(dir.join("project.json"), "{broken").unwrap();
        let recovered = load_project_dir(dir_s.clone()).unwrap();
        assert_eq!(
            recovered.project_json.as_deref(),
            Some("{\"version\":1,\"name\":\"first\",\"flows\":[]}")
        );
        assert!(recovered.recovered_from_backup);

        // 路径穿越必须被拒绝
        let bad = save_project_dir(
            dir_s.clone(),
            vec![WriteSpec {
                rel_path: "../escape.txt".into(),
                content: "x".into(),
                base64: false,
            }],
            vec![],
        );
        assert!(bad.is_err());

        // 删除列表同样不允许路径穿越 / 受管目录之外的文件
        let bad = save_project_dir(
            dir_s.clone(),
            vec![],
            vec!["entities/../project.json".into()],
        );
        assert!(bad.is_err());
        let bad = save_project_dir(dir_s.clone(), vec![], vec!["project.json".into()]);
        assert!(bad.is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn asset_file_commands_roundtrip_and_guard() {
        let dir = std::env::temp_dir().join(format!("theloom-asset-test-{}", std::process::id()));
        let dir_s = dir.to_string_lossy().to_string();
        fs::create_dir_all(dir.join("assets")).unwrap();

        let b64 = base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3, 4, 5]);
        write_asset_file(dir_s.clone(), "asset-abcd1234.png".into(), b64.clone()).unwrap();
        // 同名(同内容哈希)再写直接跳过,不报错
        write_asset_file(dir_s.clone(), "asset-abcd1234.png".into(), "ignored".into()).unwrap();
        assert_eq!(
            read_asset_file(dir_s.clone(), "asset-abcd1234.png".into()).unwrap(),
            b64
        );

        // 头像与外部文件不进原文件清单;asset-* 才算
        fs::write(dir.join("assets/entity-e1.png"), [9u8]).unwrap();
        fs::write(dir.join("assets/外部随手放的.png"), [9u8]).unwrap();
        let listed = list_asset_files(dir_s.clone()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "asset-abcd1234.png");
        assert_eq!(listed[0].size, 5);

        // load_project_dir 的 assets 只吃 entity-* 头像,原文件不整读进内存
        let loaded = load_project_dir(dir_s.clone()).unwrap();
        assert_eq!(loaded.assets.len(), 1);
        assert_eq!(loaded.assets[0].name, "entity-e1.png");

        // 名称白名单:路径穿越 / 非 asset- 前缀一律拒绝
        assert!(read_asset_file(dir_s.clone(), "../project.json".into()).is_err());
        assert!(write_asset_file(dir_s.clone(), "entity-e1.png".into(), b64.clone()).is_err());
        assert!(delete_asset_files(dir_s.clone(), vec!["asset-x/../../y.png".into()]).is_err());

        delete_asset_files(dir_s.clone(), vec!["asset-abcd1234.png".into()]).unwrap();
        assert!(list_asset_files(dir_s.clone()).unwrap().is_empty());
        // 头像与外部文件安然无恙
        assert!(dir.join("assets/entity-e1.png").is_file());
        assert!(dir.join("assets/外部随手放的.png").is_file());

        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            load_project_dir,
            save_project_dir,
            list_asset_files,
            read_asset_file,
            write_asset_file,
            delete_asset_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
