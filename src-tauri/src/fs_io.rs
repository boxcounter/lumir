//! 文件 IO / 监听 —— 全类型递归枚举 + watch 增量事件流（add-vault-workspace）。
//!
//! 职责见 ADR 0002 §3：vault 内文件的读取与变更监听全部在 Rust core 完成，
//! webview 不直接触文件系统。架构约束见 ADR 0002 §7：本模块不依赖 tauri/UI
//! 类型——watch 以 `impl Fn(Vec<FsChange>)` 回调交付纯数据，由 commands 层
//! 决定如何 emit 成 `fs:entry_changed` 事件。
//!
//! 文本文档保存使用同目录临时文件替换目标：可保存面是注册表全部文本类（md / code / text
//! 三族，editable-non-md-files 起），image/binary 类扩展名被拒绝（见 [`save_document`]）。
//! 枚举路径顺带惰性清除超龄的跨进程保存 tmp ghost（磁盘隐形累积治理，
//! 阈值见 [`GHOST_TMP_MAX_AGE`]，在途写入不受影响）。

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::Match;
use notify::{EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};
use ts_rs::TS;

use crate::commands::CommandError;

/// 内置规则的名字字面量（16 条，**无尾斜杠**；change vault-open-ignore-set §2.4）。
///
/// **书写形式有语义**：gitignore 语义下无斜杠模式在**任意深度**匹配同名的**文件与目录** ⇒
/// 与今日的名字等值判定逐条等价（既有 scenario「同名文件与目录一视同仁」因此保留、不改判）。
/// 写成 `target/` 会变成「只隐藏目录、同名文件可见」——那是有意的改判，本 change 不做。
///
/// 这是**产品硬编码**（「按结构不是内容」：`.git` 是对象库、`node_modules` 是依赖副本、
/// `target` 是构建产物），不在配置面内、不可被用户规则的取反推翻（§2.6），要改它得走
/// change proposal。A3 档（`build` / `out` / `vendor`）经 Alex 2026-09-28 裁决**不纳入**：
/// 通用英文词的误伤概率高于收窄收益（且它们若写进了 `.gitignore`，照样落进用户规则、惰性可见）。
///
/// 前端 `src/tree.ts` 的内联编辑预检复制了这份名字表（只为「提交前就说清」，判定职责仍在
/// 后端），两侧逐项对账在 `tests/unit/tree-paths.test.ts`——解析的正是本声明。
pub const BUILTIN_NAMES: [&str; 16] = [
    // 既有三条
    ".git",
    ".DS_Store",
    "node_modules",
    // A1 生态专名（工具链固定输出名）
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    ".nuxt",
    ".cache",
    ".pnpm-store",
    ".tox",
    ".gradle",
    "test-results",
    "perf-results",
    // A2 工具链常用词
    "target",
    "dist",
];

/// 保存临时文件模式（两条）。**必须两条**才能与既有判据「`.` 开头且含 `.lumir-`」逐条等价：
/// - `.lumir-*` —— 名字在**开头**就是 `.lumir-`（`.lumir-notes.md` / `.lumir-` / `.lumir-1`）；
/// - `.*.lumir-*` —— 首个 `.` 之后另有内容再出现 `.lumir-`（本 app 产生的
///   `.{目标名}.lumir-{pid}`，如 `.note.md.lumir-123`，以及 `..lumir-1`）。
///
/// 只写后者会漏掉「以 `.lumir-` 开头」的名字（r2/r3 评审用真 `git check-ignore` 实测过
/// `.lumir-notes.md`）——那等于顺手把一个今天隐藏的文件改成可见，对拍测试也会红。
const LUMIR_TMP_PATTERNS: [&str; 2] = [".lumir-*", ".*.lumir-*"];

/// 用字面量行建一个 gitignore 匹配器。根固定为 `.`：本仓的规则一律按「相对匹配器所属目录」
/// 的路径喂进来（内置规则与用户规则同口径），`ignore` crate 对根 `.` 有专门的「不剥前缀」
/// 分支，正是我们要的（`Gitignore::strip` 的 `.` 特例）。
fn build_matcher<'a>(lines: impl IntoIterator<Item = &'a str>) -> Gitignore {
    let mut builder = GitignoreBuilder::new(".");
    for line in lines {
        // 字面量由本文件持有：写错在编译期不可见，在这里以 panic 暴露（不是用户输入路径）
        builder
            .add_line(None, line)
            .expect("内置规则字面量必须合法");
    }
    builder.build().unwrap_or_else(|_| empty_matcher())
}

/// 空匹配器（永不命中）。用于「规则文件编译失败」的降级：一份写坏的 `.gitignore` 不该让
/// 整次枚举失败，也不该变成「隐藏一切」。
fn empty_matcher() -> Gitignore {
    GitignoreBuilder::new(".")
        .build()
        .expect("空匹配器必须可构造")
}

/// 内置规则匹配器（进程内唯一，构造一次；表见 [`BUILTIN_NAMES`] 与 [`LUMIR_TMP_PATTERNS`]）。
///
/// 内置表是**常量**，因此这里是它唯一的实例化点——`validate_new_name` 与 `IgnorePolicy`
/// 共用同一份匹配器，不存在第二份名单或第二个判定实现（REVIEW.md 第 8 条）。
///
/// 它与用户规则**不是同一个对象**，而是同一类匹配器 + 判定链上先判且命中即定格（§2.2/§2.6）：
/// 若把两者编进同一个 `Gitignore`，用户写下的 `!target/` 会按「后者胜」推翻内置规则——那正是
/// §2.6 明令禁止的（性能护栏不能由一行编辑关掉）。
fn builtin_matcher() -> &'static Gitignore {
    static MATCHER: OnceLock<Gitignore> = OnceLock::new();
    MATCHER.get_or_init(|| {
        build_matcher(
            BUILTIN_NAMES
                .iter()
                .chain(LUMIR_TMP_PATTERNS.iter())
                .copied(),
        )
    })
}

/// 临时文件模式匹配器（与内置表共用 [`LUMIR_TMP_PATTERNS`] 这一份字面量）。
/// 消费者是 ghost 惰性清除（[`remove_ghost_tmp_if_stale`]）；判定新名字是否命中内置规则
/// 走的是 [`builtin_matcher`]，这里只回答「是不是保存 tmp 形态」。
fn lumir_tmp_matcher() -> &'static Gitignore {
    static MATCHER: OnceLock<Gitignore> = OnceLock::new();
    MATCHER.get_or_init(|| build_matcher(LUMIR_TMP_PATTERNS.iter().copied()))
}

/// 名字是否命中内置规则（**末段名**判定，`validate_new_name` 与前端预检的权威）。
///
/// 用户规则**不参与**：用户可以照常新建 / 改名成被 `.gitignore` 匹配的名字——它本来就可见、
/// 可打开，只是不进索引（§3.2）。
pub fn is_builtin_name(name: &str) -> bool {
    builtin_matcher()
        .matched_path_or_any_parents(name, false)
        .is_ignore()
}

/// 条目按当前规则表的去向（spec「全类型递归枚举」：**来源决定去向**）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryClass {
    /// **内置规则**命中 ⇒ 不可见：不进枚举结果、不进 watch 事件流、不进索引，子树不枚举
    ///（行为与今日的硬编码名单逐条一致）。
    Hidden,
    /// **用户规则**命中 ⇒ 惰性可见：出一行（`lazy: true`）、不递归、不进索引。
    Lazy,
    /// 其余 ⇒ 出一行（`lazy: false`）、递归、进索引。
    Visible,
}

/// 用户规则的单个来源（`<root>/.gitignore`、递归途中的嵌套 `.gitignore`、`<root>/.git/info/exclude`）。
struct UserSource {
    /// 规则文件所在目录的 vault 相对路径（`""` = vault 根）。判定时用它把路径折成本地相对
    /// 形式——`.gitignore` 的模式只对它所在的目录及其子孙有意义。
    dir: String,
    matcher: Gitignore,
}

/// 一份规则表 + 物化集合（change vault-open-ignore-set §2.1 / §4.4）：纯 std 类型、
/// **不引 tauri**（ADR 0002 §7），由 `commands.rs` 在 vault 装载时构造，交给
/// `scan_workspace` / `scan_dir` / `watch` / `expand_new_dir_subtrees` / `validate_new_name`
/// 五个使用点——一份策略、五个使用点，MUST NOT 在下游各自再造一份判定（REVIEW.md 第 8 条）。
///
/// 判定链固定为 §2.2 的三步：**内置先判且命中即定格 → 用户规则（最深匹配决定）→ 其余可见**。
///
/// **生效时点**：装载时编译一次，随 vault 存活；规则文件与 `vault.rule_files` 的改动一律
/// **下次装载**生效（本会话不重编，依据见 design §4.5——可见集不随规则变化，变的只是「哪些
/// 子树被主动枚举」）。
#[derive(Clone)]
pub struct IgnorePolicy {
    inner: Arc<IgnorePolicyInner>,
}

struct IgnorePolicyInner {
    /// vault 根（读嵌套 `.gitignore` 用）。
    root: PathBuf,
    /// 用户规则来源，**优先级从高到低**排列（深层 `.gitignore` > 浅层 > `info/exclude`）。
    /// 判定取「第一个给出确定结论的来源」——即 git 的「最深匹配决定」。
    sources: Mutex<Vec<UserSource>>,
    /// `.gitignore` 这个来源是否启用：只有它出现在规则文件清单里才读递归途中的嵌套
    /// `.gitignore`（列表 = 来源清单，不是「规则作用域的声明」，见 design §2.9 语义 1/2）。
    nested_gitignore: bool,
    /// 已登记过嵌套 `.gitignore` 探读的目录（`""` 为根）。惰性：只探一次。
    nested_seen: Mutex<HashSet<String>>,
    /// 「已按需展开」的目录集合（vault 相对路径）——watch 判定惰性子树是否实时的唯一依据。
    /// 随 vault 装载重建，MUST NOT 跨 vault 串用。
    materialized: Mutex<HashSet<String>>,
}

impl IgnorePolicy {
    /// 装载时构造（`commands::prepare_vault_open` 调用）：编译内置规则（进程内常量匹配器）
    /// 与 `rule_files` 清单里的用户规则。
    ///
    /// 清单里每一项都按**「vault 根的规则文件」**解释（§2.9 语义 2）：读的是它自己那个路径，
    /// 但模式一律**相对 vault 根**匹配——所以 `.git/info/exclude` 与根 `.gitignore` 的匹配
    /// 作用域都是整个 vault（前者不是「相对 `.git/info`」的规则）。同深度（都在 vault 根）
    /// 按**清单顺序**决定优先级，因此出厂清单 `[".gitignore", ".git/info/exclude"]` 下
    /// 根 `.gitignore` 优先于 `info/exclude`，与 git 口径一致。
    ///
    /// 文件不存在 / 不是常规文件 ⇒ 静默跳过（`.git/info/exclude` 在非 git vault 里本来就不存在，
    /// 这是常态）。嵌套 `.gitignore` 不在这里读——它们由枚举 / 按需枚举递归途中逐层登记
    ///（[`Self::register_nested`]）。
    pub fn load(root: &Path, rule_files: &[String]) -> IgnorePolicy {
        let mut sources: Vec<UserSource> = Vec::new();
        let mut nested_gitignore = false;
        for file in rule_files {
            // 只有 `.gitignore` 这一个来源带「嵌套逐层读取」的固有语义；别的来源
            //（如 `.git/info/exclude`）只在它自己的那个路径上生效。
            if file == ".gitignore" {
                nested_gitignore = true;
            }
            if let Some(matcher) = read_rule_file(root, file) {
                insert_source(&mut sources, "", matcher);
            }
        }
        IgnorePolicy {
            inner: Arc::new(IgnorePolicyInner {
                root: root.to_path_buf(),
                sources: Mutex::new(sources),
                nested_gitignore,
                nested_seen: Mutex::new(HashSet::new()),
                materialized: Mutex::new(HashSet::new()),
            }),
        }
    }

    /// 判定一个条目（vault 相对路径 + 磁盘类型）的去向。判定顺序是唯一的一条链（§2.2）。
    pub fn classify(&self, rel: &str, is_dir: bool) -> EntryClass {
        if is_builtin_hidden(rel, is_dir) {
            return EntryClass::Hidden;
        }
        if self.user_ignored(rel, is_dir) {
            return EntryClass::Lazy;
        }
        EntryClass::Visible
    }

    /// 用户规则是否命中（含 gitignore 的「祖先被排除 ⇒ 子孙全被排除」语义）。
    ///
    /// 按优先级从高到低问每个来源，**第一个给出确定结论的来源决定**（忽略 ⇒ true，
    /// 取反 ⇒ false）——这正是 git「同一路径上最深的匹配决定」的口径，也让用户规则内部的
    /// 取反（`drafts/` 忽略 + `!drafts/keep/` 放回）照常生效。
    pub fn user_ignored(&self, rel: &str, is_dir: bool) -> bool {
        let sources = self.inner.sources.lock().expect("ignore sources poisoned");
        for source in sources.iter() {
            let Some(local) = relative_to_dir(&source.dir, rel) else {
                continue; // 规则只对它所在目录及其子孙有意义
            };
            match source.matcher.matched_path_or_any_parents(local, is_dir) {
                Match::Ignore(_) => return true,
                Match::Whitelist(_) => return false,
                Match::None => {}
            }
        }
        false
    }

    /// 登记某个目录里可能存在的嵌套 `.gitignore`（**递归进入可见目录**时调用；惰性、只探一次）。
    ///
    /// 代价是一次 `read_to_string` 的失败尝试（目录数 ≈ 目录数），换来「嵌套规则与枚举同源」。
    /// 只在 `.gitignore` 这个来源启用时探读。
    ///
    /// **唯一的调用点是 `scan_workspace_at`**：规则栈只在递归进入**可见**目录时逐层叠加。
    /// 惰性子树内部 MUST NOT 读它的 `.gitignore`（祖先已排除，结论不会变；真读了会让嵌套来源的
    /// 白名单短路根来源的祖先排除判定，见 [`scan_dir`] 里那段说明与 M292 r1 评审 P1-1）。
    fn register_nested(&self, dir_rel: &str) {
        if !self.inner.nested_gitignore || dir_rel.is_empty() {
            // 根 `.gitignore` 已由 [`Self::load`] 按 `rule_files` 登记过：这里再读一次只会
            // 往来源表里插一份等价副本（判定结果不变，白付一次读盘）。
            return;
        }
        {
            let mut seen = self.inner.nested_seen.lock().expect("nested seen poisoned");
            if !seen.insert(dir_rel.to_string()) {
                return;
            }
        }
        let file = join_rel(dir_rel, ".gitignore");
        let Ok(text) = std::fs::read_to_string(self.inner.root.join(&file)) else {
            return; // 不存在 / 不是常规文件：静默跳过（常态）
        };
        let mut builder = GitignoreBuilder::new(".");
        for line in text.lines() {
            // 单行写错只丢那一行：一份有笔误的 .gitignore 不该让整个 vault 的判定变脸
            let _ = builder.add_line(None, line);
        }
        let matcher = builder.build().unwrap_or_else(|_| empty_matcher());
        let mut sources = self.inner.sources.lock().expect("ignore sources poisoned");
        insert_source(&mut sources, dir_rel, matcher);
    }

    /// 登记「该目录已按需展开」（`fs_scan_dir` 成功返回时调用）：它是 watch 判定惰性子树
    /// 事件是否实时的唯一开关（§4.4）。
    fn mark_materialized(&self, dir_rel: &str) {
        self.inner
            .materialized
            .lock()
            .expect("materialized poisoned")
            .insert(dir_rel.to_string());
    }

    /// 该目录是否已被按需展开过。
    ///
    /// `pub(crate)`：命令层的「切换 vault 后上一 vault 的物化登记不生效」这条不变量要在
    /// `commands` 的测试里直接观察（物化集合跨 vault 串用是静默的性能问题，不靠推断宣称没有）。
    pub(crate) fn is_materialized(&self, dir_rel: &str) -> bool {
        self.inner
            .materialized
            .lock()
            .expect("materialized poisoned")
            .contains(dir_rel)
    }

    /// 清除某个路径的物化登记（含其子孙）：目录被删 / 改名后旧路径不再“展开着”，
    /// 新路径的登记由用户下次展开时重建（§4.3）。
    fn forget_materialized(&self, rel: &str) {
        let mut materialized = self
            .inner
            .materialized
            .lock()
            .expect("materialized poisoned");
        materialized.retain(|p| p != rel && !p.starts_with(&format!("{rel}/")));
    }
}

/// 把一个来源按优先级插进来源表：**深度大者在前**（深层 `.gitignore` > 浅层 > vault 根的
/// `.gitignore` / `info/exclude`），同深度按进入顺序（即清单顺序）——所以出厂清单
/// `[".gitignore", ".git/info/exclude"]` 下根 `.gitignore` 优先于 `info/exclude`。
/// 判定从前往后取第一个确定结论，正是 git 的「最深匹配决定」。
fn insert_source(sources: &mut Vec<UserSource>, dir: &str, matcher: Gitignore) {
    let depth = source_depth(dir);
    let at = sources
        .iter()
        .position(|s| source_depth(&s.dir) < depth)
        .unwrap_or(sources.len());
    sources.insert(
        at,
        UserSource {
            dir: dir.to_string(),
            matcher,
        },
    );
}

fn source_depth(dir: &str) -> usize {
    if dir.is_empty() {
        0
    } else {
        dir.split('/').count()
    }
}

/// 读一份用户规则文件（vault 相对路径）并编译成匹配器；不存在 / 不是常规文件 / 读不开 ⇒ None。
///
/// 读的是**原样路径**而不是 `resolve_in_vault` 的结果：符号链接形态的 `.gitignore`
///（共享忽略设置的一种常见做法）照常生效，与 git 的行为一致。
fn read_rule_file(root: &Path, file: &str) -> Option<Gitignore> {
    let text = std::fs::read_to_string(root.join(file)).ok()?;
    let mut builder = GitignoreBuilder::new(".");
    for line in text.lines() {
        let _ = builder.add_line(None, line);
    }
    Some(builder.build().unwrap_or_else(|_| empty_matcher()))
}

/// `rel` 相对 `dir` 的本地路径（`dir` 为空串即根，返回 `rel` 本身）；`rel` 不在 `dir` 之下
/// 时返回 None（该来源不参与判定）。
fn relative_to_dir<'a>(dir: &str, rel: &'a str) -> Option<&'a str> {
    if dir.is_empty() {
        return Some(rel);
    }
    if rel == dir {
        return None; // 规则文件所在目录自身不由它自己的模式判定
    }
    rel.strip_prefix(dir)?.strip_prefix('/')
}

/// 路径是否命中内置规则（任一组件，含最后一段）。内置规则是**名字的纯函数**——不含目录限定
/// 模式，判定既不需要 stat 也不需要条目类型。
fn is_builtin_hidden(rel: &str, is_dir: bool) -> bool {
    builtin_matcher()
        .matched_path_or_any_parents(rel, is_dir)
        .is_ignore()
}

/// 单附件大小上限（spec：建议 50MB），防止误读大文件撑破常驻内存合同。
pub const ATTACHMENT_MAX_BYTES: u64 = 50 * 1024 * 1024;

/// watch 事件 debounce 窗口（裁决点 B）：窗口内连续事件合并为一批推送。
pub const DEBOUNCE: Duration = Duration::from_millis(100);

/// 保存临时文件 ghost 的年龄阈值：超过此值的 `.lumir-` 残留由枚举路径惰性
/// 清除（见 [`scan_workspace`]）。同进程保存的 tmp 生命周期是毫秒级
/// （create → rename），在途写入远年轻于此阈值，不会被误删；只有进程崩溃
/// 留下的跨进程 ghost 才会超龄。
pub const GHOST_TMP_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// 条目类型：文件 / 目录。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum FsEntryKind {
    File,
    Dir,
}

/// 枚举条目：相对路径（`/` 分隔）、类型、大小、mtime（Unix 毫秒），以及**惰性标记**。
///
/// `lazy`（change vault-open-ignore-set §4.3）：true 表示这一条的**子树 / 索引面未枚举**——
/// 目录的子孙不在本次结果里（展开时经 `fs_scan_dir` 拉取一层），文件不进链接索引与附件索引。
/// 前端靠它区分「空目录」与「惰性目录」（没有这个标记，两者在模型里长得一样）。
/// 语义与 [`FsChange::lazy`] 同源：**用户规则命中 ⇒ 惰性**（内置规则命中的条目根本不出现）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct FsEntry {
    /// 相对 vault 根的路径，`/` 分隔。
    pub path: String,
    pub kind: FsEntryKind,
    /// 字节数；目录为 0。
    #[ts(type = "number")]
    pub size: u64,
    /// 修改时间（Unix 毫秒）；取不到时为 null。
    #[ts(type = "number | null")]
    pub mtime_ms: Option<i64>,
    /// 惰性条目（用户规则命中）：可见但未主动枚举，见本结构体的注释。
    pub lazy: bool,
}

/// watch 增量类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum FsChangeKind {
    Created,
    Modified,
    Deleted,
}

/// 单条增量：变更类型 + 相对路径 + **惰性标记**。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct FsChange {
    pub kind: FsChangeKind,
    /// 相对 vault 根的路径，`/` 分隔。
    pub path: String,
    /// 条目类型（file/dir），deleted 时为 null——前端据此知道新增节点是文件还是目录。
    pub entry_kind: Option<FsEntryKind>,
    /// 惰性标记：与 [`FsEntry::lazy`] **同一处口径**（用户规则命中 ⇒ true）。后端在过滤 /
    /// 投递那一步用同一份规则表算出，下游 MUST NOT 重算（那会引出第二份规则实现）。
    ///
    /// 消费方是两处**索引增量补丁**（`commands::apply_fs_changes` 的 `graph.upsert` 与
    /// `src/main.ts` 的 `attachmentPaths.push`）：created / modified 且 `lazy` ⇒ 不许进索引
    ///（索引是磁盘 + 规则的纯函数，不是事件历史的函数）。**deleted 方向无条件移除**、不消费
    /// 本字段——幂等，且绕开「被删路径 stat 不到、目录限定模式判不准类型」的歧义。
    /// 树侧的可见性不受它影响：惰性条目照样有行。
    pub lazy: bool,
}

/// `fs:entry_changed` 事件 payload：debounce 窗口合并后的一批增量（同路径去重，后发生者胜）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct FsEntryChangedEvent {
    pub changes: Vec<FsChange>,
}

/// 保存临时文件模式判定（`.` 开头且含 `.lumir-`，如 `.note.md.lumir-123`）。
/// 精确匹配模式而非全部点文件——vault 里合法的 `.obsidian` 配置目录等
/// 仍须正常枚举。字面量与内置表共用 [`LUMIR_TMP_PATTERNS`]（不另写一份判据）。
fn is_lumir_tmp(name: &std::ffi::OsStr) -> bool {
    match name.to_str() {
        Some(s) => lumir_tmp_matcher().matched(s, false).is_ignore(),
        None => false,
    }
}

/// 超龄 ghost tmp 惰性清除（best-effort）：仅删「名字命中 tmp 模式 + 是普通
/// 文件 + mtime 早于 `now - GHOST_TMP_MAX_AGE`」的目标。合法点文件与符号
/// 链接不动；删除失败（权限等）静默忽略——治理不得让枚举失败。
fn remove_ghost_tmp_if_stale(path: &Path, now: SystemTime) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    let Ok(mtime) = meta.modified() else {
        return false;
    };
    // 时钟回拨（mtime 晚于 now）时 duration_since 报错 → 一律视为未超龄
    let Ok(age) = now.duration_since(mtime) else {
        return false;
    };
    age >= GHOST_TMP_MAX_AGE && std::fs::remove_file(path).is_ok()
}

/// 绝对路径 → vault 相对路径（`/` 分隔）；不在 vault 内 / 含非普通组件 / 非 UTF-8 / 空路径时 None。
///
/// **不做任何忽略判定**：这一层只管路径形态（枚举侧、watch 侧、改名补全三处共用一份），去向由
/// [`IgnorePolicy::classify`]（枚举）与 [`watch_verdict`]（事件）裁决——同一语义不留两处实现。
fn rel_string(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_str()?),
            _ => return None,
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

/// 事件路径的投递判定（§4.4 的两来源规则），返回 `(vault 相对路径, lazy 标记)`；None = 丢弃。
///
/// ```text
/// 若任一组件（含最后一段）命中内置规则                          → 丢弃
/// 若任一「祖先组件」命中用户规则 且 该祖先不在已按需展开集合     → 丢弃
/// 否则                                                        → 投递
/// ```
///
/// 三条要点（逐字见 spec「watch 增量事件流」）：
/// 1. **内置规则对全部组件照判**（含最后一段）：它是名字的纯函数、语义类型无关，命中的条目
///    在枚举结果里**没有行** ⇒ 这一行的增删事件 MUST NOT 投递，否则树里会出现一行枚举永远
///    不会产生的幻影行（前端 `applyChanges` 不做隐藏名过滤）。`is_dir` 未知（被删路径拿不到
///    类型）也不影响——无斜杠模式对文件与目录一视同仁。
/// 2. **用户规则只看祖先，最后一段一律投递**：末段是否命中并不改变「有没有行」这个事实
///    （命中 ⇒ 惰性行；不命中 ⇒ 普通行），两种情况下投递都正确；而行的出现 / 消失必须实时
///    （否则外部删掉 `.local` 后树里留一个死行）。前缀组件必定是目录，因此这里一次 stat 都不需要。
/// 3. **用户规则的祖先：未物化 ⇒ 不投递**（`.tower/worktrees/**` 的 agent churn 不进 webview）；
///    已物化 ⇒ 投递（用户展开过的地方保持实时）。
///
/// `lazy` 由这里按同一份规则表算出并随事件带给前端：投递与否由「祖先」决定，但这一条**自身**
/// 的去向另有下游消费者（两处索引增量补丁，§4.6）——MUST NOT 让下游各自重算。
fn watch_verdict(
    policy: &IgnorePolicy,
    root: &Path,
    path: &Path,
    is_dir: Option<bool>,
) -> Option<(String, bool)> {
    let rel = rel_string(root, path)?;
    if is_builtin_hidden(&rel, is_dir.unwrap_or(false)) {
        return None;
    }
    let parts: Vec<&str> = rel.split('/').collect();
    for index in 0..parts.len().saturating_sub(1) {
        let ancestor = parts[..=index].join("/");
        if policy.user_ignored(&ancestor, true) && !policy.is_materialized(&ancestor) {
            return None;
        }
    }
    // 末段不参与「投不投递」的判定，但这一条自身的去向要判（惰性 ⇒ 不进索引）。
    let lazy = policy.user_ignored(&rel, is_dir.unwrap_or(false));
    Some((rel, lazy))
}

fn mtime_ms(meta: &std::fs::Metadata) -> Option<i64> {
    let t = meta.modified().ok()?;
    let d = t.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(d.as_millis() as i64)
}

/// 全类型递归枚举（不按扩展名过滤，去向由 [`IgnorePolicy`] 裁决）。
/// 结果按路径排序，保证确定性；目录在前、同缀按名称的展示排序由文件树 UI 负责。
/// 顺带做保存临时文件 ghost 的惰性清除（超龄才删，见 [`GHOST_TMP_MAX_AGE`]）。
pub fn scan_workspace(root: &Path, policy: &IgnorePolicy) -> Result<Vec<FsEntry>, CommandError> {
    scan_workspace_at(root, policy, SystemTime::now())
}

/// 枚举实现本体；`now` 可注入，使 ghost tmp 的年龄判定在测试中确定可控。
///
/// 分类口径（spec「全类型递归枚举」，一处实现）：内置规则命中 ⇒ 丢弃且不递归；用户规则命中
/// ⇒ 出一行（`lazy: true`）且不递归；其余 ⇒ 出一行（`lazy: false`）并递归。
///
/// 收口处记一条 [被内置规则剪掉的条目数](crate::logging::vault_scan_ignored)（含被剪掉的目录
/// 自身，不含其未枚举的子孙）——它是「我的文件不见了」时的第一诊断依据；**只有计数**，不记
/// 路径或名字原文（隐私边界）。`fs_scan_dir` 不记这条：按需展开是高频次动作，逐次计数只会把
/// 日志刷成噪音，而它回答不了「vault 里有什么被剪掉了」。
fn scan_workspace_at(
    root: &Path,
    policy: &IgnorePolicy,
    now: SystemTime,
) -> Result<Vec<FsEntry>, CommandError> {
    if !root.is_dir() {
        return Err(CommandError::new(
            "fs_root_not_dir",
            format!("vault 路径不是目录：{}", root.display()),
        )
        .param("root", root.display()));
    }
    let mut entries = Vec::new();
    let mut ignored = 0usize;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        // 进入一个目录：先登记它自己那份嵌套 .gitignore（`.gitignore` 来源启用时），
        // 让它对**本层**条目立刻生效（嵌套逐层叠加，见 §4.2）。
        if let Some(dir_rel) = rel_dir_string(root, &dir) {
            policy.register_nested(&dir_rel);
        }
        let rd = std::fs::read_dir(&dir).map_err(|e| {
            CommandError::new(
                "fs_scan_failed",
                format!("无法读取目录 {}：{e}", dir.display()),
            )
            .param("rel", dir.display())
            .param("reason", e.to_string())
        })?;
        for item in rd {
            let item = item.map_err(|e| {
                CommandError::new(
                    "fs_scan_failed",
                    format!("无法读取目录 {} 下的条目：{e}", dir.display()),
                )
                .param("rel", dir.display())
                .param("reason", e.to_string())
            })?;
            let name = item.file_name();
            let path = item.path();
            // file_type() 不跟随 symlink：指向目录的 symlink 不递归展开。
            // 否则循环 symlink 会沿链接重复枚举直至 ELOOP 让 open_vault 失败，
            // 外部 symlink 会把 vault 外整棵树枚举进文件树（威胁 ADR 0002 §6
            // 性能合同）。symlink 条目按文件列出，读取侧由 resolve_in_vault
            // 兜底拒绝逃逸。
            let ft = match item.file_type() {
                Ok(ft) => ft,
                Err(_) => continue, // 扫描期间被删的条目直接跳过
            };
            let kind = if ft.is_dir() {
                FsEntryKind::Dir
            } else {
                FsEntryKind::File
            };
            let Some(rel) = rel_string(root, &path) else {
                continue;
            };
            match policy.classify(&rel, kind == FsEntryKind::Dir) {
                EntryClass::Hidden => {
                    // 跨进程崩溃残留的 tmp ghost 在磁盘隐形累积：枚举路径顺带清除
                    // 超龄者；在途保存的 tmp（毫秒级）与合法点文件都不受影响
                    if is_lumir_tmp(&name) {
                        remove_ghost_tmp_if_stale(&path, now);
                    }
                    ignored += 1;
                    continue;
                }
                // 用户规则命中：出一行、不递归（「祖先被排除 ⇒ 子孙全被排除」的落点）
                EntryClass::Lazy => {}
                EntryClass::Visible => {
                    if kind == FsEntryKind::Dir {
                        stack.push(path.clone());
                    }
                }
            }
            // symlink_metadata 不跟随：symlink 条目取链接自身的元数据，
            // 避免对循环 symlink follow 时撞 ELOOP。
            let meta = std::fs::symlink_metadata(&path).ok();
            let lazy = lazy_of(policy, &rel, kind == FsEntryKind::Dir);
            entries.push(FsEntry {
                path: rel,
                kind,
                size: meta.as_ref().filter(|m| m.is_file()).map_or(0, |m| m.len()),
                mtime_ms: meta.as_ref().and_then(mtime_ms),
                lazy,
            });
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    if ignored > 0 {
        crate::logging::vault_scan_ignored(ignored);
    }
    Ok(entries)
}

/// 按需枚举**一层**（change vault-open-ignore-set §4.3 的 `fs_scan_dir`）：
/// 分类口径与 [`scan_workspace`] 完全同源（内置规则丢弃、用户规则命中出一行且 `lazy: true`、
/// 其余出一行），但 MUST NOT 递归下钻。
///
/// 目标路径走与所有读取路径同源的 vault 内校验（[`resolve_in_vault`]，MUST NOT 为按需枚举
/// 放松边界）；不存在 ⇒ `fs_not_found`，不是目录 ⇒ `fs_path_invalid`（人话）。
///
/// 成功返回即把该目录登记进**物化集合**：它是 watch 判定惰性子树事件是否实时的唯一开关
///（§4.4）。登记随 vault 装载重建，MUST NOT 跨 vault 串用。
pub fn scan_dir(
    root: &Path,
    policy: &IgnorePolicy,
    dir_rel: &str,
) -> Result<Vec<FsEntry>, CommandError> {
    let dir = resolve_in_vault(root, dir_rel)?;
    let meta = std::fs::metadata(&dir).map_err(|e| {
        CommandError::new("fs_read_failed", format!("无法访问 {dir_rel}：{e}"))
            .param("rel", dir_rel)
            .param("reason", e.to_string())
    })?;
    if !meta.is_dir() {
        return Err(CommandError::new(
            "fs_path_invalid",
            format!("{dir_rel} 不是目录"),
        ));
    }
    // **这里刻意不读该目录自带的 `.gitignore`**（M292 r1 评审 P1-1 的落点，design §4.2/§4.9）：
    //
    // - 用户展开的目录**是惰性目录**时（本命令的主要形态），它的祖先已被排除——gitignore 的
    //   「祖先被排除 ⇒ 子孙全被排除」意味着该子树内部一切仍是惰性，**不必**也不许在子树里重读
    //   规则。真读了会出事：嵌套来源的 Whitelist（如 `.local/.gitignore` 里的 `!keep.md`）是
    //   比根来源更深的「确定结论」，会短路掉根来源的祖先排除判定 ⇒ `keep.md` 从 Lazy 翻成
    //   Visible ⇒ 索引的纯函数口径、惰性展开（翻成 Visible 的子目录展开即空目录）与物化事件闸
    //   三处一起破，且违反 git 语义（排除目录下不可 re-include）。
    // - 用户对**可见**目录调用本命令时，该目录的嵌套 `.gitignore` 在装载时的递归枚举里已经由
    //   `scan_workspace_at` 登记过；会话内新建的目录则按「规则改动下次装载生效」等到下次装载。
    let rd = std::fs::read_dir(&dir).map_err(|e| {
        CommandError::new(
            "fs_scan_failed",
            format!("无法读取目录 {}：{e}", dir.display()),
        )
        .param("rel", dir.display())
        .param("reason", e.to_string())
    })?;
    let mut entries = Vec::new();
    for item in rd {
        let item = item.map_err(|e| {
            CommandError::new(
                "fs_scan_failed",
                format!("无法读取目录 {} 下的条目：{e}", dir.display()),
            )
            .param("rel", dir.display())
            .param("reason", e.to_string())
        })?;
        let name = item.file_name();
        let path = item.path();
        let ft = match item.file_type() {
            Ok(ft) => ft,
            Err(_) => continue, // 枚举期间被删的条目直接跳过（同 scan_workspace）
        };
        let Some(name_str) = name.to_str() else {
            continue;
        };
        // vault 相对路径在本函数里**按 dir_rel 拼接**得到，而不是对绝对路径做 strip_prefix：
        // `resolve_in_vault` 返回的是规范化后的路径（macOS 上 `/var` → `/private/var`），
        // 与调用方给的 root 原样前缀未必相等——strip 一旦失配会把整层条目静默丢光。
        let rel = join_rel(dir_rel, name_str);
        let kind = if ft.is_dir() {
            FsEntryKind::Dir
        } else {
            FsEntryKind::File
        };
        match policy.classify(&rel, kind == FsEntryKind::Dir) {
            EntryClass::Hidden => {
                if is_lumir_tmp(&name) {
                    remove_ghost_tmp_if_stale(&path, SystemTime::now());
                }
                continue;
            }
            EntryClass::Lazy => {}
            EntryClass::Visible => {}
        }
        let meta = std::fs::symlink_metadata(&path).ok();
        let lazy = policy.user_ignored(&rel, kind == FsEntryKind::Dir);
        entries.push(FsEntry {
            path: rel,
            kind,
            size: meta.as_ref().filter(|m| m.is_file()).map_or(0, |m| m.len()),
            mtime_ms: meta.as_ref().and_then(mtime_ms),
            lazy,
        });
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    if !dir_rel.is_empty() {
        policy.mark_materialized(dir_rel);
    }
    Ok(entries)
}

/// vault 内路径的**批量存在探测**（change vault-open-ignore-set §4.11）：收一组 vault 相对
/// 路径，返回其中确实存在的那些（保持入参顺序、去重）。
///
/// 存在的理由：「装载时的枚举结果不再是 vault 内文件的全集」——被用户规则命中的惰性条目
///（含其子树里的文件）在文件树里可见、可打开，却永不进枚举结果，所以「这个路径还在不在
/// vault 里」的判据不能只看枚举集（消费方：会话恢复的跳过计数、阅读位置的存量键修剪）。
///
/// **这是路径约束的有意例外**：越界（绝对路径 / `..` / 符号链接逃逸）与不存在对调用方同义
/// （都不在 vault 内），逐条报错会让调用方无法区分二者、也没有任何处置差异。例外仅限「不逐条
/// 返回错误」：边界校验本身照旧执行（[`resolve_in_vault`]，形状越界在任何文件系统访问之前
/// 就被拒），越界路径 MUST NOT 被 stat、MUST NOT 读到 vault 外的任何信息，也 MUST NOT 因此
/// 放宽任何读取路径的约束。本函数只 stat，MUST NOT 创建 / 改写 / 删除任何文件。
pub fn paths_exist(root: &Path, paths: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for rel in paths {
        if out.iter().any(|seen| seen == rel) {
            continue;
        }
        if resolve_in_vault(root, rel).is_ok() {
            out.push(rel.clone());
        }
    }
    out
}

/// 目录绝对路径 → vault 相对路径（`""` = 根）；不是 vault 内路径时为 None。
fn rel_dir_string(root: &Path, dir: &Path) -> Option<String> {
    let parts: Vec<&str> = dir
        .strip_prefix(root)
        .ok()?
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect();
    Some(parts.join("/"))
}

/// 单个条目的惰性标记：用户规则命中 ⇒ true（`scan_workspace` 用；懒封装只为可读）。
fn lazy_of(policy: &IgnorePolicy, rel: &str, is_dir: bool) -> bool {
    policy.user_ignored(rel, is_dir)
}

/// vault 内路径约束（安全边界，不依赖调用方自觉）：
/// 拒绝绝对路径、`..` 穿越、符号链接逃逸；目标必须存在。
/// 返回规范化后的绝对路径。
pub fn resolve_in_vault(root: &Path, rel: &str) -> Result<PathBuf, CommandError> {
    let rel_path = Path::new(rel);
    if rel.is_empty() {
        return Err(CommandError::new("fs_path_invalid", "路径为空"));
    }
    if rel_path.is_absolute() {
        return Err(CommandError::new(
            "fs_path_escape",
            format!("只允许 vault 内的相对路径：{rel}"),
        )
        .param("rel", rel));
    }
    if rel_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(
            CommandError::new("fs_path_escape", format!("路径不允许包含 ..：{rel}"))
                .param("rel", rel),
        );
    }
    let candidate = root.join(rel_path);
    let canon = candidate.canonicalize().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            CommandError::new("fs_not_found", format!("文件不存在：{rel}")).param("rel", rel)
        } else {
            CommandError::new("fs_read_failed", format!("无法访问 {rel}：{e}"))
                .param("rel", rel)
                .param("reason", e.to_string())
        }
    })?;
    let canon_root = root.canonicalize().map_err(|e| {
        CommandError::new(
            "fs_root_invalid",
            format!("无法解析 vault 根 {}：{e}", root.display()),
        )
        .param("root", root.display())
        .param("reason", e.to_string())
    })?;
    if !canon.starts_with(&canon_root) {
        return Err(CommandError::new(
            "fs_path_escape",
            format!("路径指向 vault 之外（符号链接逃逸）：{rel}"),
        )
        .param("rel", rel));
    }
    Ok(canon)
}

/// 路径的父段（vault 相对，`/` 分隔）：`a/b/c` → `a/b`，无父段则空串。
fn parent_rel_of(rel: &str) -> &str {
    match rel.rfind('/') {
        Some(i) => &rel[..i],
        None => "",
    }
}

/// 拼接 vault 相对路径（父段为空串即根下条目）。
fn join_rel(parent_rel: &str, name: &str) -> String {
    if parent_rel.is_empty() {
        name.to_string()
    } else {
        format!("{parent_rel}/{name}")
    }
}

/// 新建 / 改名的末段名校验（**唯一一份**，五个写类命令共用；内置规则复用
/// [`builtin_matcher`] 的同一份表，不另抄一份列表——REVIEW.md 第 8 条）。
///
/// 规则（design §2.3）：非空、不含 `/`、不是 `.` / `..`、不命中**内置规则**。最后那条
/// 不是洁癖：`.git` / `target` 这类名字建/改出来不进文件树、watch 事件也被挡下，用户在界面上
/// 既看不到也删不掉——静默丢失的温床，因此在入口就拒绝。
///
/// **用户规则命中的名字 MUST NOT 被拒绝**（§3.2）：那样名字本来就可见、可打开，只是不进索引。
pub fn validate_new_name(name: &str) -> Result<(), CommandError> {
    if name.is_empty() {
        return Err(CommandError::new("fs_name_invalid", "名称不能为空"));
    }
    if name.contains('/') {
        return Err(CommandError::new(
            "fs_name_invalid",
            format!("名称不能包含斜杠：{name}"),
        ));
    }
    if name == "." || name == ".." {
        return Err(CommandError::new(
            "fs_name_invalid",
            format!("{name} 不是有效的名称"),
        ));
    }
    if is_builtin_name(name) {
        return Err(CommandError::new(
            "fs_name_invalid",
            format!("{name} 在忽略集内，建成后不会出现在文件树里"),
        ));
    }
    Ok(())
}

/// 新建 / 改名的目标解析变体（写类命令的**共用一个入口**，安全边界不分散）。
///
/// 与 [`resolve_in_vault`] 的差别：目标**允许不存在**。因此父目录仍走
/// `resolve_in_vault`（继承全部逃逸防护：绝对路径 / `..` / 符号链接逃逸），
/// 末段名单独过 [`validate_new_name`]，join 之后只做 `symlink_metadata` 存在性探测
/// ——已存在即 `fs_already_exists`（不跟随后续 canonicalize，目标本来就允许不存在）。
/// 这条探测是**早失败的人话错误**，不是「撞名不覆盖」的保证本身——两种调用方的保证来源
/// 不同，别在这里读出一条不存在的原子性：
///
/// - [`create_file_entry`] / [`create_dir_entry`]：保证来自创建调用本身
///   （`create_new(true)` / `create_dir` 撞名即失败），**不存在**检查-创建窗口。
/// - [`rename_entry`]：`std::fs::rename` 的 POSIX 语义是**原子替换**已存在的目标，因此
///   这里的探测与随后的 `rename` 之间确实有一个检查-执行窗口（`rename_entry` 在写路径上
///   又显式复查了一次，把窗口收窄到两次系统调用之间；真要做到零窗口需要平台的原子排他改名，
///   本批不做——[`rename_entry`] 的注释写明取舍）。
pub fn resolve_new_in_vault(
    root: &Path,
    parent_rel: &str,
    name: &str,
) -> Result<PathBuf, CommandError> {
    validate_new_name(name)?;
    let parent = if parent_rel.is_empty() {
        root.canonicalize().map_err(|e| {
            CommandError::new(
                "fs_root_invalid",
                format!("无法解析 vault 根 {}：{e}", root.display()),
            )
            .param("root", root.display())
            .param("reason", e.to_string())
        })?
    } else {
        resolve_in_vault(root, parent_rel)?
    };
    let meta = std::fs::metadata(&parent).map_err(|e| {
        CommandError::new("fs_read_failed", format!("无法访问 {parent_rel}：{e}"))
            .param("rel", parent_rel)
            .param("reason", e.to_string())
    })?;
    if !meta.is_dir() {
        return Err(CommandError::new(
            "fs_path_invalid",
            format!("{parent_rel} 不是目录"),
        ));
    }
    let target = parent.join(name);
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err(CommandError::new(
            "fs_already_exists",
            format!("已存在同名条目：{}", join_rel(parent_rel, name)),
        )
        .param("path", join_rel(parent_rel, name)));
    }
    Ok(target)
}

/// 移到系统废纸篓（裁决点 2）：删除必须可恢复，MUST NOT 提供永久删除路径。
///
/// 目录连子孙整棵入篓由 `trash` 的平台语义承担（macOS = NSFileManager 的 trashItem，
/// 在 Finder 里可整体放回）。失败即报错且**不留半删除状态**——crate 的删除是单次系统
/// 调用语义，这也是提示语里「未删除任何内容」承诺的依据（design §3.1）。
pub fn trash_entry(root: &Path, rel: &str) -> Result<(), CommandError> {
    let abs = resolve_in_vault(root, rel)?;
    // 空 rel 已在 resolve_in_vault 里被拒（fs_path_invalid）；这里再挡一次「解析结果
    // 就是 vault 根」的形态（防御性：vault 根永远不进废纸篓）。
    let canon_root = root.canonicalize().map_err(|e| {
        CommandError::new(
            "fs_root_invalid",
            format!("无法解析 vault 根 {}：{e}", root.display()),
        )
        .param("root", root.display())
        .param("reason", e.to_string())
    })?;
    if abs == canon_root {
        return Err(CommandError::new(
            "fs_trash_failed",
            format!("不能把 vault 根目录移到废纸篓：{rel}"),
        )
        .param("rel", rel));
    }
    trash::delete(&abs).map_err(|e| {
        // trash::Error 的 Display 是内部 Debug 结构（英文、带字段名），人话在前、
        // 原始错误附在尾部只作排查线索。
        CommandError::new(
            "fs_trash_failed",
            format!("移到废纸篓失败：{rel}——未删除任何内容（{e}）"),
        )
        .param("rel", rel)
    })
}

/// 同目录改末段名（v1 不支持跨目录移动，proposal 非目标）。源走 [`resolve_in_vault`]，
/// 目标走 [`resolve_new_in_vault`]（父 = 源的父目录），并在**写路径上再复查一次**目标是否
/// 已存在——MUST NOT 覆盖既有条目。返回改名后的 vault 相对路径。
///
/// 为什么写路径要再查一次：`std::fs::rename` 的 POSIX 语义是**原子替换**已存在的目标
/// （不是「撞名即失败」），所以 `resolve_new_in_vault` 里那次探测与这里的 `rename` 之间
/// 存在真实的检查-执行窗口——窗口内外部进程在目标名建出的文件会被静默覆盖。这个复查把窗口
/// 收窄到两次系统调用之间，代价是一次 `symlink_metadata`；风险本身极低（单用户本地 vault、
/// 亚毫秒窗口、需外部进程精准撞名），失败方向也安全（宁可多报一次「已存在」也不覆盖）。
/// 真要做到零窗口需要平台的原子排他改名（macOS 的 `renamex_np(RENAME_EXCL)`，其余平台各有
/// 对应物），本批不做：那要引 libc/平台分支，收益与风险不成比例。**因此「撞名不覆盖」在
/// rename 这条路上是「复查 + 极窄窗口」，不是原子保证**——别在别处读成更强的东西。
pub fn rename_entry(root: &Path, rel: &str, new_name: &str) -> Result<String, CommandError> {
    let from = resolve_in_vault(root, rel)?;
    let parent_rel = parent_rel_of(rel).to_string();
    let to = resolve_new_in_vault(root, &parent_rel, new_name)?;
    // 写路径复查（见上面注释）：与 create 路径同一个错误码与同一句话，前端不必分辨来源。
    if std::fs::symlink_metadata(&to).is_ok() {
        return Err(CommandError::new(
            "fs_already_exists",
            format!("已存在同名条目：{}", join_rel(&parent_rel, new_name)),
        )
        .param("path", join_rel(&parent_rel, new_name)));
    }
    std::fs::rename(&from, &to).map_err(|e| {
        CommandError::new(
            "fs_rename_failed",
            format!("改名失败：{rel} → {new_name}（{e}）"),
        )
        .param("rel", rel)
        .param("newName", new_name)
        .param("reason", e.to_string())
    })?;
    Ok(join_rel(&parent_rel, new_name))
}

/// 跨目录移动 / 重命名（change add-harness-permission-modes，design §5.2）：源与目标**两端都走
/// vault 内约束**（[`resolve_in_vault`] + [`resolve_new_in_vault`]，逃逸防护与既有写入口同一套）。
///
/// - **MUST NOT 覆盖**既有条目：与 [`rename_entry`] 同口径——`resolve_new_in_vault` 的存在性
///   探测 + 写路径复查两次 `symlink_metadata`，把窗口收窄到两次系统调用之间。`std::fs::rename`
///   的 POSIX 语义是**原子替换**，因此这仍是「复查 + 极窄窗口」，**不是原子保证**（别在别处读成
///   更强的东西；零窗口需要平台原子排他改名，本批不做）。
/// - **目标父目录必须已存在**：不隐式建目录（要建目录用 vault_create 的自动建父目录，或
///   cli_run 的 mkdir 写命令逐个问）。
/// - **跨卷**：`std::fs::rename` 跨卷直接失败 ⇒ 如实报 `fs_move_failed`，**不做**静默
///   copy+delete（半失败状态——源已删、目标只写了一半——比报错糟得多）。
pub fn fs_move_entry(root: &Path, from_rel: &str, to_rel: &str) -> Result<String, CommandError> {
    let from = resolve_in_vault(root, from_rel)?;
    let to_name = match to_rel.rsplit('/').next() {
        Some(name) if !name.is_empty() => name,
        _ => {
            return Err(
                CommandError::new("fs_path_invalid", format!("目标路径无效：{to_rel}"))
                    .param("path", to_rel),
            )
        }
    };
    let to_parent_rel = parent_rel_of(to_rel);
    let to = resolve_new_in_vault(root, to_parent_rel, to_name)?;
    // 写路径复查（撞名不覆盖，见本函数文档的取舍说明）。
    if std::fs::symlink_metadata(&to).is_ok() {
        return Err(
            CommandError::new("fs_already_exists", format!("已存在同名条目：{to_rel}"))
                .param("path", to_rel),
        );
    }
    std::fs::rename(&from, &to).map_err(|e| {
        CommandError::new(
            "fs_move_failed",
            format!("移动失败：{from_rel} → {to_rel}（{e}）——未覆盖任何既有内容"),
        )
        .param("rel", from_rel)
        .param("newPath", to_rel)
        .param("reason", e.to_string())
    })?;
    Ok(to_rel.to_string())
}

/// 在目录下新建**空文件**（§3.5）：目标走 [`resolve_new_in_vault`]，创建用
/// `create_new(true)` 的原子语义——撞名由内核裁定，MUST NOT 覆盖既有文件。
/// 返回新建条目的 vault 相对路径。
pub fn create_file_entry(
    root: &Path,
    parent_rel: &str,
    name: &str,
) -> Result<String, CommandError> {
    let target = resolve_new_in_vault(root, parent_rel, name)?;
    let path = join_rel(parent_rel, name);
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(_) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(CommandError::new(
            "fs_already_exists",
            format!("已存在同名条目：{path}"),
        )
        .param("path", path)),
        Err(e) => Err(
            CommandError::new("fs_create_failed", format!("无法新建 {path}：{e}"))
                .param("path", path)
                .param("reason", e.to_string()),
        ),
    }
}

/// 在目录下新建子目录（§3.6）：与 [`create_file_entry`] 同构，`create_dir` 本身撞名即报
/// `AlreadyExists`，原子语义等价。新建目录 MUST NOT 自动展开父目录（折叠态是用户状态）。
pub fn create_dir_entry(root: &Path, parent_rel: &str, name: &str) -> Result<String, CommandError> {
    let target = resolve_new_in_vault(root, parent_rel, name)?;
    let path = join_rel(parent_rel, name);
    match std::fs::create_dir(&target) {
        Ok(()) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(CommandError::new(
            "fs_already_exists",
            format!("已存在同名条目：{path}"),
        )
        .param("path", path)),
        Err(e) => Err(
            CommandError::new("fs_create_failed", format!("无法新建 {path}：{e}"))
                .param("path", path)
                .param("reason", e.to_string()),
        ),
    }
}

/// 单文件 mtime（Unix 毫秒，M218 doc-meta「修改于」的数据源）：路径口径与读取链路
/// 同一个 `resolve_in_vault`；mtime 取不到（权限 / 平台不支持）为 `Ok(None)`，
/// 与 `FsEntry.mtime_ms` 同口径。
pub fn file_mtime_ms(root: &Path, rel: &str) -> Result<Option<i64>, CommandError> {
    let path = resolve_in_vault(root, rel)?;
    let meta = std::fs::metadata(&path).map_err(|e| {
        CommandError::new("fs_read_failed", format!("无法读取 {rel}：{e}"))
            .param("rel", rel)
            .param("reason", e.to_string())
    })?;
    Ok(mtime_ms(&meta))
}

/// 读取 vault 内文件并校验大小上限（人话错误，不分配超限内存）。
fn read_file_bytes(root: &Path, rel: &str, max: u64) -> Result<Vec<u8>, CommandError> {
    let path = resolve_in_vault(root, rel)?;
    let meta = std::fs::metadata(&path).map_err(|e| {
        CommandError::new("fs_read_failed", format!("无法读取 {rel}：{e}"))
            .param("rel", rel)
            .param("reason", e.to_string())
    })?;
    if !meta.is_file() {
        return Err(
            CommandError::new("fs_not_a_file", format!("{rel} 不是文件（可能是目录）"))
                .param("rel", rel),
        );
    }
    if meta.len() > max {
        return Err(CommandError::new(
            "fs_too_large",
            format!(
                "文件 {rel} 大小 {}MB，超过 {}MB 上限，已拒绝读取",
                meta.len() / (1024 * 1024),
                max / (1024 * 1024)
            ),
        )
        .param("rel", rel)
        .param("mb", meta.len() / (1024 * 1024))
        .param("limit", max / (1024 * 1024)));
    }
    std::fs::read(&path).map_err(|e| {
        CommandError::new("fs_read_failed", format!("无法读取 {rel}：{e}"))
            .param("rel", rel)
            .param("reason", e.to_string())
    })
}

/// 读文本文件：UTF-8 解码，非法编码返回人话错误，不静默替换字符。
pub fn read_text_file(root: &Path, rel: &str) -> Result<String, CommandError> {
    let bytes = read_file_bytes(root, rel, ATTACHMENT_MAX_BYTES)?;
    String::from_utf8(bytes).map_err(|_| {
        CommandError::new(
            "fs_invalid_utf8",
            format!("文件 {rel} 不是合法 UTF-8 编码（可能是 GBK 等其他编码），暂不支持读取"),
        )
        .param("rel", rel)
    })
}

pub fn file_revision(root: &Path, rel: &str) -> Result<String, CommandError> {
    use sha2::{Digest, Sha256};
    let bytes = read_file_bytes(root, rel, ATTACHMENT_MAX_BYTES)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub fn read_text_snapshot(root: &Path, rel: &str) -> Result<(String, String), CommandError> {
    use sha2::{Digest, Sha256};
    let bytes = read_file_bytes(root, rel, ATTACHMENT_MAX_BYTES)?;
    let revision = format!("{:x}", Sha256::digest(&bytes));
    let content = String::from_utf8(bytes).map_err(|_| {
        CommandError::new(
            "fs_invalid_utf8",
            format!("文件 {rel} 不是合法 UTF-8 编码（可能是 GBK 等其他编码），暂不支持读取"),
        )
        .param("rel", rel)
    })?;
    Ok((content, revision))
}

/// `document_save` 拒绝保存的扩展名（image / binary 两类，升序）。
///
/// **事实源是前端的 `src/preview/attachments.ts` 注册表**（image MIME 键 + 二进制扩展名
/// 两张表），本表是 Rust 侧的第二份——为的是「前端 bug 不得把内存内容写进图片/二进制路径」
/// 这条后端防线（M130 起有，editable-non-md-files 把 md 白名单换成这张拒绝清单）。
/// 两侧逐项对账的机器检查在 `tests/unit/registry-drift.test.ts`：它读本文件、解析本表、
/// 与注册表求差集，任一侧漂移即红（REVIEW.md 第 8 条——同一语义两处真源、改动只落一处）。
/// 改本表之前先改注册表。
const SAVE_REJECTED_EXTENSIONS: [&str; 47] = [
    "7z", "app", "avi", "avif", "bmp", "class", "db", "dll", "dmg", "doc", "docx", "dylib", "exe",
    "fig", "flac", "gif", "gz", "heic", "icns", "ico", "jar", "jpeg", "jpg", "mkv", "mov", "mp3",
    "mp4", "otf", "pdf", "png", "ppt", "pptx", "rar", "sketch", "so", "sqlite", "svg", "tar",
    "ttf", "wasm", "wav", "webp", "woff", "woff2", "xls", "xlsx", "zip",
];

/// 路径的扩展名（小写、不含点）；basename 无点（`LICENSE`/`Makefile`）返回空串——与
/// `src/preview/attachments.ts` 的 `extensionOf` 同口径（只按 basename 里最后一个点切分，
/// dotfile `.gitignore` 因此得到 `gitignore`）。
fn extension_of(rel: &str) -> String {
    let base = rel.rsplit('/').next().unwrap_or(rel);
    match base.rfind('.') {
        Some(dot) => base[dot + 1..].to_ascii_lowercase(),
        None => String::new(),
    }
}

/// 文档落盘的共用写核心：同目录 `.lumir-` 临时文件 + `sync_all` + 原子 rename。
///
/// `document_save` 与 [`fs_patch_file`] **共用这一份**（REVIEW.md 第 8 条：同一语义不留两处
/// 实现）——「局部 patch 与整文件保存走同一套写纪律」因此是结构性的，不是巧合。三条纪律：
/// - **`.lumir-` 标记**：tmp 名形如 `.{name}.lumir-{pid}`，命中忽略集（[`LUMIR_TMP_PATTERNS`]），
///   因此写入过程不在文件树 / watch 流里留下临时条目（`fs-io` spec 的「局部 patch 写入」把
///   这层口径称作写盘方的自身标记）；
/// - **ghost 重试**：`create_new` 撞上同名文件 = 上次保存进程崩溃留下的残留（tmp 名含自身
///   pid，活着的进程互不挡道），删掉重试一次；再失败才是真错误；
/// - **失败即清理 tmp**，不留半截目标文件。
fn write_document_atomic(target: &Path, content: &str) -> Result<(), CommandError> {
    let parent = target
        .parent()
        .ok_or_else(|| CommandError::new("fs_path_invalid", "目标目录无效"))?;
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document");
    let tmp = parent.join(format!(".{name}.lumir-{}", std::process::id()));
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
    {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let _ = std::fs::remove_file(&tmp);
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp)
            {
                Ok(file) => file,
                Err(e) => {
                    return Err(CommandError::new(
                        "document_write_failed",
                        format!("无法创建临时文件：{e}"),
                    ))
                }
            }
        }
        Err(e) => {
            return Err(CommandError::new(
                "document_write_failed",
                format!("无法创建临时文件：{e}"),
            ))
        }
    };
    use std::io::Write;
    if let Err(e) = file.write_all(content.as_bytes()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(CommandError::new(
            "document_write_failed",
            format!("无法写入文档：{e}"),
        ));
    }
    if let Err(e) = file.sync_all() {
        let _ = std::fs::remove_file(&tmp);
        return Err(CommandError::new(
            "document_write_unknown",
            format!("文档写入结果未知：{e}"),
        ));
    }
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(CommandError::new(
            "document_write_unknown",
            format!("文档替换结果未知：{e}"),
        ));
    }
    Ok(())
}

/// 保存 vault 内文本文档：原子替换 + revision CAS。
///
/// 可保存面（editable-non-md-files，裁决 D1/D3）= 注册表全部文本类：`.md`/`.markdown`、
/// 已知代码扩展、未收录扩展、dotfile 与 basename 无点的文件——即除 image/binary 之外的一切。
/// 守卫从 md 白名单翻转为**拒绝清单**（[`SAVE_REJECTED_EXTENSIONS`]）：image/binary 类扩展名
/// 返回 `fs_read_only`，MUST NOT 写入任何字节。（原函数名 `save_markdown` 随语义放宽改为
/// `save_document`；command 名 `document_save` 本来就叫 document，前端 IPC 零改动。）
///
/// 落盘走 [`write_document_atomic`]——**局部 patch 走的是同一个函数**，两者的写纪律
/// （`.lumir-` 标记 / ghost 重试 / 原子替换）因此逐条同源。
pub fn save_document(
    root: &Path,
    rel: &str,
    expected_revision: &str,
    content: &str,
) -> Result<String, CommandError> {
    if SAVE_REJECTED_EXTENSIONS.contains(&extension_of(rel).as_str()) {
        return Err(CommandError::new(
            "fs_read_only",
            "不支持保存该文件类型（图片 / 二进制文件）",
        ));
    }
    let target = resolve_in_vault(root, rel)?;
    let actual = file_revision(root, rel)?;
    if actual != expected_revision {
        return Err(CommandError::new(
            "document_conflict",
            "文件已被外部修改，请先协调冲突",
        ));
    }
    write_document_atomic(&target, content)?;
    file_revision(root, rel).map_err(|e| {
        CommandError::new(
            "document_write_unknown",
            format!("文档替换后无法确认结果：{}", e.message),
        )
    })
}

/// 一次局部编辑（`fs_patch_file` 的输入单元，change add-harness-probe §7）：
/// 把 `old_string` 换成一处的 `new_string`。字段名与 harness 工具 `vault_patch` 的 JSON 形状
/// 一致（`{"old_string": …, "new_string": …}`），运行时（M302）可直接反序列化。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatchEdit {
    pub old_string: String,
    pub new_string: String,
}

/// **唯一**能改写既有文档的能力（change add-harness-probe §7，ADR 0003 §3 在 agent 写入侧的
/// 延伸）：对 vault 内既有文本文件应用一组编辑。
///
/// 不变量（逐条都有单测）：
/// 1. **唯一命中**：每个 `old_string` 在**应用它的那一刻**的文本里必须恰好命中一次——0 次
///    返回 `patch_not_found`，多次返回 `patch_not_unique`，错误里带命中次数与编辑序号（回送
///    模型即可据此重试）。整组编辑因此是全有或全无：失败时文件逐字节不变。
///    编辑**按数组顺序逐个应用**（后一条看得到前一条的结果）——顺序语义是确定性的，也是
///    unified diff 预览（M302）能对齐的前提。
/// 2. **逐字节不变**：只替换命中的那一段，其余字节原样保留（替换在解码后的 `String` 上做，
///    写回是同一份 `String` 的编码——合法 UTF-8 输入下逐字节等价）。
/// 3. **CAS**：调用方持有的 `expected_revision`（SHA-256）与当前文件不一致即 `document_conflict`
///    ——与 [`save_document`] 完全同一套口径（同一份 `file_revision` / 同一句人话）。
/// 4. **写纪律**：落盘走 [`write_document_atomic`]（与保存同一个函数）：`.lumir-` 临时文件 +
///    原子 rename，临时文件命中忽略集 ⇒ 不在文件树 / watch 流里冒出自家的临时条目。
///    被 patch 文件的**打开中会话经既有 watch → 会话刷新通路同步**（`fs:entry_changed` 的
///    外部变更分流，`src/save-controller.ts`）——本函数 MUST NOT 绕过那条通路去「静默改盘」：
///    它只负责把磁盘改对，编辑器同步交给既有链路。
/// 5. **类型守卫**：image/binary 扩展名拒绝（`fs_read_only`，沿用 [`save_document`] 的
///    [`SAVE_REJECTED_EXTENSIONS`] 口径），判定先于任何 IO。
///
/// 空 `edits`、空 `old_string` 返回 `patch_invalid`（空串没有唯一命中语义，不能滑成「插入」）。
pub fn fs_patch_file(
    root: &Path,
    rel: &str,
    edits: &[PatchEdit],
    expected_revision: &str,
) -> Result<String, CommandError> {
    if SAVE_REJECTED_EXTENSIONS.contains(&extension_of(rel).as_str()) {
        return Err(CommandError::new(
            "fs_read_only",
            "不支持修改该文件类型（图片 / 二进制文件）",
        ));
    }
    if edits.is_empty() {
        return Err(
            CommandError::new("patch_invalid", "edits 为空，没有可应用的编辑").param("rel", rel),
        );
    }
    let target = resolve_in_vault(root, rel)?;
    let bytes = read_file_bytes(root, rel, ATTACHMENT_MAX_BYTES)?;
    let actual = {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(&bytes))
    };
    if actual != expected_revision {
        return Err(
            CommandError::new("document_conflict", "文件已被外部修改，请先协调冲突")
                .param("rel", rel),
        );
    }
    let mut content = String::from_utf8(bytes).map_err(|_| {
        CommandError::new(
            "fs_invalid_utf8",
            format!("文件 {rel} 不是合法 UTF-8 编码（可能是 GBK 等其他编码），暂不支持修改"),
        )
        .param("rel", rel)
    })?;

    for (index, edit) in edits.iter().enumerate() {
        if edit.old_string.is_empty() {
            return Err(CommandError::new(
                "patch_invalid",
                format!("第 {} 处编辑的 old_string 为空串", index + 1),
            )
            .param("rel", rel)
            .param("index", index + 1));
        }
        let hits: Vec<usize> = content
            .match_indices(edit.old_string.as_str())
            .map(|(start, _)| start)
            .collect();
        match hits.as_slice() {
            [start] => {
                content.replace_range(*start..*start + edit.old_string.len(), &edit.new_string);
            }
            [] => {
                return Err(CommandError::new(
                    "patch_not_found",
                    format!(
                        "第 {} 处编辑的 old_string 在 {rel} 中命中 0 次（要求恰好 1 次），已拒绝整组编辑",
                        index + 1
                    ),
                )
                .param("rel", rel)
                .param("index", index + 1)
                .param("count", 0));
            }
            _ => {
                let count = hits.len();
                return Err(CommandError::new(
                    "patch_not_unique",
                    format!(
                        "第 {} 处编辑的 old_string 在 {rel} 中命中 {count} 次（要求恰好 1 次），已拒绝整组编辑",
                        index + 1
                    ),
                )
                .param("rel", rel)
                .param("index", index + 1)
                .param("count", count));
            }
        }
    }

    write_document_atomic(&target, &content)?;
    file_revision(root, rel).map_err(|e| {
        CommandError::new(
            "document_write_unknown",
            format!("文档替换后无法确认结果：{}", e.message),
        )
    })
}

/// `mkdir -p` 语义的父目录补建（**唯一一份**，`vault_create_file` 专用；`create_file_entry` /
/// 树界面的新建仍要求父目录已存在——那条路径的父目录来自用户选中的目录，够不到这里）。
///
/// 两趟：先**逐段校验**（`..` 逃逸、内置忽略名），全部合法才开始建——校验失败的输入不留下
/// 半截目录（先建后校验会把 `keep/.git/x.md` 里的 `keep` 建出来再报错）。再逐段下探：已存在的
/// 段 canonicalize 后必须在 vault 内（挡住符号链接逃逸），缺的段用 `create_dir` 建出。
fn ensure_parent_dirs(root: &Path, parent_rel: &str) -> Result<(), CommandError> {
    let segments: Vec<&str> = parent_rel
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect();
    for segment in &segments {
        if *segment == ".." {
            return Err(CommandError::new(
                "fs_path_escape",
                format!("路径不允许包含 ..：{parent_rel}"),
            )
            .param("rel", parent_rel));
        }
        if is_builtin_name(segment) {
            return Err(CommandError::new(
                "fs_name_invalid",
                format!("{segment} 在忽略集内，建在它里面的文件不会出现在文件树里"),
            )
            .param("rel", parent_rel));
        }
    }
    let root_canon = root.canonicalize().map_err(|e| {
        CommandError::new(
            "fs_root_invalid",
            format!("无法解析 vault 根 {}：{e}", root.display()),
        )
        .param("root", root.display())
        .param("reason", e.to_string())
    })?;
    let mut current = root_canon.clone();
    for segment in segments {
        let next = current.join(segment);
        match std::fs::symlink_metadata(&next) {
            Ok(meta) => {
                let canon = next.canonicalize().map_err(|e| {
                    CommandError::new("fs_read_failed", format!("无法访问 {segment}：{e}"))
                        .param("rel", parent_rel)
                        .param("reason", e.to_string())
                })?;
                if !canon.starts_with(&root_canon) {
                    return Err(CommandError::new(
                        "fs_path_escape",
                        format!("路径指向 vault 之外（符号链接逃逸）：{parent_rel}"),
                    )
                    .param("rel", parent_rel));
                }
                if !meta.is_dir() {
                    return Err(CommandError::new(
                        "fs_path_invalid",
                        format!("{parent_rel} 里有同名文件、不是目录"),
                    )
                    .param("rel", parent_rel));
                }
                current = canon;
            }
            Err(_) => {
                std::fs::create_dir(&next).map_err(|e| {
                    CommandError::new("fs_create_failed", format!("无法新建目录 {segment}：{e}"))
                        .param("rel", parent_rel)
                        .param("reason", e.to_string())
                })?;
                // 新建段不可能含符号链接；canonicalize 一次让后续段基于真实路径下探。
                current = next.canonicalize().unwrap_or(next);
            }
        }
    }
    Ok(())
}

/// 新建文档（harness 的 `vault_create`，change add-harness-probe §7）：O_EXCL 语义——
/// 目标已存在即 `fs_already_exists`，MUST NOT 覆盖任何既有内容。
///
/// 与 [`create_file_entry`]（建空文件）的差别只有两点：内容由调用方给出；目标按**完整
/// vault 相对路径**给出（`notes/new.md` 的父段用同一套 [`resolve_new_in_vault`] 校验）。
///
/// **父目录自动补建（mkdir -p 语义）**：change add-harness-permission-modes 修订（Alex
/// 2026-10-09 裁决）——agent 的「新建文档」可以落在还不存在的目录下，父目录逐段建出。
/// 这条修订同时吸收了一个工具缺口：模型以前要建目录只能走 cli_run 的 `mkdir`（写命令逐个问），
/// 而 mkdir 的目标在 vault 内时还会被判为「vault 内写」重定向回来（`permissions.rs` 的
/// suggested_tool 把 mkdir 映射到 vault_create）；自动建父目录让那条回路自洽。
/// 补建前**每一段**都过校验：`..` 逃逸、符号链接逃逸、内置忽略名（`.git` / `node_modules` 等）
/// 一律拒绝——建出的子树若不在文件树里，用户既看不到也删不掉（静默丢失的温床）。
///
/// image/binary 扩展名与两个既有写入口同口径拒绝（`fs_read_only`）——文本工具创造出的
/// `.png` 只会得到文件树里一个打不开、渲染不了的条目。
pub fn vault_create_file(root: &Path, rel: &str, content: &str) -> Result<String, CommandError> {
    if SAVE_REJECTED_EXTENSIONS.contains(&extension_of(rel).as_str()) {
        return Err(CommandError::new(
            "fs_read_only",
            "不支持新建该文件类型（图片 / 二进制文件）",
        ));
    }
    let name = match rel.rsplit('/').next() {
        Some(name) if !name.is_empty() => name,
        _ => {
            return Err(
                CommandError::new("fs_path_invalid", format!("目标路径无效：{rel}"))
                    .param("rel", rel),
            )
        }
    };
    let parent_rel = parent_rel_of(rel);
    ensure_parent_dirs(root, parent_rel)?;
    let target = resolve_new_in_vault(root, parent_rel, name)?;
    // O_EXCL：撞名由内核裁定（`resolve_new_in_vault` 的早失败只是人话提示，保证在这里）。
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(
                CommandError::new("fs_already_exists", format!("已存在同名条目：{rel}"))
                    .param("path", rel),
            )
        }
        Err(e) => {
            return Err(
                CommandError::new("fs_create_failed", format!("无法新建 {rel}：{e}"))
                    .param("path", rel)
                    .param("reason", e.to_string()),
            )
        }
    };
    use std::io::Write;
    if let Err(e) = file.write_all(content.as_bytes()) {
        // 写失败不留半截新文件（新建路径没有「旧内容」可回退，只能删掉自己刚建的这一个）。
        let _ = std::fs::remove_file(&target);
        return Err(
            CommandError::new("fs_create_failed", format!("无法写入 {rel}：{e}"))
                .param("path", rel)
                .param("reason", e.to_string()),
        );
    }
    if let Err(e) = file.sync_all() {
        let _ = std::fs::remove_file(&target);
        return Err(
            CommandError::new("fs_create_failed", format!("无法写入 {rel}：{e}"))
                .param("path", rel)
                .param("reason", e.to_string()),
        );
    }
    Ok(rel.to_string())
}

/// 读二进制附件：返回 base64（裁决点 A：invoke + base64 形态）。
pub fn read_attachment(root: &Path, rel: &str) -> Result<String, CommandError> {
    let bytes = read_file_bytes(root, rel, ATTACHMENT_MAX_BYTES)?;
    Ok(base64_encode(&bytes))
}

/// 标准 base64（带 padding）。不引 base64 crate：tauri 传递依赖里虽有但不能直接用，
/// 手写编码器约 30 行，契合本仓低依赖取向（见 Cargo.toml 注释）。
pub fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// 把 notify 事件映射为增量清单（按 [`watch_verdict`] 过滤、转相对路径）。
/// 改名按 deleted(from) + created(to) 处理；FSEvents 的 Name(Any) 拆不出方向，
/// 由 flush 时的存在性探测兜底（见 [`refine_with_known`]）。
/// Metadata-only 事件（xattr 噪声）直接丢弃，避免污染 dedup 后的 kind。
///
/// `lazy` 在这里只是占位（`false`）：事件本身不带条目类型，精确判定要看磁盘现状，因此在
/// [`refine_with_known`] 里按 `entry_kind` 填准（created / modified 时类型已知，§4.6）。
fn map_event(root: &Path, policy: &IgnorePolicy, ev: &notify::Event) -> Vec<FsChange> {
    use notify::event::{ModifyKind, RenameMode};
    let kind = match &ev.kind {
        EventKind::Create(_) => Some(FsChangeKind::Created),
        EventKind::Remove(_) => Some(FsChangeKind::Deleted),
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => Some(FsChangeKind::Deleted),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => Some(FsChangeKind::Created),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            // paths = [from, to]：拆成 deleted + created
            if ev.paths.len() == 2 {
                let mut out = Vec::new();
                if let Some((p, _)) = watch_verdict(policy, root, &ev.paths[0], None) {
                    out.push(FsChange {
                        kind: FsChangeKind::Deleted,
                        path: p,
                        entry_kind: None,
                        lazy: false,
                    });
                }
                if let Some((p, _)) = watch_verdict(policy, root, &ev.paths[1], None) {
                    out.push(FsChange {
                        kind: FsChangeKind::Created,
                        path: p,
                        entry_kind: None,
                        lazy: false,
                    });
                }
                return out;
            }
            Some(FsChangeKind::Modified)
        }
        // Metadata-only 事件（xattr/mtime 噪声）不影响树展示，丢弃；
        // 内容修改走 Data(_)，改名走 Name(_)
        EventKind::Modify(ModifyKind::Metadata(_)) => None,
        EventKind::Modify(_) => Some(FsChangeKind::Modified),
        _ => None,
    };
    let Some(kind) = kind else { return Vec::new() };
    ev.paths
        .iter()
        .filter_map(|p| watch_verdict(policy, root, p, None))
        .map(|(path, _)| FsChange {
            kind,
            path,
            entry_kind: None,
            lazy: false,
        })
        .collect()
}

/// kind 合并优先级：Deleted > Created > Modified。
/// 同路径在窗口内先建后删 → Deleted；先建后改 → 仍是 Created。
fn merge_kind(a: FsChangeKind, b: FsChangeKind) -> FsChangeKind {
    use FsChangeKind::*;
    let rank = |k| match k {
        Modified => 0,
        Created => 1,
        Deleted => 2,
    };
    if rank(b) >= rank(a) {
        b
    } else {
        a
    }
}

/// 同路径去重：按 [`merge_kind`] 合并，保序（首次出现的位置）。
fn dedup(changes: Vec<FsChange>) -> Vec<FsChange> {
    let mut out: Vec<FsChange> = Vec::with_capacity(changes.len());
    for c in changes {
        if let Some(slot) = out.iter_mut().find(|o| o.path == c.path) {
            slot.kind = merge_kind(slot.kind, c.kind);
        } else {
            out.push(c);
        }
    }
    out
}

/// flush 时按"已知路径集 + 存在性探测"修正 kind 并填充 entry_kind：
/// - FSEvents 新流会把近期变更重放为 Create（即使文件早已存在），
///   播种了全量枚举结果后，已知路径的 Created 修正为 Modified；
/// - 删除/改名常被上报为粗粒度 Modify，路径已不存在的统一修正为 Deleted；
/// - Deleted 但路径仍存在（窗口内删了又建）按 upsert 处理。
///
/// 同时按磁盘现状把 [`FsChange::lazy`] 填准（§4.6）：created / modified 时条目类型由
/// `entry_kind` 已知，可精确判定；被删路径 stat 不到 ⇒ 保持 `false`（deleted 方向的下游
/// 无条件移除，MUST NOT 消费这个字段，见 [`FsChange::lazy`] 的注释）。
fn refine_with_known(
    root: &Path,
    policy: &IgnorePolicy,
    known: &mut HashSet<String>,
    changes: &mut [FsChange],
) {
    for c in changes.iter_mut() {
        // entry_kind 在 flush 时按 metadata 填充（事件本身不带）；deleted 保持 null。
        // symlink_metadata 与 scan_workspace 一致（不跟随 symlink）。
        let meta = std::fs::symlink_metadata(root.join(&c.path)).ok();
        c.entry_kind = meta.as_ref().map(|m| {
            if m.is_dir() {
                FsEntryKind::Dir
            } else {
                FsEntryKind::File
            }
        });
        let exists = meta.is_some();
        if !exists {
            c.kind = FsChangeKind::Deleted;
            c.lazy = false;
            known.remove(&c.path);
            // 被删路径的物化登记随之一并清除（§4.3）：目录被删 / 改名后旧路径不再「展开着」，
            // 新路径的登记由用户下次展开时重建（登记只影响惰性子树的实时性，不影响可见性）。
            policy.forget_materialized(&c.path);
            continue;
        }
        let is_dir = c.entry_kind == Some(FsEntryKind::Dir);
        c.lazy = lazy_of(policy, &c.path, is_dir);
        let is_new = known.insert(c.path.clone());
        c.kind = if is_new {
            FsChangeKind::Created
        } else {
            FsChangeKind::Modified
        };
    }
}

/// 批次里"从无到有"的目录（Created + dir）要把**子孙**一并补进这一批（M258）。
///
/// 为什么必须在这一层补：FSEvents 对目录改名（app 内右键重命名、外部 `mv` 进 vault、解包一个
/// 已带内容的目录）**只报目录本身这一个新路径**，子孙一个都不进事件流（M258 真机探针逐字
/// 实测：`[Deleted tutorial, Created tutorials(dir)]`）。而前端收到 `deleted:old` 必须按级联
/// 清掉旧子树（`src/tree.ts` 的 applyChanges），收到 `created:new` 只能建出一个**空**的目录
/// 节点——重命名后的目录因此在树里永远展不开（改回原名同理，新一轮又是 deleted + created），
/// 直到重启全量重扫。
///
/// 不变量（本条即它的落点）：**增量收敛后的模型 = 同一时刻的全量枚举**。前端只按事件流打补丁，
/// 所以「磁盘上存在、事件流却没提过」的条目必须由这一层（唯一读得到磁盘现状的一层）补出来。
/// 批次切分也吃不掉这条：debounce 把改名的两个方向拆成两批时，`created:new` 那一批自带整棵
/// 子树，前端照样收敛出完整目录。
///
/// 已在批次里的路径不覆盖（它自带的 kind / entry_kind 由 [`refine_with_known`] 按磁盘现状定过，
/// 更权威）；补出来的路径写进 `known`——前端随这一批已经知道它存在，后续事件按 Modified 归因。
/// 相对路径口径沿用 [`rel_string`]（与全量枚举同源），符号链接不跟随（`file_type()`）。
///
/// **惰性子树不补**（§4.3）：新出现的目录若命中用户规则，本批次只带出它**这一行**
///（`lazy: true`），MUST NOT 带出子孙——那正是「按需枚举」的代价模型；它被展开时由
/// `fs_scan_dir` 取回一层。命中内置规则的条目一条都不进（与枚举同口径）。
fn expand_new_dir_subtrees(
    root: &Path,
    policy: &IgnorePolicy,
    known: &mut HashSet<String>,
    batch: &mut Vec<FsChange>,
) {
    // 广度优先：新出现的目录入队，展开时发现的子目录继续入队（父的条目先于子的条目入批次）。
    let mut queue: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for c in batch.iter() {
        if c.kind == FsChangeKind::Created
            && c.entry_kind == Some(FsEntryKind::Dir)
            && !c.lazy
            && seen.insert(c.path.clone())
        {
            queue.push(c.path.clone());
        }
    }
    let mut index = 0;
    while index < queue.len() {
        let rel_dir = queue[index].clone();
        index += 1;
        let Ok(rd) = std::fs::read_dir(root.join(&rel_dir)) else {
            continue; // 扫描期间被删：下一次事件会把它带走
        };
        for item in rd.flatten() {
            let Ok(file_type) = item.file_type() else {
                continue; // 扫描期间被删的条目直接跳过（同 scan_workspace）
            };
            let path = item.path();
            // 与枚举同口径：不是 vault 内路径 / 无法转字符串的条目一律跳过
            let Some(rel) = rel_string(root, &path) else {
                continue;
            };
            let entry_kind = if file_type.is_dir() {
                FsEntryKind::Dir
            } else {
                FsEntryKind::File
            };
            let is_dir = entry_kind == FsEntryKind::Dir;
            let lazy = match policy.classify(&rel, is_dir) {
                EntryClass::Hidden => continue, // 内置规则命中：连行都没有，不进批次
                EntryClass::Lazy => true,
                EntryClass::Visible => false,
            };
            if is_dir && !lazy && seen.insert(rel.clone()) {
                queue.push(rel.clone());
            }
            if batch.iter().any(|c| c.path == rel) {
                continue; // 自带事件：refine 已按磁盘现状定过 kind / entry_kind
            }
            batch.push(FsChange {
                kind: FsChangeKind::Created,
                path: rel.clone(),
                entry_kind: Some(entry_kind),
                lazy,
            });
            known.insert(rel);
        }
    }
}

/// 正在运行的 vault 监听器；drop 即停止监听（debounce 线程随 channel 断开退出）。
pub struct VaultWatcher {
    _watcher: notify::RecommendedWatcher,
    known: Arc<Mutex<HashSet<String>>>,
}

impl VaultWatcher {
    /// 用全量枚举结果播种已知路径集（open 流程：先 watch 再 scan 再 seed，
    /// 消除 scan→watch 之间的事件空窗）。
    pub fn seed(&self, paths: impl IntoIterator<Item = String>) {
        self.known
            .lock()
            .expect("known paths poisoned")
            .extend(paths);
    }
}

/// 启动 vault 监听：事件经 [`DEBOUNCE`] 窗口合并去重后，以批次回调交付。
/// 与枚举共用**同一份规则表**（[`IgnorePolicy`]：两来源的判定见 [`watch_verdict`]）。
/// 回调里不许 panic（会杀死 debounce 线程）。
pub fn watch(
    root: &Path,
    policy: &IgnorePolicy,
    on_batch: impl Fn(Vec<FsChange>) + Send + 'static,
) -> Result<VaultWatcher, CommandError> {
    // macOS 上 FSEvents 报告的是解析符号链接后的路径（/tmp → /private/tmp，
    // $TMPDIR → /private/var/...），strip_prefix 必须对规范化根做，否则全部失配。
    let root = root.canonicalize().map_err(|e| {
        CommandError::new(
            "fs_root_invalid",
            format!("无法解析 vault 根 {}：{e}", root.display()),
        )
        .param("root", root.display())
        .param("reason", e.to_string())
    })?;
    let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
    let root_owned = root.clone();
    let policy_for_events = policy.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        match res {
            Ok(ev) => {
                let changes = map_event(&root_owned, &policy_for_events, &ev);
                if !changes.is_empty() {
                    // receiver 已断开说明 VaultWatcher 已 drop，发送失败直接忽略
                    let _ = tx.send(changes);
                }
            }
            Err(e) => eprintln!("lumir: fs watch error: {e}"),
        }
    })
    .map_err(|e| CommandError::new("fs_watch_failed", format!("无法启动文件监听：{e}")))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| {
            CommandError::new(
                "fs_watch_failed",
                format!("无法监听目录 {}：{e}", root.display()),
            )
        })?;

    // debounce 线程：等到第一批事件后，持续收直到静默满一个窗口，
    // 再合并去重 + 已知路径集修正 kind，然后推送。
    let known = Arc::new(Mutex::new(HashSet::new()));
    let known_for_flush = known.clone();
    let root_for_flush = root.clone();
    let policy_for_flush = policy.clone();
    std::thread::Builder::new()
        .name("lumir-fs-debounce".into())
        .spawn(move || {
            let flush = |pending: &mut Vec<FsChange>| {
                let mut batch = dedup(std::mem::take(pending));
                {
                    let mut known = known_for_flush.lock().expect("known paths poisoned");
                    refine_with_known(&root_for_flush, &policy_for_flush, &mut known, &mut batch);
                    // M258：新出现的目录要把子孙一起带出去（改名只报目录本身，前端补不出来）；
                    // 惰性目录只带一行（§4.3）。
                    expand_new_dir_subtrees(
                        &root_for_flush,
                        &policy_for_flush,
                        &mut known,
                        &mut batch,
                    );
                }
                if !batch.is_empty() {
                    on_batch(batch);
                }
            };
            let mut pending: Vec<FsChange> = Vec::new();
            loop {
                match rx.recv() {
                    Ok(batch) => pending.extend(batch),
                    Err(_) => {
                        if !pending.is_empty() {
                            flush(&mut pending);
                        }
                        return; // watcher 已 drop
                    }
                }
                loop {
                    match rx.recv_timeout(DEBOUNCE) {
                        Ok(batch) => pending.extend(batch),
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            flush(&mut pending);
                            return;
                        }
                    }
                }
                flush(&mut pending);
            }
        })
        .map_err(|e| CommandError::new("fs_watch_failed", format!("无法启动监听线程：{e}")))?;

    Ok(VaultWatcher {
        _watcher: watcher,
        known,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 无 tempfile 依赖（同 config.rs 的纪律）：pid + 序号造唯一目录，drop 时递归删除。
    struct TempVault(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempVault {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-fs-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).expect("create temp vault");
            Self(path)
        }
        /// 造混合类型 fixture：md / 代码 / 图片字节 / 无扩展名文本 / 嵌套目录 / 忽略集。
        fn with_fixture() -> Self {
            let v = Self::new();
            let r = &v.0;
            std::fs::write(r.join("note.md"), "# hello").unwrap();
            std::fs::write(r.join("main.rs"), "fn main() {}").unwrap();
            std::fs::write(r.join("pic.png"), [0x89, 0x50, 0x4e, 0x47]).unwrap();
            std::fs::write(r.join("LICENSE"), "MIT").unwrap();
            std::fs::create_dir_all(r.join("sub/deep")).unwrap();
            std::fs::write(r.join("sub/deep/a.txt"), "a").unwrap();
            std::fs::create_dir_all(r.join(".git/objects")).unwrap();
            std::fs::write(r.join(".git/HEAD"), "ref").unwrap();
            std::fs::write(r.join(".DS_Store"), [0u8; 4]).unwrap();
            std::fs::create_dir_all(r.join("node_modules/pkg")).unwrap();
            std::fs::write(r.join("node_modules/pkg/index.js"), "x").unwrap();
            v
        }
    }

    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    impl TempVault {
        /// 无用户规则来源的策略（只剩内置规则）：既有断言大多只关心内置规则。
        fn policy(&self) -> IgnorePolicy {
            IgnorePolicy::load(&self.0, &[])
        }

        /// 指定用户规则来源清单的策略（`vault.rule_files` 的形状）。
        fn policy_with(&self, rule_files: &[&str]) -> IgnorePolicy {
            let list: Vec<String> = rule_files.iter().map(|s| s.to_string()).collect();
            IgnorePolicy::load(&self.0, &list)
        }

        /// 出厂默认清单（`[".gitignore", ".git/info/exclude"]`）。
        fn default_policy(&self) -> IgnorePolicy {
            self.policy_with(&[".gitignore", ".git/info/exclude"])
        }
    }

    #[test]
    fn scan_lists_all_types_and_applies_ignore_set() {
        let v = TempVault::with_fixture();
        let entries = scan_workspace(&v.0, &v.policy()).expect("scan");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"note.md"));
        assert!(paths.contains(&"main.rs"));
        assert!(paths.contains(&"pic.png"));
        assert!(paths.contains(&"LICENSE"));
        assert!(paths.contains(&"sub"));
        assert!(paths.contains(&"sub/deep"));
        assert!(paths.contains(&"sub/deep/a.txt"));
        // 忽略集：自身与子孙都不出现
        assert!(!paths.iter().any(|p| p.contains(".git")));
        assert!(!paths.iter().any(|p| p.contains(".DS_Store")));
        assert!(!paths.iter().any(|p| p.contains("node_modules")));

        let note = entries.iter().find(|e| e.path == "note.md").unwrap();
        assert_eq!(note.kind, FsEntryKind::File);
        assert_eq!(note.size, 7);
        assert!(note.mtime_ms.is_some());
        let sub = entries.iter().find(|e| e.path == "sub").unwrap();
        assert_eq!(sub.kind, FsEntryKind::Dir);
        // 排序确定（按路径字典序）
        let mut sorted = paths.clone();
        sorted.sort_unstable();
        assert_eq!(paths, sorted);
    }

    #[test]
    fn scan_rejects_non_dir_root() {
        let v = TempVault::new();
        let f = v.0.join("f.txt");
        std::fs::write(&f, "x").unwrap();
        let err = scan_workspace(&f, &v.policy()).unwrap_err();
        assert_eq!(err.code, "fs_root_not_dir");
    }

    #[cfg(unix)]
    #[test]
    fn scan_does_not_follow_symlink_loop() {
        let v = TempVault::with_fixture();
        // 循环 symlink：sub/loop 指回 vault 根。跟随会沿链接重复枚举直至 ELOOP。
        std::os::unix::fs::symlink(&v.0, v.0.join("sub/loop")).unwrap();
        let entries = scan_workspace(&v.0, &v.policy()).expect("symlink 循环不应导致扫描失败");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        // symlink 条目按文件列出，不递归展开
        assert!(paths.contains(&"sub/loop"));
        assert_eq!(
            entries.iter().find(|e| e.path == "sub/loop").unwrap().kind,
            FsEntryKind::File
        );
        assert!(
            !paths.iter().any(|p| p.starts_with("sub/loop/")),
            "symlink 不应被展开枚举：{paths:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn scan_does_not_expand_external_symlink() {
        let v = TempVault::with_fixture();
        // Obsidian 常见模式：attachments 是指向 vault 外目录的 symlink
        let outside = TempVault::new();
        std::fs::create_dir_all(outside.0.join("attachments/deep")).unwrap();
        std::fs::write(outside.0.join("attachments/deep/x.png"), [0u8; 4]).unwrap();
        std::os::unix::fs::symlink(outside.0.join("attachments"), v.0.join("attachments")).unwrap();
        let entries = scan_workspace(&v.0, &v.policy()).expect("scan");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        // symlink 本身作为条目出现，但 vault 外的内容不被枚举进树
        assert!(paths.contains(&"attachments"));
        assert!(
            !paths.iter().any(|p| p.starts_with("attachments/")),
            "外部 symlink 不应被展开枚举：{paths:?}"
        );
    }

    #[test]
    fn resolve_rejects_escape_and_absolute() {
        let v = TempVault::with_fixture();
        let cases = ["../outside", "sub/../../etc/passwd", "/etc/passwd"];
        for c in cases {
            let err = resolve_in_vault(&v.0, c).unwrap_err();
            assert_eq!(err.code, "fs_path_escape", "case: {c}");
        }
        let err = resolve_in_vault(&v.0, "missing.txt").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        assert!(resolve_in_vault(&v.0, "note.md").is_ok());
        assert!(resolve_in_vault(&v.0, "sub/deep/a.txt").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_rejects_symlink_escape() {
        let v = TempVault::with_fixture();
        let outside = TempVault::new();
        std::fs::write(outside.0.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.0.join("secret.txt"), v.0.join("link.txt")).unwrap();
        let err = read_text_file(&v.0, "link.txt").unwrap_err();
        assert_eq!(err.code, "fs_path_escape");
    }

    #[test]
    fn read_text_file_ok_and_invalid_utf8() {
        let v = TempVault::with_fixture();
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# hello");
        // GBK 编码的"中文"不是合法 UTF-8
        std::fs::write(v.0.join("gbk.txt"), [0xd6, 0xd0, 0xce, 0xc4]).unwrap();
        let err = read_text_file(&v.0, "gbk.txt").unwrap_err();
        assert_eq!(err.code, "fs_invalid_utf8");
        assert!(err.message.contains("UTF-8"));
        // 目录按"不是文件"拒绝
        let err = read_text_file(&v.0, "sub").unwrap_err();
        assert_eq!(err.code, "fs_not_a_file");
    }

    #[test]
    fn read_attachment_ok_and_oversize_rejected_without_read() {
        let v = TempVault::with_fixture();
        let b64 = read_attachment(&v.0, "pic.png").unwrap();
        assert_eq!(b64, base64_encode(&[0x89, 0x50, 0x4e, 0x47]));

        // 稀疏文件：set_len 不占磁盘实际空间，metadata 报超限即拒、不分配内存
        let big = v.0.join("big.bin");
        std::fs::File::create(&big)
            .unwrap()
            .set_len(ATTACHMENT_MAX_BYTES + 1)
            .unwrap();
        let err = read_attachment(&v.0, "big.bin").unwrap_err();
        assert_eq!(err.code, "fs_too_large");
    }

    #[test]
    fn base64_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn watch_delivers_batched_changes_and_respects_ignore_set() {
        let v = TempVault::with_fixture();
        // FSEvents 按"历史事件点"对齐流起点：fixture 写入后先静置，让流的起点
        // 落在 fixture 之后，否则首批事件会带上 fixture 的 Create 标志。
        std::thread::sleep(Duration::from_millis(700));
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let watcher = watch(&v.0, &v.policy(), move |batch| {
            tx.send(batch).expect("send batch");
        })
        .expect("watch");
        // 与 open_vault 同序：watch 后枚举播种，已知路径的重放 Create 修正为 Modified
        let entries = scan_workspace(&v.0, &v.policy()).expect("scan");
        watcher.seed(entries.iter().map(|e| e.path.clone()));

        // FSEvents 流注册需要时间；注册完成前的变更会以粗粒度 kind 上报
        std::thread::sleep(Duration::from_millis(500));
        std::fs::write(v.0.join("new.md"), "n").unwrap();
        std::fs::write(v.0.join("note.md"), "# hello v2").unwrap();
        std::fs::remove_file(v.0.join("main.rs")).unwrap();
        std::fs::write(v.0.join(".git/NEW"), "x").unwrap();

        let batch = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("batch within 5s");
        let has =
            |kind: FsChangeKind, path: &str| batch.iter().any(|c| c.kind == kind && c.path == path);
        assert!(has(FsChangeKind::Created, "new.md"), "batch: {batch:?}");
        assert!(has(FsChangeKind::Modified, "note.md"), "batch: {batch:?}");
        assert!(has(FsChangeKind::Deleted, "main.rs"), "batch: {batch:?}");
        // created 携带 entry_kind，前端据此知道新节点是文件还是目录；deleted 为 null
        let new_entry = batch.iter().find(|c| c.path == "new.md").unwrap();
        assert_eq!(new_entry.entry_kind, Some(FsEntryKind::File));
        let del_entry = batch.iter().find(|c| c.path == "main.rs").unwrap();
        assert_eq!(del_entry.entry_kind, None);
        assert!(
            !batch.iter().any(|c| c.path.contains(".git")),
            "batch: {batch:?}"
        );
        // 同路径去重
        let mut paths: Vec<&str> = batch.iter().map(|c| c.path.as_str()).collect();
        let before = paths.len();
        paths.sort_unstable();
        paths.dedup();
        assert_eq!(before, paths.len(), "batch: {batch:?}");
    }

    /// backlog 32 / finding `20260925-worker-fix-closeout-bug-watch` 的后端回归锚点：外部在
    /// vault 里新建目录（连同其中文件）**必须**由 watch 增量带出——不是「等重启全量重扫」。
    ///
    /// 与真机验收 harness 的 `vaultWrite` 同形（`mkdirp(dirname)` 后写文件），也覆盖 seed 行为：
    /// 播种集来自写入前的全量枚举，**不得**把随后的新目录吞成 Modified（它不在播种集里 → Created）。
    #[test]
    fn watch_delivers_external_new_dir_with_nested_file() {
        let v = TempVault::with_fixture();
        // FSEvents 流起点对齐：先静置，避免 fixture 的 Create 混进断言用的批次（同既有两个 watch 测试）
        std::thread::sleep(Duration::from_millis(700));
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let watcher = watch(&v.0, &v.policy(), move |batch| {
            tx.send(batch).expect("send batch");
        })
        .expect("watch");
        // 与 open_vault 同序：watch 后枚举播种（此刻 restyle-dir 还不存在）
        let entries = scan_workspace(&v.0, &v.policy()).expect("scan");
        watcher.seed(entries.iter().map(|e| e.path.clone()));

        std::thread::sleep(Duration::from_millis(500));
        std::fs::create_dir(v.0.join("restyle-dir")).unwrap();
        std::fs::write(v.0.join("restyle-dir/note-in-dir.md"), "# x\n").unwrap();

        let batch = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("batch within 5s");
        let has =
            |kind: FsChangeKind, path: &str| batch.iter().any(|c| c.kind == kind && c.path == path);
        assert!(
            has(FsChangeKind::Created, "restyle-dir"),
            "外部新建目录必须进增量，batch: {batch:?}"
        );
        assert!(
            has(FsChangeKind::Created, "restyle-dir/note-in-dir.md"),
            "目录内新建文件必须进增量，batch: {batch:?}"
        );
        // entry_kind 由 flush 时的 metadata 填充：前端据此把新节点建成目录（可展开）而不是文件
        let dir_entry = batch.iter().find(|c| c.path == "restyle-dir").unwrap();
        assert_eq!(dir_entry.entry_kind, Some(FsEntryKind::Dir));
        let file_entry = batch
            .iter()
            .find(|c| c.path == "restyle-dir/note-in-dir.md")
            .unwrap();
        assert_eq!(file_entry.entry_kind, Some(FsEntryKind::File));
    }

    /// 收一批（多批合并）增量：`DEBOUNCE` 会把一次改名拆成多批，断言要看的是「这段时间里
    /// 前端一共被告知了什么」——单批口径会在批次切分上假红/假绿。
    fn collect_batches(rx: &mpsc::Receiver<Vec<FsChange>>, window: Duration) -> Vec<FsChange> {
        let deadline = std::time::Instant::now() + window;
        let mut out = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() {
                return out;
            }
            match rx.recv_timeout(left) {
                Ok(batch) => out.extend(batch),
                Err(_) => return out,
            }
        }
    }

    /// M258 的后端回归锚点：**目录改名后，增量必须让前端把该目录的整棵子树收敛出来**。
    ///
    /// 现场（Alex 2026-09-27，`openspec-tutorial` → `openspec-tutorials`）：FSEvents 对目录
    /// 改名只报目录本身这一个新路径，子孙一个都不报。前端按 `deleted:old` 级联清掉旧子树
    /// （`src/tree.ts` 的 applyChanges）、按 `created:new` 建出一个**空的**目录节点 ⇒ 重命名后的
    /// 目录在树里永远展不开（改回原名亦然），直到重启全量重扫。不变量：**增量收敛后的模型 =
    /// 同一时刻的全量枚举**——所以新路径下的每个条目都必须有增量条目送达。
    ///
    /// 两个方向都测（改名 + 改回原名），与用户报告的路径逐字同形。
    #[test]
    fn watch_dir_rename_delivers_full_subtree() {
        let v = TempVault::new();
        std::fs::create_dir_all(v.0.join("tutorial/deep")).unwrap();
        std::fs::write(v.0.join("tutorial/a.md"), "# a\n").unwrap();
        std::fs::write(v.0.join("tutorial/deep/b.txt"), "b\n").unwrap();
        std::thread::sleep(Duration::from_millis(700));
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let watcher = watch(&v.0, &v.policy(), move |batch| {
            tx.send(batch).expect("send batch");
        })
        .expect("watch");
        let entries = scan_workspace(&v.0, &v.policy()).expect("scan");
        watcher.seed(entries.iter().map(|e| e.path.clone()));
        std::thread::sleep(Duration::from_millis(500));

        // 方向一：tutorial → tutorials（用户现场：加一个 s）
        std::fs::rename(v.0.join("tutorial"), v.0.join("tutorials")).unwrap();
        let renamed = collect_batches(&rx, Duration::from_millis(1500));
        let view = |path: &str| renamed.iter().find(|c| c.path == path);
        for (path, kind) in [
            ("tutorials", FsEntryKind::Dir),
            ("tutorials/a.md", FsEntryKind::File),
            ("tutorials/deep", FsEntryKind::Dir),
            ("tutorials/deep/b.txt", FsEntryKind::File),
        ] {
            let Some(entry) = view(path) else {
                panic!("改名后新路径 {path} 必须进增量（前端靠它建出子树），批次：{renamed:?}");
            };
            assert_ne!(
                entry.kind,
                FsChangeKind::Deleted,
                "{path} 在磁盘上存在，不得报成删除，批次：{renamed:?}"
            );
            assert_eq!(
                entry.entry_kind,
                Some(kind),
                "{path} 的 entry_kind 必须由磁盘元数据填准，批次：{renamed:?}"
            );
        }
        assert!(
            renamed
                .iter()
                .any(|c| c.path == "tutorial" && c.kind == FsChangeKind::Deleted),
            "旧路径要报删除（前端据此摘掉旧行），批次：{renamed:?}"
        );

        // 方向二：改回原名（用户报告「改回旧名字依然无法展开」的那一半）
        std::fs::rename(v.0.join("tutorials"), v.0.join("tutorial")).unwrap();
        let restored = collect_batches(&rx, Duration::from_millis(1500));
        for path in [
            "tutorial",
            "tutorial/a.md",
            "tutorial/deep",
            "tutorial/deep/b.txt",
        ] {
            let Some(entry) = restored.iter().find(|c| c.path == path) else {
                panic!("改回原名后 {path} 必须进增量，批次：{restored:?}");
            };
            assert_ne!(
                entry.kind,
                FsChangeKind::Deleted,
                "{path} 在磁盘上存在，不得报成删除，批次：{restored:?}"
            );
        }
    }

    /// `refine_with_known` 的三条口径（seed 行为）逐条钉住——外部新建目录那条 finding 若再被
    /// 怀疑，先看这里：播种集只影响**已在集内**的路径（重放的 Create 修正为 Modified），
    /// 新目录仍是 Created，消失的路径一律 Deleted。
    #[test]
    fn refine_with_known_keeps_new_dir_created_and_normalizes_seeded_replay() {
        let v = TempVault::new();
        std::fs::create_dir_all(v.0.join("seeded-dir")).unwrap();
        std::fs::create_dir_all(v.0.join("brand-new-dir")).unwrap();
        let mut known: HashSet<String> = ["seeded-dir".to_string()].into_iter().collect();
        let mut changes = vec![
            // 播种过的路径被 FSEvents 重放为 Create → 修正为 Modified（不得当成新建）
            FsChange {
                kind: FsChangeKind::Created,
                path: "seeded-dir".into(),
                entry_kind: None,
                lazy: false,
            },
            // 不在播种集里的新目录 → 保持 Created，且 entry_kind 填成 dir
            FsChange {
                kind: FsChangeKind::Created,
                path: "brand-new-dir".into(),
                entry_kind: None,
                lazy: false,
            },
            // 路径已不存在 → 一律 Deleted（无论事件说它是什么）
            FsChange {
                kind: FsChangeKind::Modified,
                path: "gone-dir".into(),
                entry_kind: None,
                lazy: false,
            },
        ];
        refine_with_known(&v.0, &v.policy(), &mut known, &mut changes);
        assert_eq!(
            changes[0].kind,
            FsChangeKind::Modified,
            "播种过的路径是重放"
        );
        assert_eq!(changes[0].entry_kind, Some(FsEntryKind::Dir));
        assert_eq!(
            changes[1].kind,
            FsChangeKind::Created,
            "新目录不得被播种集吞掉"
        );
        assert_eq!(changes[1].entry_kind, Some(FsEntryKind::Dir));
        assert_eq!(changes[2].kind, FsChangeKind::Deleted);
        assert_eq!(changes[2].entry_kind, None, "deleted 一律不带 entry_kind");
        assert!(known.contains("brand-new-dir"), "新目录应进已知集");
    }

    /// `expand_new_dir_subtrees` 的纯函数那一半（M258）：不管事件形状如何，新出现的目录都要
    /// 把子孙补全——批次覆盖该子树在磁盘上的**全部**条目（逐条 kind / entry_kind 与磁盘一致、
    /// 父先于子），忽略集命中的名字一条都不进，已带事件的路径不重复也不被覆盖。
    ///
    /// 与 `watch_dir_rename_delivers_full_subtree`（跑真 FSEvents 流）分工：那条证明「改名真的
    /// 只报目录本身、修复后批次够用」，这条在不依赖事件时序的形状矩阵上钉住补全判定本身。
    #[test]
    fn expand_new_dir_subtrees_covers_subtree_and_respects_ignore_set() {
        let v = TempVault::new();
        // 形状：层深 3、宽度 3，混入三类忽略集条目（目录 / 文件 / 保存 tmp ghost）
        let shape: &[(&str, FsEntryKind)] = &[
            ("outer/a.md", FsEntryKind::File),
            ("outer/deep", FsEntryKind::Dir),
            ("outer/deep/b.txt", FsEntryKind::File),
            ("outer/deep/deeper", FsEntryKind::Dir),
            ("outer/deep/deeper/c.md", FsEntryKind::File),
            ("outer/sib", FsEntryKind::Dir),
            ("outer/sib/d.md", FsEntryKind::File),
            ("outer/node_modules/pkg/index.js", FsEntryKind::File),
            ("outer/.DS_Store", FsEntryKind::File),
            ("outer/.note.md.lumir-123", FsEntryKind::File),
        ];
        let mut expected: Vec<(&str, FsEntryKind)> = vec![("outer", FsEntryKind::Dir)];
        for (rel, kind) in shape {
            let full = v.0.join(rel);
            match kind {
                FsEntryKind::Dir => std::fs::create_dir_all(&full).unwrap(),
                FsEntryKind::File => {
                    std::fs::create_dir_all(full.parent().unwrap()).unwrap();
                    std::fs::write(&full, "x").unwrap();
                }
            }
            if rel.contains("node_modules")
                || rel.contains(".DS_Store")
                || rel.ends_with("lumir-123")
            {
                continue; // 忽略集命中：磁盘上有，但不得进批次（与枚举同口径）
            }
            expected.push((rel, *kind));
        }

        let mut known = HashSet::new();
        let mut batch = vec![FsChange {
            kind: FsChangeKind::Created,
            path: "outer".into(),
            entry_kind: Some(FsEntryKind::Dir),
            lazy: false,
        }];
        expand_new_dir_subtrees(&v.0, &v.policy(), &mut known, &mut batch);

        for (rel, kind) in &expected {
            let Some(hit) = batch.iter().find(|c| c.path == *rel) else {
                panic!("{rel} 必须在批次里（前端靠它建出子树），批次：{batch:?}");
            };
            assert_eq!(hit.kind, FsChangeKind::Created, "{rel}");
            assert_eq!(hit.entry_kind, Some(*kind), "{rel} 的类型必须与磁盘一致");
        }
        // 反向：不多不少——批次里的条目数 = 该子树里未被忽略的条目数
        assert_eq!(batch.len(), expected.len(), "批次：{batch:?}");
        // 父先于子（前端按路径深度排序后逐个 upsert；批次自身也保持这个次序）
        for (rel, _) in &expected {
            let Some((parent, _)) = rel.rsplit_once('/') else {
                continue;
            };
            let child_at = batch.iter().position(|c| c.path == *rel).unwrap();
            let parent_at = batch.iter().position(|c| c.path == parent).unwrap();
            assert!(parent_at < child_at, "{parent} 必须先于 {rel} 入批次");
        }
        // 补出来的路径进已知集：后续事件按 Modified 归因，不重复报 Created
        //（批次里原本就有的那条由 refine_with_known 负责写 known，这条测试没跑 refine）
        for (rel, _) in &expected {
            if *rel == "outer" {
                continue;
            }
            assert!(known.contains(*rel), "{rel} 应进已知集");
        }

        // 已带事件的路径不重复、不被覆盖（它自带的 kind 由 refine 按磁盘现状定过，更权威）
        let mut batch_with_event = vec![
            FsChange {
                kind: FsChangeKind::Created,
                path: "outer".into(),
                entry_kind: Some(FsEntryKind::Dir),
                lazy: false,
            },
            FsChange {
                kind: FsChangeKind::Modified,
                path: "outer/deep".into(),
                entry_kind: Some(FsEntryKind::Dir),
                lazy: false,
            },
        ];
        expand_new_dir_subtrees(
            &v.0,
            &v.policy(),
            &mut HashSet::new(),
            &mut batch_with_event,
        );
        let dupes: Vec<&FsChange> = batch_with_event
            .iter()
            .filter(|c| c.path == "outer/deep")
            .collect();
        assert_eq!(dupes.len(), 1, "同一路径只留一条：{batch_with_event:?}");
        assert_eq!(dupes[0].kind, FsChangeKind::Modified, "既有条目不得被覆盖");

        // 反向输入：只有**文件**新建时不得凭空补出任何条目（补全只对目录生效）
        let mut file_only = vec![FsChange {
            kind: FsChangeKind::Created,
            path: "outer/a.md".into(),
            entry_kind: Some(FsEntryKind::File),
            lazy: false,
        }];
        expand_new_dir_subtrees(&v.0, &v.policy(), &mut HashSet::new(), &mut file_only);
        assert_eq!(file_only.len(), 1, "文件不进补全路径：{file_only:?}");
    }

    #[test]
    fn document_save_checks_revision_and_replaces_atomically() {
        let v = TempVault::with_fixture();
        let revision = file_revision(&v.0, "note.md").unwrap();
        let next = save_document(&v.0, "note.md", &revision, "# changed").unwrap();
        assert_ne!(revision, next);
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# changed");
        let err = save_document(&v.0, "note.md", &revision, "stale").unwrap_err();
        assert_eq!(err.code, "document_conflict");
    }

    /// 裁决 D1 的落点：可保存面 = 注册表全部文本类（md / 代码扩展 / 未收录扩展 /
    /// 无扩展名），image/binary 类被拒。拒绝清单是 Rust 侧第二份表，与
    /// `src/preview/attachments.ts` 的对账在 tests/unit/registry-drift.test.ts。
    #[test]
    fn document_save_allows_text_classes_and_rejects_image_binary() {
        let v = TempVault::with_fixture();
        // 文本类全部放行，且真的原子替换落盘
        for rel in ["note.md", "main.rs", "LICENSE", "sub/deep/a.txt"] {
            let revision = file_revision(&v.0, rel).unwrap();
            let next = save_document(&v.0, rel, &revision, "edited").unwrap();
            assert_ne!(revision, next, "{rel} 保存后 revision 应变");
            assert_eq!(read_text_file(&v.0, rel).unwrap(), "edited", "{rel} 应落盘");
        }
        // image / binary 类被拒——且**发生在任何 IO 之前**（这些路径在 fixture 里不存在，
        // 若守卫晚于 resolve_in_vault 就会返回 fs_not_found 而不是 fs_read_only）
        for rel in [
            "pic.png",
            "logo.jpg",
            "manual.pdf",
            "bundle.zip",
            "song.mp3",
        ] {
            let err = save_document(&v.0, rel, "any", "nope").unwrap_err();
            assert_eq!(err.code, "fs_read_only", "{rel} 必须被拒");
        }
    }

    /// 拒绝清单的判定只按 basename 的最后一个点切分（与 attachments.ts 的 extensionOf 同口径）：
    /// 目录名里的点 / 大小写 / dotfile 都不能骗过守卫，也不能误伤文本类。
    #[test]
    fn document_save_extension_classification_matches_registry_rules() {
        let v = TempVault::with_fixture();
        // 大小写不敏感（.PNG 同样是图片）
        assert_eq!(
            save_document(&v.0, "pic.PNG", "any", "x").unwrap_err().code,
            "fs_read_only"
        );
        // 扩展名只看 basename：目录名含 .png 不构成拒绝理由
        std::fs::create_dir_all(v.0.join("a.png")).unwrap();
        std::fs::write(v.0.join("a.png/notes"), "orig").unwrap();
        let revision = file_revision(&v.0, "a.png/notes").unwrap();
        assert!(save_document(&v.0, "a.png/notes", &revision, "ok").is_ok());
        // dotfile 的「扩展名」是点后整串（.gitignore → gitignore），未收录即文本类
        std::fs::write(v.0.join(".gitignore"), "orig").unwrap();
        let revision = file_revision(&v.0, ".gitignore").unwrap();
        assert!(save_document(&v.0, ".gitignore", &revision, "ok").is_ok());
    }

    #[test]
    fn document_save_recovers_from_stale_ghost_tmp() {
        let v = TempVault::with_fixture();
        // 预置与本次保存同名的 ghost（同 pid）：create_new 撞车须删除后重试成功
        let ghost = v.0.join(format!(".note.md.lumir-{}", std::process::id()));
        std::fs::write(&ghost, "stale ghost").unwrap();
        let revision = file_revision(&v.0, "note.md").unwrap();
        let next = save_document(&v.0, "note.md", &revision, "# recovered").unwrap();
        assert_ne!(revision, next);
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# recovered");
        assert!(!ghost.exists(), "ghost 应已被删除重试清理");
    }

    // -----------------------------------------------------------------------
    // 局部 patch 写入（change add-harness-probe §7，M301）
    // -----------------------------------------------------------------------

    fn edit(old: &str, new: &str) -> PatchEdit {
        PatchEdit {
            old_string: old.to_string(),
            new_string: new.to_string(),
        }
    }

    fn sha256(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(bytes))
    }

    /// 唯一命中替换：命中处被替换，**未触及部分逐字节不变**。断言取前后两段的原始字节与
    /// sha256（不用「内容字符串相等」——那会放过看不见的重编码差异）。
    #[test]
    fn fs_patch_file_replaces_single_match_and_keeps_untouched_bytes() {
        let v = TempVault::with_fixture();
        let prefix = "第一段：保持不动。\n\n目标行：";
        let suffix = "\n\n第三段：保持不动。\n";
        let original = format!("{prefix}旧的{suffix}");
        std::fs::write(v.0.join("doc.md"), &original).unwrap();
        let revision = file_revision(&v.0, "doc.md").unwrap();

        let next = fs_patch_file(&v.0, "doc.md", &[edit("旧的", "新的")], &revision).unwrap();

        assert_ne!(next, revision, "revision 必须前进");
        assert_eq!(next, file_revision(&v.0, "doc.md").unwrap());
        let after = std::fs::read(v.0.join("doc.md")).unwrap();
        assert_eq!(
            String::from_utf8(after.clone()).unwrap(),
            format!("{prefix}新的{suffix}")
        );
        // 未触及部分：前缀 / 后缀两段与原文件逐字节相同（长度与 sha256 双重断言）
        assert_eq!(&after[..prefix.len()], prefix.as_bytes());
        assert_eq!(&after[after.len() - suffix.len()..], suffix.as_bytes());
        assert_eq!(sha256(&after[..prefix.len()]), sha256(prefix.as_bytes()));
        assert_eq!(
            sha256(&after[after.len() - suffix.len()..]),
            sha256(suffix.as_bytes())
        );
    }

    /// 0 次 / 多次命中都拒绝**整组**编辑：文件逐字节不变、revision 不变，错误里带命中次数与
    /// 编辑序号（回送模型即可据此重试）。
    #[test]
    fn fs_patch_file_rejects_zero_and_multiple_matches_without_touching_the_file() {
        let v = TempVault::with_fixture();
        std::fs::write(v.0.join("doc.md"), "alpha\nbeta\nalpha\n").unwrap();
        let before = std::fs::read(v.0.join("doc.md")).unwrap();
        let revision = file_revision(&v.0, "doc.md").unwrap();

        let err = fs_patch_file(&v.0, "doc.md", &[edit("missing", "x")], &revision).unwrap_err();
        assert_eq!(err.code, "patch_not_found");
        assert_eq!(err.params.get("count").map(String::as_str), Some("0"));
        assert_eq!(err.params.get("index").map(String::as_str), Some("1"));

        let err = fs_patch_file(&v.0, "doc.md", &[edit("alpha", "x")], &revision).unwrap_err();
        assert_eq!(err.code, "patch_not_unique");
        assert_eq!(err.params.get("count").map(String::as_str), Some("2"));

        // 合法编辑在前、非法编辑在后：整组拒绝，绝不落半截（前一条不许已经写进文件）
        let err = fs_patch_file(
            &v.0,
            "doc.md",
            &[edit("beta", "B"), edit("nope", "x")],
            &revision,
        )
        .unwrap_err();
        assert_eq!(err.code, "patch_not_found");
        assert_eq!(err.params.get("index").map(String::as_str), Some("2"));

        assert_eq!(
            sha256(&std::fs::read(v.0.join("doc.md")).unwrap()),
            sha256(&before),
            "拒绝路径必须逐字节不变"
        );
        assert_eq!(file_revision(&v.0, "doc.md").unwrap(), revision);
    }

    /// CAS：`expected_revision` 与磁盘不一致 ⇒ `document_conflict`（与 `document_save` 同一
    /// 错误码与同一句人话），文件不变。
    #[test]
    fn fs_patch_file_rejects_stale_revision() {
        let v = TempVault::with_fixture();
        let err = fs_patch_file(&v.0, "note.md", &[edit("hello", "hi")], "deadbeef").unwrap_err();
        assert_eq!(err.code, "document_conflict");
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# hello");
    }

    /// image/binary 扩展名拒绝，且**发生在任何 IO 之前**（这些路径在 fixture 里不存在：守卫
    /// 若晚于 `resolve_in_vault`，返回的会是 fs_not_found 而不是 fs_read_only）。
    #[test]
    fn fs_patch_file_rejects_image_and_binary_extensions() {
        let v = TempVault::with_fixture();
        for rel in [
            "pic.png",
            "logo.jpg",
            "manual.pdf",
            "bundle.zip",
            "song.mp3",
        ] {
            let err = fs_patch_file(&v.0, rel, &[edit("a", "b")], "any").unwrap_err();
            assert_eq!(err.code, "fs_read_only", "{rel} 必须被拒");
        }
    }

    /// 空 edits / 空 old_string 是非法请求：空串没有唯一命中语义，MUST NOT 滑成「插入」。
    #[test]
    fn fs_patch_file_rejects_empty_request_forms() {
        let v = TempVault::with_fixture();
        let revision = file_revision(&v.0, "note.md").unwrap();
        assert_eq!(
            fs_patch_file(&v.0, "note.md", &[], &revision)
                .unwrap_err()
                .code,
            "patch_invalid"
        );
        assert_eq!(
            fs_patch_file(&v.0, "note.md", &[edit("", "x")], &revision)
                .unwrap_err()
                .code,
            "patch_invalid"
        );
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# hello");
    }

    /// 编辑按数组顺序逐个应用：后一条看得到前一条的结果（顺序语义是 diff 预览与重试的前提）。
    #[test]
    fn fs_patch_file_applies_edits_in_order() {
        let v = TempVault::with_fixture();
        std::fs::write(v.0.join("doc.md"), "alpha\n").unwrap();
        let revision = file_revision(&v.0, "doc.md").unwrap();
        fs_patch_file(
            &v.0,
            "doc.md",
            &[edit("alpha", "beta"), edit("beta", "gamma")],
            &revision,
        )
        .unwrap();
        assert_eq!(read_text_file(&v.0, "doc.md").unwrap(), "gamma\n");
    }

    /// 非 UTF-8 文件拒绝（与读取链路同一个错误码）：命中判定必须先在文本上做。
    #[test]
    fn fs_patch_file_rejects_non_utf8_files() {
        let v = TempVault::with_fixture();
        std::fs::write(v.0.join("doc.md"), [0xff, 0xfe, 0x00]).unwrap();
        let revision = file_revision(&v.0, "doc.md").unwrap();
        let err = fs_patch_file(&v.0, "doc.md", &[edit("a", "b")], &revision).unwrap_err();
        assert_eq!(err.code, "fs_invalid_utf8");
    }

    /// patch 与保存走的是同一个写核心（M301 抽出的 [`write_document_atomic`]）：ghost tmp 的
    /// 删除重试对 patch 同样成立——这条断言同时钉住「两者不是两份实现」。
    #[test]
    fn fs_patch_file_recovers_from_stale_ghost_tmp() {
        let v = TempVault::with_fixture();
        let ghost = v.0.join(format!(".note.md.lumir-{}", std::process::id()));
        std::fs::write(&ghost, "ghost").unwrap();
        let revision = file_revision(&v.0, "note.md").unwrap();
        fs_patch_file(&v.0, "note.md", &[edit("hello", "patched")], &revision).unwrap();
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# patched");
        assert!(!ghost.exists(), "ghost 应已被删除重试清理");
    }

    /// watch 面（fs-io spec「局部 patch 写入」的落盘条款）：patch 之后事件流里出现的是
    /// **目标文件**（打开中的编辑器会话正是经这条既有通路（`fs:entry_changed` 的外部变更分流）
    /// 同步内容的），而 `.lumir-` 临时条目一条都不出现（写盘方的自身标记被忽略集挡下，
    /// MUST NOT 在文件树 / 事件流里冒出自家的临时条目）。
    #[test]
    fn fs_patch_file_emits_target_change_without_tmp_events() {
        let v = TempVault::with_fixture();
        std::thread::sleep(Duration::from_millis(700));
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let watcher = watch(&v.0, &v.policy(), move |batch| {
            tx.send(batch).expect("send batch");
        })
        .expect("watch");
        let entries = scan_workspace(&v.0, &v.policy()).expect("scan");
        watcher.seed(entries.iter().map(|e| e.path.clone()));

        std::thread::sleep(Duration::from_millis(500));
        let revision = file_revision(&v.0, "note.md").unwrap();
        fs_patch_file(&v.0, "note.md", &[edit("hello", "patched")], &revision).unwrap();

        let batch = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("batch within 5s");
        assert!(
            batch
                .iter()
                .any(|c| c.path == "note.md" && c.kind == FsChangeKind::Modified),
            "目标文件的变更必须进入事件流（会话同步走它）：{batch:?}"
        );
        assert!(
            !batch.iter().any(|c| c.path.contains(".lumir-")),
            "tmp ghost 不得进入事件流：{batch:?}"
        );
    }

    // -----------------------------------------------------------------------
    // 新建文档（harness 的 vault_create，change add-harness-probe §7，M301）
    // -----------------------------------------------------------------------

    /// O_EXCL：新建成功写入内容；目标已存在（新建过的或既有的）一律 `fs_already_exists`，
    /// 原有内容逐字节不变。
    #[test]
    fn vault_create_file_is_exclusive_and_never_overwrites() {
        let v = TempVault::with_fixture();
        let created = vault_create_file(&v.0, "sub/deep/b.md", "第一版").unwrap();
        assert_eq!(created, "sub/deep/b.md");
        assert_eq!(read_text_file(&v.0, "sub/deep/b.md").unwrap(), "第一版");

        let err = vault_create_file(&v.0, "sub/deep/b.md", "第二版").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert_eq!(read_text_file(&v.0, "sub/deep/b.md").unwrap(), "第一版");

        let err = vault_create_file(&v.0, "note.md", "x").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# hello");
    }

    /// 非法目标各自回人话错误且不建任何文件：`..` 逃逸 / 内置忽略名（末段与父段两条路）/
    /// image-binary 扩展名 / 空路径 / 绝对路径。
    ///
    /// 注：「父目录不存在」自 change add-harness-permission-modes 起**不再是错误**——
    /// 父目录按 mkdir -p 语义自动补建（见 `vault_create_file_creates_parent_dirs`）。
    #[test]
    fn vault_create_file_rejects_invalid_targets() {
        let v = TempVault::with_fixture();
        for (rel, code) in [
            ("../escape.md", "fs_path_escape"),
            ("pic.png", "fs_read_only"),
            (".git/new.md", "fs_name_invalid"),
            ("node_modules/x.md", "fs_name_invalid"),
            (".DS_Store", "fs_name_invalid"),
            ("", "fs_path_invalid"),
            ("/abs/new.md", "fs_path_escape"),
        ] {
            let err = vault_create_file(&v.0, rel, "x").unwrap_err();
            assert_eq!(err.code, code, "{rel}");
        }
        assert!(!v.0.join(".git/new.md").exists());
        assert!(!v.0.join("node_modules/x.md").exists());
    }

    /// 父目录按 mkdir -p 语义自动补建（change add-harness-permission-modes 修订）：多级缺失
    /// 目录一次建出，文件落在最深一段；父段里的 `..` 与内置忽略名在建之前就拒（不留下半截目录）。
    #[test]
    fn vault_create_file_creates_parent_dirs() {
        let v = TempVault::new();
        let created = vault_create_file(&v.0, "a/b/c/new.md", "内容").unwrap();
        assert_eq!(created, "a/b/c/new.md");
        assert_eq!(read_text_file(&v.0, "a/b/c/new.md").unwrap(), "内容");
        assert!(v.0.join("a/b/c").is_dir());

        // 父段 `..` 逃逸：拒绝且不建任何目录。
        let err = vault_create_file(&v.0, "x/../../escape.md", "x").unwrap_err();
        assert_eq!(err.code, "fs_path_escape");
        assert!(!v.0.join("x").exists());

        // 父段含内置忽略名：拒绝且不建任何目录。
        let err = vault_create_file(&v.0, "keep/.git/new.md", "x").unwrap_err();
        assert_eq!(err.code, "fs_name_invalid");
        assert!(!v.0.join("keep").exists());

        // 父段落在既有文件上（不是目录）：拒绝。
        std::fs::write(v.0.join("plain.md"), "x").unwrap();
        let err = vault_create_file(&v.0, "plain.md/new.md", "x").unwrap_err();
        assert_eq!(err.code, "fs_path_invalid");
    }

    /// `fs_move_entry`（change add-harness-permission-modes，design §5.2）四例：
    /// 跨目录移动成立；撞名不覆盖（源与既有目标都逐字节不变）；`..` 逃逸拒绝；目标父目录
    /// 不存在拒绝；rename 失败（目录移进自己内部）如实报错、**不留半态**（源仍在、目标不存在）。
    #[test]
    fn fs_move_entry_moves_within_vault_and_refuses_unsafe_forms() {
        let v = TempVault::with_fixture();
        std::fs::create_dir_all(v.0.join("notes")).unwrap();

        // 跨目录移动成立。
        let moved = fs_move_entry(&v.0, "sub/deep/a.txt", "notes/a.txt").unwrap();
        assert_eq!(moved, "notes/a.txt");
        assert!(!v.0.join("sub/deep/a.txt").exists());
        assert_eq!(read_text_file(&v.0, "notes/a.txt").unwrap(), "a");

        // 撞名不覆盖：既有目标与源都逐字节不变。
        std::fs::write(v.0.join("notes/b.txt"), "original").unwrap();
        let err = fs_move_entry(&v.0, "note.md", "notes/b.txt").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert_eq!(read_text_file(&v.0, "notes/b.txt").unwrap(), "original");
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# hello");

        // 源逃逸 / 目标逃逸 / 目标父目录不存在。
        let err = fs_move_entry(&v.0, "../outside.md", "notes/a.txt").unwrap_err();
        assert_eq!(err.code, "fs_path_escape");
        let err = fs_move_entry(&v.0, "note.md", "../escape.md").unwrap_err();
        assert_eq!(err.code, "fs_path_escape");
        let err = fs_move_entry(&v.0, "note.md", "missing/dir/b.md").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        assert!(v.0.join("note.md").exists());

        // rename 失败（把目录移进它自己内部 = 内核拒绝）如实报错、不静默 copy+delete：
        // 源目录与内容仍在，目标位置不存在（跨卷失败走同一条错误路径）。
        let err = fs_move_entry(&v.0, "sub", "sub/deep/inner").unwrap_err();
        assert_eq!(err.code, "fs_move_failed");
        assert!(v.0.join("sub/deep").is_dir());
        assert!(!v.0.join("sub/deep/inner").exists());
    }

    #[test]
    fn scan_ignores_lumir_tmp_ghost_but_keeps_other_dotfiles() {
        let v = TempVault::with_fixture();
        // 崩溃残留的 ghost 与合法点文件并存：模式只吞 `.lumir-` tmp
        std::fs::write(v.0.join(".note.md.lumir-4242"), "ghost").unwrap();
        std::fs::write(v.0.join(".hidden.conf"), "cfg").unwrap();
        let entries = scan_workspace(&v.0, &v.policy()).expect("scan");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(
            !paths.iter().any(|p| p.contains(".lumir-")),
            "paths: {paths:?}"
        );
        assert!(paths.contains(&".hidden.conf"), "paths: {paths:?}");
    }

    #[test]
    fn scan_sweeps_stale_ghost_tmps_only() {
        let v = TempVault::with_fixture();
        let ghost_root = v.0.join(".note.md.lumir-4242");
        let ghost_nested = v.0.join("sub/.deep.md.lumir-4243");
        let dotfile = v.0.join(".hidden.conf");
        std::fs::write(&ghost_root, "ghost").unwrap();
        std::fs::write(&ghost_nested, "ghost").unwrap();
        std::fs::write(&dotfile, "cfg").unwrap();
        // now 前拨过阈值（不依赖改 mtime 的额外依赖）：三个文件都「超龄」，
        // 只有 lumir tmp 被清除，合法点文件必须留存
        let aged = SystemTime::now() + GHOST_TMP_MAX_AGE + Duration::from_secs(1);
        let entries = scan_workspace_at(&v.0, &v.policy(), aged).expect("scan");
        assert!(!ghost_root.exists(), "超龄 ghost tmp 应被清除");
        assert!(!ghost_nested.exists(), "嵌套目录内的超龄 ghost 也应被清除");
        assert!(dotfile.exists(), "合法点文件不得被清除");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(
            !paths.iter().any(|p| p.contains(".lumir-")),
            "paths: {paths:?}"
        );
        assert!(paths.contains(&".hidden.conf"), "paths: {paths:?}");
    }

    #[test]
    fn scan_keeps_fresh_ghost_tmp_in_flight() {
        let v = TempVault::with_fixture();
        let fresh = v.0.join(".note.md.lumir-4242");
        std::fs::write(&fresh, "in-flight").unwrap();
        // 未超龄：在途保存的 tmp 不得被清除（同进程 tmp 生命周期为毫秒级）
        let _ = scan_workspace(&v.0, &v.policy()).expect("scan");
        assert!(fresh.exists(), "未超龄的 tmp 不删");
    }

    #[test]
    fn watch_does_not_emit_lumir_tmp_events() {
        let v = TempVault::with_fixture();
        std::thread::sleep(Duration::from_millis(700));
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let watcher = watch(&v.0, &v.policy(), move |batch| {
            tx.send(batch).expect("send batch");
        })
        .expect("watch");
        let entries = scan_workspace(&v.0, &v.policy()).expect("scan");
        watcher.seed(entries.iter().map(|e| e.path.clone()));

        std::thread::sleep(Duration::from_millis(500));
        // 一次完整保存 = tmp 创建 + rename 替换：事件流只许出现目标文件
        let revision = file_revision(&v.0, "note.md").unwrap();
        save_document(&v.0, "note.md", &revision, "# via save").unwrap();

        let batch = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("batch within 5s");
        assert!(
            batch
                .iter()
                .any(|c| c.path == "note.md" && c.kind == FsChangeKind::Modified),
            "batch: {batch:?}"
        );
        assert!(
            !batch.iter().any(|c| c.path.contains(".lumir-")),
            "tmp ghost 不得进入事件流：{batch:?}"
        );
    }

    #[test]
    fn watch_stops_when_dropped() {
        let v = TempVault::with_fixture();
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let w = watch(&v.0, &v.policy(), move |batch| {
            let _ = tx.send(batch);
        })
        .expect("watch");
        drop(w);
        std::fs::write(v.0.join("after-drop.md"), "x").unwrap();
        // debounce 线程随 channel 断开退出；不应再收到任何批次
        assert!(rx.recv_timeout(Duration::from_millis(500)).is_err());
    }

    #[test]
    fn validate_new_name_rejects_dot_slash_ignored_and_accepts_normal() {
        for bad in ["", "a/b", ".", "..", ".git", ".DS_Store", "node_modules"] {
            let err = validate_new_name(bad).unwrap_err();
            assert_eq!(err.code, "fs_name_invalid", "case: {bad:?}");
        }
        // 合法点文件不受内置规则牵连（`.gitignore` 不在 BUILTIN_NAMES，也不命中临时文件模式）
        for ok in ["note.md", "笔记.md", ".gitignore", "a.txt"] {
            assert!(validate_new_name(ok).is_ok(), "case: {ok:?}");
        }
    }

    #[test]
    fn resolve_new_rejects_escape_bad_names_and_collisions() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        // 父目录逃逸：绝对路径与 `..` 穿越都被 resolve_in_vault 挡住
        for parent in ["../outside", "/etc", "sub/../../etc"] {
            let err = resolve_new_in_vault(root, parent, "x.md").unwrap_err();
            assert_eq!(err.code, "fs_path_escape", "parent: {parent}");
        }
        // 末段名非法：空 / 含斜杠 / 点 / 点点 / 忽略集三种
        for name in ["", "a/b", ".", "..", ".git", ".DS_Store", "node_modules"] {
            let err = resolve_new_in_vault(root, "", name).unwrap_err();
            assert_eq!(err.code, "fs_name_invalid", "name: {name:?}");
        }
        // 撞名：既有文件与既有目录都要挡住
        for name in ["note.md", "sub"] {
            let err = resolve_new_in_vault(root, "", name).unwrap_err();
            assert_eq!(err.code, "fs_already_exists", "name: {name}");
        }
        // 父目录不存在 / 父是文件
        let err = resolve_new_in_vault(root, "missing", "x.md").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        let err = resolve_new_in_vault(root, "note.md", "x.md").unwrap_err();
        assert_eq!(err.code, "fs_path_invalid");
        // 正常：根下与子目录下，返回父的规范化路径 + join(name)（目标允许不存在）
        let canon = root.canonicalize().unwrap();
        assert_eq!(
            resolve_new_in_vault(root, "", "new.md").unwrap(),
            canon.join("new.md")
        );
        assert_eq!(
            resolve_new_in_vault(root, "sub/deep", "new.md").unwrap(),
            canon.join("sub/deep/new.md")
        );
    }

    #[test]
    fn rename_moves_within_parent_and_never_overwrites() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        assert_eq!(
            rename_entry(root, "note.md", "renamed.md").unwrap(),
            "renamed.md"
        );
        assert!(!root.join("note.md").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("renamed.md")).unwrap(),
            "# hello"
        );
        // 嵌套路径：父段由源路径派生，返回路径带父段
        assert_eq!(
            rename_entry(root, "sub/deep/a.txt", "b.txt").unwrap(),
            "sub/deep/b.txt"
        );
        assert!(root.join("sub/deep/b.txt").exists());
        // 目录改名连同子孙一起走
        assert_eq!(rename_entry(root, "sub", "sub2").unwrap(), "sub2");
        assert_eq!(
            std::fs::read_to_string(root.join("sub2/deep/b.txt")).unwrap(),
            "a"
        );
        // 撞名：目标与源都逐字节不变
        let err = rename_entry(root, "renamed.md", "main.rs").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert_eq!(
            std::fs::read_to_string(root.join("main.rs")).unwrap(),
            "fn main() {}"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("renamed.md")).unwrap(),
            "# hello"
        );
        // 源不存在 / 新名非法（非法时源不动）
        let err = rename_entry(root, "missing.md", "x.md").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        let err = rename_entry(root, "renamed.md", ".git").unwrap_err();
        assert_eq!(err.code, "fs_name_invalid");
        assert!(root.join("renamed.md").exists());
    }

    /// 撞名必须被挡住（r1 评审 P2-2）：`std::fs::rename` 的 POSIX 语义是原子替换已存在的
    /// 目标，因此「撞名不覆盖」不能只靠 `resolve_new_in_vault` 的探测。这条单测钉的是**可观测
    /// 契约**：rename 到已存在的名字必须报 `fs_already_exists`（与 create 路径同一个码、同一句
    /// 话），源与目标逐字节不变——普通文件与既有目录两种形态都覆盖。
    ///
    /// **它钉不到窗口**：探测与复查之间那段检查-执行窗口无法用确定性测试构造（要在两次系统
    /// 调用之间插入外部进程建文件），所以这里证明的是「结果不覆盖」，不是「零窗口」；窗口的
    /// 取舍与代价写在 [`rename_entry`] 的注释里。防线上它管住的是「写路径整个失去撞名判定」
    /// 这类改动（例如某次重构改成不经 `resolve_new_in_vault` 直接 rename）。
    #[test]
    fn rename_refuses_existing_target_on_write_path() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        // 目标已存在（普通文件）：报错、两边逐字节不变
        let err = rename_entry(root, "note.md", "main.rs").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert!(
            err.message.contains("已存在同名条目：main.rs"),
            "人话里要点名撞的条目：{}",
            err.message
        );
        assert_eq!(
            std::fs::read_to_string(root.join("note.md")).unwrap(),
            "# hello"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("main.rs")).unwrap(),
            "fn main() {}"
        );
        // 目标已存在（目录）：同样挡住（rename 到目录名下会替换空目录或报 ENOTDIR，
        // 两种都不是我们要的语义）
        let err = rename_entry(root, "note.md", "sub").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert!(root.join("sub/deep/a.txt").exists(), "既有目录不得被动");
        assert!(root.join("note.md").exists());
        // 忽略集名与非法名走的是另一条分支（保持既有语义）
        assert_eq!(
            rename_entry(root, "note.md", ".git").unwrap_err().code,
            "fs_name_invalid"
        );
    }

    #[test]
    fn create_file_and_dir_are_atomic_and_refuse_collision() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        assert_eq!(
            create_file_entry(root, "sub", "new.md").unwrap(),
            "sub/new.md"
        );
        let meta = std::fs::metadata(root.join("sub/new.md")).unwrap();
        assert!(meta.is_file());
        assert_eq!(meta.len(), 0, "新建的是空文件");
        assert_eq!(create_dir_entry(root, "", "newdir").unwrap(), "newdir");
        assert!(root.join("newdir").is_dir());
        // 撞名不覆盖：既有文件逐字节不变
        let err = create_file_entry(root, "", "note.md").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert_eq!(
            std::fs::read_to_string(root.join("note.md")).unwrap(),
            "# hello"
        );
        let err = create_dir_entry(root, "", "sub").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        // 忽略集名 / 逃逸父 / 父不存在
        let err = create_file_entry(root, "", "node_modules").unwrap_err();
        assert_eq!(err.code, "fs_name_invalid");
        let err = create_dir_entry(root, "../outside", "x").unwrap_err();
        assert_eq!(err.code, "fs_path_escape");
        let err = create_file_entry(root, "missing", "x.md").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        // 成功不是空口承诺：新建的两个条目真的在磁盘上
        assert!(root.join("sub/new.md").exists() && root.join("newdir").exists());
    }

    /// 删除 = 移废纸篓。**成功路径真的会往用户的废纸篓里放一个条目**：macOS 下
    /// `trash::os_limited`（list / restore）不参与编译，测试内无法把它放回。因此测试文件
    /// 用可辨识的名字（`lumir-trash-test-<pid>.txt`）且内容为空，人工清理一眼可辨；
    /// 「可恢复」这条产品承诺由 `trash` 自身的平台语义与真机场景 47 承担。
    #[test]
    fn trash_moves_entry_out_of_vault_and_reports_human_errors() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        let rel = format!("lumir-trash-test-{}.txt", std::process::id());
        let victim = root.join(&rel);
        std::fs::write(&victim, "").unwrap();
        trash_entry(root, &rel).expect("移到废纸篓");
        assert!(!victim.exists(), "入篓后 vault 内不应再有该条目");
        assert!(
            root.join("note.md").exists(),
            "只动目标条目，vault 其余内容不变"
        );
        // 错误路径一：目标不存在（菜单开着期间被外部移走）
        let err = trash_entry(root, "missing.md").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        // 错误路径二：空路径（防御性，vault 根永不进废纸篓）
        let err = trash_entry(root, "").unwrap_err();
        assert_eq!(err.code, "fs_path_invalid");
        assert!(root.join("note.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn trash_refuses_vault_root_reached_through_symlink() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        // vault 内指向 vault 根的 symlink：resolve_in_vault 归一后正好是根，必须挡住
        std::os::unix::fs::symlink(root, root.join("loop")).unwrap();
        let err = trash_entry(root, "loop").unwrap_err();
        assert_eq!(err.code, "fs_trash_failed", "vault 根本身永不进废纸篓");
        assert!(root.join("note.md").exists());
    }
    // -----------------------------------------------------------------------
    // change vault-open-ignore-set：一份规则表（内置 + 用户）、按需枚举、watch 判定
    // -----------------------------------------------------------------------

    /// 内置规则的**表本身**（tasks 1.1）：16 个名字逐条命中、临时文件模式两条命中，
    /// 名字相近的（`targets` / `dist-old` / `Target`）与 A3 档（`build` / `out` / `vendor`）
    /// 都不命中——它们是精确名字字面量，不是前缀或通配匹配。
    #[test]
    fn builtin_table_matches_exactly_the_declared_names_and_tmp_patterns() {
        for name in BUILTIN_NAMES {
            assert!(is_builtin_name(name), "{name} 必须命中内置规则");
            // 同名**目录**一视同仁（无尾斜杠字面量的 gitignore 语义）
            assert!(is_builtin_hidden(name, true), "{name} 作为目录同样命中");
        }
        for name in [
            ".lumir-",
            ".lumir-1",
            ".lumir-notes.md",
            "..lumir-1",
            ".a.lumir-1",
            ".note.md.lumir-1",
        ] {
            assert!(is_builtin_name(name), "临时文件模式必须命中 {name}");
        }
        for name in [
            "Target",
            "target.md",
            "targets",
            "dist-old",
            "builds",
            // A3 档经 Alex 2026-09-28 裁决不纳入
            "build",
            "out",
            "vendor",
            // 合法点文件与「以 .lumir- 之外的形式」出现的名字
            ".hidden.conf",
            "note.md.lumir-1",
            "a.lumir-1",
            "notes",
        ] {
            assert!(!is_builtin_name(name), "{name} MUST NOT 命中内置规则");
        }
    }

    /// 对拍测试（tasks 1.2）：同一份 corpus 同时跑「今日判据」与「新内置匹配器」，逐条断言
    /// **完全一致、零例外**——不许有「已知差异例外」，任何不一致都是规则写少了。
    ///
    /// 「今日判据」的口径 = 名字等值 + `starts_with('.') && contains(".lumir-")`；名字等值那一半
    /// 按**同一份 16 条名字表**求值（本 change 把名单从 3 条扩到 16 条是**有意的裁决**，不是
    /// 对拍要证明的东西）——这条测试钉的是**模式语义**的等价：无斜杠字面量 ≡ 任意深度同名，
    /// 两条临时文件模式 ≡ 「`.` 开头且含 `.lumir-`」。临时文件模式必须**两条**：只写
    /// `.*.lumir-*` 会漏掉「以 `.lumir-` 开头」的名字（r2/r3 评审用真 `git check-ignore`
    /// 实测过 `.lumir-notes.md`）。
    #[test]
    fn builtin_rules_are_equivalent_to_the_legacy_predicate_on_a_name_corpus() {
        fn legacy_name(name: &str) -> bool {
            BUILTIN_NAMES.contains(&name) || (name.starts_with('.') && name.contains(".lumir-"))
        }
        fn legacy_path(rel: &str) -> bool {
            rel.split('/').any(legacy_name)
        }
        let corpus = [
            "target",
            "Target",
            "target.md",
            "dist-old",
            "builds",
            "build",
            "out",
            "vendor",
            ".DS_Store",
            "node_modules",
            ".venv",
            ".pnpm-store",
            ".a.lumir-1",
            "..lumir-1",
            ".lumir-",
            ".lumir-1",
            ".lumir-notes.md",
            "note.md.lumir-1",
            // 相近名字与合法点文件（反向输入：不许把不该剪的剪掉）
            "targets",
            "dist-old-2",
            ".hidden.conf",
            "node_modules_backup",
            "notes",
            // 嵌套路径：任一组件命中即命中
            "a/target/x.md",
            "a/.git/config",
            "target/x.md",
            "a/b/node_modules/c.js",
            "a/targets/x.md",
            "a/dist-old/y.md",
        ];
        for rel in corpus {
            assert_eq!(
                is_builtin_hidden(rel, false),
                legacy_path(rel),
                "corpus 差异（规则写少了或写多了）：{rel}"
            );
            assert_eq!(
                is_builtin_hidden(rel, true),
                legacy_path(rel),
                "corpus 差异（目录形态）：{rel}"
            );
        }
    }

    /// 枚举侧（tasks 1.1）：内置规则命中的条目与**整棵子树**都不出现，A3 档与名字相近的
    /// 目录照常枚举。
    #[test]
    fn scan_hides_builtin_output_dirs_with_their_subtrees_and_keeps_near_names() {
        let v = TempVault::new();
        let r = &v.0;
        std::fs::create_dir_all(r.join("target/debug")).unwrap();
        std::fs::write(r.join("target/debug/x"), "x").unwrap();
        std::fs::create_dir_all(r.join("dist")).unwrap();
        std::fs::write(r.join("dist/bundle.js"), "x").unwrap();
        std::fs::create_dir_all(r.join("crfates/venv/lib")).unwrap();
        std::fs::write(r.join("crfates/venv/lib/site.py"), "x").unwrap();
        std::fs::write(r.join("crfates/venv/keep.md"), "x").unwrap();
        std::fs::create_dir_all(r.join("a/b/.pnpm-store")).unwrap();
        std::fs::write(r.join("a/b/.pnpm-store/blob"), "x").unwrap();
        // A3 档：不收
        for dir in ["build", "out", "vendor"] {
            std::fs::create_dir_all(r.join(dir)).unwrap();
            std::fs::write(r.join(dir).join("f.txt"), "x").unwrap();
        }
        // 名字相近的
        for dir in ["targets", "dist-old", "builds"] {
            std::fs::create_dir_all(r.join(dir)).unwrap();
            std::fs::write(r.join(dir).join("f.txt"), "x").unwrap();
        }
        let entries = scan_workspace(r, &v.policy()).expect("scan");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        for hidden in [
            "target",
            "target/debug",
            "target/debug/x",
            "dist",
            "dist/bundle.js",
            "crfates/venv",
            "crfates/venv/keep.md",
            "a/b/.pnpm-store",
        ] {
            assert!(!paths.contains(&hidden), "{hidden} 必须不可见：{paths:?}");
        }
        for visible in [
            "build",
            "build/f.txt",
            "out",
            "out/f.txt",
            "vendor",
            "vendor/f.txt",
            "targets",
            "targets/f.txt",
            "dist-old",
            "dist-old/f.txt",
            "builds",
            "builds/f.txt",
        ] {
            assert!(
                paths.contains(&visible),
                "{visible} 必须照常可见：{paths:?}"
            );
        }
        // 惰性标记：全是 false（没有任何用户规则来源）
        assert!(entries.iter().all(|e| !e.lazy), "{entries:?}");
    }

    /// 判定链的三步（tasks 2.2）：内置 ⇒ Hidden（**命中即定格**，用户规则的取反推不翻）、
    /// 用户规则 ⇒ Lazy、其余 ⇒ Visible。用户规则**内部**的取反照常生效。
    #[test]
    fn classify_has_three_branches_and_builtin_wins_over_user_negation() {
        let v = TempVault::new();
        std::fs::write(
            v.0.join(".gitignore"),
            ".local/\n!target/\ndrafts/\n!drafts/keep/\n",
        )
        .unwrap();
        let p = v.default_policy();
        // 内置先判、命中即定格（`!target/` 不能把它放回可见集）
        assert_eq!(p.classify("target", true), EntryClass::Hidden);
        assert_eq!(p.classify("target", false), EntryClass::Hidden);
        // 反向输入（让「先判」这条真的可证伪）：用户规则**自己也忽略**同一个内置名字
        // ——若把用户规则提到前面判，这条会被降级成「惰性可见」，与 §2.2 的判定顺序不符。
        let v2 = TempVault::new();
        std::fs::write(v2.0.join(".gitignore"), "target/\n").unwrap();
        let p2 = v2.default_policy();
        assert_eq!(
            p2.classify("target", true),
            EntryClass::Hidden,
            "用户规则不能把内置规则命中的条目降级成惰性可见"
        );
        // 用户规则命中 ⇒ 惰性可见
        assert_eq!(p.classify(".local", true), EntryClass::Lazy);
        assert_eq!(p.classify("drafts", true), EntryClass::Lazy);
        // 「祖先被排除 ⇒ 子孙全被排除」
        assert_eq!(p.classify(".local/deep", true), EntryClass::Lazy);
        assert_eq!(p.classify(".local/deep/x.md", false), EntryClass::Lazy);
        // 用户规则**内部**的取反生效
        assert_eq!(p.classify("drafts/keep", true), EntryClass::Visible);
        assert_eq!(p.classify("drafts/keep/x.md", false), EntryClass::Visible);
        // 其余
        assert_eq!(p.classify("notes.md", false), EntryClass::Visible);
        assert_eq!(p.classify("notes/today.md", false), EntryClass::Visible);
    }

    /// 用户规则的来源与优先级（tasks 2.3）：`.gitignore`（含递归途中的**嵌套** `.gitignore`）
    /// 与 `.git/info/exclude` 三条来源都生效；优先级按 git 口径——深层 `.gitignore` > 浅层 >
    /// `info/exclude`，「同一路径上最深的匹配决定」。
    #[test]
    fn user_rules_come_from_gitignore_and_info_exclude_with_git_precedence() {
        let v = TempVault::new();
        let r = &v.0;
        std::fs::create_dir_all(r.join(".git/info")).unwrap();
        std::fs::create_dir_all(r.join("sub")).unwrap();
        std::fs::write(r.join(".gitignore"), "root-ignored/\nx/\n").unwrap();
        std::fs::write(r.join(".git/info/exclude"), "excluded/\n").unwrap();
        // 非 git 仓库也有 .gitignore：本 vault 其实有 .git，这条覆盖由下一个测试承担
        std::fs::write(r.join("sub/.gitignore"), "!x/\nsub-ignored/\n").unwrap();
        for dir in ["root-ignored", "excluded", "x", "sub/x", "sub/sub-ignored"] {
            std::fs::create_dir_all(r.join(dir)).unwrap();
        }
        let p = v.default_policy();
        // 嵌套 .gitignore 在**递归进入可见目录时**逐层叠加（§4.2），因此先跑一次枚举
        scan_workspace(r, &p).expect("scan");
        assert_eq!(
            p.classify("root-ignored", true),
            EntryClass::Lazy,
            ".gitignore 生效"
        );
        assert_eq!(
            p.classify("excluded", true),
            EntryClass::Lazy,
            "info/exclude 生效"
        );
        assert_eq!(
            p.classify("sub/sub-ignored", true),
            EntryClass::Lazy,
            "嵌套 .gitignore 生效"
        );
        assert_eq!(
            p.classify("x", true),
            EntryClass::Lazy,
            "浅层 .gitignore 命中"
        );
        assert_eq!(
            p.classify("sub/x", true),
            EntryClass::Visible,
            "深层 .gitignore 的取反覆盖浅层的忽略（最深匹配决定）"
        );
        // `.git` 是**目录**：info/exclude 被读；`.git` 自身是内置规则 ⇒ 不可见
        assert_eq!(p.classify(".git", true), EntryClass::Hidden);
    }

    /// 非 git 仓库（无 `.git`）里的 `.gitignore` 照样生效；`.git` 是**文件**（linked worktree
    /// 的 gitlink）时不读 `info/exclude`——真身在 gitdir 里，跟着 gitlink 走会把 vault 边界
    /// 之外的配置读进来（§4.9）。
    #[test]
    fn gitignore_works_without_git_dir_and_gitlink_never_follows() {
        let v = TempVault::new();
        std::fs::create_dir_all(v.0.join("plain-ignored")).unwrap();
        std::fs::write(v.0.join(".gitignore"), "plain-ignored/\n").unwrap();
        let p = v.default_policy();
        assert_eq!(
            p.classify("plain-ignored", true),
            EntryClass::Lazy,
            "非 git 仓库里的 .gitignore 仍然是用户的声明"
        );

        // gitlink 形态：`.git` 是一个文件，真身在 vault 之外的另一棵目录里
        let outside = TempVault::new();
        std::fs::create_dir_all(outside.0.join("info")).unwrap();
        std::fs::write(outside.0.join("info/exclude"), "linked-ignored/\n").unwrap();
        let v2 = TempVault::new();
        std::fs::create_dir_all(v2.0.join("linked-ignored")).unwrap();
        std::fs::write(
            v2.0.join(".git"),
            format!("gitdir: {}\n", outside.0.display()),
        )
        .unwrap();
        let p2 = v2.default_policy();
        assert_eq!(
            p2.classify("linked-ignored", true),
            EntryClass::Visible,
            "gitlink 指向的 gitdir 里的 exclude MUST NOT 被读（vault 之外的状态不参与判定）"
        );
    }

    /// 「全局 excludes 不参与」（spec scenario）：vault **之外**的忽略声明一律不读——本 capability
    /// MUST NOT 读取 vault 之外的忽略配置。
    #[test]
    fn rules_outside_the_vault_are_never_read() {
        let parent = TempVault::new();
        let root = parent.0.join("vault");
        std::fs::create_dir_all(root.join("outside-dir")).unwrap();
        std::fs::write(parent.0.join(".gitignore"), "outside-dir/\n").unwrap();
        let p = IgnorePolicy::load(&root, &[".gitignore".to_string()]);
        assert_eq!(
            p.classify("outside-dir", true),
            EntryClass::Visible,
            "父目录的 .gitignore 不是这个 vault 的规则来源"
        );
    }

    /// 规则表的生效时点（tasks 2.4）：装载时编译一次，规则文件内容的改动**下次装载**才生效
    /// （本会话不重编——可见集不随规则变化，变的只是「哪些子树被主动枚举」）。
    #[test]
    fn rule_changes_take_effect_at_the_next_load_only() {
        let v = TempVault::new();
        std::fs::create_dir_all(v.0.join("drafts")).unwrap();
        std::fs::write(v.0.join(".gitignore"), "").unwrap();
        let p = v.default_policy();
        assert_eq!(p.classify("drafts", true), EntryClass::Visible);

        std::fs::write(v.0.join(".gitignore"), "drafts/\n").unwrap();
        assert_eq!(
            p.classify("drafts", true),
            EntryClass::Visible,
            "本会话不重编：规则表在装载时就编译好了"
        );
        let reloaded = v.default_policy();
        assert_eq!(
            reloaded.classify("drafts", true),
            EntryClass::Lazy,
            "下次装载（重新构造策略）后新规则生效"
        );
    }

    /// 空清单 = 没有用户规则来源（tasks 2.5 语义②的后端面）：只剩内置规则，配置 MUST NOT
    /// 影响内置规则。
    #[test]
    fn empty_rule_list_leaves_only_builtin_rules() {
        let v = TempVault::new();
        std::fs::create_dir_all(v.0.join(".local")).unwrap();
        std::fs::create_dir_all(v.0.join("target")).unwrap();
        std::fs::write(v.0.join(".gitignore"), ".local/\n").unwrap();
        let p = v.policy_with(&[]);
        assert_eq!(
            p.classify(".local", true),
            EntryClass::Visible,
            "清单为空 ⇒ 连 .gitignore 也不读（非 git vault 的等价行为）"
        );
        assert_eq!(
            p.classify(".local/x.md", false),
            EntryClass::Visible,
            "子孙照常递归枚举"
        );
        assert_eq!(
            p.classify("target", true),
            EntryClass::Hidden,
            "内置规则恒定生效、不在配置面内"
        );
    }

    /// 惰性目录出行为一行、子孙不进枚举（spec scenario）；`.local` 之外的内容照常递归。
    #[test]
    fn scan_emits_one_lazy_row_for_user_ignored_dir_and_skips_its_descendants() {
        let v = TempVault::new();
        let r = &v.0;
        std::fs::create_dir_all(r.join(".local/deep")).unwrap();
        std::fs::write(r.join(".local/tutorial.md"), "t").unwrap();
        std::fs::write(r.join(".local/deep/x.md"), "x").unwrap();
        std::fs::create_dir_all(r.join("notes")).unwrap();
        std::fs::write(r.join("notes/a.md"), "a").unwrap();
        std::fs::write(r.join(".gitignore"), ".local/\n").unwrap();
        let entries = scan_workspace(r, &v.default_policy()).expect("scan");
        let by_path = |p: &str| entries.iter().find(|e| e.path == p);
        let local = by_path(".local").expect(".local 必须在结果里（惰性可见）");
        assert_eq!(local.kind, FsEntryKind::Dir);
        assert!(local.lazy, "用户规则命中的目录惰性标记为 true");
        assert!(by_path(".local/tutorial.md").is_none(), "子孙不进本次枚举");
        assert!(by_path(".local/deep").is_none(), "子孙不进本次枚举");
        let outside = by_path("notes/a.md").expect("其余内容照常递归枚举");
        assert!(!outside.lazy);
    }

    /// 按需枚举（tasks 3.2）：**一层**、分类口径同源、成功即登记物化。
    #[test]
    fn scan_dir_returns_one_level_and_registers_materialization() {
        let v = TempVault::new();
        let r = &v.0;
        std::fs::create_dir_all(r.join(".local/deep")).unwrap();
        std::fs::write(r.join(".local/tutorial.md"), "t").unwrap();
        std::fs::write(r.join(".local/deep/hidden.md"), "h").unwrap();
        std::fs::write(r.join(".local/target"), "x").unwrap();
        std::fs::write(r.join(".gitignore"), ".local/\n").unwrap();
        let p = v.default_policy();
        assert!(!p.is_materialized(".local"));
        let entries = scan_dir(r, &p, ".local").expect("展开惰性目录");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(
            paths,
            vec![".local/deep", ".local/tutorial.md"],
            "只返回一层（无子孙），且内置规则命中的 .local/target 被丢弃"
        );
        let deep = entries.iter().find(|e| e.path == ".local/deep").unwrap();
        assert!(deep.lazy, "惰性子目录同样出惰性行");
        let file = entries
            .iter()
            .find(|e| e.path == ".local/tutorial.md")
            .unwrap();
        assert!(file.lazy, "惰性文件不进索引 ⇒ 惰性标记为 true");
        assert!(p.is_materialized(".local"), "成功返回即登记物化");

        // 对可见目录调用同样合法（结果与装载时枚举里该目录的子条目集合一致）
        std::fs::create_dir_all(r.join("notes")).unwrap();
        std::fs::write(r.join("notes/a.md"), "a").unwrap();
        let visible = scan_dir(r, &p, "notes").expect("对可见目录调用");
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].path, "notes/a.md");
        assert!(!visible[0].lazy);
    }

    /// 按需枚举的边界（tasks 3.2）：越界 / 不存在 / 不是目录都给人话错误，且不读 vault 之外。
    #[test]
    fn scan_dir_rejects_out_of_bounds_missing_and_non_dirs() {
        let v = TempVault::with_fixture();
        let p = v.policy();
        for bad in ["../outside", "/etc", "sub/../../etc"] {
            let err = scan_dir(&v.0, &p, bad).unwrap_err();
            assert_eq!(err.code, "fs_path_escape", "case: {bad}");
        }
        assert_eq!(
            scan_dir(&v.0, &p, "missing").unwrap_err().code,
            "fs_not_found"
        );
        assert_eq!(
            scan_dir(&v.0, &p, "note.md").unwrap_err().code,
            "fs_path_invalid",
            "目标不是目录"
        );
        assert_eq!(scan_dir(&v.0, &p, "").unwrap_err().code, "fs_path_invalid");
        // 失败的调用 MUST NOT 留下物化登记（登记只在成功路径上）
        assert!(!p.is_materialized("note.md"));
    }

    /// watch 判定的六条分支（tasks 4.1）——判定本体是纯函数 [`watch_verdict`]，这里逐条钉死：
    /// ① 未物化的用户规则目录内部变更**不**产生事件；② 物化后**产生**；③ 用户规则命中的
    /// 条目自身的 created / deleted **总**产生（末段不判用户规则）；④ 内置规则命中的**祖先**
    /// 下的变更不产生；⑤ 内置规则命中的**末段**同样不产生（幻影行判据）；⑥ 投递的事件带回
    /// **正确**的 `lazy`。
    #[test]
    fn watch_verdict_covers_the_six_branches() {
        let v = TempVault::new();
        let r = &v.0;
        std::fs::create_dir_all(r.join(".local/deep")).unwrap();
        std::fs::write(r.join(".gitignore"), ".local/\nHANDOFF.md\n").unwrap();
        let p = v.default_policy();
        let abs = |rel: &str| r.join(rel);
        let verdict = |rel: &str, is_dir: Option<bool>| watch_verdict(&p, r, &abs(rel), is_dir);

        // ① 未物化：`.local` 命中用户规则且未展开 ⇒ 内部变更一律不投递
        assert_eq!(verdict(".local/a.md", Some(false)), None);
        assert_eq!(verdict(".local/deep/x.md", Some(false)), None);
        // ② 物化后：照常投递（用户展开过的地方保持实时）
        p.mark_materialized(".local");
        assert_eq!(
            verdict(".local/a.md", Some(false)),
            Some((".local/a.md".to_string(), true))
        );
        p.forget_materialized(".local");

        // ③ 用户规则命中的条目**自身**的增删总投递（末段不参与用户规则判定）
        assert_eq!(
            verdict(".local", Some(true)),
            Some((".local".to_string(), true)),
            "未展开的惰性目录自身的新建 / 删除必须实时"
        );
        assert_eq!(
            verdict("HANDOFF.md", Some(false)),
            Some(("HANDOFF.md".to_string(), true)),
            "用户规则命中的文件自身的行级事件总是投递"
        );
        // ⑥ 投递的事件带回正确的 lazy（用户规则命中 ⇒ true，其余 ⇒ false）
        assert_eq!(
            verdict("notes.md", Some(false)),
            Some(("notes.md".to_string(), false))
        );
        // ④ 内置规则命中的**祖先**下的变更不投递
        assert_eq!(verdict("target/debug/x", Some(false)), None);
        assert_eq!(verdict("a/node_modules/pkg/i.js", Some(false)), None);
        // ⑤ 内置规则命中的**末段**同样不投递（外部 `mkdir target` / `npm install` 的幻影行判据）
        assert_eq!(verdict("target", Some(true)), None, "mkdired 的目录");
        assert_eq!(verdict("a/b/target", Some(true)), None);
        assert_eq!(verdict("node_modules", Some(true)), None);
        assert_eq!(verdict("a/dist", Some(true)), None);
        // 保存临时文件形态同样不进事件流
        assert_eq!(verdict(".note.md.lumir-1", Some(false)), None);
        assert_eq!(verdict(".lumir-notes.md", Some(false)), None);
        // vault 根自身的事件没有可投递的行
        assert_eq!(watch_verdict(&p, r, r, None), None);
    }

    /// 物化开关的**端到端**一处（tasks 4.1 的分支 ①②，跑真 FSEvents 流）：未展开的惰性目录
    /// 内部变更一个都不进事件流；`fs_scan_dir`（物化）之后同一目录内的变更照常到达。
    #[test]
    fn watch_delivers_inside_lazy_dir_only_after_materialization() {
        let v = TempVault::new();
        std::fs::create_dir_all(v.0.join(".local")).unwrap();
        std::fs::write(v.0.join(".gitignore"), ".local/\n").unwrap();
        std::thread::sleep(Duration::from_millis(700));
        let policy = v.default_policy();
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let watcher = watch(&v.0, &policy, move |batch| {
            tx.send(batch).expect("send batch");
        })
        .expect("watch");
        let entries = scan_workspace(&v.0, &policy).expect("scan");
        watcher.seed(entries.iter().map(|e| e.path.clone()));
        std::thread::sleep(Duration::from_millis(500));

        // ① 未物化：`.local` 内新建文件不产生事件
        std::fs::write(v.0.join(".local/a.md"), "a").unwrap();
        let before = collect_batches(&rx, Duration::from_millis(1200));
        assert!(
            !before.iter().any(|c| c.path == ".local/a.md"),
            "未展开的惰性子树内部变更 MUST NOT 进事件流：{before:?}"
        );

        // 物化（= 用户展开它，走的是 `fs_scan_dir` 同一条登记）
        let scanned = scan_dir(&v.0, &policy, ".local").expect("展开");
        assert_eq!(scanned.len(), 1);
        assert!(policy.is_materialized(".local"));

        // ② 物化后：同一目录内的变更照常到达，且带回 lazy 标记
        std::fs::write(v.0.join(".local/b.md"), "b").unwrap();
        let after = collect_batches(&rx, Duration::from_millis(2000));
        let hit = after
            .iter()
            .find(|c| c.path == ".local/b.md")
            .unwrap_or_else(|| panic!("物化后 `.local/b.md` 必须进事件流：{after:?}"));
        assert_eq!(hit.kind, FsChangeKind::Created);
        assert!(
            hit.lazy,
            "惰性条目的事件必须带回 lazy=true（下游索引据此跳过）"
        );
    }

    /// 目录改名通道的惰性收口（tasks 4.3）：新出现的目录若命中用户规则，本批次只带出它
    /// **这一行**，MUST NOT 带出子孙；内置规则命中的条目一条都不进。
    #[test]
    fn expand_new_dir_subtrees_stops_at_a_lazy_dir() {
        let v = TempVault::new();
        let r = &v.0;
        std::fs::write(r.join(".gitignore"), ".local/\n").unwrap();
        std::fs::create_dir_all(r.join("outer/.local/deep")).unwrap();
        std::fs::write(r.join("outer/.local/deep/x.md"), "x").unwrap();
        std::fs::write(r.join("outer/note.md"), "n").unwrap();
        std::fs::create_dir_all(r.join("outer/target")).unwrap();
        std::fs::write(r.join("outer/target/bin"), "b").unwrap();
        let p = v.default_policy();
        let mut known = HashSet::new();
        let mut batch = vec![FsChange {
            kind: FsChangeKind::Created,
            path: "outer".into(),
            entry_kind: Some(FsEntryKind::Dir),
            lazy: false,
        }];
        expand_new_dir_subtrees(r, &p, &mut known, &mut batch);
        let find = |rel: &str| batch.iter().find(|c| c.path == rel);
        assert!(
            find("outer/note.md").is_some(),
            "可见条目照常带出：{batch:?}"
        );
        let lazy_dir = find("outer/.local").expect("惰性目录自身要带一行：{batch:?}");
        assert!(lazy_dir.lazy, "带出的惰性行必须标 lazy=true");
        assert!(
            find("outer/.local/deep").is_none() && find("outer/.local/deep/x.md").is_none(),
            "惰性目录 MUST NOT 带出子孙：{batch:?}"
        );
        assert!(
            find("outer/target").is_none(),
            "内置规则命中的条目一条都不进批次：{batch:?}"
        );
    }

    /// 被删路径的物化登记随之清除（tasks 4.3）：登记只影响惰性子树的实时性，不影响可见性；
    /// 新路径的登记由用户下次展开时重建。
    #[test]
    fn deleted_paths_clear_their_materialization_registration() {
        let v = TempVault::new();
        let p = v.default_policy();
        p.mark_materialized(".tower");
        p.mark_materialized(".tower/comms");
        p.mark_materialized(".local");
        assert!(p.is_materialized(".tower/comms"));

        let mut known: HashSet<String> = [".tower/comms/x.md".to_string()].into_iter().collect();
        let mut changes = vec![FsChange {
            kind: FsChangeKind::Deleted,
            path: ".tower".into(),
            entry_kind: None,
            lazy: false,
        }];
        refine_with_known(&v.0, &p, &mut known, &mut changes);
        assert_eq!(changes[0].kind, FsChangeKind::Deleted);
        assert!(!p.is_materialized(".tower"), "旧路径的登记随删除清除");
        assert!(!p.is_materialized(".tower/comms"), "子孙前缀的登记一并清除");
        assert!(p.is_materialized(".local"), "别的路径不受影响");
    }

    /// 批量存在探测（§4.11）：存在的子集按入参顺序返回、去重；越界与不存在的都不在集合里。
    #[test]
    fn paths_exist_returns_only_present_in_vault_paths() {
        let v = TempVault::with_fixture();
        let ask = vec![
            "note.md".to_string(),
            "sub/deep/a.txt".to_string(),
            "sub".to_string(),
            "missing.md".to_string(),
            "../outside".to_string(),
            "/etc/passwd".to_string(),
            "sub/../../etc/passwd".to_string(),
            "note.md".to_string(), // 重复项只回一次
        ];
        let found = paths_exist(&v.0, &ask);
        assert_eq!(found, vec!["note.md", "sub/deep/a.txt", "sub"]);
        assert!(paths_exist(&v.0, &[]).is_empty());
    }

    /// 用户规则命中的名字**不**被 `validate_new_name` 拒绝（§3.2）；内置规则命中的照旧拒绝。
    #[test]
    fn validate_new_name_ignores_user_rules_but_rejects_builtin_names() {
        // 单段名判定不经过任何 vault 上下文：用户规则（`.gitignore`）在名字层面不参与
        for ok in ["targets", "dist-old", "drafts", "HANDOFF.md", ".local"] {
            assert!(validate_new_name(ok).is_ok(), "case: {ok}");
        }
        for bad in ["target", "dist", ".venv", ".pnpm-store", "node_modules"] {
            let err = validate_new_name(bad).unwrap_err();
            assert_eq!(err.code, "fs_name_invalid", "case: {bad}");
        }
    }

    /// 两份策略的物化集合互不相干（tasks 4.2 的下半：集合随 vault 装载重建，MUST NOT 串用）。
    #[test]
    fn policies_do_not_share_materialization() {
        let a = TempVault::new();
        let b = TempVault::new();
        let pa = a.policy();
        let pb = b.policy();
        pa.mark_materialized(".tower");
        assert!(pa.is_materialized(".tower"));
        assert!(
            !pb.is_materialized(".tower"),
            "另一份策略（另一个 vault）不得共享物化登记"
        );
    }
    /// 回归（M292 r1 评审 **P1-1**）：**惰性子树内部不读它的 `.gitignore`**（design §4.2/§4.9、
    /// spec「祖先被排除 ⇒ 子孙全被排除」、git 语义「排除目录下不可 re-include」）。
    ///
    /// 现场：根规则把 `.local/` 排除，而 `.local/.gitignore` 里有一行白名单（`!keep.md` /
    /// `!deep/`）。若展开惰性目录时把这份嵌套规则登记进来源表，嵌套来源的 Whitelist 会比根来源
    /// 的祖先排除**更深**、从而成为「第一个确定结论」⇒ 子条目从 Lazy 翻成 Visible，三处一起破：
    /// 索引的纯函数口径（被翻条目的 created/modified 会 upsert 进链接索引）、惰性展开（翻成
    /// Visible 的子目录展开即空目录）、物化事件闸（未物化的子树事件照投）。
    ///
    /// 判据分三面：`scan_dir` 返回的行、`scan_dir` 之后的 `classify`、以及事件判定带回的 `lazy`。
    #[test]
    fn scan_dir_never_reads_gitignore_inside_a_lazy_subtree() {
        let v = TempVault::new();
        let r = &v.0;
        std::fs::create_dir_all(r.join(".local/deep")).unwrap();
        std::fs::write(r.join(".local/keep.md"), "k").unwrap();
        std::fs::write(r.join(".local/other.md"), "o").unwrap();
        std::fs::write(r.join(".local/deep/x.md"), "x").unwrap();
        std::fs::write(r.join(".gitignore"), ".local/\n").unwrap();
        // 惰性子树**内部**自带的规则文件：白名单（本测试的引信）+ 一条自己的忽略行
        std::fs::write(
            r.join(".local/.gitignore"),
            "!keep.md\n!deep/\ninner-ignored/\n",
        )
        .unwrap();
        let p = v.default_policy();
        assert_eq!(p.classify(".local", true), EntryClass::Lazy);
        assert_eq!(p.classify(".local/keep.md", false), EntryClass::Lazy);

        let entries = scan_dir(r, &p, ".local").expect("展开惰性目录");
        for entry in &entries {
            assert!(
                entry.lazy,
                "{} 必须仍是惰性（祖先被排除 ⇒ 子孙全被排除）：{entries:?}",
                entry.path
            );
        }
        assert!(
            entries.iter().any(|e| e.path == ".local/keep.md"),
            "白名单行 MUST NOT 把 keep.md 从结果里翻出去：{entries:?}"
        );
        assert!(
            entries.iter().any(|e| e.path == ".local/deep" && e.lazy),
            "被白名单 `!deep/` 点名的子目录同样仍是惰性：{entries:?}"
        );

        // scan_dir 之后（物化登记已发生）判定不变：子树内部的规则一行都没被读进来
        assert_eq!(p.classify(".local/keep.md", false), EntryClass::Lazy);
        assert_eq!(p.classify(".local/deep", true), EntryClass::Lazy);
        assert_eq!(p.classify(".local/deep/x.md", false), EntryClass::Lazy);

        // 事件判定同源：物化之后**投递**（那一行的增删要实时），但带回 lazy=true——
        // 两处索引（`apply_fs_changes` / `patchAttachmentPaths`）据此跳过它。
        assert_eq!(
            watch_verdict(&p, r, &r.join(".local/keep.md"), Some(false)),
            Some((".local/keep.md".to_string(), true)),
            "惰性子树内部的条目即使已物化也必须带回 lazy=true"
        );
        assert_eq!(
            watch_verdict(&p, r, &r.join(".local/deep/x.md"), Some(false)),
            None,
            "未物化的子目录内部仍被物化闸挡下（白名单不许把它翻成「不是惰性」）"
        );
    }
}
