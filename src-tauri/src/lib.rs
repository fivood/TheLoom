use std::fs;
use std::path::{Path, PathBuf};

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

/// 读取项目文件夹:project.json + entities/*.md + research/*.md
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
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteSpec {
    rel_path: String,
    content: String,
}

fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.contains("..") || rel.starts_with(['/', '\\']) || rel.contains(':') {
        return Err(format!("非法路径:{rel}"));
    }
    Ok(base.join(rel))
}

/// 写入项目文件夹,并清理 entities/ 与 research/ 下已被删除条目的 .md 文件
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
        fs::write(&path, &f.content).map_err(|e| format!("{}: {e}", f.rel_path))?;
    }

    for sub in ["entities", "research"] {
        let d = base.join(sub);
        if !d.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&d).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let is_md = path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("md"))
                .unwrap_or(false);
            if path.is_file() && is_md {
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

        save_project_dir(
            dir_s.clone(),
            vec![
                WriteSpec { rel_path: "project.json".into(), content: "{\"version\":1}".into() },
                WriteSpec { rel_path: "entities/林晚.md".into(), content: "---\nid: e1\n---\n简介".into() },
                WriteSpec { rel_path: "research/织机.md".into(), content: "---\nid: c1\n---\n正文".into() },
            ],
            vec!["entities/林晚.md".into(), "research/织机.md".into()],
        )
        .unwrap();

        let loaded = load_project_dir(dir_s.clone()).unwrap();
        assert_eq!(loaded.project_json.as_deref(), Some("{\"version\":1}"));
        assert_eq!(loaded.entities.len(), 1);
        assert_eq!(loaded.entities[0].name, "林晚.md");
        assert_eq!(loaded.research.len(), 1);

        // 实体被删除后,对应 md 应被清理
        save_project_dir(
            dir_s.clone(),
            vec![WriteSpec { rel_path: "project.json".into(), content: "{}".into() }],
            vec!["research/织机.md".into()],
        )
        .unwrap();
        let loaded = load_project_dir(dir_s.clone()).unwrap();
        assert_eq!(loaded.entities.len(), 0);
        assert_eq!(loaded.research.len(), 1);

        // 路径穿越必须被拒绝
        let bad = save_project_dir(
            dir_s.clone(),
            vec![WriteSpec { rel_path: "../escape.txt".into(), content: "x".into() }],
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
        .invoke_handler(tauri::generate_handler![load_project_dir, save_project_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
