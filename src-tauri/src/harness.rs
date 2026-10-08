//! Harness 对话运行时（change add-harness-probe，ADR 0007 探针的 Rust core）。
//!
//! 分层与既有纪律：
//! - 面板（m303）只消费事件与 `harness_state` 快照，本会话状态全部在 Rust、绑定 vault
//!   （design §2）：一个 vault 一个会话（内存态），切 vault 切换、切回恢复、关 vault 丢弃、
//!   app 重启清空；webview 重载经 `harness_state` 恢复渲染。
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
    /// 「新会话」重置后，下一次建立该 vault 会话时的 `opened_from`（reset）——
    /// 文件边界口径：重置 = 旧文件封闭 + 新文件首行 opened_from=reset。懒建立语义不变
    /// （重置本身不建会话），故用这个挂起映射衔接（键随会话建立移除）。
    pending_open: Mutex<HashMap<String, &'static str>>,
    /// 批准请求 id 的单调序号（`ap-<n>`，进程内唯一即可）。
    approval_seq: AtomicU64,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            inner: Arc::new(RuntimeInner {
                sessions: Mutex::new(HashMap::new()),
                pending_open: Mutex::new(HashMap::new()),
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
    /// 续写**新** JSONL 文件（opened_from=restore，restored_from=源会话 id）。面板消息不重建——恢复的是 LLM 侧
    /// 单一事实源，面板渲染是前端恢复 mission 的消费面。busy 态拒绝（与 new_session
    /// 同口径）；非 busy 时替换当前会话。
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
        let path = jsonl::sessions_dir()?.join(format!("{session_id}.jsonl"));
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
        if let Some((index, _)) = conversation_requests.last() {
            if let Some(response) = file
                .records
                .get(index + 1)
                .filter(|r| r["kind"] == "llm_response")
            {
                for item in session::assistant_item(
                    response["text"].as_str().unwrap_or(""),
                    response.get("reasoning"),
                ) {
                    restored.push(item);
                }
                if let Some(calls) = response["tool_calls"].as_array() {
                    for call in calls {
                        restored.push(session::function_call_item(
                            call["id"].as_str().unwrap_or(""),
                            call["name"].as_str().unwrap_or(""),
                            call["arguments"].as_str().unwrap_or(""),
                        ));
                    }
                }
            }
        }
        // 续写新文件：session_open 沿用源文件的装配事实（system 全文 + assembly 清单），
        // provider / model / thinking 记**当前**配置（后续请求实际使用的身份）；
        // opened_from=restore + restored_from=源会话 id（谱系链：这份会话恢复自哪份）。
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
            "thinking": effort,
            "system": system,
            "assembly": assembly,
        });
        let writer = jsonl::JsonlWriter::create(&new_id, &open_payload)?;
        let restored_items = restored.len();
        let new_session =
            session::Session::new(scope.root.clone(), system, restored, effort, writer);
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
        })
    }
}

/// 会话留存归属当前 vault 的判据（恢复与列举共用一处——同一语义两处真源会漂，
/// REVIEW.md 第 8 条）：首行 `session_open.vault_root` 必须逐字等于当前 scope 的键
/// （vault 根路径）。
fn session_belongs_to_scope(open: &serde_json::Value, scope: &VaultScope) -> bool {
    open["vault_root"].as_str() == Some(scope.key().as_str())
}

/// 列举当前 vault 的留存会话（`harness_list_sessions` 的实现体，change
/// reshape-harness-session-recording 任务 2.1）：扫 `<config_dir>/harness/sessions/*.jsonl`，
/// 按 [`session_belongs_to_scope`]（与恢复命令同一 vault 归属口径）过滤，按 session id
/// 时间序前缀倒序返回。
///
/// 读不出 / 首行不是 `session_open` 的文件跳过并打一条 stderr——列举是面板历史选择器的
/// 数据源，一份损坏的留存不该让整份历史列表消失（恢复命令对**选中的**文件仍严格报错）。
/// 会话名素材是首条用户消息的**原文**：截断（约 20 字）的规则在前端。
pub fn list_sessions(scope: &VaultScope) -> Result<Vec<session::SessionSummary>, CommandError> {
    let dir = jsonl::sessions_dir()?;
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
        });
    }
    // session id 是时间序（`s<unix_millis>-<随机后缀>`）：字符串倒序即时间倒序。
    summaries.sort_by(|a, b| b.session_id.cmp(&a.session_id));
    Ok(summaries)
}

/// 会话名素材：文件内**第一条** `llm_request` 的首条 user 消息正文原文
/// （None = 该会话还没有用户消息）。截断规则归前端——这里给全文。
fn first_user_text(file: &jsonl::SessionFile) -> Option<String> {
    let request = file.records.iter().find(|r| r["kind"] == "llm_request")?;
    let messages = request["request"]["messages"].as_array()?;
    let message = messages.iter().find(|m| m["role"] == "user")?;
    user_message_text(message)
}

/// 从一条 wire user 消息项取正文（[`session::user_item`] 的逆：content 数组里的各 text part
/// 拼接；兼容 content 直接是字符串的形态）。
fn user_message_text(message: &serde_json::Value) -> Option<String> {
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

/// 取得（必要时建立）该 vault 的会话：会话不存在时装配系统上下文、开新留存文件
/// （首行挂起 `session_open`，`opened_from` 取 pending_open 里的 reset 或 new），
/// system 全文与 assembly 清单原样灌进首行。
///
/// **唯一建立路径**（M362 收拢）：`acquire_turn` 与 `set_thinking_effort` 都经这里——两处各写
/// 一份建立逻辑必然漂移（REVIEW.md 第 8 条）。建立失败（留存文件打开失败）在插入之前返回，
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
            None,
        );
        let writer = jsonl::JsonlWriter::create(&session_id, &open)?;
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
/// 外加恢复的 resume）。完整装配记录 = system 全文逐字节、每来源的路径与存在与否、
/// provider / 模型 / 思考档位、opened_from（new / reset / compact / resume；compact
/// 时 compact_summary 在场）。
///
/// `assembled` 是当次装配的结构化结果——调用侧 MUST 与灌给会话的 system 全文同源
/// （同一次 `assemble_system`）；`thinking` 是该会话此刻的实际档位（首条记录前用户
/// 可能已切档，挂起行可由 `update_pending_open` 修正）。
pub(crate) fn session_open_payload(
    scope: &VaultScope,
    config: &HarnessConfig,
    assembled: &context::AssembledSystem,
    session_id: &str,
    opened_from: &str,
    thinking: thinking::ThinkingEffort,
    compact_summary: Option<&str>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "kind": "session_open",
        "session_id": session_id,
        "vault_root": scope.key(),
        "opened_from": opened_from,
        "provider": config.provider,
        "model": llm::active_model(config),
        "thinking": thinking.as_str(),
        "system": assembled.text,
        "assembly": assembled.manifest,
    });
    if let Some(summary) = compact_summary {
        payload["compact_summary"] = serde_json::json!(summary);
    }
    payload
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
    runtime.acquire_turn(&scope, &config)?;
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
    let config = config::load()?.config.harness;
    runtime.set_thinking_effort(&scope, &config, effort)
}

/// 从留存文件恢复会话（change reshape-harness-session-recording 的恢复入口）：
/// `session_id` 是 `sessions/<id>.jsonl` 的文件名（形态校验防目录穿越）。读源文件
/// 最后一条会话轮次 `llm_request` 的完整请求体，system + messages 原样灌进新会话并
/// 续写**新**留存文件（opened_from=restore、restored_from=源会话 id——恢复的地基：文件边界 + 会话身份 + 谱系链）。
/// 返回新会话标识（`SessionResumeInfo`，ts-rs 导出）；面板重渲染由前端恢复 mission
/// 经 `harness_state` 消费。busy 态返回 `harness_busy`；源文件不属于当前 vault 返回
/// `harness_session_vault_mismatch`。
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
