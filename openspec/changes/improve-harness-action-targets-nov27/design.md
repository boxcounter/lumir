# Design: Harness 次级动作的三层尺寸与真实命中

> 本文件把 Alex 已批准的方向转成实施 / 评审合同。通用规则的唯一居所是
> [docs/specs/pointer-targets.md](../../../docs/specs/pointer-targets.md)；这里只定义 Harness 首批消费者的具体取值、
> 几何边界与证伪方式。提案阶段未做浏览器 / 真机技术验证；实施读数由本 change 的证据文件另行记录。

## 1. 范围与现状

| 表面 | 当前视觉 / 几何 | 当前显现与事件 |
|---|---|---|
| transcript 复制 `.lumir-hp-copy` | 最小宽 24、高 20；11.5px 档字符 `⧉` | 消息 hover / 按钮 focus-visible 显现；成功后 `✓ 已复制` / `✓ Copied` 约 1.5s |
| transcript 撤回 `.lumir-hp-withdraw` | 20×20 可见盒；12px 撤销 SVG，无可见文字 | 最后一条用户消息的 hover / focus-visible 显现；busy / 在途 disabled；pointer / focus 双激活源预览，tail notice 不预览 |
| composer 移除 `.lumir-hp-qc-x` | 16×16；11.5px 档 × | 恒显；`tabIndex=-1`；引用卡父表面点击会跳回原文 |
| composer 图片 @ `.lumir-hp-qc-at` | 16×16；既有 mono @ | 与 × 在动作区恒显；点击插入 `Image N`；`tabIndex=-1` |

现状来源：`src/harness-panel.css:1943-2012`、`:2247-2305`，`src/harness-panel.ts:5368-5387`、
`:5437-5460`、`:5528-5550`、`:7009-7165`。这些行号是 rebase 后基线 `b6fe012b` 的定位锚，不作为长期契约。

## 2. 三层尺寸定档

### 2.1 固定取值

| 动作 | 图标视觉层 | 可见底板层 | 实际指针命中层 |
|---|---|---|---|
| 复制 | 无依赖内联 SVG，视盒 **14×14 CSS px**；`aria-hidden`、不可独立聚焦 | 默认态保持现有 **24×20 CSS px** 紧凑配方与右上方锚点；success 按既有完整文案自然增宽 | 默认 **28×28**；success 宽度随完整文案增加，高度仍 28 |
| 撤回 | 保持既有 **12×12** 撤销 SVG；不恢复文字、不常驻 | 保持现有 **20×20 CSS px** 紧凑配方与右上方锚点 | **28×28**；与复制始终保留至少 2px 水平间隙 |
| 引用 / 消息摘录 / 图片 × | 紧凑 **14px** glyph；沿用既有 data-glyph / scoped AX 机制 | 保持现有 **16×16** 小底板、圆角、无色静止态 | **28×28** |
| 图片 @ | 既有 mono 字族、字重与视觉层级；本 change 不把 @ 视觉放大 | 保持现有 **16×16** 小底板 | **28×28**；与 × 命中盒保留至少 2px 间隙 |

任何候选的命中宽、高均不得低于 24。28 是本项目默认产品值，不冒充 W3C 标准；本 change 不采用 44。

### 2.2 实现形态

- 实际 `<button>` 的 border box 或等效透明层 MUST 承接完整命中区。首选真实按钮盒为 28×28，底板与图标作为独立的
  伪元素 / 子视觉层；不得只把 `min-width` / `height` 写在声明里而不验证最终命中。
- 底板与图标层 SHOULD `pointer-events:none`（或保证事件等价归属按钮），使透明区、图标与底板共享同一事件目标。
  composer 现有 `::before` glyph 与 hidden glyph 的 AX 分工不得被新底板层破坏。
- 不使用 JS 距离吸附，不把父卡 / 消息其余区域算进动作命中区，不新增依赖。复制 SVG 的内联标记必须保持
  `aria-label=复制消息 / Copy message` 的既有承载方式。
- 命中盒在 hover 前已稳定；显现只改 opacity / 颜色等既有视觉状态，不在 hover 时才创建 28px 盒。

## 3. 几何落位与内容保护

### 3.1 消息动作

- 复制与撤回的可见底板保持当前消息右上角色位；透明扩展优先消耗消息之间既有 16px gap 与 transcript 顶部 16px padding，
  不向消息正文生长。不得为命中区增加 who 行高、正文行高或消息间距。
- 复制命中盒与撤回命中盒在正常、hover、focus、disabled、success、zh / en 下均无正面积交集。
  **success 是显式动态几何**：复制文案从图标变为 `✓ 已复制` / `✓ Copied` 时，撤回动作层必须同步向左让位；
  反馈消退后回到默认位置。两次移动都只发生在绝对定位的动作层，文档 / 消息几何不动。
- disabled 撤回仍有稳定命中盒与既有提示，但不执行撤回；复制 success 仍显示完整反馈并自动消退，不缩短反馈来避免重叠。
- 撤回的 12px 图标、完整后果提示、pointer / focus 双激活源预览与 tail notice 整段不预览均不属于可牺牲的视觉旧态；
  命中区扩大不得绕过 `withdrawPreviewTargets()` / `updateWithdrawPreview()` 或改变其事件激活语义。

### 3.2 composer 卡片动作

- 单个 × 使用一个 28×28 动作槽；图片卡使用 @、× 两个 28×28 槽，槽间至少 2px。动作槽优先落在卡片既有右上留白内；
  需要时调整卡片水平 padding / 内容可用宽，为整个真实命中盒预留位置。
- 不得通过覆盖摘录正文、出处、缩略图可点区或其他文本区来取得命中。对候选 fixture，动作命中盒与可见文字 /
  内容 client rects MUST NOT 有正面积交集；在文本采样点做命中测试不得解析为动作按钮。
- 水平预留不得改变 composer 文档文本、精确 UTF-16 anchor、卡片块序、消息行高或选区 / history。候选若导致卡片纵向跳动、
  文本意外重排或首条 / 末条消息几何变化，必须先修几何，再送视觉候选。
- 卡片、widget 与 composer 的任何祖先裁切都计入缺陷；在卡片完整可见的稳态下，命中盒中心、四边与近角都可达。
  因用户滚动而整体离开视口的正常裁切不属于本合同要消除的场景。

## 4. 嵌套事件与键盘模型

- 引用 / 消息摘录卡：× 的整个 28×28 区域 MUST 只执行一次移除并阻止父卡 jump；中心与透明边缘同权。
  区域之外的父卡仍执行既有跳回原文 / 来源消息，父卡面积不得被当作 × 的命中区。
- 图片卡：@ 的整个区域只执行一次 `Image N` 插入；× 的整个区域只执行一次移除。两者不得互相触发，不得改变当前文本选区、
  编号反查或焦点回收语义。
- 保留现有 mousedown 差异：引用 × 的冒泡隔离、图片 @ 的 preventDefault / click 冒泡隔离及父卡 mousedown 口径，
  除非真实测试证明需要修正；任何修正都只服务事件优先级，不借本 change 重设计事件模型。
- 复制与撤回继续沿既有 Tab / focus-visible 路径；composer 卡片及 @ / × 继续 `tabIndex=-1`。不得为「可访问性」顺手把
  composer 动作加入 Tab 序，也不得改变 Enter、IME、Backspace / Delete、⌘A、⌘C 或 history 行为。

## 5. 视觉保真

本 change 没有新原型；视觉真源是 Alex 于 2026-11-27 批准的「轻量视觉 + 更大透明命中区」方向与下表。验收先做现状 /
  候选同屏或并排对照，不把机器像素 PASS 当作审美批准。

### 5.1 布局节奏

- transcript 的消息行高、正文起点、16px 消息 gap、外侧 padding 与卡片块序保持不变；动作层不占文档流。
- 复制 / 撤回仍是右上角小组件，不新增常驻动作条。composer 卡片外框、圆角、缩略图尺寸、引用竖条与纵向节奏保持不变。
- 图片 @ 在左、× 在右，顺序不变；两钮恒显。命中盒扩围不得造成动作互相覆盖或卡片内容被截获。

### 5.2 卡片 / 按钮样式

- 静止态继续消费既有 `--agent-bg` / `transparent`、`--border` / `--border-soft`、`--text-3`、`--hover`、`--ok`、
  `--r4` 等 token；零新增颜色、阴影、图标库与触屏式大底板。
- 可见底板尺寸按 §2 保持紧凑。复制 SVG 为双页复制语义，stroke / fill 使用既有文字色；不得引入风格不同的彩色图标。
- eink 不新增色彩语义；dark 不用阴影补层次。缩放档只改变既有视觉字号，不降低 24px 命中下限。

### 5.3 字层级

- 撤回保持 12px 撤销 SVG，不恢复文字；其余 meta 字号保持现状；复制 SVG 为 14×14，× 为 14px；@ 保留既有 mono 形态。
- success 继续显示完整 `✓ 已复制` / `✓ Copied`，不截断、不另造 toast；动态宽度只影响动作层。

### 5.4 各状态样式

| 状态 | 必须保持 / 达到的表现 |
|---|---|
| 静止 | 复制 / 撤回按既有规则隐去；图片 @ / × 恒显；所有命中盒已稳定存在 |
| hover | 复制 / 撤回显现；底板 / 字色沿用既有 hover 配方；无布局跳动 |
| focus-visible | 复制 / 撤回有可见焦点与显现路径；焦点几何与 hover 共用同一命中盒 |
| disabled | 撤回保留既有 0.45 档视觉与提示，不执行动作；不与复制重叠 |
| success | 复制使用既有 ok 色与完整文案，约 1.5s 后恢复；期间撤回同步让位，无重叠 |

### 5.5 视觉候选与基线闸

- 用合成 fixture 产出 light / dark / eink 的现状与候选对比；至少含默认 / 窄 pane、普通复制、复制 success、
  撤回正常 / disabled、引用卡 ×、图片 @ + ×。hover 与 focus 的候选图必须实际触发对应状态。
- 对比材料落 `.local/reviews/` 或实施 mission 的 `.local/missions/` 证据桶，不入正式基线。独立 reviewer verdict 前必须
  做同样的并排对照，不能只看结构断言。
- 只有 Alex 看过候选并明确批准后才允许正式 `--update`；获批后仍须核对所有受影响整页基线的时间戳与变化面。

## 6. 机器判据与逐条证伪

### 6.1 结构 / 几何 / 命中场景

每个相关动作至少覆盖下列断言，而不是只读 computed CSS：

1. **真实尺寸**：`getBoundingClientRect()` 读数为默认 28×28（文字动作允许更宽），任何方向不低于 24。
2. **真实命中**：在中心、四边中点与近角采样，`document.elementFromPoint()` 的归属为该按钮或其装饰后代；
   透明扩展采样点不得落到父卡 / 正文。
3. **相邻隔离**：复制 / 撤回、@ / × 的矩形在全部状态无交集，且 success / 语言切换后仍成立。
4. **边界与裁切**：首个 / 末尾 / 容器边缘附近的完整可见动作均可命中；没有被 `overflow` / clip 吞掉的声明区。
5. **正文保护**：动作矩形与可见正文 / 摘录 / 出处文本矩形不相交；动作外文本仍命中原内容 / 父表面。
6. **布局稳定**：hover / focus / success 前后消息行高、正文起点、文档文本、composer doc / selection / 卡片块序不变。
7. **真实事件**：复制源逐字节不变且 success 出现 / 消退；disabled 撤回零副作用；@ 只插入一次；× 只移除一次。
8. **嵌套优先级**：引用卡 × 的中心与透明边缘均不调用父卡 jump；紧邻命中区之外的父卡仍只执行既有跳转。
9. **可访问名 / 键盘**：既有 aria-label 不变，inline SVG 不另产读屏节点；composer Tab 序与编辑器按键模型不变。

### 6.2 反向必红

每条新增 / 修改断言单独做反例并保存红 / 绿两次读数，至少包括：

- 把目标高度改回 16 / 20 ⇒ 尺寸与边缘命中对应断言必须红；恢复后绿。
- 把撤回或 @ 平移到与相邻动作重叠 ⇒ 相邻隔离断言必须红；恢复后绿。
- 给祖先恢复裁切或把透明扩展移到容器外 ⇒ 命中 / 边界断言必须红；恢复后绿。
- 让动作覆盖一段可见文字 ⇒ 正文保护断言必须红；恢复后绿。
- 临时移除 × 的 click 冒泡隔离 ⇒ 父卡 jump 负向断言必须红；恢复后绿。
- 改错 accessible name 或意外改变 composer Tab 序 ⇒ 对应结构断言必须红；恢复后绿。

反例一次只证明一条断言，不得以「整组测试曾红」替代逐条证据。失败归因按 workflow 分为产品缺陷、测试 oracle 缺陷、
环境 INVALID、需求或视觉迭代；归因未定不得先记成产品 FAIL。

## 7. 真机与门禁

- 新增 / 更新真机验收场景：在 WKWebView 中用真实指针点击 × 的中心与透明边缘，证明移除一次且父卡零跳转；
  点击 @ 与 × 的相邻边缘证明不串动作；覆盖复制 success、撤回 disabled / focus 及卡片截图。
- 真机场景不能只用 AXPress 代替指针边缘测试；AX 不承担几何 PASS。按套件要求更新覆盖表、`--check` 并保存场景
  `status.txt` 与截图到 `.local/acceptance/`。
- 实施收尾跑 `scripts/gate.sh quick` 与完整 `scripts/gate.sh visual`，分别照抄 `GATE RESULT` 与退出码。
  CI 结构层绿不替代本地完整像素层；machine PASS 不替代 native PASS。

## 8. 依赖、评审与完成定义

1. 提案可独立评审；生产实施前等待 `clarify-harness-withdraw-scope-nov27` 合并并 rebase。冲突解决后重读撤回相关合同，
   本 change 不裁决其适用范围。
2. 独立 K3 reviewer 对当前 tip 做代码判断层与视觉终审，必须看真实几何 / 命中反向证据和现状 / 候选并排图；
   clean / merge 绑定最终 tip，之后任何改动重新评审。
3. 报告分别列视觉候选、implemented、machine PASS、native PASS、released、archived。正式基线未经 Alex 裁决不得勾视觉候选批准。
4. 归档走 `node scripts/openspec-archive.mjs improve-harness-action-targets-nov27`，提交归档结果后跑
   `node scripts/openspec-archive-check.mjs --archived improve-harness-action-targets-nov27` 并取得 PASS。
5. merge / push 后跟进本次 push 触发的每条 CI workflow 到终态；未全绿不得宣称批次完成。
