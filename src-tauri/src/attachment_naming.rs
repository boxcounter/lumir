//! 图片语义命名（change add-semantic-image-naming，design §2–§8）。
//!
//! 一次粘贴的异步尾巴：落盘已经按内容寻址完成（`pasted-<hash16>.<ext>`），本模块把文件改名成
//! `<slug>-<hash6>.<ext>` 并同步改写全 vault 指向它的 wikilink。全部动作在**后台线程**上，
//! 粘贴路径只多一次 invoke 投递（ADR 0002 §6 性能合同：MUST NOT 在粘贴路径上等待模型）。
//!
//! 三段职责分开，便于单测逐段驱动：
//!
//! - **纯函数**：slug 规整（[`sanitize_slug`]）、上下文装配（[`naming_material`]）、请求构造
//!   （[`request`]）。不碰磁盘、不碰网络。
//! - **一次性调用**：复用 `harness::llm` 的 client 装配（provider / 模型 / 方言 / 图片展开），
//!   但**不建 harness 会话、不写会话 JSONL**——这不是对话轮次，会话留存零污染（design §4）。
//! - **编排**（[`run`] / [`undo`]）：读配置快照 → 资格判定 → 串行队列 → 调用 → 放弃判据 →
//!   目标名规划 → 引用扫描 → rename → 逐篇 CAS 改写。所有失败都收敛成「保留暂存名 + 一条
//!   诊断日志」，MUST NOT 弹失败 toast（高频路径，静默降级即现状）。
//!
//! 放弃判据只有一条（spec「异步缺口的放弃与撤销」）：命名时刻目标文件已不在粘贴落盘的位置
//! 或字节哈希已变 ⇒ 完全放弃，不猜新位置、不覆盖人的命名。vault 已切换是技术前提失效，同样
//! 终止。撤销是与改名对称的反向操作，服从同一组判据。
//!
//! 退出语义：队列不持久化，进程结束即丢弃未完成的任务；文件保持暂存名（= 现状）。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use ts_rs::TS;

use crate::commands::{CommandError, VaultState};
use crate::config;
use crate::fs_io::{self, IgnorePolicy};
use crate::harness::llm::{self, LlmClient};
use crate::harness::thinking::ThinkingEffort;
use crate::link_graph::{self, TextChange};

/// 生成器指令（单一处：`prompts/attachment_slug.md`，`include_str!` 只有这一处引用）。
pub const SLUG_PROMPT: &str = include_str!("prompts/attachment_slug.md");

/// 粘贴时刻光标前 / 后段落的字符上限（design §4.5；提案「隐私面」登记的就是这两个值）。
pub const CONTEXT_CHARS: usize = 500;
/// slug 长度上限（字符；spec「图片语义命名与异步重命名」）。
pub const SLUG_MAX: usize = 40;

/// 撤销令牌的技术有效期：用户面窗口是 toast 的可见期（8 秒，M577 起沿用既有 `showToast`），
/// 令牌的有效期只用来回收内存——它比 toast 长，避免「按钮还在、令牌已过期」这种对用户
/// 无法解释的竞态（design §6：令牌只在 toast 可见期内**有入口**，不是必须同时失效）。
pub const UNDO_TTL: Duration = Duration::from_secs(60);

/// 诊断码（落 `attachment_naming` 日志的 `code` 字段，也是返回给前端的跳过原因）。
pub const CODE_DISABLED: &str = "attachment_naming_disabled";
pub const CODE_CONFIG: &str = "config_unavailable";
pub const CODE_NO_VAULT: &str = "vault_not_open";
pub const CODE_NO_MODEL: &str = "no_vision_model";
pub const CODE_NOT_STAGING: &str = "not_staging_name";
pub const CODE_DUPLICATE: &str = "duplicate_request";
pub const CODE_FILE_CHANGED: &str = "file_changed";
pub const CODE_MODEL_FAILED: &str = "model_call_failed";
pub const CODE_SLUG_EMPTY: &str = "slug_unusable";
pub const CODE_NAME_EXHAUSTED: &str = "name_exhausted";
pub const CODE_OCCUPIED: &str = "occupied_by_same_content";
pub const CODE_RENAME_FAILED: &str = "rename_failed";
pub const CODE_VAULT_SWITCHED: &str = "vault_switched";

// 撤销失败的结构化错误码（前端按 code 渲染人话 toast，MUST NOT 静默）直接以字面量写在
// `CommandError::new` 的构造点：`tests/unit/error-text.test.ts` 的完整性门禁要求 code 是
// 字面量（常量会让「后端可能产出的 code 集合」扫不到，en 界面就会静默掉回中文 message）。

// ---------------------------------------------------------------------------
// 返回给前端的载荷
// ---------------------------------------------------------------------------

/// 一次命名的终局。`status = skipped` 时只有 `code` 与路径有意义，前端**不弹任何 toast**
/// （撤消失败例外——那是用户显式动作，见 [`undo`]）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum NamingStatus {
    Renamed,
    Skipped,
}

/// 一篇被改写笔记的新磁盘 revision（前端据此推进该路径的 CAS 基准，design §5.3）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RewrittenNote {
    pub path: String,
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NamingOutcome {
    pub status: NamingStatus,
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub old_name: Option<String>,
    pub new_name: Option<String>,
    /// 磁盘上被成功改写的笔记（含新 revision）。
    pub rewritten: Vec<RewrittenNote>,
    /// 扫描命中但**没有**写成（并发修改 / 读取或写入失败）的笔记路径——前端对打开中的这些
    /// 文档要按普通外部变更处置（结果之外的那条通知不会被静默吞掉）。
    pub skipped: Vec<String>,
    /// 撤销令牌（`status = renamed` 时在场；撤销结果不再产生新令牌）。
    pub undo_token: Option<String>,
    /// `status = skipped` 时的诊断码。
    pub code: Option<String>,
}

impl NamingOutcome {
    pub(crate) fn skipped(old_path: &str, code: &str) -> Self {
        crate::logging::attachment_naming(old_path, code);
        Self {
            status: NamingStatus::Skipped,
            old_path: Some(old_path.to_string()),
            new_path: None,
            old_name: None,
            new_name: None,
            rewritten: Vec::new(),
            skipped: Vec::new(),
            undo_token: None,
            code: Some(code.to_string()),
        }
    }
}

/// 后端在**开始写盘之前**广播的回声抑制事件（design §5.3 的「按路径登记抑制」）。
///
/// 与 `renameEcho` 同形的守卫为什么不能在 invoke 发起时登记：扫描之前前端不知道哪些笔记会被
/// 改写（只有后端知道）。事件在 rename 与逐篇写盘之前发出，前端收到即按 `from → to` 与每条
/// note 路径登记一次性抑制；笔记的 `Modified` 事件随写盘到达时被吞掉，不会再被误判成
/// 「检测到外部修改」（dirty 文档上的 sticky 冲突提示那条破坏性路径）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NamingEcho {
    /// 改名前的 vault 相对路径（撤销时方向相反）。
    pub from: String,
    /// 改名后的 vault 相对路径。
    pub to: String,
    /// 即将被后端改写的笔记路径（前端对这些路径登记抑制）。
    pub notes: Vec<String>,
}

// ---------------------------------------------------------------------------
// slug 规整（纯函数）
// ---------------------------------------------------------------------------

/// 模型输出 → 文件名 slug（spec「图片语义命名与异步重命名」的字符集条款）。
///
/// 口径（Alex 2026-10-18 裁决「纯 ASCII kebab-case」）：只留小写 ASCII 字母 `a-z`、数字
/// `0-9` 与 `-`；ASCII 大写折叠为小写；其余字符（空白 / 下划线 / 标点 / 含中日韩字符在内的
/// 所有非 ASCII / emoji）一律**剔除、不做音译**，剔除处折成单个 `-`；连续 `-` 折叠、首尾 `-`
/// 裁掉；长度上限 [`SLUG_MAX`]。规整后为空即「输出不可用」（调用方保留暂存名）。
///
/// 前置清洗（design §4「输出解析」）：取第一条**非空且不是代码围栏**的行，去掉末尾的图片
/// 扩展名（模型常把 `.webp` 一起回出来）。引号 / 反引号不需要单独处理——它们不在字符集内，
/// 剔除时折成的 `-` 落在首尾会被裁掉。
pub fn sanitize_slug(raw: &str) -> String {
    let line = raw
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !is_fence(line))
        .unwrap_or("");
    let line = strip_image_extension(line);
    let mut out = String::new();
    let mut separator = false;
    for ch in line.chars() {
        let kept = match ch {
            'a'..='z' | '0'..='9' => Some(ch),
            'A'..='Z' => Some(ch.to_ascii_lowercase()),
            _ => None,
        };
        match kept {
            Some(c) => {
                if !out.is_empty() && separator {
                    out.push('-');
                }
                out.push(c);
                separator = false;
            }
            // 剔除的字符是词边界：连续多个只折成一个 `-`（首部不折——`out` 为空时不 push）。
            None => separator = true,
        }
    }
    let clipped: String = out.chars().take(SLUG_MAX).collect();
    clipped.trim_end_matches('-').to_string()
}

/// 纯代码围栏行（``` 或 ~~~，允许尾部空白）。
fn is_fence(line: &str) -> bool {
    let trimmed = line.trim();
    let first = match trimmed.chars().next() {
        Some(first @ ('`' | '~')) => first,
        _ => return false,
    };
    trimmed.chars().take_while(|c| *c == first).count() >= 3 && trimmed.chars().all(|c| c == first)
}

/// 去掉末尾的图片扩展名（`harness-arch.webp` → `harness-arch`）。只认图片类扩展名：其它
/// 尾巴（例如 `arch.v2`）按原文交给字符集规整，不做猜。
fn strip_image_extension(line: &str) -> &str {
    let lower = line.to_ascii_lowercase();
    for extension in ["webp", "jpeg", "jpg", "png", "gif", "avif", "svg"] {
        let suffix = format!(".{extension}");
        if lower.ends_with(&suffix) && line.len() > suffix.len() {
            return &line[..line.len() - suffix.len()];
        }
    }
    line
}

// ---------------------------------------------------------------------------
// 上下文装配与请求（纯函数）
// ---------------------------------------------------------------------------

/// 一段文本按上限截断：`tail = true` 保留**末尾**（光标前的段落——离光标最近的才是上下文），
/// `false` 保留开头（光标后）。截断按字符而不是字节（多字节字符不得被切坏）。
fn clip(text: &str, max: usize, tail: bool) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        return text.to_string();
    }
    if tail {
        chars[chars.len() - max..].iter().collect()
    } else {
        chars[..max].iter().collect()
    }
}

/// 笔记标题 = 笔记文件名的 stem（无路径的新建文档取空串）。设计口径「文件名 stem」：
/// 只剥最后一个扩展名，`a.b.md` → `a.b`。
pub fn note_title(note_path: Option<&str>) -> String {
    let Some(path) = note_path else {
        return String::new();
    };
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem.to_string(),
        _ => name.to_string(),
    }
}

/// 请求里的上下文文本（design §4.5）：**粘贴时刻**的光标前后段落各截断到
/// [`CONTEXT_CHARS`]（前段留尾部、后段留开头——离光标最近的内容信息量最大），加笔记标题。
/// 异步返回时 MUST NOT 重读光标（用户可能已经继续写，位置早已不是粘贴处）。
pub fn naming_material(note_path: Option<&str>, before: &str, after: &str) -> String {
    let title = note_title(note_path);
    format!(
        "笔记标题：{title}\n\n光标前的段落（可能被截断）：\n{}\n\n光标后的段落（可能被截断）：\n{}",
        clip(before, CONTEXT_CHARS, true),
        clip(after, CONTEXT_CHARS, false),
    )
}

/// 一次命名调用（design §4）：单条 user 消息 = 上下文文本 + `input_image`，无工具、无历史、
/// 非流式。图片以 data URL 直接内联——不写 harness 附件目录、不产生任何会话侧留存。
///
/// `effort` 取 [`ThinkingEffort::Low`]：一次性产物用最便宜档（标题调用同口径）。现有
/// `llm::Request` 没有「不设置」的第三态（`apply_effort` 在能力支持时总会写一个值），
/// 因此「跟随模型默认」在本仓的机制下落成「显式最低档」。
pub fn request(material: &str, image_data_url: &str) -> llm::Request {
    llm::Request {
        system: SLUG_PROMPT.to_string(),
        input: vec![serde_json::json!({
            "role": "user",
            "content": [
                {"type": "input_text", "text": material},
                {"type": "input_image", "image_url": image_data_url},
            ],
        })],
        tools: Vec::new(),
        effort: ThinkingEffort::Low,
    }
}

/// 扩展名 → 图片 MIME（data URL 用）。与 `fs_io::attachment_target` 的目标格式一一对应，
/// 只覆盖本能力可能落盘的三种（png 会被转码成 webp，因此实际只出现 webp / jpg）。
fn image_mime(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        _ => "image/webp",
    }
}

/// 一次命名调用的结果（`client` 由 [`llm::naming_client`] 装配；单测注入 mock / 记录 client）。
fn evaluate(
    client: &mut dyn LlmClient,
    material: &str,
    image_data_url: &str,
) -> Result<String, &'static str> {
    let output = client.complete(&request(material, image_data_url), &llm::DiscardStreamSink);
    if let Some(error) = output.error {
        eprintln!(
            "lumir: 图片语义命名调用失败（{CODE_MODEL_FAILED}）：{}",
            error.message
        );
        return Err(CODE_MODEL_FAILED);
    }
    let slug = sanitize_slug(&output.text);
    if slug.is_empty() {
        return Err(CODE_SLUG_EMPTY);
    }
    Ok(slug)
}

// ---------------------------------------------------------------------------
// 串行队列（design §3：同一时刻至多一个请求、同路径合并、FIFO）
// ---------------------------------------------------------------------------

struct QueueState {
    next_ticket: u64,
    serving: u64,
    inflight: HashSet<String>,
}

struct SerialQueue {
    state: Mutex<QueueState>,
    ready: Condvar,
}

impl SerialQueue {
    fn new() -> Self {
        Self {
            state: Mutex::new(QueueState {
                next_ticket: 0,
                serving: 0,
                inflight: HashSet::new(),
            }),
            ready: Condvar::new(),
        }
    }

    /// 取一个执行位：同一路径已在队列里（排队或在途）⇒ `None`（重复投递合并）。
    /// 否则按到达顺序排队（FIFO：ticket 单调，服务号依次推进）。
    fn acquire(&'static self, path: &str) -> Option<QueueGuard> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.inflight.insert(path.to_string()) {
            return None;
        }
        let ticket = state.next_ticket;
        state.next_ticket += 1;
        while state.serving != ticket {
            state = self.ready.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        Some(QueueGuard {
            queue: self,
            path: path.to_string(),
        })
    }
}

struct QueueGuard {
    queue: &'static SerialQueue,
    path: String,
}

impl Drop for QueueGuard {
    fn drop(&mut self) {
        let mut state = self.queue.state.lock().unwrap_or_else(|e| e.into_inner());
        state.inflight.remove(&self.path);
        state.serving += 1;
        self.queue.ready.notify_all();
    }
}

fn queue() -> &'static SerialQueue {
    static QUEUE: OnceLock<SerialQueue> = OnceLock::new();
    QUEUE.get_or_init(SerialQueue::new)
}

// ---------------------------------------------------------------------------
// 撤销注册表（design §6）
// ---------------------------------------------------------------------------

struct UndoRecord {
    vault_root: PathBuf,
    vault_id: String,
    /// 改名前的暂存名路径（撤销要回到这里）。
    staging_path: String,
    /// 改名后的语义名路径（撤销的起点）。
    semantic_path: String,
    hash16: String,
    stage_extension: String,
    expires: Instant,
}

static UNDO: OnceLock<Mutex<HashMap<String, UndoRecord>>> = OnceLock::new();
static UNDO_SEQ: AtomicU64 = AtomicU64::new(0);

fn undo_registry() -> &'static Mutex<HashMap<String, UndoRecord>> {
    UNDO.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_undo(record: UndoRecord) -> String {
    let token = format!(
        "undo-{}-{}",
        std::process::id(),
        UNDO_SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let mut registry = undo_registry().lock().unwrap_or_else(|e| e.into_inner());
    // 顺带回收过期条目（低频操作，顺手清即可，不引入后台清理线程）。
    let now = Instant::now();
    registry.retain(|_, item| item.expires > now);
    registry.insert(token.clone(), record);
    token
}

fn take_undo(token: &str) -> Option<UndoRecord> {
    let mut registry = undo_registry().lock().unwrap_or_else(|e| e.into_inner());
    let record = registry.remove(token)?;
    (record.expires > Instant::now()).then_some(record)
}

// ---------------------------------------------------------------------------
// 引用扫描与改写（rename 之前收集，rename 之后逐篇写）
// ---------------------------------------------------------------------------

struct NoteHit {
    path: String,
    /// 扫描时的磁盘内容（写前 CAS 的期望值来自它的 revision）。
    revision: String,
    changes: Vec<TextChange>,
}

/// 全 vault 扫描指向 `target_path` 的 wikilink，返回逐篇改写点（design §5.1）。
///
/// 必须**在 rename 之前**跑：解析器的名称索引基于当前文件名，文件一改名旧名就不再可解析。
/// 第一遍按 [`fs_io::scan_vault_files`] 的同一套剪枝口径收路径并建图（只有路径进索引，
/// 标题树不参与路径解析）；第二遍逐篇 md 读盘、`parse_links` + `resolve`，收集解析结果等于
/// 目标路径的链接。
///
/// 返回 `(hits, unreadable)`：读不出来的 md 也要计数（它可能含引用，静默漏掉就违反了
/// 「MUST NOT 静默」）。
fn scan_references(
    root: &Path,
    policy: &IgnorePolicy,
    target_path: &str,
    new_name: &str,
) -> (Vec<NoteHit>, Vec<String>) {
    let files = fs_io::scan_vault_files(root, policy);
    let mut graph = link_graph::LinkGraph::new();
    for path in &files {
        graph.upsert(path, None);
    }
    let mut hits = Vec::new();
    let mut unreadable = Vec::new();
    for path in files.iter().filter(|path| link_graph::is_markdown(path)) {
        let (content, revision) = match fs_io::read_text_snapshot(root, path) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                unreadable.push(path.clone());
                continue;
            }
        };
        let mut changes: Vec<TextChange> = Vec::new();
        for link in link_graph::parse_links(&content) {
            if link.path.is_empty() {
                continue;
            }
            let resolved = graph.resolve(path, &link);
            if resolved.path.as_deref() != Some(target_path) {
                continue;
            }
            changes.push(TextChange {
                from: link.path_span.0,
                to: link.path_span.1,
                insert: link_graph::retargeted_path(&link.path, new_name),
            });
        }
        if changes.is_empty() {
            continue;
        }
        changes.sort_by_key(|change| std::cmp::Reverse(change.from));
        hits.push(NoteHit {
            path: path.clone(),
            revision,
            changes,
        });
    }
    (hits, unreadable)
}

/// 逐篇写盘（design §5.5）：`save_document` 自带 CAS（expected_revision）+ tmp/rename 原子写
/// ——扫描之后被别人改过的笔记一律 `document_conflict`，跳过并计数，MUST NOT 覆盖。
fn apply_hits(root: &Path, hits: &[NoteHit]) -> (Vec<RewrittenNote>, Vec<String>) {
    let mut rewritten = Vec::new();
    let mut skipped = Vec::new();
    for hit in hits {
        let Ok(abs) = fs_io::resolve_in_vault(root, &hit.path) else {
            skipped.push(hit.path.clone());
            continue;
        };
        let Ok(current) = std::fs::read_to_string(&abs) else {
            skipped.push(hit.path.clone());
            continue;
        };
        let next = link_graph::apply_text_changes(&current, &hit.changes);
        if next == current {
            continue;
        }
        match fs_io::save_document(root, &hit.path, &hit.revision, &next) {
            Ok(revision) => rewritten.push(RewrittenNote {
                path: hit.path.clone(),
                revision,
            }),
            Err(_) => skipped.push(hit.path.clone()),
        }
    }
    (rewritten, skipped)
}

// ---------------------------------------------------------------------------
// 编排：命名
// ---------------------------------------------------------------------------

/// 命名任务的入参（`attachment_semantic_name` 命令的载荷）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamingRequest {
    /// 刚落盘的图片的 vault 相对路径（暂存名）。
    pub path: String,
    /// 当前笔记的 vault 相对路径（无路径的新建文档为 None）。
    pub note_path: Option<String>,
    /// 粘贴时刻光标前的段落文本（可能很长，本模块负责截断）。
    pub before: String,
    /// 粘贴时刻光标后的段落文本。
    pub after: String,
}

/// 执行一次命名（生产路径在 command 的线程池 worker 上调用；单测直接驱动）。
///
/// `emit` 是回声抑制事件的出口（生产 = `app.emit("attachment:naming", …)`；单测 = 记录器）。
pub fn run(
    state: &VaultState,
    config_snapshot: &config::ConfigSnapshot,
    request: NamingRequest,
    emit: &dyn Fn(&NamingEcho),
) -> NamingOutcome {
    let path = request.path.clone();
    let harness = &config_snapshot.config.harness;
    // 开关与资格分两步判：诊断码要把「关着」与「无可用 vision 模型」分开（design §4.2）。
    if !harness.attachment_naming.enabled {
        return NamingOutcome::skipped(&path, CODE_DISABLED);
    }
    let Some(target) = harness.attachment_naming_target(&harness.provider) else {
        // 无可用 vision 模型：不发起任何请求（design §4.2）。
        return NamingOutcome::skipped(&path, CODE_NO_MODEL);
    };
    let (root, policy, vault_id) = match state.root_policy_and_id() {
        Ok(snapshot) => snapshot,
        Err(_) => return NamingOutcome::skipped(&path, CODE_NO_VAULT),
    };
    let Some(guard) = queue().acquire(&path) else {
        return NamingOutcome::skipped(&path, CODE_DUPLICATE);
    };
    let outcome = run_locked(&root, &policy, &vault_id, harness, &target, &request, emit);
    drop(guard);
    // vault 在任务期间被切换：技术前提失效（不产生产品侧可见动作，spec）。
    if matches!(state.root_policy_and_id(), Ok((current, _, _)) if current == root) {
        outcome
    } else {
        NamingOutcome::skipped(&path, CODE_VAULT_SWITCHED)
    }
}

fn run_locked(
    root: &Path,
    policy: &IgnorePolicy,
    vault_id: &str,
    harness: &config::HarnessConfig,
    target: &config::AttachmentNamingTarget,
    request: &NamingRequest,
    emit: &dyn Fn(&NamingEcho),
) -> NamingOutcome {
    let path = request.path.clone();
    let mut client = match llm::naming_client(harness, target, vault_id) {
        Ok(client) => client,
        Err(error) => {
            // 配置级失败（mock fixture 缺失 / api_key 未配）：按失败分类静默降级。
            eprintln!(
                "lumir: 图片语义命名不可用（{}）：{}",
                error.code, error.message
            );
            return NamingOutcome::skipped(&path, CODE_MODEL_FAILED);
        }
    };
    run_with_client(root, policy, vault_id, request, client.as_mut(), emit)
}

/// [`run_locked`] 的注入形态（单测直接驱动）：client 由调用方给出，其余编排逐字相同。
fn run_with_client(
    root: &Path,
    policy: &IgnorePolicy,
    vault_id: &str,
    request: &NamingRequest,
    client: &mut dyn LlmClient,
    emit: &dyn Fn(&NamingEcho),
) -> NamingOutcome {
    let path = request.path.clone();
    // 前置快检：文件必须仍在、仍是**本次落盘的暂存名**、字节哈希与名字一致。
    let Some((bytes, hash16)) = read_staged(root, &path) else {
        return NamingOutcome::skipped(&path, CODE_NOT_STAGING);
    };
    let Some(name) = path.rsplit('/').next().map(str::to_string) else {
        return NamingOutcome::skipped(&path, CODE_NOT_STAGING);
    };
    let Some(extension) = name.rsplit_once('.').map(|(_, ext)| ext.to_string()) else {
        return NamingOutcome::skipped(&path, CODE_NOT_STAGING);
    };
    let data_url = format!(
        "data:{};base64,{}",
        image_mime(&extension),
        fs_io::base64_encode(&bytes)
    );
    let material = naming_material(
        request.note_path.as_deref(),
        &request.before,
        &request.after,
    );
    let slug = match evaluate(client, &material, &data_url) {
        Ok(slug) => slug,
        Err(code) => return NamingOutcome::skipped(&path, code),
    };
    // 最终放弃判定（同一规则，改名之前）：缺口内被人工改名 / 移走 / 内容变化 ⇒ 完全放弃。
    let final_hash = match read_staged(root, &path) {
        Some((_, final_hash)) => final_hash,
        None => return NamingOutcome::skipped(&path, CODE_FILE_CHANGED),
    };
    if final_hash != hash16 {
        return NamingOutcome::skipped(&path, CODE_FILE_CHANGED);
    }
    // 目标名规划（撞名按 6 → 8 → 12 → 16 位扩展）。
    let new_name = match fs_io::plan_semantic_name(root, policy, &slug, &hash16, &extension) {
        fs_io::PlannedSemanticName::Available(name) => name,
        // 同一内容已有语义名（并发 / 手工复制的边缘场景）：**复用既有位置**，不再产生第二个
        // 副本（design §2「内容相同的占用……直接放弃改名并复用既有位置」，评审 r1 P2-4 的
        // 选项「实现复用」）。暂存副本的引用改指既有文件，随后删掉暂存副本。
        fs_io::PlannedSemanticName::OccupiedBySameContent(existing) => {
            return reuse_existing(root, policy, &path, &existing, &name, emit)
        }
        fs_io::PlannedSemanticName::Exhausted => {
            return NamingOutcome::skipped(&path, CODE_NAME_EXHAUSTED)
        }
    };
    // 引用扫描必须在 rename **之前**（改名后旧名不再可解析，design §5.1）。
    let (hits, unreadable) = scan_references(root, policy, &path, &new_name);
    let predicted = new_path_of(&path, &new_name);
    emit(&NamingEcho {
        from: path.clone(),
        to: predicted.clone(),
        notes: hits.iter().map(|hit| hit.path.clone()).collect(),
    });
    let renamed = match fs_io::rename_entry(root, policy, &path, &new_name) {
        Ok(renamed) => renamed,
        Err(error) => {
            eprintln!(
                "lumir: 图片语义改名失败（{}）：{}",
                error.code, error.message
            );
            return NamingOutcome::skipped(&path, CODE_RENAME_FAILED);
        }
    };
    let (rewritten, mut skipped) = apply_hits(root, &hits);
    skipped.extend(unreadable);
    let token = register_undo(UndoRecord {
        vault_root: root.to_path_buf(),
        vault_id: vault_id.to_string(),
        staging_path: path.clone(),
        semantic_path: renamed.clone(),
        hash16,
        stage_extension: extension,
        expires: Instant::now() + UNDO_TTL,
    });
    NamingOutcome {
        status: NamingStatus::Renamed,
        old_path: Some(path),
        new_path: Some(renamed),
        old_name: Some(name),
        new_name: Some(new_name),
        rewritten,
        skipped,
        undo_token: Some(token),
        code: None,
    }
}

/// 复用既有语义名文件（design §2 的「内容相同的占用」分支，评审 r1 P2-4）：把指向**暂存副本**
/// 的引用改指既有文件，然后删掉暂存副本——「MUST NOT 产生第二个副本」因此在这一支也成立。
///
/// 顺序（与改名路径同一条纪律）：先在 rename / 删除**之前**扫描引用（design §5.1 的理由同样
/// 适用：暂存名一旦消失就不再可解析），逐篇 CAS 改写，最后删暂存副本。
///
/// 两条保守口径：
/// - **有笔记没改成（`skipped` 非空）就保留暂存副本**——那些引用仍指向暂存名，删掉就是断链。
///   副本多出来的那一份比静默断链便宜（与 design §5.4「失败不回滚改名、点名未更新数量」同侧）。
/// - 删除失败同样保留副本，只落一条诊断；引用已经改对，功能面没有损失。
///
/// 结果按 `renamed` 返回（引用确实换了名字、前端要做同一套对账），但**不带撤销令牌**：撤销
/// 只对称于「本任务把文件改了名」，而既有语义文件不是本任务改的——给它一个会把别人的名字改回
/// 暂存名的入口是错的（设计上「撤销 = 与改名对称的反向操作」）。
fn reuse_existing(
    root: &Path,
    policy: &IgnorePolicy,
    staging_path: &str,
    existing_path: &str,
    staging_name: &str,
    emit: &dyn Fn(&NamingEcho),
) -> NamingOutcome {
    let Some(existing_name) = existing_path.rsplit('/').next().map(str::to_string) else {
        return NamingOutcome::skipped(staging_path, CODE_OCCUPIED);
    };
    let (hits, unreadable) = scan_references(root, policy, staging_path, &existing_name);
    emit(&NamingEcho {
        from: staging_path.to_string(),
        to: existing_path.to_string(),
        notes: hits.iter().map(|hit| hit.path.clone()).collect(),
    });
    let (rewritten, mut skipped) = apply_hits(root, &hits);
    skipped.extend(unreadable);
    if skipped.is_empty() {
        // 删除直接走 std（不构造 CommandError）：这一步是收尾清理，失败只降级成诊断——
        // 造一个永远不会上屏、也没有 ERROR_COPY 条目的错误码等于加一条幽灵协议面。
        let removed = fs_io::resolve_in_vault(root, staging_path)
            .ok()
            .is_some_and(|abs| std::fs::remove_file(abs).is_ok());
        if !removed {
            // 引用都已改指，副本留着只是多一份同内容文件；落一条诊断即可。
            crate::logging::attachment_naming(staging_path, "duplicate_cleanup_failed");
        }
    } else {
        // 有引用没改成：保留暂存副本（断链比多一份副本糟）。
        crate::logging::attachment_naming(staging_path, "duplicate_cleanup_deferred");
    }
    NamingOutcome {
        status: NamingStatus::Renamed,
        old_path: Some(staging_path.to_string()),
        new_path: Some(existing_path.to_string()),
        old_name: Some(staging_name.to_string()),
        new_name: Some(existing_name),
        rewritten,
        skipped,
        undo_token: None,
        code: None,
    }
}

/// 目标路径 = 同目录 + 新文件名（不改目录，design §2）。
fn new_path_of(old_path: &str, new_name: &str) -> String {
    match old_path.rfind('/') {
        Some(index) => format!("{}{new_name}", &old_path[..=index]),
        None => new_name.to_string(),
    }
}

/// 读暂存名文件并校验「名字就是这次内容的暂存名」：返回 `(bytes, hash16)`。
/// 文件不在 / 读失败 / 名字不是 `pasted-<hash16>.<ext>`（已被人工改名或已是语义名）都返回 None。
fn read_staged(root: &Path, path: &str) -> Option<(Vec<u8>, String)> {
    let abs = fs_io::resolve_in_vault(root, path).ok()?;
    let bytes = std::fs::read(&abs).ok()?;
    let hash16 = fs_io::short_hash(&bytes);
    let name = path.rsplit('/').next()?;
    let extension = name.rsplit_once('.').map(|(_, ext)| ext)?;
    (name == fs_io::staging_name(&hash16, extension)).then_some((bytes, hash16))
}

// ---------------------------------------------------------------------------
// 编排：撤销（与改名对称）
// ---------------------------------------------------------------------------

/// 撤销一次改名（design §6）：以同一解析能力重新扫描（此时匹配新名）→ 逐篇改回 → 文件改回
/// 暂存名。服从与命名同一组放弃判据；放弃时返回结构化错误（撤销是用户显式动作，MUST NOT 静默）。
pub fn undo(
    state: &VaultState,
    token: &str,
    emit: &dyn Fn(&NamingEcho),
) -> Result<NamingOutcome, CommandError> {
    let record = take_undo(token).ok_or_else(|| {
        CommandError::new(
            "attachment_undo_unavailable",
            "撤销窗口已过：这次改名的撤销入口已失效",
        )
    })?;
    let (root, policy, vault_id) = state.root_policy_and_id().map_err(|_| {
        CommandError::new(
            "attachment_undo_stale",
            "当前 vault 已切换，无法撤销这次改名",
        )
    })?;
    if root != record.vault_root || vault_id != record.vault_id {
        return Err(CommandError::new(
            "attachment_undo_stale",
            "当前 vault 已切换，无法撤销这次改名",
        ));
    }
    let _guard = queue().acquire(&record.semantic_path);
    undo_with_record(&root, &policy, &record, emit)
}

/// [`undo`] 的注入形态（单测直接驱动）：跳过令牌登记表与 vault 身份核对，其余判据逐字相同。
fn undo_with_record(
    root: &Path,
    policy: &IgnorePolicy,
    record: &UndoRecord,
    emit: &dyn Fn(&NamingEcho),
) -> Result<NamingOutcome, CommandError> {
    // 撤销的放弃判据：文件仍在记录的新路径上、内容未变；暂存名未被别的文件占用。
    let Some((bytes, hash16)) = read_named(root, &record.semantic_path) else {
        return Err(CommandError::new(
            "attachment_undo_stale",
            "文件已被再次改名或移走，无法撤销",
        ));
    };
    if hash16 != record.hash16 {
        return Err(CommandError::new(
            "attachment_undo_stale",
            "文件内容已改变，无法撤销",
        ));
    }
    let staging_name = fs_io::staging_name(&hash16, &record.stage_extension);
    if fs_io::find_vault_entry_by_name(root, policy, &staging_name).is_some() {
        return Err(CommandError::new(
            "attachment_undo_occupied",
            format!("暂存名 {staging_name} 已被占用，无法撤销"),
        ));
    }
    let _ = bytes;
    let (hits, unreadable) = scan_references(root, policy, &record.semantic_path, &staging_name);
    emit(&NamingEcho {
        from: record.semantic_path.clone(),
        to: record.staging_path.clone(),
        notes: hits.iter().map(|hit| hit.path.clone()).collect(),
    });
    let renamed = fs_io::rename_entry(root, policy, &record.semantic_path, &staging_name).map_err(
        |error| {
            CommandError::new(
                "attachment_undo_stale",
                format!("撤销改名失败：{}", error.message),
            )
        },
    )?;
    let (rewritten, mut skipped) = apply_hits(root, &hits);
    skipped.extend(unreadable);
    Ok(NamingOutcome {
        status: NamingStatus::Renamed,
        old_path: Some(record.semantic_path.clone()),
        new_path: Some(renamed),
        old_name: Some(staging_name.clone()),
        new_name: Some(staging_name),
        rewritten,
        skipped,
        undo_token: None,
        code: None,
    })
}

/// 读指定路径并返回 `(bytes, hash16)`（撤销的放弃判据用）。
fn read_named(root: &Path, path: &str) -> Option<(Vec<u8>, String)> {
    let abs = fs_io::resolve_in_vault(root, path).ok()?;
    let bytes = std::fs::read(&abs).ok()?;
    let hash16 = fs_io::short_hash(&bytes);
    Some((bytes, hash16))
}

// ---------------------------------------------------------------------------
// 纯函数命令：dirty 文档的内存对账
// ---------------------------------------------------------------------------

/// 一段文本改写点的 IPC 形态：**UTF-16 code unit** 偏移（= JS 字符串下标）。
///
/// `link_graph` 内部的 span 是 code point（fixture 口径），本结构是它在 IPC 边界上的唯一
/// 一次换算——前端 MUST NOT 自己数一遍（那会是第二份换算实现）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TextChangePayload {
    pub from: u32,
    pub to: u32,
    pub insert: String,
}

/// 纯函数命令（design §5.3 / task 6.3）：给**内存文本**重算改写点，MUST NOT 碰磁盘。
///
/// 匹配口径 = 链接 target 的末段与 `from_rel` 的文件名相等（大小写折叠沿用解析器同一规则），
/// 替换成 `to_rel` 的文件名。dirty 文档（刚粘贴、引用还没落盘）的引用只存在于内存，磁盘扫描
/// 覆盖不到它们——这条是「最常见的那条路径不生效」的唯一解。
pub fn wikilink_retarget_text(text: &str, from_rel: &str, to_rel: &str) -> Vec<TextChangePayload> {
    let from_name = from_rel.rsplit('/').next().unwrap_or(from_rel);
    let to_name = to_rel.rsplit('/').next().unwrap_or(to_rel);
    let changes = link_graph::retarget_text(text, from_name, to_name);
    let to_utf16 = |char_offset: usize| -> u32 {
        text.chars()
            .take(char_offset)
            .map(|c| c.len_utf16())
            .sum::<usize>() as u32
    };
    changes
        .into_iter()
        .map(|change| TextChangePayload {
            from: to_utf16(change.from),
            to: to_utf16(change.to),
            insert: change.insert,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 配置读取
// ---------------------------------------------------------------------------

/// 粘贴时刻的配置快照（`attachment_semantic_name` / `undo` 的入口都走它）。
/// 读不到配置（配置目录不可解析等）按「关闭」处理：命名是可选增强，MUST NOT 让粘贴失败。
pub fn load_config() -> Result<config::ConfigSnapshot, CommandError> {
    config::load()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_folds_case_and_dashes() {
        assert_eq!(sanitize_slug("Harness Arch"), "harness-arch");
        assert_eq!(
            sanitize_slug("  harness__arch--overview  "),
            "harness-arch-overview"
        );
        assert_eq!(sanitize_slug("-harness-arch-"), "harness-arch");
        assert_eq!(sanitize_slug("Harness_Arch_2"), "harness-arch-2");
    }

    #[test]
    fn slug_strips_quotes_fences_and_extension() {
        assert_eq!(sanitize_slug("\"Harness Arch!\""), "harness-arch");
        assert_eq!(sanitize_slug("`harness-arch`"), "harness-arch");
        assert_eq!(sanitize_slug("```\nharness-arch\n```"), "harness-arch");
        assert_eq!(sanitize_slug("~~~\nHarness Arch.webp\n~~~"), "harness-arch");
        assert_eq!(sanitize_slug("harness-arch.webp"), "harness-arch");
        assert_eq!(sanitize_slug("harness-arch.JPEG"), "harness-arch");
        assert_eq!(
            sanitize_slug("  harness-arch  \nsecond line"),
            "harness-arch"
        );
    }

    #[test]
    fn slug_drops_non_ascii_without_transliteration() {
        assert_eq!(sanitize_slug("架构总览"), "");
        assert_eq!(sanitize_slug("harness 架构 arch"), "harness-arch");
        assert_eq!(sanitize_slug("🚀 diagram 🚀"), "diagram");
        assert_eq!(sanitize_slug("图-arch"), "arch");
        // 剔除处折成 `-`：中英混排不粘成一个词。
        assert_eq!(sanitize_slug("harness架构arch"), "harness-arch");
    }

    #[test]
    fn slug_enforces_length_limit() {
        let long = "a".repeat(120);
        let slug = sanitize_slug(&long);
        assert_eq!(slug.chars().count(), SLUG_MAX);
        // 截断落在连字符上时裁掉尾部连字符（39 个 a + `-b`，截到 40 位正好停在 `-`）。
        let dashed = format!("{}-b", "a".repeat(SLUG_MAX - 1));
        let slug = sanitize_slug(&dashed);
        assert_eq!(slug.chars().count(), SLUG_MAX - 1);
        assert!(!slug.ends_with('-'));
    }

    /// 资格判定的四档（design §4.2 / task 4.9）：有 vision / 无 vision / 关 / mock。
    ///
    /// 断言的是 [`run`] 里**实际执行的两步判据**（先 `enabled`，再
    /// [`HarnessConfig::attachment_naming_target`]），不另设封装函数——评审 r1 P2-1 判定过
    /// 一个只有测试调用的 `enabled()` 是假闸（REVIEW.md「值或开关声明了却没有消费者」条），
    /// 已删除；测试与 `run` 读同一组判据，也就没有第二处真源。
    #[test]
    fn naming_qualification_covers_four_tiers() {
        use crate::config::{self, HarnessConfig, HarnessModelSpec, ProviderPreset};
        let qualifies = |harness: &HarnessConfig| {
            harness.attachment_naming.enabled
                && harness
                    .attachment_naming_target(&harness.provider)
                    .is_some()
        };
        // 出厂 harness（空映射 = 没有 provider）：没有 vision 模型 ⇒ 命名不生效。
        let bare = HarnessConfig::default();
        assert!(!qualifies(&bare));
        // 有 provider 但没有 vision 模型 ⇒ 同样不生效。
        let mut vision = config::test_harness(
            "kimi",
            config::test_provider(ProviderPreset::Kimi, "sk", &[]),
        );
        assert!(!qualifies(&vision), "空模型清单 ⇒ 不发起");
        vision.providers.get_mut("kimi").unwrap().model = "k3-256k".to_string();
        vision.providers.get_mut("kimi").unwrap().models = vec![HarnessModelSpec {
            id: "k3-256k".to_string(),
            effort: false,
            vision: true,
            window: 262_144,
        }];
        assert!(qualifies(&vision), "有 vision");
        let mut off = vision.clone();
        off.attachment_naming.enabled = false;
        assert!(!qualifies(&off), "关");
        let mut bad_model = vision.clone();
        bad_model.attachment_naming.model = Some("not-declared".to_string());
        assert!(!qualifies(&bad_model), "指定了未声明的模型 ⇒ 不发起");
        let mut mock = config::test_mock(Some("/tmp/fixture.json"));
        assert!(qualifies(&mock), "mock 恒支持 vision");
        mock.attachment_naming.model = Some("anything".to_string());
        assert!(!qualifies(&mock), "mock 下 model 只能是 null");
    }

    #[test]
    fn material_clips_both_sides_toward_the_cursor() {
        let before: String = "前".repeat(CONTEXT_CHARS + 20) + "光标前";
        let after = "光标后".to_string() + &"后".repeat(CONTEXT_CHARS + 20);
        let material = naming_material(Some("notes/demo.md"), &before, &after);
        assert!(material.contains("笔记标题：demo"));
        assert!(material.contains("光标前"));
        assert!(material.contains("光标后"));
        assert!(!material.contains(&"前".repeat(CONTEXT_CHARS + 1)));
        assert_eq!(note_title(Some("notes/a.b.md")), "a.b");
        assert_eq!(note_title(None), "");
    }

    /// 把 UTF-16 偏移换算成字符下标（测试用：Rust 的字符串下标是字节，IPC 载荷是 UTF-16）。
    fn char_at_utf16(text: &str, offset: usize) -> usize {
        let mut units = 0usize;
        let mut index = 0usize;
        for ch in text.chars() {
            let next = units + ch.len_utf16();
            if next > offset {
                break;
            }
            units = next;
            index += 1;
        }
        index
    }

    #[test]
    fn retarget_text_offsets_are_utf16_on_ipc_boundary() {
        // 非 ASCII 前缀（中文 + emoji）验证 code point → UTF-16 的换算。
        let text = "标题 🚀 ![[notes/pasted-0123456789abcdef.webp|图]] 与 [[other]]";
        let changes = wikilink_retarget_text(
            text,
            "notes/pasted-0123456789abcdef.webp",
            "notes/harness-arch-012345.webp",
        );
        assert_eq!(changes.len(), 1);
        let change = &changes[0];
        let chars: Vec<char> = text.chars().collect();
        let head: String = chars[..char_at_utf16(text, change.from as usize)]
            .iter()
            .collect();
        let tail: String = chars[char_at_utf16(text, change.to as usize)..]
            .iter()
            .collect();
        assert_eq!(
            format!("{head}{}{tail}", change.insert),
            "标题 🚀 ![[notes/harness-arch-012345.webp|图]] 与 [[other]]"
        );
        // 区分度：UTF-16 偏移必须比 code point 偏移大（前面有中文与 emoji）——换算若退化成
        // 同一份计数，下面的断言会失败。
        let code_point_offset = char_at_utf16(text, change.from as usize);
        assert!((change.from as usize) > code_point_offset);
    }
}

#[cfg(test)]
mod orchestration_tests {
    use super::*;
    use crate::harness::events::StreamSink;
    use crate::harness::llm::{Request, TurnOutput};
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TempVault(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempVault {
        fn new() -> Self {
            let base = std::env::temp_dir();
            for _ in 0..16 {
                let path = base.join(format!(
                    "lumir-naming-test-{}-{}-{:016x}",
                    std::process::id(),
                    SEQ.fetch_add(1, Ordering::Relaxed),
                    rand::random::<u64>(),
                ));
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(err) => panic!("create temp vault {}: {err}", path.display()),
                }
            }
            panic!("create temp vault: 16 次随机目录名全部撞名");
        }

        fn policy(&self) -> IgnorePolicy {
            IgnorePolicy::load(&self.0, &[], &crate::config::VaultConfig::default().ignore)
        }

        fn write(&self, rel: &str, body: &[u8]) {
            let path = self.0.join(rel);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(path, body).unwrap();
        }

        fn read(&self, rel: &str) -> Vec<u8> {
            std::fs::read(self.0.join(rel)).unwrap()
        }

        fn names(&self) -> Vec<String> {
            let mut names: Vec<String> = fs_io::scan_vault_files(&self.0, &self.policy());
            names.sort();
            names
        }
    }

    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 固定回包的 client；`side_effect` 在「模型调用期间」执行（模拟异步缺口内的磁盘变化）。
    struct ScriptedClient {
        reply: String,
        error: Option<llm::TurnError>,
        side_effect: Option<Box<dyn FnMut() + Send>>,
        seen: Vec<Request>,
    }

    impl ScriptedClient {
        fn new(reply: &str) -> Self {
            Self {
                reply: reply.to_string(),
                error: None,
                side_effect: None,
                seen: Vec::new(),
            }
        }
    }

    impl LlmClient for ScriptedClient {
        fn complete(&mut self, request: &Request, _sink: &dyn StreamSink) -> TurnOutput {
            self.seen.push(Request {
                system: request.system.clone(),
                input: request.input.clone(),
                tools: request.tools.clone(),
                effort: request.effort,
            });
            if let Some(effect) = self.side_effect.as_mut() {
                effect();
            }
            TurnOutput {
                text: self.reply.clone(),
                error: self.error.clone(),
                ..Default::default()
            }
        }
    }

    /// 造一份「图片 + 三篇引用笔记」的现场，返回 (暂存路径, hash16)。
    fn stage_image(v: &TempVault) -> (String, String) {
        let bytes = b"fake-webp-bytes-for-naming".to_vec();
        let hash16 = fs_io::short_hash(&bytes);
        let name = fs_io::staging_name(&hash16, "webp");
        let path = format!("notes/{name}");
        v.write(&path, &bytes);
        v.write("notes/a.md", format!("# A\n\n![[{name}]]\n").as_bytes());
        (path, hash16)
    }

    fn request_for(path: &str) -> NamingRequest {
        NamingRequest {
            path: path.to_string(),
            note_path: Some("notes/a.md".to_string()),
            before: "光标前的段落".to_string(),
            after: "光标后的段落".to_string(),
        }
    }

    #[test]
    fn run_renames_file_rewrites_references_and_emits_echo() {
        let v = TempVault::new();
        let (path, hash16) = stage_image(&v);
        let staging_name = path.rsplit('/').next().unwrap().to_string();
        // 三篇引用形态：裸名 / 目录前缀 + 别名 / 大写 + 锚点；另加代码块内的同串（不碰）。
        v.write(
            "notes/a.md",
            format!("# A\n\n![[{staging_name}]]\n\n```\n![[{staging_name}]]\n```\n").as_bytes(),
        );
        v.write(
            "notes/b.md",
            format!("![[notes/{staging_name}|示意图]]\n").as_bytes(),
        );
        v.write(
            "notes/c.md",
            format!("![[{}#小节]]\n", staging_name.to_uppercase()).as_bytes(),
        );
        let original = v.read(&path);
        let mut client = ScriptedClient::new("Harness Arch");
        let echoes: std::cell::RefCell<Vec<NamingEcho>> = std::cell::RefCell::new(Vec::new());
        let policy = v.policy();
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&path),
            &mut client,
            &|echo| echoes.borrow_mut().push(echo.clone()),
        );
        let echoes = echoes.into_inner();

        let new_name = format!("harness-arch-{}.webp", &hash16[..6]);
        assert_eq!(outcome.status, NamingStatus::Renamed, "{outcome:?}");
        assert_eq!(
            outcome.new_path.as_deref(),
            Some(format!("notes/{new_name}").as_str())
        );
        assert_eq!(outcome.new_name.as_deref(), Some(new_name.as_str()));
        assert!(outcome.undo_token.is_some());
        // 盘上：暂存名没了、语义名在、内容逐字节不变。
        assert!(!v.0.join(&path).exists());
        assert_eq!(
            v.read(&format!("notes/{new_name}")),
            original,
            "改名不改字节"
        );
        // 引用：三篇都改成新名，代码块内的同串不动。
        assert_eq!(
            String::from_utf8(v.read("notes/a.md")).unwrap(),
            format!("# A\n\n![[{new_name}]]\n\n```\n![[{staging_name}]]\n```\n")
        );
        assert_eq!(
            String::from_utf8(v.read("notes/b.md")).unwrap(),
            format!("![[notes/{new_name}|示意图]]\n")
        );
        assert_eq!(
            String::from_utf8(v.read("notes/c.md")).unwrap(),
            format!("![[{new_name}#小节]]\n")
        );
        assert_eq!(outcome.rewritten.len(), 3);
        // 回声事件在写盘之前发出：from / to / 全部待改写笔记。
        assert_eq!(echoes.len(), 1);
        assert_eq!(echoes[0].from, path);
        assert_eq!(echoes[0].to, format!("notes/{new_name}"));
        let mut notes = echoes[0].notes.clone();
        notes.sort();
        assert_eq!(notes, vec!["notes/a.md", "notes/b.md", "notes/c.md"]);
        // 请求形态：单条 user 消息 = 上下文文本 + input_image（data URL）。
        let input = &client.seen[0].input;
        assert_eq!(input.len(), 1);
        let parts = input[0]["content"].as_array().unwrap();
        assert_eq!(parts[0]["type"], "input_text");
        assert!(parts[0]["text"].as_str().unwrap().contains("光标前的段落"));
        assert_eq!(parts[1]["type"], "input_image");
        assert!(parts[1]["image_url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/webp;base64,"));
    }

    #[test]
    fn run_abandons_when_content_changes_during_the_call() {
        let v = TempVault::new();
        let (path, _hash16) = stage_image(&v);
        let abs = v.0.join(&path);
        let mut client = ScriptedClient::new("Harness Arch");
        // 异步缺口内：文件被替换成另一张图。
        client.side_effect = Some(Box::new(move || {
            std::fs::write(&abs, b"another-image").unwrap();
        }));
        let policy = v.policy();
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&path),
            &mut client,
            &|_| {},
        );
        assert_eq!(outcome.status, NamingStatus::Skipped);
        assert_eq!(outcome.code.as_deref(), Some(CODE_FILE_CHANGED));
        assert!(
            v.0.join(&path).exists(),
            "文件保持原路径（不改名、不猜新位置）"
        );
        assert_eq!(
            v.names()
                .iter()
                .filter(|name| name.ends_with(".webp"))
                .count(),
            1,
            "没有产生任何语义名文件"
        );
    }

    #[test]
    fn run_abandons_when_file_renamed_during_the_call() {
        let v = TempVault::new();
        let (path, _hash16) = stage_image(&v);
        let from = v.0.join(&path);
        let to = v.0.join("notes/renamed-by-human.webp");
        let mut client = ScriptedClient::new("Harness Arch");
        client.side_effect = Some(Box::new(move || {
            std::fs::rename(&from, &to).unwrap();
        }));
        let policy = v.policy();
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&path),
            &mut client,
            &|_| {},
        );
        assert_eq!(outcome.status, NamingStatus::Skipped);
        assert_eq!(outcome.code.as_deref(), Some(CODE_FILE_CHANGED));
        assert!(
            v.0.join("notes/renamed-by-human.webp").exists(),
            "人的命名原样保留"
        );
    }

    #[test]
    fn run_skips_files_that_are_not_staging_names() {
        let v = TempVault::new();
        let bytes = b"fake-webp-bytes-for-naming".to_vec();
        let hash16 = fs_io::short_hash(&bytes);
        // 名字不是暂存名（已是语义名）。
        let path = "notes/harness-arch-012345.webp".to_string();
        v.write(&path, &bytes);
        let mut client = ScriptedClient::new("Harness Arch");
        let policy = v.policy();
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&path),
            &mut client,
            &|_| {},
        );
        assert_eq!(outcome.status, NamingStatus::Skipped);
        assert_eq!(outcome.code.as_deref(), Some(CODE_NOT_STAGING));
        assert!(client.seen.is_empty(), "不满足前置条件就不发请求");
        // 名字里的哈希与内容不符（被手工改过的文件）同样跳过。
        let lying = format!("notes/pasted-{}.webp", fs_io::short_hash(b"other-bytes"));
        v.write(&lying, &bytes);
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&lying),
            &mut client,
            &|_| {},
        );
        assert_eq!(outcome.code.as_deref(), Some(CODE_NOT_STAGING));
        let _ = hash16;
    }

    #[test]
    fn run_keeps_staging_name_when_slug_is_unusable_or_call_fails() {
        let v = TempVault::new();
        let (path, _hash) = stage_image(&v);
        let policy = v.policy();
        // 纯中文回包 ⇒ 规整后为空 ⇒ 失败，保留暂存名。
        let mut client = ScriptedClient::new("架构总览");
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&path),
            &mut client,
            &|_| {},
        );
        assert_eq!(outcome.code.as_deref(), Some(CODE_SLUG_EMPTY));
        assert!(v.0.join(&path).exists());
        // 调用失败（网络 / 非 2xx）：同样保留暂存名。
        let mut failing = ScriptedClient::new("");
        failing.error = Some(llm::TurnError::new("harness_network_failed", "boom", false));
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&path),
            &mut failing,
            &|_| {},
        );
        assert_eq!(outcome.code.as_deref(), Some(CODE_MODEL_FAILED));
        assert!(v.0.join(&path).exists());
    }

    #[test]
    fn run_extends_suffix_when_target_is_occupied_by_other_content() {
        let v = TempVault::new();
        let (path, hash16) = stage_image(&v);
        // 6 位档已被别的图片占用。
        v.write(
            &format!("notes/harness-arch-{}.webp", &hash16[..6]),
            b"other-image",
        );
        let mut client = ScriptedClient::new("Harness Arch");
        let policy = v.policy();
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&path),
            &mut client,
            &|_| {},
        );
        assert_eq!(
            outcome.new_name.as_deref(),
            Some(format!("harness-arch-{}.webp", &hash16[..8]).as_str())
        );
        assert_eq!(
            v.read(&format!("notes/harness-arch-{}.webp", &hash16[..6])),
            b"other-image".to_vec()
        );
    }

    #[test]
    fn reuses_existing_semantic_file_instead_of_keeping_a_duplicate() {
        let v = TempVault::new();
        let (staging_path, hash16) = stage_image(&v);
        let bytes = v.read(&staging_path);
        // 既有语义名文件（同一内容、另一个目录）：`harness-arch-<hash6>.webp`。
        let existing_name = format!("harness-arch-{}.webp", &hash16[..6]);
        let existing = format!("images/{existing_name}");
        v.write(&existing, &bytes);
        let staging_name = staging_path.rsplit('/').next().unwrap().to_string();
        // 笔记里已有一条指向暂存名的引用（正常路径里粘贴刚插入的那条）。
        v.write(
            "notes/a.md",
            format!("# A\n\n![[{staging_name}]]\n").as_bytes(),
        );
        let mut client = ScriptedClient::new("Harness Arch");
        let policy = v.policy();
        let echoes: std::cell::RefCell<Vec<NamingEcho>> = std::cell::RefCell::new(Vec::new());
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&staging_path),
            &mut client,
            &|echo| echoes.borrow_mut().push(echo.clone()),
        );
        // 复用既有位置：结果按 renamed 返回、没有撤销令牌（既有的名字不是本任务改的）。
        assert_eq!(outcome.status, NamingStatus::Renamed, "{outcome:?}");
        assert_eq!(outcome.new_path.as_deref(), Some(existing.as_str()));
        assert_eq!(outcome.new_name.as_deref(), Some(existing_name.as_str()));
        assert!(outcome.undo_token.is_none(), "复用不是改名，不提供撤销");
        // 引用改指既有文件；暂存副本被删掉（vault 里该内容只剩一份）。
        assert_eq!(
            String::from_utf8(v.read("notes/a.md")).unwrap(),
            format!("# A\n\n![[{existing_name}]]\n")
        );
        assert!(!v.0.join(&staging_path).exists(), "暂存副本已删除");
        assert_eq!(v.read(&existing), bytes, "既有文件逐字节不变");
        let echoes = echoes.into_inner();
        assert_eq!(echoes.len(), 1);
        assert_eq!(echoes[0].from, staging_path);
        assert_eq!(echoes[0].to, existing);
    }

    #[test]
    fn reuse_keeps_the_staging_copy_when_some_notes_cannot_be_rewritten() {
        let v = TempVault::new();
        let (staging_path, hash16) = stage_image(&v);
        let bytes = v.read(&staging_path);
        let existing = format!("images/harness-arch-{}.webp", &hash16[..6]);
        v.write(&existing, &bytes);
        // 一篇非 UTF-8 的 md（读取失败 ⇒ 扫描记 skipped）：引用可能在里面，副本不能删。
        v.write("notes/broken.md", &[0xff, 0xfe, 0x00]);
        let mut client = ScriptedClient::new("Harness Arch");
        let policy = v.policy();
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&staging_path),
            &mut client,
            &|_| {},
        );
        assert_eq!(outcome.status, NamingStatus::Renamed);
        assert!(
            !outcome.skipped.is_empty(),
            "读不出来的笔记要计数（{outcome:?}）"
        );
        assert!(
            v.0.join(&staging_path).exists(),
            "有未改写引用时保留暂存副本"
        );
        // 既有文件仍原样（没有覆盖）。
        assert_eq!(v.read(&existing), bytes);
    }

    #[test]
    fn undo_restores_staging_name_and_references() {
        let v = TempVault::new();
        let (path, hash16) = stage_image(&v);
        let staging_name = path.rsplit('/').next().unwrap().to_string();
        let mut client = ScriptedClient::new("Harness Arch");
        let policy = v.policy();
        let outcome = run_with_client(
            &v.0,
            &policy,
            "vault-test",
            &request_for(&path),
            &mut client,
            &|_| {},
        );
        let new_path = outcome.new_path.clone().unwrap();
        let record = UndoRecord {
            vault_root: v.0.clone(),
            vault_id: "vault-test".to_string(),
            staging_path: path.clone(),
            semantic_path: new_path.clone(),
            hash16,
            stage_extension: "webp".to_string(),
            expires: Instant::now() + UNDO_TTL,
        };
        let undone = undo_with_record(&v.0, &policy, &record, &|_| {}).expect("撤销成功");
        assert_eq!(undone.new_path.as_deref(), Some(path.as_str()));
        assert!(v.0.join(&path).exists());
        assert!(!v.0.join(&new_path).exists());
        assert_eq!(
            String::from_utf8(v.read("notes/a.md")).unwrap(),
            format!("# A\n\n![[{staging_name}]]\n")
        );
    }

    #[test]
    fn undo_refuses_when_staging_name_is_occupied_or_content_changed() {
        let v = TempVault::new();
        let (path, hash16) = stage_image(&v);
        let policy = v.policy();
        let semantic = format!("notes/harness-arch-{}.webp", &hash16[..6]);
        std::fs::rename(v.0.join(&path), v.0.join(&semantic)).unwrap();
        // 暂存名被别的文件占用 ⇒ 放弃撤销。
        v.write(&path, b"another-file");
        let record = UndoRecord {
            vault_root: v.0.clone(),
            vault_id: "vault-test".to_string(),
            staging_path: path.clone(),
            semantic_path: semantic.clone(),
            hash16: hash16.clone(),
            stage_extension: "webp".to_string(),
            expires: Instant::now() + UNDO_TTL,
        };
        let error = undo_with_record(&v.0, &policy, &record, &|_| {}).unwrap_err();
        assert_eq!(error.code, "attachment_undo_occupied");
        // 内容变了 ⇒ 放弃撤销（文件已再次被替换）。
        std::fs::remove_file(v.0.join(&path)).unwrap();
        std::fs::write(v.0.join(&semantic), b"replaced-content").unwrap();
        let error = undo_with_record(&v.0, &policy, &record, &|_| {}).unwrap_err();
        assert_eq!(error.code, "attachment_undo_stale");
    }
}
