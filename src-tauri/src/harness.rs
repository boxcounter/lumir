//! Harness 对话运行时（change add-harness-probe，ADR 0007 探针的 Rust core）。
//!
//! 分层与既有纪律：
//! - 面板（m303）只消费事件与 `harness_state` 快照，本会话状态全部在 Rust、绑定 vault
//!   （design §2）：内存态一个 vault 一个活跃会话（sessions 按 vault 键控、resume 铸新 id
//!   替换槽位），切 vault 切换、切回恢复、关 vault 丢弃、app 重启清空；盘上按 vault 分目录
//!   留存多份历史会话 JSONL、浮层可切换 / 新建 / 恢复（M433）；webview 重载经 `harness_state`
//!   恢复渲染。**无人值守运行例外**（change add-cron-runtime-daemon §6.2）：`run-then-notify` /
//!   `silent-run` 在 [`Runtime::isolated`] 的独立实例上跑（运行槽位），与交互会话槽位物理分离
//!   ——事件不发往面板，终态由 `cron:run_finished` 回执。
//! - LLM 调用与 SSE 解析在专线程（`lumir-harness-llm`，ADR 0002 §6 热路径隔离），
//!   keypress-to-paint 零新增。
//! - IPC 边界走 JSON String（M302 纪律：命令返回值不为此新增 ts-rs 类型）；
//!   唯一例外是恢复命令的返回 [`session::SessionResumeInfo`]（reshape-harness-session-
//!   recording：前端恢复 mission 的依赖契约，随实现同 PR 导出）。
//! - 工具执行层抽象为「工具名 + JSON 参数 → JSON 结果」注册表（ADR 0007 Decision 3 留口，
//!   未来 headless CLI 后端翻译成同一中间表示即可接入，面板零改动）。
//!
//! 子模块：
//! - [`session`]：会话（messages、usage、pending approval、JSONL 句柄）、恢复返回类型
//!   与 vault → 会话映射
//! - [`context`]：系统上下文装配（固定身份段 + AGENTS.md 三层 + Skill 索引）与 Skill 双根发现
//! - [`llm`]：provider 预设表、OpenAI Responses API client（reqwest blocking + SSE）、mock provider
//! - [`tools`]：恰好 8 个工具的定义与执行
//! - [`permissions`]：五层判定管线（deny > vault 内写重定向 > 危险黑名单 > allow > 三档模式
//!   默认分层）与 cli_run 命令分类
//! - [`permission_cache`]：会话内批准缓存（design §6：「采纳且本会话不再问」的免问索引）
//! - [`approval`]：批准闸的挂起请求结构
//! - [`diff`]：edits → unified diff 预览
//! - [`jsonl`]：会话留存（配置目录，append-only，MUST NOT 写入 vault）
//! - [`draft`]：composer 草稿 sidecar（配置目录 `harness/drafts/<vault 稳定 id>.json`，
//!   按 vault 一份；MUST NOT 触碰 vault）
//! - [`agents`]：子代理定义文件（两作用域扫描、frontmatter 校验、优先级、内建 `explore`、清单）
//! - [`run`]：运行公共层（`RunSpec` / `RunContext`；交互槽位的 `SessionContext` 实现）
//! - [`subagents`]：子运行引擎与中枢（`ChildContext`、三重闸、resume 保留表、后台通知与自动唤醒）
//! - [`scheduler`]：并发与唤醒调度原语（provider 请求闸、会话级并发许可、链闸常量）
//! - [`turn`]：工具循环编排（上下文注入、多轮往返、loop_max、自动压缩、超限重试）
//! - [`events`]：`harness:event` 九类事件载荷（与 m303 面板共用的钉死契约）
//! - [`thinking`]：思考程度档位／provider 能力与请求映射、reasoning 展示文本提取（M362）

pub mod agents;
pub mod approval;
pub mod attachments;
pub mod context;
pub mod diff;
pub mod draft;
pub mod events;
pub mod jsonl;
pub mod llm;
pub mod permission_cache;
pub mod permissions;
pub mod run;
pub mod scheduler;
pub mod session;
pub mod subagents;
pub mod thinking;
pub mod title;
pub mod tools;
pub mod turn;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, Weak};

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
    /// vault 稳定 id（注册表 id，`vault-<pid>-<n>`）：会话留存目录名（`sessions/<id>/`）。
    /// 已打开的 vault 恒有它（`reconcile_vault` 是登记点），故会话写入路径没有「id 缺失」分支。
    pub vault_id: String,
}

impl VaultScope {
    /// 会话映射的键：vault 根路径字符串。**归属判据用它，不是目录名**——同一 vault 的两种
    /// 路径拼写仍各成一个会话（M312 不修，见 design §3）。
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
    /// 「新会话」重置后，下一次建立该 vault 会话时的 `opened_from`（reset）——
    /// 文件边界口径：重置 = 旧文件封闭 + 新文件首行 opened_from=reset。懒建立语义不变
    /// （重置本身不建会话），故用这个挂起映射衔接（键随会话建立移除）。
    pending_open: Mutex<HashMap<String, &'static str>>,
    /// 批准请求 id 的单调序号（`ap-<n>`，进程内唯一即可）。
    approval_seq: AtomicU64,
    /// 无人值守运行槽（change add-cron-runtime-daemon §6.2）：`run-then-notify` / `silent-run`
    /// 每次运行在**独立的 Runtime 实例**上跑——会话表与交互槽位物理分离，事件不发往面板
    /// （transcript 因此不可能被后台运行污染），终态记录在 `terminal` 供回执使用。
    isolated: bool,
    /// 本轮运行的终态（仅 isolated 实例记录）：`done` / `error` / `aborted` 三类的最后一次。
    terminal: Mutex<Option<TurnTerminal>>,
    /// 在途运行的契约工具白名单（`RunSpec.tool_policy`，按 vault 键控）：`start_turn` 在
    /// 拿到 busy 之后写入、`release_turn` 清掉；`SessionContext` 构造时读取一次。
    /// 交互路径没有交接契约 ⇒ 该 vault 无条目 ⇒ 完整注册表。
    tool_policies: Mutex<HashMap<String, run::ToolPolicy>>,
}

/// 一次运行的终态读数（`cron_run_finished` 回执的素材）：成功与否只由 turn 的终态事件决定，
/// 不从会话字符串或摘要猜（REVIEW.md「同一语义两处真源」条）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnTerminal {
    pub ok: bool,
    /// 失败时的错误码（`error` 事件的 code；`aborted` 记 `aborted`）。
    pub error: Option<String>,
}

/// [`Runtime`] 的弱引用（change add-harness-subagents 评审 r1 P1-1）：子运行中枢与事件
/// 出口挂在会话上，而会话又在 Runtime 里——中枢若持强 Runtime 就形成
/// `RuntimeInner.sessions → Session.subagent_hub → HubInner → RuntimeInner` 的引用环，
/// cron 的每次独立 `Runtime::isolated()` 运行结束后都无法回收。中枢只持弱引用：
/// 运行实例结束后 upgrade 失败，唤醒调度与收尾自然停摆。
#[derive(Clone)]
pub(crate) struct WeakRuntime {
    inner: Weak<RuntimeInner>,
}

impl Runtime {
    /// 见 [`WeakRuntime`]。只有需要在会话生命周期之外继续工作的持有方（子运行中枢 /
    /// 终态 sink）才该降级；其余调用方照旧持有 `Runtime` 克隆。
    pub(crate) fn downgrade(&self) -> WeakRuntime {
        WeakRuntime {
            inner: Arc::downgrade(&self.inner),
        }
    }
}

impl WeakRuntime {
    pub(crate) fn upgrade(&self) -> Option<Runtime> {
        self.inner.upgrade().map(|inner| Runtime { inner })
    }

    /// 运行实例已不存在时按无人值守处理（不参与唤醒）。
    pub(crate) fn is_isolated(&self) -> bool {
        self.upgrade()
            .map(|runtime| runtime.is_isolated())
            .unwrap_or(true)
    }

    pub(crate) fn with_session<R>(
        &self,
        scope: &VaultScope,
        f: impl FnOnce(&mut session::Session) -> R,
    ) -> Result<R, CommandError> {
        match self.upgrade() {
            Some(runtime) => runtime.with_session(scope, f),
            None => Err(CommandError::new(
                "harness_no_session",
                "运行实例已结束，会话不可用",
            )),
        }
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            inner: Arc::new(RuntimeInner {
                sessions: Mutex::new(HashMap::new()),
                pending_open: Mutex::new(HashMap::new()),
                approval_seq: AtomicU64::new(0),
                isolated: false,
                terminal: Mutex::new(None),
                tool_policies: Mutex::new(HashMap::new()),
            }),
        }
    }
}

impl Runtime {
    /// 无人值守运行槽的运行时实例（design §6.2 的「等价的独立运行时实例」）：与交互槽位
    /// 的会话表完全分离，`turn::run_turn` 在它上面不发 `harness:event`、只记录终态。
    pub fn isolated() -> Self {
        let mut runtime = Self::default();
        if let Some(inner) = Arc::get_mut(&mut runtime.inner) {
            inner.isolated = true;
        }
        runtime
    }

    /// 是否无人值守运行槽：`run_turn` 据此选择静默 sink；`SessionContext::approval_policy`
    /// 据此判 `RejectUnavailable`（`gated_execute` 在生成预览之前短路中止本运行）。
    pub fn is_isolated(&self) -> bool {
        self.inner.isolated
    }

    /// 记录本轮终态（`turn::run_turn` 的 sink 在 `done` / `error` / `aborted` 时调用）。
    /// 只保留最后一次：终态事件在一轮里至多出现一次（本方法对重复调用幂等覆盖）。
    pub fn record_terminal(&self, terminal: TurnTerminal) {
        *self
            .inner
            .terminal
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(terminal);
    }

    /// 取走本轮终态（运行线程在 `run_turn` 返回后调用一次）。
    pub fn take_terminal(&self) -> Option<TurnTerminal> {
        self.inner
            .terminal
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
    }

    /// 挂上本轮运行的工具白名单（`RunSpec.tool_policy`，change add-harness-subagents
    /// design §2.1 的运行契约值）：`start_turn` 在拿到 busy 之后写入，`release_turn` 清掉。
    /// `SessionContext` 构造时读一次——回合内工具集不随契约变化漂移。
    pub(crate) fn set_tool_policy(&self, scope: &VaultScope, policy: run::ToolPolicy) {
        self.inner
            .tool_policies
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(scope.key(), policy);
    }

    /// 当前在途运行的契约白名单；`None` = 交互路径（没有交接契约，暴露完整注册表）。
    pub(crate) fn tool_policy(&self, scope: &VaultScope) -> Option<run::ToolPolicy> {
        self.inner
            .tool_policies
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&scope.key())
            .cloned()
    }

    /// 当前 vault 会话的留存 session id（运行回执的 `session_id`）：取自 JSONL 文件名——
    /// 与恢复 / 删除同一口径，不另维护第二份映射。
    pub fn current_session_id(&self, scope: &VaultScope) -> Option<String> {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        sessions
            .get_mut(&scope.key())
            .and_then(|session| jsonl::JsonlWriter::session_id_from_path(session.jsonl().path()))
    }
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
    pub fn acquire_turn(
        &self,
        scope: &VaultScope,
        config: &HarnessConfig,
    ) -> Result<(), CommandError> {
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
        let session = ensure_session(&mut sessions, self, scope, config)?;
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
        config: &HarnessConfig,
        effort: thinking::ThinkingEffort,
    ) -> Result<(), CommandError> {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        ensure_session(&mut sessions, self, scope, config)?.set_thinking_effort(effort);
        Ok(())
    }

    /// 请求停止当前 vault 的在途轮次（M348，发送钮停止态点击；design §5「不再继续」）。
    /// 置中断标志 + 收回待决批准项（通道发 Withdrawn，批准闸等待线程随即醒来）；
    /// 实际的收口（已产出内容标注「已停止」、JSONL 记 turn_aborted、发 aborted 事件、
    /// 释放 busy）由工具循环线程在检查点完成，本命令不等待。
    /// 无在途轮次（已完成/从未开始）返回 `harness_not_running`——调用方（前端停止钩子）
    /// 据此知道「等终态事件即可」，不是异常。
    pub fn request_abort(&self, scope: &VaultScope) -> Result<(), CommandError> {
        // 先收回会话内的停止标志与待批项，**释放 sessions 锁之后**再把停止广播给子运行：
        // `broadcast_abort` 会读会话（`walk_stopped_by_user`），在锁内调用会自锁。
        // 前台 `task` 在父循环里同步 join，等不到父线程的下一个轮询点——因此必须在这里
        // 直接广播（design §12.4「前台 + 本回合起的后台」）。
        let hub = self.with_session(scope, |s| {
            if !s.is_busy() {
                return Err(CommandError::new(
                    "harness_not_running",
                    "当前没有正在进行的对话轮次",
                ));
            }
            s.request_abort();
            Ok(s.subagent_hub())
        })??;
        if let Some(hub) = hub {
            hub.broadcast_abort();
        }
        Ok(())
    }

    /// 一轮结束（含错误路径）：释放 busy。会话对象保留（消息历史是状态）。
    /// 本轮契约的工具白名单随 busy 一起撤销——它只描述在途运行，不得漏进下一次交互发送。
    ///
    /// **顺序即正确性**：先撤销白名单、再放 busy。反过来的话，两步之间同 vault 的新一轮可以
    /// `acquire_turn` 成功（busy 已清）并读到上一轮遗留的策略，把交互回合错误过滤成 cron 的
    /// 8 件工具。结束的回合不再需要策略；新的 cron 回合会在拿到 busy 后自行覆写。
    pub fn release_turn(&self, scope: &VaultScope) {
        {
            let mut policies = self
                .inner
                .tool_policies
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            policies.remove(&scope.key());
        }
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
    /// （系统上下文重读 AGENTS.md / Skill 索引）。**留存是文件边界口径**：旧 JSONL 文件
    /// 封闭不再追加，下一次建立会话时开新文件、首行 `session_open.opened_from=reset`
    /// （挂起在 `pending_open`，保持懒建立语义：重置本身不建文件）。无会话时是空操作
    /// （幂等）。
    ///
    /// **思考程度档位随会话对象一起丢弃**（M362，Alex 裁决点 1「新会话回到默认」）——
    /// 档位是会话状态，不存在这里的第二个副本，故这一处 remove 就是重置的完整实现。
    pub fn reset_session(&self, scope: &VaultScope) {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let existed = sessions.remove(&scope.key()).is_some();
        drop(sessions);
        if existed {
            self.inner
                .pending_open
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(scope.key(), "reset");
        }
    }

    /// 从留存文件恢复会话（`harness_resume_session` 的实现体）：读源文件最后一条
    /// 会话轮次 `llm_request` 的完整请求体，system + messages 原样灌进一个新会话，
    /// 续写**新** JSONL 文件（opened_from=restore，restored_from=源会话 id）。busy 态拒绝
    /// （与 new_session 同口径）；非 busy 时替换当前会话。
    ///
    /// **面板视角一并重建**（M398，design §6.2「面板（transcript）从灌回的 input 重建」）：
    /// 灌回的 wire 条目经 [`restored_panel_messages`] 映射成面板消息（user / assistant /
    /// tool，reasoning 明文挂其后的 assistant），既存进新会话的 `panel`（会话两份视角不漂，
    /// 快照重载后照旧渲染历史），也随 [`session::SessionResumeInfo`] 返回给前端一次重放。
    pub fn resume_session(
        &self,
        scope: &VaultScope,
        config: &HarnessConfig,
        session_id: &str,
    ) -> Result<session::SessionResumeInfo, CommandError> {
        if self.session_busy(scope) {
            return Err(CommandError::new(
                "harness_busy",
                "对话正在处理中，请等本轮结束后再恢复会话",
            ));
        }
        if !jsonl::is_valid_session_id(session_id) {
            return Err(CommandError::new(
                "harness_session_invalid",
                format!("非法的 session id：{session_id}"),
            ));
        }
        let path = jsonl::vault_sessions_dir(&scope.vault_id)?.join(format!("{session_id}.jsonl"));
        let file = jsonl::read_session_file(&path)?;
        let open = &file.session_open;
        if !session_belongs_to_scope(open, scope) {
            return Err(CommandError::new(
                "harness_session_vault_mismatch",
                "该会话留存属于另一个 vault，不能恢复到当前 vault",
            )
            .param("vault_root", open["vault_root"].to_string()));
        }
        let system = open["system"]
            .as_str()
            .ok_or_else(|| CommandError::new("harness_session_invalid", "session_open 缺 system"))?
            .to_string();
        // 源会话的有效标题（change add-session-auto-naming，design D7 的继承点之二）：有则随
        // 新文件的 `session_open` 之后写一条 `decision=inherit`，会话名在轮换后保持连续；源无
        // 标题记录时不写——恢复会灌回原始首条用户消息，回落名字与源会话一致。
        let inherited_title = jsonl::effective_title(&file.records);
        // 恢复入口：源文件里**最后一条会话轮次** llm_request——压缩调用是内部汇总
        // 调用（system 是压缩指令，与会话 system 不同），天然被这个判据排除。
        let conversation_requests: Vec<(usize, &serde_json::Value)> = file
            .records
            .iter()
            .enumerate()
            .filter(|(_, r)| r["kind"] == "llm_request")
            .filter(|(_, r)| r["request"]["system"].as_str() == Some(system.as_str()))
            .map(|(index, r)| (index, &r["request"]))
            .collect();
        let (messages, effort) = match conversation_requests.last() {
            Some((_, request)) => {
                let messages = request["messages"].as_array().cloned().ok_or_else(|| {
                    CommandError::new("harness_session_invalid", "llm_request 缺 messages")
                })?;
                // 思考档位取最后一条请求实际发出的值（params.thinking），回落首行声明。
                let effort = request["params"]["thinking"]
                    .as_str()
                    .and_then(|s| {
                        serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
                    })
                    .or_else(|| serde_json::from_value(open["thinking"].clone()).ok())
                    .unwrap_or_default();
                (messages, effort)
            }
            None => (Vec::new(), thinking::ThinkingEffort::default()),
        };
        // 折叠末尾未入请求的响应（design §6.2 第 4 步）：锚点请求之后若还配对着一条
        // llm_response（会话最常见的结束形态——末轮答复后用户尚未再提问），把它折进
        // 灌回的 input——reasoning 回放项在前、assistant 消息项（M372 空正文跳过）、
        // tool_calls 的 function_call 项成组压尾（M360 项序）。带悬空调用的形态按原样
        // 灌回（响应未带、wire 里也无处可取输出项）——design 登记的边界口径。
        let mut restored = messages;
        // 灌回项的逐项时间戳（M460）：与 `restored` 同步增长、逐位对齐（先按锚点请求的
        // messages 归位，随后折叠进来的响应项各归该响应的信封 ts）。
        let mut restored_ts = match conversation_requests.last() {
            Some((index, _)) => {
                restored_messages_ts(&file.records, &file.record_ts, *index, &system)
            }
            None => Vec::new(),
        };
        if let Some((index, _)) = conversation_requests.last() {
            if let Some(response) = file
                .records
                .get(index + 1)
                .filter(|r| r["kind"] == "llm_response")
            {
                // 折叠项的戳 = 这条响应的信封 ts（响应落盘时刻）；记录缺 ts 时记 None
                //（前端不显示时间，不伪造读数）。
                let at = file.record_ts.get(index + 1).copied().flatten();
                for item in session::assistant_item(
                    response["text"].as_str().unwrap_or(""),
                    response.get("reasoning"),
                ) {
                    restored.push(item);
                    restored_ts.push(at);
                }
                if let Some(calls) = response["tool_calls"].as_array() {
                    for call in calls {
                        restored.push(session::function_call_item(
                            call["id"].as_str().unwrap_or(""),
                            call["name"].as_str().unwrap_or(""),
                            call["arguments"].as_str().unwrap_or(""),
                        ));
                        restored_ts.push(at);
                    }
                }
            }
        }
        // 读数重算（M526）：种子 = 源文件首行落账（链式恢复的增量基底；旧文件无键 ⇒ 零值）+
        // 其后会话轮次 usage 的累计（压缩调用是内部汇总调用，不计入）。快照与累计器一并灌进
        // 新会话——恢复后控制行/气泡显示源会话最近一次真实读数，后续累计接着重算值继续。
        // 窗口取当前配置的声明值（读数是投影，分母随现配置，与 live 侧每轮现算同口径）。
        let window = config.context_window(&config.provider, llm::active_model(config));
        let (usage_snapshot, cache_totals) = session::usage_from_records(
            &file.records,
            &system,
            window,
            session::usage_seed(&file.session_open),
        );
        // 子运行分桶重算（change add-harness-subagents design §9.2）：`subrun` sidecar 按模型
        // 归桶累加，种子来自源文件首行（链式恢复 / 压缩边界的桶从这里接上）。它是「父会话之外
        // 的用量」，MUST NOT 进上面的 ctx% / cache% 重算。
        let subrun_buckets = session::subrun_usage_from_records(
            &file.records,
            session::subrun_usage_seed(&file.session_open),
        );
        // 续写新文件：session_open 沿用源文件的装配事实（system 全文 + assembly 清单），
        // provider / model / thinking 记**当前**配置（后续请求实际使用的身份）；
        // opened_from=restore + restored_from=源会话 id（谱系链：这份会话恢复自哪份）。
        // 读数种子随之落账（usage + cache_totals）——这份文件再被恢复时从种子起算。
        let assembly = open
            .get("assembly")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([]));
        let new_id = jsonl::new_session_id();
        let open_payload = serde_json::json!({
            "kind": "session_open",
            "session_id": new_id,
            "vault_root": scope.key(),
            "opened_from": "restore",
            "restored_from": session_id,
            "provider": config.provider,
            "model": llm::active_model(config),
            // wire 方言（与 [`session_open_payload`] 同一条读数）：续写文件记录当前配置的
            // 实际方言；源会话不带该键（旧文件）不影响恢复——恢复充分性只靠本文件的键。
            "wire_api": config.wire_api(),
            "thinking": effort,
            "system": system,
            "assembly": assembly,
            "usage": serde_json::to_value(usage_snapshot).unwrap_or_default(),
            "cache_totals": serde_json::to_value(cache_totals).unwrap_or_default(),
            // 子运行分桶种子（链式恢复用）：这份文件再被恢复时，桶从这里的值起算。
            "subrun_usage": serde_json::to_value(&subrun_buckets).unwrap_or_default(),
        });
        let writer = jsonl::JsonlWriter::create(&new_id, &scope.vault_id, &open_payload)?;
        // 面板视角重建（M398）：灌回的 input 项映射成面板消息，reasoning 明文挂其后的
        // assistant。先建好再 move `restored` 进会话。approval sidecar（kind=approval，
        // 批准的终态记录）按文件序收集，供工具行回填 decision——「已采纳 / 已拒绝」的
        // 可见性随恢复保留（M413）。
        let approvals: Vec<(String, String)> = file
            .records
            .iter()
            .filter(|r| r["kind"] == "approval")
            .filter_map(|r| {
                Some((
                    r["tool"].as_str()?.to_string(),
                    r["decision"].as_str()?.to_string(),
                ))
            })
            .collect();
        // 「已接纳投递、未被消费」的后台完成通知（change add-harness-subagents design §12.6.4；
        // 标记写在收敛入队时、早于上屏）：
        // 留存里的投递标记若未被任何 `llm_request.messages` 消费，就据标记 + `subrun`
        // sidecar 重建通知并上屏；它在这里直接进灌回的 input（用户下一次发言的请求里就带着
        // 它），MUST NOT 自动起回合——恢复不是收敛事件。标记同时复制进新文件，保证「重建
        // 后再次退出」仍可恢复。
        let restored_notices = subagents::restored_notices(&file.records);
        let restored_items = restored.len();
        let mut messages = restored_panel_messages(&restored, &restored_ts, &approvals);
        for notice in &restored_notices {
            restored.push(session::user_item(&notice.text));
            restored_ts.push(None);
            messages.push(session::PanelMessage {
                role: "notice".into(),
                text: Some(subagents::notice_display_text(&notice.text)),
                summary: Some(notice.wake_batch.clone()),
                name: None,
                status: None,
                reasoning: None,
                decision: None,
                ts: jsonl::unix_secs_now(),
            });
        }
        let mut new_session =
            session::Session::new(scope.root.clone(), system, restored, effort, writer);
        // 会话两份视角（input / panel）随同一个动作一起成立——不重建的话恢复出的会话面板为空，
        // 快照重载（webview reload / 切回）后历史照旧丢，与前端本次一次重放的内容也不一致。
        for message in messages.iter().cloned() {
            new_session.push_panel(message);
        }
        // 读数落种（M526）：恢复出的会话从源会话的最近一次真实读数接着显示/累计
        // （快照与累计器同源自上面的重算，事件/快照两条通道此后看到的与留存可推导值一致）。
        new_session.restore_usage(usage_snapshot, cache_totals);
        // 分桶落种与之同源（同一条「live 与留存可推导值一致」纪律）。
        new_session.restore_subrun_usage(subrun_buckets);
        // 重建通知的投递标记复制进新文件（同一批的 run_ids / wake_batch）：这份会话若在
        // 通知进入任何 `llm_request` 之前再次被退出，下一次恢复仍能重建它。
        for notice in &restored_notices {
            new_session.jsonl().record(&serde_json::json!({
                "kind": "notice_delivered",
                "run_ids": notice.run_ids,
                "wake_batch": notice.wake_batch,
                "shown_at": jsonl::unix_secs_now(),
            }));
        }
        // 继承标题（design D7）：新文件 `session_open` 之后紧接一条 `inherit` 记录。恢复入口只在
        // 非 busy 时可达，因此这里不违反「标题记录只在会话空闲时追加」（此处新文件还没有任何
        // 请求 / 响应对，记录也不会插进一对之间）。
        if let Some(title) = &inherited_title {
            new_session.jsonl().record(&title::inherit_payload(title));
            new_session.set_title(Some(title.clone()));
        }
        self.inner
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(scope.key(), new_session);
        self.inner
            .pending_open
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&scope.key());
        Ok(session::SessionResumeInfo {
            session_id: new_id,
            restored_items,
            messages,
        })
    }

    /// 删除一份历史会话留存（`harness_delete_session` 的实现体，M406）：删的是**文件**
    ///（`sessions/<vault 稳定 id>/<id>.jsonl`）。活跃会话的当前留存拒删（`harness_session_active`——
    /// 它的 writer 还在往这份文件追加，删掉会让留存静默断流；压缩 / 恢复换过文件的，
    /// 旧文件可删）。文件已不存在按幂等成功处理（重复删除 / 竞态删除不是错误）。
    /// vault 归属校验与列举 / 恢复同一口径（[`session_belongs_to_scope`]）。
    pub fn delete_session(&self, scope: &VaultScope, session_id: &str) -> Result<(), CommandError> {
        if !jsonl::is_valid_session_id(session_id) {
            return Err(CommandError::new(
                "harness_session_invalid",
                format!("非法的 session id：{session_id}"),
            ));
        }
        // 活跃会话拒删先于落盘判读：比对当前会话 writer 的文件名（与 jsonl 的命名纪律同一条
        // 判据）。须在存在性判断**之前**——writer 是惰性的（create 只挂起 session_open，首条
        // record 才落盘），「活跃但尚无记录」的会话文件还不存在，走到幂等分支会误报成功。
        {
            let mut sessions = self
                .inner
                .sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(active) = sessions.get_mut(&scope.key()) {
                let active_id = jsonl::JsonlWriter::session_id_from_path(active.jsonl().path());
                if active_id.as_deref() == Some(session_id) {
                    return Err(CommandError::new(
                        "harness_session_active",
                        "该会话正在进行中，不能删除",
                    ));
                }
            }
        }
        let path = jsonl::vault_sessions_dir(&scope.vault_id)?.join(format!("{session_id}.jsonl"));
        // 幂等：目标已不存在 = 删除已达成（重复点删除 / 外部清理），不算错误。
        if !path.exists() {
            return Ok(());
        }
        let file = jsonl::read_session_file(&path)?;
        if !session_belongs_to_scope(&file.session_open, scope) {
            return Err(CommandError::new(
                "harness_session_vault_mismatch",
                "该会话留存属于另一个 vault，不能删除",
            )
            .param("vault_root", file.session_open["vault_root"].to_string()));
        }
        std::fs::remove_file(&path).map_err(|e| {
            CommandError::new(
                "harness_session_delete_failed",
                format!("删除会话留存失败（{}）：{e}", path.display()),
            )
            .param("path", path.display().to_string())
            .param("reason", e.to_string())
        })
    }
}

/// 会话留存归属当前 vault 的判据（恢复与列举共用一处——同一语义两处真源会漂，
/// REVIEW.md 「同一语义两处真源」条）：首行 `session_open.vault_root` 必须逐字等于当前 scope 的键
/// （vault 根路径）。
fn session_belongs_to_scope(open: &serde_json::Value, scope: &VaultScope) -> bool {
    open["vault_root"].as_str() == Some(scope.key().as_str())
}

/// 发送闸判据（change harness-composer-image-paste design §6；能力语义的**唯一**产出点——
/// 前端 MUST NOT 另立 vision 判定）：投递投影含 image part 且当前 provider + model
/// 未声明 vision 能力 → `harness_image_unsupported`（人话 message + `param` 模型名）。
/// 未列出 = 不支持（保守默认，与 `effort` 同侧）；mock 恒放行。抽出纯函数便于单测；
/// 命令层在 `acquire_turn` **之前**调用——拒绝路径不建会话、不入队。
fn image_gate_error(
    parts: &[attachments::DeliveryPart],
    config: &HarnessConfig,
) -> Option<CommandError> {
    if !parts.iter().any(|part| part.kind == "image")
        || config.vision_supported(&config.provider, llm::active_model(config))
    {
        return None;
    }
    let model = llm::active_model(config).to_string();
    Some(
        CommandError::new(
            "harness_image_unsupported",
            format!(
                "当前模型 {model} 不支持图片输入：请移除图片卡片后再发送，或切换到支持图片的模型"
            ),
        )
        .param("model", model),
    )
}

/// 列举当前 vault 的留存会话（`harness_list_sessions` 的实现体，change
/// reshape-harness-session-recording 任务 2.1）：**只扫本 vault 的目录**
/// `<config_dir>/harness/sessions/<vault 稳定 id>/*.jsonl`，按 [`session_belongs_to_scope`]
/// （与恢复命令同一 vault 归属口径）过滤，按 session id 时间序前缀倒序返回。
/// 根下平铺的 `*.jsonl`（旧布局残留 / 脚本未跑）**不参与列举**——单一布局，无双读过渡层
/// （design §5；存量文件的可见证据是目录结构与一次性脚本的输出）。
///
/// 读不出 / 首行不是 `session_open` 的文件跳过并打一条 stderr——列举是面板历史选择器的
/// 数据源，一份损坏的留存不该让整份历史列表消失（恢复命令对**选中的**文件仍严格报错）。
/// 会话名素材是首条用户消息的**原文**：截断（约 20 字）的规则在前端。
pub fn list_sessions(scope: &VaultScope) -> Result<Vec<session::SessionSummary>, CommandError> {
    let dir = jsonl::vault_sessions_dir(&scope.vault_id)?;
    let entries = std::fs::read_dir(&dir).map_err(|e| {
        CommandError::new(
            "harness_session_unreadable",
            format!("无法读取会话留存目录 {}：{e}", dir.display()),
        )
        .param("path", dir.display().to_string())
        .param("reason", e.to_string())
    })?;
    let mut summaries = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(session_id) = jsonl::JsonlWriter::session_id_from_path(&path) else {
            continue;
        };
        let file = match jsonl::read_session_file(&path) {
            Ok(file) => file,
            Err(e) => {
                eprintln!(
                    "lumir: 会话列举跳过不可读的留存（{}）：{}",
                    path.display(),
                    e.message
                );
                continue;
            }
        };
        if !session_belongs_to_scope(&file.session_open, scope) {
            continue;
        }
        summaries.push(session::SessionSummary {
            session_id,
            first_user_text: first_user_text(&file),
            ts: file.first_ts,
            // 会话名首选源（change add-session-auto-naming）：有效标题的唯一读取口径；旧文件
            // 无 session_title 记录 ⇒ None ⇒ 前端安静回落首条用户消息截断（不迁移、不告警）。
            title: jsonl::effective_title(&file.records),
        });
    }
    // session id 是时间序（`s<unix_millis>-<随机后缀>`）：字符串倒序即时间倒序。
    summaries.sort_by(|a, b| b.session_id.cmp(&a.session_id));
    Ok(summaries)
}

/// 会话名素材：文件内**第一条** `llm_request` 的首条 user 消息正文，剥掉自动注入的
/// 上下文节（[`turn::strip_context_section`]）后返回（None = 该会话还没有用户消息）。
/// 截断规则归前端——这里给未截断的提问段全文。
///
/// 剥离走后端（design §6.1「与标题栏会话名同口径」）：注入节的形态是
/// [`turn::assemble_user_message`] 的产物，形态的单一真源在那里——前端不复制 marker 字面量。
fn first_user_text(file: &jsonl::SessionFile) -> Option<String> {
    let request = file.records.iter().find(|r| r["kind"] == "llm_request")?;
    let messages = request["request"]["messages"].as_array()?;
    let message = messages.iter().find(|m| m["role"] == "user")?;
    let text = message_content_text(message)?;
    Some(turn::strip_context_section(&text).to_string())
}

/// 从一条 wire 消息项取正文（[`session::user_item`] / [`session::assistant_item`] 的逆：
/// content 数组里的各 text part 拼接；兼容 content 直接是字符串的形态）。user 与 assistant 的
/// content 形状同构（`{type, text}` part 数组），故两处共用这一个取值口。
fn message_content_text(message: &serde_json::Value) -> Option<String> {
    match &message["content"] {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(parts) => {
            let mut out = String::new();
            for part in parts {
                if let Some(text) = part["text"].as_str() {
                    out.push_str(text);
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        _ => None,
    }
}

/// 工具输出 JSON → 面板细分终态（done / denied / rejected / error，M406 恢复回填用）：
/// 与 turn.rs `handle_call` 的 live 持久化是同一张映射表——turn.rs 现归 M407，收编成
/// 单一真源是两个分支合并后的后续项，先在这里镜像（本注释是唯一的指针；turn.rs 侧的
/// 回指随 M407 合并后一并补）。
/// 输出形状不符（缺 `ok` 布尔位）→ None：不推断、不填。
fn panel_status_of(output: &serde_json::Value) -> Option<&'static str> {
    match output["ok"].as_bool() {
        Some(true) => Some("done"),
        Some(false) => Some(match output["code"].as_str() {
            Some("permission_denied") => "denied",
            Some("approval_rejected") => "rejected",
            _ => "error",
        }),
        None => None,
    }
}

/// 灌回项的时间读数归属（M460 缺陷二的数据源）：给会话轮次某一条 `llm_request` 的 messages
/// 逐项配一个**留存信封 ts**（UNIX 秒），返回表与那批 messages 等长、逐位对齐。
///
/// 归属沿**记录的写入点**推——不猜时间：
/// - `llm_request` 的信封 ts = 该请求的发送时刻，其 messages 里**本轮新增的 user 项**就是
///   这一刻入队的 ⇒ 归这条请求的 ts（[`turn::record_llm_request`] 是写入点）。
/// - assistant / function_call / function_call_output 项由更早一次 `llm_response` 产出 ⇒
///   归**产出它的那条响应**的信封 ts（工具循环内同轮多项共享同一次响应的时刻）。
/// - messages 数组按轮**累积追加**：同一项在后续请求里原样重复出现，逐位比对后
///   **沿用上次归属**（不因再次出现而改戳）；压缩把数组换掉时前缀比对失配，新项按自己的
///   角色重新归位，旧戳不串到新项上。
/// - 压缩调用自己的 `llm_request`（system 是压缩指令）**不参与**：它的 messages 不是会话
///   数组，纳入比对会把前缀错位。
/// - 归属不到（记录缺 ts / 该位置之前没有响应记录）记 `None` —— 前端不显示时间，不伪造读数。
fn restored_messages_ts(
    records: &[serde_json::Value],
    record_ts: &[Option<u64>],
    request_index: usize,
    system: &str,
) -> Vec<Option<u64>> {
    let mut ts_of: Vec<Option<u64>> = Vec::new();
    let mut prev_msgs: &[serde_json::Value] = &[];
    let mut last_response_ts: Option<u64> = None;
    for (index, record) in records.iter().enumerate().take(request_index + 1) {
        if record["kind"] == "llm_response" {
            last_response_ts = record_ts.get(index).copied().flatten();
            continue;
        }
        if record["kind"] != "llm_request" || record["request"]["system"].as_str() != Some(system) {
            continue;
        }
        let Some(messages) = record["request"]["messages"].as_array() else {
            continue;
        };
        let at = record_ts.get(index).copied().flatten();
        let next: Vec<Option<u64>> = messages
            .iter()
            .enumerate()
            .map(|(position, item)| {
                if position < prev_msgs.len() && prev_msgs[position] == *item {
                    return ts_of.get(position).copied().flatten();
                }
                if item["role"].as_str() == Some("user") {
                    at
                } else {
                    last_response_ts
                }
            })
            .collect();
        ts_of = next;
        prev_msgs = messages;
    }
    ts_of
}

/// 把灌回 LLM 的 input 项按序映射成面板渲染消息（M398 恢复路径，design §6.2「面板
/// （transcript）从灌回的 input 重建」）：user → user、assistant 消息项 → assistant、
/// function_call 项 → tool（摘要走 [`turn::summarize_args`]，与 live 面板持久化的那份同源）。
///
/// 边界（如实登记）：
/// - **reasoning 只带明文**：wire 的 reasoning 回放项经 [`thinking::reasoning_text`] 能取出
///   明文时挂在**紧随其后的** assistant 消息上（kimi 的 `encrypted_content` 项取不到 → 缺席，
///   不伪造块）；工具轮只发调用、无正文 assistant 记录承载时该 reasoning 丢弃（面板无宿主）。
/// - **ts 来自留存信封**（M460）：wire 项自身不带时间戳，逐项戳由
///   [`restored_messages_ts`] 沿记录序归位（user 项 = 所属请求的发送时刻，assistant /
///   function_call 项 = 产出它的那次响应时刻）；归属不到的项记 0 = 无读数
///   （前端不显示相对时间，不伪造）。
/// - **tool 行细分终态回填**（M406）：function_call 配对得到的 function_call_output
///   （输出 JSON 原文）提供 `status`（[`panel_status_of`]，与 live 持久化同一映射）与
///   `text`（输出 JSON 原文——前端拒绝原因 / 失败详情的数据源）；悬空调用（响应未带
///   输出项）与输出形状不符的，status 缺席（不推断），前端按摘要形状回落判定。
/// - **decision 回填**（M413）：`approvals` 是 JSONL approval sidecar 按文件序的
///   `(工具, approved|rejected)` 列表——工具行按工具名对**每一次 function_call 出现**次序
///   消费（第 N 次出现的工具 T 配第 N 条 T 的 sidecar，与实现一致），回填面板 decision 字段；
///   sidecar 耗尽后缺席（不推断）。**已知错配面**（M413 r1 P2-2，backlog 在案）：sidecar 只
///   记过闸的调用、不记 call 关联，同一会话内同工具既有 allow 直执行又过闸时，两侧次序对
///   不齐，decision 会贴错行——精确配对待 sidecar 记 request id ↔ call id。仅影响恢复路径的
///   展示字段（live 路径 decision 由 handle_call 直写，无此问题）。
fn restored_panel_messages(
    restored: &[serde_json::Value],
    restored_ts: &[Option<u64>],
    approvals: &[(String, String)],
) -> Vec<session::PanelMessage> {
    // 工具结果按 call_id 先成图：调用项与输出项在 wire 里成组分离（同轮全部调用在前、
    // 输出在后，同序配对——provider 合同，M360），function_call 项落面板消息时按此回填。
    let mut outputs: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
    for item in restored {
        if item["type"].as_str() == Some("function_call_output") {
            if let (Some(call_id), Some(output)) =
                (item["call_id"].as_str(), item["output"].as_str())
            {
                outputs.insert(call_id, output);
            }
        }
    }
    // approval sidecar 按工具名分队列：function_call 项按序消费（同工具第 N 次调用配
    // 第 N 条 sidecar）。
    let mut approval_queue: std::collections::HashMap<&str, std::collections::VecDeque<&str>> =
        std::collections::HashMap::new();
    for (tool, decision) in approvals {
        approval_queue
            .entry(tool.as_str())
            .or_default()
            .push_back(decision.as_str());
    }
    let mut messages = Vec::new();
    let mut pending_reasoning: Option<String> = None;
    for (index, item) in restored.iter().enumerate() {
        let at = restored_ts.get(index).copied().flatten().unwrap_or(0);
        match item["type"].as_str() {
            Some("reasoning") => {
                pending_reasoning = thinking::reasoning_text(item);
            }
            Some("function_call") => {
                // 工具轮（本轮无正文 assistant 记录承载 reasoning）：面板无宿主，丢弃。
                pending_reasoning = None;
                let output = item["call_id"]
                    .as_str()
                    .and_then(|id| outputs.get(id).copied());
                let (text, status) = match output {
                    Some(raw) => {
                        let parsed = serde_json::from_str::<serde_json::Value>(raw).ok();
                        (
                            Some(raw.to_string()),
                            parsed.as_ref().and_then(panel_status_of),
                        )
                    }
                    None => (None, None),
                };
                let tool_name = item["name"].as_str().unwrap_or("");
                let decision = approval_queue
                    .get_mut(tool_name)
                    .and_then(|queue| queue.pop_front())
                    .map(str::to_string);
                messages.push(session::PanelMessage {
                    role: "tool".into(),
                    text,
                    reasoning: None,
                    summary: Some(turn::summarize_args(
                        item["arguments"].as_str().unwrap_or(""),
                    )),
                    name: Some(tool_name.to_string()),
                    status: status.map(str::to_string),
                    decision,
                    ts: at,
                });
            }
            // 工具结果项不单独落面板消息——它的信息已回填给配对的 function_call 消息
            //（status / text，见上）；live 面板同样只显「调用了什么、带了什么参数」。
            Some("function_call_output") => {}
            _ => match item["role"].as_str() {
                Some("user") => {
                    // 面板文本从 wire 项还原（design §4.4）：content 数组形态经
                    // `attachments::panel_text_of_content`——文本 part 原文 + 图片 part 的
                    // `<image …/>` 占位行，与发送时入队的面板文本**同一条还原函数**，两侧
                    // 不可能漂（REVIEW.md 「同一语义两处真源」条）；图片卡片因此按原交错还原进面板。
                    // content 直接是字符串的旧形态走历史拼接口径。
                    let text = match item["content"].as_array() {
                        Some(content) => attachments::panel_text_of_content(content),
                        None => message_content_text(item),
                    };
                    if let Some(text) = text {
                        messages.push(session::PanelMessage {
                            role: "user".into(),
                            text: Some(text),
                            reasoning: None,
                            summary: None,
                            name: None,
                            status: None,
                            decision: None,
                            ts: at,
                        });
                    }
                }
                Some("assistant") => {
                    let text = message_content_text(item).unwrap_or_default();
                    if text.is_empty() {
                        // 空正文轮不落面板消息（与 live 的 M367 口径一致）；其挂带的
                        // reasoning 无宿主，一并丢弃。
                        pending_reasoning = None;
                    } else {
                        messages.push(session::PanelMessage {
                            role: "assistant".into(),
                            text: Some(text),
                            reasoning: pending_reasoning.take(),
                            summary: None,
                            name: None,
                            status: None,
                            decision: None,
                            ts: at,
                        });
                    }
                }
                _ => {}
            },
        }
    }
    messages
}

/// 取得（必要时建立）该 vault 的会话：会话不存在时装配系统上下文、开新留存文件
/// （首行挂起 `session_open`，`opened_from` 取 pending_open 里的 reset 或 new），
/// system 全文与 assembly 清单原样灌进首行。
///
/// **唯一建立路径**（M362 收拢）：`acquire_turn` 与 `set_thinking_effort` 都经这里——两处各写
/// 一份建立逻辑必然漂移（REVIEW.md 「同一语义两处真源」条）。建立失败（留存文件打开失败）在插入之前返回，
/// 不留下半态会话（与收拢前 `acquire_turn` 的 entry 先判后插同口径）。
fn ensure_session<'a>(
    sessions: &'a mut HashMap<String, session::Session>,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
) -> Result<&'a mut session::Session, CommandError> {
    let key = scope.key();
    if !sessions.contains_key(&key) {
        let assembled = context::assemble_system(&scope.root);
        let session_id = jsonl::new_session_id();
        let opened_from = runtime
            .inner
            .pending_open
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&key)
            .unwrap_or("new");
        let open = session_open_payload(
            scope,
            config,
            &assembled,
            &session_id,
            opened_from,
            thinking::ThinkingEffort::default(),
            OpenExtras::default(),
        );
        let writer = jsonl::JsonlWriter::create(&session_id, &scope.vault_id, &open)?;
        sessions.insert(
            key.clone(),
            session::Session::new(
                scope.root.clone(),
                assembled.text,
                Vec::new(),
                thinking::ThinkingEffort::default(),
                writer,
            ),
        );
    }
    Ok(sessions.get_mut(&key).expect("just ensured"))
}

/// 构造 `session_open` 首行（三处装配点共用：会话建立 / 「新会话」重置 / 自动压缩，
/// 外加恢复的 resume——resume 内联自拼，不走本函数但同键集合）。完整装配记录 = system
/// 全文逐字节、每来源的路径与存在与否、provider / 模型 / 思考档位、opened_from
/// （new / reset / compact / resume；compact 时 compact_summary 在场）。
///
/// `assembled` 是当次装配的结构化结果——调用侧 MUST 与灌给会话的 system 全文同源
/// （同一次 `assemble_system`）；`thinking` 是该会话此刻的实际档位（首条记录前用户
/// 可能已切档，挂起行可由 `update_pending_open` 修正）。
///
/// `extras`（M526 收拢）：开新文件首行随附的可选内容——compact 摘要与读数种子。读数种子
/// `(读数快照, 累计器)` 在恢复/压缩时落进首行，这份文件再被恢复时从种子起算（链式恢复、
/// 跨压缩边界的读数因此不断档）；两者都是「开新文件时的一次性附加面」，合成一个参数免得
/// 装配形参膨胀。`OpenExtras::default()`（全新会话）不落这两键，恢复侧按零值缺省。
#[derive(Default)]
pub(crate) struct OpenExtras<'a> {
    /// compact 摘要（`opened_from=compact` 时在场，随首行留存）。
    pub compact_summary: Option<&'a str>,
    /// 读数种子（恢复/压缩时在场）。
    pub usage_seed: Option<(session::UsageSnapshot, session::CacheTotals)>,
}

pub(crate) fn session_open_payload(
    scope: &VaultScope,
    config: &HarnessConfig,
    assembled: &context::AssembledSystem,
    session_id: &str,
    opened_from: &str,
    thinking: thinking::ThinkingEffort,
    extras: OpenExtras<'_>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "kind": "session_open",
        "session_id": session_id,
        "vault_root": scope.key(),
        "opened_from": opened_from,
        "provider": config.provider,
        "model": llm::active_model(config),
        // wire 方言（change add-harness-chat-completions-dialect）：恢复充分性的推导依据之一
        // ——同一份 JSONL + 代码版本 + 该键能逐字节重建任意一轮的 wire 体。缺省值同样在场
        //（Mock 也写 `responses`：字段不缺席，含义是「这一轮没有真实 HTTP body」）。
        "wire_api": config.wire_api(),
        "thinking": thinking.as_str(),
        "system": assembled.text,
        "assembly": assembled.manifest,
    });
    if let Some(summary) = extras.compact_summary {
        payload["compact_summary"] = serde_json::json!(summary);
    }
    if let Some((usage, totals)) = extras.usage_seed {
        payload["usage"] = serde_json::to_value(usage).unwrap_or_default();
        payload["cache_totals"] = serde_json::to_value(totals).unwrap_or_default();
    }
    payload
}

// ---------------------------------------------------------------------------
// Tauri commands（契约由 tower 钉死，与 m303 面板共用，MUST NOT 改名/改签名）
// ---------------------------------------------------------------------------

/// 从 VaultState 解析 harness 作用域（command 层唯一依赖 commands 类型的点；
/// `root_and_policy` 的 pub 可见性由 M302 申请、tower 批准）。
fn vault_scope(vault: &crate::commands::VaultState) -> Result<VaultScope, CommandError> {
    let (root, policy, vault_id) = vault.root_policy_and_id()?;
    Ok(VaultScope {
        root,
        policy,
        vault_id,
    })
}

/// 发送一条提问。立即返回：工具循环在 `lumir-harness-llm` 专线程跑，进展经
/// `harness:event` 事件推送；上下文块 `context_json` 是 TS 侧组装的
/// `{path, selection?} | {path, viewport_range?}`（宽容解析，见 [`turn::parse_context`]）。
///
/// 投递投影 `parts_json` 是 TS 侧 `serializeDelivery` 的产物（有序 text/image part 数组，
/// design §4.2）——前端是序列化的唯一执行者，Rust 只做「parts → content 数组」构造。
///
/// 发送闸（design §6，能力判据的唯一产出点）：投影含 image part 且当前 provider + model
/// 未声明 vision 能力 → `harness_image_unsupported`（人话 message + `param` 模型名），
/// **不建会话、不入队**；前端收到该 code → toast + 把消息里的图片卡片标错误态（前端
/// MUST NOT 另立能力判定）。放行后含图消息照常入队——会话侧与 JSONL 恒为引用形态，
/// base64 展开落在 client 发送前（`attachments::expand_image_refs`）。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_send(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
    app: tauri::AppHandle,
    parts_json: String,
    context_json: String,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    let config = config::load()?.config.harness;
    let parts = attachments::parse_delivery_parts(&parts_json)?;
    // 发送闸（design §6，能力判据的唯一产出点）：不建会话、不入队。
    if let Some(error) = image_gate_error(&parts, &config) {
        return Err(error);
    }
    let context = turn::parse_context(&context_json)?;
    let context_section = turn::context_section(&context);
    start_turn(
        app,
        runtime.inner().clone(),
        scope,
        config,
        parts,
        context_section,
        // 交互发送没有运行交接契约：注册表原样暴露（`None`）。
        None,
        None,
    )
}

/// 运行发起的**单一实现**（change add-cron-runtime-daemon §3.2 / §3.4）：`harness_send` 与
/// `harness_cron_run` 都只经它——acquire busy → 起 `lumir-harness-llm` 线程 → `turn::run_turn`。
/// 两条入口的差别只有「哪个 runtime 实例 + 有没有终态回调」，不存在第二套发送 / 装配逻辑。
///
/// `completion` 在轮次结束后（`run_turn` 已释放 busy）在线程内调用一次：cron 入口用它投
/// `cron:run_finished`，普通发送传 `None`。
///
/// `tool_policy` 是运行契约（`RunSpec.tool_policy`）在白名单维度的**唯一消费入口**：拿到 busy
/// 之后挂到 runtime 上，`SessionContext` 构造时读取并过滤工具定义，`release_turn` 清掉。
/// 交互发送传 `None`（没有交接契约 ⇒ 完整注册表）；cron 两个槽位都传契约值。
#[allow(clippy::too_many_arguments)] // 两个入口共用这一条运行实现；拆结构体只会把参数换个容器。
fn start_turn(
    app: tauri::AppHandle,
    runtime: Runtime,
    scope: VaultScope,
    config: HarnessConfig,
    parts: Vec<attachments::DeliveryPart>,
    context_section: Option<String>,
    tool_policy: Option<run::ToolPolicy>,
    completion: Option<Box<dyn FnOnce() + Send>>,
) -> Result<(), CommandError> {
    runtime.acquire_turn(&scope, &config)?;
    if let Some(policy) = tool_policy {
        // 契约在拿到 busy 之后才挂上：acquire 失败（busy）不得留下本轮策略。
        runtime.set_tool_policy(&scope, policy);
    }
    let runtime_thread = runtime.clone();
    let runtime_release = runtime.clone();
    let scope_release = scope.clone();
    if let Err(e) = std::thread::Builder::new()
        .name("lumir-harness-llm".into())
        .spawn(move || {
            turn::run_turn(app, runtime_thread, scope, config, parts, context_section);
            if let Some(completion) = completion {
                completion();
            }
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

/// `cron:run` 交接的运行入口（change add-cron-runtime-daemon §3.3 / §3.4 / §3.7）。
///
/// 与 `harness_send` 共用同一条运行实现（`Runtime::acquire_turn` + `turn::run_turn`），差别只在
/// **会话槽位**：`slot = "interactive"` 用进程共享的交互运行时（点击发起，用户能看见）；
/// `slot = "run"` 用 [`Runtime::isolated`] 的独立实例（无人值守，事件不渲染进当前 transcript）。
///
/// 运行终态由 `cron:run_finished` 事件交给前端接线层，再由 `cron_run_result` 命令回执——
/// 终态只有那一个产出点（design §6.1）。
/// `harness_cron_run` 的入参（一个对象参数：字段平铺会让 command 签名超过 clippy 的参数
/// 上限）：**运行契约（`RunSpec`）+ 任务载荷**，与 `cron:run` 的线格式同一形状。
///
/// `RunSpec` 按 change add-harness-subagents design §2.1 不含任务知识，所以目标 vault、prompt、
/// 会话形态与模型覆盖是契约之外的 sibling 字段。本入口只校验并执行契约：会话槽位与批准语义
/// 都从 `spec` 的枚举值取，不另看字符串。
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CronRunRequest {
    #[serde(flatten)]
    pub spec: run::RunSpec,
    /// 触发源字面量：只进诊断事件 `cron_run_started.trigger`。
    pub trigger: String,
    pub target_vault: String,
    pub prompt: String,
    pub session: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[tauri::command(rename_all = "snake_case")]
pub fn harness_cron_run(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
    app: tauri::AppHandle,
    payload: CronRunRequest,
) -> Result<(), CommandError> {
    let CronRunRequest {
        spec,
        trigger,
        target_vault,
        prompt,
        session,
        session_id,
        model,
    } = payload;
    // 运行契约的入口校验（契约的消费者就在这一层）：会话目标决定槽位与批准策略，两者必须
    // 自洽；cron 入口不接受子运行目标、后台委派或非 cron 触发来源。
    let (run_runtime, slot_approval) = match &spec.session_target {
        run::SessionTarget::Interactive => {
            (runtime.inner().clone(), run::ApprovalPolicy::Interactive)
        }
        run::SessionTarget::Unattended { .. } => {
            (Runtime::isolated(), run::ApprovalPolicy::RejectUnavailable)
        }
        run::SessionTarget::Child { .. } => {
            return Err(CommandError::new(
                "run_spec_invalid",
                "cron 运行不接受子运行会话目标",
            ));
        }
    };
    if spec.approval_policy != slot_approval {
        return Err(CommandError::new(
            "run_spec_invalid",
            "会话目标与批准策略不一致",
        ));
    }
    if spec.background {
        return Err(CommandError::new(
            "run_spec_invalid",
            "cron 运行不是后台委派",
        ));
    }
    // cron 只有轮次预算（`max_tokens` / `deadline` 无人值守路径不参与判定）：带了别的闸即拒，
    // 不让契约声明一个没有消费者的阈值。
    if spec.budget.max_tokens != 0 || spec.budget.deadline.is_some() {
        return Err(CommandError::new(
            "run_spec_invalid",
            "cron 运行只支持轮次预算",
        ));
    }
    if !(config::LOOP_MAX_MIN..=config::LOOP_MAX_MAX).contains(&spec.budget.max_rounds) {
        return Err(CommandError::new(
            "run_spec_invalid",
            "轮次预算超出合法区间",
        ));
    }
    // 触发来源必须是 cron：`task` + `run_id` 是终态回执与去重状态的关联键。
    let run::RunOrigin::Cron { task, run_id } = spec.origin.clone() else {
        return Err(CommandError::new(
            "run_spec_invalid",
            "cron 运行只接受 cron 触发来源",
        ));
    };
    if let Some(unknown) = spec
        .tool_policy
        .allow
        .iter()
        .find(|name| !tools::TOOL_NAMES.contains(&name.as_str()))
    {
        return Err(CommandError::new(
            "run_spec_invalid",
            format!("工具白名单含未知工具：{unknown}"),
        ));
    }
    let scope = vault_scope(&vault)?;
    // 目标 vault 必须已是当前 vault：无人值守运行不切换用户界面，点击运行由前端先走既有
    // vault 打开链路（design §6.5）。两侧都做 canonicalize——配置里的绝对路径可能是
    // `/tmp/...` 而 vault 根是 `/private/tmp/...`（macOS 软链），逐字比较会假判不同。
    let canonical =
        |path: &std::path::Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let target = canonical(std::path::Path::new(&target_vault));
    if target != canonical(&scope.root) {
        return Err(CommandError::new(
            "vault_not_open",
            "目标任务属于另一个 vault；无人值守运行不会切换当前 vault",
        ));
    }
    let shape = config::SessionShape::parse(&session).ok_or_else(|| {
        CommandError::new(
            "harness_session_invalid",
            format!("未知的会话形态：{session}"),
        )
    })?;
    let mut base = config::load()?.config.harness;
    // 契约的轮次预算是本次运行的唯一预算来源（cron 装载期快照；配置对 cron 不热重载）。
    base.loop_max = spec.budget.max_rounds;
    let (config, warning) = with_model_override(&base, model.as_deref());
    if let Some(warning) = warning {
        crate::logging::config_warning("cron", &warning);
    }
    // 会话形态（design §6.3）：`new` 新建；`dedicated` 用状态里的 session_id 续写（缺少即新建）。
    // 续写失败（源文件缺失 / 损坏）回落新建——任务不因历史留存缺失而停摆。
    match (shape, session_id.as_deref()) {
        (config::SessionShape::Dedicated, Some(id)) => {
            if let Err(error) = run_runtime.resume_session(&scope, &config, id) {
                if error.code == "harness_busy" {
                    return Err(error);
                }
                crate::logging::config_warning(
                    "cron",
                    &format!(
                        "专用会话 {id} 无法恢复（{}），本次改为新建会话",
                        error.message
                    ),
                );
                run_runtime.new_session(&scope)?;
            }
        }
        _ => run_runtime.new_session(&scope)?,
    }
    let log_task = task.clone();
    let completion_runtime = run_runtime.clone();
    let scope_for_turn = scope.clone();
    let app_for_turn = app.clone();
    let completion: Box<dyn FnOnce() + Send> = Box::new(move || {
        let terminal = completion_runtime.take_terminal().unwrap_or(TurnTerminal {
            ok: false,
            error: Some("no_terminal".to_string()),
        });
        let session_id = completion_runtime.current_session_id(&scope_for_turn);
        let payload = serde_json::json!({
            "run_id": run_id,
            "task": task,
            "ok": terminal.ok,
            "session_id": session_id,
            "error": terminal.error,
        });
        use tauri::Emitter;
        if let Err(error) = app_for_turn.emit(crate::CRON_RUN_FINISHED_EVENT, payload) {
            crate::logging::config_warning(
                "cron",
                &format!("运行终态事件投递失败，回执可能丢失：{error}"),
            );
        }
    });
    let parts = vec![attachments::DeliveryPart {
        kind: "text".to_string(),
        text: Some(prompt),
        name: None,
        label: None,
    }];
    start_turn(
        app,
        run_runtime,
        scope,
        config,
        parts,
        None,
        // 契约的工具白名单原样交给运行层：`SessionContext` 只暴露其中声明的工具。
        // 定时 / 点击两个槽位共用这一条链路（点击槽也用契约值，不回落交互全量）。
        Some(spec.tool_policy),
        Some(completion),
    )?;
    // 交接被接受（acquire 成功、线程已起）才记「运行已开始」——失败路径由前端回执落终态。
    crate::logging::cron_run_started(&log_task, &trigger, shape.as_str(), model.as_deref());
    Ok(())
}

/// 任务 `model` 覆盖的解析（change add-cron-runtime-daemon §3.7）：按运行时
/// `[harness].providers.<provider>.models` 的声明解析；已声明 ⇒ 本次会话用该模型；
/// 未声明 ⇒ 回落该 provider 的生效模型 + 一条 warning，任务不丢。
///
/// mock 是 fixture 驱动档、没有模型维度：覆盖被忽略且不告警（不伪造一个不存在的模型 id）。
pub fn with_model_override(
    config: &HarnessConfig,
    model: Option<&str>,
) -> (HarnessConfig, Option<String>) {
    let Some(model) = model.map(str::trim).filter(|model| !model.is_empty()) else {
        return (config.clone(), None);
    };
    if config.provider == config::HarnessProvider::Mock {
        return (config.clone(), None);
    }
    if !config
        .model_specs(&config.provider)
        .iter()
        .any(|spec| spec.id == model)
    {
        let fallback = llm::active_model(config).to_string();
        return (
            config.clone(),
            Some(format!(
                "任务声明的模型 {model} 未在 [harness].providers.{}.models 中声明，本次回落 {fallback}",
                config.provider.as_str(),
            )),
        );
    }
    let mut resolved = config.clone();
    match resolved.provider {
        config::HarnessProvider::Kimi => resolved.providers.kimi.model = model.to_string(),
        config::HarnessProvider::Deepseek => resolved.providers.deepseek.model = model.to_string(),
        config::HarnessProvider::Mock => {}
    }
    (resolved, None)
}

/// 落盘一张 composer 粘贴的剪贴板图片（change harness-composer-image-paste design §5）：
/// harness 侧内容寻址存储 `attachments/<vault 稳定 id>/`（MUST NOT 触碰 vault），
/// 返回 `{name, width, height}`——前端据此插图片卡片。链路复用 vault 附件的
/// fs_io 原语（转码 / 寻址 / 原子写 / 50MB 上限判据），落点解析失败（无有效 vault）即
/// 拒绝落盘 + 人话错误，不留半截。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_write_image(
    vault: tauri::State<'_, crate::commands::VaultState>,
    data_base64: String,
    source_mime: String,
) -> Result<attachments::HarnessWrittenImage, CommandError> {
    let scope = vault_scope(&vault)?;
    attachments::write_image(&scope.vault_id, &data_base64, &source_mime)
}

/// 读回一张 harness 图片附件的 base64（缩略图渲染用；design §5.4）：落点 =
/// `attachments/<当前 vault 稳定 id>/`，限 `pasted-<hash16>.<ext>` 形态、限尺寸、
/// 路径逃逸防护——引用名只在本 vault 目录内唯一，MUST NOT 跨 vault 查找。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_read_image(
    vault: tauri::State<'_, crate::commands::VaultState>,
    name: String,
) -> Result<String, CommandError> {
    let scope = vault_scope(&vault)?;
    attachments::read_image(&scope.vault_id, &name)
}

/// 批准 / 拒绝一个挂起的批准请求。`reason` 为拒绝原因（可选），随工具结果回送模型；
/// `remember` = 「采纳且本会话不再问」（可选，缺省 false）——true 且采纳时
/// `(工具, 主体串)` 记入会话内批准缓存（design §6），同会话同主体串后续免闸。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_approve(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
    request_id: String,
    approved: bool,
    reason: Option<String>,
    remember: Option<bool>,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    runtime.with_session(&scope, |s| {
        s.resolve_approval(&request_id, approved, reason, remember.unwrap_or(false))
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
/// `usage` / `pending_approvals`（列表，change add-harness-subagents §8.3 起替代单槽
/// `pending_approval`）/ `auto_wake`（链计数 / 上限 / 触顶原因）/ `subrun_usage`（按模型分桶）/
/// `warn_ctx_pct` / `thinking`（M362：`{level, supported}`）/
/// `title`（change add-session-auto-naming：有效标题，无标题时缺键——前端回落首条用户消息口径）。
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

/// 面板停止单个子运行（design §12.4 / tasks §10.2 的「停止」按钮）：只停该 run，其它 run
/// 不受影响；它的待批项收回、收敛为 `aborted`、不触发唤醒。实现体唯一在
/// [`subagents::SubagentHub::stop_run`]，本命令只做 scope 解析与「找不到该 run」的宽容化——
/// 与收敛事件赛跑是常态（run 刚好收尾），不当作错误。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_subagent_stop(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
    run_id: String,
) -> Result<bool, CommandError> {
    let scope = vault_scope(&vault)?;
    let hub = runtime
        .with_session(&scope, |s| s.subagent_hub())
        .ok()
        .flatten();
    Ok(hub.is_some_and(|hub| hub.stop_run(&run_id)))
}

/// 任务区触顶提示行的「继续」（design §12.6.3 / tasks §10.8）：等价一次用户发言——链清零、
/// `blocked` 清空、`pending` 非空时立即按待处理通知起一个回合。实现体唯一在
/// [`subagents::SubagentHub::continue_wake`]。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_subagent_continue(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    let hub = runtime
        .with_session(&scope, |s| s.subagent_hub())
        .ok()
        .flatten();
    if let Some(hub) = hub {
        hub.continue_wake();
    }
    Ok(())
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
    let config = config::load()?.config.harness;
    runtime.set_thinking_effort(&scope, &config, effort)
}

/// 从留存文件恢复会话（change reshape-harness-session-recording 的恢复入口）：
/// `session_id` 是 `sessions/<vault 稳定 id>/<id>.jsonl` 的文件名（形态校验防目录穿越）。读源文件
/// 最后一条会话轮次 `llm_request` 的完整请求体，system + messages 原样灌进新会话并
/// 续写**新**留存文件（opened_from=restore、restored_from=源会话 id——恢复的地基：文件边界 + 会话身份 + 谱系链）。
/// 返回 `SessionResumeInfo`（ts-rs 导出）：新会话标识 + 灌回条数 + **面板重建消息**
/// （M398）——前端据此一次重放历史 transcript，不必再拉 `harness_state`。busy 态返回
/// `harness_busy`；源文件不属于当前 vault 返回 `harness_session_vault_mismatch`。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_resume_session(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
    session_id: String,
) -> Result<session::SessionResumeInfo, CommandError> {
    let scope = vault_scope(&vault)?;
    let config = config::load()?.config.harness;
    runtime.resume_session(&scope, &config, &session_id)
}

/// 列举当前 vault 的历史会话（change reshape-harness-session-recording 任务 2.1；面板
/// 会话选择器的数据源）：返回 `SessionSummary` 数组，按 session id 时间序倒序。过滤与
/// 恢复命令同一 vault 归属口径；会话名素材是首条用户消息原文（截断约 20 字归前端）。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_list_sessions(
    vault: tauri::State<'_, crate::commands::VaultState>,
) -> Result<Vec<session::SessionSummary>, CommandError> {
    let scope = vault_scope(&vault)?;
    list_sessions(&scope)
}

/// 删除一份历史会话留存（M406；面板会话选择器的行内删除入口）：`session_id` 是
/// `sessions/<vault 稳定 id>/<id>.jsonl` 的文件名（形态校验防目录穿越）。活跃会话的当前留存拒删
/// （`harness_session_active`）；vault 归属不符拒删（`harness_session_vault_mismatch`，
/// 与列举 / 恢复同一口径）；文件已不存在按幂等成功处理。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_delete_session(
    vault: tauri::State<'_, crate::commands::VaultState>,
    runtime: tauri::State<'_, Runtime>,
    session_id: String,
) -> Result<(), CommandError> {
    let scope = vault_scope(&vault)?;
    runtime.delete_session(&scope, &session_id)
}

/// 单测的进程级 XDG 互斥（`XDG_CONFIG_HOME` 是**进程全局**，cargo test 并行跑）。
///
/// 为什么需要：多个测试各自把 XDG 指到自己的临时目录；不串行时，A 测试的目录会被 B 测试的
/// `config_dir()` 读到，甚至 A 结束删目录、B 正写到一半 —— 症状是「No such file or directory」
/// 这类与产品无关的红（2026-10-18 实测：`compact_inherits_title` 与 `result_is_dropped_while_busy`
/// 并发跑时踩到）。所有改 XDG 的测试在 `set_var` **之前**取这把锁并持有到测试结束。
#[cfg(test)]
pub(crate) fn xdg_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// M398：恢复重建的面板消息映射——wire 项按序映射成面板视角（user / assistant /
    /// tool），reasoning 明文挂其后的 assistant；空正文轮与工具结果项不落消息；不带时间
    /// 归属表（`&[]`）时重建消息的 ts 恒为 0（= 无读数，前端不显示时间、不伪造）；
    /// 戳的归属本身见 `restored_panel_messages_carries_envelope_ts_per_item`（M460）。
    #[test]
    fn restored_panel_messages_maps_wire_items_in_order() {
        let restored = vec![
            session::user_item("zqxalpha"),
            // deepseek 形态的 reasoning 回放项：明文在 content parts 里。
            serde_json::json!({
                "type": "reasoning",
                "content": [{"type": "reasoning_text", "text": "先想清楚"}],
            }),
            session::assistant_item("先答一句。", None)[0].clone(),
            session::function_call_item("c1", "vault_read", r#"{"path":"a.md"}"#),
            session::function_call_output_item("c1", r#"{"ok":true}"#),
            // 工具轮的 reasoning（本轮无正文 assistant 承载）：面板无宿主，丢弃。
            serde_json::json!({
                "type": "reasoning",
                "content": [{"type": "reasoning_text", "text": "被丢的思考"}],
            }),
            session::function_call_item("c2", "vault_bogus", "{}"),
            session::assistant_item("收尾。", None)[0].clone(),
        ];
        let messages = restored_panel_messages(&restored, &[], &[]);
        let roles: Vec<&str> = messages.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(
            roles,
            vec!["user", "assistant", "tool", "tool", "assistant"]
        );

        assert_eq!(messages[0].text.as_deref(), Some("zqxalpha"));
        assert_eq!(messages[1].text.as_deref(), Some("先答一句。"));
        assert_eq!(messages[1].reasoning.as_deref(), Some("先想清楚"));
        assert_eq!(messages[1].ts, 0, "重建消息无 wire 时间戳：不伪造");
        assert_eq!(messages[2].name.as_deref(), Some("vault_read"));
        assert_eq!(messages[2].summary.as_deref(), Some(r#"{"path":"a.md"}"#));
        // M406 细分终态回填：配对输出 {"ok":true} → done + 输出 JSON 原文进 text。
        assert_eq!(messages[2].status.as_deref(), Some("done"));
        assert_eq!(messages[2].text.as_deref(), Some(r#"{"ok":true}"#));
        assert_eq!(messages[3].name.as_deref(), Some("vault_bogus"));
        // 悬空调用（无配对输出项）：status / text 缺席——不推断、不伪造。
        assert_eq!(messages[3].status, None);
        assert_eq!(messages[3].text, None);
        // 工具轮挂带的 reasoning 不串到别处，收尾 assistant 无 reasoning。
        assert_eq!(messages[4].text.as_deref(), Some("收尾。"));
        assert_eq!(messages[4].reasoning, None);
    }

    /// M460（缺陷二的数据源）：恢复重建的面板消息带**留存信封 ts**，逐项按
    /// [`restored_messages_ts`] 的归属取自己那一项的值；归属不到（旧文件缺 ts）的项记 0 =
    /// 无读数，前端不显示时间（与带 ts 的项并存时逐项独立，不整批伪造）。
    #[test]
    fn restored_panel_messages_carries_envelope_ts_per_item() {
        let restored = vec![
            session::user_item("问"),
            session::assistant_item("答。", None)[0].clone(),
            session::function_call_item("c1", "vault_read", r#"{"path":"a.md"}"#),
            session::function_call_output_item("c1", r#"{"ok":true}"#),
        ];
        // ts 表与 wire 项逐位对齐（工具输出项不落面板消息，表照旧给全）。
        let ts = [Some(100), Some(105), Some(105), Some(105)];
        let messages = restored_panel_messages(&restored, &ts, &[]);
        assert_eq!(
            messages.iter().map(|m| m.ts).collect::<Vec<u64>>(),
            vec![100, 105, 105]
        );
        let messages = restored_panel_messages(&restored, &[Some(100), None, None, None], &[]);
        assert_eq!(
            messages.iter().map(|m| m.ts).collect::<Vec<u64>>(),
            vec![100, 0, 0]
        );
    }

    /// 会话轮次的 `llm_request`（时间读数归属走查的素材）。
    fn conversation_request(messages: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::json!({"kind": "llm_request", "request": {"system": "S", "messages": messages}})
    }

    /// M460：逐项 ts 的**归属走查**（沿记录序，不猜时间）——user 项归它所属 `llm_request`
    /// 的信封 ts；assistant / function_call / function_call_output 项归产出它的上一条
    /// `llm_response`；数组按轮累积追加，前缀延续项**沿用上次归属**（同一项不因再次出现而
    /// 改戳）；压缩调用（system 不同）不参与比对；缺记录 ts / 没有前序响应时记 `None`。
    #[test]
    fn restored_messages_ts_walks_the_record_sequence() {
        let q1 = session::user_item("q1");
        let a1 = session::assistant_item("a1", None)[0].clone();
        let q2 = session::user_item("q2");
        let a2 = session::assistant_item("a2", None)[0].clone();
        let q3 = session::user_item("q3");
        let records = vec![
            conversation_request(vec![q1.clone()]),
            serde_json::json!({"kind": "llm_response", "text": "a1"}),
            conversation_request(vec![q1.clone(), a1.clone(), q2.clone()]),
            serde_json::json!({"kind": "llm_response", "text": "a2"}),
            // 压缩调用：system 不同、messages 是压缩提示——不参与会话数组的前缀比对。
            serde_json::json!({
                "kind": "llm_request",
                "request": {"system": "压缩指令", "messages": [session::user_item("汇总")]},
            }),
            conversation_request(vec![
                q1.clone(),
                a1.clone(),
                q2.clone(),
                a2.clone(),
                q3.clone(),
            ]),
        ];
        let record_ts = [
            Some(100),
            Some(105),
            Some(200),
            Some(208),
            Some(250),
            Some(300),
        ];
        assert_eq!(
            restored_messages_ts(&records, &record_ts, 5, "S"),
            vec![Some(100), Some(105), Some(200), Some(208), Some(300)]
        );
        // 缺 ts 的记录：它那一项（及沿用它的项）记 None，其余按各自记录归位。
        let record_ts = [None, Some(105), None, Some(208), Some(250), Some(300)];
        assert_eq!(
            restored_messages_ts(&records, &record_ts, 5, "S"),
            vec![None, Some(105), None, Some(208), Some(300)]
        );
        // 首条请求之前没有响应可归：非 user 项的戳缺席（构造性边界，不猜）。
        let head = vec![conversation_request(vec![a1.clone()])];
        assert_eq!(
            restored_messages_ts(&head, &[Some(100)], 0, "S"),
            vec![None]
        );
    }

    /// M406：细分终态映射与 live 持久化同表——ok=false 按 code 分 denied / rejected /
    /// error；输出 JSON 原文随 text 带出（前端拒绝原因的取数点）；输出形状不符
    /// （缺 ok 位 / 非 JSON）时 status 缺席但原文仍带出（前端按摘要形状回落判定）。
    #[test]
    fn restored_panel_messages_backfills_tool_status() {
        let restored = vec![
            session::function_call_item("c1", "vault_patch", r#"{"path":"a.md"}"#),
            session::function_call_item("c2", "cli_run", r#"{"command":"rm"}"#),
            session::function_call_item("c3", "vault_read", r#"{"path":"b.md"}"#),
            session::function_call_item("c4", "vault_read", r#"{"path":"c.md"}"#),
            // 输出项成组压尾（M360 合同：全部调用在前、输出在后，同序配对）。
            session::function_call_output_item(
                "c1",
                r#"{"ok":false,"code":"approval_rejected","message":"别动这个文件"}"#,
            ),
            session::function_call_output_item(
                "c2",
                r#"{"ok":false,"code":"permission_denied","message":"权限规则拒绝"}"#,
            ),
            session::function_call_output_item("c3", "not-json"),
        ];
        let messages = restored_panel_messages(&restored, &[], &[]);
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].status.as_deref(), Some("rejected"));
        assert_eq!(
            messages[0].text.as_deref(),
            Some(r#"{"ok":false,"code":"approval_rejected","message":"别动这个文件"}"#),
            "拒绝原因全文随输出 JSON 原文带出（summary 里那份被截断，不取）"
        );
        assert_eq!(messages[1].status.as_deref(), Some("denied"));
        // c3 的输出非 JSON：status 缺席（不推断），原文仍带出。
        assert_eq!(messages[2].status, None);
        assert_eq!(messages[2].text.as_deref(), Some("not-json"));
        // c4 无配对输出：status / text 双缺席。
        assert_eq!(messages[3].status, None);
        assert_eq!(messages[3].text, None);
    }

    /// reasoning 明文取不到（kimi 的 `encrypted_content` 形态）时不挂 reasoning——不伪造块。
    #[test]
    fn restored_panel_messages_drops_opaque_reasoning() {
        let restored = vec![
            serde_json::json!({"type": "reasoning", "encrypted_content": "opaque"}),
            session::assistant_item("正文。", None)[0].clone(),
        ];
        let messages = restored_panel_messages(&restored, &[], &[]);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].reasoning, None);
        assert_eq!(messages[0].text.as_deref(), Some("正文。"));
    }

    /// 工具行摘要与 live 面板持久化的那份同源（[`turn::summarize_args`]）：超长参数截断。
    #[test]
    fn restored_tool_summary_reuses_summarize_args() {
        let long = format!(r#"{{"path":"{}"}}"#, "a".repeat(200));
        let restored = vec![session::function_call_item("c1", "vault_read", &long)];
        let messages = restored_panel_messages(&restored, &[], &[]);
        assert_eq!(
            messages[0].summary.clone().unwrap(),
            turn::summarize_args(&long)
        );
        assert!(messages[0].summary.as_deref().unwrap().ends_with('…'));
    }

    /// M413：decision 回填——工具行经批准闸的 approved / rejected 终态从 JSONL approval
    /// sidecar 按工具名次序回填（「已采纳」可见性随恢复保留）；免闸工具行（allow 路径，
    /// 无 sidecar）与 sidecar 耗尽的行缺席，不推断。已知错配面（同工具闸内/闸外混合调用
    /// 次序对不齐）见 `restored_panel_messages` 的 doc comment 与 backlog，本条不覆盖。
    #[test]
    fn restored_tool_decision_backfilled_from_approval_sidecars() {
        let restored = vec![
            session::function_call_item("c1", "vault_delete", r#"{"path":"a.md"}"#),
            session::function_call_output_item("c1", r#"{"ok":true}"#),
            session::function_call_item("c2", "vault_delete", r#"{"path":"b.md"}"#),
            session::function_call_output_item(
                "c2",
                r#"{"ok":false,"code":"approval_rejected","message":"先别删"}"#,
            ),
            // allow 路径直执行（vault_patch 默认档免闸）：无 sidecar，decision 缺席。
            session::function_call_item("c3", "vault_patch", r#"{"path":"c.md"}"#),
            session::function_call_output_item("c3", r#"{"ok":true}"#),
        ];
        let approvals = vec![
            ("vault_delete".to_string(), "approved".to_string()),
            ("vault_delete".to_string(), "rejected".to_string()),
        ];
        let messages = restored_panel_messages(&restored, &[], &approvals);
        assert_eq!(messages[0].decision.as_deref(), Some("approved"));
        assert_eq!(messages[1].decision.as_deref(), Some("rejected"));
        assert_eq!(messages[2].decision, None, "免闸工具行没有批准决定");
    }

    /// harness-composer-image-paste：恢复路径从 wire 引用还原图片卡片（design §4.4）——
    /// user 项的 content 数组（input_text / input_image 交错，image_url 为
    /// lumir-attachment:// 引用）经 panel_text_of_content 还原成面板文本占位元素，
    /// 交错顺序逐位保留，图片引用与留存一致。
    #[test]
    fn restored_panel_messages_restores_image_cards_from_refs() {
        let restored = vec![
            serde_json::json!({
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "先看图"},
                    {"type": "input_image", "image_url": "lumir-attachment://pasted-a0123456789bc.webp"},
                    {"type": "input_text", "text": "这里哪里不对？"},
                ],
            }),
            session::assistant_item("图里第二行有错。", None)[0].clone(),
        ];
        let messages = restored_panel_messages(&restored, &[], &[]);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(
            messages[0].text.as_deref(),
            Some(
                "先看图\n<image ref=\"pasted-a0123456789bc.webp\" type=\"image/webp\"/>\n这里哪里不对？"
            ),
            "图片卡片按原交错还原成面板文本占位元素"
        );
        assert_eq!(messages[1].role, "assistant");
    }

    /// harness-composer-image-paste 任务 3.5：发送闸的拒绝 / 放行路径（design §6）。
    /// 判据四档：声明 true 放行、声明 false 拒绝、缺键（未声明）拒绝、mock 恒放行。
    #[test]
    fn image_gate_blocks_and_allows_by_vision_declaration() {
        let text_only = vec![attachments::DeliveryPart {
            kind: "text".into(),
            text: Some("纯文本".into()),
            name: None,
            label: None,
        }];
        let with_image = vec![
            attachments::DeliveryPart {
                kind: "text".into(),
                text: Some("看图".into()),
                name: None,
                label: None,
            },
            attachments::DeliveryPart {
                kind: "image".into(),
                text: None,
                name: Some("pasted-a0123456789bc.webp".into()),
                label: Some("Image 1".into()),
            },
        ];
        let model_spec = |vision: bool| crate::config::HarnessModelSpec {
            id: "kimi-vision-probe".into(),
            effort: false,
            vision,
            window: 262_144,
        };
        // kimi + vision:true → 放行（含图消息正常入队）。
        let mut config = HarnessConfig {
            provider: config::HarnessProvider::Kimi,
            ..HarnessConfig::default()
        };
        config.providers.kimi.model = "kimi-vision-probe".into();
        config.providers.kimi.models = vec![model_spec(true)];
        assert!(image_gate_error(&with_image, &config).is_none());
        // kimi + vision:false → 拒绝，code/param 形状钉住。
        config.providers.kimi.models = vec![model_spec(false)];
        let error = image_gate_error(&with_image, &config).expect("vision:false 必须拒");
        assert_eq!(error.code, "harness_image_unsupported");
        assert_eq!(
            error.params.get("model").map(String::as_str),
            Some("kimi-vision-probe")
        );
        // 缺键（空清单 = 未列出）→ 同样拒绝（保守默认）。
        config.providers.kimi.models = vec![];
        assert!(image_gate_error(&with_image, &config).is_some());
        // 纯文本消息不受闸影响（vision:false 也放行）。
        config.providers.kimi.models = vec![model_spec(false)];
        assert!(image_gate_error(&text_only, &config).is_none());
        // mock 恒放行（fixture 驱动，验收要断言含图消息正常入队）。
        let mut mock_config = HarnessConfig {
            provider: config::HarnessProvider::Mock,
            ..HarnessConfig::default()
        };
        mock_config.providers.kimi.model = "mock-model".into();
        assert!(image_gate_error(&with_image, &mock_config).is_none());
    }

    /// 进程级 XDG 复原（与 turn.rs 的测试助手同形）：drop 时把 `XDG_CONFIG_HOME` 放回原值。
    struct XdgGuard(Option<std::ffi::OsString>);
    impl Drop for XdgGuard {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
                None => std::env::remove_var("XDG_CONFIG_HOME"),
            }
        }
    }

    /// 运行槽位与交互会话槽位分离（change add-cron-runtime-daemon §3.1 的契约测试）：
    /// 无人值守运行在独立的 runtime 实例上跑，交互槽位的会话 id、消息历史与内容**逐字节
    /// 不变**；后台运行自己的会话 id 不同、留存照常落 per-vault 目录。
    #[test]
    fn run_slot_does_not_touch_the_interactive_session() {
        let _xdg = xdg_test_lock();
        let root = std::env::temp_dir().join(format!(
            "lumir-cron-slot-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-cron-slot".to_string(),
        };
        let config = HarnessConfig {
            provider: config::HarnessProvider::Mock,
            ..HarnessConfig::default()
        };

        // 交互槽位：一条用户消息 + 会话 id 作为基线。
        let interactive = Runtime::default();
        assert!(!interactive.is_isolated());
        interactive.acquire_turn(&scope, &config).unwrap();
        interactive
            .with_session(&scope, |s| {
                s.push_input(session::user_item("interactive-question"))
            })
            .unwrap();
        let interactive_id = interactive.current_session_id(&scope).expect("交互会话 id");
        let interactive_input = interactive
            .with_session(&scope, |s| s.input().to_vec())
            .unwrap();
        interactive.release_turn(&scope);

        // 运行槽位：独立实例，一条后台消息。
        let run = Runtime::isolated();
        assert!(run.is_isolated());
        run.acquire_turn(&scope, &config).unwrap();
        run.with_session(&scope, |s| {
            s.push_input(session::user_item("cron-question"))
        })
        .unwrap();
        run.release_turn(&scope);

        // 交互槽位逐字节不变（id / 消息历史 / 内容三重判据）。
        assert_eq!(
            interactive.current_session_id(&scope).as_deref(),
            Some(interactive_id.as_str()),
            "无人值守运行不得改写 / 替换交互会话 id"
        );
        assert_eq!(
            interactive
                .with_session(&scope, |s| s.input().to_vec())
                .unwrap(),
            interactive_input,
            "无人值守运行的事件不得进入交互会话的消息历史"
        );
        // 运行槽位自己的会话 id 不同、内容各自独立（留存仍按 per-vault 布局落盘）。
        let run_id = run.current_session_id(&scope).expect("运行会话 id");
        assert_ne!(run_id, interactive_id);
        assert!(run
            .with_session(&scope, |s| s
                .input()
                .iter()
                .any(|item| item["content"].to_string().contains("cron-question")))
            .unwrap());
        assert!(!interactive
            .with_session(&scope, |s| s
                .input()
                .iter()
                .any(|item| item["content"].to_string().contains("cron-question")))
            .unwrap());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 探针（M590 验收批）：前台 `task` 委派走完整回合循环时，父续写条目必须落在子运行
    /// 预分配的 mock 区间**之后**（design §18）——父的下一轮从子区间之后接着弹。
    ///
    /// 这条用例是验收场景 8.1 / 8.16 的地基：脚本布局 = 父第 1 条（task 调用）→ 子 1 条 →
    /// 父续写 1 条。父若没有跳过子区间，第二轮会把子运行的响应当成自己的续写（最终回答
    /// 变成子结论），断言因此能红。
    #[test]
    fn mock_parent_continues_after_child_region() {
        struct Collect(std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>);
        impl events::EventSink for Collect {
            fn emit(&self, payload: serde_json::Value) {
                self.0.lock().unwrap().push(payload);
            }
        }
        let _xdg = xdg_test_lock();
        let root = std::env::temp_dir().join(format!(
            "lumir-subagent-region-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let vault = root.join("vault");
        std::fs::create_dir_all(vault.join(".lumir/agents")).unwrap();
        std::fs::write(
            vault.join(".lumir/agents/research.md"),
            "---\nname: research\ndescription: 调研\n---\n你是调研子代理。\n",
        )
        .unwrap();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-subagent-region".to_string(),
        };
        let config = HarnessConfig {
            provider: config::HarnessProvider::Mock,
            ..HarnessConfig::default()
        };
        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = Collect(events.clone());
        let script = r#"{"responses":[
            {"text":"派一个任务。","tool_calls":[{"id":"c1","name":"task","arguments":"{\"agent\":\"research\",\"prompt\":\"查一查\",\"description\":\"梳理变更\"}"}]},
            {"text":"子结论。"},
            {"text":"父总结。"},
            {"text":"再派一个任务。","tool_calls":[{"id":"c2","name":"task","arguments":"{\"agent\":\"research\",\"prompt\":\"再查\",\"description\":\"第二轮\"}"}]},
            {"text":"子结论二。"},
            {"text":"父总结二。"}
        ],"subrun_span":1}"#;
        let mut client = llm::MockClient::from_str(script, "subagent-region").unwrap();
        turn::run_turn_for(
            &sink,
            &runtime,
            &scope,
            &config,
            "派个活".to_string(),
            None,
            &mut client,
        );
        // 第二轮：新 client 从会话游标接着弹（与生产 `run_turn` 同一装配）。游标不得把子运行
        // 预分配区间数两遍（M590 真机 188 现场：双计数后第二轮弹到空条目 ⇒「模型返回了空响应」）。
        let cursor = runtime
            .with_session(&scope, |session| session.mock_cursor())
            .unwrap();
        let mut second = llm::MockClient::from_str(script, "subagent-region")
            .unwrap()
            .with_start(cursor);
        turn::run_turn_for(
            &sink,
            &runtime,
            &scope,
            &config,
            "再来一个".to_string(),
            None,
            &mut second,
        );
        runtime.release_turn(&scope);
        let snapshot = runtime.snapshot(&scope, &config);
        let assistant_texts: Vec<String> = snapshot
            .messages
            .iter()
            .filter(|message| message.role == "assistant")
            .filter_map(|message| message.text.clone())
            .collect();
        assert!(
            assistant_texts.iter().any(|text| text == "父总结。"),
            "父续写条目必须被弹到（父在子区间之后接着弹）：{assistant_texts:?}"
        );
        assert!(
            !assistant_texts.iter().any(|text| text == "子结论。"),
            "子运行的响应不得被父当成本轮续写：{assistant_texts:?}"
        );
        assert!(
            assistant_texts.iter().any(|text| text == "父总结二。"),
            "第二轮必须从会话游标接着弹（双计数会让它弹到空条目）：{assistant_texts:?}"
        );
        // 子运行确实跑完了：分桶表里有一段读数（`run_turn_for` 不带 owned sink，事件面
        // 在本用例里不可见——生产入口 `run_turn` 才把它接进中枢；判据取会话侧的事实）。
        let usage = runtime
            .with_session(&scope, |session| session.subrun_usage().clone())
            .unwrap();
        assert!(
            usage.values().map(|bucket| bucket.segments).sum::<u64>() >= 1,
            "子运行应完成一段并计入分桶：{usage:?}"
        );
        let _ = events;
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 任务模型覆盖（change add-cron-runtime-daemon §3.7）：已声明 ⇒ 本次会话用该模型；
    /// 未声明 ⇒ 回落 provider 生效模型 + 一条 warning（任务不丢）；mock 没有模型维度，
    /// 覆盖被忽略且不告警。
    #[test]
    fn model_override_resolves_declared_models_only() {
        let mut config = HarnessConfig {
            provider: config::HarnessProvider::Kimi,
            ..HarnessConfig::default()
        };
        config.providers.kimi.model = "default-model".into();
        config.providers.kimi.models = vec![crate::config::HarnessModelSpec {
            id: "declared-model".into(),
            effort: true,
            vision: false,
            window: 65_536,
        }];

        let (resolved, warning) = with_model_override(&config, Some("declared-model"));
        assert_eq!(llm::active_model(&resolved), "declared-model");
        assert!(warning.is_none(), "已声明模型不应告警：{warning:?}");

        let (fallback, warning) = with_model_override(&config, Some("undeclared-model"));
        assert_eq!(
            llm::active_model(&fallback),
            "default-model",
            "未声明 ⇒ 回落 provider 生效模型"
        );
        assert!(
            warning.unwrap_or_default().contains("undeclared-model"),
            "未声明必须给一条人话 warning"
        );

        let mock = HarnessConfig {
            provider: config::HarnessProvider::Mock,
            ..HarnessConfig::default()
        };
        let (resolved, warning) = with_model_override(&mock, Some("ignored-model"));
        assert_eq!(resolved, mock);
        assert!(warning.is_none(), "mock 没有模型维度，不应告警");
    }

    /// `cron:run` 的线格式与 `CronRunRequest` 同形：`RunSpec` 字段平铺 + 任务载荷。
    /// 区分度：把 `#[serde(flatten)]` 换成嵌套 `spec` 字段、或改坏 RunSpec 的枚举线格式，
    /// 本用例必 FAIL。
    #[test]
    fn cron_run_request_deserializes_the_flat_run_spec_payload() {
        let payload = serde_json::json!({
            "origin": {"kind": "cron", "task": "task-a", "run_id": "run-1"},
            "session_target": {"kind": "unattended", "key": "run-1"},
            "tool_policy": {"allow": tools::TOOL_NAMES},
            "budget": {"max_rounds": 42, "max_tokens": 0},
            "approval_policy": {"kind": "reject_unavailable"},
            "background": false,
            "trigger": "timer",
            "target_vault": "/tmp/vault-a",
            "prompt": "synthetic prompt",
            "session": "new",
            "session_id": null,
            "model": null,
        });
        let request: CronRunRequest = serde_json::from_value(payload).unwrap();

        assert_eq!(
            request.spec.origin,
            run::RunOrigin::Cron {
                task: "task-a".to_string(),
                run_id: "run-1".to_string(),
            }
        );
        assert_eq!(
            request.spec.session_target,
            run::SessionTarget::Unattended {
                key: "run-1".to_string()
            }
        );
        assert_eq!(
            request.spec.approval_policy,
            run::ApprovalPolicy::RejectUnavailable
        );
        assert_eq!(request.spec.budget.max_rounds, 42);
        assert_eq!(request.spec.budget.max_tokens, 0);
        assert!(!request.spec.background);
        assert_eq!(
            request.spec.tool_policy.allow,
            tools::TOOL_NAMES
                .iter()
                .map(|name| (*name).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(request.trigger, "timer");
        assert_eq!(request.target_vault, "/tmp/vault-a");
        assert_eq!(request.prompt, "synthetic prompt");
        assert_eq!(request.session, "new");
        assert_eq!(request.session_id, None);
        assert_eq!(request.model, None);
    }

    /// cron 的无人值守运行与交互路径共用同一个 per-provider 请求闸（change
    /// add-harness-subagents design §12.3）：`SessionContext::request_permit` 只按
    /// `runtime.is_isolated()` 选优先级，闸本身是进程内单例（键 = provider）。
    ///
    /// 区分度：若 cron 槽位没接闸（返回 `None`）或另起一个闸，持有侧不会挡住交互侧，
    /// `waiting_parents` 恒 0，本用例必 FAIL。
    #[test]
    fn isolated_cron_run_shares_the_provider_request_gate() {
        use run::RunContext as _;

        struct NullSink;
        impl events::EventSink for NullSink {
            fn emit(&self, _payload: serde_json::Value) {}
        }

        // 选 Kimi：本仓库的调度器用例走 Deepseek、其余运行用例走 Mock，避免共享闸互相干扰。
        let provider = config::HarnessProvider::Kimi;
        // 许可数 = max_concurrent + 1 = 1：占住唯一许可即可观察另一侧的等待。
        let config = HarnessConfig {
            provider,
            subagents: config::SubagentsConfig {
                max_concurrent: 0,
                ..Default::default()
            },
            ..Default::default()
        };
        let root = std::env::temp_dir().join(format!(
            "lumir-cron-gate-{}-{}",
            std::process::id(),
            std::line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let scope = VaultScope {
            root: root.clone(),
            policy: {
                let defaults = config::VaultConfig::default();
                IgnorePolicy::load(&root, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-cron-gate".to_string(),
        };
        let sink = NullSink;
        let isolated = Runtime::isolated();
        let interactive = Runtime::default();
        let cron_ctx = run::SessionContext::new(&sink, &isolated, &scope, &config);
        let user_ctx = run::SessionContext::new(&sink, &interactive, &scope, &config);

        let held = cron_ctx
            .request_permit()
            .expect("cron 槽位必须受 provider 请求闸约束");
        assert_eq!(
            scheduler::provider_gate_state(provider).0,
            1,
            "cron 运行应占住共享闸的许可"
        );

        std::thread::scope(|threads| {
            let handle = threads.spawn(move || {
                let _permit = user_ctx
                    .request_permit()
                    .expect("交互槽位必须受 provider 请求闸约束");
            });
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            while scheduler::provider_gate_state(provider).1 == 0
                && std::time::Instant::now() < deadline
            {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            assert_eq!(
                scheduler::provider_gate_state(provider).1,
                1,
                "cron 持有的许可必须挡住交互路径（两处是同一份闸）"
            );
            drop(held);
            handle.join().unwrap();
        });
        assert_eq!(
            scheduler::provider_gate_state(provider),
            (0, 0, 0),
            "全部许可归还后闸应回到空闲"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
