//! link graph —— wikilink 语义的唯一解析实现（架构复查 P1-4，ADR 0003 §4）。
//!
//! 行为本体是冻结 spec [docs/specs/wikilink/link-semantics.md] v1.1（下称 spec）：
//! §2 词法分解、§3 名称→路径解析与标题锚点逐段下钻、§4.4 一键创建、§5 `![[...]]`
//! 双语义判别。前端只做 span 定位，语义一律经 invoke 查询本模块。
//! 机器可执行判定集：tests/wikilink-fixtures/cases.json（由 src-tauri/tests 全量断言）。
//!
//! 职责见 ADR 0002 §3：wikilink 正反链图在 Rust core 维护；架构约束见 ADR 0002 §7：
//! 图结构不耦合 UI 层。本模块不依赖 tauri 类型。
//!
//! span 偏移按 Unicode code point 计数（fixture spanUnit 口径），Rust 侧即 chars() 下标。

use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use ts_rs::TS;

use crate::commands::CommandError;

/// 一条 wikilink 的词法分解结果（spec §2）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WikiLink {
    /// 整条链接的范围 `[start, end)`，code point 偏移，含 `!` 前缀。
    pub span: (usize, usize),
    /// 是否 `![[...]]` embed 形态。
    pub embed: bool,
    /// target 的 path 段（去首尾空白，原文形态，不做大小写折叠）。
    pub path: String,
    /// heading path 各段（去空白、空段已剔除；块引用段保留 `^` 前缀原文）。
    pub heading_path: Vec<String>,
    /// 显示别名（第一个 `|` 之后的原文，可再含 `|`）；None = 无 `|`。
    pub alias: Option<String>,
    /// 含 `#^` 块引用段（spec §6：不支持，不做名称→目标解析）。
    pub block_ref: bool,
}

/// 解析三态 + 不支持（spec §3 与 §6）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum LinkStatus {
    Resolved,
    Ambiguous,
    Unresolved,
    Unsupported,
}

/// `![[...]]` 双语义判别结果（spec §5）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum EmbedTarget {
    Attachment,
    Note,
}

/// 锚点解析状态（spec §3.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum AnchorStatus {
    /// 链接不带 heading path。
    None,
    Found,
    Missing,
}

/// 锚点解析结果；`found` 时 `heading` 为落点标题文本、`line` 为其 1-based 行号。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AnchorInfo {
    pub status: AnchorStatus,
    /// found：落点标题文本；missing：请求的最后一段；none：null。
    pub heading: Option<String>,
    /// found 时落点标题的 1-based 行号（前端滚动定位用），其余为 null。
    #[ts(type = "number | null")]
    pub line: Option<u32>,
}

/// `link_graph_resolve` 的解析结果 payload。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct LinkResolveResult {
    pub status: LinkStatus,
    /// resolved / ambiguous（chosen）的目标路径，vault 根相对；其余为 null。
    pub path: Option<String>,
    /// ambiguous 时的全部候选（字典序）；其余为空数组。
    pub candidates: Vec<String>,
    /// 仅 embed 形态且解析到文件时有值（spec §5）。
    pub embed_target: Option<EmbedTarget>,
    pub anchor: AnchorInfo,
}

/// `wikilink_create` 成功 payload：新增文件的 vault 根相对路径。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct CreateNoteResult {
    pub created: String,
}

/// 反链条目：来源文件 + 行号 + 行级上下文（spec：反链面板只读派生视图）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BacklinkItem {
    /// 来源文件（vault 根相对路径）。
    pub source: String,
    /// 链接所在行的 1-based 行号。
    #[ts(type = "number")]
    pub line: u32,
    /// 链接所在行的原文（行级上下文）。
    pub context: String,
}

// ---------------------------------------------------------------------------
// §2 词法
// ---------------------------------------------------------------------------

/// frontmatter 扫描行数上限（与 src/preview/frontmatter.ts 同口径）。
const MAX_FRONTMATTER_LINES: usize = 200;

/// 识别并分解文本中的全部 wikilink（spec §2）。span 为 code point 偏移。
/// inline code / fenced code block / frontmatter 内部的 `[[...]]` 不识别；
/// 空 target、含嵌套方括号的序列不识别（§2.3 / §2.4）。
pub fn parse_links(text: &str) -> Vec<WikiLink> {
    let chars: Vec<char> = text.chars().collect();
    let excluded = excluded_ranges(&chars);
    let mut links = Vec::new();
    let mut i = 0;
    let mut xi = 0;
    while i < chars.len() {
        while xi < excluded.len() && i >= excluded[xi].1 {
            xi += 1;
        }
        if xi < excluded.len() && i >= excluded[xi].0 {
            i = excluded[xi].1;
            continue;
        }
        match chars[i] {
            // inline code：N 个反引号开启，恰好 N 个反引号闭合（GFM）；找不到闭合则按原文。
            '`' => {
                let run = run_len(&chars, i, '`');
                match find_closing_run(&chars, i + run, run) {
                    Some(end) => i = end,
                    None => i += run,
                }
            }
            '!' if chars.get(i + 1) == Some(&'[') && chars.get(i + 2) == Some(&'[') => {
                match scan_link(&chars, i, true) {
                    Ok((link, next)) => {
                        links.push(link);
                        i = next;
                    }
                    Err(next) => i = next,
                }
            }
            '[' if chars.get(i + 1) == Some(&'[') => {
                if i > 0 && chars[i - 1] == '!' {
                    // 紧邻的 `![[` 已由 '!' 分支处理（成功则跳过整条，失败则跳过 opener）。
                    i += 1;
                    continue;
                }
                match scan_link(&chars, i, false) {
                    Ok((link, next)) => {
                        links.push(link);
                        i = next;
                    }
                    Err(next) => i = next,
                }
            }
            _ => i += 1,
        }
    }
    links
}

/// 从 start 处（`!` 或首个 `[`）尝试识别一条链接；Err(下一扫描位) = 非法形态。
fn scan_link(chars: &[char], start: usize, embed: bool) -> Result<(WikiLink, usize), usize> {
    let open_len = if embed { 3 } else { 2 };
    let mut j = start + open_len;
    let close = loop {
        if j + 1 >= chars.len() {
            return Err(start + open_len);
        }
        match chars[j] {
            '[' | '\n' => return Err(start + open_len),
            ']' => {
                if chars[j + 1] == ']' {
                    break j;
                }
                return Err(start + open_len); // target 内含 ]（§2.4 不嵌套）
            }
            _ => j += 1,
        }
    };
    let inner: String = chars[start + open_len..close].iter().collect();
    // alias 由第一个 `|` 分隔，alias 内允许再出现 `|`（§2.1）。
    let (target_raw, alias) = match inner.find('|') {
        Some(p) => (&inner[..p], Some(inner[p + 1..].to_string())),
        None => (inner.as_str(), None),
    };
    let target = target_raw.trim();
    if target.is_empty() {
        return Err(start + open_len); // 空 target（§2.4）
    }
    let mut segs = target.split('#');
    let path = segs
        .next()
        .expect("split yields at least one")
        .trim()
        .to_string();
    let heading_path: Vec<String> = segs
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty()) // 空 heading 段忽略（§2.2）
        .collect();
    if path.is_empty() && heading_path.is_empty() {
        return Err(start + open_len); // 如 `[[#]]`：无任何目标
    }
    let block_ref = heading_path.iter().any(|s| s.starts_with('^'));
    Ok((
        WikiLink {
            span: (start, close + 2),
            embed,
            path,
            heading_path,
            alias,
            block_ref,
        },
        close + 2,
    ))
}

fn run_len(chars: &[char], from: usize, c: char) -> usize {
    chars[from..].iter().take_while(|&&x| x == c).count()
}

/// 从 from 起找长度恰好为 n 的反引号闭合串（GFM inline code 规则）。
fn find_closing_run(chars: &[char], from: usize, n: usize) -> Option<usize> {
    let mut k = from;
    while k < chars.len() {
        if chars[k] == '`' {
            let run = run_len(chars, k, '`');
            if run == n {
                return Some(k + n);
            }
            k += run;
        } else {
            k += 1;
        }
    }
    None
}

/// 不解析为链接的区块（§2.3）：frontmatter 与 fenced code block，返回 char 区间集。
fn excluded_ranges(chars: &[char]) -> Vec<(usize, usize)> {
    let mut lines: Vec<(usize, usize)> = Vec::new(); // (start, end 含 \n)
    let mut start = 0;
    for (i, &c) in chars.iter().enumerate() {
        if c == '\n' {
            lines.push((start, i + 1));
            start = i + 1;
        }
    }
    if start < chars.len() {
        lines.push((start, chars.len()));
    }
    let line_text = |idx: usize| -> String {
        let (s, e) = lines[idx];
        let t: String = chars[s..e].iter().collect();
        t.trim_end_matches(['\n', '\r']).to_string()
    };

    let mut ranges = Vec::new();
    let mut li = 0;
    // frontmatter：文件首部 --- 包围块（闭合 --- 或 ...，与 frontmatter.ts 同口径）。
    if !lines.is_empty() && line_text(0).trim() == "---" {
        let mut k = 1;
        while k < lines.len() && k <= MAX_FRONTMATTER_LINES {
            let t = line_text(k);
            if t.trim() == "---" || t.trim() == "..." {
                ranges.push((0, lines[k].1));
                li = k + 1;
                break;
            }
            k += 1;
        }
    }
    // fenced code block：行首 3+ 个相同 ` 或 ~ 开启，同样字符、长度 >= 开启串的纯围栏行闭合。
    let mut fence: Option<(char, usize)> = None;
    while li < lines.len() {
        let (s, e) = lines[li];
        let text = line_text(li);
        match fence {
            None => {
                let trimmed = text.trim_start();
                if let Some(fc @ ('`' | '~')) = trimmed.chars().next() {
                    let run = trimmed.chars().take_while(|&c| c == fc).count();
                    if run >= 3 {
                        fence = Some((fc, run));
                        ranges.push((s, e));
                    }
                }
            }
            Some((fc, n)) => {
                ranges.push((s, e));
                let t = text.trim();
                if !t.is_empty() && t.chars().all(|c| c == fc) && t.chars().count() >= n {
                    fence = None;
                }
            }
        }
        li += 1;
    }
    ranges
}

// ---------------------------------------------------------------------------
// §3.3 标题树
// ---------------------------------------------------------------------------

/// ATX 标题（文本 = 去掉 `#` 前缀与可选闭合 `#` 串后的内容；行号 1-based）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub line: u32,
}

/// 提取文档标题树（frontmatter / fenced code 内的 `#` 行不是标题）。
pub fn extract_headings(text: &str) -> Vec<Heading> {
    let chars: Vec<char> = text.chars().collect();
    let excluded = excluded_ranges(&chars);
    let mut headings = Vec::new();
    let mut start = 0;
    let mut line_no = 0u32;
    let mut xi = 0;
    while start <= chars.len() {
        line_no += 1;
        let end = chars[start..]
            .iter()
            .position(|&c| c == '\n')
            .map(|p| start + p)
            .unwrap_or(chars.len());
        while xi < excluded.len() && start >= excluded[xi].1 {
            xi += 1;
        }
        let in_excluded = xi < excluded.len() && start >= excluded[xi].0;
        if !in_excluded && start < end {
            let line: String = chars[start..end].iter().collect();
            if let Some(h) = parse_atx(&line, line_no) {
                headings.push(h);
            }
        }
        if end >= chars.len() {
            break;
        }
        start = end + 1;
    }
    headings
}

fn parse_atx(line: &str, line_no: u32) -> Option<Heading> {
    let t = line.trim_start();
    let level = t.chars().take_while(|&c| c == '#').count();
    if level == 0 || level > 6 {
        return None;
    }
    let rest = &t[level..];
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let mut content = rest.trim();
    // 闭合 `#` 串：以空白开头、纯 # 结尾的尾部序列（CommonMark 口径）。
    let trailing = content.chars().rev().take_while(|&c| c == '#').count();
    if trailing > 0 {
        let before = &content[..content.len() - trailing];
        if before.is_empty() || before.ends_with(char::is_whitespace) {
            content = before.trim();
        }
    }
    Some(Heading {
        level: level as u8,
        text: content.to_string(),
        line: line_no,
    })
}

/// heading path 逐段下钻（§3.3）：段文本精确匹配（裁决点 H：大小写敏感），
/// 与层级无关；多级时后段在前段子树内（层级更深、遇同级或更浅标题即止）查找。
fn drill<'a>(headings: &'a [Heading], segs: &[String]) -> Option<&'a Heading> {
    let mut idx = 0;
    let mut current: Option<&Heading> = None;
    for seg in segs {
        let parent_level = current.map(|h| h.level).unwrap_or(0);
        let mut found = None;
        let mut k = idx;
        while k < headings.len() {
            let h = &headings[k];
            if current.is_some() && h.level <= parent_level {
                break;
            }
            if h.text == *seg {
                found = Some(h);
                idx = k + 1;
                break;
            }
            k += 1;
        }
        current = Some(found?);
    }
    current
}

// ---------------------------------------------------------------------------
// 图：索引、解析（§3、§5）、反链、一键创建（§4.4）
// ---------------------------------------------------------------------------

/// 文档派生信息：标题树 + 文档内链接（带行号与行级上下文）。
struct DocInfo {
    headings: Vec<Heading>,
    links: Vec<DocLink>,
}

struct DocLink {
    link: WikiLink,
    line: u32,
    context: String,
}

fn index_doc(content: &str) -> DocInfo {
    let chars: Vec<char> = content.chars().collect();
    // 行起点（char 下标），供 span → 行号二分。
    let mut line_starts = vec![0usize];
    for (i, &c) in chars.iter().enumerate() {
        if c == '\n' {
            line_starts.push(i + 1);
        }
    }
    let line_of = |pos: usize| -> u32 { (line_starts.partition_point(|&s| s <= pos)) as u32 };
    let links = parse_links(content)
        .into_iter()
        .map(|link| {
            let no = line_of(link.span.0);
            let s = line_starts[(no - 1) as usize];
            let e = chars[s..]
                .iter()
                .position(|&c| c == '\n')
                .map(|p| s + p)
                .unwrap_or(chars.len());
            DocLink {
                link,
                line: no,
                context: chars[s..e].iter().collect(),
            }
        })
        .collect();
    DocInfo {
        headings: extract_headings(content),
        links,
    }
}

/// 是否 Markdown 笔记（大小写不敏感）。
pub fn is_markdown(path: &str) -> bool {
    path.to_lowercase().ends_with(".md")
}

/// 笔记链接图：vault 内全部文件路径 + `.md` 文档派生信息。
/// 解析全程只读（spec §3）；唯一写入动作是 [`LinkGraph::create_note`]（§4.4）。
pub struct LinkGraph {
    /// 全部非目录文件（vault 根相对，`/` 分隔），有序保证确定性。
    files: BTreeSet<String>,
    /// `.md` 文件的派生信息。
    docs: HashMap<String, DocInfo>,
}

impl LinkGraph {
    pub fn new() -> Self {
        Self {
            files: BTreeSet::new(),
            docs: HashMap::new(),
        }
    }

    /// 建立/增量更新一个文件条目。`.md` 且给了内容则重建派生信息；
    /// `.md` 无内容（读取失败）则丢弃旧派生信息（宁缺毋滥）。
    pub fn upsert(&mut self, path: &str, content: Option<&str>) {
        self.files.insert(path.to_string());
        if is_markdown(path) {
            match content {
                Some(c) => {
                    self.docs.insert(path.to_string(), index_doc(c));
                }
                None => {
                    self.docs.remove(path);
                }
            }
        }
    }

    /// 移除文件；若 path 是目录前缀则连同子孙一起移除（与 watch 级联删除同口径）。
    pub fn remove(&mut self, path: &str) {
        self.files.remove(path);
        self.docs.remove(path);
        let prefix = format!("{path}/");
        self.files.retain(|f| !f.starts_with(&prefix));
        self.docs.retain(|f, _| !f.starts_with(&prefix));
    }

    /// 解析一条已词法分解的链接（spec §3 / §5）。
    pub fn resolve(&self, from: &str, link: &WikiLink) -> LinkResolveResult {
        if link.block_ref {
            return LinkResolveResult {
                status: LinkStatus::Unsupported,
                path: None,
                candidates: Vec::new(),
                embed_target: None,
                anchor: anchor_none(),
            };
        }
        let path_seg = link.path.trim();
        // §3.4：path 段为空 → 当前文件本身。
        if path_seg.is_empty() {
            return LinkResolveResult {
                status: LinkStatus::Resolved,
                path: Some(from.to_string()),
                candidates: Vec::new(),
                embed_target: link.embed.then(|| embed_target_of(from)),
                anchor: self.anchor_for(from, &link.heading_path),
            };
        }
        // §3.2：不支持 .. 与 ./，直接判 unresolved。
        if path_seg.split('/').any(|s| s == ".." || s == ".") {
            return unresolved_result();
        }
        let candidates = self.match_candidates(path_seg, link.embed);
        let (status, path) = match candidates.len() {
            0 => return unresolved_result(),
            1 => (LinkStatus::Resolved, candidates[0].clone()),
            // 裁决点 G：段数最少优先，并列取字典序第一。
            _ => (
                LinkStatus::Ambiguous,
                candidates
                    .iter()
                    .min_by_key(|c| (c.matches('/').count(), (*c).clone()))
                    .expect("non-empty")
                    .clone(),
            ),
        };
        LinkResolveResult {
            status,
            path: Some(path.clone()),
            candidates: if status == LinkStatus::Ambiguous {
                candidates
            } else {
                Vec::new()
            },
            embed_target: link.embed.then(|| embed_target_of(&path)),
            anchor: self.anchor_for(&path, &link.heading_path),
        }
    }

    /// 解析链接原文（command 入口）：恰好一条完整链接才合法。
    pub fn resolve_link(&self, from: &str, raw: &str) -> Result<LinkResolveResult, CommandError> {
        let link = parse_single(raw)?;
        Ok(self.resolve(from, &link))
    }

    /// §3.2 候选集构造：根相对精确路径 → 短路径（完整文件名 → 去扩展名）→ 路径后缀。
    /// 大小写不敏感（§3.1），精确大小写匹配者优先于折叠匹配者。
    fn match_candidates(&self, path_seg: &str, embed: bool) -> Vec<String> {
        let lower = path_seg.to_lowercase();
        let md_suffixed = lower.ends_with(".md");
        let universe: Vec<&String> = self
            .files
            .iter()
            .filter(|f| embed || is_markdown(f))
            .collect();
        let mut exact: Vec<String> = Vec::new();
        let mut folded: Vec<String> = Vec::new();

        if path_seg.contains('/') {
            // 第 1 步：根相对精确路径（path 自带 .md 后缀时不重复拼接）。
            collect_matches(
                &universe,
                &mut exact,
                &mut folded,
                &|f| f == path_seg || (!md_suffixed && f == format!("{path_seg}.md")),
                &|f| {
                    let fl = f.to_lowercase();
                    fl == lower || (!md_suffixed && fl == format!("{lower}.md"))
                },
            );
            if exact.is_empty() && folded.is_empty() {
                // 第 3 步：路径后缀匹配，候选集构造与判定同第 2 步。
                let suf = format!("/{path_seg}");
                let suf_l = format!("/{lower}");
                collect_matches(
                    &universe,
                    &mut exact,
                    &mut folded,
                    &|f| f.ends_with(&suf) || (!md_suffixed && f.ends_with(&format!("{suf}.md"))),
                    &|f| {
                        let fl = f.to_lowercase();
                        fl.ends_with(&suf_l)
                            || (!md_suffixed && fl.ends_with(&format!("{suf_l}.md")))
                    },
                );
            }
        } else {
            // 子步 a：完整文件名匹配（仅当 path 段含扩展名）。
            if path_seg.contains('.') {
                collect_matches(
                    &universe,
                    &mut exact,
                    &mut folded,
                    &|f| file_name(f) == path_seg,
                    &|f| file_name(f).to_lowercase() == lower,
                );
            }
            if exact.is_empty() && folded.is_empty() {
                // 子步 b：去扩展名匹配，仅 .md 文件（§5：附件按完整文件名，不走本子步）。
                for f in self.files.iter().filter(|f| is_markdown(f)) {
                    let name = file_name(f);
                    let stem = name
                        .rsplit_once('.')
                        .filter(|(s, _)| !s.is_empty())
                        .map(|(s, _)| s)
                        .unwrap_or(name);
                    if stem == path_seg {
                        exact.push(f.clone());
                    } else if stem.to_lowercase() == lower {
                        folded.push(f.clone());
                    }
                }
            }
        }
        // §3.1：精确大小写匹配者优先。
        if exact.is_empty() {
            folded
        } else {
            exact
        }
    }

    fn anchor_for(&self, path: &str, heading_path: &[String]) -> AnchorInfo {
        if heading_path.is_empty() {
            return anchor_none();
        }
        let last = heading_path.last().cloned();
        match self.docs.get(path) {
            Some(doc) => match drill(&doc.headings, heading_path) {
                Some(h) => AnchorInfo {
                    status: AnchorStatus::Found,
                    heading: Some(h.text.clone()),
                    line: Some(h.line),
                },
                None => AnchorInfo {
                    status: AnchorStatus::Missing,
                    heading: last,
                    line: None,
                },
            },
            None => AnchorInfo {
                status: AnchorStatus::Missing,
                heading: last,
                line: None,
            },
        }
    }

    /// 反链（link graph 只读派生物）：解析全部文档内链接，命中 target 的列出。
    /// 结果按来源路径字典序（确定性）。
    pub fn backlinks(&self, target: &str) -> Vec<BacklinkItem> {
        let mut out = Vec::new();
        for path in self.files.iter() {
            let Some(doc) = self.docs.get(path) else {
                continue;
            };
            for dl in &doc.links {
                let res = self.resolve(path, &dl.link);
                if matches!(res.status, LinkStatus::Resolved | LinkStatus::Ambiguous)
                    && res.path.as_deref() == Some(target)
                {
                    out.push(BacklinkItem {
                        source: path.clone(),
                        line: dl.line,
                        context: dl.context.clone(),
                    });
                }
            }
        }
        out
    }

    /// 计算一键创建的目标路径（§4.4，裁决点 I）：path 段不含 `/` 时创建于
    /// from 所在目录；含 `/` 时按 vault 根相对路径。目标必须解析为 unresolved。
    pub fn create_target(&self, from: &str, raw: &str) -> Result<String, CommandError> {
        let link = parse_single(raw)?;
        if link.block_ref {
            return Err(CommandError::new(
                "wikilink_unsupported",
                "块引用语法不支持，无法创建目标",
            ));
        }
        let res = self.resolve(from, &link);
        if res.status != LinkStatus::Unresolved {
            return Err(CommandError::new(
                "wikilink_target_exists",
                "该链接已可解析到既有文件（索引可能已过期），已改为重新解析",
            ));
        }
        let p = link.path.trim();
        if p.is_empty() {
            return Err(CommandError::new(
                "wikilink_invalid",
                "当前文件内锚点链接没有可创建的目标",
            ));
        }
        if p.starts_with('/') || p.split('/').any(|s| s == ".." || s == ".") {
            return Err(CommandError::new(
                "wikilink_invalid_path",
                format!("目标路径不合法：{p}"),
            ));
        }
        // 与 §3.2 同口径：自带 .md 后缀不重复拼接。
        let p_md = if p.to_lowercase().ends_with(".md") {
            p.to_string()
        } else {
            format!("{p}.md")
        };
        if p.contains('/') {
            Ok(p_md)
        } else {
            match from.rsplit_once('/') {
                Some((dir, _)) => Ok(format!("{dir}/{p_md}")),
                None => Ok(p_md),
            }
        }
    }

    /// 一键创建（§4.4）：空内容、补齐中间目录、MUST NOT 覆盖既有文件
    /// （create_new 语义；已存在 = 索引过期，报错并提示重新解析）。创建后更新索引。
    pub fn create_note(
        &mut self,
        root: &Path,
        from: &str,
        raw: &str,
    ) -> Result<String, CommandError> {
        let rel = self.create_target(from, raw)?;
        let abs = root.join(&rel);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                CommandError::new(
                    "wikilink_create_failed",
                    format!("无法创建目录 {}：{e}", parent.display()),
                )
            })?;
        }
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&abs)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    CommandError::new(
                        "wikilink_target_exists",
                        format!("目标已存在：{rel}（索引可能已过期），已改为重新解析"),
                    )
                } else {
                    CommandError::new("wikilink_create_failed", format!("无法创建 {rel}：{e}"))
                }
            })?;
        self.upsert(&rel, Some(""));
        Ok(rel)
    }
}

impl Default for LinkGraph {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_single(raw: &str) -> Result<WikiLink, CommandError> {
    let links = parse_links(raw);
    if links.len() != 1 {
        return Err(CommandError::new(
            "wikilink_invalid",
            "不是一条合法的 wikilink 链接文本",
        ));
    }
    Ok(links.into_iter().next().expect("len checked"))
}

/// 按精确/折叠双谓词把候选分别收入 exact / folded（§3.1：精确大小写优先）。
fn collect_matches(
    universe: &[&String],
    exact: &mut Vec<String>,
    folded: &mut Vec<String>,
    pred_e: &dyn Fn(&str) -> bool,
    pred_f: &dyn Fn(&str) -> bool,
) {
    for f in universe {
        if pred_e(f) {
            exact.push((*f).clone());
        } else if pred_f(f) {
            folded.push((*f).clone());
        }
    }
}

/// 路径的最后一段（文件名）。
fn file_name(f: &str) -> &str {
    f.rsplit('/').next().expect("non-empty")
}

fn anchor_none() -> AnchorInfo {
    AnchorInfo {
        status: AnchorStatus::None,
        heading: None,
        line: None,
    }
}

fn unresolved_result() -> LinkResolveResult {
    LinkResolveResult {
        status: LinkStatus::Unresolved,
        path: None,
        candidates: Vec::new(),
        embed_target: None,
        anchor: anchor_none(),
    }
}

fn embed_target_of(path: &str) -> EmbedTarget {
    if is_markdown(path) {
        EmbedTarget::Note
    } else {
        EmbedTarget::Attachment
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn links_of(text: &str) -> Vec<(String, bool)> {
        parse_links(text)
            .into_iter()
            .map(|l| (l.path.clone(), l.embed))
            .collect()
    }

    #[test]
    fn headings_skip_code_and_strip_closing_hashes() {
        let text = "# 一\n\n```\n# 不是标题\n```\n\n## 二 ##\n\n`行内 # 也不是`\n\n### 三\n";
        let headings = extract_headings(text);
        let texts: Vec<&str> = headings.iter().map(|h| h.text.as_str()).collect();
        assert_eq!(texts, ["一", "二", "三"]);
        assert_eq!(headings[0].line, 1);
        assert_eq!(headings[1].level, 2);
    }

    #[test]
    fn tilde_fence_is_excluded() {
        assert_eq!(links_of("~~~\n[[Beta]]\n~~~"), []);
    }

    #[test]
    fn unmatched_backtick_run_is_literal() {
        // 找不到闭合串时反引号按原文（GFM），其后的链接照常识别。
        assert_eq!(links_of("`开头 [[Beta]]"), [("Beta".to_string(), false)]);
    }

    #[test]
    fn drill_requires_subtree_for_nested_segments() {
        let headings = extract_headings("# A\n## B\n# C\n## B\n");
        let seg = |s: &str| s.to_string();
        assert!(drill(&headings, &[seg("A"), seg("B")]).is_some());
        assert!(drill(&headings, &[seg("C"), seg("B")]).is_some());
        // A 的子树内没有更深的 B 之外的匹配后，第二段不会跨到 C 的子树
        assert_eq!(
            drill(&headings, &[seg("A"), seg("B"), seg("B")]).map(|h| h.line),
            None
        );
    }
}
