//! vault 注册表的本地 JSON 持久化。
//!
//! ## 目录名与旧名迁移（M248，backlog #37）
//!
//! 注册表目录是 `<config_dir>/vault-registry/`（[`REGISTRY_DIR_NAME`]）。旧名 `workspaces/`
//! 与「工作区状态」语义错位、与 `vault-sessions/` 并置时易被读成两个业务概念，因此更名；存量
//! 目录由启动时一次 [`migrate_legacy_registry_dir_at_startup`] 原子 rename 迁移（同目录同文件
//! 系统；新目录已存在则不动作），判据与四态见 [`migrate_legacy_registry_dir`]。
//!
//! 更名的边界**只到模块名、目录名与私有 helper**：`VaultWorkspace` 类型名与 `workspace_read`
//! / `workspace_write` / `workspace_path` 错误码刻意保留——前者经 ts-rs 进 `src/bindings/`、
//! 被前端 import，改名会波及 webview 契约面（本 mission 的口径是 bindings 零漂移）；后者是
//! command 错误信封的既有码，改名属未被裁决的行为变更。
//!
//! 注册表写入采用临时文件 + rename 原子替换（vault_register）。**进程内有两个写者**：
//! command 通道（注册 / 重映射 / 记打开）与启动恢复线程（M159，`lumir-vault-restore` 在
//! 恢复成功后记 `last_opened_at`）。两者可能并发写，但每项都是**整文件**原子替换，读到的
//! 永远是某个完整版本、不会撕裂；竞态后果按良性推演——同项的治理写被覆盖后由下次
//! `sweep_registry` 自愈（`mark_opened` 只改 `last_opened_at`，不改治理标记），记账字段
//! 丢失只让列表摘要少一个读数、不改任何判定。跨进程并发不在本阶段范围。
//!
//! 失效注册项（幽灵项）治理走「惰性归档」：路径失效先在 `missing_since`
//! 记账，持续失效超过 [`MISSING_GRACE_MS`] 后打上 `archived_at` 标记。
//! 归档是标记不是删除——外置卷重新挂载、目录恢复后同一注册项凭路径命中
//! 即复位，身份不丢；归档项不再作为 remap 候选，幽灵项不再污染浮条。
//!
//! **用户主动移除**（[`vault_remove`]，M646 / change vault-and-session-removal）是唯一会删掉
//! 注册项文件的路径：只删 `<id>.json` 那一项，vault 目录与按 id 键控的其余数据一概不动
//!（此后成为不可达孤儿）；[`vault_restore`] 按移除前的原值把它写回。自动治理仍只归档，
//! 两者不是一回事。
//!
//! 注册项另记 `last_opened_at`（打开**成功**路径的记账，供 `vault_list` 排序与「上次打开
//! 时间」）。它不是治理标记：治理与注册都不清除它（`sweep_registry` 与 `vault_register`
//! 都显式保留），只有真正发生的打开才刷新它。
use crate::{commands::CommandError, config};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use ts_rs::TS;
/// 注册项稳定 id 的格式校验（id 同时是注册项与会话文件的**文件名**，因此这是路径逃逸
/// 防护，不依赖调用方自觉）。会话存储复用同一判据（`vault_session`），不另立一份。
pub(crate) fn valid_id(id: &str) -> Result<(), CommandError> {
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
    /// 上次打开成功的时间（Unix 毫秒）；从未打开为 None。落盘字段，经
    /// [`VaultListEntry`] 进列表契约——注册项类型本身在契约里只服务 remap 浮条，
    /// 不因多一个字段而改变既有载荷形状。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(skip)]
    pub last_opened_at: Option<i64>,
}

/// 注册表目录名：`<config_dir>/vault-registry/`。与 `vault-sessions/` 对仗——两者是同一
/// vault 实体的两个面（身份 / 易变会话状态），见 `vault_session` 模块头。
const REGISTRY_DIR_NAME: &str = "vault-registry";
/// 注册表目录的旧名（M248 更名前）：迁移的**唯一**来源，代码里不再有第二个写者。
const LEGACY_REGISTRY_DIR_NAME: &str = "workspaces";

fn registry_dir() -> Result<PathBuf, CommandError> {
    Ok(config::config_dir()?.join(REGISTRY_DIR_NAME))
}

/// 旧注册表目录迁移的终局。四态各自的含义与处置见 [`migrate_legacy_registry_dir`]。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistryMigration {
    /// 旧目录不存在：无动作（迁移过之后的稳态，也是全新安装的形态）。
    NotNeeded,
    /// 旧目录已原子改名为新名（rename 搬的是整个目录，注册项逐项不丢）。
    Migrated,
    /// 新目录已存在：不动作（裁决口径）。
    SkippedTargetExists,
    /// rename 失败（权限 / 跨设备挂载等）：旧目录原地不动，本次启动按「注册表为空」运行。
    Failed,
}

impl RegistryMigration {
    /// 落诊断日志用的结果字面量。稳态（旧目录不存在）返回 None——迁移一辈子只发生一次，
    /// 之后每次启动都记一条「无事可做」只会把日志刷成噪音。
    fn log_value(self) -> Option<&'static str> {
        match self {
            Self::NotNeeded => None,
            Self::Migrated => Some("migrated"),
            Self::SkippedTargetExists => Some("skipped_target_exists"),
            Self::Failed => Some("failed"),
        }
    }
}

/// 旧目录 `workspaces/` → `vault-registry/` 的一次性迁移（M248，backlog #37 落地口径②）。
///
/// **可测内核**：配置目录按参数注入，测试全程不碰真实的 `~/.config/lumir`。
///
/// 语义：
/// - 旧目录不存在 → [`RegistryMigration::NotNeeded`]（稳态：已迁过，或全新安装）；
/// - 旧目录在、新目录不在 → `fs::rename` 整个目录（同目录同文件系统，原子；注册项与落盘
///   窗口里残留的 `.json.tmp` 一并搬走）→ [`RegistryMigration::Migrated`]；
/// - 新目录已在 → **不动作**。`fs::rename` 到非空目录在 Unix 上本就失败（ENOTEMPTY），
///   「不动作」把这条失败转成一个显式终局而不是错误路径；
/// - rename 失败 → [`RegistryMigration::Failed`]，旧目录原地保留（注册项没丢：下次启动重试）。
///
/// best-effort：失败不拦启动——注册表读不到只表现为列表与 remap 候选为空，vault 仍可打开
/// （打开成功会重新注册）。与注册表治理同一条「有损可自愈」的论证。
pub fn migrate_legacy_registry_dir(config_dir: &Path) -> RegistryMigration {
    let legacy = config_dir.join(LEGACY_REGISTRY_DIR_NAME);
    if !legacy.is_dir() {
        return RegistryMigration::NotNeeded;
    }
    let current = config_dir.join(REGISTRY_DIR_NAME);
    if current.exists() {
        return RegistryMigration::SkippedTargetExists;
    }
    match fs::rename(&legacy, &current) {
        Ok(()) => RegistryMigration::Migrated,
        Err(e) => {
            eprintln!("lumir: vault 注册表目录迁移失败（本次按空注册表启动，下次启动重试）：{e}");
            RegistryMigration::Failed
        }
    }
}

/// 启动路径上的迁移入口（lib.rs 的 setup 调一次）：解析配置目录 → 迁移 → 记一条诊断事件。
///
/// 调用点纪律：必须在**第一次解析配置目录之后、任何读注册表之前**——启动恢复线程与前端
/// command 都是注册表的读者，setup 内同步跑完这件事即保证两者看到的是新名目录。
pub fn migrate_legacy_registry_dir_at_startup() {
    let Ok(dir) = config::config_dir() else {
        // 配置目录不可确定：与 logging / 启动恢复同口径，静默返回（各自的读路径会报错）。
        return;
    };
    let outcome = migrate_legacy_registry_dir(&dir);
    if let Some(value) = outcome.log_value() {
        crate::logging::vault_registry_migrated(value);
    }
}
pub fn vault_id() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    format!(
        "vault-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}
/// 当前墙钟（Unix 毫秒）。会话落盘（`vault_session`）复用同一取时口径。
pub(crate) fn now_ms() -> i64 {
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

/// 读注册表项：读失败（不存在 / 不可读）与解析失败一律得到 `None`——注册表读取的容错
/// 口径只此一处（治理、候选、按路径查找、列表共用），调用方各自决定 `None` 的后果。
fn read_entry_file(path: &Path) -> Option<VaultWorkspace> {
    serde_json::from_str(&fs::read_to_string(path).unwrap_or_default()).ok()
}

/// 注册表惰性治理（best-effort：治理失败不影响打开主流程）：
/// - 路径有效 → 清除 `missing_since` / `archived_at`（卷重新挂载、目录恢复即复位）；
/// - 路径失效且未归档 → 首次观测记 `missing_since`；失效持续超过宽限期则记
///   `archived_at`（归档 = 标记，注册项文件不删）。
///
/// 幂等：只在状态跃迁时写盘，收敛后重复执行不再产生写。返回本轮改写的项数。
fn sweep_registry(now: i64) -> usize {
    let Ok(d) = registry_dir() else {
        return 0;
    };
    let Ok(entries) = fs::read_dir(d) else {
        return 0;
    };
    let mut changed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(v) = read_entry_file(&path) else {
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
    let d = registry_dir()?;
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(d) {
        for entry in entries.flatten() {
            if let Some(v) = read_entry_file(&entry.path()) {
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
    let d = registry_dir()?;
    if !d.is_dir() {
        return Ok(None);
    }
    for entry in fs::read_dir(&d)
        .map_err(|_| CommandError::new("workspace_read", "无法读取 vault 注册表"))?
    {
        let entry =
            entry.map_err(|_| CommandError::new("workspace_read", "无法读取 vault 注册表项"))?;
        if let Some(v) = read_entry_file(&entry.path()) {
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
    let d = registry_dir()?;
    fs::create_dir_all(&d)
        .map_err(|_| CommandError::new("workspace_write", "无法创建 vault 注册表目录"))?;
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
    let d = registry_dir()?;
    fs::create_dir_all(&d)
        .map_err(|_| CommandError::new("workspace_write", "无法创建 vault 注册表目录"))?;
    // 注册 / 重映射即复位失效治理标记：该 id 重新绑定到了有效路径。`last_opened_at`
    // 不是治理标记（它是打开历史），重映射后显式保留——否则一次重定位就把该 vault 的
    // 排序打回末尾，而它并没有被重新打开。
    let last_opened_at =
        read_entry_file(&d.join(format!("{id}.json"))).and_then(|previous| previous.last_opened_at);
    let v = VaultWorkspace {
        id,
        path,
        missing_since: None,
        archived_at: None,
        last_opened_at,
    };
    write_entry(&d.join(format!("{}.json", v.id)), &v)
        .map_err(|_| CommandError::new("workspace_write", "无法写入 vault 注册表".to_string()))?;
    Ok(v)
}
#[tauri::command]
pub fn vault_remap(id: String, path: String) -> Result<VaultWorkspace, CommandError> {
    // last_vault 走与打开成功路径同一条合并写通道（M600）：旧实现自己 read_to_string →
    // 写固定 `config.json.tmp` → rename，两个并发 remap 会共用同一 tmp（半截内容），与
    // config_set_value 并发时还是无互斥的 read-modify-write（丢键）。统一通道自带 M592 的
    // 进程内写锁与唯一 tmp 名，语义不变。
    let v = vault_register(id, path)?;
    crate::commands::write_last_vault(std::path::Path::new(&v.path))?;
    Ok(v)
}

// ---------------------------------------------------------------------------
// 打开记账与列表（change multi-vault-workspaces，change tasks 1.1–1.3）
// ---------------------------------------------------------------------------

/// 打开**成功**路径的记账（best-effort）：把该注册项的 `last_opened_at` 刷成当前时间。
///
/// 调用点只有真正打开了 vault 的成功路径（`commands::remember_open` 与启动恢复提交之后）
/// ——打开失败、remap 门短路、恢复结果被让位丢弃都不写：一次没有发生的打开不该改动列表
/// 排序与「上次打开时间」。写失败降级 warning（与 `last_vault` 同口径）：打开是主结果，
/// 这个字段只影响列表顺序。
pub fn mark_opened(id: &str) {
    match mark_opened_at(id, now_ms()) {
        Ok(()) => {}
        Err(e) => eprintln!("lumir: 记录 last_opened_at 失败（vault 已打开，本次忽略）：{e}"),
    }
}

/// [`mark_opened`] 的可测内核。注册项读不到 / 解析不了（没有可记的项）不算失败——
/// 没有注册项就没有列表行，也没什么可记账的。
fn mark_opened_at(id: &str, now: i64) -> Result<(), CommandError> {
    valid_id(id)?;
    let path = registry_dir()?.join(format!("{id}.json"));
    let Some(mut v) = read_entry_file(&path) else {
        return Ok(());
    };
    v.last_opened_at = Some(now);
    write_entry(&path, &v)
        .map_err(|_| CommandError::new("workspace_write", "无法写入 vault 注册表"))
}

/// 列表行（`vault_list` 的契约形状）：注册表摘要 + 路径可用性 + 可恢复的标签数。
/// 显示名取路径的目录名（MUST NOT 引入独立显示名或命名步骤）；`tab_count` 与会话里
/// 「将被恢复的固定标签数」同源（预览标签不入盘，design §4.2）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultListEntry {
    pub id: String,
    pub path: String,
    /// 显示名 = 路径的目录名（basename）。
    pub name: String,
    /// 路径当前可用（目录存在）。不可用项保留在列表里、不可切换，只给「重新定位…」。
    pub available: bool,
    /// 上次打开成功时间（Unix 毫秒）；无记录为 null。
    #[ts(type = "number | null")]
    pub last_opened_at: Option<i64>,
    /// 可恢复的固定标签数（会话文件里的合法条目数）；无历史为 0。
    pub tab_count: usize,
}

/// 注册表摘要列表（读盘 + 可用性探测 + 会话标签数）。目录可注入（测试不碰真实配置目录）。
///
/// 容错口径与既有读取同源：单个注册项解析失败即跳过，其余项照常返回（`commands.rs` 的
/// 「单个损坏项不拖垮整表」）；注册表目录不存在 = 空列表（首次启动的常态），目录存在但
/// 读不了才是错误信封（`workspace_read`）。已归档项同样返回——归档只抑制自动出现的 remap
/// 候选浮条，不抑制用户在列表里的可见性（那是用户主动打开的面）。
///
/// 只读：列表可能被频繁打开，治理写（`sweep_registry`）不在这里做。
/// 排序：可用项在前 → 各自按最近打开倒序（无记录按最早）→ 同刻按 id 兜底（结果确定）。
pub fn list_vaults(registry: &Path, sessions: &Path) -> Result<Vec<VaultListEntry>, CommandError> {
    let mut out = Vec::new();
    if registry.is_dir() {
        let entries = fs::read_dir(registry)
            .map_err(|_| CommandError::new("workspace_read", "无法读取 vault 注册表"))?;
        for entry in entries.flatten() {
            let Some(v) = read_entry_file(&entry.path()) else {
                continue;
            };
            // 探针问的是「这个 vault 现在能不能打开」：目录存在才算可用
            //（`exists()` 会把同名普通文件也算成可用，点开必失败）。
            let available = Path::new(&v.path).is_dir();
            let name = basename(&v.path);
            // 标签数 = **全部 pane** 的标签之和（M318：会话 schema 扩成 panes 数组后，
            // 列表摘要的「N 个标签」是整个 vault 的标签总数，不是单 pane 的）。
            let tab_count = crate::vault_session::load_from(sessions, &v.id).map_or(0, |session| {
                session.panes.iter().map(|pane| pane.tabs.len()).sum()
            });
            out.push(VaultListEntry {
                id: v.id,
                path: v.path,
                name,
                available,
                last_opened_at: v.last_opened_at,
                tab_count,
            });
        }
    }
    out.sort_by(|a, b| {
        b.available
            .cmp(&a.available)
            .then_with(|| sort_key(b).cmp(&sort_key(a)))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(out)
}

/// 最近打开倒序的排序键：无记录按最早处理（沉到有记录的项之后）。
fn sort_key(entry: &VaultListEntry) -> i64 {
    entry.last_opened_at.unwrap_or(i64::MIN)
}

/// 显示名 = 路径的目录名；路径没有目录名（如根 `/`）时退回整个路径。
fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// vault 列表：注册表摘要 + 路径可用性 + 会话标签数。前端**每次打开切换器重新读取**
/// （MUST NOT 维护常驻镜像——注册表是唯一真源），因此本命令只读、无缓存。
///
/// 线程（change task 1.3，spec「列表命令 MUST NOT 在 Tauri 主线程上对 vault 路径做阻塞
/// 探测」）：async command 本身只落到运行时、不占 Tauri 主线程；读盘与逐项 `is_dir()` 探测
/// 再交给 `spawn_blocking`——慢挂载卷上 `is_dir()` 可能长时间不返回，不该占住运行时的工作
/// 线程（与启动恢复移出主线程是同一条论证）。
#[tauri::command]
pub async fn vault_list() -> Result<Vec<VaultListEntry>, CommandError> {
    let registry = registry_dir()?;
    let sessions = crate::vault_session::sessions_dir()?;
    tauri::async_runtime::spawn_blocking(move || list_vaults(&registry, &sessions))
        .await
        .map_err(|e| {
            CommandError::new("vault_list_failed", format!("读取 vault 列表失败：{e}"))
                .param("reason", e.to_string())
        })?
}

// ---------------------------------------------------------------------------
// 列表移除与撤销（M646，change vault-and-session-removal）
//
// 移除是**整理列表**的动作，不是数据销毁：唯一的写操作是删掉
// `<config>/vault-registry/<id>.json`——vault 目录、其中任何文件、按 id 键控的其余数据
// （`vault-sessions/<id>.json` / `reading-positions/<id>.json` / `harness/sessions/<id>/` /
// `harness/attachments/<id>/`）一律不碰，它们此后成为不可达的孤儿（`vault_session` 模块头的
// 「无害残留」口径）。撤销按移除前的原值写回，是唯一能挽回那个身份的通道。
// ---------------------------------------------------------------------------

/// 「移除 → 撤销」的往返载荷：注册项的完整落盘字段（含三个 `#[ts(skip)]` 的治理字段）。
///
/// 为什么不复用 [`VaultWorkspace`]：它把 `missing_since` / `archived_at` / `last_opened_at`
/// 标成 `#[ts(skip)]`（落盘字段不进 webview 契约）。为撤销把它们解禁，等于让注册项的内部
/// 治理字段突然成为前端可见契约面；另立一个只服务这次往返的小类型，契约面增量就是它自己。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RemovedVault {
    pub id: String,
    pub path: String,
    /// 上次打开时间（Unix 毫秒）：撤销按原值写回，列表排序因此与移除前一致。
    #[ts(type = "number | null")]
    pub last_opened_at: Option<i64>,
    /// 失效治理标记（`None` = 路径有效）：撤销时原值写回，一次撤销不得顺手把历史洗掉。
    #[ts(type = "number | null")]
    pub missing_since: Option<i64>,
    /// 归档标记（`None` = 未归档）：同 `missing_since`，原值写回。
    #[ts(type = "number | null")]
    pub archived_at: Option<i64>,
}

/// [`vault_remove`] 的可测内核（注册表目录按参数注入，测试不碰真实配置目录）。
///
/// 判据顺序（design §2.1）：id 合法 → 读项（读不到 = 幂等 `None`）→ 当前 vault 守卫 →
/// `remove_file`。读不到**不是**「删掉了」：撤销需要原值，没有原值就没有撤销提示。
fn remove_entry_at(
    registry: &Path,
    current_id: Option<&str>,
    id: &str,
) -> Result<Option<RemovedVault>, CommandError> {
    valid_id(id)?;
    let path = registry.join(format!("{id}.json"));
    let Some(v) = read_entry_file(&path) else {
        return Ok(None);
    };
    // 当前 vault 不可移除（spec「当前项没有移除入口」）：按**稳定 id** 比对，不按路径字符串
    //（路径比较要担心尾部斜杠与 canonicalize 口径）。前端隐藏入口只是呈现，这里才是防线。
    if current_id == Some(v.id.as_str()) {
        return Err(CommandError::new(
            "vault_remove_current",
            "当前打开的 vault 不能从列表移除，请先切换到其他 vault",
        ));
    }
    fs::remove_file(&path).map_err(|e| {
        CommandError::new("vault_remove_failed", "移除 vault 失败")
            .param("path", path.display().to_string())
            .param("reason", e.to_string())
    })?;
    Ok(Some(RemovedVault {
        id: v.id,
        path: v.path,
        last_opened_at: v.last_opened_at,
        missing_since: v.missing_since,
        archived_at: v.archived_at,
    }))
}

/// [`vault_restore`] 的可测内核：按原值把注册项写回。
///
/// 目标已存在**不覆盖**：撤销不是「改写现存注册项」的写通道（该项可能已被别的路径恢复，或
/// 用户已经重新加过同一 id）。不刷新 `last_opened_at`、不动 `last_vault`、不触发打开。
fn restore_entry_at(registry: &Path, entry: &RemovedVault) -> Result<(), CommandError> {
    valid_id(&entry.id)?;
    let path = registry.join(format!("{}.json", entry.id));
    if path.exists() {
        return Ok(());
    }
    fs::create_dir_all(registry)
        .map_err(|_| CommandError::new("workspace_write", "无法创建 vault 注册表目录"))?;
    let v = VaultWorkspace {
        id: entry.id.clone(),
        path: entry.path.clone(),
        missing_since: entry.missing_since,
        archived_at: entry.archived_at,
        last_opened_at: entry.last_opened_at,
    };
    write_entry(&path, &v)
        .map_err(|_| CommandError::new("workspace_write", "无法写入 vault 注册表"))
}

/// 从列表移除一个注册项（M646，spec「vault 移除」）：只删注册表项文件，盘上的 vault 内容与
/// per-id 数据一概不动。返回移除前的完整注册项（撤销的载荷）；该项已不存在时返回 `None`
/// ——重复删除 / 竞态删除不是错误（与 `harness_delete_session` 的幂等口径一致）。
///
/// 当前 vault 拒绝移除：未打开 vault 时 `root_policy_and_id` 返回 `vault_not_open`，按「没有
/// 当前 vault」放行（任何注册项都可移除）。
#[tauri::command(rename_all = "snake_case")]
pub fn vault_remove(
    state: tauri::State<'_, crate::commands::VaultState>,
    id: String,
) -> Result<Option<RemovedVault>, CommandError> {
    let current = state.root_policy_and_id().ok().map(|(_, _, id)| id);
    remove_entry_at(&registry_dir()?, current.as_deref(), &id)
}

/// 撤销一次移除（spec「撤销恢复原注册项」）：把注册项按移除前的原值写回，列表视为从未移除。
/// 已存在的项不被覆盖；不打开、不切换、不动 `last_vault`。
#[tauri::command(rename_all = "snake_case")]
pub fn vault_restore(entry: RemovedVault) -> Result<(), CommandError> {
    restore_entry_at(&registry_dir()?, &entry)
}

// ---------------------------------------------------------------------------
// M248（backlog #37）：旧注册表目录 `workspaces/` → `vault-registry/` 的一次性迁移。
//
// 迁移内核按配置目录注入（`migrate_legacy_registry_dir`），因此这四态都不碰 XDG_CONFIG_HOME
// 与真实的 `~/.config/lumir`——与套件「用户配置全程只读」的纪律一致。
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 无 tempfile 依赖（低依赖取向）：在 $TMPDIR **独占新建**唯一目录，Drop 时删除。
    /// 目录名带 pid + 序号 + 随机段，且用 `create_dir` 而非 `create_dir_all`：pid 回收后
    /// crash 残留目录会被静默复用；撞名即换随机段重试（同 `link_graph.rs` 的 `TempVaultDir`）。
    struct TempDir(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempDir {
        fn new() -> Self {
            let base = std::env::temp_dir();
            for _ in 0..16 {
                let path = base.join(format!(
                    "lumir-vault-registry-test-{}-{}-{:016x}",
                    std::process::id(),
                    SEQ.fetch_add(1, Ordering::Relaxed),
                    rand::random::<u64>(),
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(err) => panic!("create temp dir {}: {err}", path.display()),
                }
            }
            panic!("create temp dir: 16 次随机目录名全部撞名");
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn legacy(&self) -> PathBuf {
            self.0.join(LEGACY_REGISTRY_DIR_NAME)
        }

        fn current(&self) -> PathBuf {
            self.0.join(REGISTRY_DIR_NAME)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// `XDG_CONFIG_HOME` 的进程级复原（与 harness 测试的同形助手）：断言失败 panic 也要
    /// 把环境变量放回原值，别把临时目录留给同进程的别的用例。
    struct XdgGuard(Option<std::ffi::OsString>);

    impl Drop for XdgGuard {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
                None => std::env::remove_var("XDG_CONFIG_HOME"),
            }
        }
    }

    /// 预置一条旧名目录下的注册项（存量机器上的形态：只有 id / path）。
    fn seed_legacy_entry(dir: &TempDir, id: &str, vault_path: &str) {
        fs::create_dir_all(dir.legacy()).expect("create legacy dir");
        fs::write(
            dir.legacy().join(format!("{id}.json")),
            format!(
                "{{\"id\":\"{id}\",\"path\":{}}}",
                serde_json::to_string(vault_path).unwrap()
            ),
        )
        .expect("write legacy entry");
    }

    /// 态 ①：旧目录在、新目录不在 → 整个目录搬过去（含落盘窗口残留的 `.json.tmp`）。
    #[test]
    fn legacy_registry_dir_migrates_and_leaves_no_old_dir() {
        let dir = TempDir::new();
        seed_legacy_entry(&dir, "legacy-id", "/tmp/migrated-vault");
        fs::write(dir.legacy().join("half.json.tmp"), "{}").expect("write stale tmp");

        assert_eq!(
            migrate_legacy_registry_dir(dir.path()),
            RegistryMigration::Migrated
        );
        assert!(
            !dir.legacy().exists(),
            "旧目录不得残留（留着会让下次启动重判一次）"
        );
        assert!(dir.current().join("legacy-id.json").is_file());
        assert!(dir.current().join("half.json.tmp").is_file());
    }

    /// 态 ②：新目录已存在 → 不动作（两边都原地保持：不合并、不覆盖）。
    #[test]
    fn migration_is_skipped_when_target_dir_exists() {
        let dir = TempDir::new();
        seed_legacy_entry(&dir, "legacy-id", "/tmp/migrated-vault");
        fs::create_dir_all(dir.current()).expect("create current dir");
        fs::write(
            dir.current().join("current-id.json"),
            "{\"id\":\"current-id\",\"path\":\"/tmp/other\"}",
        )
        .expect("write current entry");

        assert_eq!(
            migrate_legacy_registry_dir(dir.path()),
            RegistryMigration::SkippedTargetExists
        );
        assert!(dir.legacy().join("legacy-id.json").is_file());
        assert_eq!(
            fs::read_dir(dir.current()).unwrap().count(),
            1,
            "新目录内容不得被旧目录污染"
        );
    }

    /// 态 ③：两个目录都不在 → 不动作（全新安装的形态；MUST NOT 凭空建目录）。
    #[test]
    fn migration_is_noop_without_legacy_dir() {
        let dir = TempDir::new();
        assert_eq!(
            migrate_legacy_registry_dir(dir.path()),
            RegistryMigration::NotNeeded
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    /// 态 ④：迁移后注册项仍可经**公开读路径**读出——身份与路径都不丢。
    #[test]
    fn migrated_registry_entries_stay_readable() {
        let dir = TempDir::new();
        seed_legacy_entry(&dir, "legacy-id", "/tmp/migrated-vault");
        assert_eq!(
            migrate_legacy_registry_dir(dir.path()),
            RegistryMigration::Migrated
        );

        let sessions = dir.path().join("vault-sessions");
        let rows = list_vaults(&dir.current(), &sessions).unwrap();
        assert_eq!(rows.len(), 1, "迁移后注册表不得变空：{rows:?}");
        assert_eq!(rows[0].id, "legacy-id");
        assert_eq!(rows[0].path, "/tmp/migrated-vault");
        assert_eq!(
            rows[0].name, "migrated-vault",
            "显示名仍由路径派生（迁移不改注册项内容）"
        );
    }

    /// M600：并发两次 `vault_remap` 不得写出半截 config。
    ///
    /// 旧实现自己 `read_to_string` → 写固定 `config.json.tmp` → rename：两个 remap 同时
    /// 落盘会截断 / 交错写同一份 tmp，正式配置可能变成非法 JSON。改造后两条都走
    /// `commands::write_last_vault`（M592 的进程内写锁 + 唯一 tmp 名），落盘永远是某一次的
    /// 完整版本，且 `last_vault` 之外的字段逐键保留。
    ///
    /// `XDG_CONFIG_HOME` 是进程全局：先取共享的 `xdg_test_lock`，测试全程不碰真实的
    /// `~/.config/lumir`。
    #[test]
    fn concurrent_vault_remaps_never_leave_partial_config() {
        let _serial = crate::harness::xdg_test_lock();
        let dir = TempDir::new();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", dir.path());

        let vault_a = dir.path().join("vault-a");
        let vault_b = dir.path().join("vault-b");
        fs::create_dir_all(&vault_a).expect("create vault-a");
        fs::create_dir_all(&vault_b).expect("create vault-b");
        let config_path = dir.path().join("lumir").join("config.json");
        fs::create_dir_all(config_path.parent().expect("config parent"))
            .expect("create config dir");
        // 48KB 的填充字段让单次落盘跨多个系统调用：旧实现的固定 tmp 名在这条路径上更容易
        // 被并发写者交错写入，落盘内容因此可能不再是任何一次写入的完整版本。
        let padding = "x".repeat(48 * 1024);
        fs::write(
            &config_path,
            serde_json::json!({
                "version": 1,
                "ui": {"content_width": 920},
                "future_field": 7,
                "padding": padding,
            })
            .to_string(),
        )
        .expect("seed config");

        let expected: Vec<String> = [&vault_a, &vault_b]
            .iter()
            .map(|p| {
                fs::canonicalize(p)
                    .expect("canonicalize vault")
                    .display()
                    .to_string()
            })
            .collect();

        // 多轮并发：单轮撞不进交错窗口，靠重复把旧实现的固定 tmp 竞态放大。
        for round in 0..20 {
            let (id_a, path_a) = ("vault-a".to_string(), vault_a.clone());
            let (id_b, path_b) = ("vault-b".to_string(), vault_b.clone());
            std::thread::scope(|scope| {
                scope.spawn(move || {
                    vault_remap(id_a, path_a.display().to_string()).expect("remap vault-a");
                });
                scope.spawn(move || {
                    vault_remap(id_b, path_b.display().to_string()).expect("remap vault-b");
                });
            });

            let text = fs::read_to_string(&config_path).expect("read config");
            let value: serde_json::Value = serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("第 {round} 轮 config 被写成非法 JSON：{e}\n{text}"));
            let last = value["last_vault"]
                .as_str()
                .unwrap_or_else(|| panic!("第 {round} 轮 last_vault 不是字符串：{value}"));
            assert!(
                expected.iter().any(|path| path == last),
                "第 {round} 轮 last_vault 必须是某次 remap 的完整路径：{last}"
            );
            assert_eq!(
                value["ui"]["content_width"],
                serde_json::json!(920),
                "第 {round} 轮并发 remap 不得丢键"
            );
            assert_eq!(
                value["future_field"],
                serde_json::json!(7),
                "第 {round} 轮并发 remap 不得丢键"
            );
            assert_eq!(
                value["padding"].as_str().map(str::len),
                Some(48 * 1024),
                "第 {round} 轮并发 remap 不得截断大字段"
            );
            let leftovers: Vec<String> = fs::read_dir(config_path.parent().expect("config parent"))
                .expect("read config dir")
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| name.ends_with(".tmp"))
                .collect();
            assert!(
                leftovers.is_empty(),
                "第 {round} 轮并发 remap 不得留下 tmp：{leftovers:?}"
            );
        }
    }

    // -----------------------------------------------------------------------
    // 列表移除与撤销（M646）：内核按注册表目录注入，全程不碰真实的 `~/.config/lumir`。
    // -----------------------------------------------------------------------

    /// 在注册表目录里落一条注册项（治理字段可缺省）。
    fn seed_entry(dir: &Path, id: &str, vault_path: &str, last_opened_at: Option<i64>) {
        fs::create_dir_all(dir).expect("create registry dir");
        let entry = VaultWorkspace {
            id: id.to_string(),
            path: vault_path.to_string(),
            missing_since: None,
            archived_at: None,
            last_opened_at,
        };
        write_entry(&dir.join(format!("{id}.json")), &entry).expect("write entry");
    }

    /// 移除只删目标项文件：同目录其它项、`vault-sessions` / `reading-positions` 下的同名文件、
    /// vault 目录内的文件全部逐字节不变（spec「移除一个非当前 vault」的 MUST NOT 那一半）。
    #[test]
    fn remove_entry_deletes_only_the_target_registry_file() {
        let root = TempDir::new();
        let registry = root.path().join(REGISTRY_DIR_NAME);
        let vault_a = root.path().join("vault-a");
        let vault_b = root.path().join("vault-b");
        fs::create_dir_all(&vault_a).expect("create vault-a");
        fs::create_dir_all(&vault_b).expect("create vault-b");
        fs::write(vault_b.join("note.md"), "b-note").expect("write vault-b note");
        seed_entry(
            &registry,
            "vault-a",
            &vault_a.display().to_string(),
            Some(10),
        );
        seed_entry(
            &registry,
            "vault-b",
            &vault_b.display().to_string(),
            Some(20),
        );
        // 按 id 键控的其余数据：移除 MUST NOT 碰它们。
        let sessions = root.path().join("vault-sessions");
        let positions = root.path().join("reading-positions");
        fs::create_dir_all(&sessions).expect("create sessions dir");
        fs::create_dir_all(&positions).expect("create positions dir");
        fs::write(sessions.join("vault-b.json"), "{\"tabs\":[]}").expect("write session");
        fs::write(positions.join("vault-b.json"), "{}").expect("write positions");

        let removed = remove_entry_at(&registry, Some("vault-a"), "vault-b")
            .expect("remove vault-b")
            .expect("removal returns the previous entry");
        assert_eq!(removed.id, "vault-b");
        assert_eq!(removed.last_opened_at, Some(20));

        assert!(
            !registry.join("vault-b.json").exists(),
            "目标注册项文件必须被删掉"
        );
        assert!(
            registry.join("vault-a.json").exists(),
            "同目录其它注册项不得受影响"
        );
        assert_eq!(
            fs::read_to_string(sessions.join("vault-b.json")).expect("read session"),
            "{\"tabs\":[]}",
            "标签会话不是移除的删除面"
        );
        assert_eq!(
            fs::read_to_string(positions.join("vault-b.json")).expect("read positions"),
            "{}",
            "阅读位置不是移除的删除面"
        );
        assert_eq!(
            fs::read_to_string(vault_b.join("note.md")).expect("read vault-b note"),
            "b-note",
            "vault 目录内的文件不是移除的删除面"
        );
        assert!(vault_b.is_dir(), "vault 目录本身必须还在");
    }

    /// 当前 vault 拒绝移除（按稳定 id），未打开 vault 时放行。
    #[test]
    fn remove_entry_refuses_the_current_vault_by_stable_id() {
        let root = TempDir::new();
        let registry = root.path().join(REGISTRY_DIR_NAME);
        seed_entry(&registry, "vault-a", "/tmp/vault-a", None);
        seed_entry(&registry, "vault-b", "/tmp/vault-b", None);

        let err = remove_entry_at(&registry, Some("vault-a"), "vault-a")
            .expect_err("当前 vault 必须被拒绝");
        assert_eq!(err.code, "vault_remove_current");
        assert!(
            registry.join("vault-a.json").exists(),
            "被拒绝时注册项必须原样留在盘上"
        );

        // 没有当前 vault（未打开）：任何注册项都可移除。
        remove_entry_at(&registry, None, "vault-a")
            .expect("无当前 vault 时放行")
            .expect("returns the previous entry");
        assert!(!registry.join("vault-a.json").exists());
    }

    /// 幂等：删两次，第二次返回 `None`（不把「读不到」当成删掉了去返回假载荷）。
    #[test]
    fn remove_entry_is_idempotent() {
        let root = TempDir::new();
        let registry = root.path().join(REGISTRY_DIR_NAME);
        seed_entry(&registry, "vault-a", "/tmp/vault-a", None);

        assert!(
            remove_entry_at(&registry, None, "vault-a")
                .expect("first removal")
                .is_some(),
            "第一次移除返回原值（撤销的载荷）"
        );
        assert!(
            remove_entry_at(&registry, None, "vault-a")
                .expect("second removal is not an error")
                .is_none(),
            "第二次移除是幂等的 None，不是伪造的载荷"
        );
    }

    /// 撤销逐字还原三个时间字段；已存在的项不被覆盖。
    #[test]
    fn restore_entry_writes_back_the_original_fields() {
        let root = TempDir::new();
        let registry = root.path().join(REGISTRY_DIR_NAME);
        fs::create_dir_all(&registry).expect("create registry dir");
        let original = RemovedVault {
            id: "vault-ghost".to_string(),
            path: "/Volumes/gone/notes".to_string(),
            last_opened_at: Some(1_757_000_001_000),
            missing_since: Some(1_757_000_002_000),
            archived_at: Some(1_757_000_003_000),
        };
        restore_entry_at(&registry, &original).expect("restore");

        let read = read_entry_file(&registry.join("vault-ghost.json")).expect("entry readable");
        assert_eq!(read.id, original.id);
        assert_eq!(read.path, original.path);
        assert_eq!(read.last_opened_at, original.last_opened_at);
        assert_eq!(read.missing_since, original.missing_since);
        assert_eq!(read.archived_at, original.archived_at);

        // 已存在的项不被覆盖：撤销不是「改写现存注册项」的写通道。
        let occupied = RemovedVault {
            id: "vault-ghost".to_string(),
            path: "/elsewhere".to_string(),
            last_opened_at: None,
            missing_since: None,
            archived_at: None,
        };
        restore_entry_at(&registry, &occupied).expect("restore over an existing entry");
        let unchanged =
            read_entry_file(&registry.join("vault-ghost.json")).expect("entry readable");
        assert_eq!(unchanged.path, original.path, "已存在的注册项不得被覆盖");
        assert_eq!(unchanged.last_opened_at, original.last_opened_at);

        // 移除 → 撤销的往返：往返后四个字段与移除前逐项相等。
        let removed = remove_entry_at(&registry, None, "vault-ghost")
            .expect("remove")
            .expect("previous entry");
        assert_eq!(removed.missing_since, original.missing_since);
        restore_entry_at(&registry, &removed).expect("undo");
        let round_trip =
            read_entry_file(&registry.join("vault-ghost.json")).expect("entry readable");
        assert_eq!(round_trip.last_opened_at, original.last_opened_at);
        assert_eq!(round_trip.missing_since, original.missing_since);
        assert_eq!(round_trip.archived_at, original.archived_at);
    }
}
