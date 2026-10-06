// 文案表数据（M282，change ui-language-i18n）：**运行时唯一取值入口**。
//
// 键 = 文案 deck（`文案-Copy.md`）的 D 编号；一格多串的格取 `D<编号>.<格内序>`（1 基）。
// 取值与插值见 src/copy.ts；本文件只放数据，MUST NOT 出现任何逻辑。
//
// 与 deck 的关系（单一真源纪律，REVIEW.md 第 8 条）：deck 是规范文本与人评审面，本表是运行
// 时取值面，两边由 `tests/unit/copy.test.ts` 的全量漂移门禁钉住——改一处必红。
//
// 三条形态约定（design §4.5）：
//   - **普通条目**：两列各是本语言的措辞，按当前界面语言选列；
//   - **上屏列锁定**（`lock`）：两列都保留（一列上屏、一列是沿革备查措辞），无论界面语言
//     都取锁定列——M257 裁定的三条标签菜单项（D149–D151）即此；deck 的「设计意图」列里
//     以 `【上屏列锁定 en】` 标记，漂移门禁核对两处一致；
//   - **两列同形**：两列写同一串（D77 / D80 / D114 这类不分语言的标记），取哪列都一样。
//
// 占位名一律 ASCII 标识符（`{path}` / `{count}` / `{name}`）——两列的占位名 MUST 同名，
// 否则 en 列漏一个参数就是静默的空格（`t()` 缺参即抛错，漂移门禁另断言两列同名）。
// deck 的中文列里保留的 `{路径}` 一类中文占位名是**给读者看的规范写法**，与本表比对时按
// 占位位置归一（tests/unit/copy.test.ts 的 `normalizeSlots`）。

/** 单条文案：`zh` / `en` 两列，外加两个可选属性。 */
export interface CopyEntry {
  /** 中文列（对应 deck 的第 4 列）。 */
  zh: string;
  /** 英文列（对应 deck 的第 5 列）。 */
  en: string;
  /** en 的**单数档**（`Intl.PluralRules` 判为 `one` 时取它）；缺省表示两档同形。
   *  只在经 `tPlural()` 取值的条目上有意义，中文没有复数区分因此不设 zhOne。 */
  enOne?: string;
  /** 上屏列锁定：无论当前界面语言都取该列（见文件头第三条形态约定）。 */
  lock?: "zh" | "en";
}

const COPY_TABLE = {
  // -------------------------------------------------------------------------
  // 既有 deck 条目（D1–D158）。多串格的展开与格内顺序见 §格内序。
  // -------------------------------------------------------------------------
  D1: { zh: "未打开 vault", en: "No vault open" },
  D4: { zh: "切换", en: "Switch" },
  D5: {
    zh: "打开一个目录作为 vault，开始浏览全部文件。",
    en: "Open a folder as a vault to start browsing all its files.",
  },
  D6: { zh: "打开 vault", en: "Open vault" },
  D7: { zh: "〔后端透传原因〕", en: "[Backend-provided reason]" },
  D19: { zh: "{reason}", en: "{reason}" },
  D20: { zh: "标题未找到：{heading}", en: "Heading not found: {heading}" },
  D21: { zh: "未创建的链接：{raw}", en: "Link not created yet: {raw}" },
  D22: { zh: "已创建：{path}", en: "Created: {path}" },
  D23: { zh: "显示面板", en: "Show panel" },
  D24: { zh: "面板（后续波次）", en: "Panel (later waves)" },
  D25: { zh: "暂不支持预览：{path}", en: "Preview not supported yet: {path}" },
  D40: { zh: "发现 {count} 个可映射的 vault 路径", en: "Found {count} remappable vault paths" },
  D31: { zh: "附件未找到：{ref}", en: "Attachment not found: {ref}" },
  D32: { zh: "附件读取未接线", en: "Attachment pipeline not wired" },
  D33: { zh: "内容嵌入不支持", en: "Note embed not supported" },
  D34: { zh: "歧义", en: "Ambiguous" },
  D35: { zh: "块引用不支持：{raw}", en: "Block reference not supported: {raw}" },
  D36: { zh: "frontmatter 解析失败：{reason}", en: "Frontmatter parse failed: {reason}" },
  D37: { zh: "（空 frontmatter）", en: "(empty frontmatter)" },
  D38: {
    zh: "frontmatter 不是键值结构，按原文显示",
    en: "Frontmatter is not a key-value map; showing raw text",
  },
  D39: { zh: "创建并打开", en: "Create & open" },
  D41: {
    zh: "保存冲突：文件在磁盘上已被外部修改，内存中的修改未丢失",
    en: "Save conflict: the file was modified on disk; your changes are still in memory",
  },
  D42: { zh: "重新载入（放弃我的修改）", en: "Reload (discard my changes)" },
  D43: { zh: "强制覆盖保存", en: "Force save (overwrite)" },
  D44: {
    zh: "将覆盖磁盘上较新的内容，此操作不可撤销。确认强制覆盖保存？",
    en: "This will overwrite newer content on disk and cannot be undone. Force save anyway?",
  },
  D45: { zh: "已强制覆盖保存", en: "Force saved" },
  D46: { zh: "已重新载入磁盘内容", en: "Reloaded from disk" },
  D47: {
    zh: "保存失败：文件已被外部删除或移动，内存中的修改未丢失",
    en: "Save failed: the file was deleted or moved elsewhere; your changes are still in memory",
  },
  D48: { zh: "另存为新文件", en: "Save as new file" },
  D49: { zh: "已另存为：{path}", en: "Saved as: {path}" },
  D50: { zh: "检测到外部修改，已自动重载", en: "External changes detected; reloaded" },
  D51: { zh: "检测到外部修改：{path}", en: "External changes detected: {path}" },
  D52: { zh: "重载（放弃我的修改）", en: "Reload (discard my changes)" },
  D53: { zh: "保留我的版本", en: "Keep my version" },
  D54: {
    zh: "当前文件已被外部删除：{path}；编辑器中的内容未丢失",
    en: "The open file was deleted externally: {path}; the content is still in the editor",
  },
  D57: { zh: "发现未保存的崩溃备份：{path}", en: "Unsaved crash backup found: {path}" },
  D58: { zh: "恢复内容", en: "Restore content" },
  D59: { zh: "丢弃备份", en: "Discard backup" },
  D60: { zh: "已恢复未保存内容，请保存（Cmd+S）", en: "Unsaved content restored; press Cmd+S to save" },
  D61: { zh: "已丢弃崩溃备份", en: "Crash backup discarded" },
  D62: { zh: "崩溃备份已不存在", en: "The crash backup no longer exists" },
  D63: { zh: "键位（生效中）", en: "Key bindings (active)" },
  // D64：一格 12 串（分组标题，格内序即 BINDING_GROUPS 的顺序 + 末尾兜底组）。
  "D64.1": { zh: "移动与选择", en: "Movement & selection" },
  "D64.2": { zh: "扩选", en: "Extend selection" },
  "D64.3": { zh: "删除", en: "Deletion" },
  "D64.4": { zh: "kill-yank", en: "kill-yank" },
  "D64.5": { zh: "翻屏", en: "Scrolling" },
  "D64.6": { zh: "撤销", en: "Undo" },
  "D64.7": { zh: "列表缩进", en: "List indent" },
  "D64.8": { zh: "块", en: "Blocks" },
  "D64.9": { zh: "widget", en: "Widget" },
  "D64.10": { zh: "标签", en: "Tabs" },
  "D64.11": { zh: "全局", en: "Global" },
  "D64.12": { zh: "其他", en: "Other" },
  D65: { zh: "未绑定", en: "Unbound" },
  "D66.1": {
    zh: "默认不占键位（有意如此）——可在 [keys] 里绑定",
    en: "Not bound by default — bind one in [keys]",
  },
  "D66.2": {
    zh: "已被配置解绑——可在 [keys] 里重新绑定",
    en: "Unbound in config — rebind it in [keys]",
  },
  D67: { zh: "Esc / ⌃G 或点击遮罩关闭", en: "Close with Esc / ⌃G or by clicking outside" },
  D68: { zh: "查找", en: "Find" },
  "D69.1": { zh: "上一个", en: "Previous" },
  "D69.2": { zh: "下一个", en: "Next" },
  D70: { zh: "区分大小写", en: "Match case" },
  D71: { zh: "关闭", en: "Close" },
  "D72.1": { zh: "{current}/{total}", en: "{current}/{total}" },
  "D72.2": { zh: "{total}+", en: "{total}+" },
  D73: {
    zh: "表格阅读降级：第 {line} 行单元格数与表头不符（应为 {columns} 列）——保留原始 Markdown",
    en: "Table reading degraded: row {line} has a different cell count than the header ({columns} columns) — showing raw Markdown",
  },
  D74: {
    zh: "表格阅读降级：表格约 {kib} KiB，超过 64 KiB 阅读上限——保留原始 Markdown",
    en: "Table reading degraded: the table is about {kib} KiB, over the 64 KiB reading limit — showing raw Markdown",
  },
  D75: {
    zh: "表格阅读降级：无法识别表格结构——保留原始 Markdown",
    en: "Table reading degraded: the table structure could not be recognized — showing raw Markdown",
  },
  D76: { zh: "分隔线", en: "Separator" },
  D77: { zh: "↗︎", en: "↗︎" },
  D78: {
    zh: "打不开这类链接：{raw}——只支持 http、https、mailto",
    en: "Can't open this link: {raw} — only http, https and mailto are supported",
  },
  D79: { zh: "打开链接失败：{reason}", en: "Couldn't open the link: {reason}" },
  D80: { zh: "→", en: "→" },
  D81: { zh: "链接目标不存在：{raw}", en: "Link target not found: {raw}" },
  D82: { zh: "暂不支持锚点跳转", en: "Anchor jump is not supported yet" },
  // D83：`link_path_rejected` 的两个构造点各带一个**不同的成因**（「它不在 vault 内」/
  // 「路径含非 UTF-8 字符」），而成因本身是语言相关的文本——按 D6(a) 的「一条覆盖式句子」
  // 处置时**只保留稳定的对象参数**，成因由上屏句与 `message`（日志）分担（细节措辞有损失，
  // 是这条裁决的明账）。
  D83: {
    zh: "打不开这个目标：{target}",
    en: "Can't open this target: {target}",
  },
  D84: {
    zh: "这份文档还没有标题，大纲为空",
    en: "This document has no headings yet, so the outline is empty",
  },
  D85: { zh: "大纲", en: "Outline" },
  D86: {
    zh: "↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭",
    en: "↑↓ or ⌃N/⌃P to move · Enter to jump · Esc to close",
  },
  D87: { zh: "点击展开大纲", en: "Click to open the outline" },
  D88: { zh: "打开的文档", en: "Open documents" },
  D89: { zh: "关闭 {name}", en: "Close {name}" },
  D90: { zh: "{name}（未保存）", en: "{name} (unsaved)" },
  D91: { zh: "{path}", en: "{path}" },
  D92: {
    zh: "「{path}」有未保存修改，关闭后修改将丢失",
    en: '"{path}" has unsaved changes; closing will discard them',
  },
  "D93.1": { zh: "保存并关闭", en: "Save and close" },
  "D93.2": { zh: "放弃修改并关闭", en: "Discard changes and close" },
  "D93.3": { zh: "取消", en: "Cancel" },
  D94: { zh: "「{path}」{message}", en: '"{path}" {message}' },
  D95: { zh: "正在恢复上次打开的 vault……", en: "Restoring the last vault…" },
  D96: {
    zh: "vault：{name}（点击查看全部 vault）",
    en: "Vaults: {name} (click to see all vaults)",
  },
  D97: { zh: "vault", en: "Vaults" },
  D98: { zh: "当前", en: "Current" },
  "D99.1": {
    zh: "{n} 个标签 · {when}",
    en: "{n} tabs · {when}",
    enOne: "{n} tab · {when}",
  },
  "D99.2": { zh: "现在打开", en: "open now" },
  "D99.3": { zh: "{n} 个标签", en: "{n} tabs", enOne: "{n} tab" },
  "D100.1": { zh: "刚刚", en: "just now" },
  D101: { zh: "还没有打开过文件", en: "No files opened yet" },
  D102: {
    zh: "路径不可用：目录被移动，或所在卷未挂载",
    en: "Path unavailable: the folder was moved, or its volume is not mounted",
  },
  D103: { zh: "重新定位…", en: "Relocate…" },
  "D104.1": { zh: "新增 vault…", en: "Add vault…" },
  "D104.2": { zh: "选择一个目录作为新 vault", en: "Choose a folder as a new vault" },
  D105: {
    zh: "这个目录已经是「{name}」的路径，不能用来重新定位",
    en: 'That folder is already the path of "{name}"',
  },
  D106: {
    zh: "这个目录没法用来重新定位「{name}」；请选择该 vault 现在所在的目录",
    en: 'That folder cannot be used to relocate "{name}"; pick the folder where that vault is now',
  },
  D107: {
    zh: "这个 vault 还没有打开的文件。在左栏选一个文件开始。",
    en: "No files opened in this vault yet. Pick one in the left column to start.",
  },
  D108: {
    zh: "{n} 个文件已不在这个 vault 里，已跳过",
    en: "{n} files are no longer in this vault and were skipped",
    enOne: "{n} file is no longer in this vault and was skipped",
  },
  D109: {
    zh: "「{vault}」里有 {n} 个标签有未保存修改，切换会丢弃这些修改",
    en: '"{vault}" has {n} tabs with unsaved changes; switching will discard them',
    enOne: '"{vault}" has {n} tab with unsaved changes; switching will discard them',
  },
  "D110.1": { zh: "保存并切换", en: "Save and switch" },
  "D110.2": { zh: "放弃修改并切换", en: "Discard changes and switch" },
  "D110.3": { zh: "取消", en: "Cancel" },
  D111: { zh: "加载中… {ref}", en: "Loading… {ref}" },
  D112: { zh: "图片读取失败：{ref}（{reason}）", en: "Image read failed: {ref} ({reason})" },
  D113: { zh: "图片无法显示：{ref}", en: "Image can't be displayed: {ref}" },
  D114: { zh: "END", en: "END" },
  D115: {
    zh: "这份文件没有可提取的符号，大纲为空",
    en: "No extractable symbols in this file; the outline is empty",
  },
  D116: { zh: "这份文件类型暂不支持大纲", en: "This file type does not support the outline yet" },
  D117: { zh: "没有匹配的条目", en: "No matching items" },
  D118: { zh: "输入以筛选", en: "Type to filter" },
  D119: { zh: "筛选", en: "Filter" },
  D120: { zh: "调整内容宽度", en: "Adjust content width" },
  D121: {
    zh: "内容宽度没能存进配置：{reason}（本次调整仍生效，重启后恢复）",
    en: "Couldn't save the content width: {reason} (the new width applies now, but reverts after restart)",
  },
  D122: { zh: "主题：{theme}（点击切换）", en: "Theme: {theme} (click to switch)" },
  D123: {
    zh: "主题已切换，但写入配置失败，重启后将回到配置文件里的主题（{reason}）",
    en: "Theme switched, but saving the config failed; after a restart it falls back to the theme in the config file ({reason})",
  },
  D124: { zh: "放大查看表格", en: "View table fullscreen" },
  D125: { zh: "条目操作", en: "Item actions" },
  D126: { zh: "重命名…", en: "Rename…" },
  D127: { zh: "复制完整路径", en: "Copy full path" },
  D128: { zh: "在 Finder 中显示", en: "Show in Finder" },
  D129: { zh: "新建文件…", en: "New file…" },
  D130: { zh: "新建子目录…", en: "New folder…" },
  D131: { zh: "移到废纸篓…", en: "Move to Trash…" },
  D132: { zh: "移到废纸篓？", en: "Move to Trash?" },
  D133: { zh: "{name} 会移到系统废纸篓。", en: "{name} will be moved to the system Trash." },
  D134: {
    zh: "{name} 会连同其中全部内容一起移到系统废纸篓。",
    en: "{name} and everything inside it will be moved to the system Trash.",
  },
  D135: { zh: "移到废纸篓", en: "Move to Trash" },
  D136: { zh: "取消", en: "Cancel" },
  D137: { zh: "已复制完整路径", en: "Copied full path" },
  D138: { zh: "复制路径失败：{reason}", en: "Couldn't copy the path: {reason}" },
  D139: { zh: "未命名", en: "Untitled" },
  D140: { zh: "重命名 {name}", en: "Rename {name}" },
  D141: { zh: "新建文件的名称", en: "New file name" },
  D142: { zh: "新建子目录的名称", en: "New folder name" },
  D143: { zh: "名称不能为空", en: "Name can't be empty" },
  D144: { zh: "名称不能包含斜杠：{name}", en: "Name can't contain a slash: {name}" },
  D145: { zh: "{name} 不是有效的名称", en: "{name} isn't a valid name" },
  D146: {
    zh: "{name} 在忽略集内，建成后不会出现在文件树里",
    en: "{name} is in the ignore set and won't show up in the file tree",
  },
  D147: {
    zh: "已存在同名条目：{target}",
    en: "An entry with that name already exists: {target}",
  },
  D148: { zh: "标签操作", en: "Tab actions" },
  // D149–D151：上屏列锁定（M257 裁决）——无论界面语言都取 English 列。
  D149: { zh: "关闭", en: "Close", lock: "en" },
  D150: { zh: "关闭其他标签", en: "Close Other Tabs", lock: "en" },
  D151: { zh: "关闭右侧标签", en: "Close Tabs to the Right", lock: "en" },
  D152: { zh: "跳转到行", en: "Go to line" },
  D153: { zh: "复制{block}", en: "Copy {block}" },
  D154: { zh: "已复制{block}", en: "Copied {block}" },
  D155: { zh: "复制失败：{reason}", en: "Couldn't copy: {reason}" },
  D156: { zh: "放大查看代码块", en: "View code block fullscreen" },
  D157: { zh: "行号", en: "Line number" },
  D158: { zh: "共 {total} 行", en: "{total} lines total", enOne: "{total} line total" },
  // -------------------------------------------------------------------------
  // 后端错误信封的文案（D159–D202，change ui-language-i18n 的 D6 裁决）
  //
  // 归属：**前端按 `code` 渲染**，参数由 Rust 的 `CommandError.params` 提供，Rust 的 `message`
  // 退回「日志 + 未知 code 兜底」（design §7.2）。同一个 code 有多个 message 模板时（如
  // `fs_read_failed` 三种），本表给一条**覆盖式**句子——细节措辞有损失，这是 D6(a) 的明账；
  // 因此模板只使用该 code 的**全部**构造点都提供的占位名（否则 `t()` 会因缺参抛错）。
  // 三个 code 复用既有 deck 条目：`open_url_rejected`→D78、`open_url_failed`→D79、
  // `link_path_rejected`→D83、`document_conflict`→D41、`fs_not_found`（保存语境）→D47。
  // -------------------------------------------------------------------------
  D159: { zh: "尚未打开 vault，请先选择目录", en: "No vault is open; pick a folder first" },
  D160: { zh: "读取 vault 列表失败：{reason}", en: "Couldn't read the vault list: {reason}" },
  D161: {
    zh: "无法确定配置目录：XDG_CONFIG_HOME 与 HOME 环境变量均未设置",
    en: "Couldn't determine the config folder: neither XDG_CONFIG_HOME nor HOME is set",
  },
  D162: { zh: "无法写入配置文件", en: "Couldn't write the config file" },
  D163: { zh: "无法写入配置文件", en: "Couldn't write the config file" },
  D164: { zh: "无法读取 vault 注册表", en: "Couldn't read the vault registry" },
  D165: { zh: "无法写入 vault 注册表", en: "Couldn't write the vault registry" },
  D166: { zh: "无法规范化 vault 路径", en: "Couldn't normalize the vault path" },
  D167: { zh: "标识符格式不正确", en: "Malformed identifier" },
  D168: { zh: "诊断事件被拒：{reason}", en: "Diagnostic event rejected: {reason}" },
  D169: {
    zh: "无法解析 vault 根 {root}：{reason}",
    en: "Couldn't resolve the vault root {root}: {reason}",
  },
  D170: { zh: "vault 路径不是目录：{root}", en: "The vault path is not a folder: {root}" },
  D171: { zh: "无法读取目录 {rel}：{reason}", en: "Couldn't read the folder {rel}: {reason}" },
  D172: { zh: "路径无效", en: "Invalid path" },
  D173: { zh: "路径无法使用：{rel}", en: "This path can't be used: {rel}" },
  D174: { zh: "文件不存在：{rel}", en: "File not found: {rel}" },
  D175: { zh: "无法读取 {rel}：{reason}", en: "Couldn't read {rel}: {reason}" },
  D176: { zh: "名称不合法", en: "Invalid name" },
  D177: {
    zh: "已存在同名条目：{path}",
    en: "An entry with that name already exists: {path}",
  },
  D178: { zh: "{rel} 不是文件（可能是目录）", en: "{rel} is not a file (it may be a folder)" },
  D179: {
    zh: "文件 {rel} 不是合法 UTF-8 编码（可能是 GBK 等其他编码），暂不支持读取",
    en: "File {rel} is not valid UTF-8 (it may be GBK or another encoding); reading it is not supported yet",
  },
  D180: {
    zh: "文件 {rel} 大小约 {mb}MB，超过 {limit}MB 上限，已拒绝读取",
    en: "File {rel} is about {mb}MB, over the {limit}MB limit; reading it was refused",
  },
  D181: {
    zh: "不支持保存该文件类型（图片 / 二进制文件）",
    en: "Saving this file type isn't supported (image / binary files)",
  },
  D182: {
    zh: "移到废纸篓失败：{rel}——未删除任何内容",
    en: "Couldn't move {rel} to the Trash — nothing was deleted",
  },
  D183: {
    zh: "改名失败：{rel} → {newName}（{reason}）",
    en: "Couldn't rename {rel} to {newName} ({reason})",
  },
  D184: { zh: "无法新建 {path}：{reason}", en: "Couldn't create {path}: {reason}" },
  D185: { zh: "无法启动文件监听", en: "Couldn't start the file watcher" },
  D186: { zh: "无法在 Finder 中显示：{rel}", en: "Couldn't show {rel} in Finder" },
  D187: {
    zh: "保存失败：无法写入文档，内存中的修改未丢失",
    en: "Save failed: couldn't write to the file; your changes are still in memory",
  },
  D188: {
    zh: "保存结果未知：写入可能未生效，请核对文件内容，内存中的修改未丢失",
    en: "Save outcome unknown: the write may not have taken effect; check the file; your changes are still in memory",
  },
  D189: { zh: "打开文件失败：{reason}", en: "Couldn't open the file: {reason}" },
  D190: { zh: "链接路径不合法", en: "Invalid link path" },
  D191: {
    zh: "块引用语法不支持，无法创建目标",
    en: "Block-reference syntax isn't supported; that target can't be created",
  },
  D192: { zh: "目标已存在（索引可能已过期）", en: "The target already exists (the index may be stale)" },
  D193: { zh: "这不是一条可创建的链接", en: "This isn't a link that can be created" },
  D194: { zh: "无法创建目标文件", en: "Couldn't create the target file" },
  D195: { zh: "目标路径不合法", en: "Invalid target path" },
  D196: { zh: "无法创建文件", en: "Couldn't create the file" },
  D197: { zh: "目标已存在：{rel}", en: "The target already exists: {rel}" },
  D198: { zh: "无法写入崩溃备份", en: "Couldn't write the crash backup" },
  D199: {
    zh: "无法读取崩溃备份 {path}：{reason}",
    en: "Couldn't read the crash backup {path}: {reason}",
  },
  D200: {
    zh: "无法删除崩溃备份 {path}：{reason}",
    en: "Couldn't delete the crash backup {path}: {reason}",
  },
  D201: { zh: "无法枚举恢复目录：{reason}", en: "Couldn't list the recovery folder: {reason}" },
  D202: { zh: "崩溃备份路径非法：{rel}", en: "Invalid crash-backup path: {rel}" },
  // D323–D325：局部 patch 写入口的三条新 code（change add-harness-probe，M301；同 D6 的渲染
  // 口径，故并入本节）。**D324 / D325 的 `{index}` 从 1 起、`{count}` 是命中次数**；
  // D323 的模板只可用 `{rel}`——`patch_invalid` 的两处构造点里有一处不带 `{index}`，
  // 模板出现未提供的占位名会让 `t()` 缺参抛错（同门禁反向判据，见 tests/unit/copy.test.ts）。
  D323: { zh: "补丁请求无效：{rel}", en: "Invalid patch request: {rel}" },
  D324: {
    zh: "补丁未命中：{rel} 第 {index} 处编辑的 old_string 未找到（命中 {count} 次）",
    en: "Patch miss in {rel}: old_string of edit #{index} not found ({count} matches)",
  },
  D325: {
    zh: "补丁不唯一：{rel} 第 {index} 处编辑的 old_string 命中 {count} 次（要求恰好 1 次）",
    en: "Ambiguous patch in {rel}: old_string of edit #{index} matches {count} times (exactly 1 required)",
  },

  // -------------------------------------------------------------------------
  // Harness 对话运行时错误码（D349–D364，change add-harness-probe，M302）
  // -------------------------------------------------------------------------
  // 渲染口径同 D6：前端按 code 渲染、参数来自 Rust 的 `.param()`，Rust `message` 退回兜底。
  // 多构造点的 code（approval_not_found / harness_busy / harness_no_session /
  // harness_context_invalid）给**覆盖式无占位**句子——构造点提供的占位名集合不同，
  // 模板出现未提供的占位名会让 `t()` 缺参抛错（同 D323 的教训）。
  D349: {
    zh: "无法创建会话留存目录 {dir}：{reason}",
    en: "Could not create the session log directory {dir}: {reason}",
  },
  D350: {
    zh: "对话 mock provider 未配置 fixture 路径",
    en: "The mock provider has no fixture path configured",
  },
  D351: {
    zh: "mock fixture 不可读（{path}）：{reason}",
    en: "Mock fixture is unreadable ({path}): {reason}",
  },
  D352: {
    zh: "mock fixture（{path}）不是合法 JSON：{reason}",
    en: "Mock fixture ({path}) is not valid JSON: {reason}",
  },
  D353: {
    zh: "当前 provider 的 api_key 未配置",
    en: "The active provider's api_key is not configured",
  },
  D354: {
    zh: "LLM 客户端初始化失败：{reason}",
    en: "Failed to initialize the LLM client: {reason}",
  },
  D355: {
    zh: "LLM 请求发送失败：{reason}",
    en: "Failed to send the LLM request: {reason}",
  },
  D356: {
    zh: "没有待处理的批准请求",
    en: "No pending approval request",
  },
  D357: {
    zh: "批准请求已失效，请重试本轮提问",
    en: "The approval request has expired; please send again",
  },
  D358: {
    zh: "对话上下文块形状非法",
    en: "The conversation context block is malformed",
  },
  D359: {
    zh: "压缩摘要生成失败（{code}）：{reason}",
    en: "Failed to generate a compaction summary ({code}): {reason}",
  },
  D360: {
    zh: "压缩摘要为空，无法开新会话",
    en: "The compaction summary is empty; cannot start a new session",
  },
  D361: {
    zh: "对话正在处理中，请稍后再试",
    en: "A conversation turn is in progress; please try again shortly",
  },
  D362: {
    zh: "当前 vault 还没有对话会话",
    en: "This vault has no conversation session yet",
  },
  D363: {
    zh: "无法启动对话线程：{reason}",
    en: "Could not start the conversation thread: {reason}",
  },
  D364: {
    zh: "无法序列化会话快照：{reason}",
    en: "Could not serialize the session snapshot: {reason}",
  },

  // -------------------------------------------------------------------------
  // 前端可见文案（D203–D245）
  // -------------------------------------------------------------------------
  D203: { zh: "表格", en: "table" },
  D204: { zh: "代码块", en: "code block" },
  D205: { zh: "正在打开：{path}", en: "Opening: {path}" },
  D206: { zh: "当前有未保存修改", en: "There are unsaved changes" },
  D207: { zh: "无当前文件", en: "No file open" },
  D208: {
    zh: "{language} · {lines} 行 · UTF-8",
    en: "{language} · {lines} lines · UTF-8",
    enOne: "{language} · {lines} line · UTF-8",
  },
  D209: { zh: "切换文件", en: "switch files" },
  D210: { zh: "空单元格", en: "Empty cell" },
  D211: { zh: "Markdown 表格 {index}", en: "Markdown table {index}" },
  D212: { zh: "Markdown 代码块 {index}", en: "Markdown code block {index}" },
  D213: { zh: "块引用不支持", en: "Block reference not supported" },
  D214: { zh: "附件未找到", en: "Attachment not found" },
  D215: { zh: "同名候选：\n{candidates}", en: "Same-name candidates:\n{candidates}" },
  D216: {
    zh: "{raw}（未创建，点击创建）",
    en: "{raw} (not created yet; click to create)",
  },
  D217: { zh: "公式解析失败：{reason}", en: "Formula parse failed: {reason}" },
  D218: { zh: "Mermaid 图表渲染中…", en: "Rendering the Mermaid diagram…" },
  D219: {
    zh: "渲染器加载超时（{seconds}s）",
    en: "The renderer took too long to load ({seconds}s)",
  },
  D220: { zh: "渲染超时（{seconds}s）", en: "Rendering timed out ({seconds}s)" },
  D221: { zh: "超时", en: "Timed out" },
  D222: {
    zh: "图表渲染器加载失败：{reason}（可尝试刷新页面重试）",
    en: "Couldn't load the diagram renderer: {reason} (try reloading the page)",
  },
  D223: { zh: "图表解析失败：{reason}", en: "Diagram parse failed: {reason}" },
  D224: { zh: "{message}：{ref}", en: "{message}: {ref}" },
  D225: { zh: "{lines} 行", en: "{lines} lines", enOne: "{lines} line" },
  D226: { zh: "修改于 {date}", en: "Edited {date}" },
  D227: { zh: "已完成", en: "Done" },
  D228: { zh: "未完成", en: "Not done" },
  D229: { zh: "保存失败：{reason}", en: "Save failed: {reason}" },
  D230: {
    zh: "当前文档不支持保存，无法{action}；请按 Cmd+Z 撤销修改",
    en: "This document can't be saved, so it can't {action}; press Cmd+Z to undo your changes",
  },
  D231: {
    zh: "当前文档有未保存修改，无法{action}；请先保存（Cmd+S）",
    en: "This document has unsaved changes, so it can't {action}; save first (Cmd+S)",
  },
  D232: {
    zh: "当前有未保存修改，无法退出；请先保存（Cmd+S）",
    en: "There are unsaved changes, so quitting is blocked; save first (Cmd+S)",
  },
  D233: {
    zh: "当前没有打开的文件，无法保存；修改仍在编辑器内（按 Cmd+Z 可撤销）",
    en: "No file is open, so there's nothing to save; your changes are still in the editor (Cmd+Z undoes them)",
  },
  D234: {
    zh: "当前文件尚未可保存（未登记磁盘版本）；修改仍在编辑器内（按 Cmd+Z 可撤销）",
    en: "This file can't be saved yet (its on-disk version isn't known); your changes are still in the editor (Cmd+Z undoes them)",
  },
  D235: { zh: "已保存", en: "Saved" },
  D236: { zh: "已保存当前快照，仍有未保存修改", en: "Snapshot saved; there are still unsaved changes" },
  D237: {
    zh: "将覆盖磁盘上较新的内容，此操作不可撤销。确认强制覆盖保存「{path}」？",
    en: 'This will overwrite newer content on disk and cannot be undone. Force save "{path}"?',
  },
  D238: { zh: "覆盖保存", en: "Overwrite" },
  D239: {
    zh: "已强制覆盖保存当前快照，仍有未保存修改",
    en: "Force-saved the snapshot; there are still unsaved changes",
  },
  D240: {
    zh: "另存为新文件失败：同名文件已存在，请手动导出",
    en: "Couldn't save as a new file: one with that name already exists — export it manually",
  },
  D241: {
    zh: "{name}当前文件已被外部删除；编辑器中的内容未丢失",
    en: "{name} was deleted externally; the content is still in the editor",
  },
  D242: { zh: "检测到外部修改：{name}", en: "External changes detected: {name}" },
  D243: {
    zh: "「{name}」尚未注册为 vault；发现可能已移动的 vault：{candidate}",
    en: '"{name}" isn\'t registered as a vault; a vault that may have moved was found: {candidate}',
  },
  D244: { zh: "作为新 vault 打开", en: "Open as a new vault" },
  D245: { zh: "确认映射到此路径", en: "Confirm mapping to this path" },

  // -------------------------------------------------------------------------
  // callout 类型标签（D246–D258）
  //
  // 13 个类型标签是**界面文案**（渲染时生成、不写入文档），因此在语言面内。`en` 列取
  // Obsidian 的规范类型名（小写）——它同时是 `preview/callout.ts` 里双段标签的第二段，
  // 因此 `zh` 界面下两段都渲染（`笔记 note`，与迁移前逐字相同），`en` 界面下只渲染第一段
  // （规范名本身就是英文，再跟一段是重复）。
  // -------------------------------------------------------------------------
  D246: { zh: "笔记", en: "note" },
  D247: { zh: "摘要", en: "abstract" },
  D248: { zh: "信息", en: "info" },
  D249: { zh: "待办", en: "todo" },
  D250: { zh: "提示", en: "tip" },
  D251: { zh: "成功", en: "success" },
  D252: { zh: "疑问", en: "question" },
  D253: { zh: "警告", en: "warning" },
  D254: { zh: "失败", en: "failure" },
  D255: { zh: "危险", en: "danger" },
  D256: { zh: "缺陷", en: "bug" },
  D257: { zh: "示例", en: "example" },
  D258: { zh: "引用", en: "quote" },

  // -------------------------------------------------------------------------
  // 键位面板的逐条来由（D259–D316，change ui-language-i18n 的 D8 裁决：纳入语言面）
  //
  // 这 58 条原本是 `src/keys.ts` 键位表的 `doc` 文本（deck 旧口径「表即文档，不是本 deck 的
  // 条目」已按本裁决改准）。术语原形一律保留——`M149` / `Emacs` / `C-a` / `⌘⇧L` 这类编号、
  // 术语与键符照抄，只译句子（设计意图列写明这条约定）。D259 是模板：⌘1–⌘9 九条绑定共用它，
  // 序号经 `docParams` 传入（`{n}`）。
  // -------------------------------------------------------------------------
  D259: { zh: "⌘{n} 直达第 {n} 个标签（M149，Alex 明确要求「坐上 ⌘1–9 直达」）；取 global——焦点在文件树 / 搜索框 / 大纲浮层里时同样要能直达。超出标签数时无操作。冲突已核（零冲突）：⌘ 数字不在 tauri 默认菜单的 accelerator 集合里（见文件头 M149 段），表内亦无 ⌘ 数字绑定", en: "⌘{n} jumps straight to tab {n} (M149, Alex asked for it in so many words: \"⌘1–9 goes straight there\"); scope is global so it works with focus in the file tree, the search box or the outline popover. No-op past the last tab. Conflicts checked (none): ⌘ plus a digit is not in the default tauri menu accelerator set (see the M149 section in the file header) and the table has no ⌘ digit binding" },
  D260: { zh: "全平台接管：原生 contenteditable 路径越出视口时整屏跳变（M103）", en: "Takes over on every platform: the native contenteditable path jumps a whole screen when it leaves the viewport (M103)" },
  D261: { zh: "同上（M103）", en: "Same as above (M103)" },
  D262: { zh: "macOS 文本系统 Emacs 惯例 ⌃N；原生路径跨原子块落点错误（M110 同族）", en: "Emacs convention ⌃N in the macOS text system; the native path lands wrongly across atomic blocks (M110 family)" },
  D263: { zh: "macOS 文本系统 Emacs 惯例 ⌃P", en: "Emacs convention ⌃P in the macOS text system" },
  D264: { zh: "原生 caret 进不了 replace 公式 widget，边界回弹（M110/M111）", en: "The native caret can't get into a replace-mode formula widget and bounces at the edge (M110/M111)" },
  D265: { zh: "同上（M110/M111）", en: "Same as above (M110/M111)" },
  D266: { zh: "行尾；落点藏进隐藏 replace 时回退到最后可停靠位（M118）", en: "End of line; when the landing point hides inside a replace decoration it falls back to the last stoppable position (M118)" },
  D267: { zh: "D2 裁决：⌃A = 行首（Emacs C-a），与 ⌃E 对称；全选改由 ⌘A 承担", en: "D2 ruling: ⌃A = start of line (Emacs C-a), symmetric with ⌃E; select-all moves to ⌘A" },
  D268: { zh: "D1/D2：⌘A 保留全选，与 macOS 原生 Edit 菜单同键（菜单项不带 accelerator 时由本层兜底，见 lib.rs）", en: "D1/D2: ⌘A keeps select-all, the same key as the native macOS Edit menu (when a menu item carries no accelerator this layer covers it, see lib.rs)" },
  D269: { zh: "mac 惯例撤销；原生 Edit 菜单的 Undo 项已让出该键（lib.rs）", en: "The mac convention for undo; the native Edit menu's Undo item has given the key up (lib.rs)" },
  D270: { zh: "mac 惯例重做；原生 Edit 菜单的 Redo 项已让出该键（lib.rs）", en: "The mac convention for redo; the native Edit menu's Redo item has given the key up (lib.rs)" },
  D271: { zh: "Emacs 规范绑定 C-/", en: "The canonical Emacs binding C-/" },
  D272: { zh: "Emacs 别名 C-_（mac 物理为 ⌃⇧-，token 口径见上）", en: "Emacs alias C-_ (physically ⌃⇧- on a mac keyboard; token rules above)" },
  D273: { zh: "Emacs 系重做别名 ⌃⌥_（mac 键盘物理为 ⌃⌥⇧-；Alt 层把 - 换成 —，故按物理键 Minus 判定，见上）", en: "Emacs-family redo alias ⌃⌥_ (physically ⌃⌥⇧- on a mac keyboard; the Alt layer turns - into —, so it is matched by the physical key Minus, see above)" },
  D274: { zh: "Emacs C-v（scroll-up）：视口向后翻一屏，光标不动——阅读推进用，不给原生路径（原生滚动与 CM 视口重建叠加会整屏跳变，M103 同族）", en: "Emacs C-v (scroll-up): scroll one screen backwards with the cursor staying put — for reading forward; not offered to the native path (native scrolling stacked on CodeMirror viewport rebuilds jumps a whole screen, same family as M103)" },
  D275: { zh: "Emacs M-v（scroll-down）；含 Alt 的组合按物理键判定（Alt 层把 v 换成 √，e.key 认不出，见文件头 token 口径）", en: "Emacs M-v (scroll-down); Alt combinations are matched by physical key (the Alt layer turns v into √, so e.key can't tell — see the token rules in the file header)" },
  D276: { zh: "Emacs C-l：把光标行滚到视口居中（revealLine 同款 y:\"center\"；v0 不做 Emacs 的三段循环）", en: "Emacs C-l: scroll the cursor line to the middle of the viewport (the same revealLine y:\"center\"; v0 does not do Emacs's three-step cycle)" },
  D277: { zh: "按行号跳转（Emacs `M-g g` 的单段近亲，⌥G）：打开 modeline 之上的小浮层输入条（预填当前行号、显示 `共 M 行`），Enter 落到第 n 行行首并滚到视口居中，Escape / ⌃G 取消，越界静默钳到文档边界（D1/D2/D3 裁决）。落点复用既有 revealLine（MUST NOT 另写算式）；零文档改动、不进撤销栈、不碰 dirty。冲突已核（零冲突，三条独立来源）：表内无 ⌥G；原生菜单 accelerator 集合里 ⌥ 系只有 ⌥⌘H；macOS 系统级不占用 ⌥G。含 Alt 的组合按物理键判定 ⇒ token MUST 写 `Alt-KeyG`（Alt 层把 G 换成 `©`，写 `Alt-g` 永不命中）", en: "Go to line (a one-segment cousin of Emacs `M-g g`, ⌥G): opens a small input bar above the modeline (prefilled with the current line and showing the total), Enter lands on line n and centres it, Escape / ⌃G cancels, and out-of-range input is silently clamped to the document bounds (D1/D2/D3 rulings). The landing reuses the existing revealLine (MUST NOT write a second formula); it changes nothing in the document, adds nothing to the undo stack and doesn't touch dirty. Conflicts checked (none, three independent sources): no ⌥G in the table; the only ⌥-family native menu accelerator is ⌥⌘H; macOS reserves no ⌥G. Alt combinations are matched by physical key ⇒ the token MUST be `Alt-KeyG` (the Alt layer turns G into ©, so `Alt-g` never fires)" },
  D278: { zh: "Emacs C-d；表格 cell 内钳到 cell 尾（M129 survey 实证：跨过隐藏管道符即破坏表格结构）", en: "Emacs C-d; inside a table cell it clamps to the cell end (the M129 survey showed that crossing a hidden pipe breaks the table structure)" },
  D279: { zh: "Emacs C-h（macOS 文本系统的退格键位）；cell 边界同上", en: "Emacs C-h (the backspace position in the macOS text system); cell boundary as above" },
  D280: { zh: "Emacs C-t：转置光标两侧字符并把光标移到两者之后（行尾时转置前两个）", en: "Emacs C-t: transpose the characters on either side of the cursor and move past both (at end of line, the two before it)" },
  D281: { zh: "Emacs M-d kill-word（Alt 层把 d 换成 ∂，按物理键判定）；cell 边界同 ⌃D", en: "Emacs M-d kill-word (the Alt layer turns d into ∂, so it is matched by physical key); cell boundary as with ⌃D" },
  D282: { zh: "Emacs M-DEL backward-kill-word（真机 ⌥⌫）；cell 边界同上", en: "Emacs M-DEL backward-kill-word (⌥⌫ on a real keyboard); cell boundary as above" },
  D283: { zh: "Emacs C-k：kill 到行尾（已在行尾则连带换行，Emacs 口径）；表格 cell 内只到 cell 尾，绝不跨过隐藏管道符", en: "Emacs C-k: kill to end of line (at end of line it takes the newline too, the Emacs way); inside a table cell it stops at the cell end and never crosses a hidden pipe" },
  D284: { zh: "Emacs C-y：插入 kill buffer（单槽；连续 ⌃K 的内容追加进同一槽，等价 Emacs 的连续 kill 合并）", en: "Emacs C-y: insert the kill buffer (a single slot; consecutive ⌃K appends into the same slot, the equivalent of Emacs merging consecutive kills)" },
  D285: { zh: "Emacs C-g keyboard-quit：撤下进行中的选择（折叠为光标）；多段 chord 的 pending 本就在无关键上自动清空", en: "Emacs C-g keyboard-quit: drop the selection in progress (collapse to the cursor); a pending multi-segment chord is already cleared by any unrelated key" },
  D286: { zh: "macOS 文本系统的 ⌃⇧F（⌃F 的扩选变体）：保持 anchor，head 逐字符前移（沿用 ⌃F 的硬化落点）", en: "⌃⇧F in the macOS text system (the extend variant of ⌃F): keep the anchor and move the head forward one character (reusing the hardened landing of ⌃F)" },
  D287: { zh: "同上，⌃⇧B", en: "Same as above, ⌃⇧B" },
  D288: { zh: "⌃⇧N：按垂直移动的硬化落点向下扩选（跨原子块钳制与表格行路由同 ⌃N，只多保留 anchor）", en: "⌃⇧N: extend downwards on the hardened vertical landing (same atomic-block clamping and table-row routing as ⌃N, only the anchor is kept)" },
  D289: { zh: "同上，⌃⇧P", en: "Same as above, ⌃⇧P" },
  D290: { zh: "⌃⇧A：扩选到行首（落点口径同 ⌃A，含隐藏 replace 退化回退）", en: "⌃⇧A: extend to start of line (same landing as ⌃A, including the hidden-replace fallback)" },
  D291: { zh: "⌃⇧E：扩选到行尾（落点口径同 ⌃E）", en: "⌃⇧E: extend to end of line (same landing as ⌃E)" },
  D292: { zh: "⌥⇧F：按词向后扩选；含 Alt 的组合按物理键且 Shift 不参与判定（M131 token 口径），故与 ⌥F 同 token——v0 未绑 ⌥F 的单词移动，见 openspec change emacs-keys-pack 的 shift-extend requirement「本版已知限制」", en: "⌥⇧F: extend backwards by word; Alt combinations are matched by physical key and Shift takes no part in the decision (M131 token rules), so the token equals ⌥F's — v0 binds no ⌥F word motion, see the shift-extend requirement's \"known limits\" in the emacs-keys-pack change" },
  D293: { zh: "⌥⇧B：按词向前扩选；token 口径同 ⌥⇧F", en: "⌥⇧B: extend forwards by word; token rules as with ⌥⇧F" },
  D294: { zh: "块级横滚容器焦点内的 ←（原手柄的 120px 步进）；when 保证文本编辑中的 ← 不受影响", en: "← inside a block-level horizontal scroller with focus (the original handle's 120px step); the `when` guard keeps ← in text editing unaffected" },
  D295: { zh: "容器焦点内的 →（原手柄口径）；表格与代码块容器同判据同行为", en: "→ inside a focused container (the original handle's rules); tables and code blocks share the same test and behaviour" },
  D296: { zh: "容器焦点内的 Home：横向滚回最左", en: "Home inside a focused container: scroll back to the far left" },
  D297: { zh: "容器焦点内的 End：横向滚到最右", en: "End inside a focused container: scroll to the far right" },
  D298: { zh: "容器焦点内的 Escape：焦点交还编辑器（view.focus()），随后按键回到文本上下文", en: "Escape inside a focused container: hand focus back to the editor (view.focus()), after which keys return to the text context" },
  D299: { zh: "列表项缩进一层（TAB，Alex 点名）：head 归属的 ListItem 连同续行与子列表整体平移（步长 = 该层 marker 宽 + 1 空格，见 change list-tab-indent design §3），有序列表按新归属重排源码编号（D2c）。非列表行 / 代码块内无操作（D4a）——命中即消费，焦点不跳出编辑器。接管了编辑器内 TAB 的原生焦点遍历，这是 D1a 知情接受的代价；焦点在浮层 / 搜索框的原生输入框里时本绑定不命中（editor 作用域），Tab 照旧走原生焦点遍历", en: "Indent a list item one level (TAB, asked for by Alex): the ListItem owning the head moves as a whole, together with its continuation lines and sublists (step = that level's marker width + 1 space, see the list-tab-indent change design §3); ordered lists renumber their source numbers for the new ownership (D2c). No-op on non-list lines / inside code blocks (D4a) — a hit is consumed and focus never leaves the editor. This takes over TAB's native focus traversal inside the editor, the cost D1a knowingly accepted; with focus in a popover or a search box the binding doesn't fire (editor scope), so Tab keeps its native traversal" },
  D300: { zh: "列表项凸排一层（⇧TAB）——凸到祖先列表项的缩进层级（按语法树取，不是机械减 2；行首空白不足的行宽容移除、行首 tab 按一层读取宽容处理），有序列表按新归属重排源码编号（D2c）。列表项已在顶层时无操作（D3a）：文档逐字节不变、不进撤销栈；非列表行 / 代码块内同样无操作（D4a）", en: "Outdent a list item one level (⇧TAB) — out to the indentation level of the ancestor list item (taken from the syntax tree, not a mechanical minus 2; lines with too little leading whitespace are tolerated and trimmed, a leading tab counts as one level), ordered lists renumber their source numbers for the new ownership (D2c). No-op when the item is already top-level (D3a): the document is byte-identical and nothing enters the undo stack; non-list lines / code blocks are a no-op too (D4a)" },
  D301: { zh: "D3 裁决：⌘S 是唯一保存键；⌃S 解绑（预留给 isearch），不再触发保存", en: "D3 ruling: ⌘S is the only save key; ⌃S is unbound (reserved for isearch) and no longer triggers a save" },
  D302: { zh: "轨道 A 原样迁入（键位与作用域不变，迁移前挂在 window 上）；M144 起命令跟随光标/选区处的**链接**：外链经 Rust 交给系统浏览器，wikilink 走既有跳转链路——同一条命令，不再只管 wikilink", en: "Carried over from track A unchanged (same keys, same scopes — it used to hang off window); since M144 the command follows the **link** at the cursor or in the selection: external links go through Rust to the system browser and wikilinks take the existing follow path — one command, no longer wikilink-only" },
  D303: { zh: "键位查看面板（M133）：mac 帮助惯例的简化形态——系统「帮助」菜单的 accelerator 实为 ⇧⌘?（Cmd-?），该键在本应用的原生菜单下会先被系统 Help 菜单截获，故取 ⌘/；Emacs 的 C-h b（describe-bindings）不可用——⌃H 已被后删字符占用", en: "The key-binding panel (M133): a simplified form of the mac help convention — the system Help menu's accelerator is really ⇧⌘? (Cmd-?), that key is intercepted by the system Help menu first under this app's native menu, hence ⌘/; Emacs's C-h b (describe-bindings) is unavailable because ⌃H is already taken by delete-backward" },
  D304: { zh: "文件内搜索（M139）：mac 惯例的查找键；取 global 而非 editor——焦点在文件树或已打开的搜索框里时同样要能开（已打开则把焦点移回输入框）。⌃F 已被 Emacs C-f（前移字符）占用，故沿用 ⌘ 系", en: "In-file search (M139): the mac convention for find; scope is global rather than editor so it also opens with focus in the file tree or in an already-open search box (when it is open, focus moves back to the input). ⌃F is taken by Emacs C-f (forward char), hence the ⌘ family" },
  D305: { zh: "轻量大纲（M148）：⌘⇧O 展开/收起 modeline 左段的标题路径浮层（M211 前它挂在已删除的标题区）。取 global 而非 editor——浮层打开时焦点在浮层里（不在 contentDOM 内），再按要能收起；空标题文档也要能走到提示。冲突已核（零冲突）：表内 ⌘⇧ 系只有 ⇧⌘Z（重做），原生菜单的 accelerator 集合里 ⌘⇧ 系也只有 ⇧⌘Z（muda predefined：Redo），macOS 的 Help 子菜单在 tauri 默认菜单里为空", en: "The lightweight outline (M148): ⌘⇧O opens/collapses the heading-path popover on the left of the modeline (before M211 it hung off the deleted heading bar). Scope is global rather than editor — with the popover open focus is in the popover (not inside contentDOM) and pressing again must close it; a document with no headings must still reach its notice. Conflicts checked (none): the only ⌘⇧ binding in the table is ⇧⌘Z (redo) and the only ⌘⇧ entry among the native menu accelerators is ⇧⌘Z (the muda predefined Redo); the macOS Help submenu is empty in tauri's default menu" },
  D306: { zh: "打开 vault 切换器（M163，change multi-vault-workspaces 的口径 13）：⌘O 是 mac 惯例的「打开」，而 vault 的打开与切换此前零键位，与 ADR 0006 的 Emacs keybinding PKM 定位不符。取 global 而非 editor——浮层打开时焦点在浮层里（不在 contentDOM 内），再按要能收起；未装载 vault 时无操作。冲突已核（零冲突，三条独立来源）：① 表内 ⌘O 无绑定（本文件即真源）；② 原生菜单 accelerator 集合里没有 ⌘O——tauri 2.11.5 的 `Menu::default()` 逐项来自 muda 0.19.3 `items/predefined.rs` 的 `accelerator()`（Copy ⌘C / Cut ⌘X / Paste ⌘V / Undo ⌘Z / Redo ⇧⌘Z / SelectAll ⌘A / Minimize ⌘M / Fullscreen ⌃⌘F / Hide ⌘H / HideOthers ⌥⌘H / CloseWindow ⌘W / Quit ⌘Q，见该文件 :301-342），File 子菜单在 macOS 上只有一项预置 Close（M149 已把它换成不带 accelerator 的自定义项）；③ macOS 不给任何系统菜单预置 ⌘O（「打开…」由应用自建，本应用不建）。浮层内的 ↑↓ / Enter / Esc 就地在浮层内消费、不进本表（理由同 M148 那条：同 token 已被 editor.cursor-up / cursor-down / editor.widget-escape 占用）", en: "Open the vault switcher (M163, rule 13 of the multi-vault-workspaces change): ⌘O is the mac convention for \"open\" and vaults had no keys at all before, which sat badly with the Emacs keybinding PKM positioning of ADR 0006. Scope is global rather than editor — with the popover open focus is in it (not inside contentDOM) and pressing again must close it; no-op when no vault is loaded. Conflicts checked (none, three independent sources): (1) no ⌘O binding in the table (this file is the source of truth); (2) the native menu accelerator set has no ⌘O — tauri 2.11.5's `Menu::default()` takes each item from muda 0.19.3's `items/predefined.rs` `accelerator()` (Copy ⌘C / Cut ⌘X / Paste ⌘V / Undo ⌘Z / Redo ⇧⌘Z / SelectAll ⌘A / Minimize ⌘M / Fullscreen ⌃⌘F / Hide ⌘H / HideOthers ⌥⌘H / CloseWindow ⌘W / Quit ⌘Q, see that file :301-342) and the File submenu carries only the predefined Close on macOS (M149 already replaced it with a custom item without an accelerator); (3) macOS presets no ⌘O (\"Open…\" is app-built and this app builds none). ↑↓ / Enter / Esc inside the popover are consumed there and are not in this table (same reason as M148: those tokens are taken by editor.cursor-up / cursor-down / editor.widget-escape)" },
  D307: { zh: "放大编辑器内容字号一档（×1.1 取整，钳 [12,32]）：mac / 浏览器惯例的放大键。取 global 而非 editor——字号是应用运行期的显示口径，焦点在左栏 / 搜索框 / 浮层里时同样要能改（与 M180 的折行开关同族）。只改**文字**大小，不是整体界面缩放（MUST NOT 启用 Tauri 的 webview 缩放热键，理由见 keymap-commands 的 delta）", en: "Scale the editor content font size up one step (×1.1 rounded, clamped to [12,32]): the mac / browser convention for zoom in. Scope is global rather than editor — font size is a runtime display setting of the app, so it must also work with focus in the left column, the search box or a popover (same family as M180's wrap toggle). It changes **text** size only, not overall UI zoom (MUST NOT enable Tauri's webview zoom hotkeys, reason in the keymap-commands delta)" },
  D308: { zh: "同上，⌘⇧= 的字符形态（真机 event.key 为 \"+\"）：浏览器对放大同时接受 ⌘= 与 ⌘+，两条绑定指向同一条命令。token 形态的实测记录见本组上方的注释", en: "Same as above, the character form of ⌘⇧= (on a real keyboard event.key is \"+\"): browsers accept both ⌘= and ⌘+ for zoom in, so both bindings point at one command. The measured token forms are recorded in the comment above this group" },
  D309: { zh: "缩小编辑器内容字号一档（÷1.1 取整，钳 [12,32]）。token MUST 写 `Cmd--`（⌘− 的事件 token 形态），写 `Cmd-Minus` 会静默不命中——理由见本组上方的注释", en: "Scale the editor content font size down one step (÷1.1 rounded, clamped to [12,32]). The token MUST be `Cmd--` (the event token form of ⌘−); writing `Cmd-Minus` silently never fires — see the comment above this group" },
  D310: { zh: "回到**配置字号**（不是出厂 16px）：Emacs 的 `C-x C-0` 是「restore the default (global) font size」，本仓的 global 就是配置值。运行期字号不落盘、不回写 config.json（D5 裁决，与 M180 的折行开关同纪律）", en: "Back to the **configured** font size (not the factory 16px): Emacs's `C-x C-0` is \"restore the default (global) font size\" and this repo's global is the configured value. The runtime font size is not persisted and never writes back to config.json (D5 ruling, same discipline as M180's wrap toggle)" },
  D311: { zh: "主题按 light → dark → eink 循环切到下一档（M237，D1/D2 裁决），切换即写回配置 `[ui] theme`（写失败降级为 toast，运行期主题不回滚）。取 global——焦点在左栏 / 搜索框 / 浮层里时同样要能切。冲突已核（零冲突，三条独立来源）：① 表内 ⌘⇧ 系只有 ⇧⌘Z（重做）与 ⇧⌘O（toc.toggle）两条，⌘⇧T 不在其中；② 原生菜单 accelerator 集合（muda 0.19.3 的 predefined，清单见文件头 M149 段）不含 ⌘⇧T；③ macOS 不预置 ⌘⇧T。可经 [keys] 重绑 / 解绑", en: "Cycle the theme light → dark → eink (M237, D1/D2 rulings); switching writes back the `[ui] theme` config (a failed write degrades to a toast and the runtime theme does not roll back). Scope is global — it must also work with focus in the left column, the search box or a popover. Conflicts checked (none, three independent sources): (1) the table's only ⌘⇧ bindings are ⇧⌘Z (redo) and ⇧⌘O (toc.toggle) and ⌘⇧T is not among them; (2) the native menu accelerator set (muda 0.19.3's predefined, list in the M149 section of the file header) has no ⌘⇧T; (3) macOS presets no ⌘⇧T. Can be rebound / unbound via [keys]" },
  D312: { zh: "关当前标签（dirty 时先确认）；取 global 而非 editor——焦点在文件树 / 搜索框 / 大纲浮层里时同样要能关。**这个键原本被原生菜单的预置 Close 项占着**（muda 给 CloseWindow 的 accelerator 就是 ⌘W，菜单键等价在 NSApplication 分发阶段截获，webview 的 keydown 收不到）：M149 在 src-tauri/src/lib.rs 按 M131 先例把 File / Window 两个子菜单的预置 Close 换成不带加速键的自定义项让出该键，见那边的函数注释。语义随之从「关窗」变为「关标签」（tower 2026-09-17 裁决），退出仍走 ⌘Q（有 dirty 守卫）与红灯", en: "Close the current tab (with a confirmation when dirty); scope is global rather than editor so it also works with focus in the file tree, the search box or the outline popover. **This key used to be held by the native menu's predefined Close item** (muda gives CloseWindow the ⌘W accelerator and a menu key equivalent is intercepted during NSApplication dispatch, so the webview keydown never sees it): following the M131 precedent, M149 replaced the predefined Close in the File and Window submenus with custom items carrying no accelerator and gave the key up — see the function comment in src-tauri/src/lib.rs. The meaning therefore changed from \"close window\" to \"close tab\" (tower ruling, 2026-09-17); quitting still goes through ⌘Q (with a dirty guard) and the red button" },
  D313: { zh: "循环切到下一个标签（末端回卷到第一个）；取 global——切标签是窗口级动作，不该依赖焦点在哪。冲突已核（零冲突）：tauri 默认菜单的 accelerator 集合里没有 ⌃⇥，macOS 的窗口循环键是 ⌘` 而非 ⌃⇥，表内亦无 ⌃ 系 Tab 绑定。", en: "Cycle to the next tab (wrapping from the end to the first); scope is global — switching tabs is a window-level action and shouldn't depend on focus. Conflicts checked (none): the tauri default menu's accelerator set has no ⌃⇥, the macOS window cycle key is ⌘` rather than ⌃⇥, and the table has no ⌃-family Tab binding." },
  D314: { zh: "循环切到上一个标签（首端回卷到最后一个），与 ⌃⇥ 成对；冲突核实同 ⌃⇥。", en: "Cycle to the previous tab (wrapping from the start to the last), paired with ⌃⇥; conflict checks as with ⌃⇥." },
  D315: { zh: "⌘} 循环切到下一个标签（末端回卷到第一个；少于 2 个标签时无操作——cycleTab 既有行为），与 ⌃⇥ 同指 tab.next，零新命令、零行为分叉（M242）。方向映射取 macOS 惯例（WebKit 快捷键文档的 Show next tab = ⇧⌘}，Safari / Firefox 同键）：⌘} 物理是 ⇧⌘]（US 布局上 } 必须按 Shift）。token MUST 写 `Cmd-}`：事件 key 是字符 `}`、Shift 已隐含在字符里（`}` ∈ SHIFT_IMPLIED_KEYS），归一成 `Cmd-}`；写 `Cmd-Shift-]` 永不命中（静默失配，机制见文件头 M195 段）。取 global——切标签是窗口级动作。冲突已核（零冲突，三条独立来源）：① 表内无 `⌘}` / `⌘{`（本文件即真源），⌃⇥ 归一后是不同 token；② 原生菜单 accelerator 集合（tauri 的 Menu::default() 逐项来自 muda predefined，清单见文件头 M149 段）不含 ⇧⌘] / ⇧⌘[；③ macOS 不预置这对键（窗口循环键是 ⌘`）", en: "⌘} cycles to the next tab (wrapping from the end to the first; no-op with fewer than 2 tabs — cycleTab's existing behaviour), pointing at the same tab.next as ⌃⇥, so no new command and no split behaviour (M242). The direction mapping follows the macOS convention (WebKit's shortcut docs list Show next tab = ⇧⌘}, as do Safari and Firefox): ⌘} is physically ⇧⌘] (on a US layout } needs Shift). The token MUST be `Cmd-}`: the event key is the character `}` with Shift already implied by it (`}` ∈ SHIFT_IMPLIED_KEYS) and normalizes to `Cmd-}`; writing `Cmd-Shift-]` never fires (a silent mismatch, mechanism in the M195 section of the file header). Scope is global — switching tabs is a window-level action. Conflicts checked (none, three independent sources): (1) no `⌘}` / `⌘{` in the table (this file is the source of truth) and ⌃⇥ normalizes to a different token; (2) the native menu accelerator set (tauri's Menu::default() takes each item from muda's predefined, list in the M149 section of the file header) has neither ⇧⌘] nor ⇧⌘[; (3) macOS presets neither key (the window cycle key is ⌘`)" },
  D316: { zh: "⌘{ 循环切到上一个标签（首端回卷到最后一个；少于 2 个标签时无操作——cycleTab 既有行为），与 ⌃⇧⇥ 同指 tab.prev，零新命令（M242）。方向映射取 macOS 惯例（WebKit 快捷键文档的 Show previous tab = ⇧⌘{）：⌘{ 物理是 ⇧⌘[（US 布局上 { 必须按 Shift）。token MUST 写 `Cmd-{`：事件 key 是字符 `{`、Shift 已隐含在字符里（`{` ∈ SHIFT_IMPLIED_KEYS），归一成 `Cmd-{`；写 `Cmd-Shift-[` 永不命中（静默失配，机制见文件头 M195 段）。取 global——切标签是窗口级动作。冲突已核（零冲突，三条独立来源）：① 表内无 `⌘{` / `⌘}`（本文件即真源），⌃⇧⇥ 归一后是不同 token；② 原生菜单 accelerator 集合（tauri 的 Menu::default() 逐项来自 muda predefined，清单见文件头 M149 段）不含 ⇧⌘[ / ⇧⌘]；③ macOS 不预置这对键（窗口循环键是 ⌘`）", en: "⌘{ cycles to the previous tab (wrapping from the start to the last; no-op with fewer than 2 tabs — cycleTab's existing behaviour), pointing at the same tab.prev as ⌃⇧⇥, so no new command (M242). The direction mapping follows the macOS convention (WebKit's shortcut docs list Show previous tab = ⇧⌘{): ⌘{ is physically ⇧⌘[ (on a US layout { needs Shift). The token MUST be `Cmd-{`: the event key is the character `{` with Shift already implied by it (`{` ∈ SHIFT_IMPLIED_KEYS) and normalizes to `Cmd-{`; writing `Cmd-Shift-[` never fires (a silent mismatch, mechanism in the M195 section of the file header). Scope is global — switching tabs is a window-level action. Conflicts checked (none, three independent sources): (1) no `⌘{` / `⌘}` in the table (this file is the source of truth) and ⌃⇧⇥ normalizes to a different token; (2) the native menu accelerator set (tauri's Menu::default() takes each item from muda's predefined, list in the M149 section of the file header) has neither ⇧⌘[ nor ⇧⌘]; (3) macOS presets neither key (the window cycle key is ⌘`)" },

  // -------------------------------------------------------------------------
  // 语言切换入口（D317–D318）
  // -------------------------------------------------------------------------
  D317: {
    zh: "语言：{lang}（点击切换）",
    en: "Language: {lang} (click to switch)",
  },
  D318: {
    zh: "界面语言在 en / zh 之间切换（M282，change ui-language-i18n 的 D1/D3 裁决）：切换即写回配置 `[ui] language`（写失败降级为 toast，运行期语言不回滚），并重写全部长驻 chrome 与预览装饰。取 global——焦点在左栏 / 搜索框 / 浮层里时同样要能切。冲突已核（零冲突，三条独立来源）：① 表内——本文件即真源，⌘⇧ 系现有 Cmd-Shift-z（重做）/ Cmd-Shift-o（toc.toggle）/ Cmd-Shift-T（主题循环）三条，⌘⇧L 不在其中；② 原生菜单 accelerator 集合（tauri 的 `Menu::default()` 逐项来自 muda 的 `items/predefined.rs`，清单见文件头 M149 段）不含 ⌘⇧L；③ macOS 系统级不占用 ⌘⇧L。可经 [keys] 重绑 / 解绑",
    en: "Switches the UI language between en and zh (M282, D1/D3 rulings of the ui-language-i18n change): switching writes back the `[ui] language` config (a failed write degrades to a toast and the runtime language does not roll back) and rewrites every long-lived chrome label and preview decoration. Scope is global — it must also work with focus in the left column, the search box or a popover. Conflicts checked (none, three independent sources): (1) the table's ⌘⇧ bindings are ⇧⌘Z (redo) / ⇧⌘O (toc.toggle) / ⌘⇧T (theme cycle) and ⌘⇧L is not among them; (2) the native menu accelerator set (tauri's Menu::default() takes each item from muda's predefined, list in the M149 section of the file header) has no ⌘⇧L; (3) macOS reserves no ⌘⇧L. Can be rebound / unbound via [keys]",
  },
  D319: {
    zh: "语言已切换，但写入配置失败，重启后将回到配置文件里的语言（{reason}）",
    en: "Language switched, but saving the config failed; after a restart it falls back to the language in the config file ({reason})",
  },
  D320: {
    zh: "用户配置重绑（~/.config/lumir 的 keys 表）：{key} → {command}",
    en: "Rebound by user config (~/.config/lumir, the keys table): {key} → {command}",
  },
  // D321：**消费者是 Rust 侧**（`src-tauri/src/commands.rs` 的 `picker_title`），前端不取值——
  // 原生目录选择器由 OS 绘制，跑在 webview 之外的 Rust 进程里，前端拿不到也改不了。这是全仓
  // 唯一一处 Rust 持有可见文案的地方（有意的第二处落点，不是漏迁移）：deck 的 D321 是它的
  // 评审面，Rust 的 `En` 分支与这里的 en 列逐字一致。
  D321: {
    zh: "选择 vault 目录",
    en: "Choose a vault folder",
  },
  // D322：标签右键菜单的定位项（M300，change tab-reveal-in-tree）。中文列是 Alex 2026-10-01
  // 的需求原话（逐字保留），不是 D128「在 Finder 中显示」——那一条的对象是系统文件管理器，
  // 这一条是应用内的左栏文件树。**上屏列锁定 en**（Alex 2026-10-01 裁决：菜单内语言统一，
  // 与 D149–D151 三条关闭项同一条口径）：无论界面语言都取 English 列，中文列只作沿革备查的
  // 措辞——`zh` 界面下菜单因此整条是英文（MUST NOT 回落到中文列）。
  D322: {
    zh: "在左栏中定位到此文件",
    en: "Reveal in File Tree",
    lock: "en",
  },

  // -------------------------------------------------------------------------
  // Harness 对话面板（D326–D348，M303，change add-harness-probe）
  // 文案随能力走：全部消费点在 src/harness-panel.ts（面板 DOM 与 chip / 批准闸 / 压缩标记）
  // 与 src/keys.ts（toggle 命令的来由 D345 只留 docKey 引用）。
  // -------------------------------------------------------------------------
  D326: {
    zh: "对话",
    en: "Chat",
  },
  D327: {
    zh: "对话面板",
    en: "Chat panel",
  },
  D328: {
    zh: "问点什么…（Enter 发送，⇧Enter 换行）",
    en: "Ask something… (Enter to send, ⇧Enter for newline)",
  },
  D329: {
    zh: "发送",
    en: "Send",
  },
  D330: {
    zh: "新会话",
    en: "New session",
  },
  D332: {
    zh: "上下文：{path} · 视口 {from}–{to} 行",
    en: "Context: {path} · viewport lines {from}–{to}",
  },
  D333: {
    zh: "上下文：无（未打开文件）",
    en: "Context: none (no file open)",
  },
  // 用量条是读数不是措辞（与 D317 的语言档同口径）：两列同形。
  D334: {
    zh: "ctx {ctx}% · cache {cache}%",
    en: "ctx {ctx}% · cache {cache}%",
  },
  D335: {
    zh: "上下文已用 {ctx}%，越过 {warn}% 警示线——继续对话将自动压缩续聊",
    en: "Context usage {ctx}% is past the {warn}% warning line — further turns will be auto-compacted",
  },
  D336: {
    zh: "采纳",
    en: "Approve",
  },
  D337: {
    zh: "拒绝",
    en: "Reject",
  },
  D338: {
    zh: "拒绝原因（可选，回送给模型）",
    en: "Reason for rejection (optional, sent back to the model)",
  },
  D339: {
    zh: "{tool} 请求修改文件，采纳后才落盘：",
    en: "{tool} asks to modify a file; nothing is written until approved:",
  },
  D340: {
    zh: "{tool} 请求执行命令，采纳后才运行：",
    en: "{tool} asks to run a command; nothing runs until approved:",
  },
  D341: {
    zh: "会话已自动压缩（上下文触顶）——以下为摘要，完整历史仍在本地留存",
    en: "Conversation auto-compacted (context limit hit) — summary below; the full history is kept locally",
  },
  D342: {
    zh: "压缩摘要",
    en: "Compaction summary",
  },
  D343: {
    zh: "调用工具：{name}",
    en: "Calling tool: {name}",
  },
  D344: {
    zh: "工具完成：{name} — {summary}",
    en: "Tool done: {name} — {summary}",
  },
  D345: {
    zh: "唤起 / 收起 harness 对话面板（M303，change add-harness-probe）：右栏 dock 在 0px 与 --layout-dock-w 之间切换，语义取「A = Agent」，⌘ 系归 mac 惯例。取 global——焦点在左栏 / 搜索框 / 浮层里时同样要能唤起；面板打开时焦点在面板的输入框里（不在 contentDOM 内），再按要能收起。冲突已核（零冲突，三条独立来源）：① 表内——keys.ts 即真源，⌘⇧ 系现有 Cmd-Shift-z（重做）/ Cmd-Shift-o（toc.toggle）/ Cmd-Shift-T（view.theme-cycle）/ Cmd-Shift-L（view.language-cycle）四条，⌘⇧A 不在其中；② 原生菜单 accelerator 集合（tauri 的 Menu::default() 逐项来自 muda 的 items/predefined.rs，清单见 keys.ts 文件头 M149 段）不含 ⌘⇧A；③ macOS 系统级不预置 ⌘⇧A（Finder 的「应用程序」快捷键只在 Finder 窗口作用域）。可经 [keys] 重绑 / 解绑",
    en: "Show / hide the harness chat panel (M303, change add-harness-probe): the right-hand dock switches between 0px and --layout-dock-w; the letter means A = Agent, and the ⌘ family follows mac conventions. Scope is global — it must also work with focus in the left column, the search box or a popover; with the panel open focus is in its input (not inside contentDOM) and pressing again must close it. Conflicts checked (none, three independent sources): (1) the table's ⌘⇧ bindings are ⇧⌘Z (redo) / ⇧⌘O (toc.toggle) / ⇧⌘T (view.theme-cycle) / ⇧⌘L (view.language-cycle) and ⌘⇧A is not among them (keys.ts is the source of truth); (2) the native menu accelerator set (tauri's Menu::default() takes each item from muda's items/predefined.rs, list in the M149 section of the keys.ts header) has no ⌘⇧A; (3) macOS presets no ⌘⇧A (Finder's Applications-folder shortcut is scoped to Finder windows). Can be rebound / unbound via [keys]",
  },
  D346: {
    zh: "与当前文档对话——发送时会携带上方显示的上下文，发送前可核对。",
    en: "Chat about the current document — the context shown above is sent with your message; check it before sending.",
  },
  D347: {
    zh: "发送失败：{reason}",
    en: "Send failed: {reason}",
  },
  D348: {
    zh: "错误：{message}",
    en: "Error: {message}",
  },

  // -------------------------------------------------------------------------
  // pane 命令族的三条键位来由（D365–D367，M319，change pane-system-split-view 分组 6.1）
  // 全部是 `src/keys.ts` 键位表的逐条 doc（消费者 = 键位面板 `src/bindings-panel.ts` 的
  // doc 列）。命令本体 M316 已进表；本批把三条从默认不绑键清单移到默认绑定表。
  // 键位占用的三条来源核对逐条写在正文里（表即文档，keys.ts 不再另抄一份）。
  // -------------------------------------------------------------------------
  D365: {
    zh: "在活跃 pane 旁侧新开一个空 pane 并把焦点交给它（已达上限二时为无操作）。键位取 ⌥S：⌥ 系单段沿用 Emacs 的 Alt 前缀惯例（表内 Alt-KeyV / Alt-KeyD / Alt-KeyB / Alt-KeyF / Alt-KeyG 同族），语义 S = Split。取 global——pane 是窗口级对象，焦点在左栏 / 搜索框 / 浮层里时同样要能分栏（同 tab.* / view.* 一族理由）。冲突已核（零冲突，三条独立来源）：① 表内——keys.ts 即真源，⌥ 系现占用 Alt-KeyV / Alt-KeyD / Alt-KeyB / Alt-KeyF / Alt-KeyG / Alt-Backspace，⌥S 零占用；② 原生菜单 accelerator——tauri 的 Menu::default() 逐项来自 muda 的 items/predefined.rs，其中唯一的 ⌥ 系预置是 HideOthers=⌥⌘H，自建项里唯一带 accelerator 的是 CmdOrCtrl+Q（src-tauri/src/lib.rs），均不含 ⌥S；③ macOS 系统级不预置裸 ⌥ 字母（Option 系预置都是 ⌥⌘ 组合）。（M319，Alex 节点 1 落槌 split=⌥S）",
    en: "Opens a new empty pane beside the active pane and gives it focus (no-op once the two-pane limit is reached). The key is ⌥S: single-segment ⌥ follows the Alt-prefix convention of Emacs (the Alt-KeyV / Alt-KeyD / Alt-KeyB / Alt-KeyF / Alt-KeyG family in this table) and the letter means S = Split. Scope is global — a pane is a window-level object, so splitting must also work with focus in the left column, the search box or a popover (same reason as the tab.* / view.* family). Conflicts checked (none, three independent sources): (1) the table (keys.ts is the source of truth) already uses Alt-KeyV / Alt-KeyD / Alt-KeyB / Alt-KeyF / Alt-KeyG / Alt-Backspace in the ⌥ family, so ⌥S is free; (2) the native menu accelerator set (tauri's Menu::default() takes each item from muda's items/predefined.rs; its only ⌥-family preset is HideOthers = ⌥⌘H and the only self-built item with an accelerator is CmdOrCtrl+Q in src-tauri/src/lib.rs) has no ⌥S; (3) macOS presets no bare ⌥ letter (Option-family presets are all ⌥⌘ combos). (M319; node-1 ruling split = ⌥S)",
  },
  D366: {
    zh: "把活跃 pane 切到另一个 pane（单 pane 时为无操作）。键位取 ⌥O：⌥ 系单段同 ⌥S 一族，语义 O = Other。取 global——同 ⌥S（pane 是窗口级对象）。冲突已核（零冲突，三条独立来源）：① 表内——keys.ts 即真源，⌥O 零占用；② 原生菜单 accelerator——muda predefined 清单里唯一的 ⌥ 系预置是 ⌥⌘H，自建项只有 CmdOrCtrl+Q，均不含 ⌥O；③ macOS 系统级不预置裸 ⌥ 字母。（M319，Alex 节点 1 落槌 other=⌥O）",
    en: "Switches the active pane to the other pane (no-op with a single pane). The key is ⌥O: single-segment ⌥ as with ⌥S, and the letter means O = Other. Scope is global, same as ⌥S (a pane is a window-level object). Conflicts checked (none, three independent sources): (1) the table (keys.ts is the source of truth) does not use ⌥O; (2) the muda predefined list's only ⌥-family preset is ⌥⌘H and the only self-built accelerator is CmdOrCtrl+Q, so the native menu set has no ⌥O; (3) macOS presets no bare ⌥ letter. (M319; node-1 ruling other = ⌥O)",
  },
  D367: {
    zh: "收起活跃 pane，把它的全部标签按序并入另一 pane（各带撤销史 / 选区 / 滚动状态；单 pane 时为无操作）。键位取 ⌥W：⌥ 系单段同 ⌥S 一族，语义 W = Window（收掉当前窗格）。取 global——同 ⌥S（pane 是窗口级对象）。冲突已核（零冲突，三条独立来源）：① 表内——keys.ts 即真源，⌥W 零占用（注意：⌘W 已归 tab.close，⌥W 是不同 token，互不干扰）；② 原生菜单 accelerator——muda predefined 的 CloseWindow 用 ⌘W（M149 已把它换成不带 accelerator 的自定义项），唯一 ⌥ 系预置是 ⌥⌘H，均不含 ⌥W；③ macOS 系统级不预置裸 ⌥ 字母。（M319，Alex 节点 1 落槌 close=⌥W）",
    en: "Collapses the active pane and merges all of its tabs, in order, into the other pane (each keeping its undo history / selection / scroll state; no-op with a single pane). The key is ⌥W: single-segment ⌥ as with ⌥S, and the letter means W = Window (collapse this window's pane). Scope is global, same as ⌥S (a pane is a window-level object). Conflicts checked (none, three independent sources): (1) the table (keys.ts is the source of truth) does not use ⌥W (note ⌘W is already tab.close — a different token, no interference); (2) in muda's predefined list CloseWindow uses ⌘W (M149 replaced it with a custom item without an accelerator) and the only ⌥-family preset is ⌥⌘H, so the native menu set has no ⌥W; (3) macOS presets no bare ⌥ letter. (M319; node-1 ruling close = ⌥W)",
  },
  // 分隔条的读屏名（M319，change pane-system-split-view 分组 6.2 的零视觉影响部分）。
  // 消费者是装配层 `src/main.ts` 的 `SPLITTER_LABEL`（`createPaneHandle` 建元素时写、
  // `onRelabel` 重写）。与栏宽手柄的读屏名（D120，同为 role=separator）是两条不同的东西。
  D368: {
    zh: "分隔条——拖拽调整左右两个 pane 的宽度",
    en: "Divider — drag to resize the two panes",
  },
  // 空 pane 引导（M322，change pane-system-split-view 分组 6.2 的拆分 mission）：分栏态空 pane
  // 正文区的水印文案。消费者是装配层 `src/main.ts` 的 `PANE_GUIDE_LABEL`（建元素时写、
  // `onRelabel` 重写）；显示谓词在 `src/pane-layout.ts` 的 `emptyPaneGuideVisible`（仅分栏态 +
  // 零带路径标签 + 前台非 dirty 草稿 + 已装载 vault——未装 vault 不显示，Alex 2026-10-04 裁决）。⌥W 是 pane.close 的默认绑定（M319 落槌）——用户经
  // [keys] 重绑后这句提示不再准确，是本条已知的明账。
  D369: {
    zh: "这个 pane 还没有打开的文件——在左栏选一个文件，它就会在这里打开。不需要它时按 ⌥W 收起。",
    en: "Nothing open in this pane yet — pick a file in the left column and it will open here. Press ⌥W to collapse it.",
  },

  // -------------------------------------------------------------------------
  // Harness 摘录引用卡片（D370–D374，M343，change add-harness-quote-cards）：
  // 混排 composer、卡片、浮动钮与失锚告知的全部可见文案。卡片出处行（文档名 · 标题）是
  // 数据驱动的读数（同 D334 口径），不进编号。消费者：src/harness-panel.ts（composer 卡片 ×
  // 钮 D371、transcript 卡片跳回读屏名 D374、chip 仅路径形态 D373）与 M344（QC3：浮动钮
  // D370、失锚 toast D372——失锚降级链与跳回高亮是 QC3 的实现面）。
  // -------------------------------------------------------------------------
  D370: {
    zh: "摘录到对话",
    en: "Quote to chat",
  },
  D371: {
    zh: "移除摘录",
    en: "Remove quote",
  },
  D372: {
    zh: "该摘录已失锚：原文已不在文档中",
    en: "This quote is no longer anchored: the text is gone from the document",
  },
  D373: {
    zh: "上下文：{path}",
    en: "Context: {path}",
  },
  D374: {
    zh: "跳回原文位置",
    en: "Jump back to the source",
  },
} satisfies Record<string, CopyEntry>;

/** 文案表的键（D 编号，多串格带 `.N` 后缀）——由表数据推导，加一条即多一个键。 */
export type CopyKey = keyof typeof COPY_TABLE;

/**
 * 文案表（运行时唯一取值入口）。这里做一次**类型加宽**：数据用 `satisfies` 保留每个键的字面
 * 类型（`CopyKey` 因此是 320 个字面量的联合），而取值侧一律按 `CopyEntry` 看——`enOne` /
 * `lock` 这类可选属性只声明在少数条目上，不加宽的话 `COPY.D1.enOne` 会被推成「不存在」
 *（消费者是泛型遍历，不是逐键访问）。
 */
export const COPY: Record<CopyKey, CopyEntry> = COPY_TABLE;

/**
 * 后端错误 `code` → 文案表键（change ui-language-i18n 的 D6 裁决：**前端按 code 渲染**，
 * 参数由 Rust 的 `CommandError.params` 提供，`message` 退回「日志 + 未知 code 兜底」）。
 *
 * 覆盖完整性由 `tests/unit/error-text.test.ts` 对账：它从 `src-tauri/src/**` 扫描全部
 * `CommandError::new` 的 code，与本表逐一对账，缺一即红（防「新加的错误码在 en 界面下
 * 掉回中文」这类静默半覆盖）。同一个 code 有多个 message 模板时，表里给一条覆盖式句子
 *（细节措辞有损失，是 D6(a) 的明账）——因此模板只使用该 code **全部**构造点都提供的占位名。
 */
export const ERROR_COPY: Record<string, CopyKey> = {
  vault_not_open: "D159",
  vault_list_failed: "D160",
  config_home_unknown: "D161",
  config_write_failed: "D162",
  config_write: "D163",
  workspace_read: "D164",
  workspace_write: "D165",
  workspace_path: "D166",
  invalid_id: "D167",
  log_event_rejected: "D168",
  fs_root_invalid: "D169",
  fs_root_not_dir: "D170",
  fs_scan_failed: "D171",
  fs_path_invalid: "D172",
  fs_path_escape: "D173",
  fs_not_found: "D174",
  fs_read_failed: "D175",
  fs_name_invalid: "D176",
  fs_already_exists: "D177",
  fs_not_a_file: "D178",
  fs_invalid_utf8: "D179",
  fs_too_large: "D180",
  fs_read_only: "D181",
  fs_trash_failed: "D182",
  fs_rename_failed: "D183",
  fs_create_failed: "D184",
  fs_watch_failed: "D185",
  fs_reveal_failed: "D186",
  document_write_failed: "D187",
  document_write_unknown: "D188",
  document_conflict: "D41",
  link_path_rejected: "D83",
  link_path_failed: "D189",
  wikilink_invalid_path: "D190",
  wikilink_unsupported: "D191",
  wikilink_target_exists: "D192",
  wikilink_invalid: "D193",
  wikilink_create_failed: "D194",
  create_file_invalid_path: "D195",
  create_file_failed: "D196",
  create_file_exists: "D197",
  recovery_write_failed: "D198",
  recovery_read_failed: "D199",
  recovery_discard_failed: "D200",
  recovery_list_failed: "D201",
  recovery_invalid_path: "D202",
  // 局部 patch 写入口（change add-harness-probe，M301）：三条都由 fs_io::fs_patch_file 构造。
  patch_invalid: "D323",
  patch_not_found: "D324",
  patch_not_unique: "D325",
  // Harness 对话运行时（change add-harness-probe，M302）：D349–D364 的注册。
  harness_jsonl_failed: "D349",
  harness_fixture_missing: "D350",
  harness_fixture_unreadable: "D351",
  harness_fixture_invalid: "D352",
  harness_api_key_missing: "D353",
  harness_http_failed: "D354",
  harness_network_failed: "D355",
  approval_not_found: "D356",
  approval_stale: "D357",
  harness_context_invalid: "D358",
  harness_compact_failed: "D359",
  harness_compact_empty: "D360",
  harness_busy: "D361",
  harness_no_session: "D362",
  harness_thread_failed: "D363",
  harness_state_failed: "D364",
  open_url_rejected: "D78",
  open_url_failed: "D79",
};
