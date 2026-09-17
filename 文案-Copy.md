# 文案 Copy Deck：Lumir v2

状态：M57 定稿草案。本文是产品可见文案 source of truth。
编号规则：D1 起连续编号；新增条目只追加，不复用已删除编号。旧版编号不强制保持，以本版重新编排。
角色：作者（单一角色）。每条包含位置、角色、中文、English、设计意图五要素。

| 编号 | 位置 | 角色 | 中文 | English | 设计意图 |
| --- | --- | --- | --- | --- | --- |
| D1 | masthead vault 字段 | 作者 | 未打开 vault | No vault open | 诚实表达尚未选择工作空间，不伪装为空文件夹。 |
| D4 | 树头部切换按钮 | 作者 | 切换 | Switch | 让低频 vault 切换可发现但不抢主导航注意力。 |
| D5 | 树空态说明 | 作者 | 打开一个目录作为 vault，开始浏览全部文件。 | Open a folder as a vault to start browsing all its files. | 首次使用同时给出动作与收益。 |
| D6 | 树空态按钮 | 作者 | 打开 vault | Open vault | 提供唯一明确入口。 |
| D7 | 树恢复失败 notice | 作者 | 〔后端透传原因〕 | [Backend-provided reason] | 区分恢复失败与数据丢失，不掩盖原因。 |
| D19 | toast 通用错误 | 作者 | {原因} | {reason} | 透传人话原因，避免技术堆栈污染工作流。 |
| D20 | toast 标题缺失 | 作者 | 标题未找到：{标题} | Heading not found: {heading} | 说明跳转目标缺失而非打开失败。 |
| D21 | toast 未创建链接 | 作者 | 未创建的链接：{原文} | Link not created yet: {raw} | 把待创建链接描述为事实而非错误。 |
| D22 | toast 创建成功 | 作者 | 已创建：{路径} | Created: {path} | 给出动作完成及落地位置。 |
| D23 | panel 唤出 | 作者 | 显示面板 | Show panel | 快捷键唤出上下文面板时提供可理解命名。 |
| D24 | panel 空态 | 作者 | 面板（后续波次） | Panel (later waves) | 默认隐藏面板，出现时也不伪造内容。 |
| D25 | 二进制覆盖层 | 作者 | 暂不支持预览：{路径} | Preview not supported yet: {path} | 明确能力边界并保留路径。 |
| D40 | vault remap toast | 作者 | 发现 {数量} 个可映射的 vault 路径 | Found {count} remappable vault paths | 恢复时安静提示可选映射数量，不打断作者当前工作。 |
| D31 | 附件未找到提示块 | 作者 | 附件未找到：{引用} | Attachment not found: {ref} | 原位说明引用缺失，不中断正文。 |
| D32 | 附件读取未接线 | 作者 | 附件读取未接线 | Attachment pipeline not wired | 预览桩诚实表达后端尚未接入。 |
| D33 | 内容嵌入不支持 | 作者 | 内容嵌入不支持 | Note embed not supported | 明确兼容边界，不伪装成加载失败。 |
| D34 | wikilink 歧义 | 作者 | 歧义 | Ambiguous | 提醒作者存在多个候选，不替作者猜测。 |
| D35 | 块引用不支持 | 作者 | 块引用不支持：{原文} | Block reference not supported: {raw} | 原样保留不支持语法，并解释原因。 |
| D36 | frontmatter 解析失败 | 作者 | frontmatter 解析失败：{原因} | Frontmatter parse failed: {reason} | 原文回退并说明解析问题。 |
| D37 | 空 frontmatter | 作者 | （空 frontmatter） | (empty frontmatter) | 说明检测到 frontmatter 但没有字段。 |
| D38 | frontmatter 非键值结构 | 作者 | frontmatter 不是键值结构，按原文显示 | Frontmatter is not a key-value map; showing raw text | 解释回退决策而非制造错误感。 |

| D39 | 未创建链接 toast 动作 | 作者 | 创建并打开 | Create & open | 预告创建后立即打开，避免作者猜测下一步。 |
| D41 | toast 保存冲突 | 作者 | 保存冲突：文件在磁盘上已被外部修改，内存中的修改未丢失 | Save conflict: the file was modified on disk; your changes are still in memory | 陈述冲突事实并先安作者的心：修改没丢。 |
| D42 | 保存冲突 toast 动作 | 作者 | 重新载入（放弃我的修改） | Reload (discard my changes) | 动作自含代价说明，作者无需猜测后果。 |
| D43 | 保存冲突 toast 动作 | 作者 | 强制覆盖保存 | Force save (overwrite) | 破坏性动作入口，措辞直接但不预设作者已理解后果。 |
| D44 | 强制覆盖二次确认 | 作者 | 将覆盖磁盘上较新的内容，此操作不可撤销。确认强制覆盖保存？ | This will overwrite newer content on disk and cannot be undone. Force save anyway? | 覆盖前的最后防线：明示磁盘内容较新且不可撤销。 |
| D45 | toast 强制覆盖成功 | 作者 | 已强制覆盖保存 | Force saved | 确认覆盖完成，与常规保存区分（动作带代价）。 |
| D46 | toast 重新载入成功 | 作者 | 已重新载入磁盘内容 | Reloaded from disk | 确认本地修改已放弃、内容回到磁盘版本。 |
| D47 | toast 保存目标丢失 | 作者 | 保存失败：文件已被外部删除或移动，内存中的修改未丢失 | Save failed: the file was deleted or moved elsewhere; your changes are still in memory | 区分「写不进」与「文件没了」，并强调最后副本仍在内存。 |
| D48 | 保存目标丢失 toast 动作 | 作者 | 另存为新文件 | Save as new file | 给出明确出口：内存内容有地方可去。 |
| D49 | toast 另存成功 | 作者 | 已另存为：{路径} | Saved as: {path} | 确认内容落地位置，作者可继续在新文件上工作。 |
| D50 | toast 外部修改自动重载 | 作者 | 检测到外部修改，已自动重载 | External changes detected; reloaded | 自动行为必须留下可见痕迹，否则像界面自己跳动。 |
| D51 | toast 外部修改选择 | 作者 | 检测到外部修改：{路径} | External changes detected: {path} |  dirty 时不替作者决定，把两条路摆出来。 |
| D52 | 外部修改 toast 动作 | 作者 | 重载（放弃我的修改） | Reload (discard my changes) | 动作自含代价说明。 |
| D53 | 外部修改 toast 动作 | 作者 | 保留我的版本 | Keep my version | 中性确认本地优先，后续保存时再走冲突处置。 |
| D54 | toast 打开中文件被外部删除 | 作者 | 当前文件已被外部删除：{路径}；编辑器中的内容未丢失 | The open file was deleted externally: {path}; the content is still in the editor | 坏消息配救生圈：删除不可挽回，但内容还在。 |
| D55 | toast 自动保存成功 | 作者 | 已自动保存 | Auto-saved | 自动落盘必须留下可见痕迹，并与手动保存区分（后者是作者的主动动作）。 |
| D56 | toast 自动保存部分快照 | 作者 | 已自动保存当前快照，仍有未保存修改 | Auto-saved the current snapshot; unsaved changes remain | 说明只落了快照、后续仍会继续写入，不制造「已全部保存」的错觉。 |
| D57 | 崩溃备份发现提示 | 作者 | 发现未保存的崩溃备份：{路径} | Unsaved crash backup found: {path} | 上次异常退出留下内容，陈述可恢复的事实，不制造恐吓。 |
| D58 | 崩溃备份 toast 动作 | 作者 | 恢复内容 | Restore content | 明确动作对象是备份内容本体。 |
| D59 | 崩溃备份 toast 动作 | 作者 | 丢弃备份 | Discard backup | 给出不恢复的出口，避免提示常驻。 |
| D60 | toast 崩溃备份已恢复 | 作者 | 已恢复未保存内容，请保存（Cmd+S） | Unsaved content restored; press Cmd+S to save | 恢复后内容仍在内存缓冲，说明下一步动作。 |
| D61 | toast 崩溃备份已丢弃 | 作者 | 已丢弃崩溃备份 | Crash backup discarded | 确认清理完成，提示不再出现。 |
| D62 | toast 崩溃备份不存在 | 作者 | 崩溃备份已不存在 | The crash backup no longer exists | 用户恢复前备份已被别处清理，说明原因而非报错。 |
| D63 | 键位面板标题 | 作者 | 键位（生效中） | Key bindings (active) | 明确列出的是当前生效的表（含配置覆盖），不是文档里的默认表。 |
| D64 | 键位面板分组标题 | 作者 | 移动与选择 / 扩选 / 删除 / kill-yank / 翻屏 / 撤销 / widget / 全局 / 其他 | Movement & selection / Extend selection / Deletion / kill-yank / Scrolling / Undo / Widget / Global / Other | 按功能族分组便于扫读；「其他」是未归组命令的兜底，不让任何命令从视野里消失。 |
| D65 | 键位面板未绑定标注 | 作者 | 未绑定 | Unbound | 被配置解绑的命令仍在面板里，标注它当前没有键位指向。 |
| D66 | 键位面板未绑定的行说明 | 作者 | 当前没有键位指向它（配置解绑或尚未绑定） | No key is bound to it (unbound in config, or never bound) | 说明「未绑定」的两种成因，并指向下一步该去配置里找。 |
| D67 | 键位面板关闭提示 | 作者 | Esc / ⌃G 或点击遮罩关闭 | Close with Esc / ⌃G or by clicking outside | 给出手不离键盘的出口，并说明鼠标路径。 |
| D68 | 搜索 panel 标签 / 输入框 | 作者 | 查找 | Find | 标签文字与输入框读屏名同源同字，视觉与读屏指向同一个动作；不用占位符——占位符一输入就消失，读屏也拿不到。 |
| D69 | 搜索 panel 导航按钮 | 作者 | 上一个 / 下一个 | Previous / Next | 纯动词短语，不带键位提示（panel 内键位就地消费，不进键位表）；无匹配时按钮禁用，置灰本身说明没得走。 |
| D70 | 搜索 panel 大小写开关 | 作者 | 区分大小写 | Match case | 可见字形是 Aa（省空间），aria-label 给出完整含义；开/关经 aria-pressed 报告，读屏能听出状态。 |
| D71 | 搜索 panel 关闭按钮 | 作者 | 关闭 | Close | 可见字形是 ×，aria-label 给出完整含义，读屏不播报「乘号」。 |
| D72 | 搜索 panel 匹配计数 | 作者 | {当前}/{总数}；无匹配时 0/0；超过计数上限（当前 1000）时 {总数}+ | {current}/{total}; 0/0 when there is no match; {total}+ past the match-count cap (currently 1000) | 计数是活信息（aria-live=polite，随查询播报）。未选中任何匹配时报 0/总数；超过内部上限时报下界加号，不假装知道精确总数。 |
| D73 | 表格降级提示（非矩形） | 作者 | 表格阅读降级：第 {行号} 行单元格数与表头不符（应为 {列数} 列）——保留原始 Markdown | Table reading degraded: row {line} has a different cell count than the header ({columns} columns) — showing raw Markdown | 归因到具体行号（文档 1 基行号，非表内行序）与应有列数，作者照着行号就能定位源文件里出格的那行；只说「保留原始 Markdown」等于没说。 |
| D74 | 表格降级提示（体积超限） | 作者 | 表格阅读降级：表格约 {KiB} KiB，超过 64 KiB 阅读上限——保留原始 Markdown | Table reading degraded: the table is about {KiB} KiB, over the 64 KiB reading limit — showing raw Markdown | 说明超的是 64 KiB 阅读上限而非表格本身损坏，并给出约数体积供作者判断下一步。 |
| D75 | 表格降级提示（兜底） | 作者 | 表格阅读降级：无法识别表格结构——保留原始 Markdown | Table reading degraded: the table structure could not be recognized — showing raw Markdown | 判定不出具体原因时不给假归因，只陈述「结构无法识别」这一事实与回退结果。 |
| D76 | 横线读屏名 | 作者 | 分隔线 | Separator | 源码的 `---` 已被替换成无文本的横线，补 aria-label 避免出现无名的 separator（装饰隐藏标记时仍保留可理解的读屏文本）。 |
| D77 | 外链尾部标记 | 作者 | ↗︎ | ↗︎ | 外链在渲染态的可见标识：源码里的 `(url)` 被隐藏后，这是「这条指向站外、能打开」的唯一视觉线索。用字形而非文案——每条链接都跟一句「在新窗口打开」会把正文淹掉；标记本身是装饰性元素（aria-hidden），URL 经链接的 title 属性对悬停与读屏可取。 |
| D78 | toast 外链目标被拒 | 作者 | 打不开这类链接：{原文}——只支持 http、https、mailto | Can't open this link: {raw} — only http, https and mailto are supported | 说清被拒的是「这类目标」而不是「这个动作」，并把允许范围一次讲完，作者不必再试第二次。 |
| D79 | toast 外链打开失败 | 作者 | 打开链接失败：{原因} | Couldn't open the link: {reason} | 系统调用失败（无默认应用等）时透传原因；与 D78 的「不支持这类链接」分开——前者是环境问题、后者是能力边界，混成一句会让人去改链接。 |
| D80 | 链接尾部标记（应用内跳转） | 作者 | → | → | 与 D77 成对：↗︎ = 会离开本应用，→ = 应用内跳转。同一份文档里两种标记一眼可分辨，作者按 ⌘⏎ 之前就知道这一下是换文档还是换应用；也是纯装饰（aria-hidden），目标经链接的 `title` 属性可取。 |
| D81 | toast 链接目标不存在 | 作者 | 链接目标不存在：{原文} | Link target not found: {raw} | 相对路径链接解析不到时只陈述事实并给出原文：不提议创建文件（一键创建是 wikilink 的显式动作，相对路径链接不继承它），作者据此判断是路径写错还是文件确实没建。 |
| D82 | toast 锚点跳转不支持 | 作者 | 暂不支持锚点跳转 | Anchor jump is not supported yet | 明确能力边界而不是假装跳转成功：`#section` 目前没有文档内跳转链路，说「暂不支持」比静默不动更让人放心——同一句话也不承诺时间表。 |
| D83 | toast 打开 vault 内文件失败 | 作者 | 打不开这个目标：{目标}——{原因} | Can't open this target: {target} — {reason} | 非 md 相对路径交系统默认应用失败时，一次讲清「打不开的是哪个目标」与原因（原因当前取 `它不在 vault 内` / `路径含非 UTF-8 字符`）；与 D78/D79 同形但不合并——那两条说的是外链，混用会让人以为问题出在 URL 上。 |
| D84 | toast 无标题文档（大纲为空） | 作者 | 这份文档还没有标题，大纲为空 | This document has no headings yet, so the outline is empty | 空标题文档激活大纲时不弹空浮层：陈述「没有标题」这一事实并说明结果是「没有大纲可跳」，作者据此知道该去文档里加标题，而不是怀疑入口坏了。 |
| D85 | 大纲浮层读屏名 | 作者 | 大纲 | Outline | 浮层是一条列表（role=listbox），读屏需要一个名字；与 D63 键位面板同口径，名字只说明「这是什么」。 |
| D86 | 大纲浮层键位提示 | 作者 | ↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭 | ↑↓ or ⌃N/⌃P to move · Enter to jump · Esc to close | 浮层内的导航键就地消费、不进键位表，因此界面上必须自报用法，否则只有「试出来」一条路（与 D67 键位面板提示同口径）。M160 起覆盖五个就地键：⌃N / ⌃P 是 Emacs 的 next-line / previous-line，与 ↑↓ 同一落点、同一钳制。 |
| D87 | masthead 当前位置指示的悬停提示 | 作者 | 点击展开大纲 | Click to open the outline | 位置指示段同时是大纲入口，纯图标/文本自身看不出可点；悬停提示给出动作，读屏名仍是标题链本身（不被提示覆盖）。 |
| D88 | 标签栏读屏名 | 作者 | 打开的文档 | Open documents | 标签栏是一条 tablist（`role=tablist`），读屏需要一个名字；与 D63 键位面板、D85 大纲浮层同口径，名字只说明「这是什么」。 |
| D89 | 标签关闭按钮读屏名 | 作者 | 关闭 {文件名} | Close {file name} | 可见字形是 ×（省空间），aria-label 给出完整含义并**点名关的是哪一个**——多标签下「关闭」是歧义的，读屏只播报「乘号」或「关闭」都会让人不知道关掉的是哪份文档（与 D71 搜索面板关闭按钮同形但必须带对象名，这正是多标签带来的新要求）。 |
| D90 | 标签的未保存标记（并入标签读屏名） | 作者 | {文件名}（未保存） | {file name} (unsaved) | dirty 粒度升级为「每标签」后，masthead 的「（未保存）」只描述前台那一个（D15 口径不变）；标签栏必须自报每个标签自己的状态，否则背景标签里的未保存修改在界面上完全不可见。括号形式与 D15 同源，读屏听出来的是同一句话。 |
| D91 | 标签的悬停提示 | 作者 | {vault 相对路径} | {vault-relative path} | 标签可见文本是文件名（basename），同名文件分散在不同目录时会混淆；悬停提示给出完整相对路径，与文件树的行提示（D19 同族）口径一致。读屏名仍是「文件名（未保存）」，不被提示覆盖。 |
| D92 | toast 关闭未保存标签的确认 | 作者 | 「{路径}」有未保存修改，关闭后修改将丢失 | "{path}" has unsaved changes; closing will discard them | 关标签是破坏性动作，必须二次确认；文案点名路径并说明后果（丢弃），不假装可撤销。关掉之后没有 undo 通道，所以「会丢失」是事实陈述而非警示修辞。 |
| D93 | toast 关闭未保存标签的动作 | 作者 | 保存并关闭 / 放弃修改并关闭 / 取消 | Save and close / Discard changes and close / Cancel | 三个动作各自闭环：给可保存的走保存（最常见），给明确的放弃出口（不逼用户去别处撤销），给取消（浮条可点消隐，但显式出口更清楚）。动作自含代价，与 D52 同口径。 |
| D94 | 保存侧提示按标签点名（前缀模板） | 作者 | 「{路径}」{原有提示} | "{path}" {existing message} | 多标签下「保存失败」「保存冲突」「已被外部删除」「已重新载入磁盘内容」这些没有对象名的提示全部变成歧义的——同一个浮条区里可能同时有多个标签的提示。统一给原文加「路径」前缀（D49/D50/D55/D57/D60 各自的原文不动，只加前缀），既解决歧义又不新增条目语义。 |
| D95 | 树恢复中 notice（启动恢复进行态） | 作者 | 正在恢复上次打开的 vault…… | Restoring the last vault… | 启动恢复移出主线程后，界面先于结果可用，这一态必须诚实表达：不是「尚无 vault」（D1/D5 的终态语义），也不是恢复失败（D7 的透传原因），而是「上次的 vault 马上就到」。复用未打开空态的布局与「打开 vault」入口（D5/D6），因此提示只补一行位置语义，不新增动作。 |
| D96 | 树头部 vault 切换器入口（读屏名 / 悬停提示） | 作者 | vault：{名称}（点击查看全部 vault） | Vaults: {name} (click to see all vaults) | 入口就是 vault 名称本身（形态 A），纯文本看不出它可点——提示必须一次给出动作与收益；同一句话同时作 `title` 与 `aria-label`，悬停与读屏指向同一个动作（与 D87 同形）。 |
| D97 | 切换器浮层读屏名 | 作者 | vault | Vaults | 浮层是一条列表（`role=listbox`），读屏需要一个名字；与 D63 键位面板、D85 大纲浮层同口径，名字只说明「这是什么」。 |
| D98 | 浮层当前项标记 | 作者 | 当前 | Current | 单激活（决策 2）要求列表里的当前项**唯一**可辨：朱红实心点承担视觉（M52 朱红只在需要分流处出现），文字承担读屏与色觉差异下的可辨性。 |
| D99 | 浮层行摘要 | 作者 | {n} 个标签 · {相对时间}；当前项为「{n} 个标签 · 现在打开」；没有打开记录的老注册项只给「{n} 个标签」 | {n} tab(s) · {relative time}; the current vault reads 「{n} tab(s) · open now」 | 摘要是决策 3「只恢复标签列表」在切换**之前**的可见预告：数字与入盘数字同源（固定标签数，预览标签不入盘），用户在按下去之前就知道会恢复什么。当前项说「现在打开」而不是时间——它正在被用，时间没有信息量。 |
| D100 | 摘要里的相对时间 | 作者 | 刚刚 / {n} 分钟前 / {n} 小时前 / 昨天 / {n} 天前 / {绝对日期} | just now / {n} min ago / {n} h ago / yesterday / {n} days ago / {absolute date} | 相对时间是「多久没用这个 vault」的直觉读法；一周以上改给绝对日期（再往下数天数不再有信息量）。时钟回拨（记录时间在将来）落进「刚刚」，不产出负数。 |
| D101 | 浮层行摘要（没有标签历史） | 作者 | 还没有打开过文件 | No files opened yet | 新 vault 与「打开过但从没开过文件」是同一件事（决策 3：只恢复标签列表），说这句话比给「0 个标签」更像人话。 |
| D102 | 浮层失效行的成因 | 作者 | 路径不可用：目录被移动，或所在卷未挂载 | Path unavailable: the folder was moved, or its volume is not mounted | 失效项不静默移除（列表是用户主动打开的面），因此必须说清「它为什么在这里却不能切」；两种常见成因一次讲完，用户不必猜是哪一种。 |
| D103 | 浮层失效行的动作 | 作者 | 重新定位… | Relocate… | 失效行**不可切换**，唯一出口是重映射（复用既有 `vault_remap`）；不给「从列表移除」——注册项只归档不删除，稳定 id 是重映射的锚点。省略号预告后面还有一步（选目录）。 |
| D104 | 浮层底部新增入口 | 作者 | 新增 vault…（悬停与读屏名：选择一个目录作为新 vault） | Add vault… (title: Choose a folder as a new vault) | 形态 A 下这是浮层里**唯一**的新增入口（低频动作收进中频入口，左栏保持安静）；省略号预告「后面还有一步」。 |
| D105 | 重定位选到已占用路径的拒绝提示 | 作者 | 这个目录已经是「{名称}」的路径，不能用来重新定位 | That folder is already the path of "{name}" | 稳定 id 是重映射的锚点，把两个身份并到同一路径会让列表出现两行同路径、按路径查找不再确定；拒绝并说清原因，而不是静默合并。 |
| D106 | 重定位无从绑定的提示 | 作者 | 这个目录没法用来重新定位「{名称}」；请选择该 vault 现在所在的目录 | That folder cannot be used to relocate "{name}"; pick the folder where that vault is now | 选中的目录没有可映射的失效项（该注册项已归档等）时无从绑定，也不该顺手变成一次「新增 vault」；提示给出下一步该怎么选。 |
| D107 | 空 vault 首入态引导 | 作者 | 这个 vault 还没有打开的文件。在左栏选一个文件开始。 | No files opened in this vault yet. Pick one in the left column to start. | 装载完成而一个标签都没恢复出来（没有历史，或历史里的文件全部不在 vault 里）时，正文给一句指路——不伪造内容，也不让用户对着空白猜下一步（标签栏此时自然隐藏）。 |
| D108 | 恢复时跳过缺失文件的计数提示 | 作者 | {n} 个文件已不在这个 vault 里，已跳过 | {n} file(s) are no longer in this vault and were skipped | 8 个标签里 3 个缺失会刷出 3 条浮条，把「整窗换了上下文」这件事淹掉：一次计数说清规模，逐条缺席由标签栏自己说明（D90）。MUST NOT 逐个报错。 |
| D109 | 切换 vault 的 dirty 拦截提示 | 作者 | 「{vault 名}」里有 {n} 个标签有未保存修改，切换会丢弃这些修改 | "{vault}" has {n} tab(s) with unsaved changes; switching will discard them | 点名**当前** vault 与脏标签数：未保存修改属于当前 vault、不属于切换目标（M158 r1 的修正），哪些标签脏由标签栏逐标签的 dirty 点承担（D90）——把标签名列进提示是第二处真源。规模是对「要不要放弃」这个决定的度量，所以给数量而不是文件名。 |
| D110 | 切换 vault 拦截的三个动作 | 作者 | 保存并切换 / 放弃修改并切换 / 取消 | Save and switch / Discard changes and switch / Cancel | 与关标签确认 D93 同形：把出口放在拦下它的地方——此前是一句无动作的 sticky 提示，用户得自己回编辑器存好再重试。不可保存的脏标签不给「保存并切换」（那是一条走不通的建议），只留后两条。 |

D30 已合并入 D18；D30 编号停用，不复用。**D4「切换」随多 vault 切换器（M163）停用，不复用**——树头部的入口改为 vault 名称本身（形态 A），那句「切换」文字按钮退场。D2–D3、D8–D18、D27–D29 随 Thread 特性删除（ADR 0006，2026-09-12）停用，不复用。D23–D24 随 panel 空壳清除（M124，2026-09-12）停用，不复用。D55–D62 为保存链路加固新增（M127，2026-09-12）。D63–D67 为键位查看面板新增（M133，2026-09-13）。D68–D72 为文件内搜索 panel 新增（M139，2026-09-16）。D73–D76 为 Markdown 渲染批新增（M138，2026-09-16）——表格降级归因句三种形态与分隔线读屏名。D77–D79 为外链批新增（M144，2026-09-16）——外链尾部标记与两条打开链路的失败提示。D80–D83 为链接形态矩阵补全新增（M145，2026-09-17）——应用内跳转标记与三种新提示（相对路径未解析、锚点不支持、vault 内文件打开失败）。D84–D87 为轻量大纲新增（M148，2026-09-17）——空标题提示、浮层读屏名、浮层键位提示与位置指示段的悬停提示。D88–D94 为多标签页新增（M149，2026-09-17）——标签栏与关闭按钮的读屏名、标签的未保存标记与悬停提示、关闭未保存标签的确认与三个动作、以及保存侧提示的「路径」前缀模板。D95 为启动恢复进行态新增（M159，2026-09-17）——恢复移出主线程后「恢复中」这一可见态在树空态里的提示行。D86 于 M160（2026-09-17）扩为覆盖五个就地键（新增 ⌃N / ⌃P，与 ↑↓ 等价），编号沿用不改。

## 文案实现备注

树、编辑器、toast 的动态错误由 `src/tree.ts` / `src/save-controller.ts` 持有或透传；本 deck 收编其稳定可见部分。保存链路的稳定文案（含守卫提示与冲突/备份动作）随 M127 的拆分集中在 `src/save-controller.ts`。键位面板（D63–D67）的文案在 `src/main.ts` 的 `createBindingsPanel` 内；面板里逐条显示的**键位来由**不是本 deck 的条目——它来自 `src/keys.ts` 键位表的 `doc` 字段（表即文档，随绑定一起维护）。搜索 panel（D68–D72）的文案在 `src/search.ts` 的 `LumirSearchPanel` 内——与键位面板把文案写在 `main.ts` 的写法并列；计数串的三态（`当前/总数`、`0/0`、`总数+`）由同文件的 `tallyLabel` 生成，deck 里的 `{当前}/{总数}` 即它的模板。表格降级归因句（D73–D75）的文案在 `src/preview/table.ts` 的 `degradationNotice`：`src/preview/livePreview.ts` 把同一句话同时写进 `aria-label` 与 `data-degraded`（单一来源），上屏文本由 `src/style.css` 的 `.cm-lp-table-degraded::after` 用 `attr(data-degraded)` 取用——读屏与视觉看到的是同一份归因，CSS 里不另写一份。分隔线读屏名（D76）同样在 `src/preview/livePreview.ts`，由 `HorizontalRuleWidget` 写入。外链（D77–D79）分两处：`↗︎` 字形在 `src/preview/livePreview.ts` 的 `LinkMarkWidget`（D77；M145 起同一个 widget 也出 `→`，D80），两条失败提示是 `src-tauri/src/commands.rs` 的 `open_external_url` 返回的错误信封 message（D78 拒绝 / D79 系统调用失败），前端 toast 直接透传——文案在 Rust 侧是因为判定也在那一侧。连接形态矩阵补全（M145，D80–D83）：应用内标记 `→` 与 `↗︎` 同在一个 widget（`LinkMarkWidget`，字形由链接类别决定）；「链接目标不存在」（D81）与「暂不支持锚点跳转」（D82）写在 `src/main.ts` 的 `followNoteLink` / `followLink`；「打不开这个目标」（D83）是 `src-tauri/src/commands.rs` 的 `link_open_path` 返回的错误信封 message（原因片段同为该函数产出），前端 toast 透传。`link_open_path` 里 `fs_io::resolve_in_vault` 的 fs 类错误（如「文件不存在：{路径}」）按 D19 通用错误形态透传，不另立条目。外链标记用字形而非文案的理由（每条链接都跟一句「在新窗口打开」会把正文淹掉），是本条不适用「文案必须有可读出口」通例的例外依据：URL 经链接的 `title` 属性对悬停与读屏可取。

另记一条**非可见文案**的改名（不进编号）：M144 把命令 id `wikilink.follow` 更名为 `link.follow`（命令跟随的已经是链接本身，不再只管 wikilink）。`[keys]` 配置里引用旧 id 会按既有口径走「未知命令」warning 并忽略该条——不是用户可见文案，但配置层面的影响记在这里，避免只在代码里留痕。

轻量大纲（D84–D87）的文案在 `src/toc.ts`：D84 是空标题文档的 toast（命令入口在 `src/main.ts`，toast 本体在装配层，文案串随能力模块走）；D85 是浮层 listbox 的 `aria-label`；D86 是浮层底部提示；D87 是 masthead 位置指示段（`shell.ts` 建的 `.masthead-section` 按钮）的 `title`。标题链的分隔符 `›` 是纯排版分隔（不承载语义，也不是可读出口），因此不进编号——位置指示段的读屏名就是标题链本身。M160 未新增条目：只有 D86 的串变长，仍由 `src/toc.ts` 的 `POPOVER_HINT` 一处持有（前缀 `↑↓ ⌃N⌃P`），提示宽度经元素基线实测仍单行。

启动恢复进行态（D95）的文案在 `src/main.ts` 的 `RESTORING_NOTICE`：`refreshVaultStatus()` 在 `VaultStatus.restore_pending === true` 时把它交给 `tree.showEmpty()`（`src/tree.ts` 的 notice 行，与 D7 同一个落点），恢复终态到达后由下一次拉取覆盖——树空态的几何与 D5/D6 完全同一份布局，因此不新增视觉基线。

多 vault 切换器（D96–D110）的文案分四处，与「能力在哪文案就在哪」的既有口径一致：D96 是树头部入口的 `title` 与 `aria-label`，在 `src/tree.ts`（入口 DOM 归它）；D97–D104、D108 与切换拦截提示 D109 及其三条动作 D110 在 `src/vault-switcher.ts`（浮层渲染、行摘要与相对时间、跳过计数提示、切换流程的门与闸——判据经 `VaultSwitchGateDeps.block()` 取自 `src/save-controller.ts` 的 `vaultSwitchBlock()`，提示与出口摆在拦下它的地方）；D105–D107 在 `src/main.ts`（重定位的两种拒绝、空 vault 引导——它们要的是「当前 vault 根 / 本次列表快照 / 编辑器覆盖层」这些只有装配层才有的上下文）。行摘要里的相对时间档（D100）由 `src/vault-switcher.ts` 的 `relativeTime()` 一处生成，测试场景与实现读的是同一份；`{名称}` 一律取路径 basename（`src/tree.ts` 的 `baseName()` 是全前端唯一一份派生，列表行的名字则由后端 `vault_list` 给出，前端不重复派生）。**未进 deck 的 mock 文案**（`demo/multi-vault.html` 的 V5/V10/V11/V12/V13/V15_saved/V17/V18/V19）：V10 的两拍过渡态与本 change 的非目标一致（同步打开路径下行内进度不可见，不做）；V11/V12 的「已加入」提示与 V13 的恢复提示默认不发（切换是用户主动动作，整窗换上下文本身已是可见结果，口径 7）；**V15_saved（「已保存 {n} 个标签」，保存并切换成功后的留痕）同样不发**——「保存并切换」逐标签走既有保存链路，每个落盘的标签各自已经给出「已保存」（D15 口径的 toast），再补一条汇总既重复又会与逐标签提示争同一块浮条位置（M163 r1 P2-4）；V5「还没有 vault」不可达（装载成功即意味着注册表里至少有当前项，列表读失败走 D19 通用错误）；V17/V18 是 mock 对系统目录选择器的示意，不是产品 UI；V19 的「重新定位」预告由系统目录选择器承担（点「重新定位…」直接弹选择器，预告反而落在模态之后不可见）。
