//! 会话自动命名（change add-session-auto-naming，design D1–D13）。
//!
//! 目标只有一个：让历史列表里的每一行都能被认出来——首轮就有名字、话题转移后名字跟得上、
//! 名字又不会频繁跳动。本模块把四条机制收在一处：
//!
//! - **素材装配**（[`material`]）：当前标题 + 首轮问答 + 最近两轮问答，剔除注入节 / 工具调用与
//!   结果 / 图片 / 思考文本，按码点设上限。纯函数。
//! - **生成器契约**（[`parse_decision`]）：`keep` / `rename` 判定 + 规范化校验（1–20 码点、
//!   与当前标题不同），非法输出一律不换名。纯函数。
//! - **话题漂移信号**（[`DriftTracker`]）：零 token 的确定性词元重合启发式——它只决定「要不要
//!   早一点重估」，判断仍由生成器的 keep / rename 完成。纯函数。
//! - **调度状态机**（[`TitleSchedule`]）：首轮生成、5 轮周期、3 轮下限、漂移提前、失败后每
//!   3 轮重试、单飞行。纯内存。
//!
//! 调用与落盘在 [`run_job_with_client`]：一次便宜档辅助调用（无工具、Low 档、独立 20 秒超时），
//! 结果落盘前在会话锁内复核四条（同 vault / 同 session / 空闲 / `auto_title` 仍开）——任一不满足
//! 即丢弃。**命名调用是 wire 外调用**：不落 `llm_request` / `llm_response`（否则恢复的「最后一条
//! 会话请求」判据会指错请求），usage 不进任何会话读数出口。
//!
//! 与恢复正确性的关系（MUST NOT 省）：`session_title` 记录只许在**会话空闲**时追加——恢复路径
//! 依赖 `llm_request` 的紧邻下一条记录是 `llm_response`（折叠末尾响应），插进这对之间会丢末轮
//! 响应（design D9 / 不变量 7）。

use std::collections::HashSet;

use crate::config::{HarnessConfig, TitleTarget};

use super::events::{self, EventSink};
use super::jsonl::JsonlWriter;
use super::llm::{self, LlmClient};
use super::session;
use super::thinking::ThinkingEffort;
use super::{Runtime, VaultScope};

/// 生成器指令（单一处：`prompts/title.md`，`include_str!` 只有这一处引用）。
pub const TITLE_PROMPT: &str = include_str!("prompts/title.md");

/// 触发原因（落 `session_title.reason`）。
pub const REASON_FIRST_TURN: &str = "first-turn";
pub const REASON_CADENCE: &str = "cadence";
pub const REASON_DRIFT: &str = "drift";
pub const REASON_INHERIT: &str = "inherit";

/// 失败码（落 `session_title.code`，`decision=error` 时在场）。
pub const CODE_FAILED: &str = "harness_title_failed";
pub const CODE_INVALID: &str = "harness_title_invalid";

/// 素材上限（码点）：首轮每条、最近两轮每条、整份（design D2）。
const FIRST_TURN_ITEM_MAX: usize = 500;
const RECENT_TURN_ITEM_MAX: usize = 400;
const MATERIAL_MAX: usize = 3000;

/// 标题硬上限（码点，design D3）：与前端显示截断长度同值，故标题显示不带省略号。
const TITLE_MAX: usize = 20;

/// 任何两次评估之间的轮数下限（design D1）。
const EVAL_MIN_GAP: u32 = 3;
/// 周期重估间隔（design D1）。
const CADENCE_TURNS: u32 = 5;
/// 漂移判据：标题词元在消息中的重合比例低于它记一次命中（design D5）。
const DRIFT_CONTAINMENT: f64 = 0.20;
/// 标题词元少于此数不判漂移（太短的标题重合度没有统计意义）。
const DRIFT_MIN_TITLE_TOKENS: usize = 3;
/// 用户消息短于此码点数既不命中也不打断连续计数（「继续」这类短指令）。
const DRIFT_MIN_MESSAGE_CODEPOINTS: usize = 8;
/// 连续命中几次成立漂移信号。
const DRIFT_CONSECUTIVE_HITS: u32 = 2;

// ---------------------------------------------------------------------------
// 素材装配（design D2）
// ---------------------------------------------------------------------------

/// 一段话轮：一条用户消息 + 归属它的助手正文（工具循环里的多次往返合并成一段）。
struct TurnText {
    user: String,
    assistant: String,
}

/// 把会话 input 项切成话轮（只取 user / assistant 的正文 text part；工具调用与结果、图片、
/// reasoning、system 一律不进素材——design D2 的剔除面）。
fn conversation_turns(input: &[serde_json::Value]) -> Vec<TurnText> {
    let mut turns: Vec<TurnText> = Vec::new();
    for item in input {
        match item["role"].as_str() {
            Some("user") => {
                let text = item_text(item).unwrap_or_default();
                turns.push(TurnText {
                    user: clean_user_text(&text),
                    assistant: String::new(),
                });
            }
            Some("assistant") => {
                let Some(text) = item_text(item) else {
                    continue;
                };
                let text = collapse_whitespace(&text);
                if text.is_empty() {
                    continue;
                }
                // 首条消息就是 assistant（异常历史）：没有用户轮可归，丢弃——素材只描述用户
                // 带来的话题。
                if let Some(turn) = turns.last_mut() {
                    if !turn.assistant.is_empty() {
                        turn.assistant.push(' ');
                    }
                    turn.assistant.push_str(&text);
                }
            }
            _ => {}
        }
    }
    turns
}

/// 一条 wire 消息项的正文：content 数组里各 text part 拼接（`input_text` / `output_text`），
/// 图片 part 与其它非 text part 跳过；content 直接是字符串的旧形态照取。
fn item_text(item: &serde_json::Value) -> Option<String> {
    match &item["content"] {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(parts) => {
            let mut out = String::new();
            for part in parts {
                if let Some(text) = part["text"].as_str() {
                    out.push_str(text);
                }
            }
            (!out.is_empty()).then_some(out)
        }
        _ => None,
    }
}

/// 用户消息的素材形态：先剥自动注入的编辑器上下文节（形态真源在 `turn.rs`，不另写 marker
/// 字面量），再把空白折叠成单空格。
fn clean_user_text(text: &str) -> String {
    collapse_whitespace(super::turn::strip_context_section(text))
}

/// 空白折叠（换行 / 制表 / 连续空白 → 单空格，首尾去空白）。
fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 按码点截断并补「…」——上限是**含省略号**的总长（「每条 ≤ N 码点」是硬约束）。
fn truncate_codepoints(text: &str, max: usize) -> String {
    let count = text.chars().count();
    if count <= max {
        return text.to_string();
    }
    let keep = max.saturating_sub(1);
    format!("{}…", text.chars().take(keep).collect::<String>())
}

/// 命名素材（design D2）：当前标题 + 首轮问答 + 最近两轮问答，按顺序拼成一段纯文本。
///
/// 首轮与最近两轮重叠时去重（同一轮只出现一次）：会话只有一两轮时「最近两轮」只剩首轮之外
/// 的那部分。
pub fn material(input: &[serde_json::Value], current_title: Option<&str>) -> String {
    let turns = conversation_turns(input);
    let mut out = String::new();
    out.push_str("当前标题：");
    out.push_str(current_title.unwrap_or("（无）"));
    out.push('\n');

    if let Some(first) = turns.first() {
        out.push_str("\n首轮问答：\n");
        push_qa(&mut out, first, FIRST_TURN_ITEM_MAX);
    }
    let recent: Vec<&TurnText> = turns
        .iter()
        .skip(1)
        .rev()
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if !recent.is_empty() {
        out.push_str("\n最近两轮问答：\n");
        for turn in recent {
            push_qa(&mut out, turn, RECENT_TURN_ITEM_MAX);
        }
    }
    truncate_codepoints(&out, MATERIAL_MAX)
}

/// 一段问答的素材行（空正文不占行——工具轮的 assistant 可能为空）。
fn push_qa(out: &mut String, turn: &TurnText, max: usize) {
    if !turn.user.is_empty() {
        out.push_str("用户：");
        out.push_str(&truncate_codepoints(&turn.user, max));
        out.push('\n');
    }
    if !turn.assistant.is_empty() {
        out.push_str("助手：");
        out.push_str(&truncate_codepoints(&turn.assistant, max));
        out.push('\n');
    }
}

// ---------------------------------------------------------------------------
// 生成器契约：解析与规范化（design D3）
// ---------------------------------------------------------------------------

/// 一次解析的结论：keep / rename（已规范化）/ 非法（保持原名）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TitleEvaluation {
    Keep,
    Rename(String),
    Error { code: &'static str },
}

/// 解析生成器响应（design D3）：从第一个 `{` 到最后一个 `}` 取候选（容忍代码块 / 前后废话），
/// 再按契约判定。**无当前标题的初始生成里 `keep` 视为非法**——没有可保持的对象，否则会话永远
/// 拿不到名字、初始重试也不会启动（design D3 第 2 条）。
pub fn parse_decision(response: &str, current_title: Option<&str>) -> TitleEvaluation {
    let invalid = TitleEvaluation::Error { code: CODE_INVALID };
    let Some(start) = response.find('{') else {
        return invalid;
    };
    let Some(end) = response.rfind('}') else {
        return invalid;
    };
    if end <= start {
        return invalid;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&response[start..=end]) else {
        return invalid;
    };
    match value["decision"].as_str() {
        Some("keep") => {
            if current_title.is_none() {
                // 没有可保持的标题：按非法处理（走初始重试）。
                return invalid;
            }
            TitleEvaluation::Keep
        }
        Some("rename") => {
            let Some(raw) = value["title"].as_str() else {
                return invalid;
            };
            let title = normalize_title(raw);
            let count = title.chars().count();
            if count == 0 || count > TITLE_MAX {
                return invalid;
            }
            if let Some(current) = current_title {
                if normalize_title(current) == title {
                    return invalid;
                }
            }
            TitleEvaluation::Rename(title)
        }
        _ => invalid,
    }
}

/// 标题规范化（design D3）：trim → 换行 / 制表符折成单空格 → 连续空白折成一个 → 剥掉首尾
/// 成对的引号 / 反引号 / 书名号 → 剥句末标点。顺序是契约的一部分（先剥引号才能剥到被引号
/// 包住的句末标点）。
pub fn normalize_title(raw: &str) -> String {
    let mut text = collapse_whitespace(raw);
    loop {
        let trimmed = strip_surrounding_quotes(&text);
        if trimmed.len() == text.len() {
            break;
        }
        text = trimmed;
    }
    while let Some(rest) = text.strip_suffix(|c: char| is_trailing_punctuation(c)) {
        text = rest.to_string();
    }
    text.trim().to_string()
}

/// 首尾成对的包裹符号（`"` `'` `` ` `` `「」` `『』`）：两端同时在场才剥，只剥一层。
fn strip_surrounding_quotes(text: &str) -> String {
    const PAIRS: [(char, char); 5] = [
        ('"', '"'),
        ('\'', '\''),
        ('`', '`'),
        ('「', '」'),
        ('『', '』'),
    ];
    for (open, close) in PAIRS {
        if text.starts_with(open) && text.ends_with(close) {
            let inner: String = text.chars().skip(1).collect();
            let inner = inner.strip_suffix(close).unwrap_or(&inner).to_string();
            return inner;
        }
    }
    text.to_string()
}

/// 句末标点（标题里不保留：标题不是整句）。
fn is_trailing_punctuation(c: char) -> bool {
    matches!(c, '。' | '．' | '.' | '!' | '！' | '?' | '？')
}

// ---------------------------------------------------------------------------
// 话题漂移信号（design D5）：零 token 的确定性启发式
// ---------------------------------------------------------------------------

/// 连续命中的漂移观察器（design D5）：连续两次「重合度 < 阈值」成立信号，一次未命中清零；
/// 短消息（< 8 码点）既不命中也不清零。信号成立后计数归零（一次信号只触发一次重估）。
#[derive(Debug, Clone, Copy, Default)]
pub struct DriftTracker {
    consecutive_hits: u32,
}

impl DriftTracker {
    /// 观察一条用户消息。返回 true = 漂移信号成立（连续两次命中）。
    pub fn observe(&mut self, title: &str, message: &str) -> bool {
        if message.chars().count() < DRIFT_MIN_MESSAGE_CODEPOINTS {
            return false;
        }
        let title_tokens = tokens(title);
        if title_tokens.len() < DRIFT_MIN_TITLE_TOKENS {
            return false;
        }
        let message_tokens = tokens(message);
        let hits = title_tokens
            .iter()
            .filter(|token| message_tokens.contains(*token))
            .count();
        let containment = hits as f64 / title_tokens.len() as f64;
        if containment < DRIFT_CONTAINMENT {
            self.consecutive_hits += 1;
            if self.consecutive_hits >= DRIFT_CONSECUTIVE_HITS {
                self.consecutive_hits = 0;
                return true;
            }
        } else {
            self.consecutive_hits = 0;
        }
        false
    }

    /// 清零（轮换 / 会话重置）。
    pub fn reset(&mut self) {
        self.consecutive_hits = 0;
    }
}

/// 确定性词元化（design D5）：转小写 → 全角折半角 → CJK 连续片段取字符 bigram（单字取该字）
/// → ASCII 字母 / 数字连续片段取整词 → 丢停用词。
fn tokens(text: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut cjk: Vec<char> = Vec::new();
    let mut word = String::new();

    fn flush_cjk(run: &[char], out: &mut HashSet<String>) {
        if run.len() == 1 {
            let token = run[0].to_string();
            if !CJK_STOPWORDS.contains(&run[0]) {
                out.insert(token);
            }
            return;
        }
        for pair in run.windows(2) {
            if CJK_STOPWORDS.contains(&pair[0]) && CJK_STOPWORDS.contains(&pair[1]) {
                continue;
            }
            out.insert(pair.iter().collect());
        }
    }

    fn flush_word(word: &mut String, out: &mut HashSet<String>) {
        if word.is_empty() {
            return;
        }
        let lowered = word.to_ascii_lowercase();
        if !EN_STOPWORDS.contains(&lowered.as_str()) {
            out.insert(lowered);
        }
        word.clear();
    }

    for ch in text.chars() {
        let ch = fold_width(ch);
        if is_cjk(ch) {
            flush_word(&mut word, &mut out);
            cjk.push(ch);
        } else if ch.is_ascii_alphanumeric() {
            if !cjk.is_empty() {
                flush_cjk(&cjk, &mut out);
                cjk.clear();
            }
            word.push(ch);
        } else {
            if !cjk.is_empty() {
                flush_cjk(&cjk, &mut out);
                cjk.clear();
            }
            flush_word(&mut word, &mut out);
        }
    }
    if !cjk.is_empty() {
        flush_cjk(&cjk, &mut out);
    }
    flush_word(&mut word, &mut out);
    out
}

/// 全角 ASCII 折半角 + 表意空格折普通空格（design D5 的「NFKC 归一（全角转半角）」在本仓的
/// 最小实现：不引 unicode-normalization 依赖，覆盖全角标点 / 字母 / 数字与 U+3000 这两族）。
fn fold_width(ch: char) -> char {
    match ch {
        '\u{3000}' => ' ',
        '\u{FF01}'..='\u{FF5E}' => char::from_u32(ch as u32 - 0xFEE0).unwrap_or(ch),
        _ => ch,
    }
}

/// CJK 片段判据（Han 表意文字 + 日文假名）：这些字符的连续性有语义，按 bigram 切。
fn is_cjk(ch: char) -> bool {
    matches!(ch,
        '\u{3400}'..='\u{4DBF}'
        | '\u{4E00}'..='\u{9FFF}'
        | '\u{F900}'..='\u{FAFF}'
        | '\u{3040}'..='\u{30FF}')
}

/// 中文停用字（单字片段直接丢；bigram 两端都是停用字时丢——「的了」这类纯功能组合）。
const CJK_STOPWORDS: &[char] = &[
    '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '有', '和', '就', '不',
    '也', '都', '与', '及', '或', '而', '把', '被', '让', '给', '从', '到', '对', '为', '以', '于',
    '之', '其', '吗', '呢', '啊', '吧', '呀', '哦', '嗯', '请', '个', '要', '会', '能', '可',
];

/// 英文停用词（小写整词比较）。
const EN_STOPWORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do",
    "does", "for", "from", "had", "has", "have", "he", "her", "here", "him", "his", "how", "i",
    "if", "in", "is", "it", "its", "just", "me", "my", "no", "not", "of", "on", "or", "our", "she",
    "should", "so", "than", "that", "the", "their", "them", "then", "there", "they", "this", "to",
    "too", "us", "very", "was", "we", "were", "what", "when", "where", "which", "who", "why",
    "will", "with", "would", "yes", "you", "your",
];

// ---------------------------------------------------------------------------
// 调度状态机（design D1 / D4）
// ---------------------------------------------------------------------------

/// 触发点（落 `session_title.reason`，design D1 的四行触发表的三种非继承原因）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleTrigger {
    FirstTurn,
    Cadence,
    Drift,
}

impl TitleTrigger {
    pub fn reason(self) -> &'static str {
        match self {
            TitleTrigger::FirstTurn => REASON_FIRST_TURN,
            TitleTrigger::Cadence => REASON_CADENCE,
            TitleTrigger::Drift => REASON_DRIFT,
        }
    }
}

/// 调度状态机（design D1 / D4）：只统计**正常完成**的轮（面板收到 `done`），aborted / 错误收尾
/// 的轮由调用方不调用本状态机来排除。
///
/// 计数口径：`last_eval_turn` 在**触发时**落账（调用开始时），因此「失败也算一次评估」自然成立
/// ——失败后下一次触发按 3 轮 / 5 轮的自然节奏到来，不做立即重试。
#[derive(Debug, Clone, Copy, Default)]
pub struct TitleSchedule {
    /// 本逻辑会话正常完成的轮数。
    turns: u32,
    /// 最近一次评估的轮序（`None` = 本逻辑会话尚未评估；与轮换重置配合）。
    last_eval_turn: Option<u32>,
    /// 单飞行：同一逻辑会话同时最多一个命名调用在途。
    inflight: bool,
    drift: DriftTracker,
}

impl TitleSchedule {
    /// 已完成的轮数（测试与诊断读数）。
    pub fn turns(&self) -> u32 {
        self.turns
    }

    /// 是否有命名调用在途（测试与诊断读数）。
    pub fn inflight(&self) -> bool {
        self.inflight
    }

    /// 轮换重置（压缩 / 恢复开新逻辑会话）：轮数与评估计数归零、漂移计数清零。
    /// cadence 不从留存记录重建——记录不携带轮序号（design D6）。
    pub fn reset(&mut self) {
        self.turns = 0;
        self.last_eval_turn = None;
        self.inflight = false;
        self.drift.reset();
    }

    /// 一次正常完成的轮结束时的触发判定（纯内存）。`current_title` = 当前有效标题（决定走
    /// 「已有标题」的周期 / 漂移路径还是「尚无标题」的初始生成 / 重试路径）。
    ///
    /// 在途期间到达的触发点直接跳过（不排队，下一次触发点自然接上）。
    pub fn on_turn_completed(
        &mut self,
        enabled: bool,
        current_title: Option<&str>,
        user_message: &str,
    ) -> Option<TitleTrigger> {
        self.turns += 1;
        if !enabled || self.inflight {
            return None;
        }
        let last = self.last_eval_turn.unwrap_or(0);
        let gap = self.turns.saturating_sub(last);
        let trigger = match current_title {
            Some(title) => {
                let drift = self.drift.observe(title, user_message);
                if drift && gap >= EVAL_MIN_GAP {
                    TitleTrigger::Drift
                } else if gap >= CADENCE_TURNS {
                    TitleTrigger::Cadence
                } else {
                    return None;
                }
            }
            // 尚无有效标题：首个正常轮即生成；失败 / 尚未成功时每 3 轮重试一次（初始重试）。
            None => match self.last_eval_turn {
                None => TitleTrigger::FirstTurn,
                Some(_) if gap >= EVAL_MIN_GAP => TitleTrigger::FirstTurn,
                Some(_) => return None,
            },
        };
        self.inflight = true;
        self.last_eval_turn = Some(self.turns);
        Some(trigger)
    }

    /// 一次评估结束（成功 / 失败、落盘 / 丢弃都算）：释放单飞行位。
    pub fn finish(&mut self) {
        self.inflight = false;
    }
}

// ---------------------------------------------------------------------------
// 辅助调用（design D8 / D9）
// ---------------------------------------------------------------------------

/// 命名调用的请求（便宜档形态，design D8）：不带工具、素材是全部输入、思考档 `Low`。
/// 档位是否真的发出去由 client 按配置 schema 的 per-model `effort` 声明决定
/// （`thinking::apply_effort`：未声明就不发该字段）。
pub fn request(material: &str) -> llm::Request {
    llm::Request {
        system: TITLE_PROMPT.to_string(),
        input: vec![session::user_item(material)],
        tools: Vec::new(),
        effort: ThinkingEffort::Low,
    }
}

/// 一次命名调用 + 解析（锁外调用；`client` 由 [`llm::title_client`] 装配）。
pub fn evaluate(
    client: &mut dyn LlmClient,
    material: &str,
    current_title: Option<&str>,
) -> TitleEvaluation {
    let output = client.complete(&request(material), &llm::DiscardStreamSink);
    if let Some(error) = output.error {
        eprintln!(
            "lumir: 会话标题生成失败（{CODE_FAILED}）：{}",
            error.message
        );
        return TitleEvaluation::Error { code: CODE_FAILED };
    }
    let evaluation = parse_decision(&output.text, current_title);
    if let TitleEvaluation::Error { code } = &evaluation {
        eprintln!("lumir: 会话标题生成失败（{code}）：输出不符合契约");
    }
    evaluation
}

/// `session_title` 记录的载荷（design D6 的字段表）。**唯一写入口**——记录形状只在这里产出。
pub fn record_payload(
    decision: &str,
    reason: &str,
    title: Option<&str>,
    model: Option<&str>,
    code: Option<&str>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "kind": "session_title",
        "decision": decision,
        "reason": reason,
    });
    if let Some(title) = title {
        payload["title"] = serde_json::json!(title);
    }
    if let Some(model) = model.filter(|m| !m.is_empty()) {
        payload["model"] = serde_json::json!(model);
    }
    if let Some(code) = code {
        payload["code"] = serde_json::json!(code);
    }
    payload
}

/// 继承记录（压缩 / 恢复开新文件时写进新文件；不是评估产物，不带 `model`）。
pub fn inherit_payload(title: &str) -> serde_json::Value {
    record_payload("inherit", REASON_INHERIT, Some(title), None, None)
}

/// 轮完成点交给后台线程的一次命名任务：素材与配置快照都在触发时取定（design D9）。
pub struct TitleJob {
    pub trigger: TitleTrigger,
    /// 触发时的 vault 键（= `scope.key()`；落盘前复核「同一 vault」的显式判据）。
    pub vault_key: String,
    /// 触发时的逻辑会话 id（落盘前复核「同一逻辑会话」）。
    pub session_id: String,
    /// 素材（触发时在短会话锁内装配）。
    pub material: String,
    /// 触发时的有效标题（keep 记录携带它；无标题 = 初始生成）。
    pub current_title: Option<String>,
    /// 配置快照（`title_target` 五字段 + models 清单都在其中；中途改配置从下一次调用起生效）。
    pub config: HarnessConfig,
    /// 解析好的调用目标（唯一解析口 [`HarnessConfig::title_target`] 的产物）。
    pub target: TitleTarget,
    /// `auto_title` 快照（落盘前复核「仍为开」）。
    pub auto_title: bool,
    /// mock 标题队列的起点（会话级游标，见 `Session::title_cursor`）。
    pub mock_start: usize,
}

/// 一次轮完成后的触发判定 + 素材装配（在会话锁内调用，纯内存、不起线程）。
///
/// 返回 `Some(job)` 时调用方负责起后台线程；返回 `None` = 本轮不触发（关闭 / 未到期 / 在途）。
pub fn job_after_turn(
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    user_message: &str,
) -> Option<TitleJob> {
    runtime
        .with_session(scope, |session| {
            let session_id = JsonlWriter::session_id_from_path(session.jsonl().path())?;
            let trigger = {
                let current = session.title().map(str::to_string);
                session.title_schedule_mut().on_turn_completed(
                    config.auto_title,
                    current.as_deref(),
                    user_message,
                )?
            };
            let current_title = session.title().map(str::to_string);
            Some(TitleJob {
                trigger,
                vault_key: scope.key(),
                session_id,
                material: material(session.input(), current_title.as_deref()),
                current_title,
                config: config.clone(),
                target: config.title_target(config.provider),
                auto_title: config.auto_title,
                mock_start: session.title_cursor(),
            })
        })
        .ok()
        .flatten()
}

/// 落盘前复核的结论（design D9 的四条 + 记录动作）。
enum LandOutcome {
    /// 已落记录；`Some(title)` = 有效标题在场、需要发 `title` 事件（标题确实变了）。
    Landed { event_title: Option<String> },
    /// 丢弃（不落记录、不发事件）；载荷是丢弃原因（进 stderr）。
    Dropped(&'static str),
}

/// 执行一次命名任务（生产路径在后台线程上调用；单测直接驱动）。
///
/// 锁纪律（design D9）：HTTP 调用全程在锁外；结果落盘前重新取锁，复核「同 vault / 同 session /
/// 空闲 / `auto_title` 仍开」，任一不满足即丢弃——**空闲**这条是恢复正确性的前提（不变量 7）。
pub fn run_job_with_client(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    job: TitleJob,
    client: &mut dyn LlmClient,
) {
    let evaluation = evaluate(client, &job.material, job.current_title.as_deref());
    let consumed = client.mock_consumed();
    let script_len = client.mock_script_len();
    let outcome = runtime.with_session(scope, |session| {
        // mock 标题队列的会话级游标：弹一条推进一格（耗尽后保持「无脚本」态——不 wrap，
        // 缺失 / 弹尽 = 空正文 = invalid，design D12）。游标先推进：即使本次结果被丢弃，
        // 这次调用也确实消费了一条脚本。
        if let Some(len) = script_len {
            let next = job.mock_start.saturating_add(consumed);
            if next <= len {
                session.set_title_cursor(next);
            }
        }
        let session_id =
            JsonlWriter::session_id_from_path(session.jsonl().path()).unwrap_or_default();
        if job.vault_key != scope.key() {
            return LandOutcome::Dropped("vault 已切换");
        }
        if session_id != job.session_id {
            return LandOutcome::Dropped("会话已轮换");
        }
        if session.is_busy() {
            return LandOutcome::Dropped("会话正忙（避免插入请求/响应之间）");
        }
        if !job.auto_title {
            return LandOutcome::Dropped("自动命名已关闭");
        }
        let reason = job.trigger.reason();
        let model = Some(job.target.model.as_str());
        let (payload, next_title) = match &evaluation {
            TitleEvaluation::Rename(title) => {
                let decision = if job.current_title.is_some() {
                    "rename"
                } else {
                    "initial"
                };
                (
                    record_payload(decision, reason, Some(title), model, None),
                    Some(title.clone()),
                )
            }
            TitleEvaluation::Keep => match job.current_title.as_deref() {
                // keep 记录携带当时生效的标题（审计：为什么没改名）。
                Some(current) => (
                    record_payload("keep", reason, Some(current), model, None),
                    None,
                ),
                // 无标题的 keep 在解析层已判非法；这条兜底不落记录（防御形态）。
                None => return LandOutcome::Dropped("无标题的 keep"),
            },
            TitleEvaluation::Error { code } => (
                record_payload("error", reason, None, model, Some(code)),
                None,
            ),
        };
        session.jsonl().record(&payload);
        let mut event_title = None;
        if let Some(title) = next_title {
            if job.current_title.as_deref() != Some(title.as_str()) {
                event_title = Some(title.clone());
            }
            session.set_title(Some(title));
        }
        session.title_schedule_mut().finish();
        LandOutcome::Landed { event_title }
    });
    match outcome {
        Ok(LandOutcome::Landed { event_title }) => {
            if let Some(title) = event_title {
                sink.emit(events::title(&title));
            }
        }
        Ok(LandOutcome::Dropped(reason)) => {
            eprintln!("lumir: 会话标题结果被丢弃（{reason}）");
            // 会话仍在（只是忙 / 关开关）：释放单飞行位，让下一次触发点自然接上。
            let _ = runtime.with_session(scope, |session| {
                session.title_schedule_mut().finish();
            });
        }
        Err(_) => {
            // 会话已不存在（关 vault / 重置）：没有可释放的状态。
        }
    }
}

/// 生产入口：装配 client（mock 走独立 `titles` 队列；网络 provider 走 `title_target` 的
/// 五字段）后执行一次任务。client 装配失败按 `harness_title_failed` 静默收口（用户面零可见
/// 错误，design D10）。
pub fn run_job(sink: &dyn EventSink, runtime: &Runtime, scope: &VaultScope, job: TitleJob) {
    let mut client =
        match llm::title_client(&job.config, &job.target, &scope.vault_id, job.mock_start) {
            Ok(client) => client,
            Err(error) => {
                eprintln!(
                    "lumir: 会话标题生成失败（{CODE_FAILED}）：{}",
                    error.message
                );
                record_client_failure(runtime, scope, &job);
                return;
            }
        };
    run_job_with_client(sink, runtime, scope, job, client.as_mut());
}

/// client 装配失败（缺 api_key / 缺 fixture / 缺模型）的记录落点：与调用失败同口径——同样要
/// 过「空闲 / 同 session / 同 vault / 开关仍在」四道复核，同样失败静默。
fn record_client_failure(runtime: &Runtime, scope: &VaultScope, job: &TitleJob) {
    let _ = runtime.with_session(scope, |session| {
        let session_id =
            JsonlWriter::session_id_from_path(session.jsonl().path()).unwrap_or_default();
        if job.vault_key != scope.key()
            || session_id != job.session_id
            || session.is_busy()
            || !job.auto_title
        {
            session.title_schedule_mut().finish();
            return;
        }
        let payload = record_payload(
            "error",
            job.trigger.reason(),
            None,
            Some(job.target.model.as_str()),
            Some(CODE_FAILED),
        );
        session.jsonl().record(&payload);
        session.title_schedule_mut().finish();
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::HarnessProvider;
    use crate::fs_io::IgnorePolicy;
    use crate::harness::events::{EventSink, StreamSink};
    use crate::harness::llm::{MockClient, Request, TurnError, Usage};
    use crate::harness::turn;
    use crate::harness::{Runtime, VaultScope};
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    // ---- 测试脚手架 -------------------------------------------------------

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lumir-harness-title-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 复原 `XDG_CONFIG_HOME`（断言失败 panic 也要复原——与 turn.rs 测试同一守卫）。
    struct XdgGuard(Option<std::ffi::OsString>);

    impl Drop for XdgGuard {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
                None => std::env::remove_var("XDG_CONFIG_HOME"),
            }
        }
    }

    fn test_scope(root: &Path) -> VaultScope {
        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-title-1".to_string(),
        }
    }

    fn mock_config(fixture: Option<&Path>) -> HarnessConfig {
        let mut config = HarnessConfig {
            provider: HarnessProvider::Mock,
            ..HarnessConfig::default()
        };
        config.providers.mock.fixture = fixture.map(|p| p.display().to_string());
        config
    }

    fn write_fixture(root: &Path, titles: &[&str]) -> PathBuf {
        let path = root.join("fixture.json");
        let titles: Vec<serde_json::Value> = titles
            .iter()
            .map(|text| serde_json::json!({"text": text}))
            .collect();
        std::fs::write(&path, serde_json::json!({"titles": titles}).to_string()).unwrap();
        path
    }

    fn collect_sink() -> (Arc<Mutex<Vec<serde_json::Value>>>, impl EventSink) {
        struct Collect(Arc<Mutex<Vec<serde_json::Value>>>);
        impl EventSink for Collect {
            fn emit(&self, payload: serde_json::Value) {
                self.0.lock().unwrap().push(payload);
            }
        }
        let seen = Arc::new(Mutex::new(Vec::new()));
        (seen.clone(), Collect(seen))
    }

    #[derive(Debug, Clone, Default)]
    struct SeenRequest {
        system: String,
        input: Vec<serde_json::Value>,
        tools: usize,
        effort: ThinkingEffort,
    }

    /// 记录请求的 client（不发网络、不落盘）：断言调用形态（无工具 / Low 档 / 素材）用。
    struct RecordingClient {
        reply: String,
        usage: Option<Usage>,
        error: Option<TurnError>,
        seen: Vec<SeenRequest>,
    }

    impl RecordingClient {
        fn replying(reply: &str) -> Self {
            Self {
                reply: reply.to_string(),
                usage: None,
                error: None,
                seen: Vec::new(),
            }
        }
    }

    impl LlmClient for RecordingClient {
        fn complete(&mut self, request: &Request, _sink: &dyn StreamSink) -> llm::TurnOutput {
            self.seen.push(SeenRequest {
                system: request.system.clone(),
                input: request.input.clone(),
                tools: request.tools.len(),
                effort: request.effort,
            });
            llm::TurnOutput {
                text: self.reply.clone(),
                usage: self.usage,
                error: self.error.clone(),
                ..Default::default()
            }
        }
    }

    fn job_for(runtime: &Runtime, scope: &VaultScope, config: &HarnessConfig) -> TitleJob {
        let (session_id, material, current_title, mock_start) = runtime
            .with_session(scope, |session| {
                (
                    JsonlWriter::session_id_from_path(session.jsonl().path()).unwrap_or_default(),
                    material(session.input(), session.title()),
                    session.title().map(str::to_string),
                    session.title_cursor(),
                )
            })
            .unwrap();
        TitleJob {
            trigger: TitleTrigger::FirstTurn,
            vault_key: scope.key(),
            session_id,
            material,
            current_title,
            config: config.clone(),
            target: config.title_target(config.provider),
            auto_title: config.auto_title,
            mock_start,
        }
    }

    fn record_kinds(path: &Path) -> Vec<String> {
        crate::harness::jsonl::read_session_file(path)
            .map(|file| {
                file.records
                    .iter()
                    .filter_map(|r| r["kind"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn message(role: &str, text: &str) -> serde_json::Value {
        serde_json::json!({"role": role, "content": [{"type": if role == "user" { "input_text" } else { "output_text" }, "text": text}]})
    }

    // ---- 素材装配（design D2） -------------------------------------------

    /// 剥注入节 + 剔除工具调用 / 工具结果 / 图片 / 思考文本；用户与助手的正文都在。
    #[test]
    fn material_strips_context_and_tools() {
        let input = vec![
            message(
                "user",
                "这句什么意思？\n\n[当前编辑器上下文：\n文件：secret.md\n视口（第 1-3 行）]",
            ),
            serde_json::json!({"type": "function_call", "call_id": "c1", "name": "vault_read", "arguments": "{\"path\":\"secret.md\"}"}),
            serde_json::json!({"type": "function_call_output", "call_id": "c1", "output": "SECRET-TOOL-OUTPUT"}),
            serde_json::json!({"type": "reasoning", "content": [{"type": "reasoning_text", "text": "SECRET-THINKING"}]}),
            message("assistant", "这是答案。"),
            serde_json::json!({"role": "user", "content": [
                {"type": "input_text", "text": "看图"},
                {"type": "input_image", "image_url": "lumir-attachment://pasted-x.png"},
            ]}),
            message("assistant", "图里第二行有错。"),
        ];
        let out = material(&input, None);
        // 正观测：真正的问答正文在。
        assert!(out.contains("这句什么意思？"), "{out}");
        assert!(out.contains("这是答案。"), "{out}");
        assert!(out.contains("看图"), "{out}");
        assert!(out.contains("图里第二行有错。"), "{out}");
        // 剔除面：注入节头 / 注入的文件路径 / 工具参数与结果 / 思考文本 / 图片引用。
        for forbidden in [
            "当前编辑器上下文",
            "secret.md",
            "SECRET-TOOL-OUTPUT",
            "SECRET-THINKING",
            "lumir-attachment",
            "function_call",
        ] {
            assert!(!out.contains(forbidden), "素材泄漏 {forbidden}：{out}");
        }
        // 无标题的初始生成：当前标题行是「（无）」。
        assert!(out.contains("当前标题：（无）"), "{out}");
    }

    /// 首轮与最近两轮去重：同一轮只出现一次；会话少于三轮时「最近两轮」只剩首轮之外的部分。
    #[test]
    fn material_dedupes_first_and_recent() {
        let input = vec![
            message("user", "QONE 甲"),
            message("assistant", "AONE 乙"),
            message("user", "QTWO 丙"),
            message("assistant", "ATWO 丁"),
        ];
        let out = material(&input, Some("当前标题"));
        assert!(out.contains("当前标题：当前标题"), "{out}");
        assert_eq!(out.matches("QTWO").count(), 1, "{out}");
        assert_eq!(out.matches("QONE").count(), 1, "首轮只出现一次：{out}");
        // 第二个用户轮在「最近两轮问答」段里，第一个在「首轮问答」段里。
        let first = out.find("首轮问答：").unwrap();
        let recent = out.find("最近两轮问答：").unwrap();
        assert!(first < recent, "{out}");
        assert!(out[first..].contains("QONE"), "{out}");
        assert!(out[recent..].contains("QTWO"), "{out}");
        assert!(
            !out[recent..].contains("QONE"),
            "首轮不得在最近两轮里重复：{out}"
        );

        // 单个话轮：没有「最近两轮」段。
        let single = material(&[message("user", "只有一轮")], None);
        assert!(!single.contains("最近两轮问答"), "{single}");
    }

    /// 上限按**码点**算（CJK / emoji 各 1 字）：首轮每条 ≤500、最近两轮每条 ≤400、整份 ≤3000，
    /// 超长补「…」。
    #[test]
    fn material_limits_are_codepoints() {
        let long = "生".repeat(600);
        let out = material(&[message("user", &long), message("assistant", &long)], None);
        for line in out
            .lines()
            .filter(|line| line.starts_with("用户：") || line.starts_with("助手："))
        {
            let count = line.chars().count();
            assert!(count <= FIRST_TURN_ITEM_MAX + 3, "首轮每条超限：{count}");
            assert!(line.ends_with('…'), "超长未加省略号：{line}");
        }
        assert!(out.chars().count() <= MATERIAL_MAX, "整份素材超限");
        // 区分度（REVIEW.md「断言等价于子串」条）：按字节 / UTF-16 截断会得到不同长度（CJK 是
        // 3 字节 / 1 码点）——上面的 ≤500 断言只在按码点截断时成立。

        // 多轮长文本：逐项上限把自然总长压在 3000 以内（首轮 2×500 + 最近两轮 4×400 + 标题 /
        // 段头约 50）——整份上限是兜底护栏，这里断言语义不变量（永不越界）。
        let mut input = Vec::new();
        for index in 0..12 {
            input.push(message("user", &format!("第{index}轮{}", "长".repeat(400))));
            input.push(message("assistant", &"答".repeat(400)));
        }
        let out = material(&input, None);
        assert!(out.chars().count() <= MATERIAL_MAX, "整份素材超限：{out}");
        // 兜底护栏本身：超过 3000 码点的串按 3000 截断（含省略号）。
        let over = truncate_codepoints(&"尾".repeat(MATERIAL_MAX + 500), MATERIAL_MAX);
        assert_eq!(over.chars().count(), MATERIAL_MAX);
        assert!(over.ends_with('…'));
        // emoji 按码点计 1 字：600 个 emoji 不越界。
        let out = material(&[message("user", &"😀".repeat(600))], None);
        assert!(out.chars().count() <= MATERIAL_MAX);
    }

    // ---- 解析 / 规范化（design D3） --------------------------------------

    #[test]
    fn parse_keep_and_rename() {
        assert_eq!(
            parse_decision(r#"{"decision":"keep"}"#, Some("当前标题")),
            TitleEvaluation::Keep
        );
        assert_eq!(
            parse_decision(
                r#"{"decision":"rename","title":"Rust 生命周期排查"}"#,
                Some("旧标题")
            ),
            TitleEvaluation::Rename("Rust 生命周期排查".into())
        );
        // 初始生成（无当前标题）的 rename 正常通过。
        assert_eq!(
            parse_decision(r#"{"decision":"rename","title":"新标题"}"#, None),
            TitleEvaluation::Rename("新标题".into())
        );
    }

    /// 初始生成里没有可保持的标题：keep 视为非法（否则会话永远拿不到名字、重试路径也不会启动）。
    #[test]
    fn parse_keep_without_current_title_is_invalid() {
        assert_eq!(
            parse_decision(r#"{"decision":"keep"}"#, None),
            TitleEvaluation::Error { code: CODE_INVALID }
        );
    }

    /// 容忍代码块包裹与前后废话：取第一个 `{` 到最后一个 `}` 的子串。
    #[test]
    fn parse_tolerates_code_fence_and_chatter() {
        for raw in [
            "```json\n{\"decision\":\"rename\",\"title\":\"新标题\"}\n```",
            "好的，判定如下：\n{\"decision\":\"rename\",\"title\":\"新标题\"}\n以上。",
            "```\n{\"decision\":\"rename\",\"title\":\"新标题\"}\n```",
        ] {
            assert_eq!(
                parse_decision(raw, Some("旧标题")),
                TitleEvaluation::Rename("新标题".into()),
                "{raw}"
            );
        }
    }

    /// 非法输出一律 invalid：坏 JSON / 未知 decision / 缺 title / 空标题 / 超长 / 与当前相同。
    #[test]
    fn parse_rejects_invalid_shapes() {
        let invalid = TitleEvaluation::Error { code: CODE_INVALID };
        for raw in [
            "",
            "没有 JSON",
            "{not json}",
            r#"{"decision":"maybe"}"#,
            r#"{"decision":"rename"}"#,
            r#"{"decision":"rename","title":""}"#,
            r#"{"decision":"rename","title":"   "}"#,
            r#"{"decision":"rename","title":"一二三四五六七八九十一二三四五六七八九十一"}"#, // 21 码点
            r#"{"decision":"rename","title":"同一个名字"}"#,
        ] {
            let current = Some("同一个名字");
            assert_eq!(parse_decision(raw, current), invalid, "{raw}");
        }
        // 恰 20 码点通过（硬上限是含端点）。
        assert_eq!(
            parse_decision(
                r#"{"decision":"rename","title":"一二三四五六七八九十一二三四五六七八九十"}"#,
                None
            ),
            TitleEvaluation::Rename("一二三四五六七八九十一二三四五六七八九十".into())
        );
    }

    /// 规范化：剥包裹引号 / 反引号 / 书名号与句末标点，空白折叠。
    #[test]
    fn parse_normalizes_quotes_and_punctuation() {
        for raw in [
            r#"{"decision":"rename","title":"「Rust 排查。」"}"#,
            r#"{"decision":"rename","title":"\"Rust 排查。\""}"#,
            r#"{"decision":"rename","title":"`Rust 排查。`"}"#,
            r#"{"decision":"rename","title":"『Rust 排查。』"}"#,
        ] {
            assert_eq!(
                parse_decision(raw, None),
                TitleEvaluation::Rename("Rust 排查".into()),
                "{raw}"
            );
        }
        // 换行 / 制表 / 连续空白折成单空格。
        assert_eq!(
            parse_decision(
                r#"{"decision":"rename","title":"  Rust\n\t生命周期   排查  "}"#,
                None
            ),
            TitleEvaluation::Rename("Rust 生命周期 排查".into())
        );
        // 句末标点全族（含全角 / 半角）都剥；中间句号不动。
        assert_eq!(normalize_title("排查?"), "排查");
        assert_eq!(normalize_title("排查！！"), "排查");
        assert_eq!(normalize_title("Rust. 排查"), "Rust. 排查");
        // 只剥成对包裹：单侧引号不动。
        assert_eq!(normalize_title("\"标题"), "\"标题");
    }

    // ---- 漂移信号（design D5） -------------------------------------------

    #[test]
    fn drift_tokens_are_deterministic() {
        // CJK bigram + 单字；停用字不单独成词元。
        let cjk = tokens("生命周期");
        assert!(cjk.contains("生命") && cjk.contains("命周") && cjk.contains("周期"));
        assert_eq!(tokens("的").len(), 0, "单字停用词不产出词元");
        // ASCII 整词（小写）+ 全角折半角。
        let en = tokens("Rust LIFECYCLE and the Ｒｕｓｔ");
        assert!(en.contains("rust") && en.contains("lifecycle"));
        assert!(!en.contains("and") && !en.contains("the"));
        // 标点不产词元。
        assert!(tokens("，。！？").is_empty());
    }

    /// 连续两次低重合命中才成立；一次未命中清零；短消息既不命中也不清零。
    #[test]
    fn drift_requires_two_consecutive_hits() {
        let mut tracker = DriftTracker::default();
        let title = "alpha bravo charlie delta echo"; // 5 个词元（≥3）
        let unrelated = "zzzz qqqq wwww vvvv";
        assert!(!tracker.observe(title, unrelated), "单次命中不成立");
        assert!(tracker.observe(title, unrelated), "连续两次命中成立");
        // 成立后计数归零：下一轮单次命中不立刻再触发。
        assert!(!tracker.observe(title, unrelated), "信号成立后计数归零");
        // 一次未命中清零：命中 → 高重合消息（清零）→ 命中，不成立。
        assert!(
            !tracker.observe(title, "alpha bravo 相关话题内容"),
            "高重合不命中"
        );
        assert!(
            !tracker.observe(title, unrelated),
            "清零后重新计数（单次不成立）"
        );
        assert!(
            tracker.observe(title, unrelated),
            "清零后重新计数（两次成立）"
        );
    }

    /// 短消息（< 8 码点）既不命中也不打断连续计数：「继续」这类指令不该被读成话题漂移。
    #[test]
    fn drift_short_message_neither_hits_nor_resets() {
        let mut tracker = DriftTracker::default();
        let title = "alpha bravo charlie delta echo";
        let unrelated = "zzzz qqqq wwww vvvv";
        assert!(!tracker.observe(title, unrelated));
        assert!(!tracker.observe(title, "继续"), "短消息不计数");
        assert!(
            tracker.observe(title, unrelated),
            "短消息不清零：连续计数照旧"
        );
    }

    /// 标题词元不足 3 个不判漂移（重合度没有统计意义）。
    #[test]
    fn drift_needs_three_title_tokens() {
        let mut tracker = DriftTracker::default();
        let short_title = "Rust 排查"; // 2 个词元
        let unrelated = "zzzz qqqq wwww vvvv";
        assert!(!tracker.observe(short_title, unrelated));
        assert!(!tracker.observe(short_title, unrelated));
        // 区分度：同一个消息在标题词元足够的形态下会命中。
        let mut enough = DriftTracker::default();
        assert!(!enough.observe("Rust 排查 记录", unrelated));
        assert!(enough.observe("Rust 排查 记录", unrelated));
    }

    /// 阈值常量（0.20）：恰好等于阈值不算命中（判据是 `<`）；重合度更低才算。
    #[test]
    fn drift_threshold_constant() {
        assert!((DRIFT_CONTAINMENT - 0.20).abs() < 1e-9);
        let mut tracker = DriftTracker::default();
        let title = "alpha bravo charlie delta echo"; // 5 词元
                                                      // 命中 1/5 = 0.20：不记命中（两次都不成立）。
        let edge = "alpha unrelated zzzzzqqq";
        assert!(!tracker.observe(title, edge));
        assert!(!tracker.observe(title, edge), "0.20 不低于阈值");
        // 命中 0/5：成立。
        assert!(!tracker.observe(title, "zzzz qqqq wwww vvvv"));
        assert!(tracker.observe(title, "zzzz qqqq wwww vvvv"));
    }

    // ---- 调度状态机（design D1 / D4） ------------------------------------

    #[test]
    fn schedule_first_turn_triggers_initial() {
        let mut schedule = TitleSchedule::default();
        assert_eq!(
            schedule.on_turn_completed(true, None, "第一条提问内容"),
            Some(TitleTrigger::FirstTurn)
        );
        // 单飞行：在途期间的触发点直接跳过。
        assert_eq!(
            schedule.on_turn_completed(true, None, "第二条提问内容"),
            None
        );
        schedule.finish();
        // 间隔下限 3 轮：第 1 轮评估过后，第 2、3 轮不重试，第 4 轮（差 3）重试。
        assert_eq!(schedule.on_turn_completed(true, None, "第三"), None);
        assert_eq!(
            schedule.on_turn_completed(true, None, "第四"),
            Some(TitleTrigger::FirstTurn),
            "失败算一次评估：满 3 轮重试初始生成"
        );
    }

    #[test]
    fn schedule_initial_retry_after_failure() {
        let mut schedule = TitleSchedule::default();
        assert_eq!(
            schedule.on_turn_completed(true, None, "首轮提问"),
            Some(TitleTrigger::FirstTurn)
        );
        schedule.finish(); // 调用失败：仍然没有标题
        assert_eq!(schedule.on_turn_completed(true, None, "第2轮"), None);
        assert_eq!(schedule.on_turn_completed(true, None, "第3轮"), None);
        assert_eq!(
            schedule.on_turn_completed(true, None, "第4轮"),
            Some(TitleTrigger::FirstTurn)
        );
    }

    #[test]
    fn schedule_cadence_every_five_turns() {
        let mut schedule = TitleSchedule::default();
        let title = Some("当前标题");
        for turn in 1..=4 {
            assert_eq!(
                schedule.on_turn_completed(true, title, "无关消息内容"),
                None,
                "第 {turn} 轮不该触发"
            );
        }
        assert_eq!(
            schedule.on_turn_completed(true, title, "无关消息内容"),
            Some(TitleTrigger::Cadence)
        );
        schedule.finish();
        for turn in 6..=9 {
            assert_eq!(
                schedule.on_turn_completed(true, title, "无关消息内容"),
                None,
                "第 {turn} 轮不该触发"
            );
        }
        assert_eq!(
            schedule.on_turn_completed(true, title, "无关消息内容"),
            Some(TitleTrigger::Cadence)
        );
    }

    /// 漂移把重估提前到 3 轮之后——但压不到 3 轮以下（信号在更早的轮就成立时被丢弃）。
    #[test]
    fn schedule_drift_respects_min_gap() {
        let mut schedule = TitleSchedule::default();
        let title = Some("alpha bravo charlie delta echo");
        let unrelated = "zzzz qqqq wwww vvvv";
        assert_eq!(schedule.on_turn_completed(true, title, unrelated), None);
        assert_eq!(
            schedule.on_turn_completed(true, title, unrelated),
            None,
            "第 2 轮漂移信号成立，但间隔不足 3 轮"
        );
        assert_eq!(schedule.on_turn_completed(true, title, unrelated), None);
        assert_eq!(
            schedule.on_turn_completed(true, title, unrelated),
            Some(TitleTrigger::Drift),
            "第 4 轮：满 3 轮下限、漂移信号成立 → 提前重估"
        );
    }

    #[test]
    fn schedule_disabled_switch_skips_calls() {
        let mut schedule = TitleSchedule::default();
        for turn in 1..=10 {
            assert_eq!(
                schedule.on_turn_completed(false, None, "长提问内容"),
                None,
                "关闭后第 {turn} 轮不发起调用"
            );
        }
        assert_eq!(schedule.turns(), 10, "轮数照常统计（开关不影响计数口径）");
        // 重新打开：尚无标题 ⇒ 下一个满足条件的轮走初始生成。
        assert_eq!(
            schedule.on_turn_completed(true, None, "长提问内容"),
            Some(TitleTrigger::FirstTurn)
        );
    }

    #[test]
    fn schedule_rotation_resets_counts() {
        let mut schedule = TitleSchedule::default();
        let title = Some("当前标题");
        for _ in 1..=5 {
            schedule.on_turn_completed(true, title, "无关消息内容");
        }
        assert_eq!(schedule.turns(), 5);
        schedule.reset();
        assert_eq!(schedule.turns(), 0);
        assert!(!schedule.inflight());
        // 轮换后重新按 5 轮计周期（不从记录重建）。
        for turn in 1..=4 {
            assert_eq!(
                schedule.on_turn_completed(true, title, "无关消息内容"),
                None,
                "轮换后第 {turn} 轮"
            );
        }
        assert_eq!(
            schedule.on_turn_completed(true, title, "无关消息内容"),
            Some(TitleTrigger::Cadence)
        );
    }

    // ---- 辅助调用（design D8） -------------------------------------------

    /// 调用形态：无工具、思考档 Low、system 是命名指令、素材是唯一输入。
    #[test]
    fn call_shape_is_tool_free_and_low_effort() {
        let root = tmpdir("call-shape");
        // 先取进程级 XDG 锁、再改环境：drop 逆序释放 ⇒ XDG 复原发生在**仍持锁**时，
        // 不会与别的测试的 set_var 互相覆盖（见 `xdg_test_lock` 的说明）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = test_scope(&root);
        let config = mock_config(None);
        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        runtime.release_turn(&scope);

        let job = job_for(&runtime, &scope, &config);
        let (_seen, sink) = collect_sink();
        let mut client = RecordingClient::replying(r#"{"decision":"rename","title":"形态标题"}"#);
        run_job_with_client(&sink, &runtime, &scope, job, &mut client);
        assert_eq!(client.seen.len(), 1, "一次评估 = 一次调用");
        let seen = &client.seen[0];
        assert_eq!(seen.system, TITLE_PROMPT, "system = 命名指令（单一真源）");
        assert_eq!(seen.tools, 0, "命名调用不带工具");
        assert_eq!(seen.effort, ThinkingEffort::Low, "最低成本档");
        assert_eq!(seen.input.len(), 1);
        assert_eq!(seen.input[0]["role"], "user");
        assert!(
            seen.input[0]["content"][0]["text"]
                .as_str()
                .unwrap_or_default()
                .contains("当前标题："),
            "素材是唯一输入"
        );

        // prompt 常量的单一真源是 prompts/title.md（含 keep/rename 契约与标题规格）。
        assert!(TITLE_PROMPT.contains(r#"{"decision":"keep"}"#));
        assert!(TITLE_PROMPT.contains(r#"{"decision":"rename","title":"…"}"#));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 跨 provider：`title_provider = mock` 时会话 provider 是 kimi，命名调用仍走 mock 的
    /// `titles` 队列（不借用会话 provider 的 key / base_url）。
    #[test]
    fn call_targets_title_provider() {
        let root = tmpdir("target-provider");
        let fixture = write_fixture(
            &root,
            &[r#"{"decision":"rename","title":"来自 mock 的标题"}"#],
        );
        let mut config = HarnessConfig {
            provider: HarnessProvider::Kimi,
            title_provider: Some(HarnessProvider::Mock),
            ..HarnessConfig::default()
        };
        config.providers.kimi.api_key = "sk-session-provider".into();
        config.providers.kimi.model = "k3-256k".into();
        config.providers.mock.fixture = Some(fixture.display().to_string());

        let target = config.title_target(config.provider);
        assert_eq!(target.provider, HarnessProvider::Mock);
        let mut client = llm::title_client(&config, &target, "vault-title-1", 0).unwrap();
        assert_eq!(
            evaluate(client.as_mut(), "素材", None),
            TitleEvaluation::Rename("来自 mock 的标题".into())
        );

        // 网络 provider 跨条目：会话 provider 有 key，title provider 没 key ⇒ 报的是 title
        // provider 的缺失（不混用会话 provider 的 api_key）。
        let mut config = HarnessConfig {
            provider: HarnessProvider::Kimi,
            title_provider: Some(HarnessProvider::Deepseek),
            ..HarnessConfig::default()
        };
        config.providers.kimi.api_key = "sk-kimi".into();
        config.providers.kimi.model = "k3-256k".into();
        config.providers.deepseek.model = "deepseek-v4-pro".into();
        config.providers.deepseek.api_key = String::new();
        let target = config.title_target(config.provider);
        let error = match llm::title_client(&config, &target, "vault-title-1", 0) {
            Ok(_) => panic!("缺 api_key 时必须报错"),
            Err(error) => error,
        };
        assert_eq!(error.code, "harness_api_key_missing");
        assert_eq!(
            error.params.get("provider").map(String::as_str),
            Some("deepseek"),
            "缺 key 的必须是 title provider（不借用会话 provider 的 key）"
        );

        // mock 的 titles 队列独立于 responses：既有 responses 一条不动（每次调用弹一条）。
        let fixture = root.join("both.json");
        std::fs::write(
            &fixture,
            serde_json::json!({
                "responses": [{"text": "会话回答"}],
                "titles": [{"text": r#"{"decision":"keep"}"#}, {"text": "备用"}],
            })
            .to_string(),
        )
        .unwrap();
        let titles = MockClient::titles_from_file(&fixture).unwrap();
        assert_eq!(
            titles.mock_script_len(),
            Some(2),
            "标题队列长度 = titles 条数"
        );
        let conversation = MockClient::from_file(&fixture).unwrap();
        assert_eq!(
            conversation.mock_script_len(),
            Some(1),
            "会话队列长度 = responses 条数（不被 titles 影响）"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    // ---- 落盘：复核与丢弃（design D9） -----------------------------------

    /// 命名调用的 usage 不进会话读数，也不落 llm_request / llm_response（wire 外辅助调用）。
    #[test]
    fn call_usage_does_not_reach_session_readings() {
        let root = tmpdir("usage");
        // 先取进程级 XDG 锁、再改环境：drop 逆序释放 ⇒ XDG 复原发生在**仍持锁**时，
        // 不会与别的测试的 set_var 互相覆盖（见 `xdg_test_lock` 的说明）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = test_scope(&root);
        let config = mock_config(None);
        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        runtime.release_turn(&scope);

        let job = job_for(&runtime, &scope, &config);
        let (seen, sink) = collect_sink();
        let mut client = RecordingClient::replying(r#"{"decision":"rename","title":"新标题"}"#);
        client.usage = Some(Usage {
            input_tokens: 99_999,
            cached_tokens: 99_999,
            output_tokens: 99,
            cache_write_tokens: 99_999,
        });
        run_job_with_client(&sink, &runtime, &scope, job, &mut client);

        let (usage, path) = runtime
            .with_session(&scope, |session| {
                (session.usage(), session.jsonl().path().to_path_buf())
            })
            .unwrap();
        assert!(!usage.has_usage, "命名调用的 usage 不得进入会话读数");
        assert_eq!(usage.input_tokens, 0);
        let kinds = record_kinds(&path);
        assert!(kinds.contains(&"session_title".to_string()), "{kinds:?}");
        assert!(
            !kinds.contains(&"llm_request".to_string())
                && !kinds.contains(&"llm_response".to_string()),
            "命名调用 MUST NOT 落 wire 记录：{kinds:?}"
        );
        let events = seen.lock().unwrap();
        assert!(events.iter().any(|e| e["type"] == "title"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 会话在途（busy）时结果丢弃：不写记录、不改标题（避免插进请求 / 响应对之间）。
    #[test]
    fn result_is_dropped_while_busy() {
        let root = tmpdir("busy");
        // 先取进程级 XDG 锁、再改环境：drop 逆序释放 ⇒ XDG 复原发生在**仍持锁**时，
        // 不会与别的测试的 set_var 互相覆盖（见 `xdg_test_lock` 的说明）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = test_scope(&root);
        let config = mock_config(None);
        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap(); // 保持 busy

        let job = job_for(&runtime, &scope, &config);
        let (_seen, sink) = collect_sink();
        let mut client = RecordingClient::replying(r#"{"decision":"rename","title":"不该落盘"}"#);
        run_job_with_client(&sink, &runtime, &scope, job, &mut client);

        let (title, path) = runtime
            .with_session(&scope, |session| {
                (
                    session.title().map(str::to_string),
                    session.jsonl().path().to_path_buf(),
                )
            })
            .unwrap();
        assert_eq!(title, None, "忙态结果必须丢弃");
        assert!(
            !record_kinds(&path).contains(&"session_title".to_string()),
            "忙态不落标题记录"
        );

        // 空闲后同样的任务正常落盘（证明上面的失败是 busy 判据，不是链路坏掉）。
        runtime.release_turn(&scope);
        let job = job_for(&runtime, &scope, &config);
        let mut client = RecordingClient::replying(r#"{"decision":"rename","title":"落盘标题"}"#);
        run_job_with_client(&sink, &runtime, &scope, job, &mut client);
        let title = runtime
            .with_session(&scope, |s| s.title().map(str::to_string))
            .unwrap();
        assert_eq!(title.as_deref(), Some("落盘标题"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 标题记录只在会话空闲时追加（任务 3.1 的同一判据，正向 + 反向）。
    #[test]
    fn title_record_is_written_only_when_idle() {
        let root = tmpdir("idle");
        // 先取进程级 XDG 锁、再改环境：drop 逆序释放 ⇒ XDG 复原发生在**仍持锁**时，
        // 不会与别的测试的 set_var 互相覆盖（见 `xdg_test_lock` 的说明）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = test_scope(&root);
        let config = mock_config(None);
        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        let job = job_for(&runtime, &scope, &config);
        let (_seen, sink) = collect_sink();
        let mut client = RecordingClient::replying(r#"{"decision":"rename","title":"忙时不写"}"#);
        run_job_with_client(&sink, &runtime, &scope, job, &mut client);
        let path = runtime
            .with_session(&scope, |s| s.jsonl().path().to_path_buf())
            .unwrap();
        assert!(!path.exists(), "忙态连文件都不该被标题记录催生");

        runtime.release_turn(&scope);
        let job = job_for(&runtime, &scope, &config);
        let mut client = RecordingClient::replying(r#"{"decision":"rename","title":"空闲写入"}"#);
        run_job_with_client(&sink, &runtime, &scope, job, &mut client);
        let kinds = record_kinds(&path);
        assert_eq!(
            kinds,
            vec!["session_open".to_string(), "session_title".to_string()],
            "空闲时：首行 session_open + 一条 session_title"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 会话已轮换（新 session id）时丢弃：旧任务不得写进新会话文件。
    #[test]
    fn stale_result_is_dropped_after_rotate() {
        let root = tmpdir("stale");
        // 先取进程级 XDG 锁、再改环境：drop 逆序释放 ⇒ XDG 复原发生在**仍持锁**时，
        // 不会与别的测试的 set_var 互相覆盖（见 `xdg_test_lock` 的说明）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = test_scope(&root);
        let config = mock_config(None);
        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        runtime.release_turn(&scope);
        let job = job_for(&runtime, &scope, &config);

        // 模拟轮换：新会话（新 session id 替换槽位）。
        runtime.new_session(&scope).unwrap();
        runtime.acquire_turn(&scope, &config).unwrap();
        runtime.release_turn(&scope);

        let (_seen, sink) = collect_sink();
        let mut client = RecordingClient::replying(r#"{"decision":"rename","title":"旧任务"}"#);
        run_job_with_client(&sink, &runtime, &scope, job, &mut client);
        let (title, path) = runtime
            .with_session(&scope, |s| {
                (
                    s.title().map(str::to_string),
                    s.jsonl().path().to_path_buf(),
                )
            })
            .unwrap();
        assert_eq!(title, None, "轮换后的结果必须丢弃");
        assert!(!path.exists(), "旧任务不得催生新会话文件");
        let _ = std::fs::remove_dir_all(&root);
    }

    // ---- 轮换继承（design D7） -------------------------------------------

    /// 自动压缩开新文件：`session_open` 之后紧跟 `decision=inherit`，标题续用。
    #[test]
    fn compact_inherits_title() {
        let root = tmpdir("compact-inherit");
        // 先取进程级 XDG 锁、再改环境：drop 逆序释放 ⇒ XDG 复原发生在**仍持锁**时，
        // 不会与别的测试的 set_var 互相覆盖（见 `xdg_test_lock` 的说明）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = test_scope(&root);
        let mut config = mock_config(None);
        config.auto_compact = true;
        config.warn_ctx_pct = 1.0;
        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        runtime
            .with_session(&scope, |s| s.set_title(Some("生命周期排查".into())))
            .unwrap();
        // 第 1 条响应带高 usage（触发压缩），第 2 条是压缩摘要。
        let script = r#"{"responses":[
            {"text":"答。","usage":{"input_tokens":2000,"cached_tokens":0,"output_tokens":10}},
            {"text":"摘要正文"}
        ]}"#;
        let mut client = MockClient::from_str(script, "compact").unwrap();
        let (_seen, sink) = collect_sink();
        turn::run_turn_for(
            &sink,
            &runtime,
            &scope,
            &config,
            "提问内容",
            None,
            &mut client,
        );
        runtime.release_turn(&scope);

        let (title, path) = runtime
            .with_session(&scope, |s| {
                (
                    s.title().map(str::to_string),
                    s.jsonl().path().to_path_buf(),
                )
            })
            .unwrap();
        assert_eq!(title.as_deref(), Some("生命周期排查"), "压缩后标题续用");
        let kinds = record_kinds(&path);
        assert_eq!(
            kinds.get(1).map(String::as_str),
            Some("session_title"),
            "新文件 session_open 之后首条记录是 inherit：{kinds:?}"
        );
        let file = crate::harness::jsonl::read_session_file(&path).unwrap();
        assert_eq!(file.records[1]["decision"], "inherit");
        assert_eq!(file.records[1]["title"], "生命周期排查");
        assert!(
            file.records[1].get("model").is_none(),
            "inherit 没有发起调用，不带 model"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 从历史会话恢复：源有标题 ⇒ 新文件继承；源无标题 ⇒ 不写 inherit（回落口径自然成立）。
    #[test]
    fn resume_inherits_title() {
        let root = tmpdir("resume-inherit");
        // 先取进程级 XDG 锁、再改环境：drop 逆序释放 ⇒ XDG 复原发生在**仍持锁**时，
        // 不会与别的测试的 set_var 互相覆盖（见 `xdg_test_lock` 的说明）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = test_scope(&root);
        let config = mock_config(None);
        let runtime = Runtime::default();
        let dir = crate::harness::jsonl::vault_sessions_dir(&scope.vault_id).unwrap();

        let source_id = "s1759912345678-inh001";
        let open = serde_json::json!({
            "kind": "session_open", "session_id": source_id, "vault_root": scope.key(),
            "opened_from": "new", "provider": "mock", "model": "m", "thinking": "high",
            "system": "S", "assembly": [],
        });
        let lines = [
            serde_json::json!({"ts": 100, "payload": open}).to_string(),
            serde_json::json!({"ts": 101, "payload": {"kind": "llm_request", "request": {"system": "S", "messages": [message("user", "源提问")]}}}).to_string(),
            serde_json::json!({"ts": 102, "payload": {"kind": "llm_response", "text": "源回答"}}).to_string(),
            serde_json::json!({"ts": 103, "payload": record_payload("initial", REASON_FIRST_TURN, Some("源标题"), Some("m"), None)}).to_string(),
        ];
        std::fs::write(
            dir.join(format!("{source_id}.jsonl")),
            format!("{}\n", lines.join("\n")),
        )
        .unwrap();

        runtime.resume_session(&scope, &config, source_id).unwrap();
        let (title, path) = runtime
            .with_session(&scope, |s| {
                (
                    s.title().map(str::to_string),
                    s.jsonl().path().to_path_buf(),
                )
            })
            .unwrap();
        assert_eq!(title.as_deref(), Some("源标题"));
        let kinds = record_kinds(&path);
        assert_eq!(
            kinds.get(1).map(String::as_str),
            Some("session_title"),
            "{kinds:?}"
        );
        let file = crate::harness::jsonl::read_session_file(&path).unwrap();
        assert_eq!(file.records[1]["decision"], "inherit");
        assert_eq!(file.records[1]["title"], "源标题");

        // 源无标题记录：恢复不写 inherit（不伪造）。
        let legacy_id = "s1759912345678-inh002";
        let open = serde_json::json!({
            "kind": "session_open", "session_id": legacy_id, "vault_root": scope.key(),
            "opened_from": "new", "provider": "mock", "model": "m", "thinking": "high",
            "system": "S", "assembly": [],
        });
        let lines = [
            serde_json::json!({"ts": 200, "payload": open}).to_string(),
            serde_json::json!({"ts": 201, "payload": {"kind": "llm_request", "request": {"system": "S", "messages": [message("user", "旧提问")]}}}).to_string(),
        ];
        std::fs::write(
            dir.join(format!("{legacy_id}.jsonl")),
            format!("{}\n", lines.join("\n")),
        )
        .unwrap();
        runtime.resume_session(&scope, &config, legacy_id).unwrap();
        let (title, path) = runtime
            .with_session(&scope, |s| {
                (
                    s.title().map(str::to_string),
                    s.jsonl().path().to_path_buf(),
                )
            })
            .unwrap();
        assert_eq!(title, None, "源无标题 ⇒ 新会话无标题（回落首条用户消息）");
        assert!(!path.exists(), "无继承时不写文件（惰性落盘口径不变）");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 「新会话」是显式开始新对话：不继承标题。
    #[test]
    fn new_session_does_not_inherit_title() {
        let root = tmpdir("new-no-inherit");
        // 先取进程级 XDG 锁、再改环境：drop 逆序释放 ⇒ XDG 复原发生在**仍持锁**时，
        // 不会与别的测试的 set_var 互相覆盖（见 `xdg_test_lock` 的说明）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = test_scope(&root);
        let config = mock_config(None);
        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        runtime
            .with_session(&scope, |s| s.set_title(Some("旧会话标题".into())))
            .unwrap();
        runtime.release_turn(&scope);

        runtime.new_session(&scope).unwrap();
        runtime.acquire_turn(&scope, &config).unwrap();
        let title = runtime
            .with_session(&scope, |s| s.title().map(str::to_string))
            .unwrap();
        assert_eq!(title, None, "新会话不继承标题");
        let script = r#"{"responses":[{"text":"答。"}]}"#;
        let mut client = MockClient::from_str(script, "new-session").unwrap();
        let (_seen, sink) = collect_sink();
        turn::run_turn_for(
            &sink,
            &runtime,
            &scope,
            &config,
            "新提问",
            None,
            &mut client,
        );
        runtime.release_turn(&scope);
        let path = runtime
            .with_session(&scope, |s| s.jsonl().path().to_path_buf())
            .unwrap();
        assert!(
            !record_kinds(&path).contains(&"session_title".to_string()),
            "新会话文件里没有 inherit 记录"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
