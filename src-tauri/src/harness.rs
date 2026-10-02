//! Harness 对话运行时（change add-harness-probe，ADR 0007 探针的 Rust core）。
//!
//! 分层与既有纪律：
//! - 面板（m303）只消费事件与 `harness_state` 快照，本会话状态全部在 Rust、绑定 vault
//!   （design §2）：一个 vault 一个会话（内存态），切 vault 切换、切回恢复、关 vault 丢弃、
//!   app 重启清空；webview 重载经 `harness_state` 恢复渲染。
//! - LLM 调用与 SSE 解析在专线程（`lumir-harness-llm`，ADR 0002 §6 热路径隔离），
//!   keypress-to-paint 零新增。
//! - IPC 边界全部走 JSON String；**不新增 ts-rs 导出类型**（M302 纪律，bindings 归 M1）。
//! - 工具执行层抽象为「工具名 + JSON 参数 → JSON 结果」注册表（ADR 0007 Decision 3 留口，
//!   未来 headless CLI 后端翻译成同一中间表示即可接入，面板零改动）。
//!
//! 子模块：
//! - [`session`]：会话（messages、usage、pending approval、JSONL 句柄）与 vault → 会话映射
//! - [`context`]：系统上下文装配（固定身份段 + AGENTS.md 双层 + Skill 索引）与 Skill 双根发现
//! - [`llm`]：provider 预设表、OpenAI Responses API client（reqwest blocking + SSE）、mock provider
//! - [`tools`]：恰好 6 个工具的定义与执行
//! - [`permissions`]：三层规则表判定（deny > allow > 默认分层）
//! - [`approval`]：批准闸的挂起请求结构
//! - [`diff`]：edits → unified diff 预览
//! - [`jsonl`]：会话留存（配置目录，append-only，MUST NOT 写入 vault）
//! - [`turn`]：工具循环编排（上下文注入、多轮往返、loop_max、自动压缩、超限重试）
//! - [`events`]：`harness:event` 七类事件载荷（与 m303 面板共用的钉死契约）

pub mod approval;
pub mod context;
pub mod diff;
pub mod events;
pub mod jsonl;
pub mod llm;
pub mod permissions;
pub mod session;
pub mod tools;
pub mod turn;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use crate::commands::CommandError;
use crate::config::{self, HarnessConfig};
use crate::fs_io::IgnorePolicy;

/// 当前 vault 的运行时作用域：根 + 装载时编译的忽略规则表。
///
/// 由 command 层（`lib.rs` 注册处解析 `commands::VaultState`）解析后传进来——本模块
/// 不直接依赖 tauri 的 State 类型，工具循环与单测拿到的都是这个纯数据作用域
/// （ADR 0002 §7：核心数据结构不耦合 UI 层）。
#[derive(Clone)]
pub struct VaultScope {
    pub root: PathBuf,
    pub policy: IgnorePolicy,
}

impl VaultScope {
    /// 会话映射的键：vault 根路径字符串。
    pub fn key(&self) -> String {
        self.root.display().to_string()
    }
}

/// Harness 运行时状态（tauri managed state）：vault → 会话映射 + 全局限量。
///
/// `Clone` 是给工具循环专线程用的（`Arc` 共享同一份会话表，线程内照旧经 `Mutex` 访问）。
#[derive(Clone)]
pub struct Runtime {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    sessions: Mutex<HashMap<String, session::Session>>,
    /// 批准请求 id 的单调序号（`ap-<n>`，进程内唯一即可）。
    approval_seq: AtomicU64,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            inner: Arc::new(RuntimeInner {
                sessions: Mutex::new(HashMap::new()),
                approval_seq: AtomicU64::new(0),
            }),
        }
    }
}

impl Runtime {
    fn next_approval_id(&self) -> String {
        format!(
            "ap-{}",
            self.inner
                .approval_seq
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        )
    }

    /// 占用当前 vault 的会话并开始一轮对话（`harness_send` 专用）：会话不存在则建立
    /// （首次装配系统上下文 + 打开 JSONL 句柄），已 busy 则拒绝——一轮一次，批准闸期间
    /// 会话被工具循环线程持有，第二个 send 必须得到明确错误而不是排队静默。
    pub fn acquire_turn(&self, scope: &VaultScope) -> Result<(), CommandError> {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = sessions.get(&scope.key()) {
            if existing.is_busy() {
                return Err(CommandError::new(
                    "harness_busy",
                    "对话正在处理中（或正等待批准），请等本轮结束后再发送",
                ));
            }
        }
        // get_or_insert 语义：先备好新会话，再统一置 busy（避免建立途中 panic 留下半态）。
        // 构造含 `?` 失败路径，entry API 会算 eagerly——故先 Vacant 判定再插。
        if let std::collections::hash_map::Entry::Vacant(vacant) = sessions.entry(scope.key()) {
            let system = context::assemble_system(&scope.root);
            let writer = jsonl::JsonlWriter::open(&scope.root)?;
            vacant.insert(session::Session::new(scope.root.clone(), system, writer));
        }
        sessions
            .get_mut(&scope.key())
            .expect("just ensured")
            .set_busy(true);
        Ok(())
    }

    /// 一轮结束（含错误路径）：释放 busy。会话对象保留（消息历史是状态）。
    pub fn release_turn(&self, scope: &VaultScope) {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(s) = sessions.get_mut(&scope.key()) {
            s.set_busy(false);
        }
    }

    /// 挂一个批准请求进当前会话（工具循环线程在锁内调用），返回请求 id。
    pub fn park_approval(
        &self,
        scope: &VaultScope,
        request: approval::ApprovalRequest,
    ) -> Result<String, CommandError> {
        let id = self.next_approval_id();
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let session = sessions
            .get_mut(&scope.key())
            .ok_or_else(|| CommandError::new("harness_no_session", "会话已不存在，批准请求失效"))?;
        session.park_approval(request.with_id(id.clone()));
        Ok(id)
    }

    /// 对当前会话做可变操作；无会话返回 `harness_no_session`。
    /// 闭包返回普通值，结果包成 `Ok`——只有「无会话」一个错误源。
    pub fn with_session<R>(
        &self,
        scope: &VaultScope,
        f: impl FnOnce(&mut session::Session) -> R,
    ) -> Result<R, CommandError> {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let session = sessions
            .get_mut(&scope.key())
            .ok_or_else(|| CommandError::new("harness_no_session", "当前 vault 还没有对话会话"))?;
        Ok(f(session))
    }

    /// 当前 vault 的会话快照（`harness_state` 用）：无会话时空态（面板宽容解析）。
    pub fn snapshot(&self, scope: &VaultScope, config: &HarnessConfig) -> session::StateSnapshot {
        let sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        match sessions.get(&scope.key()) {
            Some(s) => s.snapshot(config.warn_ctx_pct),
            None => session::StateSnapshot::empty(config.warn_ctx_pct),
        }
    }

    /// 「新会话」重置：丢弃旧会话对象（消息历史随之清空），下次访问按新会话装配
    /// （系统上下文重读 AGENTS.md / Skill 索引；JSONL 句柄随旧对象丢弃，留存文件不动）。
    pub fn reset_session(&self, scope: &VaultScope) {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // 留存可辨识「新会话」动作（r1 P2-1）：先记后丢，JSONL 不受影响地追加。
        if let Some(session) = sessions.get_mut(&scope.key()) {
            session
                .jsonl()
                .record(&serde_json::json!({"kind": "session_reset"}));
        }
        sessions.remove(&scope.key());
    }
}

// ---------------------------------------------------------------------------
// Tauri commands（契约由 tower 钉死，与 m303 面板共用，MUST NOT 改名/改签名）
// ---------------------------------------------------------------------------

/// 从 VaultState 解析 harness 作用域（command 层唯一依赖 commands 类型的点；
/// `root_and_policy` 的 pub 可见性由 M302 申请、tower 批准）。
fn vault_scope(vault: &crate::commands::VaultState) -> Result<VaultScope, CommandError> {
    let (root, policy) = vault.root_and_policy()?;
    Ok(VaultScope { root, policy })
}

/// 发送一条提问。立即返回：工具循环在 `lumir-harness-llm` 专线程跑，进展经
/// `harness:event` 事件推送；上下文块 `context_json` 是 TS 侧组装的
/// `{path, selection?} | {path, viewport_range?}`（宽容解析，见 [`turn::parse_context`]）。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_send(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
    app: tauri::AppHandle,
    message: String,
    context_json: String,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    let config = config::load()?.config.harness;
    let context = turn::parse_context(&context_json)?;
    let message = turn::assemble_user_message(&message, &context);
    runtime.acquire_turn(&scope)?;
    let runtime_thread = runtime.inner().clone();
    let runtime_release = runtime.inner().clone();
    let scope_release = scope.clone();
    if let Err(e) = std::thread::Builder::new()
        .name("lumir-harness-llm".into())
        .spawn(move || turn::run_turn(app, runtime_thread, scope, config, message))
    {
        // 起线程失败：释放 busy，别把会话永远留在占用态。
        runtime_release.release_turn(&scope_release);
        return Err(
            CommandError::new("harness_thread_failed", format!("无法启动对话线程：{e}"))
                .param("reason", e.to_string()),
        );
    }
    Ok(())
}

/// 批准 / 拒绝一个挂起的批准请求。`reason` 为拒绝原因（可选），随工具结果回送模型。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_approve(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
    request_id: String,
    approved: bool,
    reason: Option<String>,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    runtime.with_session(&scope, |s| {
        s.resolve_approval(&request_id, approved, reason)
    })?
}

/// 「新会话」：清空当前 vault 会话的消息历史并重新装配系统上下文（JSONL 留存不受影响）。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_new_session(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    let busy = runtime.with_session(&scope, |s| s.is_busy())?;
    if busy {
        return Err(CommandError::new(
            "harness_busy",
            "对话正在处理中，请等本轮结束或完成批准后再开新会话",
        ));
    }
    runtime.reset_session(&scope);
    Ok(())
}

/// 当前 vault 会话快照 JSON（供 webview 重载后面板恢复渲染）。
/// 键集合是 m303 消费形状的超集：`messages[]` / `usage` / `pending_approval` / `warn_ctx_pct`。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_state(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
) -> Result<String, CommandError> {
    let scope = vault_scope(&vault)?;
    let config = config::load()?.config.harness;
    let snapshot = runtime.snapshot(&scope, &config);
    serde_json::to_string(&snapshot).map_err(|e| {
        CommandError::new("harness_state_failed", format!("无法序列化会话快照：{e}"))
            .param("reason", e.to_string())
    })
}
