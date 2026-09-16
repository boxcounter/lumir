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

D30 已合并入 D18；D30 编号停用，不复用。D2–D3、D8–D18、D27–D29 随 Thread 特性删除（ADR 0006，2026-09-12）停用，不复用。D23–D24 随 panel 空壳清除（M124，2026-09-12）停用，不复用。D55–D62 为保存链路加固新增（M127，2026-09-12）。D63–D67 为键位查看面板新增（M133，2026-09-13）。D68–D72 为文件内搜索 panel 新增（M139，2026-09-16）。D73–D76 为 Markdown 渲染批新增（M138，2026-09-16）——表格降级归因句三种形态与分隔线读屏名。D77–D79 为外链批新增（M144，2026-09-16）——外链尾部标记与两条打开链路的失败提示。

## 文案实现备注

树、编辑器、toast 的动态错误由 `src/tree.ts` / `src/save-controller.ts` 持有或透传；本 deck 收编其稳定可见部分。保存链路的稳定文案（含守卫提示与冲突/备份动作）随 M127 的拆分集中在 `src/save-controller.ts`。键位面板（D63–D67）的文案在 `src/main.ts` 的 `createBindingsPanel` 内；面板里逐条显示的**键位来由**不是本 deck 的条目——它来自 `src/keys.ts` 键位表的 `doc` 字段（表即文档，随绑定一起维护）。搜索 panel（D68–D72）的文案在 `src/search.ts` 的 `LumirSearchPanel` 内——与键位面板把文案写在 `main.ts` 的写法并列；计数串的三态（`当前/总数`、`0/0`、`总数+`）由同文件的 `tallyLabel` 生成，deck 里的 `{当前}/{总数}` 即它的模板。表格降级归因句（D73–D75）的文案在 `src/preview/table.ts` 的 `degradationNotice`：`src/preview/livePreview.ts` 把同一句话同时写进 `aria-label` 与 `data-degraded`（单一来源），上屏文本由 `src/style.css` 的 `.cm-lp-table-degraded::after` 用 `attr(data-degraded)` 取用——读屏与视觉看到的是同一份归因，CSS 里不另写一份。分隔线读屏名（D76）同样在 `src/preview/livePreview.ts`，由 `HorizontalRuleWidget` 写入。外链（D77–D79）分两处：`↗︎` 字形在 `src/preview/livePreview.ts` 的 `ExternalLinkMarkWidget`（D77），两条失败提示是 `src-tauri/src/commands.rs` 的 `open_external_url` 返回的错误信封 message（D78 拒绝 / D79 系统调用失败），前端 toast 直接透传——文案在 Rust 侧是因为判定也在那一侧。外链标记用字形而非文案的理由（每条链接都跟一句「在新窗口打开」会把正文淹掉），是本条不适用「文案必须有可读出口」通例的例外依据：URL 经链接的 `title` 属性对悬停与读屏可取。

另记一条**非可见文案**的改名（不进编号）：M144 把命令 id `wikilink.follow` 更名为 `link.follow`（命令跟随的已经是链接本身，不再只管 wikilink）。`[keys]` 配置里引用旧 id 会按既有口径走「未知命令」warning 并忽略该条——不是用户可见文案，但配置层面的影响记在这里，避免只在代码里留痕。
