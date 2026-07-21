use base64::Engine;
use keyring_core::Entry;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

const IMG_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
const LLM_KEYRING_SERVICE: &str = "com.fivood.theloom.llm";
static LLM_KEYRING_INIT: OnceLock<Result<(), String>> = OnceLock::new();
const LLM_PROVIDERS: [&str; 10] = [
    "openai",
    "anthropic",
    "deepseek",
    "kimi",
    "qwen",
    "glm",
    "minimax",
    "ollama",
    "custom-openai",
    "custom-anthropic",
];

fn llm_credential(provider: &str) -> Result<Entry, String> {
    if !LLM_PROVIDERS.contains(&provider) {
        return Err("未知 AI 服务商".into());
    }
    LLM_KEYRING_INIT
        .get_or_init(|| {
            let store = windows_native_keyring_store::Store::new()
                .map_err(|e| format!("Windows 凭据管理器不可用:{e}"))?;
            keyring_core::set_default_store(store);
            Ok(())
        })
        .clone()?;
    Entry::new(LLM_KEYRING_SERVICE, provider).map_err(|e| format!("系统凭据库不可用:{e}"))
}

#[tauri::command]
fn set_llm_secret(provider: String, secret: String) -> Result<(), String> {
    if secret.is_empty() || secret.len() > 16384 {
        return Err("API Key 长度无效".into());
    }
    llm_credential(&provider)?
        .set_password(&secret)
        .map_err(|e| format!("保存系统凭据失败:{e}"))
}

#[tauri::command]
fn has_llm_secret(provider: String) -> Result<bool, String> {
    match llm_credential(&provider)?.get_password() {
        Ok(secret) => Ok(!secret.is_empty()),
        Err(keyring_core::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("读取系统凭据失败:{e}")),
    }
}

#[tauri::command]
fn delete_llm_secret(provider: String) -> Result<(), String> {
    match llm_credential(&provider)?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("删除系统凭据失败:{e}")),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmHttpRequest {
    provider: String,
    protocol: String,
    auth_mode: String,
    url: String,
    body: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmHttpResponse {
    status: u16,
    body: String,
    request_id: Option<String>,
}

fn validate_llm_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "AI API 地址无效".to_string())?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("AI API 地址不能包含账号、密码或片段".into());
    }
    match url.scheme() {
        "https" => Ok(url),
        "http" => {
            let host = url.host_str().unwrap_or_default();
            if host == "localhost" || host == "127.0.0.1" || host == "::1" {
                Ok(url)
            } else {
                Err("远程 AI API 必须使用 HTTPS".into())
            }
        }
        _ => Err("AI API 仅支持 HTTPS；本机服务可使用 HTTP".into()),
    }
}

fn validate_llm_target(provider: &str, raw: &str) -> Result<reqwest::Url, String> {
    let url = validate_llm_url(raw)?;
    let host = url.host_str().unwrap_or_default();
    let allowed = match provider {
        "openai" => host == "api.openai.com",
        "anthropic" => host == "api.anthropic.com",
        "deepseek" => host == "api.deepseek.com",
        "kimi" => host == "api.moonshot.cn",
        "qwen" => host == "dashscope.aliyuncs.com" || host.ends_with(".maas.aliyuncs.com"),
        "glm" => host == "open.bigmodel.cn",
        "minimax" => host == "api.minimaxi.com",
        "ollama" => host == "localhost" || host == "127.0.0.1" || host == "::1",
        "custom-openai" | "custom-anthropic" => true,
        _ => false,
    };
    if allowed {
        Ok(url)
    } else {
        Err("该服务商的 API Key 只能发送到其官方域名；其他地址请使用自定义兼容服务".into())
    }
}

#[tauri::command]
async fn llm_http_request(request: LlmHttpRequest) -> Result<LlmHttpResponse, String> {
    if !LLM_PROVIDERS.contains(&request.provider.as_str()) {
        return Err("未知 AI 服务商".into());
    }
    if request.protocol != "openai"
        && request.protocol != "anthropic"
        && request.protocol != "ollama"
    {
        return Err("未知 AI 协议".into());
    }
    if request.auth_mode != "bearer"
        && request.auth_mode != "x-api-key"
        && request.auth_mode != "none"
    {
        return Err("未知认证方式".into());
    }
    if request.body.len() > 4 * 1024 * 1024 {
        return Err("AI 请求内容超过 4 MB".into());
    }
    let url = validate_llm_target(&request.provider, &request.url)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("初始化安全请求失败:{e}"))?;
    let mut builder = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(request.body);
    if request.protocol == "anthropic" {
        builder = builder.header("anthropic-version", "2023-06-01");
    }
    if request.auth_mode != "none" {
        let secret = llm_credential(&request.provider)?
            .get_password()
            .map_err(|e| match e {
                keyring_core::Error::NoEntry => "尚未在系统凭据库保存 API Key".into(),
                other => format!("读取系统凭据失败:{other}"),
            })?;
        builder = if request.auth_mode == "x-api-key" {
            builder.header("x-api-key", secret)
        } else {
            builder.bearer_auth(secret)
        };
    }
    let response = builder
        .send()
        .await
        .map_err(|e| format!("AI 网络请求失败:{e}"))?;
    let status = response.status().as_u16();
    if response.content_length().unwrap_or(0) > 8 * 1024 * 1024 {
        return Err("AI 响应超过 8 MB".into());
    }
    let request_id = response
        .headers()
        .get("x-request-id")
        .or_else(|| response.headers().get("request-id"))
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取 AI 响应失败:{e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("AI 响应超过 8 MB".into());
    }
    Ok(LlmHttpResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
        request_id,
    })
}

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

fn read_md_dir_recursive(dir: &Path) -> Result<Vec<MdFile>, String> {
    let mut out = Vec::new();
    fn visit(base: &Path, current: &Path, out: &mut Vec<MdFile>) -> Result<(), String> {
        for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                visit(base, &path, out)?;
                continue;
            }
            let is_md = path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("md"))
                .unwrap_or(false);
            if !is_md {
                continue;
            }
            let name = path
                .strip_prefix(base)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let content = fs::read_to_string(&path).map_err(|e| format!("{name}: {e}"))?;
            out.push(MdFile { name, content });
        }
        Ok(())
    }
    if dir.is_dir() {
        visit(dir, dir, &mut out)?;
    }
    Ok(out)
}

/// 读取项目文件夹:project.json + entities/*.md + research/*.md + documents/**/*.md
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
        documents: read_md_dir_recursive(&base.join("documents"))?,
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
                    rel_path: "documents/第一卷/第一章/草稿.md".into(),
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
        assert_eq!(loaded.documents[0].name, "第一卷/第一章/草稿.md");
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
                "documents/第一卷/第一章/草稿.md".into(),
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

    #[test]
    fn llm_proxy_url_guard() {
        assert!(validate_llm_url("https://api.openai.com/v1/chat/completions").is_ok());
        assert!(validate_llm_url("http://127.0.0.1:11434/api/chat").is_ok());
        assert!(validate_llm_url("http://localhost:11434/api/chat").is_ok());
        assert!(validate_llm_url("http://api.example.com/chat").is_err());
        assert!(validate_llm_url("file:///tmp/key").is_err());
        assert!(validate_llm_url("https://user:pass@example.com/chat").is_err());
        assert!(validate_llm_url("https://example.com/chat#secret").is_err());
        assert!(
            validate_llm_target("openai", "https://api.openai.com/v1/chat/completions").is_ok()
        );
        assert!(validate_llm_target("openai", "https://evil.example/v1/chat/completions").is_err());
        assert!(validate_llm_target(
            "qwen",
            "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
        )
        .is_ok());
        assert!(validate_llm_target("custom-openai", "https://gateway.example/v1").is_ok());
        assert!(validate_llm_target("ollama", "https://remote.example/api/chat").is_err());
    }
}

/// 在系统文件管理器里打开一个已存在的目录 —— 项目菜单「打开文件夹」入口。
/// 支持 Windows / macOS / Linux;不递归、不接受非目录路径。
#[tauri::command]
fn reveal_folder(path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.exists() {
        return Err(format!("目录不存在:{}", path));
    }
    if !dir.is_dir() {
        return Err(format!("不是目录:{}", path));
    }
    let canonical = fs::canonicalize(&dir).unwrap_or(dir);
    let result = if cfg!(target_os = "windows") {
        Command::new("explorer.exe").arg(&canonical).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&canonical).spawn()
    } else {
        // Linux / *BSD
        Command::new("xdg-open").arg(&canonical).spawn()
    };
    result.map(|_| ()).map_err(|e| format!("打开文件管理器失败:{}", e))
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
            delete_asset_files,
            set_llm_secret,
            has_llm_secret,
            delete_llm_secret,
            llm_http_request,
            reveal_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
