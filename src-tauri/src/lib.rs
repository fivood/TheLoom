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
    entities: Vec<MdFile>,
    research: Vec<MdFile>,
    documents: Vec<MdFile>,
    /// assets/ 下的图片,content 为 base64
    assets: Vec<MdFile>,
}

fn read_asset_dir(dir: &Path) -> Result<Vec<MdFile>, String> {
    let mut out = Vec::new();
    if dir.is_dir() {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let is_img = path
                .extension()
                .map(|e| IMG_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
                .unwrap_or(false);
            if path.is_file() && is_img {
                let name = entry.file_name().to_string_lossy().to_string();
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
                let content =
                    fs::read_to_string(&path).map_err(|e| format!("{name}: {e}"))?;
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
    Ok(ProjectFiles {
        project_json: fs::read_to_string(base.join("project.json")).ok(),
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

/// 写入项目文件夹,并清理 entities/、research/ 下已删除条目的 .md
/// 与 assets/ 下已删除的图片
#[tauri::command]
fn save_project_dir(
    dir: String,
    files: Vec<WriteSpec>,
    keep_md: Vec<String>,
) -> Result<(), String> {
    let base = PathBuf::from(&dir);
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;

    for f in &files {
        let path = safe_join(&base, &f.rel_path)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if f.base64 {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&f.content)
                .map_err(|e| format!("{}: {e}", f.rel_path))?;
            fs::write(&path, bytes).map_err(|e| format!("{}: {e}", f.rel_path))?;
        } else {
            fs::write(&path, &f.content).map_err(|e| format!("{}: {e}", f.rel_path))?;
        }
    }

    for sub in ["entities", "research", "documents", "assets"] {
        let d = base.join(sub);
        if !d.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&d).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let managed = path
                .extension()
                .map(|e| {
                    if sub == "assets" {
                        IMG_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x))
                    } else {
                        e.eq_ignore_ascii_case("md")
                    }
                })
                .unwrap_or(false);
            if path.is_file() && managed {
                let rel = format!("{}/{}", sub, entry.file_name().to_string_lossy());
                if !keep_md.contains(&rel) {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                }
            }
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
            WriteSpec { rel_path: "project.json".into(), content: "{\"version\":1}".into(), base64: false },
            WriteSpec { rel_path: "entities/林晚.md".into(), content: "---\nid: e1\n---\n简介".into(), base64: false },
            WriteSpec { rel_path: "research/织机.md".into(), content: "---\nid: c1\n---\n正文".into(), base64: false },
            WriteSpec { rel_path: "documents/草稿.md".into(), content: "---\nid: d1\n---\n正文".into(), base64: false },
            WriteSpec { rel_path: "assets/entity-e1.png".into(), content: png_b64.clone(), base64: true },
        ],
        vec!["entities/林晚.md".into(), "research/织机.md".into(), "documents/草稿.md".into(), "assets/entity-e1.png".into()],
    )
    .unwrap();

    let loaded = load_project_dir(dir_s.clone()).unwrap();
    assert_eq!(loaded.project_json.as_deref(), Some("{\"version\":1}"));
    assert_eq!(loaded.entities.len(), 1);
    assert_eq!(loaded.entities[0].name, "林晚.md");
    assert_eq!(loaded.research.len(), 1);
    assert_eq!(loaded.documents.len(), 1);
    assert_eq!(loaded.documents[0].name, "草稿.md");
    assert_eq!(loaded.assets.len(), 1);
    assert_eq!(loaded.assets[0].content, png_b64); // 二进制往返一致

        // 实体被删除后,对应 md 与头像图片应被清理
        save_project_dir(
            dir_s.clone(),
            vec![WriteSpec { rel_path: "project.json".into(), content: "{}".into(), base64: false }],
        vec!["research/织机.md".into()],
    )
    .unwrap();
    let loaded = load_project_dir(dir_s.clone()).unwrap();
    assert_eq!(loaded.entities.len(), 0);
    assert_eq!(loaded.research.len(), 1);
    assert_eq!(loaded.documents.len(), 0); // 删除已生效
    assert_eq!(loaded.assets.len(), 0);

        // 路径穿越必须被拒绝
        let bad = save_project_dir(
            dir_s.clone(),
            vec![WriteSpec { rel_path: "../escape.txt".into(), content: "x".into(), base64: false }],
            vec![],
        );
        assert!(bad.is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![load_project_dir, save_project_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
