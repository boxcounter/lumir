//! vault 注册表的本地 JSON 持久化。
//! 注册表写入采用临时文件 + rename 原子替换（vault_register）；应用进程内
//! command 调用串行，跨进程并发不在本阶段范围。
//!
//! 失效注册项（幽灵项）治理走「惰性归档」：路径失效先在 `missing_since`
//! 记账，持续失效超过 [`MISSING_GRACE_MS`] 后打上 `archived_at` 标记。
//! 归档是标记不是删除——外置卷重新挂载、目录恢复后同一注册项凭路径命中
//! 即复位，身份不丢；归档项不再作为 remap 候选，幽灵项不再污染浮条。
use crate::{commands::CommandError, config};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use ts_rs::TS;
fn valid_id(id: &str) -> Result<(), CommandError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(CommandError::new("invalid_id", "标识符格式不正确"));
    }
    Ok(())
}

/// 失效注册项的归档宽限期（毫秒）：路径首次被观测到失效即记入
/// `missing_since`，持续失效超过此值才归档。首次观测必出候选（覆盖
/// 「移动 vault 后重新打开」的交互窗口），宽限期只决定候选继续出现的
/// 时长——太短会过早掐断 remap 恢复入口，太长则幽灵项持续污染浮条。
const MISSING_GRACE_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultWorkspace {
    pub id: String,
    pub path: String,
    /// 路径首次被观测到失效的时间（Unix 毫秒）；None = 路径有效。
    /// 落盘字段，不进 webview 契约（`#[ts(skip)]`：src/bindings 不变）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(skip)]
    pub missing_since: Option<i64>,
    /// 归档时间（Unix 毫秒）：失效持续超过宽限期后标记，此后不作为 remap
    /// 候选。归档只是标记——路径恢复（外置卷重新挂载）即被复位。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(skip)]
    pub archived_at: Option<i64>,
}
fn workspaces() -> Result<PathBuf, CommandError> {
    Ok(config::config_dir()?.join("workspaces"))
}
pub fn vault_id() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    format!(
        "vault-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 注册表项落盘（tmp + rename 原子替换，与 `vault_register` 同纪律）。
/// 直接写目标文件会在崩溃窗口留下半个 JSON；注册项即身份，不冒失真风险。
fn write_entry(path: &Path, v: &VaultWorkspace) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(v)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

/// 注册表惰性治理（best-effort：治理失败不影响打开主流程）：
/// - 路径有效 → 清除 `missing_since` / `archived_at`（卷重新挂载、目录恢复即复位）；
/// - 路径失效且未归档 → 首次观测记 `missing_since`；失效持续超过宽限期则记
///   `archived_at`（归档 = 标记，注册项文件不删）。
///
/// 幂等：只在状态跃迁时写盘，收敛后重复执行不再产生写。返回本轮改写的项数。
fn sweep_registry(now: i64) -> usize {
    let Ok(d) = workspaces() else {
        return 0;
    };
    let Ok(entries) = fs::read_dir(d) else {
        return 0;
    };
    let mut changed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(v) =
            serde_json::from_str::<VaultWorkspace>(&fs::read_to_string(&path).unwrap_or_default())
        else {
            continue;
        };
        let next = if Path::new(&v.path).exists() {
            if v.missing_since.is_none() && v.archived_at.is_none() {
                continue;
            }
            VaultWorkspace {
                missing_since: None,
                archived_at: None,
                ..v
            }
        } else if v.archived_at.is_some() {
            continue;
        } else {
            match v.missing_since {
                Some(since) if now - since >= MISSING_GRACE_MS => VaultWorkspace {
                    archived_at: Some(now),
                    ..v
                },
                Some(_) => continue,
                None => VaultWorkspace {
                    missing_since: Some(now),
                    ..v
                },
            }
        };
        if write_entry(&path, &next).is_ok() {
            changed += 1;
        }
    }
    changed
}

pub fn remap_candidates(path: &std::path::Path) -> Result<Vec<VaultWorkspace>, CommandError> {
    let target = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .display()
        .to_string();
    // 打开链路顺带治理：本轮归档的幽灵项不再进入候选（惰性、幂等）
    sweep_registry(now_ms());
    let d = workspaces()?;
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(d) {
        for entry in entries.flatten() {
            if let Ok(v) = serde_json::from_str::<VaultWorkspace>(
                &fs::read_to_string(entry.path()).unwrap_or_default(),
            ) {
                if v.archived_at.is_none() && !Path::new(&v.path).exists() && v.path != target {
                    out.push(v);
                }
            }
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}
/// 只读查找注册表中路径匹配的项（canonicalized 字符串比对）。
/// 不创建注册表目录、不注册新 id、不作治理写盘——remap 门判定与
/// reconcile_vault 共用；失效项治理统一由 [`sweep_registry`] 负责。
fn find_by_path(ps: &str) -> Result<Option<VaultWorkspace>, CommandError> {
    let d = workspaces()?;
    if !d.is_dir() {
        return Ok(None);
    }
    for entry in fs::read_dir(&d)
        .map_err(|_| CommandError::new("workspace_read", "无法读取 workspace 注册表"))?
    {
        let entry = entry
            .map_err(|_| CommandError::new("workspace_read", "无法读取 workspace 注册表项"))?;
        if let Ok(v) = serde_json::from_str::<VaultWorkspace>(
            &fs::read_to_string(entry.path()).unwrap_or_default(),
        ) {
            if v.path == ps {
                return Ok(Some(v));
            }
        }
    }
    Ok(None)
}

/// 目标路径是否已注册（只读）。open_vault 的 remap 门须先作此判断：
/// reconcile_vault 对未注册路径有注册 side effect，不能用作探测。
pub fn is_registered(path: &std::path::Path) -> Result<bool, CommandError> {
    let p = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Ok(find_by_path(&p.display().to_string())?.is_some())
}

/// remap 门判定：目标已注册或不存在失效注册项时返回 None（直接打开）；
/// 仅目标未注册且存在失效注册项时返回 Some(候选)（短路，待用户显式确认）。
pub fn remap_gate(path: &std::path::Path) -> Result<Option<Vec<VaultWorkspace>>, CommandError> {
    if is_registered(path)? {
        return Ok(None);
    }
    let candidates = remap_candidates(path)?;
    if candidates.is_empty() {
        Ok(None)
    } else {
        Ok(Some(candidates))
    }
}

pub fn reconcile_vault(path: &std::path::Path) -> Result<VaultWorkspace, CommandError> {
    let p = path
        .canonicalize()
        .map_err(|_| CommandError::new("workspace_path", "无法规范化 vault 路径"))?;
    let ps = p.display().to_string();
    let d = workspaces()?;
    fs::create_dir_all(&d)
        .map_err(|_| CommandError::new("workspace_write", "无法创建 workspace 注册表目录"))?;
    // 打开成功路径顺带治理：失效项在此记账/归档，路径已恢复的归档项（外置卷
    // 重新挂载）在同一遍里复位；best-effort，治理失败不拦打开。
    sweep_registry(now_ms());
    if let Some(v) = find_by_path(&ps)? {
        return Ok(v);
    }
    let id = vault_id();
    vault_register(id, ps)
}
#[tauri::command]
pub fn vault_register(id: String, path: String) -> Result<VaultWorkspace, CommandError> {
    valid_id(&id)?;
    let path = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|_| CommandError::new("workspace_path", "无法规范化 vault 路径"))?
        .display()
        .to_string();
    let d = workspaces()?;
    fs::create_dir_all(&d)
        .map_err(|_| CommandError::new("workspace_write", "无法创建 workspace 注册表目录"))?;
    // 注册 / 重映射即复位失效治理标记：该 id 重新绑定到了有效路径
    let v = VaultWorkspace {
        id,
        path,
        missing_since: None,
        archived_at: None,
    };
    write_entry(&d.join(format!("{}.json", v.id)), &v).map_err(|_| {
        CommandError::new("workspace_write", "无法写入 workspace 注册表".to_string())
    })?;
    Ok(v)
}
#[tauri::command]
pub fn vault_remap(id: String, path: String) -> Result<VaultWorkspace, CommandError> {
    valid_id(&id)?;
    let v = vault_register(id, path)?;
    let path = v.path.clone();
    let p = config::config_dir()?.join("config.json");
    let mut x = match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    if !x.is_object() {
        x = serde_json::json!({});
    }
    x["last_vault"] = serde_json::Value::String(path);
    let d = config::config_dir()?;
    fs::create_dir_all(&d).map_err(|_| CommandError::new("config_write", "无法创建配置目录"))?;
    let tmp = p.with_extension("json.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(&x)
            .map_err(|_| CommandError::new("config_write", "无法序列化配置"))?,
    )
    .map_err(|_| CommandError::new("config_write", "无法写入配置"))?;
    fs::rename(&tmp, &p).map_err(|_| CommandError::new("config_write", "无法落盘配置"))?;
    Ok(v)
}
