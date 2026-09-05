# 文案 Copy Deck：Lumir

状态：起步版（M41 收编当前 UI 全部可见文案，随用随补）
关联：[[README]]、[[0001-product-positioning-and-boundaries]]（ADR 0001 定位与边界）、[[0003-obsidian-compatibility-scope]]（ADR 0003 兼容范围）
涉及角色：**单一角色——作者（知识创作者本人）**。依据 ADR 0001：Lumir 是自用定位的 daily driver，"作者即用户"，利基人群是"用 agent 做知识创作、拥有大量知识文件的人"。不存在 visitor / owner / subscriber 等多角色分流，因此本 deck 所有条目的角色列均为「作者」，demo 控制台不做角色视角切换维度（原因即此）。
用法：本文件是该项目所有 demo / prototype 文案的 source of truth。写 demo 先读本文件；新增或修改文案先改本文件，再同步 demo。规则详见 design-demo skill。
条目编号约定：D 开头编号（D1–D26）供 demo 批注模式引用；编号在 deck 内稳定，新增条目往后追加，不复用已删除编号。
收编范围：src/tree.ts、src/main.ts、src/shell.ts、src/preview/（livePreview.ts、attachments.ts、frontmatter.ts）中全部用户可见文案。后端 CommandError 人话文案（如「无法恢复上次的 vault」）由 Rust 侧生成、前端透传，本 deck 只登记前端持有的部分与透传占位。

## 文件树（src/tree.ts）

| 编号 | 位置 | 角色 | 中文 | English | 设计意图（该角色此时的心理状态 + 依据） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | 树头部「切换」按钮（常驻入口，含 title/aria「切换 vault」） | 作者 | 切换 | Switch | 作者在多个 vault 间移动是低频动作；常驻但弱化（小一号、灰字、无边框，hover 才反馈），消除「换 vault 要重开 app」的顾虑，又不抢文件列表的视觉权重。依据：M30 vault 切换入口裁决。 | 草稿 |
| D2 | 空态提示语（尚无 vault） | 作者 | 打开一个目录作为 vault，开始浏览全部文件。 | Open a folder as a vault to start browsing all its files. | 首次启动的作者在想「这东西从哪开始」；一句话同时给出动作（打开目录）与收益（浏览全部文件——「全部」呼应 ADR 0001 全文件类型一等公民，与 Obsidian 只显示 md 形成对照）。 | 草稿 |
| D3 | 空态「打开 vault」按钮 | 作者 | 打开 vault | Open vault | 与 D2 动作呼应的唯一 CTA；沿用 vault 一词不翻译为「库」，与 Obsidian 用户既有词汇对齐（作者日常依赖 Obsidian，ADR 0001 Context）。 | 草稿 |
| D4 | 空态 notice（last_vault 恢复失败时，后端人话透传） | 作者 | 〔后端透传，示例：无法恢复上次的 vault：目录已不存在〕 | 〔backend passthrough, e.g. Could not restore the last vault: folder no longer exists〕 | 作者上次的工作现场没了，此刻在想「我的文件还在吗」；先给人话原因再给 D2/D3 的恢复路径，消除「数据丢了」的恐慌——实际只是入口失效。前端透传 CommandError.message，不另造文案。 | 草稿 |

## 编辑器区覆盖层与浮条（src/main.ts）

| 编号 | 位置 | 角色 | 中文 | English | 设计意图（该角色此时的心理状态 + 依据） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| D5 | 编辑器区覆盖层：二进制文件提示 | 作者 | 暂不支持预览：{路径} | Preview not supported yet: {path} | 作者点开 PDF/图片等二进制，在想「坏了还是没做」；「暂」字明确这是能力边界而非故障（ADR 0003 兼容范围），带路径让作者确认点对了文件。提示而非报错弹窗（src/main.ts openFile 注释）。 | 草稿 |
| D6 | 编辑器区覆盖层：读取失败（CommandError 人话透传） | 作者 | 〔后端透传，示例：文件不是合法 UTF-8〕 | 〔backend passthrough, e.g. File is not valid UTF-8〕 | 读失败是异常情况，作者要的是原因而非堆栈；后端 CommandError 的 message 就是人话（src/main.ts:149 注释），前端原样展示，不包装。 | 草稿 |
| D7 | 浮条 toast：跟随链接后锚点缺失 | 作者 | 标题未找到：{标题} | Heading not found: {heading} | 作者点了 [[Gamma#设计]] 却落在文件顶部，在想「跳错了？」；明确告知「文件打开了、是标题没找到」，不静默停在顶部（spec §4.2）。 | 草稿 |
| D8 | 浮条 toast：点击未创建链接 | 作者 | 未创建的链接：{原文} | Link not created yet: {raw} | unresolved 不是错误（spec §4.3）——作者写 [[不存在的笔记]] 往往是先记引用后补内容；文案陈述事实不带警告色彩，并把下一步动作交给 D9。 | 草稿 |
| D9 | D8 浮条内动作按钮 | 作者 | 创建并打开 | Create & open | 一键创建入口（spec §4.4）；「并打开」预告点击后的完整结果，消除「创建了会不会找不到」的顾虑。 | 草稿 |
| D10 | 浮条 toast：点击块引用链接 | 作者 | 块引用不支持：{原文} | Block references not supported: {raw} | 作者从 Obsidian 迁来的笔记可能带 [[x#^block]]；直接声明不支持（ADR 0003 §2 划定的兼容边界），避免作者误以为解析出错。 | 草稿 |
| D11 | 浮条 toast：一键创建成功 | 作者 | 已创建：{路径} | Created: {path} | 确认动作完成并给出落地路径，作者可核对文件建在了预期的相对位置（reviewer-switcher high finding 曾修过 from 基准错位的误建问题）。 | 草稿 |

## wikilink 装饰层（src/preview/livePreview.ts）

| 编号 | 位置 | 角色 | 中文 | English | 设计意图（该角色此时的心理状态 + 依据） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| D12 | 歧义链接徽标 + 悬停候选列表 | 作者 | 歧义（悬停：同名候选：{候选路径列表}） | ambiguous (hover: Same-name candidates: {paths}) | 同名文件分布在不同目录时，作者要在跳转前知道会落到哪个；徽标 + 悬停列表让歧义「跳转前即可见」（spec §4.1），不用试错。 | 草稿 |
| D13 | 未创建链接悬停提示 | 作者 | {原文}（未创建，点击创建） | {raw} (not created — click to create) | 与 D8/D9 同一心智：悬停即预告点击结果，作者不用猜这个虚线链接能不能点。 | 草稿 |
| D14 | 正文内提示块：块引用（[[x#^block]] 原位） | 作者 | 块引用不支持 | Block references not supported | 与 D10 同边界声明，出现在正文原位（replace widget 保留原始引用文本），让作者在阅读流中直接看到哪些语法失效，而非跳转时才发现。 | 草稿 |
| D15 | 正文内提示块：附件引用未命中 | 作者 | 附件未找到 | Attachment not found | ![[x.png]] 索引未命中时原地占位、保留原文，作者能区分「引用写错」与「图片坏了」；不抛错不破图（src/main.ts:57 注释）。 | 草稿 |
| D16 | 正文内提示块：笔记内容嵌入 | 作者 | 内容嵌入不支持 | Note embed not supported | ![[note]] 嵌入是 Obsidian 特性，ADR 0003 §2 明确不做；原位声明边界，理由同 D14。 | 草稿 |
| D17 | 正文内提示块：附件读取未接线 | 作者 | 附件读取未接线 | Attachment pipeline not wired | 纯浏览器预览桩等无后端环境的降级说明；面向的仍是作者本人（自用开发场景），如实话「没接线」而非伪装成文件缺失。 | 草稿 |

## 附件渲染（src/preview/attachments.ts）

| 编号 | 位置 | 角色 | 中文 | English | 设计意图（该角色此时的心理状态 + 依据） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| D18 | 图片加载中状态行 | 作者 | 加载中… {原始引用} | Loading… {raw ref} | 大图走 invoke + base64 异步读，给作者一个「在读」的确定信号，带原始引用以便对应到具体图片。 | 草稿 |
| D19 | 图片解码失败占位 | 作者 | 图片解码失败：{原始引用} | Image decode failed: {raw ref} | 字节读到了但浏览器解不了（损坏或格式问题）；与 D20「读取失败」分开，让作者定位是文件坏了还是链路坏了。 | 草稿 |
| D20 | 图片读取失败占位 | 作者 | 图片读取失败：{原始引用}（{原因}） | Image read failed: {raw ref} ({reason}) | 原地换占位不抛错（src/preview/attachments.ts:123 注释）；括号内人话原因透传，作者可判断是权限、路径还是 IO 问题。 | 草稿 |

## frontmatter properties 区块（src/preview/frontmatter.ts）

| 编号 | 位置 | 角色 | 中文 | English | 设计意图（该角色此时的心理状态 + 依据） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| D21 | properties 区块解析失败提示 | 作者 | frontmatter 解析失败：{原因} | Frontmatter parse failed: {reason} | YAML 写错了时作者最怕「内容被吞」；回退策略是原文完整保留 + 人话提示（spec「解析失败回退」），提示只解释渲染、不暗示数据丢失。 | 草稿 |
| D22 | 空 frontmatter 占位 | 作者 | （空 frontmatter） | (empty frontmatter) | 作者留下空的 --- 对时，确认「检测到了、只是没内容」，而非渲染器静默忽略。 | 草稿 |
| D23 | 非键值结构回退提示 | 作者 | frontmatter 不是键值结构，按原文显示 | Frontmatter is not a key-value map; showing raw text | 列表或标量 frontmatter 不硬塞进 properties 表格；「按原文显示」交代了渲染决策，作者知道这是刻意回退不是 bug。 | 草稿 |

## 右侧面板（src/shell.ts、src/main.ts）

| 编号 | 位置 | 角色 | 中文 | English | 设计意图（该角色此时的心理状态 + 依据） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| D24 | 面板空占位标签 | 作者 | 面板（后续波次） | Panel (later waves) | 空 pane 的占位说明；作者即开发者本人，「后续波次」是项目内部的诚实口径，不装出已有功能。 | 草稿 |
| D25 | 配置探针正常输出 | 作者 | config: ok (mode={md\|code}) / path: {配置路径} / warning: {警告} | 〔技术探针，双语同文〕 | M1 契约链路验证探针（src/main.ts:305 注释），是现状的一部分保留在 demo 里；纯技术输出不做双语文案，双语切换时保持原样。 | 草稿 |
| D26 | 配置探针失败输出 | 作者 | config 加载失败：{原因} | Failed to load config: {reason} | 探针失败说明 invoke 链路断了；人话原因让作者（自用开发场景）直接定位是配置损坏还是后端未起。 | 草稿 |

## demo 控制台（demo/ 自身的元界面文案，非 Lumir 产品文案）

| 编号 | 位置 | 角色 | 中文 | English | 设计意图（该角色此时的心理状态 + 依据） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | 控制台标题 | 作者 | 视觉方向走查台 | Visual direction walkthrough | 表明这是给作者（兼评审者）走查用的工具，不是产品界面的一部分。 | 草稿 |
| C2 | 维度标签：视觉方向 | 作者 | 方向 | Direction | 三方向并列，作者要快速 A/B/C 对比；标签从简，名头留给方向名。 | 草稿 |
| C3 | 方向名 A/B/C | 作者 | A「纸」/ B「石墨」/ C「墨」 | A "Paper" / B "Graphite" / C "Ink" | 单字意象名承载方向气质（ADR 0001 §5「极致美」由 Alex 裁决——名字先给气质锚点，方便讨论时指代）。 | 草稿 |
| C4 | 维度标签：亮/暗（仅方向 B 可切） | 作者 | 亮 / 暗 | Light / Dark | 亮暗不是全方向通用维度：纸是纸、墨是墨，强制换底会破坏方向气质；石墨作为工具向方向才提供环境光适配。不适用的方向该控件置灰。 | 草稿 |
| C5 | 维度标签：密度（舒适/紧凑） | 作者 | 密度：舒适 / 紧凑 | Density: Comfortable / Compact | 密度独立于方向：同一气质下作者可能要写给读两种节奏。 | 草稿 |
| C6 | 维度标签：语言 | 作者 | 语言 | Language | design-demo skill 要求语言 toggle 是结构而非翻译；同时承担英文布局弹性检查入口。 | 草稿 |
| C7 | 维度标签：状态（空态/满态/长文档滚动） | 作者 | 状态：空态 / 满态 / 长文档 | State: Empty / Full / Long doc | 装饰层的问题常出在边界：空态是否塌、长文档滚动时标题与提示块是否稳定。 | 草稿 |
| C8 | 维度标签：设计批注 | 作者 | 批注 | Annotate | 批注模式把界面元素与 deck 条目编号（D/C 系列）钉在一起，走查与评审时可直接引用编号裁决。 | 草稿 |
| C9 | 角色视角维度（声明不做） | 作者 | 角色：单一角色（作者本人，ADR 0001 自用定位），无可切换 | Role: single role (the author, ADR 0001) — nothing to switch | design-demo skill 默认要求角色切换；Lumir 不涉及多角色，置灰并说明原因，避免评审者误以为遗漏。 | 草稿 |
| C10 | 设计意图说明块标题 | 作者 | 设计意图 | Design intent | 每个方向一段意图说明随切换更新，走查时先读意图再看界面。 | 草稿 |
| C11 | 演示文档来源注记 | 作者 | 正文内容：wikilink fixture Alpha.md（frontmatter 与「标题层级」一节为演示补充，fixture 原文无此两部分） | Content: wikilink fixture Alpha.md (frontmatter and the heading-level section are demo supplements — not in the original fixture) | 如实标注与 fixture 的偏差，评审时不把补充内容误认为现状。 | 草稿 |
| C12 | 方向 A 意图段落 | 作者 | 见 demo 内 COPY.directionIntents | See COPY.directionIntents in the demo | 长段落文案集中放 demo 的 COPY 对象，deck 登记条目与位置，正文以 demo 为准。 | 草稿 |
| C13 | 方向 B 意图段落 | 作者 | 同上 | Same as above | 同 C12。 | 草稿 |
| C14 | 方向 C 意图段落 | 作者 | 同上 | Same as above | 同 C12。 | 草稿 |
