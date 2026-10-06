# Design: harness-pane-visual-fidelity

技术设计说明。节点 1 评审以 proposal.md 为准；本文记录实现期的技术要点与视觉合同细节，供实现 worker 与归档评审对账。

**术语**：composer = 对话输入区。transcript = 消息流区。who/when 行 = 消息顶部「角色 · 相对时间」meta 行（原型 `.who` / `.when`）。原型 = 已退役的 `design/prototypes/phase2-harness-chat/index.html`（退役提交 `4e011d6`，屏位原文经 `git show 4e011d6^:…` 提取，提取产物在 /tmp 不入库）。

## 1. 根因与本 change 的位置

- 原型退役（`4e011d6`）时合同只提取了行为与骨架（`move-harness-to-pane-chat-frame` design §9 是骨架/标题栏面），**消息区与 composer 的视觉细节没有进任何合同**——实现继承了旧 dock 面板的样式，四轮评审按合同核验，无人抓观感。
- 流程沉淀（M352，`docs/process/openspec-workflow.md`）：凡有原型的 change，design 必须含「视觉保真」节。本 change 是首个执行者，§2 即该节。
- 验收口径（Alex 采纳）：**观感一致 + 并排截图核对，不追求逐像素**。候选基线的三联图（原型截图 / 旧基线 / 新实现）交 Alex 过目后才允许入库。

## 2. 视觉保真（逐屏提取，规则首个执行者）

提取源：`git show 4e011d6^:design/prototypes/phase2-harness-chat/index.html`（1854 行，自包含）。harness pane 相关屏位：屏 4（工作中）、屏 5（摘录卡片）、屏 6（ctx 高用量）、屏 7（会话浮层）、屏 8（复制消息）、屏 9（思考过程，归提案 3）、屏 10（思考程度，归提案 3）。本节只提取本 change 范围内的面；**除注明「不继承」者外，以下条款照收**。

### 2.1 transcript 布局节奏（屏 4-10 共用）

| 项 | 原型值 | 现状 | 处置 |
|---|---|---|---|
| 容器 | flex column，gap sp-4(8px)，padding sp-4 sp-4 sp-2 | gap sp-4，padding sp-4 | 对齐原型（底 padding 改 sp-2） |
| 字号 / 行高 | fs-ui(13px) / lh-ui(1.5) | 同 | 不动 |
| 消息间距 | 由容器 gap 承担，消息自身无 margin | 同 | 不动 |

### 2.2 消息结构（屏 4/5/6/8/9）

原型每条消息是 `.msg`：`.who` meta 行 + `.body` 内容体，用户消息加 `.user` 修饰。**现状没有 who/when 行，用户消息的气泡样式直接挂在消息元素上**——这是「像 demo」的主要观感来源之一。

- **who 行**（`.who`）：flex、gap sp-3、margin-bottom sp-1(2px)、**fs-micro(10.5px)、fw-semibold、letter-spacing 0.05em、text-3**。角色名（你 / Agent）与相对时间同行。
- **when**（`.when`，who 行内 span）：fw-regular、letter-spacing 0、文本带间隔号前缀（「· 12 秒前」）。
- **用户消息 body**：padding sp-3 sp-4、content-bg 底、1px border-soft 边、**r6 圆角、正文色 text-2**（比 agent 正文降一档——原型有意区分，不是遗漏）；保留 pre-wrap / break-word。
- **agent 消息 body**：平铺无气泡，正文色 text；Markdown 块节奏沿用现状（h1-h6 阶梯、段落 sp-2、列表 sp-9 缩进、引用 2px 左边线、代码块 --code-bg 浅底 + r6）——该组样式现状已与原型同构，不动。
- **摘录引用卡片**（屏 5，`.qcard`）：M343 已按原型实现（3px 竖条 + ≤2 行摘录 + 出处行），本 change 只随 body 包裹层调整选择器，样式不动。
- **复制钮**（屏 8，`.copy-btn`）：hover 浮现在**消息右上角（与 who 行同高）**，现状同构（absolute top 0 right 0）；高度 20px、fs-micro、text-3、hover 加深、copied 走 ok 族——现状已同构，不动。

### 2.3 相对时间分档（原型实例值反推）

原型出现的值：刚刚 / 12 秒前 / 40 秒前 / 1 分钟前 / 2 分钟前 / 3 分钟前 / 昨天。分档口径（裁决点 2 倾向）：**<10s 刚刚；<60s N 秒前；<60min N 分钟前；<24h N 小时前；否则昨天**（会话是内存态、重启清空，更老的值实际上不出现，「昨天」已是兜底）。数据机制见 §4。

### 2.4 工具调用区（屏 4，`.tools`）——Alex 2026-10-06 已裁：还原清单形态

原型形态（屏 4 原文）：上下 hairline（border-soft）夹出的区块（margin sp-2 0 0、padding sp-2 0），挂在 agent 消息内（body 之后）；步骤行 24px 高、fs-meta、flex gap sp-3：

- **完成行**（`.tool-row.done`）：✓ SVG 图标（11px，stroke 1.6）转 **ok 色**，文本 text-2；文件名引用走 mono fs-label-s（`.file-ref`）。
- **运行中行**（`.tool-row.running`）：6px `--run` 色脉冲圆点（`h-pulse` 呼吸），文本升回 text 色。
- **待定行**（`.tool-row.pending`）：6px 空心圆（1.3px border text-3），text-3——**不实现**：后端 `tool_call` 事件只有 started/done 两态，无 pending 事件源（原型是静态摆拍）。
- **tool-meta 行**（阶段「调用工具中」+「已进行 12 秒」+ 不定态细条）——**不继承**（有意偏差）：阶段指示与不定态进度由 M347 已评审的进度条区（stageLine D381/D382 + 不定态条）承担，「已进行 N 秒」属重复造读数；清单本体还原后该区信息已够。

完成收尾（原型屏 6 形态）：轮次结束后块折叠为一行摘要钮 `.tool-summary`（9px chevron + 「4 个工具调用 · 全部完成」，fs-meta、text-3、hover 升 text），点击展开回看全部步骤行。**折叠阈值 ≥2 行**（原型只演示了 4 行折叠；单行块折叠成「1 个工具调用 · 全部完成」反而把唯一信息藏起来，单行保持展开——原型「多条目可折叠」注释与之一致）。

落点（§3.3）：现状 `.lumir-hp-tool` 独立行改为块结构，started/done 事件逐步挂行；行文案沿用 D343/D344（真机场景 71/72/77 的 AX 断言锚这两份文案，单行不折叠则断言不动；场景 75 两行折叠，改「展开后断言」）。脉冲色消费 `--run`（三主题均已定义，§2.7 更早期「无此 token」的判断作废）。

### 2.5 composer（屏 4-10 共用，`.h-composer` / `.h-box` / `.h-ctl`）

现状是「裸行」：composer 自己带边框、发送钮是文字钮、控制件与输入框平铺在一行——与原型差距最大的面。

| 项 | 原型值 | 处置 |
|---|---|---|
| 外区 `.h-composer` | border-top 1px border、padding sp-3 sp-4 sp-4、margin-top sp-2 | 继承（现状 composer-row 已是 border-top + 近似 padding） |
| 卡片容器 `.h-box` | content-bg、1px border、**r8 圆角**、focus-within 出 accent 边（eink：border 色 + 1.6px 线宽） | **新增**——composer 与控制行都收进容器 |
| 输入区 | 无边框无底色（容器承担边框）、padding sp-3 sp-4 sp-1、max-height 150px | composer 去掉自身 border/bg/radius，padding 对齐 |
| 控制行 `.h-ctl` | 在容器底、flex、align-items center、gap sp-2、padding sp-1 sp-2 sp-2 | **新增**——[模型 chip][ctx 读数][spacer][发送钮] |
| 模型 chip `.ctl-chip` | **无边框**、24px 高、r5、fs-label-s(11.5px)、text-2、hover 给 hover 底；图标 + 名 + chevron | 现状是 26px 带 border-soft 边框——改原型形态（chevron 用 aria-hidden glyph，同会话名钮 `.schev` 先例） |
| ctx 读数 `.h-usage` | 24px 高、mono、fs-label(11px)、text-3，数值档 text-2；高用量：数值 pending 色 + fw-semibold + ⓘ 16px 圆钮 | 对齐（现状 fs-label-s / 无数值分档色） |
| ⓘ 气泡 `.ctx-tip` | 向上展开、右缘对齐、224px、shadow-raise | 现状已同构（240px——改 224px 对齐原型） |
| 发送钮 `.h-send` | **26×26、r6、accent-fill 实心、白 glyph**：空闲 = ↑（arrow-up），处理中 = ■（stop）+ 脉冲环（accent-tint box-shadow 呼吸） | 现状是文字钮「发送/停止」——改图标形态（裁决点 3）；D329/D378 退为 title/aria-label。脉冲环继承（eink 下 tint 为 transparent，环不可见——glyph 本身承担状态，可接受，不另造表达） |
| 思考程度 chip / 浮层（屏 10） | — | **不继承**：归提案 3（在途） |
| 开发者预览（屏 5 XML 预览） | — | **不继承**：原型标注「仅原型调试用途，不进产品」 |

### 2.6 标题栏 harness 段与会话浮层（屏 7）

段与浮层的形态 M346 已按原型实现（26px 会话名钮 r5 / 24px 新建钮 r4 / 浮层 r8 + shadow-raise）。本 change 只动**结构**（浮层挪出 button，§5）与一处尺寸：浮层宽 200px → 原型 264px 是「列历史会话」形态的宽度，节点 1 裁决后浮层只有「新建会话」一项，200px 保持（不继承 264px）。

### 2.7 跨屏不继承清单（本 change 明确不做的）

- 屏 9 思考过程（`.think`）、屏 10 思考程度（`.ctl-pop` / eff-item）——归提案 3。
- 屏 7 会话历史列表——节点 1 已裁。
- accent 去蓝后的中性建议值——独立 change；本 change 一切取值经 var() 消费现行 token。
- 原型 accent 色系的 `--run`（运行中脉冲色）——**已核：现行 token 表有 `--run`**（light/dark/eink 三主题均定义，style.css），工具区脉冲点直接消费（§2.4）。

## 3. DOM 重构

### 3.1 消息结构

```
.lumir-hp-msg(.lumir-hp-msg-user | .lumir-hp-msg-assistant)   position: relative（复制钮包含块，不变）
  .lumir-hp-who    角色文本节点 + .lumir-hp-when span（data-ts = 上屏时间戳 ms；无戳时 span 不建）
  .lumir-hp-body   内容体（用户：气泡样式挂这里；agent：Markdown 渲染目标）
  .lumir-hp-copy   hover 复制钮（不变）
  .lumir-hp-stopped 中断徽标（不变，agent 专有）
```

- 气泡样式从 `.lumir-hp-msg-user` 移到 `.lumir-hp-msg-user > .lumir-hp-body`；消息类名留在包裹元素上（验收场景与视觉场景的既有选择器不受 DOM 加深影响——它们按类名找元素不按层级）。
- Markdown 节奏选择器从 `.lumir-hp-msg-assistant …` 改 `.lumir-hp-msg-assistant .lumir-hp-body …`；流式渲染的 `.lumir-hp-md-final` / `.lumir-hp-md-tail` 改挂 body 内。`finalizeStreamingMessage` 的 `replaceChildren` 改作用于 body（who 行不再被定稿重渲抹掉）。
- 快照恢复路径同样建 who 行（无 data-ts → 无 when 文本）。

### 3.2 composer 结构

```
.lumir-hp-composer-area   border-top hairline + padding（原 composer-row 的外区职责）
  .lumir-hp-composer-box  圆角卡片容器（.h-box 同构；focus-within accent）
    .lumir-hp-composer    contenteditable（去自身边框；内部 qcard/qpara 结构不变）
    .lumir-hp-ctl         控制行
      .lumir-hp-modelwrap position: relative（浮层包含块；a11y 修复，§5）
        .lumir-hp-model   模型 chip（无边框小标签 + chevron）
        .lumir-hp-modelpop role=menu
      .lumir-hp-ctxwrap   ctx 读数 + ⓘ + 气泡（结构不变）
      .lumir-hp-ctl-spacer flex:1
      .lumir-hp-send      图标发送钮（内嵌两个 SVG glyph，按相位显隐）
```

- 上下文 chip（`.lumir-hp-chip`，输入区上方的「发送前可核对」条）与进度条（`.lumir-hp-progress`）位置不变（transcript 与 composer-area 之间）。
- 发送钮 glyph：↑ = `M7 11.5v-9M3.5 6 7 2.5 10.5 6`（stroke），■ = 2,2,8,8 rx1.5 rect（fill），均取自原型 SVG、i18n-exempt；`hidden` 随相位切换。stopping 子态沿用 `:disabled`（opacity 0.45）。

### 3.3 工具调用区结构（裁决后还原，§2.4）

```
.lumir-hp-msg-assistant
  .lumir-hp-who / .lumir-hp-body（§3.1）
  .lumir-hp-tools              hairline 夹区（agent 消息内、body 之后；一轮一块）
    .lumir-hp-tool-row(.is-running | .is-done)   步骤行：.lumir-hp-tool-ic（脉冲点 / ✓ SVG）+ 文本
    .lumir-hp-tool-summary     折叠摘要钮（折叠后插在首位；chevron + D387 文本，aria-expanded）
```

- **挂点**：`tool_call` 事件到达时块挂进**当前流式 agent 消息**（无则先 `ensureStreamingMessage` 立一条——工具先于正文到达是常态）；快照恢复路径挂进最近一条 assistant 消息（`lastAssistantEl` 追踪，user 记录重置并收尾前块）。
- **行状态机**：started → 追加 running 行（脉冲点 + D343）；done → 翻**最后一行 running 行**为 done（✓ + D344），无 running 行（恢复路径 / 乱序防御）直接追加 done 行。替代现状「`lastToolEl` 单行覆盖」。
- **收尾**：`collapseTools()` 在轮次终态调用（`finalizeStreamingMessage` / 中断标注 / 新用户消息上屏前 / restore 的 user 记录与收尾各一次，幂等）：行数 ≥2 时行全部 `hidden`、首位插摘要钮（`data-count` 存行数，applyLabels 据此重渲 D387）；单行块保持展开、不设摘要。摘要钮 click 切换行 `hidden` 与 `aria-expanded`。
- **relabel**：行文本是事件时刻的消费（与消息正文同口径——已上屏内容不随语言改写，design §4 同纪律）；只有摘要钮（meta chrome）随 applyLabels 重渲。

## 4. 相对时间机制

- **打戳**：live 路径（appendUserMessage / ensureStreamingMessage）上屏时记 `Date.now()` 于 `.lumir-hp-when` 的 `data-ts`（事件流不带戳，前端打的是上屏时刻）。**快照恢复路径消费后端 `PanelMessage.ts`**（M353 已随 master 合并进本分支，UNIX 秒 ×1000；本 change 起草时该字段尚不存在、原方案是「恢复不显示」，M353 落地后按真实戳显示）；缺 `ts` / `ts=0` 的旧快照 → when span 不建，只显示角色（**不伪造读数**纪律保留为兜底）。
- **分档**：纯函数 `relativeWhenKey(nowMs, tsMs): { key: CopyKey; n?: number } | null`（导出、单测覆盖边界：9s/10s、59s/60s、59min/60min、23h/24h、未来戳 clamp 到「刚刚」）。
- **刷新**：面板挂载期间一个 30s `setInterval` 重算所有 `[data-ts]` 的文本；`attachTo(null)` 时清除。语言切换（applyLabels）走同一出口重算。30s 一档对「秒前」档有最长 30s 的滞后——可接受（meta 信息非读数；且 <60s 档的消息在一分钟内即升入「分钟前」）。不在 keypress-to-paint 路径（ADR 0002 §6）。

## 5. 浮层可访问性修复（finding 20261006-worker-hp4）

- **结构**：provider 浮层与会话浮层从 `<button>` 内挪出——chip / 会话名钮外套 `position: relative` 的 wrapper（`.lumir-hp-modelwrap` / `.lumir-hp-sessionwrap`），按钮与浮层做 wrapper 的兄弟。浮层定位坐标不变（wrapper 紧贴按钮，包含块语义等价）。
- **语义**：触发钮 `aria-haspopup="menu"` + `aria-expanded`（随开合翻）；浮层 `role="menu"`；provider 项 `role="menuitemradio"` + `aria-checked`（现状只有当前项有 aria-checked，补齐角色）；会话浮层项 `role="menuitem"`。
- **Escape**：面板级 Escape 处理器改为两段——任一浮层开着时 Escape 只收浮层（stopImmediatePropagation 等效：先判先收，不调 `togglePane`）；无浮层时才收面板。标题栏段的会话浮层同口径（段上挂 keydown）。
- **验收联动**：真机场景 90 的「选择 + 写回」判据升回行为层——AX 树点 `kimi` 浮层项，断言 chip 读屏名变为「模型：kimi（点击切换）」+ 隔离 config.json 写回（`env:` 文件断言，与场景 70 的 JSONL 断言同通道）。

## 6. 错误呈现去重

- `appendError` 维护「最后一条错误行」引用与文案：新错误文案与最后一条**逐字相同**时 SHALL 就地替换（更新原行、滚到可见），不追加新行；不同文案照常追加。`resetView` 清空引用。
- 六条堆叠的现场（finding 的 Alex 截图）是「同一行 stringify 反复追加」——去重后同一原因只剩一条，位置随新错误到来滚回视野。

## 7. 行为口径不动清单（评审对账用）

Enter 发送（⇧Enter 换行）；发送/停止两态与 stopping 幂等；模型 chip 缺 `[harness].providers` 配置隐藏；模型选择 `config_set_value` 写回、下一轮生效；工具行文案（D343/D344）与 started/done 事件配对口径；上下文 chip 与视口跳注逻辑；批准闸；压缩标记；复制源 = 源文本；会话名口径；面板开合与分栏；accent token 现状。

## 8. 验收面（机器判定锚点）

- **单元**：`relativeWhenKey` 分档边界；错误去重判据（同文案识别为纯函数或经 DOM 层单测——jsdom 不可用，纯函数面只覆盖分档；去重的 DOM 行为归视觉场景断言）。
- **视觉（chromium）**：m347 场景按新 DOM 修断言（控制行子序列、chip 文本、浮层交互与写回不变量）；**新增 m351 场景**——消息区（who/when 在场、用户气泡计算样式、agent 排版）与 composer（h-box 容器、ctl 行子序列、图标发送钮两态 glyph 显隐、focus-within 框）与工具调用区（running/done 行结构、≥2 行折叠摘要、展开回看）的结构断言 + 元素级基线；m303 / m345 等含 harness pane 的整页基线失效面按三联图纪律重建。
- **真机**：场景 90 判据升行为层（§5）；**新增场景 92**「连续点新会话幂等不报错」（依赖 M350 后端修复合并后跑）；场景 75 的「两条工具完成行」判据改「展开折叠摘要后断言」（单行场景 71/72/77 不动）；70-91 全批按新 AX 树复核（`AXButton (发送)` 等名断言经 aria-label 保持）。
- **门禁**：`scripts/gate.sh quick` + `visual` 档；openspec validate --all --strict。
