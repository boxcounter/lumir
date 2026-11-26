# Proposal: 文件树打开意图改为浏览器式，并收口无标签时的 Harness 图标落位与文案

- Change ID: `improve-file-open-harness-affordance-nov26`
- 日期: 2026-11-26
- 角色: Alex Lee（裁决），AI agent（起草与实现）

> 评审记录
> 节点 1（提案评审）：**通过**。Alex 在给出两条 affordance 的裁决时原话「其他你理解是对的，
> 请你安排」（2026-11-26），随后追加一条文案口径：图标 hover hint 用「Harness pane」，不用
> 「Chat pane」；可访问名称与相关文案真源同步，中英不漂移。本 change 的批准边界即这三条：
> ①文件树普通点击 = 在当前 TAB 打开、⌘ 点击 = 在新 TAB 打开并保留当前 TAB（浏览器式）；
> ②没有任何 TAB 时标题栏 Harness 图标贴最右端（有 TAB 时既有落位逐像素不变）；
> ③D327 的悬停提示 / 可访问名改用 Harness 措辞。三条之外不扩 scope。
> 节点 2（归档评审）：待真机场景执行 PASS 后按常规五要件通道办理。

## Why

### 现象（dogfood 现场）

1. **左栏点文件恒开新标签**：文件树点击现在一律 `openFile(..., "new")`（`src/main.ts` 的
   `tree` 装配块）。翻几个文件就攒一排标签，与用户对左栏「浏览文件」的预期不符——Alex 的
   裁决是取浏览器语义：普通点击在当前标签就地打开，⌘ 点击才新开标签并保留当前标签。
2. **无标签时 Harness 图标浮在内容区左上**：标题栏是 flex 行，`.titlebar-traffic` 定宽 =
   左栏宽（236px），`.tabstrip` 在无标签时 `hidden`（`display:none`、不占位）。于是右端的
   toggle 钮紧贴 traffic 右缘，视觉上落在 Content pane 左上角上方，而不是标题栏最右端。
   标题栏空态因此读成「内容区顶上多了一颗图标」，与「标题栏右端动作钮区」的设定不符。
3. **文案与产品定位漂移**：toggle 钮与面板的可访问名 / 悬停提示共用 D327，现值为「对话面板 /
   Chat panel」。该能力早已从「对话面板」演进为 harness pane（change
   `move-harness-to-pane-chat-frame` 起面板是 pane 内容件），hover 仍读成「Chat pane」会让
   用户把 harness 能力误读成普通聊天框。

### 为什么现在一并处理

三条都是同一块交互面（左栏打开文件 + 标题栏 Harness 入口）的 affordance 缺陷，Alex 在一次
裁决里一并批准（「其他你理解是对的，请你安排」+ hover 追加）。它们互不依赖，但共享同一批
视觉结构断言与真机场景；拆成多个 change 只会把同一次批准拆成多份台账。

## What Changes

1. **文件树打开意图按手势分流（`multi-tabs` 的「打开语义」MODIFIED）**
   - 普通点击（含双击、其它修饰键）SHALL 在活跃 pane 的**当前标签**就地打开目标文件；
     当前标签是「还没有文件的空文档」时复用它——沿用既有「就地替换 / 复用空文档」口径。
   - **例外**：当前标签有未保存修改（或当前标签是图片会话）时，普通点击退回「新开一个标签」，
     原标签与其修改原样保留、不弹拦截提示——「打开另一个文件不丢修改」是 M149 起的既有口径
     （`save-guard` 场景的判据），本次 MUST NOT 让新落点把它变成静默丢数据。
   - ⌘ 点击 SHALL 在活跃 pane **新开一个标签**并激活；当前标签 MUST 原样保留——它的文档
     内容、未保存状态与位置都不变。
   - 同一个文件已打开时仍然只产生一个标签（切换 / 移动标签），这条对两种意图不变。
   - 快速打开、文档内链接跟随、新建后自动打开、会话恢复的既有落点 MUST NOT 改变。

2. **无标签时标题栏动作钮贴右缘（`ui-design-system` ADDED）**
   - 标签栏隐藏（没有任何 TAB）时，标题栏右端动作钮区（harness toggle）SHALL 贴标题栏
     右缘：钮右缘 = 视口右缘 − 钮自身 margin-right，MUST NOT 停在左栏宽度处、压在 Content
     pane 左上角上方。
   - 有标签时既有落位 MUST NOT 改变：标签段仍弹性占满，toggle 仍紧随其后贴右缘。
   - 分栏态（toggle 因退让条款隐藏）与其它标题栏元素 MUST NOT 受影响。

3. **hover / 可访问名改 Harness 措辞（`harness` ADDED）**
   - toggle 钮的悬停提示与可访问名、面板容器的可访问名 SHALL 取同一条文案真源（D327），
     en 档逐字为「Harness pane」、zh 档为「Harness 面板」；MUST NOT 再出现「Chat pane」/
     「Chat panel」措辞。
   - 有活动状态时沿用既有口径：同一句后追加状态词（如「Harness 面板 · 处理中」/「Harness
     pane · Working」），MUST NOT 另写一句。
   - 两档语言 MUST 同步，MUST NOT 只改一档。

4. **上下文 chip 的看守补上「同一会话就地换文档」一维（实现修复，不新增行为）**
   新语义让「普通点击」走 `openFile("current")`——会话对象不变、只有 `path` 变。harness 面板
   的 chip 看守此前只比会话引用，于是 chip 会停在旧路径，违反 `harness`「上下文注入与可见性」
   的「以可核对的形式呈现当前 TAB 的路径 + 视口行范围」。本 change 把看守扩为「引用 + 路径」
   两维（见 `src/harness-panel.ts` 的 `watchActiveSession`）；这是让既有 requirement 在新路径
   下继续成立，MUST NOT 改写该 requirement 的语义。既有判据 `m303` 的「上下文 chip 随文档
   切换刷新」在未修时红、修后绿。

## Non-goals

- 不改 `openFile` 的装载、dirty 守卫、焦点链路与阅读位置恢复：本次只把文件树点击接到既有的
  `"current"` 意图，不新增 / 不削弱任何 dirty 确认。
- 不给文件树的其它修饰键（Shift / Alt / Ctrl）新增语义：它们与普通点击同义。
- 不改快速打开、文档内链接跟随、新建文件后自动打开、会话恢复的标签落点。
- 不改 Harness 面板本体、标题栏 harness 段、退让条款或分栏几何。
- 不更新视觉像素基线：本次若产生无标签标题栏的像素变化，只产出候选截图，由 Alex 过目后再
  走基线更新（人肉裁决点）。
- 不执行真机验收（本 mission 只做静态校验与场景更新；执行归后续真机批次）。

## 已知边界与风险（本 change 不处理，随报告交给 tower / Alex）

- **图片文件与二进制沿用既有落点（双向）**：`openImage` 明确没有「就地替换前台标签」这一态
  （文本会话不能改判成图片会话），因此普通点击图片仍新建图片标签；反向也不再扩张——当前标签
  是图片会话时普通点击文本会退回新开一个标签（图片会话不能改判成文本会话）。二进制仍是既有
  提示。要把图片纳入「当前标签打开」需要先给会话类型换轨能力，属另一项改动。
- **普通点击替换 dirty 标签会丢未保存内容**：`openFile` 的 `"current"` 路径只有「前台是没有
  路径的空文档」这一条 dirty 守卫；有路径的标签之间是就地换文档，没有确认。该路径早于本
  change 就存在（文档内链接跟随 / 另存为走同一条），本 change 只是让左栏普通点击也走它。
  本 change MUST NOT 新增 / 削弱 dirty 守卫（合同要求「不改变编辑器内容 / dirty 状态」指
  ⌘ 点击保留当前标签的内容与未保存状态）；风险本身登记进报告，由 Alex 裁决是否另立项。

## Impact

- 影响的 specs：`multi-tabs`（MODIFIED「打开语义」）、`vault-workspace`（MODIFIED「装载后
  恢复标签列表」——其中「固定标签语义」场景的手势改为 ⌘-点击，否则与新的普通点击语义矛盾）、
  `ui-design-system`（ADDED 标题栏动作钮贴右缘）、`harness`（ADDED toggle 钮悬停 / 可访问名）。
- 影响的代码 / 系统：`src/tree.ts`（行点击意图判定）、`src/main.ts`（树回调接线）、
  `src/harness-panel.css`（无标签时的贴右缘）、`src/copy-data.ts` 与 `文案-Copy.md`（D327，
  以及同一条命令的速查标签 D648 / 来由 D345 的措辞）；相关视觉场景与真机验收场景的断言文案。
- 关联约束：不改写源文件铁律（打开链路只读盘）、性能合同（点击路径零新增 IPC）、
  `REVIEW.md`「同一语义两处真源」条（文案仍只有 D327 一处真源）。
