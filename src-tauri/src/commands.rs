//! invoke / event 契约薄约定 —— M1 接缝（架构复查 P1-2）。
//!
//! M1 起所有 webview ↔ Rust core 通信遵守以下约定：
//! Tauri 默认将参数名映射为 camelCase；本仓含下划线参数的 command 统一使用
//! `#[tauri::command(rename_all = "snake_case")]`，前端 IPC 键与 Rust 保持一致。
//!
//! ## command 命名
//!
//! `<domain>_<verb>`，snake_case，invoke 名即 Rust 函数名（`tauri::generate_handler!`
//! 自动保持一致）。domain 用模块名：`config_get`、`fs_scan_workspace`、
//! `link_graph_resolve`（后两个为后续波次示例，本波不实现）。
//!
//! ## 错误信封
//!
//! 所有 command 返回 `Result<T, CommandError>`。`CommandError` 经 serde 序列化后
//! 作为 invoke 的 reject 值传给前端，结构为 `{ code, message }`：
//! - `code`：机器可判定的稳定标识，snake_case，如 `config_home_unknown`；
//! - `message`：人话（中文），前端可直接展示（ADR 0002 §5 要求非法配置给出人话错误）。
//!
//! 前端统一由 `src/ipc.ts` 的薄封装 unwrap，不把原始 reject 值散落各调用点。
//!
//! ## 事件命名
//!
//! Rust → webview 事件名用 `<domain>:<event>`，如 `config:changed`、
//! `fs:entry_changed`。payload 类型与 command 返回值同一来源（见下）。
//!
//! ## payload 类型单一来源：ts-rs
//!
//! Rust struct/enum 是唯一定义点，`#[derive(TS)]` + `#[ts(export)]` 在
//! `cargo test` 时把 TS 类型导出到 `src/bindings/`（生成物入仓，diff 可见漂移）。
//! 选型 ts-rs 而非 specta/tauri-specta 的理由见 Cargo.toml 注释。

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use ts_rs::TS;

use crate::config::{self, ConfigSnapshot};
use crate::fs_io::{self, FsChange, FsEntry, FsEntryChangedEvent, VaultWatcher};

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ReadSnapshot {
    pub content: String,
    pub revision: String,
}
use crate::link_graph::{self, CreateNoteResult, LinkGraph, LinkResolveResult};

/// command 错误信封（serde 序列化）。
///
/// **职责分层（M282，change ui-language-i18n 的 D6 裁决）**：
///   - `code` = 上屏文案的**键**：前端按它取文案表的条目（`src/copy.ts` 的 `errorText`），
///     因此上屏文本随界面语言切换；
///   - `params` = 那条文案要插的值（**按需携带**）：键名与文案表里的 `{占位名}` 同名；
///   - `message` = **诊断日志的内容**与**未知 code 的兜底**（固定中文，不随界面语言变）——
///     code 已知时 MUST NOT 直接上屏。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct CommandError {
    /// 机器可判定的稳定标识，snake_case。
    pub code: String,
    /// 人话错误（中文）：日志内容与未知 code 的兜底，**不随界面语言变**。
    pub message: String,
    /// 上屏文案的参数（键名 = `src/copy-data.ts` 里那条文案的 `{占位名}`）。
    /// **空时不序列化**（`skip_serializing_if`），因此 TS 侧要按「可能缺席」读
    ///（`src/copy.ts` 的 `ErrorEnvelope.params?` 就是这么声明的——ts-rs 的 `#[ts(optional)]`
    /// 只接受 `Option<T>` 字段，这里不改类型，只在生成物上留一句注记）。
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub params: std::collections::HashMap<String, String>,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            params: std::collections::HashMap::new(),
        }
    }

    /// 补一个上屏文案的参数（键名与文案表里那条文案的 `{占位名}` 同名）。可链式调用：
    /// `CommandError::new(code, msg).param("rel", rel).param("reason", e.to_string())`。
    ///
    /// 口径（M282，change ui-language-i18n 的 D6 裁决）：**模板里的 `{name}` 就是 Rust
    /// `format!` 的内联变量名**，值一般原样传（`&str` / `String` / `Path::display()`）；
    /// `{e}` 一类的 Display 值统一映射成 `reason`（文案表用 `{reason}`）。链式而不是数组
    /// 字面量：数组要求元素同型（`&str` 与 `String` 混不进一个数组），链式让每个参数各自
    /// 泛型化。**同一个 code 的每个构造点都必须提供该 code 文案的全部占位名**——缺一个，
    /// 前端 `t()` 会因缺参抛错并回落到中文 `message`（有一条门禁盯着这件事）。
    pub fn param<K: Into<String>, V: ToString>(mut self, key: K, value: V) -> Self {
        self.params.insert(key.into(), value.to_string());
        self
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CommandError {}

/// 读取当前生效配置 —— 契约链路的示例 command（M1 验证用）。
///
/// 证明：invoke 注册 → serde 序列化 → ts-rs 类型导出 → 前端 ipc.ts 调用 →
/// 错误信封前端可展示。配置加载本身见 [`config`]。
#[tauri::command]
pub fn config_get() -> Result<ConfigSnapshot, CommandError> {
    config::load()
}

// ---------------------------------------------------------------------------
// vault-workspace / fs-io（add-vault-workspace）
// ---------------------------------------------------------------------------

/// 已打开 vault 的快照：根路径 + 全量枚举结果。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultInfo {
    /// 稳定 vault 身份。
    pub vault_id: String,
    /// vault 根目录绝对路径。
    pub root: String,
    pub entries: Vec<FsEntry>,
    pub remap_candidates: Vec<crate::vault_registry::VaultWorkspace>,
}

/// 前端启动时查询的 vault 状态。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultStatus {
    /// 当前打开的 vault；未打开为 null。
    pub vault: Option<VaultInfo>,
    /// 人话提示（如 last_vault 恢复失败）；无提示为 null。前端可直接展示。
    pub notice: Option<String>,
    /// 启动恢复是否仍在进行（change startup-restore-off-main-thread）：true = 恢复线程仍
    /// 在跑（此时 `vault` 必为 null）；false = 终态（已打开，或未打开 + 可选 notice）。
    pub restore_pending: bool,
}

/// 进程内 vault 状态：同一时刻只有一个打开的 vault（spec：重复打开替换）。
pub struct VaultState {
    inner: Mutex<VaultInner>,
}

/// 已打开的 vault：根路径 + **本次装载编译的规则表**（change vault-open-ignore-set §4.5：
/// 规则表在装载时编译一次、随 vault 存活；物化集合也活在这里，随 vault 重建，
/// MUST NOT 跨 vault 串用）。
struct OpenVault {
    root: PathBuf,
    policy: fs_io::IgnorePolicy,
}

#[derive(Default)]
struct VaultInner {
    vault: Option<OpenVault>,
    /// drop 即停止监听（见 fs_io::VaultWatcher）。
    watcher: Option<VaultWatcher>,
    /// 启动恢复失败的人话提示，前端经 vault_current 取走后仍保留（幂等）。
    notice: Option<String>,
    /// wikilink 正反链索引（ADR 0002 §3）：vault 打开时建立，随 watch 增量维护。
    graph: LinkGraph,
    /// 打开世代号（M159）：每次**成功**提交 +1（启动为 0）。启动恢复在 `begin_restore`
    /// 记下当时的世代，提交时比对——用户抢先成功打开的 vault 优先，过期恢复结果整包丢弃。
    generation: u64,
    /// 启动恢复进行态（终态口径见 [`VaultStatus::restore_pending`]）。
    restore_pending: bool,
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(VaultInner::default()),
        }
    }
}

impl VaultInner {
    /// 提交一次打开：**唯一**写 root/watcher/graph 的入口。先起好新 watcher 再替换，
    /// 旧 watcher 随字段覆盖被 drop、监听停止；成功提交即世代 +1（M159 让位规则）。
    fn commit(&mut self, prepared: PreparedVaultOpen) {
        let PreparedVaultOpen {
            root,
            watcher,
            graph,
            policy,
            ..
        } = prepared;
        self.watcher = Some(watcher);
        self.vault = Some(OpenVault { root, policy });
        self.notice = None;
        self.graph = graph;
        self.generation += 1;
    }
}

impl VaultState {
    /// 进入恢复进行态并记下当前世代（启动恢复线程的起点）。
    pub fn begin_restore(&self) -> u64 {
        let mut inner = self.inner.lock().expect("vault state poisoned");
        inner.restore_pending = true;
        inner.generation
    }

    /// 启动恢复的**唯一**提交点（design §3.2）：单次持锁比对世代与「是否已有 vault」，
    /// 不符即整包丢弃——含失败 notice（用户已成功打开的 vault 不该被上次 vault 的提示
    /// 污染）。无论哪条分支都置 `restore_pending = false`；返回终局是否被应用。
    pub fn finish_restore(&self, generation: u64, outcome: RestoreOutcome) -> bool {
        let mut inner = self.inner.lock().expect("vault state poisoned");
        inner.restore_pending = false;
        if inner.generation != generation || inner.vault.is_some() {
            return false;
        }
        match outcome {
            RestoreOutcome::Opened(prepared) => inner.commit(*prepared),
            RestoreOutcome::Notice(notice) => inner.notice = Some(notice),
            RestoreOutcome::Idle => {}
        }
        true
    }

    /// 当前状态快照（`vault_current` command 与测试共用）：vault 非空时按 root 重新对账
    /// 稳定身份并全量枚举（用**当前** vault 的规则表——枚举结果必须与装载时的口径一致）。
    pub fn status(&self) -> Result<VaultStatus, CommandError> {
        let inner = self.inner.lock().expect("vault state poisoned");
        let vault = match &inner.vault {
            Some(vault) => Some(VaultInfo {
                vault_id: crate::vault_registry::reconcile_vault(&vault.root)?.id,
                root: vault.root.display().to_string(),
                entries: fs_io::scan_workspace(&vault.root, &vault.policy)?,
                remap_candidates: vec![],
            }),
            None => None,
        };
        Ok(VaultStatus {
            vault,
            notice: inner.notice.clone(),
            restore_pending: inner.restore_pending,
        })
    }

    fn root(&self) -> Result<PathBuf, CommandError> {
        self.inner
            .lock()
            .expect("vault state poisoned")
            .vault
            .as_ref()
            .map(|vault| vault.root.clone())
            .ok_or_else(|| CommandError::new("vault_not_open", "尚未打开 vault，请先选择目录"))
    }

    /// 当前 vault 的根 + 规则表（`fs_scan_dir` / `fs_scan_workspace` / 存在探测共用；
    /// **pub 消费方：harness 运行时（M302）**——会话按 vault 建、工具路径解析与
    /// vault_search 复用同一份装载时编译的规则表。未打开返回 `vault_not_open`。
    pub fn root_and_policy(&self) -> Result<(PathBuf, fs_io::IgnorePolicy), CommandError> {
        self.inner
            .lock()
            .expect("vault state poisoned")
            .vault
            .as_ref()
            .map(|vault| (vault.root.clone(), vault.policy.clone()))
            .ok_or_else(|| CommandError::new("vault_not_open", "尚未打开 vault，请先选择目录"))
    }

    /// 全量枚举结果建链接索引（open_vault 与测试共用）。
    ///
    /// **惰性条目不进索引**（§4.6 的装载路径）：索引的输入是「主动枚举的条目」，MUST NOT 依赖
    /// UI 交互历史（同一 vault 两次打开的解析结果一致）——用户展开过惰性目录也不改变这一点。
    ///
    /// **已知边界**（spec「全类型递归枚举」的已知边界段，实现期在此给出指针）：指向惰性区域的
    /// `[[wikilink]]` 与 `![[img.png]]` 因此解析为 `unresolved` / 找不到附件——用户在文件树里
    /// 展开那个目录、点开文件**照常可读**（打开链路是路径直读，不查索引）。这条降级是有意的
    /// （索引的确定性优先），不是漏实现。
    fn build_graph(root: &Path, entries: &[FsEntry]) -> LinkGraph {
        let mut graph = LinkGraph::new();
        for e in entries {
            if e.kind != fs_io::FsEntryKind::File || e.lazy {
                continue;
            }
            let content = if link_graph::is_markdown(&e.path) {
                // 单文件读取失败不阻塞建图：索引缺其派生信息，路径仍在候选全集
                fs_io::read_text_file(root, &e.path).ok()
            } else {
                None
            };
            graph.upsert(&e.path, content.as_deref());
        }
        graph
    }

    /// watch 增量 → 链接索引就地更新（tasks 1.4：复用 fs:entry_changed 事件流）。
    ///
    /// **增量路径同样不许把惰性条目带进索引**（§4.6，r2/r3 评审 P1-3）：`lazy` 标记由后端在
    /// 过滤 / 投递那一步用同一份规则表算出，这里只消费、MUST NOT 重算。反例（本 change 之前
    /// 必然发生）：`HANDOFF.md` 被 `.gitignore` 声明，外部改写它 ⇒ 事件投递 ⇒ 它一度进入链接
    /// 索引 ⇒ `[[HANDOFF]]` 本会话内可解析、重开后不可解析。
    ///
    /// **deleted 方向无条件移除**（幂等：本来不在索引里就是空操作）：因此该方向不消费 `lazy`
    /// ——这也绕开了「被删路径 stat 不到、目录限定模式判不准类型」的歧义。
    pub fn apply_fs_changes(&self, changes: &[FsChange]) {
        let mut inner = self.inner.lock().expect("vault state poisoned");
        let Some(root) = inner.vault.as_ref().map(|vault| vault.root.clone()) else {
            return;
        };
        for c in changes {
            match c.kind {
                fs_io::FsChangeKind::Deleted => inner.graph.remove(&c.path),
                _ => {
                    if c.lazy {
                        continue; // 惰性条目：树照常收行，索引不收（§4.6）
                    }
                    if c.entry_kind == Some(fs_io::FsEntryKind::Dir) {
                        continue; // 目录本身不进候选全集
                    }
                    if link_graph::is_markdown(&c.path) {
                        let content = fs_io::read_text_file(&root, &c.path).ok();
                        inner.graph.upsert(&c.path, content.as_deref());
                    } else {
                        inner.graph.upsert(&c.path, None);
                    }
                }
            }
        }
    }
}

/// 打开 vault 的第一阶段（M159 两阶段拆分）：全部 IO 与副作用——remap 门、注册表对账、
/// 起 watch、全量枚举、建索引——都在这里完成，**不改写 `VaultState`**。未提交即 drop 的
/// watcher 等于不监听，所以「准备失败 / 被丢弃」都不会留下半个打开态。
pub struct PreparedVaultOpen {
    /// vault 根目录绝对路径。
    pub root: PathBuf,
    /// 稳定 vault 身份（`reconcile_vault` 的结果）。
    pub vault_id: String,
    pub entries: Vec<FsEntry>,
    /// 提交时随 [`VaultInner::commit`] 接管；提前 drop 即停止监听。
    pub watcher: VaultWatcher,
    /// 全量枚举结果建出的链接索引。
    pub graph: LinkGraph,
    /// 本次装载编译的规则表（change vault-open-ignore-set §4.5）：随 vault 一起提交、
    /// 一起被替换——它是「一份策略、五个使用点」的那一份（枚举 / 按需枚举 / watch /
    /// 子树补全 / 名字校验）。
    pub policy: fs_io::IgnorePolicy,
}

/// [`prepare_vault_open`] 的两种结果：真正备好的打开，或 remap 候选短路（**没有**打开
/// 任何 vault，行为与拆分前逐字一致）。
pub enum PreparedOpen {
    Remap {
        root: PathBuf,
        candidates: Vec<crate::vault_registry::VaultWorkspace>,
    },
    /// Boxed：`PreparedVaultOpen` 比 Remap 分支大一个数量级（clippy::large_enum_variant）。
    Ready(Box<PreparedVaultOpen>),
}

/// 打开 vault 的第一阶段实现（见 [`PreparedVaultOpen`]）。
pub fn prepare_vault_open(
    app: &tauri::AppHandle,
    root: PathBuf,
    force_new: bool,
) -> Result<PreparedOpen, CommandError> {
    // 已注册路径直接打开，不受 remap 门影响（M121 修复：幽灵注册项曾拦停
    // 已注册 vault）。门判定只读——reconcile_vault 对未注册路径有注册 side effect，
    // 不能用来探测「目标未注册」。
    if !force_new {
        if let Some(candidates) = crate::vault_registry::remap_gate(&root)? {
            return Ok(PreparedOpen::Remap { root, candidates });
        }
    }
    // Register/reconcile stable vault identity before opening.
    let workspace = crate::vault_registry::reconcile_vault(&root)?;
    // 规则表在**装载时编译一次**（spec「全类型递归枚举」）：现场读一次配置取用户规则的来源
    // 清单（`config::load()` 本来就是按需读盘，MUST NOT 为它引入启动期缓存——那会把
    // 「配置改动下次装载生效」这条口径做坏）。配置读不到（配置目录不可确定）时用出厂默认
    // 清单：打开 vault 是主结果，不该被一次配置读取失败拦停。
    let rule_files = config::load()
        .map(|snapshot| snapshot.config.vault.rule_files)
        .unwrap_or_else(|_| config::VaultConfig::default().rule_files);
    let policy = fs_io::IgnorePolicy::load(&root, &rule_files);
    // 顺序：先 watch（FSEvents 流起点在此刻）再全量枚举，消除 scan→watch 的
    // 事件空窗；枚举结果随后播种进 watcher 的已知路径集（修正重放的误报 Create）。
    let app_for_watch = app.clone();
    let watch_root = root.clone();
    // watch 建流的耗时单独记一条读数（M283 的 1.2）：它落在这段里，而此前**从未测过**
    // ——「指示静止 + beachball」的窗口有没有它、要不要把整段移出主线程（裁决点 3）都挂在
    // 这个数上。本 change 起 `vault_open_path` 已是 `#[command(async)]`（见其注释），整段
    // 不再占 IPC 主线程；这条读数照旧保留，它是「三段各占多少」的对照。
    let watch_started = std::time::Instant::now();
    let watcher = fs_io::watch(&watch_root, &policy, move |changes: Vec<FsChange>| {
        // 链接索引随事件流增量更新（先于 emit：前端收到事件时索引已新）
        app_for_watch
            .state::<VaultState>()
            .apply_fs_changes(&changes);
        // webview 尚未就绪时 emit 失败无害：前端启动后经 vault_current 拉全量
        let _ = app_for_watch.emit("fs:entry_changed", FsEntryChangedEvent { changes });
    })?;
    crate::logging::slow_callback(
        "vault_open_watch",
        &format!("{:.1}", watch_started.elapsed().as_secs_f64() * 1000.0),
    );
    // 打开段的**分段读数**（change vault-open-ignore-set §6.2）：两条都**无条件记录**
    //（与 `vault_open_watch` 同口径，阈值不是这里的判据）——「日志里没有这一行」与「它很快」
    // 事后不可区分。真机跑一次之后：`vault_load_open`（前端总时长）− 本两条 ≈ 序列化 + 传输
    // + JSON.parse，那正是「真机 5.5s vs 合成 3.1s」缺口归因要的那个残差。
    let scan_started = std::time::Instant::now();
    let entries = fs_io::scan_workspace(&root, &policy)?;
    crate::logging::slow_callback(
        "vault_open_scan",
        &format!("{:.1}", scan_started.elapsed().as_secs_f64() * 1000.0),
    );
    watcher.seed(entries.iter().map(|e| e.path.clone()));
    let graph_started = std::time::Instant::now();
    let graph = VaultState::build_graph(&root, &entries);
    crate::logging::slow_callback(
        "vault_open_graph",
        &format!("{:.1}", graph_started.elapsed().as_secs_f64() * 1000.0),
    );
    Ok(PreparedOpen::Ready(Box::new(PreparedVaultOpen {
        root,
        vault_id: workspace.id,
        entries,
        watcher,
        graph,
        policy,
    })))
}

/// 打开 vault 的第二阶段：单次持锁提交，返回是否提交（prepare 的产物被 `commit` 接管后
/// 其 watch 随之生效）。用户主动打开一律无条件提交——「让位给用户抢先打开的 vault」这条
/// 世代判定只有一处实现，在 [`VaultState::finish_restore`]（启动恢复的唯一提交点）。
pub fn commit_vault_open(state: &VaultState, prepared: PreparedVaultOpen) -> bool {
    let mut inner = state.inner.lock().expect("vault state poisoned");
    inner.commit(prepared);
    true
}

/// 启动恢复的终局（design §3.2/§5）：由恢复线程在提交前算出，交
/// [`VaultState::finish_restore`] 单次持锁裁决应用或整体丢弃。
pub enum RestoreOutcome {
    /// 恢复成功：提交已备好的打开结果。
    Opened(Box<PreparedVaultOpen>),
    /// 以人话提示结束（路径失效 / 配置加载失败 / 打开失败 / remap 候选）。
    Notice(String),
    /// 无 `last_vault`：终态是「未打开且无提示」，不写任何状态。
    Idle,
}

/// 打开 vault 的公共路径（`vault_open` / `vault_open_path` 两个 command 共用）：
/// 「prepare + 无条件 commit」等价于 M159 之前的单函数实现——全量枚举成功后才替换当前
/// vault、停旧 watch、起新 watch（spec：替换语义），remap 候选短路返回行为不变。
pub fn open_vault(
    app: &tauri::AppHandle,
    state: &VaultState,
    root: PathBuf,
    force_new: bool,
) -> Result<VaultInfo, CommandError> {
    match prepare_vault_open(app, root, force_new)? {
        PreparedOpen::Remap { root, candidates } => Ok(VaultInfo {
            vault_id: candidates[0].id.clone(),
            root: root.display().to_string(),
            entries: vec![],
            remap_candidates: candidates,
        }),
        PreparedOpen::Ready(prepared) => {
            let prepared = *prepared;
            let info = VaultInfo {
                vault_id: prepared.vault_id.clone(),
                root: prepared.root.display().to_string(),
                entries: prepared.entries.clone(),
                remap_candidates: vec![],
            };
            // 用户主动打开无条件提交（与拆分前等价）；让位判定只在 finish_restore。
            commit_vault_open(state, prepared);
            Ok(info)
        }
    }
}

/// last_vault 写回（配置即数据纪律，ADR 0002 §5）：
/// 在既有配置 JSON 上逐字段改写（未知字段原样保留），tmp + rename 原子写入。
pub fn write_last_vault(root: &Path) -> Result<(), CommandError> {
    write_last_vault_to(&config::config_dir()?.join("config.json"), root)
}

/// 指定配置文件路径的写回（可测：不依赖真实配置目录）。
pub(crate) fn write_last_vault_to(path: &Path, root: &Path) -> Result<(), CommandError> {
    let mut value = read_config_json(path);
    merge_last_vault(&mut value, root);
    config::write_json_atomic(path, &value)
}

/// 应用侧写 config.json 的共用读入（ADR 0002 §5 配置即数据）：读整份 JSON 为 `Value`，
/// 解析失败或不是对象按 `{}` 起——与写回纪律配套的宽容读入，未知字段原样保留在 Value 里。
fn read_config_json(path: &Path) -> serde_json::Value {
    let mut value: serde_json::Value = match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    if !value.is_object() {
        value = serde_json::json!({});
    }
    value
}

/// version 的写入纪律（merge_last_vault 与 merge_ui_value 共用）：仅在缺失或不高于
/// 当前 schema 时写入：更高版本说明配置由更新版本的应用写入，盲写会把
/// 版本标记降回当前值（失真），保留原值让 config::load 继续按高版本 warning。
fn bump_config_version(value: &mut serde_json::Value) {
    let version = value.get("version").and_then(|v| v.as_u64());
    if version.is_none_or(|v| v <= u64::from(config::SCHEMA_VERSION)) {
        value["version"] = serde_json::json!(config::SCHEMA_VERSION);
    }
}

/// 逐字段改写 last_vault 的纯函数部分（可测）。
fn merge_last_vault(value: &mut serde_json::Value, root: &Path) {
    bump_config_version(value);
    value["last_vault"] = serde_json::json!(root.display().to_string());
}

/// 配置表的单键合并写（M301 泛化，change add-harness-probe §11）：把 `section.<key>` 这一个键
/// 写进 config.json，其余字段（含未知字段与其它表）逐键保留。
///
/// 两个调用方、**同一份实现**（不留第二套写通道）：`config_set_ui_value`（前端两个运行期回写点
/// ——栏宽拖拽、主题 / 语言切换）等价于 `section = "ui"`；本命令是任意表名的泛化入口。
/// 前端失败降级为 toast + 诊断日志，运行期值不回滚（与 remember_last_vault 同口径）。
/// **写通道不校验取值**——非法值由下次启动的 `validate()` 兜（既有边界）。
#[tauri::command(rename_all = "snake_case")]
pub fn config_set_value(
    section: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), CommandError> {
    write_config_value_to(
        &config::config_dir()?.join("config.json"),
        &section,
        &key,
        &value,
    )
}

/// `[ui]` 表的单键合并写（M228，change content-width-drag，节点 1 裁决 D3：「写回
/// config.json」+「命令做成通用键值写入」）。第一个调用方是栏宽拖拽松手后的
/// `ui.content_width` 持久化；**M237 主题切换的 `ui.theme` 复用同一通道**（change
/// live-theme-switch——运行期切换不新增第二个写命令，同一条语义不留两套写通道）。
///
/// M301 泛化后本命令是 `config_set_value(section = "ui")` 的**同义入口**：命令名与参数形状
/// 保持不动（前端 `src/ipc.ts` 的 `configSetUiValue` 零改动），实现委托给泛化路径。
#[tauri::command(rename_all = "snake_case")]
pub fn config_set_ui_value(key: String, value: serde_json::Value) -> Result<(), CommandError> {
    config_set_value("ui".to_string(), key, value)
}

/// 指定配置文件路径的「表 + 键」合并写（可测：不依赖真实配置目录）。
pub(crate) fn write_config_value_to(
    path: &Path,
    section: &str,
    key: &str,
    section_value: &serde_json::Value,
) -> Result<(), CommandError> {
    if section.trim().is_empty() {
        return Err(CommandError::new(
            "config_write_failed",
            "配置表名不能为空".to_string(),
        ));
    }
    if key.trim().is_empty() {
        return Err(CommandError::new(
            "config_write_failed",
            format!("{section} 配置键不能为空"),
        ));
    }
    let mut value = read_config_json(path);
    merge_config_value(&mut value, section, key, section_value);
    config::write_json_atomic(path, &value)
}

/// 合并写 `<section>.<key>` 的纯函数部分（可测）：只改这一个键，其余字段（含未知字段与其它表）
/// 逐键保留；该表不是对象时重置为空对象（错形状不拖垮整份配置，与读入侧的宽容同路）。
///
/// M301 泛化：原 `merge_ui_value` 里写死的 `"ui"` 变成 `section` 参数，
/// `merge_ui_value(v, k, x)` ≡ `merge_config_value(v, "ui", k, x)`，行为逐条不变。
fn merge_config_value(
    value: &mut serde_json::Value,
    section: &str,
    key: &str,
    section_value: &serde_json::Value,
) {
    bump_config_version(value);
    if !value.get(section).is_some_and(|entry| entry.is_object()) {
        value[section] = serde_json::json!({});
    }
    value[section][key] = section_value.clone();
}

/// 打开成功后的记忆写回：失败降级为 warning，MUST NOT 让整条打开失败（M127
/// 修复 M121 reviewer 记录的既有分歧——打开成功却因记忆写失败返回 Err，前端
/// 不装载已打开的 vault）。打开是主结果，记忆只影响下次启动的自动恢复。
pub fn remember_last_vault(root: &Path) {
    match config::config_dir() {
        Ok(dir) => {
            remember_last_vault_to(&dir.join("config.json"), root);
        }
        Err(e) => warn_last_vault_failed(&e),
    }
}

/// 指定路径的记忆写回（可测）：写失败打 warning 并返回 false，不传播错误。
pub(crate) fn remember_last_vault_to(path: &Path, root: &Path) -> bool {
    match write_last_vault_to(path, root) {
        Ok(()) => true,
        Err(e) => {
            warn_last_vault_failed(&e);
            false
        }
    }
}

fn warn_last_vault_failed(e: &CommandError) {
    eprintln!("lumir: 记录 last_vault 失败（vault 已打开，本次忽略）：{e}");
}

/// 读一次当前生效的界面语言（M282，change ui-language-i18n 的 D6 裁决：「由操作系统渲染的
/// 界面文本无法运行期切换 —— 后端在弹出时读一次当前语言并据此取值；已弹出的对话框不跟随」）。
///
/// 配置读不到（首次启动 / 配置损坏）时按出厂默认 `En`（与 `UiConfig::default().language` 同值）
/// ——这里 MUST NOT 让一次标题取值把「打开 vault」这条链路打红。
fn current_ui_language() -> crate::config::UiLanguage {
    crate::config::load()
        .map(|snapshot| snapshot.config.ui.language)
        .unwrap_or(crate::config::UiLanguage::En)
}

/// 原生目录选择器的标题（OS 渲染，前端不可达）。两档文案与 `文案-Copy.md` 的 D321 逐字一致。
///
/// **这是全仓唯一一处 Rust 侧持有可见文案的地方**，理由在 D321 的设计意图列里写着：那个对话框
/// 由 OS 画，跑在 webview 之外的 Rust 进程里，前端拿不到也改不了。因此它是**有意的第二处**
/// 文案落点，不是漏迁移的残留——deck 的 D321 就是它的评审面，英文列与这里的 `En` 分支逐字对应。
fn picker_title(language: crate::config::UiLanguage) -> &'static str {
    match language {
        crate::config::UiLanguage::Zh => "选择 vault 目录",
        crate::config::UiLanguage::En => "Choose a vault folder",
    }
}

/// 打开成功后的记账（M127 的 `last_vault` + M162 的注册项 `last_opened_at`）：两者在
/// **同一次成功路径**上写，都只降级 warning（打开是主结果，两者都只影响下次启动与列表顺序）。
///
/// `remap_candidates` 非空 = 这次被 remap 门拦下、没有打开任何 vault（`open_vault` 的
/// 短路返回），一律不记账——否则一次没有发生的打开会改写列表排序，并被记成「上次打开的
/// vault」。启动恢复不调本函数：它不改写 `last_vault`（本来就是从它恢复的），只在提交之后
/// 记账 `last_opened_at`（见 `lib.rs` 的 `RestoreGuard::finish`）。
pub fn remember_open(info: &VaultInfo) {
    if !info.remap_candidates.is_empty() {
        return;
    }
    remember_last_vault(Path::new(&info.root));
    crate::vault_registry::mark_opened(&info.vault_id);
}

/// 调系统目录选择器打开 vault；用户取消返回 Ok(None)，不产生错误状态。
/// 成功后写入 last_vault。
#[tauri::command(rename_all = "snake_case")]
pub async fn vault_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    force_new: bool,
) -> Result<Option<VaultInfo>, CommandError> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title(picker_title(current_ui_language()))
        .pick_folder()
        .await;
    let Some(handle) = picked else {
        return Ok(None);
    };
    let root = handle.path().to_path_buf();
    let info = open_vault(&app, &state, root, force_new)?;
    // 打开成功才记账（remap 短路不记）：last_vault 与 last_opened_at 在同一次成功路径上写，
    // 两者都降级 warning（M127：不把已成功的打开报成失败）。
    remember_open(&info);
    Ok(Some(info))
}

/// 按已知路径直接打开 vault（无目录选择器）：仅用于重映射确认后的重开——
/// 路径来自用户刚刚在选择器里选中的 VaultInfo.root，确认动作（作为新 vault /
/// 确认映射）不应再弹一次选择器让用户重选同一目录。
///
/// **线程语义**（change vault-open-ignore-set §5）：标 `#[command(async)]`（保持同步 `fn`
/// 形态，tauri 宏生成 `sync_threadpool` 语义——body 在 async 运行时的 worker 上执行，不占 IPC
/// 主线程；返回值的 JSON 序列化同在那个 worker 里）。此前它与 `vault_open`（本来就是
/// `async fn`）跑同一段 `open_vault` 工作却一条在主线程内联、一条不在，用户可观察的差别是
/// 打开段期间 webview 能否重绘（条目数大的 vault 上整窗不可交互、进度指示静止、只能等）。
/// 本 change 把 outlier 拉平：两条 path 的线程语义一致。
///
/// 已知不完美（与 `vault_open` 同形，不引入形态分叉）：body 里是**阻塞式文件 IO**，跑在
/// async 运行时的 worker 上会占住一个 worker（不是 `spawn_blocking`）。同仓 `vault_open`
/// 已是这个形态，且没有读数表明需要改成 `spawn_blocking`。
#[tauri::command(async, rename_all = "snake_case")]
pub fn vault_open_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    path: &str,
    force_new: bool,
) -> Result<VaultInfo, CommandError> {
    let info = open_vault(&app, &state, PathBuf::from(path), force_new)?;
    // 打开成功才记账（remap 短路不记），同 vault_open：last_vault 与 last_opened_at 同次写入。
    remember_open(&info);
    Ok(info)
}

/// 启动后查询当前 vault 状态（含恢复进行态与恢复失败的人话提示）。
#[tauri::command]
pub fn vault_current(state: tauri::State<'_, VaultState>) -> Result<VaultStatus, CommandError> {
    state.status()
}

/// 全量重扫当前 vault（前端按需调用；watch 期间常规刷新走增量事件）。
#[tauri::command]
pub fn fs_scan_workspace(
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<FsEntry>, CommandError> {
    let (root, policy) = state.root_and_policy()?;
    fs_io::scan_workspace(&root, &policy)
}

/// 按需枚举一个目录的**一层**条目（change vault-open-ignore-set §4.3）：文件树展开惰性目录时
/// 的唯一取数通道。惰性条目的子孙不在装载时的枚举结果里，树 MUST NOT 把它们当作空目录渲染。
///
/// 分类口径与 [`fs_scan_workspace`] 完全同源（内置规则丢弃、用户规则命中出一行且 `lazy`、
/// 其余正常），且**只枚举一层**、不递归下钻。路径走与所有读取路径同源的 vault 内校验
///（MUST NOT 为按需枚举放松边界）；目标不存在 / 不是目录 ⇒ 人话 `CommandError`。
///
/// **线程语义**（§5.2）：标 `#[command(async)]`（同 `vault_open_path`）。一次展开可能是几万条
///（`.tower/worktrees` 下层），不能占 IPC 主线程。
///
/// 成功返回即把该目录登记进**物化集合**（watch 判定惰性子树事件是否实时的唯一开关）。
#[tauri::command(async, rename_all = "snake_case")]
pub fn fs_scan_dir(
    state: tauri::State<'_, VaultState>,
    dir: &str,
) -> Result<Vec<FsEntry>, CommandError> {
    let (root, policy) = state.root_and_policy()?;
    // 一次展开的读数（§6.2）：**有条件**（阈值 250ms，与前端 `phaseMs` 同口径）——展开一个
    // 条目数很大的目录时用户会看到明确的等待，值得留一条；小目录不记，不稀释日志。
    let started = std::time::Instant::now();
    let entries = fs_io::scan_dir(&root, &policy, dir)?;
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    if ms >= 250.0 {
        crate::logging::slow_callback("vault_scan_dir", &format!("{ms:.1}"));
    }
    Ok(entries)
}

/// 批量探测一组 vault 相对路径是否存在（change vault-open-ignore-set §4.11）：返回其中确实
/// 存在的那些。消费方是会话恢复的「在不在 vault 内」判定与阅读位置的存量键修剪——两者都不能
/// 只看装载时的枚举结果（被用户规则命中的惰性文件在树里可见、可打开，却永不进枚举）。
///
/// **批量**而不是逐条：两个消费点的候选数都不小（会话条目数、阅读位置键上限 200），逐条走 IPC
/// 会把 N 次往返叠在装载路径上。一次命令、一次往返、N 次 stat。
///
/// 越界（绝对路径 / `..` / 符号链接逃逸）与不存在的路径一律不出现在返回集合里、且不逐条报错
///（两者对调用方同义）；边界校验本身照旧执行，越界路径不会被 stat。本命令只 stat，
/// MUST NOT 创建 / 改写 / 删除任何文件。
#[tauri::command]
pub fn fs_paths_exist(
    state: tauri::State<'_, VaultState>,
    paths: Vec<String>,
) -> Result<Vec<String>, CommandError> {
    let root = state.root()?;
    Ok(fs_io::paths_exist(&root, &paths))
}

/// 读 vault 内文本文件与绑定 revision 快照（UTF-8）。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_read_snapshot(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<ReadSnapshot, CommandError> {
    let root = state.root()?;
    let (content, revision) = fs_io::read_text_snapshot(&root, path)?;
    Ok(ReadSnapshot { content, revision })
}

/// 单文件元数据（M218 doc-title/doc-meta 块的数据源）：mtime 取不到为 null，
/// 与 `FsEntry.mtime_ms` 同口径。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct FsFileMeta {
    /// 修改时间（Unix 毫秒）；取不到时为 null。
    #[ts(type = "number | null")]
    pub mtime_ms: Option<i64>,
}

/// 读 vault 内单文件的元数据（doc-meta「修改于」需要 mtime；`fs_read_snapshot`
/// 不带它，文件列表的 `FsEntry` 又不覆盖「保存后即时刷新」这条路径，故单开）。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_file_mtime(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<FsFileMeta, CommandError> {
    let root = state.root()?;
    Ok(FsFileMeta {
        mtime_ms: fs_io::file_mtime_ms(&root, path)?,
    })
}

/// 读 vault 内二进制附件，返回 base64（裁决点 A：invoke + base64）。
#[tauri::command]
pub fn fs_read_attachment(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<String, CommandError> {
    fs_io::read_attachment(&state.root()?, path)
}

#[tauri::command(rename_all = "snake_case")]
pub fn fs_file_revision(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<String, CommandError> {
    fs_io::file_revision(&state.root()?, path)
}

#[tauri::command(rename_all = "snake_case")]
pub fn document_save(
    state: tauri::State<'_, VaultState>,
    path: &str,
    expected_revision: &str,
    content: &str,
) -> Result<String, CommandError> {
    let root = state.root()?;
    match fs_io::save_document(&root, path, expected_revision, content) {
        Ok(revision) => Ok(revision),
        Err(e) => {
            // 诊断埋点：CAS 冲突是本族里最要紧的摩擦信号（kind 冲突检测点就在这）。
            if e.code == "document_conflict" {
                crate::logging::save_conflict(path, &e.code);
            }
            Err(e)
        }
    }
}

/// 编辑器未保存修改（dirty）的后端镜像（M101 退出守卫）：前端 onDirty 每次变化
/// 经 document_set_dirty 同步；lib.rs 的退出/关窗守卫据此拦截。前端是唯一事实源，
/// 后端只保存最近一次上报值，不做独立推导。
/// 防滞留（M107）：镜像可能滞留 stale true——webview 重载后前端 dirty 复位为
/// false，而后端仍保留重载前的 true，退出将被永久拦截。因此前端初始化后主动
/// 推送一次当前 dirty 值（启动时必为 false，即复位镜像），见 src/main.ts。
#[derive(Default)]
pub struct DirtyState(AtomicBool);

impl DirtyState {
    pub fn set(&self, dirty: bool) {
        self.0.store(dirty, Ordering::SeqCst);
    }

    pub fn is_dirty(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[tauri::command]
pub fn document_set_dirty(
    state: tauri::State<'_, DirtyState>,
    dirty: bool,
) -> Result<(), CommandError> {
    state.set(dirty);
    Ok(())
}

/// 前端诊断事件统一入口（change add-diagnostics-logging）：前端不自行写日志文件，
/// 关键事件（渲染失败、保存冲突、崩溃备份、config warning、慢回调采样、外部修改命中）
/// 全部经这一条命令交给 Rust 侧落盘。
///
/// 事件名是 [`crate::logging::LogEventName`] 枚举——事件集与字段白名单的唯一来源在
/// Rust（TS 联合类型由 ts-rs 导出给前端 import），前端不另立清单；枚举反序列化失败
/// 即白名单外事件名，被 invoke 层拒绝。字段白名单校验在 logging 侧，拒绝时返回
/// `log_event_rejected` 错误信封（调用方按 best-effort 处理，日志不打断业务）。
#[tauri::command(rename_all = "snake_case")]
pub fn log_event(
    event: crate::logging::LogEventName,
    fields: HashMap<String, String>,
) -> Result<(), CommandError> {
    crate::logging::log_frontend_event(event, fields)
}

// ---------------------------------------------------------------------------
// 外链打开（M144，change add-external-link-open）
// ---------------------------------------------------------------------------

/// 外链 scheme 白名单——**唯一来源**。只有这三类能交给系统默认应用；其余 scheme
/// 一律拒绝（`file:` / `javascript:` / 应用自定义协议…）：文档内容不该能指挥操作
/// 系统去打开任意东西。前端不复制这份清单，它只把编辑器里读到的 URL 原文递过来。
const EXTERNAL_URL_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// 去 CommonMark 的尖括号包裹形式（`[a](<https://x>)`）与首尾空白。
fn target_text(raw: &str) -> &str {
    let text = raw.trim();
    text.strip_prefix('<')
        .and_then(|inner| inner.strip_suffix('>'))
        .unwrap_or(text)
        .trim()
}

/// 归一 URL 的 scheme：命中白名单返回规范小写写法（`HTTP://x` 与 `http://x` 同归一），
/// 其余情况（白名单外的 scheme、没有 scheme）一律返回 `other`——诊断日志只记分类，
/// 不记原文。
fn scheme_label(target: &str) -> &'static str {
    let Some((scheme, _)) = target.split_once(':') else {
        return "other";
    };
    EXTERNAL_URL_SCHEMES
        .iter()
        .copied()
        .find(|allowed| allowed.eq_ignore_ascii_case(scheme))
        .unwrap_or("other")
}

/// 能否交给系统打开：scheme 在白名单内，且目标里没有空白 / 控制字符。
/// 后者是「还原不可信」的护栏——目标里混进空白或控制字符说明我们对这条 URL 的
/// 还原不可靠，宁可拒绝也不要把半截字符串递给系统。返回 (scheme 标签, 目标)。
fn openable_external_url(raw: &str) -> Option<(&'static str, &str)> {
    let target = target_text(raw);
    let scheme = scheme_label(target);
    if scheme == "other" || target.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    Some((scheme, target))
}

/// 在系统默认应用打开外链（http / https / mailto）。
///
/// 为什么用插件而不是自己拼 `open` 命令：跨平台语义由插件持有（macOS 走 NSWorkspace
/// 等价路径），本仓不维护一套平台分支。为什么走 Rust 侧而不是前端 JS API：webview 对
/// opener 命令的 ACL 保持默认拒绝（capabilities 不加任何 `opener:*` 权限），唯一入口
/// 是这条 command——scheme 校验、诊断埋点、错误信封都只在一个地方，webview 里没有第二
/// 条能绕开校验去开 URL 的路径。
///
/// 校验落在 Rust：前端可能被文档内容影响（URL 来自 Markdown 正文），信任边界在这一侧。
/// 拒绝时返回 `open_url_rejected`（前端 toast 人话），失败时返回 `open_url_failed`。
#[tauri::command(rename_all = "snake_case")]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;

    let Some((scheme, target)) = openable_external_url(&url) else {
        crate::logging::link_open(
            "blocked-scheme",
            "rejected",
            Some(scheme_label(target_text(&url))),
        );
        return Err(CommandError::new(
            "open_url_rejected",
            format!("打不开这类链接：{url}——只支持 http、https、mailto"),
        )
        .param("raw", url));
    };
    match app.opener().open_url(target, None::<&str>) {
        Ok(()) => {
            crate::logging::link_open("external", "opened", Some(scheme));
            Ok(())
        }
        Err(e) => {
            crate::logging::link_open("external", "failed", Some(scheme));
            Err(
                CommandError::new("open_url_failed", format!("打开链接失败：{e}"))
                    .param("reason", e.to_string()),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 相对路径链接（M145，change add-external-link-open 的形态矩阵补全）
// ---------------------------------------------------------------------------

/// 解析相对路径 md 链接 `[x](note.md)`：以 `from` 所在目录为基准（`./` `..` 归一，
/// 允许 `..` 只要不越出 vault 根），命中的 vault 相对路径经 link_graph 的文件全集
/// 判定——语义与 wikilink 的名称匹配不同源，见 `LinkGraph::resolve_relative`。
///
/// 返回 `None` = 解析不到（目标不存在 / 越出 vault 根 / 空路径）。**这不是错误**：
/// 前端只给「链接目标不存在」toast，MUST NOT 创建文件（一键创建是 wikilink 的显式
/// 动作，相对路径链接不继承它）。`#fragment` 部分按 M145 口径忽略。
#[tauri::command(rename_all = "snake_case")]
pub fn link_resolve_note(
    state: tauri::State<'_, VaultState>,
    from: String,
    target: String,
) -> Result<Option<String>, CommandError> {
    let inner = state.inner.lock().expect("vault state poisoned");
    if inner.vault.is_none() {
        return Err(CommandError::new(
            "vault_not_open",
            "尚未打开 vault，请先选择目录",
        ));
    }
    Ok(inner.graph.resolve_relative(&from, &target))
}

/// 在系统默认应用打开 vault 内的非 md 文件 `[x](./doc.pdf)` / 目录 `[x](docs/)`。
///
/// 与 `open_external_url` 同一分层与同一条最小权限路径（opener 插件的 IPC 对 webview
/// 保持默认拒绝，唯一入口是本仓 command）。区别在信任边界：外链校验的是 scheme，
/// 这里校验的是**目标必须落在 vault 内**——路径归一后交给 `fs_io::resolve_in_vault`
/// （拒绝绝对路径 / `..` / 符号链接逃逸，且目标必须存在），前缀校验与读取链路同源。
/// 越界 → `link_path_rejected`，不存在 / 不可访问 → 透传 fs 侧的人话错误。
#[tauri::command(rename_all = "snake_case")]
pub fn link_open_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    from: String,
    target: String,
) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;

    let root = state.root()?;
    let Some(rel) = link_graph::relative_vault_path(&from, &target) else {
        crate::logging::link_open("asset", "rejected", None);
        return Err(CommandError::new(
            "link_path_rejected",
            format!("打不开这个目标：{target}——它不在 vault 内"),
        )
        .param("target", target));
    };
    let abs = match fs_io::resolve_in_vault(&root, &rel) {
        Ok(abs) => abs,
        Err(e) => {
            crate::logging::link_open("asset", "rejected", None);
            return Err(e);
        }
    };
    let Some(abs) = abs.to_str() else {
        crate::logging::link_open("asset", "rejected", None);
        return Err(CommandError::new(
            "link_path_rejected",
            format!("打不开这个目标：{rel}——路径含非 UTF-8 字符"),
        )
        .param("target", rel));
    };
    match app.opener().open_path(abs, None::<&str>) {
        Ok(()) => {
            crate::logging::link_open("asset", "opened", None);
            Ok(())
        }
        Err(e) => {
            crate::logging::link_open("asset", "failed", None);
            Err(
                CommandError::new("link_path_failed", format!("打开文件失败：{e}"))
                    .param("reason", e.to_string()),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 崩溃备份（M127，change save-hardening）
// ---------------------------------------------------------------------------

/// 编辑器 dirty 内容写崩溃备份（按当前 vault + vault 相对路径定位，见 recovery 模块）。
/// `base_revision` = 备份时编辑器已知的磁盘 revision，恢复侧据此对账（评审 round 1
/// P2-1）：备份之后磁盘若被外部修改，恢复后的保存按 CAS 报冲突，不静默覆盖较新版本。
/// 保存成功后前端调用 recovery_discard 清除；进程崩溃时残留项由前端启动时枚举并
/// 给用户恢复入口。写失败返回人话错误，前端只当 warning（不打断编辑）。
#[tauri::command(rename_all = "snake_case")]
pub fn recovery_backup(
    state: tauri::State<'_, VaultState>,
    path: &str,
    content: &str,
    base_revision: &str,
) -> Result<(), CommandError> {
    crate::recovery::backup(&state.root()?, path, content, base_revision)?;
    // 诊断埋点：备份写入成功（recovery 的既有事件点）。
    crate::logging::recovery_written(path);
    Ok(())
}

/// 读崩溃备份内容；无备份返回 null（不是错误）。
#[tauri::command(rename_all = "snake_case")]
pub fn recovery_load(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<Option<String>, CommandError> {
    let entry = crate::recovery::load(&state.root()?, path)?;
    if entry.is_some() {
        // 诊断埋点：读到备份 = 用户选择了「恢复内容」（恢复链路在 Rust 侧唯一的可观测点；
        // 随后的编辑器装载在前端，Rust 不可见）。
        crate::logging::recovery_restored(path);
    }
    Ok(entry.map(|entry| entry.content))
}

/// 备份记录的 CAS 基准 revision（恢复时作保存基准用）；无备份 / 老格式备份返回 null
/// （null = 基准未知，恢复侧按必定冲突处理，不静默覆盖磁盘）。
#[tauri::command(rename_all = "snake_case")]
pub fn recovery_base_revision(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<Option<String>, CommandError> {
    Ok(crate::recovery::load(&state.root()?, path)?.and_then(|entry| entry.base_revision))
}

/// 删除崩溃备份（保存成功 / 用户丢弃）；幂等。
#[tauri::command(rename_all = "snake_case")]
pub fn recovery_discard(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<(), CommandError> {
    crate::recovery::discard(&state.root()?, path)
}

/// 当前 vault 的残留备份清单（vault 相对路径）：前端装载 vault 后据此决定是否
/// 给恢复提示。无残留返回空表。
#[tauri::command]
pub fn recovery_list(state: tauri::State<'_, VaultState>) -> Result<Vec<String>, CommandError> {
    crate::recovery::list(&state.root()?)
}

// ---------------------------------------------------------------------------
// link graph / wikilink（add-wikilink）
// ---------------------------------------------------------------------------

/// 解析单条 wikilink（装饰三态与跳转共用）。`from` = 链接所在文件的 vault 相对路径，
/// `link` = 链接原文（含 `[[`/`]]`，embed 含 `!` 前缀）。语义唯一实现见 link_graph。
#[tauri::command]
pub fn link_graph_resolve(
    state: tauri::State<'_, VaultState>,
    from: &str,
    link: &str,
) -> Result<LinkResolveResult, CommandError> {
    let inner = state.inner.lock().expect("vault state poisoned");
    if inner.vault.is_none() {
        return Err(CommandError::new(
            "vault_not_open",
            "尚未打开 vault，请先选择目录",
        ));
    }
    inner.graph.resolve_link(from, link)
}

/// 未创建链接一键创建（spec §4.4，裁决点 I）：当前文件所在目录建空文件
///
/// **已知边界**（spec「全类型递归枚举」的已知边界段，实现期在此给出指针）：本命令按确定性路径
/// 创建空文件、目标已存在则报错，**不做全 vault 搜索**。因此对一个「真实存在于惰性目录、但索引
/// 里没有」的名字点「创建」会产生一个**重复文件**——这条风险在 change vault-open-ignore-set
/// 之前就存在（任何未索引的名字都如此），引入用户规则只是把触发面变宽；本 change 不改它
///（日后若要收，方向是「创建前做一次有界的同名探测」），已登记为后续候选。
/// （from 在 vault 根时建于根；target 含 `/` 时按 vault 根相对并补中间目录）。
/// MUST NOT 覆盖或改写任何既有文件（ADR 0003 §3 铁律）：目标已存在 = 索引过期，
/// 报 wikilink_target_exists，前端重新解析。
#[tauri::command]
pub fn wikilink_create(
    state: tauri::State<'_, VaultState>,
    from: &str,
    link: &str,
) -> Result<CreateNoteResult, CommandError> {
    let mut inner = state.inner.lock().expect("vault state poisoned");
    let root = inner
        .vault
        .as_ref()
        .map(|vault| vault.root.clone())
        .ok_or_else(|| CommandError::new("vault_not_open", "尚未打开 vault，请先选择目录"))?;
    let created = inner.graph.create_note(&root, from, link)?;
    Ok(CreateNoteResult { created })
}

/// 通用文件创建（editable-non-md-files §3.8）：按**显式 vault 相对路径**建空文件，
/// 保留调用方给的扩展名（`note.txt` 的恢复副本是 `note-恢复.txt`，无扩展名文件同样无
/// 扩展名）。与 [`wikilink_create`] 的差别是这里不经 wikilink 解析、也不强拼 `.md`——
/// 「另存为新文件」对非 md 文本要恢复成同类型文件，走 `create_note` 会得到 `.md`。
/// 写纪律（O_EXCL 不覆盖、补中间目录、vault 内路径校验）与 create_note 共用同一实现
///（`LinkGraph::create_file`）。返回创建后的 vault 相对路径。
#[tauri::command(rename_all = "snake_case")]
pub fn create_file(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<String, CommandError> {
    let mut inner = state.inner.lock().expect("vault state poisoned");
    let root = inner
        .vault
        .as_ref()
        .map(|vault| vault.root.clone())
        .ok_or_else(|| CommandError::new("vault_not_open", "尚未打开 vault，请先选择目录"))?;
    inner.graph.create_file(&root, path)
}

// ---------------------------------------------------------------------------
// 文件级操作（M244，change file-tree-context-menu §3.1-§3.6）
//
// 五条命令全部只作用于 vault 内路径，安全边界与读取链路同源（`fs_io::resolve_in_vault`
// 或其新建变体 `resolve_new_in_vault`）。写纪律与 [`create_file`] 同族：撞名不覆盖、
// 失败不留半状态。命令层只做「取 vault 根 + 委托 fs_io」——路径判定与 IO 都在 fs_io 里
// （本模块不重复一套校验，REVIEW.md 第 8 条）。
// ---------------------------------------------------------------------------

/// 删除 = **移到系统废纸篓**（裁决点 2）：删除必须可恢复，MUST NOT 提供永久删除入口。
/// 目录连子孙整棵入篓；失败返回 `fs_trash_failed` 且提示明示「未删除任何内容」。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_trash_entry(
    state: tauri::State<'_, VaultState>,
    rel: String,
) -> Result<(), CommandError> {
    let root = state.root()?;
    fs_io::trash_entry(&root, &rel)
}

/// 同目录改末段名（裁决点 3 的落地：树内联编辑提交后调它）。目标已存在返回
/// `fs_already_exists`，MUST NOT 覆盖。返回改名后的 vault 相对路径——前端据此做
/// 打开中 session 的路径 remap（裁决点 5）。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_rename_entry(
    state: tauri::State<'_, VaultState>,
    rel: String,
    new_name: String,
) -> Result<String, CommandError> {
    let root = state.root()?;
    fs_io::rename_entry(&root, &rel, &new_name)
}

/// 在目录下新建空文件（§3.5）。`create_new` 原子语义：撞名即 `fs_already_exists`，
/// 不覆盖。自动打开由前端在**成功路径**上做（不等 watcher 回响，design §3.5）。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_create_file(
    state: tauri::State<'_, VaultState>,
    parent_rel: String,
    name: String,
) -> Result<String, CommandError> {
    let root = state.root()?;
    fs_io::create_file_entry(&root, &parent_rel, &name)
}

/// 在目录下新建子目录（§3.6）：与 [`fs_create_file`] 同构，新建目录不自动展开父目录。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_create_dir(
    state: tauri::State<'_, VaultState>,
    parent_rel: String,
    name: String,
) -> Result<String, CommandError> {
    let root = state.root()?;
    fs_io::create_dir_entry(&root, &parent_rel, &name)
}

/// 在系统文件管理器里定位并选中该条目（§3.4；macOS = Finder）。与 [`link_open_path`]
/// 同一条最小权限路径：opener 插件对 webview 保持默认拒绝，唯一入口是本 command。
/// 命令名用跨平台语义 `reveal`（他日的 Linux/Windows 语义由插件持有），前端菜单文案
/// 按 macOS 写「在 Finder 中显示」。本命令**不产生任何文件系统变更**。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_reveal_in_finder(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    rel: String,
) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;

    let root = state.root()?;
    let abs = fs_io::resolve_in_vault(&root, &rel)?;
    let Some(abs) = abs.to_str() else {
        return Err(CommandError::new(
            "fs_reveal_failed",
            format!("无法定位 {rel}——路径含非 UTF-8 字符"),
        )
        .param("rel", rel));
    };
    app.opener().reveal_item_in_dir(abs).map_err(|e| {
        CommandError::new(
            "fs_reveal_failed",
            format!("无法在 Finder 中显示 {rel}：{e}"),
        )
        .param("rel", rel)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 临时配置文件（写回类单测用）：文件名带进程号 + 序号，Drop 时删除。
    /// 与 `config.rs` 测试模块里的同名辅助同形——两个模块各持一份是刻意的：测试辅助不进
    /// 生产代码的公共面（`pub(crate)` 会把测试脚手架漏进库的表层 API）。
    struct TempFile(std::path::PathBuf);
    static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

    impl TempFile {
        fn new(content: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-commands-test-{}-{}.json",
                std::process::id(),
                SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            std::fs::write(&path, content).expect("write temp config");
            Self(path)
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn dirty_state_mirrors_latest_report() {
        let state = DirtyState::default();
        assert!(!state.is_dirty());
        state.set(true);
        assert!(state.is_dirty());
        state.set(false);
        assert!(!state.is_dirty());
    }

    /// 外链 scheme 白名单（M144）：白名单内的 scheme 大小写不敏感归一到规范写法，
    /// 其余（含没有 scheme、相对路径、应用自定义协议）一律归 `other`。
    #[test]
    fn external_url_scheme_whitelist() {
        assert_eq!(scheme_label("https://example.invalid/x"), "https");
        assert_eq!(scheme_label("HTTPS://example.invalid/x"), "https");
        assert_eq!(scheme_label("http://example.invalid"), "http");
        assert_eq!(scheme_label("mailto:a@b.invalid"), "mailto");
        assert_eq!(scheme_label("MaIlTo:a@b.invalid"), "mailto");

        assert_eq!(scheme_label("javascript:alert(1)"), "other");
        assert_eq!(scheme_label("file:///etc/hosts"), "other");
        assert_eq!(scheme_label("obsidian://open?vault=x"), "other");
        assert_eq!(scheme_label("note.md"), "other");
        assert_eq!(scheme_label("/abs/path.md"), "other");
        assert_eq!(scheme_label("#heading"), "other");
        assert_eq!(scheme_label(""), "other");
    }

    /// 尖括号包裹形式与首尾空白：`[a](<https://x>)` 是 CommonMark 的写法，取出的是
    /// 里面的目标；只有成对时才剥（落单的 `<` 是目标内容的一部分）。
    #[test]
    fn external_url_target_text_strips_angle_wrapper() {
        assert_eq!(
            target_text("  https://x.invalid/y  "),
            "https://x.invalid/y"
        );
        assert_eq!(target_text("<https://x.invalid/y>"), "https://x.invalid/y");
        assert_eq!(target_text(" <mailto:a@b.invalid> "), "mailto:a@b.invalid");
        assert_eq!(target_text("<https://x.invalid"), "<https://x.invalid");
        assert_eq!(target_text("https://x.invalid>"), "https://x.invalid>");
    }

    /// 白名单内的 scheme 也可能因目标不可信被拒：解析出的目标含空白或控制字符时
    /// 不打开（还原不出用户真正想开的东西，宁可拒绝）。
    #[test]
    fn external_url_openable_requires_scheme_and_clean_target() {
        assert_eq!(
            openable_external_url("https://x.invalid/a"),
            Some(("https", "https://x.invalid/a"))
        );
        assert_eq!(
            openable_external_url("  <mailto:a@b.invalid> "),
            Some(("mailto", "mailto:a@b.invalid"))
        );
        assert_eq!(
            openable_external_url("https://x.invalid/a%20b"),
            Some(("https", "https://x.invalid/a%20b"))
        );

        assert_eq!(openable_external_url("https://x.invalid/a b"), None);
        assert_eq!(openable_external_url("https://x.invalid/a\nb"), None);
        assert_eq!(openable_external_url("https://x.invalid/\u{7}"), None);
        assert_eq!(openable_external_url("javascript:alert(1)"), None);
        assert_eq!(openable_external_url("note.md"), None);
    }

    #[test]
    fn merge_last_vault_sets_fields_and_preserves_unknown() {
        let mut value = serde_json::json!({"version": 1, "future_field": true});
        merge_last_vault(&mut value, Path::new("/tmp/vault"));
        assert_eq!(value["version"], serde_json::json!(config::SCHEMA_VERSION));
        assert_eq!(value["last_vault"], serde_json::json!("/tmp/vault"));
        assert_eq!(value["future_field"], serde_json::json!(true));
    }

    #[test]
    fn merge_last_vault_writes_version_when_missing_or_older() {
        let mut missing = serde_json::json!({});
        merge_last_vault(&mut missing, Path::new("/tmp/vault"));
        assert_eq!(
            missing["version"],
            serde_json::json!(config::SCHEMA_VERSION)
        );

        let mut older = serde_json::json!({"version": 0});
        merge_last_vault(&mut older, Path::new("/tmp/vault"));
        assert_eq!(older["version"], serde_json::json!(config::SCHEMA_VERSION));
    }

    #[test]
    fn merge_last_vault_preserves_newer_version() {
        let mut value = serde_json::json!({"version": 99});
        merge_last_vault(&mut value, Path::new("/tmp/vault"));
        // 高版本配置由更新版本应用写入，不把 version 降回当前值
        assert_eq!(value["version"], serde_json::json!(99));
        assert_eq!(value["last_vault"], serde_json::json!("/tmp/vault"));
    }

    /// M228（content-width-drag，D3 通用键值合并写）：写 `ui.content_width` 只动这一个键，
    /// 其余字段（`last_vault`、`editor` 表、`keys` 表、未知字段、ui 内其它键）逐键保留。
    #[test]
    fn merge_config_value_sets_key_and_preserves_everything_else() {
        let mut value = serde_json::json!({
            "version": 1,
            "last_vault": "/tmp/vault",
            "editor": {"mode": "code", "font_size": 18},
            "ui": {"theme": "dark"},
            "keys": {"view.toggle-wrap": "ctrl+w"},
            "future_field": {"nested": [1, 2]},
        });
        merge_config_value(&mut value, "ui", "content_width", &serde_json::json!(760));
        assert_eq!(value["ui"]["content_width"], serde_json::json!(760));
        assert_eq!(
            value["ui"]["theme"],
            serde_json::json!("dark"),
            "ui 内其它键保留"
        );
        assert_eq!(value["last_vault"], serde_json::json!("/tmp/vault"));
        assert_eq!(
            value["editor"],
            serde_json::json!({"mode": "code", "font_size": 18}),
            "其它表逐键保留"
        );
        assert_eq!(
            value["keys"],
            serde_json::json!({"view.toggle-wrap": "ctrl+w"})
        );
        assert_eq!(value["future_field"], serde_json::json!({"nested": [1, 2]}));
    }

    /// M301 泛化（change add-harness-probe §11）：同一份合并写对**任意表名**成立——写
    /// `harness.loop_max` 时 `ui` / 其它表 / 未知字段逐键保留，且能在同一份配置里先写 ui
    /// 再写 harness（两个 section 互不覆盖）。
    #[test]
    fn merge_config_value_writes_arbitrary_section() {
        let mut value = serde_json::json!({
            "version": 1,
            "last_vault": "/tmp/vault",
            "ui": {"theme": "dark"},
            "future_field": 7,
        });
        merge_config_value(&mut value, "harness", "loop_max", &serde_json::json!(4));
        merge_config_value(&mut value, "ui", "content_width", &serde_json::json!(920));
        assert_eq!(value["harness"]["loop_max"], serde_json::json!(4));
        assert_eq!(
            value["ui"],
            serde_json::json!({"theme": "dark", "content_width": 920})
        );
        assert_eq!(value["future_field"], serde_json::json!(7));
        // 目标表缺席 / 错形状 ⇒ 建成空对象再写这一个键（与 ui 同口径）
        let mut misshapen = serde_json::json!({"harness": "kimi", "last_vault": "/tmp/vault"});
        merge_config_value(&mut misshapen, "harness", "loop_max", &serde_json::json!(4));
        assert_eq!(misshapen["harness"], serde_json::json!({"loop_max": 4}));
        assert_eq!(misshapen["last_vault"], serde_json::json!("/tmp/vault"));
    }

    /// 既有 `ui` 表错形状（`"ui": "dark"`）时不拖垮整份配置：重置为空对象再写键。
    #[test]
    fn merge_config_value_resets_misshapen_ui_table() {
        let mut value = serde_json::json!({"ui": "dark", "last_vault": "/tmp/vault"});
        merge_config_value(&mut value, "ui", "content_width", &serde_json::json!(760));
        assert_eq!(value["ui"], serde_json::json!({"content_width": 760}));
        assert_eq!(value["last_vault"], serde_json::json!("/tmp/vault"));
    }

    /// version 纪律与 merge_last_vault 共用（bump_config_version）：高版本不降回。
    #[test]
    fn merge_config_value_preserves_newer_version() {
        let mut value = serde_json::json!({"version": 99});
        merge_config_value(&mut value, "ui", "content_width", &serde_json::json!(760));
        assert_eq!(value["version"], serde_json::json!(99));
    }

    /// 写失败路径（配置路径的某个上级是文件，create_dir_all 必失败）：返回
    /// config_write_failed，不 panic；空键 / 空表名同样拒绝且不落盘。
    #[test]
    fn write_config_value_to_reports_write_failure() {
        let dir = std::env::temp_dir().join(format!("lumir-ui-write-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let blocker = dir.join("blocker");
        std::fs::write(&blocker, b"not a dir").expect("write blocker file");
        let path = blocker.join("config.json");
        let err = write_config_value_to(&path, "ui", "content_width", &serde_json::json!(760))
            .expect_err("写不进的路径必须报错");
        assert_eq!(err.code, "config_write_failed");
        let good = dir.join("config.json");
        let err = write_config_value_to(&good, "ui", "  ", &serde_json::json!(760))
            .expect_err("空键必须报错");
        assert_eq!(err.code, "config_write_failed");
        assert_eq!(err.message, "ui 配置键不能为空", "既有文案逐字不变");
        let err = write_config_value_to(&good, "  ", "loop_max", &serde_json::json!(4))
            .expect_err("空表名必须报错");
        assert_eq!(err.code, "config_write_failed");
        assert!(!good.exists(), "非法参数不得落盘");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// M301：泛化入口对 `[harness]` 表同样是「写回 → 下次启动读得回」——写 `harness.provider`
    /// 后 `config::load_from` 读回的就是这一档，且不产生校验 warning、其它表逐键保留。
    #[test]
    fn write_config_value_harness_round_trips_through_config_load() {
        let file = TempFile::new(
            r#"{"version":1,"last_vault":"/tmp/vault","ui":{"content_width":920},"future_field":7}"#,
        );
        write_config_value_to(&file.0, "harness", "provider", &serde_json::json!("mock"))
            .expect("写回 provider");

        let snap = config::load_from(&file.0);
        assert_eq!(snap.config.harness.provider, config::HarnessProvider::Mock);
        assert!(
            snap.warnings.is_empty(),
            "写回产物必须是干净配置：{:?}",
            snap.warnings
        );
        assert_eq!(snap.config.ui.content_width, 920.0, "其它表逐键保留");
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
    }

    /// M237（change live-theme-switch，D3）：主题切换的写回产物必须是**下次启动读得回**的
    /// 那一份——写 `ui.theme` 之后 `config::load_from` 从同一路径读回的就是这一档，且 ui 表内
    /// 其它键（M228 的 `content_width`）与未知字段逐键保留。这条把「写回 → 下次启动首帧」这条
    /// 链路的两端钉在一起：只测 merge 的纯函数部分测不到「load 认得它」。
    #[test]
    fn write_ui_value_theme_round_trips_through_config_load() {
        let file = TempFile::new(
            r#"{"version":1,"last_vault":"/tmp/vault","ui":{"content_width":920},"future_field":7}"#,
        );
        write_config_value_to(&file.0, "ui", "theme", &serde_json::json!("dark"))
            .expect("写回主题");

        let snap = config::load_from(&file.0);
        assert_eq!(
            snap.config.ui.theme,
            config::UiTheme::Dark,
            "读回的就是写进去的那一档"
        );
        assert!(
            snap.warnings.is_empty(),
            "写回产物必须是干净配置（不产生校验 warning）：{:?}",
            snap.warnings
        );
        assert_eq!(snap.config.ui.content_width, 920.0, "ui 表内其它键保留");
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        // 未知字段在磁盘上原样保留（写回是合并写，不是整表重写）
        let text = std::fs::read_to_string(&file.0).expect("读回文件");
        assert!(text.contains("\"future_field\""), "{text}");
    }

    /// 写回的三档都是合法的闭集合取值：写哪一档，load 就认哪一档（不做「只对 dark 成立」的
    /// 单点假设，MUST NOT 只测一档就把三档算作覆盖）。
    #[test]
    fn write_ui_value_theme_accepts_every_tier() {
        for (raw, want) in [
            ("light", config::UiTheme::Light),
            ("dark", config::UiTheme::Dark),
            ("eink", config::UiTheme::Eink),
        ] {
            let file = TempFile::new(r#"{"version":1}"#);
            write_config_value_to(&file.0, "ui", "theme", &serde_json::json!(raw))
                .expect("写回主题");
            let snap = config::load_from(&file.0);
            assert_eq!(snap.config.ui.theme, want, "{raw}");
        }
    }

    /// M127：last_vault 写失败必须降级为 warning（返回 false、不 panic、不传播），
    /// 打开成功不被记忆失败抹成失败。写成功路径同时验证字段落盘。
    #[test]
    fn remember_last_vault_degrades_write_failure_to_warning() {
        let dir =
            std::env::temp_dir().join(format!("lumir-last-vault-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let good = dir.join("config.json");
        assert!(remember_last_vault_to(&good, Path::new("/tmp/vault")));
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&good).unwrap()).unwrap();
        assert_eq!(saved["last_vault"], serde_json::json!("/tmp/vault"));

        // 父路径是一个普通文件 → create_dir_all 必失败
        let blocker = dir.join("not-a-dir");
        std::fs::write(&blocker, "x").unwrap();
        let bad = blocker.join("config.json");
        assert!(!remember_last_vault_to(&bad, Path::new("/tmp/vault")));

        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // M159：启动恢复的两阶段状态机（begin/finish_restore + commit_vault_open）
    //
    // 这些测试不需要 AppHandle：`fs_io::watch` 只依赖目录与回调，因此 prepared 可以直接
    // 造出来，世代让位规则无线程即可覆盖（tasks 3.1/3.2 的判定面）。
    // -----------------------------------------------------------------------

    /// 恢复状态机测试用的临时 vault（Drop 时删除；沿用「无 tempfile 依赖」的既有纪律）。
    struct TempVault(PathBuf);

    impl TempVault {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-vault-restore-test-{}-{tag}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create temp vault");
            Self(path)
        }

        fn path(&self) -> PathBuf {
            self.0.clone()
        }
    }

    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 已备好的打开结果（prepare 的产物）。状态机测试不关心 entries/graph/policy——提交只是
    /// 搬移它们，因此取空（规则表用空清单：没有用户规则来源，只剩内置规则）。
    fn prepared(vault: &TempVault) -> PreparedVaultOpen {
        let root = vault.path();
        PreparedVaultOpen {
            root: root.clone(),
            vault_id: "test-vault".into(),
            entries: vec![],
            watcher: fs_io::watch(&root, &fs_io::IgnorePolicy::load(&root, &[]), |_| {})
                .expect("watch temp vault"),
            graph: LinkGraph::new(),
            policy: fs_io::IgnorePolicy::load(&root, &[]),
        }
    }

    fn root_of(state: &VaultState) -> Option<PathBuf> {
        state
            .inner
            .lock()
            .expect("vault state poisoned")
            .vault
            .as_ref()
            .map(|vault| vault.root.clone())
    }

    fn notice_of(state: &VaultState) -> Option<String> {
        state
            .inner
            .lock()
            .expect("vault state poisoned")
            .notice
            .clone()
    }

    fn pending_of(state: &VaultState) -> bool {
        state
            .inner
            .lock()
            .expect("vault state poisoned")
            .restore_pending
    }

    fn generation_of(state: &VaultState) -> u64 {
        state.inner.lock().expect("vault state poisoned").generation
    }

    /// M159 3.1：`begin_restore` 置进行态，并把「此刻的世代」交给恢复任务作提交比对基准。
    #[test]
    fn begin_restore_marks_pending_and_reports_current_generation() {
        let state = VaultState::default();
        assert!(!pending_of(&state));
        assert_eq!(state.begin_restore(), 0);
        assert!(pending_of(&state));

        // 用户先打开过 vault：恢复记下的是跃迁之后的世代
        let a = TempVault::new("begin-a");
        assert!(commit_vault_open(&state, prepared(&a)));
        assert_eq!(state.begin_restore(), 1);
        assert!(pending_of(&state));
    }

    /// M159 3.1：世代一致时提交：写 root、清 notice、世代 +1、进行态清零。
    #[test]
    fn finish_restore_commits_and_bumps_generation_on_matching_generation() {
        let state = VaultState::default();
        let a = TempVault::new("finish-ok");
        let generation = state.begin_restore();
        assert!(state.finish_restore(generation, RestoreOutcome::Opened(Box::new(prepared(&a)))));
        assert_eq!(root_of(&state), Some(a.path()));
        assert_eq!(notice_of(&state), None);
        assert_eq!(generation_of(&state), 1);
        assert!(!pending_of(&state));
    }

    /// M159 3.1/3.2：用户抢先成功打开 B 后到达的**成功**恢复结果被整体丢弃，零副作用
    /// （prepared 被丢弃、世代不跃迁、当前 vault 不动、不写 notice）——spec「恢复结果不覆盖
    /// 用户已打开的 vault」。世代比对现在只有 `VaultState::finish_restore` 一处实现
    /// （M171 删掉了 `commit_vault_open` 的 `expect_generation` 参数，原先由它覆盖的这条
    /// 不变量一并归到这里）。
    #[test]
    fn finish_restore_discards_stale_success_and_keeps_user_vault() {
        let state = VaultState::default();
        let a = TempVault::new("stale-a");
        let b = TempVault::new("stale-b");
        let generation = state.begin_restore();
        assert!(commit_vault_open(&state, prepared(&b))); // 用户抢先成功打开 B
        assert!(!state.finish_restore(generation, RestoreOutcome::Opened(Box::new(prepared(&a)))));
        assert_eq!(root_of(&state), Some(b.path())); // 不是恢复给的 A
        assert_eq!(generation_of(&state), 1); // 丢弃不产生世代跃迁
        assert_eq!(notice_of(&state), None);
        assert!(!pending_of(&state));
    }

    /// M159 3.1：过期**失败**路径的提示同样被丢弃——用户已打开的 vault 不该被上次 vault
    /// 的失败提示污染（让位是整包的，不是只让 vault）。
    #[test]
    fn finish_restore_discards_stale_notice() {
        let state = VaultState::default();
        let b = TempVault::new("stale-notice");
        let generation = state.begin_restore();
        assert!(commit_vault_open(&state, prepared(&b)));
        assert!(!state.finish_restore(
            generation,
            RestoreOutcome::Notice("上次打开的 vault 已不可用：/gone".into())
        ));
        assert_eq!(notice_of(&state), None);
        assert_eq!(root_of(&state), Some(b.path()));
        assert!(!pending_of(&state));
    }

    /// M159 3.1：世代一致时提示路径写入 notice，且不碰 root 与世代（未打开任何 vault 的终态）。
    #[test]
    fn finish_restore_applies_notice_without_touching_vault() {
        let state = VaultState::default();
        let generation = state.begin_restore();
        assert!(state.finish_restore(
            generation,
            RestoreOutcome::Notice("配置加载失败：坏配置".into())
        ));
        assert_eq!(notice_of(&state), Some("配置加载失败：坏配置".into()));
        assert_eq!(root_of(&state), None);
        assert_eq!(generation_of(&state), 0);
        assert!(!pending_of(&state));
    }

    /// M159 3.1：四条结束路径（成功 / 无 last_vault / 提示 / 过期丢弃）走完，`restore_pending`
    /// 必为 false——否则界面会永远停在「恢复中」。
    #[test]
    fn restore_pending_clears_on_every_end_path() {
        // 成功
        let opened = VaultState::default();
        let a = TempVault::new("paths-opened");
        let generation = opened.begin_restore();
        opened.finish_restore(generation, RestoreOutcome::Opened(Box::new(prepared(&a))));
        assert!(!pending_of(&opened));

        // 无 last_vault（Idle：不写任何状态）
        let idle = VaultState::default();
        let generation = idle.begin_restore();
        assert!(idle.finish_restore(generation, RestoreOutcome::Idle));
        assert!(!pending_of(&idle));
        assert_eq!(root_of(&idle), None);
        assert_eq!(notice_of(&idle), None);

        // 提示（路径失效 / 配置加载失败 / 打开失败）
        let noticed = VaultState::default();
        let generation = noticed.begin_restore();
        noticed.finish_restore(
            generation,
            RestoreOutcome::Notice("恢复上次 vault 失败：坏了".into()),
        );
        assert!(!pending_of(&noticed));

        // 过期丢弃（用户抢先成功打开）
        let stale = VaultState::default();
        let b = TempVault::new("paths-stale");
        let generation = stale.begin_restore();
        assert!(commit_vault_open(&stale, prepared(&b)));
        assert!(!stale.finish_restore(generation, RestoreOutcome::Idle));
        assert!(!pending_of(&stale));
    }

    /// M159 3.1（M171 改道）：世代比对不符即拒绝，零副作用（prepared 被丢弃、世代不跃迁、
    /// 当前 vault 不动、不写 notice）。比对现在只有 `VaultState::finish_restore` 一处实现
    /// （原 `commit_vault_open(..., expect_generation)` 的参数已删），原先打在它身上的这条
    /// 断言改由本测试承担。
    #[test]
    fn finish_restore_rejects_mismatched_generation_without_side_effects() {
        let state = VaultState::default();
        let a = TempVault::new("commit-a");
        let b = TempVault::new("commit-b");
        let generation = state.begin_restore();
        assert!(commit_vault_open(&state, prepared(&b))); // 用户抢先成功打开 B
        assert!(!state.finish_restore(generation, RestoreOutcome::Opened(Box::new(prepared(&a)))));
        assert_eq!(root_of(&state), Some(b.path()));
        assert_eq!(generation_of(&state), 1);
        assert_eq!(notice_of(&state), None);
        assert!(!pending_of(&state));
    }

    /// M159 3.1：用户 picker 取消 / 打开失败都不提交，世代不变——恢复结果因此照常生效。
    /// 前端「只有成功装载才让位」与后端「失败不产生世代跃迁」在这一条上对称。
    #[test]
    fn restore_still_applies_when_user_open_did_not_commit() {
        let state = VaultState::default();
        let a = TempVault::new("no-commit-a");
        let generation = state.begin_restore();
        // 取消 / 打开异常：没有任何提交，世代仍是恢复记下的那个
        assert!(state.finish_restore(generation, RestoreOutcome::Opened(Box::new(prepared(&a)))));
        assert_eq!(root_of(&state), Some(a.path()));
    }

    /// M159：`vault_current` 的取值口（[`VaultState::status`]）如实报出进行态与终态。
    #[test]
    fn status_reports_restore_pending_then_terminal() {
        let state = VaultState::default();
        assert!(!state.status().unwrap().restore_pending);

        let generation = state.begin_restore();
        let pending = state.status().unwrap();
        assert!(pending.restore_pending);
        assert!(pending.vault.is_none());

        state.finish_restore(
            generation,
            RestoreOutcome::Notice("上次打开的 vault 已不可用：/gone".into()),
        );
        let terminal = state.status().unwrap();
        assert!(!terminal.restore_pending);
        assert_eq!(
            terminal.notice.as_deref(),
            Some("上次打开的 vault 已不可用：/gone")
        );
    }
    // -----------------------------------------------------------------------
    // M292（change vault-open-ignore-set）：索引口径与规则表随 vault 重建
    // -----------------------------------------------------------------------

    /// 建一个**已提交**的 vault：真目录 + 真规则表 + 真索引（走生产同一条装配路径），
    /// 供索引口径与策略生命周期的断言使用。
    fn committed_state(root: &Path, rule_files: &[&str]) -> VaultState {
        let files: Vec<String> = rule_files.iter().map(|s| s.to_string()).collect();
        let policy = fs_io::IgnorePolicy::load(root, &files);
        let entries = fs_io::scan_workspace(root, &policy).expect("scan");
        let graph = VaultState::build_graph(root, &entries);
        let state = VaultState::default();
        commit_vault_open(
            &state,
            PreparedVaultOpen {
                root: root.to_path_buf(),
                vault_id: "test-vault".into(),
                entries,
                watcher: fs_io::watch(root, &policy, |_| {}).expect("watch temp vault"),
                graph,
                policy,
            },
        );
        state
    }

    /// 链接索引里能不能解析出某个相对路径（`resolve_relative` 只查文件全集，是索引可见性的
    /// 最小可观察面）。
    fn indexed(state: &VaultState, from: &str, target: &str) -> Option<String> {
        state
            .inner
            .lock()
            .expect("vault state poisoned")
            .graph
            .resolve_relative(from, target)
    }

    /// tasks 5.1 ①②：装载路径与 watch 增量路径**都不许**把惰性条目带进链接索引
    ///（索引是磁盘 + 规则的纯函数，不是事件历史的函数）；deleted 方向无条件移除。
    ///
    /// 反例（本 change 之前必然发生）：`HANDOFF.md` 被 `.gitignore` 声明，外部改写它 ⇒ 事件
    /// 投递 ⇒ 它一度进入索引 ⇒ `[[HANDOFF]]` 本会话内可解析、重开后不可解析。
    #[test]
    fn lazy_entries_never_enter_the_link_index() {
        let v = TempVault::new("lazy-index");
        let root = &v.0;
        std::fs::create_dir_all(root.join(".local")).unwrap();
        std::fs::write(root.join(".local/tutorial.md"), "# 教程").unwrap();
        std::fs::write(root.join("visible.md"), "# 可见").unwrap();
        std::fs::write(root.join("index.md"), "# 索引").unwrap();
        std::fs::write(root.join(".gitignore"), ".local/\nHANDOFF.md\n").unwrap();
        std::fs::write(root.join("HANDOFF.md"), "# 交接").unwrap();
        let state = committed_state(root, &[".gitignore"]);

        // 装载路径：主动枚举的条目进索引，惰性条目一个都不进
        assert_eq!(
            indexed(&state, "index.md", "visible.md").as_deref(),
            Some("visible.md")
        );
        assert_eq!(
            indexed(&state, "index.md", ".local/tutorial.md"),
            None,
            "惰性目录里的文件 MUST NOT 进索引"
        );
        assert_eq!(
            indexed(&state, "index.md", "HANDOFF.md"),
            None,
            "用户规则命中的条目 MUST NOT 进索引（哪怕它是一个真实存在的 md）"
        );

        // 增量路径：惰性事件到达（树照常收行）但索引不动；非惰性事件照常进索引
        state.apply_fs_changes(&[FsChange {
            kind: fs_io::FsChangeKind::Created,
            path: ".local/tutorial.md".into(),
            entry_kind: Some(fs_io::FsEntryKind::File),
            lazy: true,
        }]);
        assert_eq!(indexed(&state, "index.md", ".local/tutorial.md"), None);
        state.apply_fs_changes(&[FsChange {
            kind: fs_io::FsChangeKind::Modified,
            path: "HANDOFF.md".into(),
            entry_kind: Some(fs_io::FsEntryKind::File),
            lazy: true,
        }]);
        assert_eq!(
            indexed(&state, "index.md", "HANDOFF.md"),
            None,
            "modified 与 created 同路：惰性事件都不许 upsert"
        );
        assert_eq!(
            indexed(&state, "index.md", "visible.md").as_deref(),
            Some("visible.md"),
            "别的东西不受影响"
        );
        state.apply_fs_changes(&[FsChange {
            kind: fs_io::FsChangeKind::Created,
            path: "later.md".into(),
            entry_kind: Some(fs_io::FsEntryKind::File),
            lazy: false,
        }]);
        assert_eq!(
            indexed(&state, "index.md", "later.md").as_deref(),
            Some("later.md"),
            "非惰性条目照常进索引"
        );

        // deleted 方向无条件移除（不消费 lazy）：已经（错误地）在索引里也要被摘掉
        state.apply_fs_changes(&[FsChange {
            kind: fs_io::FsChangeKind::Deleted,
            path: "later.md".into(),
            entry_kind: None,
            lazy: false,
        }]);
        assert_eq!(indexed(&state, "index.md", "later.md"), None);
    }

    /// tasks 4.2：切换 vault 后规则表**整体重建**——上一 vault 的物化登记不生效，新 vault 用
    /// 自己的 `.gitignore` 判定（策略随 [`VaultInner::commit`] 一起被替换）。
    #[test]
    fn vault_switch_rebuilds_policy_and_drops_previous_materialization() {
        let a = TempVault::new("policy-a");
        std::fs::create_dir_all(a.0.join(".local")).unwrap();
        std::fs::write(a.0.join(".gitignore"), ".local/\n").unwrap();
        let b = TempVault::new("policy-b");
        std::fs::create_dir_all(b.0.join("other")).unwrap();

        let state = committed_state(&a.0, &[".gitignore"]);
        let (root_a, policy_a) = state.root_and_policy().expect("root a");
        assert_eq!(root_a, a.0);
        assert_eq!(
            policy_a.classify(".local", true),
            fs_io::EntryClass::Lazy,
            "A 的规则生效"
        );
        fs_io::scan_dir(&root_a, &policy_a, ".local").expect("展开 A 的惰性目录");
        assert!(policy_a.is_materialized(".local"), "A 上登记了物化");

        // 切到 B：策略整体替换
        let state_b = committed_state(&b.0, &[".gitignore"]);
        let (root_b, policy_b) = state_b.root_and_policy().expect("root b");
        assert_eq!(root_b, b.0);
        assert!(
            !policy_b.is_materialized(".local"),
            "上一 vault 的物化登记 MUST NOT 在新 vault 上生效"
        );
        assert_eq!(
            policy_b.classify(".local", true),
            fs_io::EntryClass::Visible,
            "B 没有那条规则"
        );
        // 同一个状态对象上再开一次（模拟用户切回 A 再切到 B）：提交即整体替换
        commit_vault_open(
            &state,
            PreparedVaultOpen {
                root: b.0.clone(),
                vault_id: "test-vault".into(),
                entries: vec![],
                watcher: fs_io::watch(&b.0, &policy_b, |_| {}).expect("watch b"),
                graph: LinkGraph::new(),
                policy: policy_b.clone(),
            },
        );
        let (_, policy_now) = state.root_and_policy().expect("root now");
        assert!(
            !policy_now.is_materialized(".local"),
            "切换后旧登记不再可见"
        );
    }

    /// tasks 5.1 的装载面：`build_graph` 只吃主动枚举的条目——惰性条目（哪怕后端把它放进了
    /// entries 列表）一个都不进索引。
    #[test]
    fn build_graph_skips_lazy_entries() {
        let v = TempVault::new("build-graph-lazy");
        let root = &v.0;
        std::fs::create_dir_all(root.join(".local")).unwrap();
        std::fs::write(root.join(".local/tutorial.md"), "# t").unwrap();
        std::fs::write(root.join("note.md"), "# n").unwrap();
        // 惰性**文件**（用户规则命中的一份真 md）：它是 `build_graph` 必须按 `lazy` 跳过的
        // 那一类条目——惰性目录的子孙根本不进枚举结果，只靠目录那一条测不出这个守卫。
        std::fs::write(root.join("HANDOFF.md"), "# h").unwrap();
        std::fs::write(root.join(".gitignore"), ".local/\nHANDOFF.md\n").unwrap();
        let policy = fs_io::IgnorePolicy::load(root, &[".gitignore".to_string()]);
        let entries = fs_io::scan_workspace(root, &policy).expect("scan");
        // 前提：惰性条目确实在 entries 里（惰性可见）——目录与文件两种形态各一条
        assert!(
            entries.iter().any(|e| e.path == ".local" && e.lazy),
            "惰性目录必须在枚举结果里：{entries:?}"
        );
        assert!(
            entries
                .iter()
                .any(|e| e.path == "HANDOFF.md" && e.lazy && e.kind == fs_io::FsEntryKind::File),
            "惰性文件必须在枚举结果里：{entries:?}"
        );
        let graph = VaultState::build_graph(root, &entries);
        assert_eq!(
            graph.resolve_relative("note.md", "note.md").as_deref(),
            Some("note.md")
        );
        assert_eq!(
            graph.resolve_relative("note.md", ".local/tutorial.md"),
            None,
            "惰性目录里的条目 MUST NOT 进链接索引"
        );
        assert_eq!(
            graph.resolve_relative("note.md", "HANDOFF.md"),
            None,
            "惰性**文件**同样 MUST NOT 进链接索引（它是 lazy 守卫的直接判据）"
        );
    }
}
