# Design: move-harness-to-pane-chat-frame

技术设计说明。节点 1 评审以 proposal.md 为准；本文记录实现期的技术要点与行为合同细节，供实现 worker 与归档评审对账。

**术语**：composer = 对话输入区（harness 面板底部撰写、发送消息的区域）。dock = 现行骨架右栏的 harness 容器列（`--layout-dock-w`，本 change 移除）。

## 1. 设计合同与输入

- 设计合同：原型屏 4（工作中：进度 + 发送钮停止态）、屏 6（ctx% 读数在控制行 + ⓘ 气泡）、屏 7（标题栏 harness 段 + 会话浮层）、屏 8（复制消息）；标题栏 harness 段与产品标识移位见屏 1-3 骨架。**原型目录 `design/prototypes/phase2-harness-chat/` 已随 `add-harness-quote-cards` 的实现落地退役（提交 `4e011d6`）——本 change 开工前须先把上述屏位的设计合同重新落定（屏位原文见 git 历史）。**
- 行为合同：NOTES.md 第三轮决策 3/4/5 与「沿用的前两轮决策」节；ADR 0008 Decision 1/2/6。
- **实现排序硬约束**：本 change 的实现须在 `add-harness-quote-cards` 批次合并后开工（共用 `src/harness-panel.ts` / `src/harness-panel.css` / `src/copy-data.ts` / `文案-Copy.md`）。

## 2. 容器改造：dock 列移除，harness 作为 pane 内容件

- **改造面在装配层，不在面板接口**：ADR 0008 的 survey 已证实面板耦合面窄——只消费 `AppShell` 三个字段（`shell.root` / `shell.titlebar` / `titlebarIdentity.block`），编辑器依赖是窄接口 `HarnessContextSource`，面板 DOM 全自建。因此「dock 列移除 + 面板挂进 pane」不动面板内部结构，动的是装配层「把面板挂到哪」。
- **⌘⇧A 语义**：打开时——已有第二 pane 则该 pane 换成 harness（其文档标签并入另一 pane，沿用 `pane.close` 的移动口径不丢标签），无第二 pane 则自动分栏、**默认宽度比 harness:文档 pane = 1:2**（Alex 裁决，即 `pane_split_ratio` 初始 2/3 给文档侧）；再按 = 收起（toggle，回到单 pane，文档标签保持）。标题栏 toggle 钮与命令共用同一路径（既有口径）。
- **空 pane 只读条款的排除**：`pane-layout`「分栏态空 pane 不接受文本输入」的字面口径（无带路径标签 + 无未保存草稿）会把 harness pane 错抓成「空 pane」。增量里显式排除：该条款只适用于文档 pane。
- **pane 命令族对 harness pane 的语义**：`pane.close` 于 harness pane = 关闭 harness（等价 ⌘⇧A 收起）；`pane.other` 在文档 pane 与 harness pane 间切换活跃；`pane.split` 在 harness 在场时 = 无操作（上限二）。
- **dock 移除的清扫面**：`--layout-dock-w` token、`.dock-open` 机制、骨架 grid 第三列、`ui-design-system` 骨架条款中的 dock 表述。dock 出现过的整页基线按视觉门禁卫生纪律逐张核对时间戳。

## 3. 标题栏：harness 段与产品标识移位

- **harness 段**（`.h-seg`，仅 harness 在场时出现）：会话名下拉钮 + 新建会话钮，与编辑器 pane 的标签段同构。段宽**按 pane 实际宽度装配层现算、与分隔条像素对齐**——实现机制：分栏态标题栏弹性区（traffic 236 之后到窗口右缘）构造得与内容区容器**同宽**（标题栏 padding-right 归零、余量移到 toggle 钮自身的 margin；双 pane 时 toggle 隐藏、装载 spinner 绝对定位不参与分宽），两槽与 pane 挂同一份 splitRatio 的 inline flexGrow（flexBasis 0）——段边界与 pane 分隔条像素对齐因此是几何构造的必然，不是逐帧测量。原型妥协点 5 的「2:1 flex 近似、差 ~30px」不继承；doc 标签槽单 pane 的 margin-right（M257 间距）在分栏态归零（视觉间距由段的 padding-left 承担，margin 会吃掉弹性区宽度破坏对齐）。
- **会话名下拉浮层**（裁决点 1 倾向 A 口径）：只含「新建会话」动作项，不列历史会话。若裁决点 1 翻盘为 B，本节与 `harness` 的会话边界增量需重做（历史回看是独立能力）。
- **会话名**（裁决点 2 倾向 A）：首条用户消息截断（约 20 字，XML 序列化前的原始输入）；未发消息显示「新会话」；自动压缩开新逻辑会话后沿用首条消息口径重新计算。
- **产品标识块移位**：从标题栏右端移到最左 traffic 灯区内（系统按钮旁）；窄窗 <640px 版本号退 modeline 的既有条款保留、描述位置同步改。「双 pane 时产品标识块退 modeline」的右簇退让条款相应修订——标识块已不在右簇，退让对象只剩 harness toggle 钮（双 pane 时隐藏，⌘⇧A 照走）。

## 4. composer 控制行

- 自左向右：模型 chip +（提案 3 的思考 chip 挂载位）+ ctx% 读数 + 发送钮。行内空间紧（原型实测 ≈346px 刚好放下），**chip 一律 ellipsis 策略**：模型名超长截断，完整名在 hover title。
- **模型 chip**（裁决点 3 倾向 A）：列出 `[harness].providers` 已配置的 provider（闭集合 `kimi` / `deepseek` / `mock`），选择即切换当前 provider 并经 `config_set_value("harness", "provider", …)` 运行期写回（沿用 `[ui]` 既有写回通道的泛化口径，见 `harness` 的配置节条款）；切换对**下一轮**生效，进行中的轮次不打断。
- **ctx% 读数**：从 dock 顶部迁入控制行（模型 chip 之后、发送钮之前）。超阈值（默认 85%）读数高亮（pending 族）+ ⓘ 钮；ⓘ 点击展开说明气泡（向上展开、右缘对齐读数右缘——原型在 346px 窄 pane 实证过的防横向溢出形态）；**无常驻警示句**（Alex 裁决）。自动压缩行为与可见压缩标记不变。
- **一致性原则沿用**（Alex 2026-10-06）：chip 即人侧可见面——模型与用量读数对 AI 与人同源同值。

## 5. 发送与停止

- 状态机：空闲（可发送）→ 处理中（发送钮呈停止态）→ 空闲。处理中点击 = **停止本轮**：中断流式输出与工具循环。
- **Rust core 配套**：现行 Rust core 无中断 in-flight 轮次的能力，需新增「abort 当前 turn」——已流式产出的内容保留在 transcript 并标注「已停止」；待决批准项随中断收回；JSONL 如实记录中断事件。中断语义是「不再继续生成/调用工具」，不是回滚已产出内容。
- 停止后 composer 立即可继续提问（新消息开启新一轮）。

## 6. 复制消息与进度呈现

- **复制消息**：消息（用户 / agent）hover 时浮现复制钮；复制该消息的 **Markdown 源文本**（agent 消息 = 模型原始输出，用户消息 = 发送前的原始输入，均非渲染后 HTML）；成功就地将息反馈（✓ 已复制，短时消退）。沿用「色彩克制」纪律：反馈用 ok 族。
- **进度呈现**：工具循环进行中显示**不定态**进度条（无百分比——总时长运行前不可知，百分比在技术上是伪造）+ 阶段指示（当前动作一行，如「正在读取 2 篇相关笔记…」）；工具调用完成即折叠一行摘要（既有口径不变）。eink 下进度条转明度/线宽表达。

## 7. 持久化与恢复

- `harness_pane` 字段开始消费：`true` 时装载后恢复 harness pane（重新装配面板本体）；**会话内容不持久化**（内存态、重启清空——探针期口径不变），恢复出的 harness pane 是空会话。
- `pane_split_ratio` 沿用：harness 在场时分隔条拖拽松手照常落盘；自动分栏的首开默认 1:2（文档:harness = 2:1）只在无存储值时生效。
- 无 `harness_pane` 字段的旧版会话文件按 `false` 解释（读取侧兼容，与 panes 字段同口径）。

## 8. 验收面（机器判定锚点）

- **真机验收**：⌘⇧A 自动分栏打开 harness（默认 1:2 比）/ 再按收起不丢标签 / harness_pane 随 vault 往返恢复（空会话）/ ctx% 读数在控制行 + 超阈值 ⓘ 气泡 / 发送-停止两态（mock provider 长流中断）/ 复制消息（clipboard 断言）/ 模型 chip 切换写回 config。既有 dock 相关场景全部改写为 pane 口径。
- **视觉**：骨架（dock 移除）、标题栏（harness 段、产品标识移位）、控制行、进度态均为基线失效面——按「实现收敛后批次末一次性重建 + Alex 逐张过目」纪律；dock 元素出现过的整页基线逐张核对时间戳（视觉门禁卫生）。
- **门禁**：`scripts/gate.sh quick` + `visual` 档；openspec validate --all --strict。

## 9. 屏位设计合同附节（原型 git 历史落定，HP1 task 1）

原型目录 `design/prototypes/phase2-harness-chat/` 已退役（提交 `4e011d6`）。本节从 `git show 4e011d6^:design/prototypes/phase2-harness-chat/`（NOTES.md 第五轮 + index.html + shots/）提取屏 1-4/6-8 的尺寸、形态与退让条款要点，作为本 change 的实现合同；不恢复原型目录本身。除注明「不继承」者外，以下条款照收。

### 屏 1 — 单 pane 骨架（dock 移除后默认态）

- 骨架回到两列（侧栏 + 正文），**无 dock 预留列**；零 agent 痕迹：标题栏只有 traffic 灯区、标签段、右端 harness toggle 钮；harness 段（.h-seg）不出现。
- **产品标识块在 traffic 灯区内**（三颗系统按钮之后）：产品名 + 版本号同行（原型 `.tb-identity`，形如「Lumir 0.2.0」）。标题栏右端原位置只剩 toggle 钮。
- toggle 钮形态：30×28、右缘 margin-right sp-3、aria-pressed 两态（pressed = tint 底）。
- 标签段在标题栏内（既有形态不动）；空态 hidden 时 toggle 仍钉右端。

### 屏 2 — 双 pane 等宽（文档 | 文档）

- 两 pane 等宽，标题栏内两个标签段（pane B 段在 pane A 段之后，split 时现建——既有口径）。
- 双 pane 右簇退让条款（修订后）：**harness toggle 钮隐藏**（标题栏腾给两标签段按比分宽）；产品标识块已挪 traffic 区、**不再退 modeline**；⌘⇧A 命令路径不受影响。原型截图里 toggle 仍在场是裁决前摆拍，不继承。

### 屏 3 — 分隔条拖动态（62/38）

- pane-editor 被拖到 62%（flex 0 0 62%）；抓柄 4px accent 线 + grip 35% 不透明度；分隔条 hit area 5px。拖拽手感归实现期（既有 divider 控制器承担），本屏只确认比例可拖、标签段与 pane 同比跟随。

### 屏 4 — harness 入旁侧 pane（工作中）

- **harness:pane#1 = 1:2**（pane-editor flex 2 1 0；Alex 裁决，沿用前两轮决策）——文档仍是主 pane。
- 标题栏 harness 段（.h-seg）随 harness 在场出现：flex 1 1 0、min-width 0、gap sp-2、padding-left sp-3；与标签段 2:1 分宽是**原型近似**（妥协点 5：像素差 ~30px），实现期装配层按 pane 实际宽度现算段宽、与分隔条像素对齐（design §3）。
- harness pane 本体**无头部栏**——会话身份与新会话钮上移标题栏；上下文用量读数下移 composer 控制行。
- 工作中态：不定态进度条 + 阶段指示一行（当前动作，如「正在读取 2 篇相关笔记…」）；发送钮 = 停止态（stop glyph + 脉冲环，读屏名/悬停换「停止当前回合」）。进度与发送的完整合同归 design §4/§5（后续 HP mission 实现），本批只钉「harness 在场时这些表面出现在 pane 内、头部栏不存在」。

### 屏 6 — ctx% 读数在 composer 控制行

- 读数位置：composer 控制行内、模型 chip 之后、发送钮之前（h-usage：24px 高、mono fs-label、pct text-2）。
- 高用量（原型摆拍 86%）：pct 转 pending 色 + fw-semibold，百分比后出 ⓘ 钮（16px 圆钮）。
- 说明气泡：向上展开（bottom: calc(100% + 6px)）、**右缘对齐读数右缘**（right: 0，防窄 pane 横向溢出，原型 346px 实证）、宽 224px、shadow-raise、瞬态（hover/focus 才出现）。遮 transcript 末条消息可接受（妥协点 6：瞬态覆盖层）。
- **无常驻警示句**（Alex 裁决）。行内空间紧（模型 + 思考 + ctx + 发送 ≈346px 刚好），chip 一律 ellipsis、完整名 hover title（M347 实现，本批钉位置合同）。

### 屏 7 — 会话浮层（节点 1 裁决后口径）

- 浮层从标题栏 harness 段的**会话名下拉**展开：absolute、top 30px、left sp-3、宽 264px、r8、shadow-raise，压在 pane 之上（瞬态）。
- **浮层只含「新建会话」一个动作项**（Alex 节点 1：只做新建会话，不做历史列表）——原型里的「最近会话」列表与逐条历史项是裁决前形态，**不继承**。新建会话两入口一个语义：harness 段常驻 ＋钮 + 会话名下拉浮层内的动作项。
- 会话名钮形态：26px 高、r5、fs-meta、fw-medium、max-width 190px、超长 ellipsis；会话名 + chevron。「＋新会话」钮：24px 高、r4、fs-meta、text-3、＋ icon。

### 屏 8 — 复制消息

- 消息（用户 / agent）hover 浮现复制钮（msg hover → 钮 opacity 0→1，钮自身 hover 加深）；点击复制该消息 Markdown 源文本，copied 态 = ok 色 + 就地淡出。色彩克制：反馈只走 ok 族。实现归 M347/M348，本批钉 hover 浮现 + 就地反馈的合同。

### 跨屏沿用条款（前两轮决策，未动摇）

- harness 默认宽 1:2；agent 进度不定态、无百分比；思考程度三裸档位无释义；处理中发送钮 = 停止；模型选择放 composer 控制行；消息流 document 式平铺、用户消息描边卡片、工具调用完成即折叠一行摘要；会话内容不持久化（harness_pane 只记在场与否）。
- **会话名口径**：会话名 = 首条用户消息截断约 20 字（XML 序列化前的原始输入，卡片与问题交错的序列化文本不作名）；未发消息显示「新会话」；自动压缩开新逻辑会话后按同口径重算（design §3）。
- **空 pane 只读条款排除 harness pane**：「分栏态空 pane 不接受文本输入」只适用文档 pane——harness pane 的 composer 是文本输入的合法落点（design §2）。
