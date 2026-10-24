# Proposal: UI 打磨批（滚动条 / 全屏钮锚点 / 全屏内容居中 / 只读锁图标）

- Change ID: `ui-polish-batch-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**需求已由 Alex 裁决，提案文本未单独送审**（2026-10-24，回填自 mission
> M660 Context 的逐字原话）。四条需求逐字来自 Alex 2026-10-24 的 dogfood 反馈（#1 滚动条遮挡移除钮 /
> #4 harness 表格全屏钮太远 / #5 窄代码块全屏靠左 / #7 只读标签区分度不够）；tower 据此立项、同批
> 实现，**无独立的提案评审回执**——本 change 的「不做什么」面 Alex 未在实现前单独过目，节点 2 一并看。
> 反馈截图只存在于会话目录（含真实 vault 内容，按信息卫生纪律不入 git），本提案与全部制品只用合成
> fixture 描述。
> 节点 2（归档评审）：实现完成后填写。

## Why

Alex 2026-10-24 四条 dogfood 反馈（原话）：

1. 「vault switch 的滚动条遮挡了移除 vault 按钮，按照我们的设计约定，滚动条有设计规则，请你修改。」
2. 「harness pane 里的 table 的全屏查看按钮距离 table 太远了，不容易看到。」
3. 「全屏查看 code block 时，如果 code block 比较窄，会靠左显示。不好看，是否能居中？」
4. 「⌘P 快速打开 vault 外路径时，现在 TAB 上显示 read-only，但区分度不够，是否有其他图像化表达，
   比如 TAB 上能改为一个小图标或者表达只读的图形吗？」

四条都不是新能力，是既有表面的形态缺陷；共同根因是**呈现层没有把设计规则落到底**：

- 滚动条：`ui-design-system` 的「阅读面横向滚动条」已给出细条 / 隐藏两档，但 vault 切换浮层的
  列表一直走系统默认条——overlay 形态下粗条压在行尾移除钮上（Alex 截图）。2026-10-24 tower 复核
  M658 滚动条盘点报告时发现同批另两处浮层列表有同款缺陷（右缘 0~6px 留白 + 逐行常驻钮，粗条压住
  或半遮删除钮）：harness 会话浮层 `.lumir-hp-sesspop-list` 与权限规则段 `.lumir-hp-permpop-rules`，
  一并收口。
- 全屏钮：harness 面板的块级 slot 是满宽块容器，而 `<table>` 按内容自然宽收紧；钮钉在 slot 的
  `right: 6px`，窄表时钮与表之间隔着一整段空白（几何实测 318px）。content pane 的钮锚在**块可视盒**
  上是既有裁决（`table-fullscreen-view` 的 D3），面板侧漏掉了同一条口径。
- 全屏内容：代码块浮层的内容容器是 `width: max-content`，窄块时贴左、右侧留一整片空白；
  居中只需让块吃掉两侧余量，宽块行为不变。
- 只读标记：纯文字后缀「· 只读」与文件名同色同字号，扫读时区分度不足；设计语言里已有
  `.ft-vault-caret` / 目录 caret 这类 10px 细线 SVG，图形化表达不需要新 token。

## What Changes

| 切片 | 用户可见行为 | spec 增量 |
|---|---|---|
| U1 浮层列表滚动条 | vault 切换浮层、harness 会话浮层、权限规则段三处列表归隐藏档（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`，三处共用一份声明）；任何内容长度下滚动条都不压行尾移除 / 删除钮 | 修改「阅读面横向滚动条」（`ui-design-system`） |
| U2 harness 表格全屏钮 | 表格块的 slot 贴合表格自身宽度（上限 = 面板正文宽），钮落回表格右上角内侧 6px；代码块 slot 仍满宽 | 新增「面板块级全屏钮的锚点」（`harness`） |
| U3 全屏代码块居中 | 内容窄于浮层可用宽时水平居中（两侧余量相等）；宽内容 / 折行档行为逐值不变 | 新增「全屏浮层窄内容的水平居中」（`editor-live-preview`） |
| U4 只读标签图形化 | vault 外只读标签的可见标记从「· 只读」文字换成 10×10 锁形图标（细线 SVG、`aria-hidden`、排在文件名前）；读屏名仍是「{名称}（vault 外只读）」；可见文字不再出现「只读」二字 | 新增「vault 外只读标签的可见标记」（`multi-tabs`） |
| U4 文案退场 | 可见文字后缀的文案条目 D578 零消费者，按「变更默认直接切断」从 `文案-Copy.md` 与 `src/copy-data.ts` 删除，编号不复用 | 无（文案 deck 维护，不占 capability requirement） |

### U1 · 浮层列表滚动条（三处）

`.vault-list`、`.lumir-hp-sesspop-list`、`.lumir-hp-permpop-rules` 三处列表归**隐藏档**：并入
`src/style.css` 的隐藏档共用声明组（与标签栏同一份）——`scrollbar-width: none` +
`::-webkit-scrollbar { display: none }`。三处共同形态是「容器右缘 0~6px 留白 + 逐行常驻钮」
（✕ / × / 删除），4px 细条仍会压住钮的右缘，因此取隐藏档而非细条档；滚动能力保留（滚轮 /
触控板 / 键盘游标 / 程序化对齐），只是不占位、不上屏。行壳与按钮不做任何内缩——也不需要
「让出 lane」：条根本不绘制。

### U2 · harness 表格全屏钮

`.lumir-hp-block-slot[data-hp-block="table"]` 取 `width: max-content; max-width: 100%`。钮的位置
公式（`top/right: 6px`）与图标字形都不变；代码块的 slot 不动（代码块底色是整行形态，满宽是正确
锚点）。这是 `add-harness-block-fullscreen` 那句「每个这类块 SHALL 在其可视盒悬停时浮现一个全屏钮」
的实现期精确化——两个 change 不冲突，本 change 只补锚点一条。

### U3 · 全屏代码块居中

`.lumir-codeblock-fs-content` 加 `margin-inline: auto`。`width: max-content` + `max-width: 100%`
的既有组合让「窄 ⇒ 两侧余量」与「宽 ⇒ 钳到 100%」自动成立；折行档的 `width: 100%` 同理。表格
全屏本就由「面板壳收缩 + 遮罩 flex 居中」承担同一视觉结果，不改。

### U4 · 只读标签图形化

`src/tabs.ts` 在文件名前插入 `<span class="tab-readonly" aria-hidden="true">` 包裹的锁形 SVG
（10×10 / viewBox 12×12 / 1.3px currentColor，与 `.ft-vault-caret` 同一工艺）；`aria-label` 保持
D579。样式在 `src/style.css`（`--text-2`，eink 由 token 体系覆盖）。文案 deck 删除 D578 并在
「不复用编号」清单登记。

## Non-goals

- **不动 content pane 的表格全屏钮几何**：它是既有裁决与基线的落点（M240），本次只修 harness 面板
  的锚点；content pane 的窄表观感若仍不满意，另开裁决。
- **不改滚动条的两档配方**（4px / 隐藏）本身，也不做全仓滚动面普查——普查是同期 survey 的活；
  本 change 只把上述三处「右缘有常驻钮」的浮层列表归入已裁决的隐藏档。
- **不引入新的图标 token / 色值 / 字号**：锁图标取既有 currentColor 工艺，颜色用 `--text-2`。
- **不改全屏浮层的面板宽 / 内边距 / 主题规则**：只加内容容器的水平居中。
- **不做真机手感裁决**：滚动条观感、锁图标大小、居中后的留白观感归 Alex 过目（像素基线更新是
  人肉裁决点，见 tasks）。

## Impact

- 影响的 specs：`ui-design-system`（修改一条）、`harness`（新增一条）、`editor-live-preview`（新增
  一条）、`multi-tabs`（新增一条）
- 影响的代码/系统：`src/style.css` / `src/harness-panel.css` / `src/tabs.ts` / `src/copy-data.ts` /
  `文案-Copy.md`；测试面
  `tests/visual/scenes/{mv-vault-switcher,m303-harness-panel,m347-harness-composer,m634-harness-block-fullscreen,m277-code-block-fullscreen,quick-open}.spec.ts`、
  `tests/unit/tabs.test.ts`；验收场景 17 / 62 / 106 / 223 / 226 / 229 / 230 的叙述与证据步
- 关联约束：`ui-design-system` 的两档滚动条配方（本 change 不改值，只加消费者）；「变更默认直接
  切断」（D578 零消费者即删）；视觉基线更新是人肉裁决点（`tests/visual/README.md`）
