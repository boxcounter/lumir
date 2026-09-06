# 文案 Copy Deck：Lumir v2

状态：M57 定稿草案。本文是产品可见文案 source of truth。
编号规则：D1 起连续编号；新增条目只追加，不复用已删除编号。旧版编号不强制保持，以本版重新编排。
角色：作者（单一角色）。每条包含位置、角色、中文、English、设计意图五要素。

| 编号 | 位置 | 角色 | 中文 | English | 设计意图 |
| --- | --- | --- | --- | --- | --- |
| D1 | masthead vault 字段 | 作者 | 未打开 vault | No vault open | 诚实表达尚未选择工作空间，不伪装为空文件夹。 |
| D2 | masthead Thread 字段 | 作者 | 无当前 Thread | No current Thread | 目录与意图空间分离，当前无意图时保持安静。 |
| D3 | masthead 状态字段 | 作者 | — | — | 无状态时不制造信息。 |
| D4 | 树头部切换按钮 | 作者 | 切换 | Switch | 让低频 vault 切换可发现但不抢主导航注意力。 |
| D5 | 树空态说明 | 作者 | 打开一个目录作为 vault，开始浏览全部文件。 | Open a folder as a vault to start browsing all its files. | 首次使用同时给出动作与收益。 |
| D6 | 树空态按钮 | 作者 | 打开 vault | Open vault | 提供唯一明确入口。 |
| D7 | 树恢复失败 notice | 作者 | 〔后端透传原因〕 | [Backend-provided reason] | 区分恢复失败与数据丢失，不掩盖原因。 |
| D8 | Threads 标题 | 作者 | Threads | Threads | 标示意图空间，与目录事实空间并列。 |
| D9 | Threads 创建入口 | 作者 | + 新建 | + New | 低成本开始一个意图。 |
| D10 | Thread 命名输入 | 作者 | Thread 名称 | Thread name | 输入提示明确命名对象，不替用户编造标题。 |
| D11 | Thread 创建提交 | 作者 | 创建 | Create | 命名后显式确认创建。 |
| D12 | Threads 空态 | 作者 | 还没有 Thread。创建一个意图，开始工作。 | No threads yet. Create an intention to begin. | 空态诚实，同时给出下一步。 |
| D13 | Thread active 状态 | 作者 | 进行中 | Active | 表达当前仍在推进。 |
| D14 | Thread paused 状态/动作 | 作者 | 暂停 | Pause | 非破坏性状态即时切换。 |
| D15 | Thread completed 状态/动作 | 作者 | 完成 | Complete | 明确工作已结束。 |
| D16 | Thread archived 状态/动作 | 作者 | 归档 | Archive | 归档改变可见性，操作前需要确认。 |
| D17 | 归档确认 | 作者 | 确认将 Thread 状态改为归档？ | Archive this thread? | 对不可逆感更强的动作保留最后确认。 |
| D18 | Thread 最近活动 | 作者 | 最近活动：{时间} | Recent activity: {time} | 提供新鲜度，不渲染虚假的编辑点计数。 |
| D19 | toast 通用错误 | 作者 | {原因} | {reason} | 透传人话原因，避免技术堆栈污染工作流。 |
| D20 | toast 标题缺失 | 作者 | 标题未找到：{标题} | Heading not found: {heading} | 说明跳转目标缺失而非打开失败。 |
| D21 | toast 未创建链接 | 作者 | 未创建的链接：{原文} | Link not created yet: {raw} | 把待创建链接描述为事实而非错误。 |
| D22 | toast 创建成功 | 作者 | 已创建：{路径} | Created: {path} | 给出动作完成及落地位置。 |
| D23 | panel 唤出 | 作者 | 显示面板 | Show panel | 快捷键唤出上下文面板时提供可理解命名。 |
| D24 | panel 空态 | 作者 | 面板（后续波次） | Panel (later waves) | 默认隐藏面板，出现时也不伪造内容。 |
| D25 | 二进制覆盖层 | 作者 | 暂不支持预览：{路径} | Preview not supported yet: {path} | 明确能力边界并保留路径。 |
| D26 | 主题入口 | 作者 | 亮 / 暗 / eink | Light / Dark / eink | 允许环境适配；eink 保留技术名称以避免误译。 |
| D27 | Thread 创建取消 | 作者 | 取消 | Cancel | 允许作者退出命名而不产生空 Thread。 |
| D28 | Thread 持久化提示 | 作者 | Thread 已保存 | Thread saved | Thread 使用 vault 持久化存储，创建和状态更新均可在重启后恢复。 |
| D29 | Thread 创建 toast | 作者 | 已创建 Thread：{名称} | Thread created: {title} | 只在会话模型成功加入卡片后确认创建。 |
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

D30 已合并入 D18；D30 编号停用，不复用。

## 文案实现备注

`src/threads.ts` 的 `COPY` 集中 Threads 标题、创建入口、输入 placeholder 与空态。树、编辑器、toast 的动态错误由 `src/tree.ts` / `src/main.ts` 持有或透传；本 deck 收编其稳定可见部分。M56 接入后 Thread 数据与引用计数不得新增虚假文案。
