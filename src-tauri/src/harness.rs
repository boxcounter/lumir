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
//! - [`events`]：`harness:event` 九类事件载荷（与 m303 面板共用的钉死契约）
//! - [`thinking`]：思考程度档位／provider 能力与请求映射、reasoning 展示文本提取（M362）

pub mod approval;
pub mod context;
pub mod diff;
pub mod events;
pub mod jsonl;
pub mod llm;
pub mod permissions;
pub mod session;
pub mod thinking;
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
        let session = ensure_session(&mut sessions, scope)?;
        session.set_busy(true);
        // 新一轮复位上一轮的停止请求（中断标志不带进新轮；M348）。
        session.clear_abort();
        Ok(())
    }

    /// 设置当前 vault 会话的思考程度档位（`harness_set_thinking_effort` 的实现体，M362）。
    ///
    /// 会话不存在时**即时建立**（与 [`Self::acquire_turn`] 同一条建立路径）：面板一打开就可能
    /// 点思考 chip，而档位是**会话状态**——「写档位」不能依赖「用户已发过消息」。档位不写回
    /// 配置（Alex 2026-10-06 裁决点 1）；新建会话丢弃会话对象，档位随之回到默认 High。
    pub fn set_thinking_effort(
        &self,
        scope: &VaultScope,
        effort: thinking::ThinkingEffort,
    ) -> Result<(), CommandError> {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        ensure_session(&mut sessions, scope)?.set_thinking_effort(effort);
        Ok(())
    }

    /// 请求停止当前 vault 的在途轮次（M348，发送钮停止态点击；design §5「不再继续」）。
    /// 置中断标志 + 收回待决批准项（通道发 Withdrawn，批准闸等待线程随即醒来）；
    /// 实际的收口（已产出内容标注「已停止」、JSONL 记 turn_aborted、发 aborted 事件、
    /// 释放 busy）由工具循环线程在检查点完成，本命令不等待。
    /// 无在途轮次（已完成/从未开始）返回 `harness_not_running`——调用方（前端停止钩子）
    /// 据此知道「等终态事件即可」，不是异常。
    pub fn request_abort(&self, scope: &VaultScope) -> Result<(), CommandError> {
        self.with_session(scope, |s| {
            if !s.is_busy() {
                return Err(CommandError::new(
                    "harness_not_running",
                    "当前没有正在进行的对话轮次",
                ));
            }
            s.request_abort();
            Ok(())
        })?
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
    ///
    /// 思考能力标记按当前 provider + model 从配置 schema 现算（`HarnessConfig::effort_supported`，
    /// M373：能力表 = `providers.<id>.models` 的逐模型声明）——能力是环境属性、与有没有会话
    /// 无关，空态也要给对（见 `StateSnapshot::empty` 的注释）。
    pub fn snapshot(&self, scope: &VaultScope, config: &HarnessConfig) -> session::StateSnapshot {
        let supported = config.effort_supported(&config.provider, llm::active_model(config));
        let sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        match sessions.get(&scope.key()) {
            Some(s) => s.snapshot(config.warn_ctx_pct, supported),
            None => session::StateSnapshot::empty(&scope.key(), config.warn_ctx_pct, supported),
        }
    }

    /// 当前 vault 是否有在途轮次。**无会话 = 不 busy**（M350 的宽容探测）。
    ///
    /// 与 [`with_session`] 的 `harness_no_session` 语义分工明确：「还没有会话」是正常状态，
    /// 不是错误——只有确实存在于会话表里的会话才可能忙。
    fn session_busy(&self, scope: &VaultScope) -> bool {
        let sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        sessions
            .get(&scope.key())
            .map(|s| s.is_busy())
            .unwrap_or(false)
    }

    /// 「新会话」（`harness_new_session` 的实现体，命令层只解析 scope）。
    ///
    /// 不变量：**任意会话状态下调用 new_session 均成功，结果恒为新空会话**。
    /// 无会话（从未提问 / 刚重置）时目标状态已成立，平凡成功；busy（在途轮次或在批准闸上
    /// 等待）是唯一失败态，返回 `harness_busy`。
    ///
    /// 历史（M350）：旧实现用 `with_session` 探测 busy，无会话时被 `harness_no_session`
    /// 短路成错误——面板「New session → 报错 → 再点仍报错」的根因就是新建会话前恰好
    /// 还没有会话。故 busy 探测必须走 [`Self::session_busy`] 这条宽容路径，
    /// `with_session` 的语义保持不变（approve 等路径仍需 `harness_no_session`）。
    pub fn new_session(&self, scope: &VaultScope) -> Result<(), CommandError> {
        if self.session_busy(scope) {
            return Err(CommandError::new(
                "harness_busy",
                "对话正在处理中，请等本轮结束或完成批准后再开新会话",
            ));
        }
        self.reset_session(scope);
        Ok(())
    }

    /// 「新会话」重置：丢弃旧会话对象（消息历史随之清空），下次访问按新会话装配
    /// （系统上下文重读 AGENTS.md / Skill 索引；JSONL 句柄随旧对象丢弃，留存文件不动）。
    /// 无会话时是空操作（幂等）。
    ///
    /// **思考程度档位随会话对象一起丢弃**（M362，Alex 裁决点 1「新会话回到默认」）——
    /// 档位是会话状态，不存在这里的第二个副本，故这一处 remove 就是重置的完整实现。
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

/// 取得（必要时建立）该 vault 的会话：会话不存在时装配系统上下文并打开 JSONL 句柄。
///
/// **唯一建立路径**（M362 收拢）：`acquire_turn` 与 `set_thinking_effort` 都经这里——两处各写
/// 一份建立逻辑必然漂移（REVIEW.md 第 8 条）。建立失败（`JsonlWriter::open`）在插入之前返回，
/// 不留下半态会话（与收拢前 `acquire_turn` 的 entry 先判后插同口径）。
fn ensure_session<'a>(
    sessions: &'a mut HashMap<String, session::Session>,
    scope: &VaultScope,
) -> Result<&'a mut session::Session, CommandError> {
    let key = scope.key();
    if !sessions.contains_key(&key) {
        let system = context::assemble_system(&scope.root);
        let writer = jsonl::JsonlWriter::open(&scope.root)?;
        sessions.insert(
            key.clone(),
            session::Session::new(scope.root.clone(), system, writer),
        );
    }
    Ok(sessions.get_mut(&key).expect("just ensured"))
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
    let assembled = turn::assemble_user_message(&message, &context);
    runtime.acquire_turn(&scope)?;
    let runtime_thread = runtime.inner().clone();
    let runtime_release = runtime.inner().clone();
    let scope_release = scope.clone();
    if let Err(e) = std::thread::Builder::new()
        .name("lumir-harness-llm".into())
        .spawn(move || {
            turn::run_turn(
                app,
                runtime_thread,
                scope,
                config,
                assembled.text,
                assembled.context_section,
            )
        })
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

/// 停止当前在途轮次（M348，发送钮停止态点击；design §5：中断 = 「不再继续」，非回滚）。
/// 立即返回：中断收口由工具循环线程在停止检查点完成（已产出内容标注「已停止」、
/// 待决批准项收回、JSONL 记 turn_aborted、发 `aborted` 事件回 idle）。
/// 无在途轮次返回 `harness_not_running`（竞态：轮次刚好结束——终态事件随后就到）。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_abort(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    runtime.request_abort(&scope)
}

/// 「新会话」：清空当前 vault 会话的消息历史并重新装配系统上下文（JSONL 留存不受影响）。
/// 不变量（M350）：任意会话状态下调用均成功，结果恒为新空会话——无会话是平凡成功态，
/// 只有 busy 返回 `harness_busy`。实现体在 [`Runtime::new_session`]（命令层只解析 scope）。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_new_session(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    runtime.new_session(&scope)
}

/// 当前 vault 会话快照 JSON（供 webview 重载后面板恢复渲染）。
/// 键集合是 m303 消费形状的超集：`vault`（会话标识 = vault 根路径，M312）/ `messages[]` /
/// `usage` / `pending_approval` / `warn_ctx_pct` / `thinking`（M362：`{level, supported}`）。
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

/// 设置当前会话的思考程度档位（M362，change add-harness-thinking-display-and-effort）。
/// 取值为闭集合 `low` / `high` / `max`（[`thinking::ThinkingEffort`]）；**会话内生效、不写回
/// 配置**：影响其后发出的消息，新建会话（`harness_new_session`）回到默认 High。
/// 无会话时即时建立会话再落档位（面板一打开就可能点思考 chip，见 [`Runtime::set_thinking_effort`]）。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_set_thinking_effort(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
    effort: thinking::ThinkingEffort,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    runtime.set_thinking_effort(&scope, effort)
}
