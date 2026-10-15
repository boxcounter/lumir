# Design: composer-emacs-nav

技术设计说明。节点 1 评审以 [proposal.md](proposal.md) 为准；本文记录实现期的技术选型与行为合同细节，
供实现 worker 与归档评审对账。

**术语**（本 change 自造词，就地定义）：

- **文本面**（=`text` 作用域）：编辑器内容区（CM contentDOM）与 harness composer 输入区这两处可编辑文本面的
  并称——本 change 新增的第三个键位作用域。
- **停靠点**（caret stop）：composer 模型里光标可停的、彼此可区分的位置，由「块下标 + 段内偏移」表示
  （`ComposerCaret`）。卡片上的偏移恒 0 = 该卡片**前缘**；「卡片后缘」= 下一块前缘。
- **等价类 / 同形位**：视觉上重合、但模型里有两种以上表示的停靠点（如段落末缘与紧邻其后的卡片前缘）。

## 1. 调研结论（现状事实锚点）

（逐条已核实，读源码 + 既有测试；本次会话内**实跑**的只有单元测试基准。行号对 master `f64aaf0`。）

- **表内作用域只有两值**：`KeyScope = "global" | "editor"`（`src/keys.ts:169`）；`editor` 判据 = 事件目标在
  某个 `doc` pane 的 `view.contentDOM` 内（`src/main.ts:2362-2372`）。composer 是 harness 面板里的独立
  `contenteditable` 容器（`.lumir-hp-composer`，`src/harness-panel.ts:1988-1989`），不在 contentDOM 内
  ⇒ 族内绑定不命中。
- **族内绑定清单**：`src/keys.ts:451-521`（作用域均 `editor`）——移动 ⌃F/⌃B/⌃A/⌃E/⌃N/⌃P；删除 ⌃D/⌃H/⌥D/⌥⌫；
  kill-yank ⌃K/⌃Y；转置 ⌃T；扩选 ⌃⇧F/B/N/P/A/E；按词扩选 ⌥F/⌥B（= `editor.extend-word-*`，**不是**词移动）。
- **composer keydown 里族的逐类出路**（`src/harness-panel.ts:4972-5027`；**此处更正 finding 原文的机制
  描述**——它写「对所有修饰键直接 `return`」，系沿用未核）：`mod = event.metaKey || event.ctrlKey`
  （`:4990`，**不含 `altKey`**）⇒ ① ⌘/⌃ 系在 `:5002` 的 `if (mod) return` 放行（例外 `⌘Z` / `⌘⇧Z` / `⌘Y`
  在 `:4991-5001` 被面板自管的撤销栈拦下）；② ⌥F / ⌥B / ⌥D 不经 `:5002`、后续分支也不命中（macOS 的 Alt
  层替换 `event.key`），**落空放行**——与 ① 殊途同归，同样走原生路径；③ **⌥⌫ 命中 `:5016` 的 Backspace
  分支**（Alt 不改变该键的 `event.key`），被当**普通退格**消费（逐字符、词级语义丢失；`caretFromDom()`
  读不回时 `:5017-5018` 又退回原生路径）。Enter / 裸 Backspace / Delete / 粘贴 / 拖入走面板就地模型路径
  （`:5003-5027`、`:5033` 起）。③ 属静态推断（判据：`altKey` 不改变 ⌫ 的 `event.key`），列入实现期探针。
- **composer 的块模型与光标表示**：`ComposerCaret {block, offset}`（`:220-231`）；顶层块 = 原子卡片
  （composer 态 `contentEditable="false"`，`:2337` / `:2394`）与段落；删除族已有「卡片按整体」的模型函数
  （`backspaceAtCaret` `:458`、`deleteForwardAtCaret` `:500`、`deleteSelectionRange` `:417`）；纯文本入库口是
  `insertPlainTextAtCaret`（`:323`，`\n` 拆段）。
- **DOM↔模型往返今日不对称**：`caretFromDom` 对「锚在 composer 元素自身」返回 `null`（`:2625-2628`）；
  `setDomCaret` 反过来会写 `range.setStart(composer, index)`（`:2672-2673`）。**读回还漏第三形态**：锚在段落
  末文本节点时读到 `{block, offset: len}`，与「紧邻后块前缘」是同形位的另一种表示（见 §4）。
- **装配期硬不变量**：`Keymap` 构造期对同一 token 的第二条绑定直接抛错（`src/keys.ts:830-834`）；
  `tests/unit/keys.test.ts:105` 对账「作用域与命令组一致」（`scope === editor 组 ? "editor" : "global"`）。
- **配置与面板覆盖面**：`applyKeyOverrides` 的作用域**机械派生**自命令分组（`src/keys.ts:793`）；键位查看
  面板渲染生效表（`openspec/specs/keymap-commands/spec.md` 的「键位配置覆盖」「键位查看面板」两条）。
- **token 口径的既有限制**：含 Alt 的组合只按物理键判定、忽略 Shift ⇒ `⌥⇧F` 与 `⌥F` 同一 token，
  故 `⌥F`/`⌥B` 不能再绑词移动（`openspec/specs/keymap-commands/spec.md:224` 明文）。
- **编辑器侧先例**：原生 caret 进不了 CM 的原子范围 ⇒ 收回模型层（`src/editor.ts:385-395`）；词 / 字符簇
  扫描口径在 `src/editor.ts:583-584`（`WORD_CHAR`，模块内私有）、`prevCluster` / `nextCluster`；
  `transposeChars`（`:777-799`）在行首 / 行尾**不动作**、不跨行；kill 槽是模块级单例（`:704-709`，未导出）。
- **质量合同**：`docs/specs/harness-composer.md` 的 HC1 / HC2——「行」的定义是**逻辑行**（段落按「尾随换行
  不产生行盒」计、卡片不占文本行）；composer 的 DOM 是重渲出来的，光标由 `setDomCaret` 程序化落下。
- **基准读数**：`node tests/unit/run.mjs` ⇒ `tests 794 / pass 794 / fail 0`；`tests/unit/keys.test.ts` 零处
  提到 composer（本族今天无判据）。

## 2. 方案对比

### 键位层：同一物理键怎么进表（proposal 裁决点 1 的展开）

- **A（采纳）：单绑定 + 作用域加 `text` + 命令内按事件目标分派。**
  `KeyScope` 加第三值 `text`（= 编辑器 contentDOM 内**或** composer 内）；族内绑定的 scope 由 `editor` 改判
  `text`；**命令 id 与编辑器侧实现不变**，目标在 composer 内时由装配层的一处包装分派到 composer 侧实现。
  - 保住「一个 token 一条绑定」（`:830-834` 抛错判据与 `[keys]` 覆盖语义一字不改）。
  - 代价：一个命令 id 的实现要在两个面上分派 ⇒ 用**一处**包装收口，MUST NOT 每个命令各写一遍面判定。
  - 「作用域与命令组一致」的对账因此必须升级为**单一派生函数** `scopeOfCommand(id)`（表内绑定、装配期校验、
    `applyKeyOverrides` 三处共用同一函数）——否则 `editor.*` 前缀与 `text` 作用域会被两处判据判成「不一致」而
    互相打脸（`tests/unit/keys.test.ts:105` 现有判据的泛化）。
- **B（否决）：同 token 允许两条作用域互斥的绑定。** 与表内已落定的「一个 token 一条绑定」正面冲突——该
  不变量此前**已被用来否决**「再给 ⌥F 绑一条词移动」（`keymap-commands` spec:224），放开它等于推翻那条裁决。
  同一条不变量也让这个形态**已经在途**地建不起来：`composer-intercard-caret`（M444）tasks 3.2 写的就是
  「加 composer 作用域的 `Ctrl-b` / `Ctrl-f` 绑定……与 `editor` 作用域互不命中」，落进 `src/keys.ts` 会在
  构造期撞「重复绑定」抛错（`:830-834`），`tests/unit/keys.test.ts:105` 的作用域对账也不放行。另有两处代价：
  `[keys]` 的「某个键重绑 / 解绑」对同名两条绑定产生歧义（格式里没有作用域维度）；键位面板一行变两行，
  "一个键一个动作"的呈现被打破。
- **C（否决）：composer 的就地 keydown 自己接管整族。** 这一族将既不可配（不进 `[keys]`）又不可查（不进
  键位面板），且新增一条与既有 editor 绑定并列的旁路——本仓在 M131 已把键位旁路收敛过一次，`keymap-commands`
  的「分发 SHALL 只有一条路径」是那次收敛的结论。**已知边界**：composer 今天已有一条就地路径（Enter /
  Backspace / Delete / ⌘Z 族），那是**表内没有这些 token** 的后果（`src/keys.ts` 的 M272 记注），不是与表内
  绑定并列的第二条映射；本 change 的族内键**在表内**，若再就地接管就构成真正的旁路。

### 模型层：停靠点与语义从哪里来

编辑器侧的做法是「表内登记绑定 + 实现走模型层」；composer 侧照抄形状，但**停靠点集合的表示**这一层不在本
change 内发明——它是 `composer-intercard-caret`（M444）的产物（§7 接口）。本 change 在其上定义导航语义。

## 3. 键位层机制

### 3.1 作用域三值

```ts
export type KeyScope = "global" | "editor" | "text";
//  global：任意焦点生效
//  editor：事件目标在编辑器内容区（CM contentDOM）内生效
//  text  ：事件目标在编辑器内容区**或** harness composer 内生效（两处文本面）
```

- **作用域判定的单一来源**：`scopeOfCommand(command)`（新增导出，唯一判据）——`text` 面命令组 →
  `"text"`；`EDITOR_COMMAND_IDS` → `"editor"`；其余 → `"global"`。`KEY_BINDINGS` 的 `scope` 字段、装配期
  对账（`tests/unit/keys.test.ts:105` 的泛化）、`applyKeyOverrides`（`src/keys.ts:793`）三处**共用**它。
  `text` 面命令组 = 本 change 接管清单（`COMPOSER_TEXT_COMMAND_IDS`，导出常量，与 design §4 的键表一一对应）。
- **分发器**：`binding.scope === "text"` 时，命中判据为 `ctx.isEditorEvent(event) || ctx.isComposerEvent(event)`；
  `KeymapContext` 新增 `isComposerEvent`，实现落在装配层（`src/main.ts`）——它同时持有 pane 布局与面板句柄：
  `event.target` 在 `.lumir-hp-composer` 内即为真（与 `isEditorEvent` 同款「用目标而非焦点」口径）。
- **族外 editor 命令不跟着放宽**：`⌥G` / widget 族 / `Tab` 缩进等作用域仍是 `editor`，在 composer 内**不命中**
  ——「editor 作用域不越界」这条防线原样成立（否则在 composer 里按 ⌥G 会去动编辑器光标）。

### 3.2 命令内分派（一处包装）

装配层注入的命令表里，`text` 面命令由一个包装产出：

```
runtime[id] = (event) => { if (inComposer(event)) panel.composerCommand(id); else editorCommand(id, event); }
```

- `panel.composerCommand(id)` 是面板句柄新增的入口（`HarnessPanelHandle` 加一个方法，形态与既有
  `insertQuoteCard` / `focusComposer` 的挂载点同款）：按命令 id 分派到 composer 的模型层操作。
  **命中即消费**——分发器命中绑定即 `preventDefault`（命中即吞默认行为，命令本身无事可做也不放行
  原生路径），因此本入口**不返回**「是否消费」；「该处无动作」（块首 ⌃B / 段首 ⌥⌫ / 有选区的 ⌃T 等）
  按**无操作**处理，MUST NOT 放行原生路径。
  > **M453 实现期修订（本条的第一次更正，评审 r1 P2-2）**：草案曾写「`composerCommand` 返回是否消费的
  > boolean，面板未挂载 / composer 不在场 / 该光标位无动作时返回 false、事件放行原生」。实测那样会**破坏
  > 合同**——段首 ⌥⌫ 放行后 WKWebView 的原生 `deleteWordBackward` 会跨块合并 / 删卡，直接违反「词级 kill
  > 不跨块」不变量；且「面板未在场」档本就不可达（composer 不在 DOM 时 `isComposerTarget` 为假）。实现取
  > 「命中即消费、无动作即无操作」，入口签名改为 `composerCommand(command): void`。
- 面判定（`inComposer`）SHALL 只有一处实现（小助手 `isComposerTarget(event)`，判 `event.target` 在
  `.lumir-hp-composer` 内）；`KeymapContext.isComposerEvent` 与上面这个包装**调同一个**助手——两条路径各写
  一遍判定就是第二个真源（REVIEW.md 第 8 条）。命令实现本身仍是纯函数驱动，不认识「事件目标」。
- 面板关闭 / harness pane 不在场时 composer 元素不在 DOM 里 ⇒ 判定自然为假。

### 3.3 配置与面板

- `[keys]` 对 `text` 面命令的重绑 / 解绑：作用域由 `scopeOfCommand` 派生（重绑后仍是 `text`），解绑走既有
  「未绑定」呈现；三者与今天逐字同款，无新语义。
- 键位查看面板：`text` 面命令**按功能族**归入既有分组（⌃B → 「移动与选择」、⌃D → 「删除」…），不新增分组；
  来由文案（D-code）措辞点明「编辑器 + composer 两处文本面」——新文案取空闲 D-code，zh/en 双档，随
  `copy-data` 的漂移测试。

## 4. composer 侧的停靠点与语义（行为合同）

### 4.1 停靠点序列与等价类归一

块序列展开为停靠点：段落块 i → `(i, 0..len)`；卡片块 i → `(i, 0)`（前缘）与 `(i+1, 0)`（后缘）。

**同形位归一**（本 change 追加的一条，MUST 只有一处实现，读回与移动命令共用）：

- `(i, len)`（段落末缘）与 `(i+1, 0)`（紧邻后块的前缘）**视觉重合** ⇒ 归一到**后块前缘**的表示；
- 相邻两个段落块之间的公共边界同理（`normalize` 不合并相邻 `.qpara`，这种块序合法，`:2571-2612`）；
- 归一的目的只有一个：**移动的一步必须落在等价类的商集上相邻的项**，否则 ⌃F/⌃B 会在原地空走一拍
  （用户看到「按了没反应」）。判据（零 DOM 可判）：归一等价类后，任意两个相邻停靠点的模型表示必不同类。
- 归一点在**读回**的统一收口处（`caretFromDom` 的返回处）与**每个移动命令的返回处**，两处调同一个函数——
  三个 DOM 形态（锚在 composer 元素 / 锚在卡片内 / 锚在段落末文本节点）因此产出同一个模型值。

> 这条是对 M444 归一口径的**收紧**（M444 只归一了前两种 DOM 形态，见其 spec「原子块边界光标位」）；实现时
> 落进 M444 已经建好的归一函数，不另起一份（§7）。

### 4.2 移动族

| 命令 | composer 语义 |
|---|---|
| ⌃F / ⌃B | 停靠点序列上前进 / 后退**一步**：段内字符步进（代理对整体一步，照 `backspaceAtCaret:479-481` 的口径）；段落边界按停靠点规则走；**原子卡片一步跨过**（从后缘直接到前缘） |
| ⌃A / ⌃E | 段内**逻辑行**（`\n` 为界）行首 / 行尾；已经是则不动 |
| ⌃N / ⌃P | 段内逻辑行步进（**同列位**，超出目标行长度取行尾；无粘性目标列——与 Emacs 的 goal column 差异如实登记）；出段落则跨到相邻**段落块**——**卡片不产生停靠行**，被整体跳过；无相邻段落则不动 |

- 「行」一律取逻辑行（proposal 裁决点 6）：与 `docs/specs/harness-composer.md` 的 HC1/HC2 同口径，
  且纯模型可判（不引入 DOM 测量）。
- 移动 MUST NOT 触碰块序列、MUST NOT 压撤销步、MUST NOT 重渲（§6）。

### 4.3 删除族与 kill-yank

- **⌃D / ⌃H**：直接复用 `deleteForwardAtCaret` / `backspaceAtCaret`（`src/harness-panel.ts:458/:500`）——卡片
  按整体、段首合并、代理对整删的语义天然一致；有选区时两者都先走 `deleteSelectionRange`。
  **对账判据**：⌃D 与 Delete 键、⌃H 与 Backspace 键的模型结果 MUST 逐字节相同（同一函数，一条断言钉住）。
- **⌥D / ⌥⌫（词级 kill）**：词边界口径 MUST 复用编辑器侧同一份 `WORD_CHAR` / `isWordChar` 与字符簇扫描
  （提为共用纯函数；`src/editor.ts:583-584` 今天是模块私有，MUST NOT 复制第二份）。**不跨块**：到段边界即停，
  段边界处无动作——跨块在 composer 里意味着合并段落或删卡片（隐式结构编辑），本 change 不引入。
- **⌃K（kill-line）**：kill 到当前逻辑行行尾；已在行尾则 kill 该 `\n`（段落内合并两行，Emacs 同形）；
  已在段落末行行尾则无动作（**不跨块**，理由同上）。
- **⌃Y（yank）**：把 kill 槽内容插入当前段落（多行经 `insertPlainTextAtCaret` 拆段）；光标在卡片边界位时先按
  M444 的物化口径物化段落再插入；有选区时先删选区。**不变量：kill 的内容永不含卡片**（本 change 的 kill 只
  作用于文本），因此 yank 只产段落块——可作为属性断言。
- **kill 槽归属**：与编辑器**共用同一个单例**（proposal 裁决点 4）。实现：把 `killSlot` 与相邻判定从
  `src/editor.ts:704-728` 提为**共用模块**并导出（编辑器侧实现改为引用它，语义一字不改）；composer 侧的
  kill 走同一个槽、同一份「连续同向 kill 相接」判定。MUST NOT 复制一份槽。
- **⌃T（转置）**：与 `src/editor.ts:777-799` 的 `transposeChars` 逐条同语义——左右字符簇交换、光标落右端、
  **段首 / 段尾 / 卡片边界处无动作**（编辑器侧的行首行尾 no-op 在 composer 对应段落边界）。

### 4.4 扩选族

- ⌃⇧F/B/N/P/A/E 与 ⌥F/⌥B：**anchor 不动**，head 走**同一个**移动纯函数（§4.2 的 ⌃F/⌃B/⌃A/⌃E/⌃N/⌃P；按词扩选
  走字符簇的「按词一步」）。与编辑器的扩选族同一形状（`editor.extend-*`），只是落点规则换成 composer 的。
- **⌥F / ⌥B 是按词扩选，不是词移动**（proposal 裁决点 3）：与表内 `editor.extend-word-*` 的语义一致；
  已知代价是 composer 里 ⌥F 从「原生词移动」变为「按词扩选」，两侧因此都没有词移动键位（token 口径不允许
  同一 token 两义，`keymap-commands` spec:224）。
- 选区的**消费**（有选区时键入字符替换选区）今天走原生路径，本 change 不改（登记为边界）。

### 4.5 与既有就地路径的边界

| 键 | 走哪条路径 | 本 change |
|---|---|---|
| ⌃ 族（本 change 接管清单） | 统一键位表（`text` 作用域）→ 面板命令入口 → 模型层 | 新增 |
| ⌥F / ⌥B / ⌥D | 今天落空放行给引擎；接管后同上表 | 新增（进表） |
| **⌥⌫ / ⌥Delete** | 今天被面板的 Backspace 分支当**普通退格 / 前删**消费（`:5016`） | **进表，且面板的就地分支须同步收窄**（见下） |
| 裸 Enter / ⇧Enter / Backspace / Delete / 粘贴 / 拖入 | 面板就地（`src/harness-panel.ts:5003-5033`） | 不变 |
| ⌘Z / ⌘⇧Z / ⌘Y | 面板就地（`:4990-5001`） | 不变（撤销族不是导航族，另案） |
| ⌃/ 、⌃_ | 表内 `editor.undo`，composer 内不命中 ⇒ 引擎无对应 ⇒ **无动作** | 不变（登记为已知缺口） |

- **面板先消费、分发器让路的陷阱（实现期必须处理）**：面板的 keydown 挂在 composer 元素上、**先于** window
  上的分发器执行，而 `Keymap.handle` 对 `defaultPrevented` 的事件让路（`src/keys.ts:852-855`）。今天
  ⌥⌫ 会被 `:5016` 的 Backspace 分支 `preventDefault`（只要 `caretFromDom()` 读得回），因此**只加表内绑定
  是无效的**——面板分支必须同步收窄：就地分支 SHALL 只处理**不带任何修饰键**的 Backspace / Delete
  （`!metaKey && !ctrlKey && !altKey`），带 ⌥ 的变体让给键位层；否则 ⌥⌫ 的表内绑定永远不命中，而用户看到的
  仍是逐字符退格（一个「绑了没用」的静默失配，`REVIEW.md` 一·假绿的同族形态）。
- **MUST NOT 出现同一物理组合的两条映射**：上表除「⌥⌫ 过渡」一行外每行互不重叠；⌥⌫ 的过渡是**同一处
  分支的收窄**（面板让位），不是新增第二条映射。

## 5. 机器判据设计

### 5.1 模型层（tests/unit，零 DOM）

小块序列**全枚举**（0–3 块：卡片 / 段落 / 空段落 / 含 `\n` / 相邻卡片 / 以卡片开头与结尾）× 全部起始光标：

1. **停靠点序列**：生成 + 等价类归一 + 商集线性有序（任意相邻两点不同类 ⇒ 一步必有位移）；三个 DOM 形态
   （用替身模拟 `caretFromDom` 的三档输入）归一到同一模型值。
2. **移动族**：逐命令的落点断言（含代理对整步、卡片一步跨过、⌃N/⌃P 的卡片跳过与无邻块 no-op、列位钳制）。
3. **删除族**：⌃D ≡ Delete、⌃H ≡ Backspace（对账断言）；⌥⌫ / ⌥D 的词边界与「不跨块」不变量（段边界处
   块序列逐字节不变）；⌃K 的行内 / 行尾换行 / 段末 no-op；⌃T 的三档。
4. **kill-yank**：槽的相接合并（连续同向 kill）、跨面共用（一次 kill 后同一槽可 yank）、多行 yank 拆段、
   卡片边界位 yank 的物化、**kill 内容不含卡片**（属性断言）。
5. **导航不改块序列**：任一导航命令的返回块序列与入参逐字节相等（编辑类命令才允许不等）。

### 5.2 keys 层（tests/unit/keys.test.ts）

1. **表对账**：token 唯一；`scopeOfCommand` 单一来源（`text` 面命令组与 design §4 的清单一一对应，缺一条即红）；
   `[keys]` 对 `text` 面命令重绑 / 解绑后的 scope 派生与 warning 路径。
2. **分发器三分支**：目标在 composer 内 → 族内键命中、**族外 editor 命令不命中**（⌥G / widget 族 / Tab 的反例）；
   目标在 contentDOM 内 → 与今天逐条一致；目标在 chrome 上 → 都不命中。

### 5.3 真机验收（scripts/acceptance，WKWebView，mock provider，fixture 全合成）

1. **逐键落点**：移动族在「段落 / 相邻卡片 / 卡片边界」三类起点上的落点（DOM 子元素次序 + 模型读数）。
2. **卡片边界一步跨过**：两张相邻卡片之间可停靠、可原路返回；从边界位继续输入落到新段落（与 M444 场景衔接）。
3. **导航零 DOM 变更**：在 composer 上挂 `MutationObserver`，注入 ⌃F/⌃B/⌃N/⌃P 后 childList 变更为 **0**。
   这一条同时是「MUST NOT 整面重渲」与 ADR 0002 §6（导航不进重路径）的机器判据。
4. **导航不成撤销步**：导航后按 ⌘Z，回到的是**导航前的编辑前态**（不是导航前态）——读数 = 块序列 + 文本。
5. **删除族按整卡**：⌃D 在卡片前缘删整卡；⌃H 在段首遇卡片删整卡；⌥⌫ 在段首**不**删卡。
6. **⌥⌫ 确实走表（面板让位生效）**：在 `alpha beta` 的行尾按 ⌥⌫ ⇒ 删掉的是**整个词**（不是单个字符）——
   这条把 §4.5 的「面板先消费、分发器让路」陷阱变成红灯判据（陷阱形态下它退化为逐字符退格）。
7. **kill-yank 跨面**：编辑器里 ⌃K 杀一段 → 焦点到 composer 按 ⌃Y 插出来（同一槽）。
8. **扩选**：⌃⇧F 扩选后 anchor 读数不变。
9. **族外不回退**：composer 内按 ⌥G / ⌃V / Tab 不产生本层动作（与今天一致）。

场景编号按实现期套件现状顺排（写本提案时最高 130，见 `scripts/acceptance/scenarios/`）；**新增/更新验收
场景随实现同 PR**。

### 5.4 反向验证（合同先行口径，`docs/process/rendering-defect-contract-first.md`）

- 把某条命令在 composer 内临时改回原生路径（不消费事件）⇒ §5.3 的落点断言 MUST 变红；
- 把导航改为走整面重渲 ⇒ §5.3 第 3 条（零 DOM 变更）MUST 变红；
- 把 ⌥⌫ 的实现改成「跨块删卡片」⇒ 不跨块不变量 MUST 变红；
- 把面板的就地分支放回「带修饰键也处理」（即 `:5016` 不排除 `altKey`）⇒ §5.3 第 6 条 MUST 变红（⌥⌫ 退化
  为逐字符退格）。

## 6. 性能与质量合同

- 导航路径 = 纯函数算新模型 + `setDomCaret` 写选区 + `caretScrollTop` 写滚动位（HC2）。**MUST NOT** 调
  `renderComposer`（整面重渲）；判据即 §5.3 第 3 条的 MutationObserver 计数。
- HC1 / HC2 不破：本 change 不新增块类、不改 `insertSoftBreakAtCaret` 与 `caretScrollTop`；两者的生成器
  若要纳入新语义（如边界位起始态）随实现补，但**语义零改动**。
- 视觉零漂移：导航不产生新 DOM 元素与样式（预期 `scripts/gate.sh visual` 零基线更新；若动过视觉相关文件，
  按 `tests/visual/README.md` 的纪律核对既有基线时间戳）。

## 7. 与 `composer-intercard-caret`（M444）的接口与次序

**本 change 依赖 M444 产出的三件事**（若 M444 未落地，本 change 的实现须先做出来，照其 design §3 的落法）：

1. 边界光标位的模型表示 `{block: N, offset: 0}`（= 后一块前缘）；
2. `caretFromDom` 的 DOM 形态归一 + 与 `setDomCaret` 的往返对称；
3. 卡片边界位上的**内容输入物化**（键入 / IME / ⇧Enter / 插卡片在那里落一个段落）。

**本 change 对 1、2 追加的要求**：归一 SHALL 在等价类上做（§4.1 的三形态），且归一函数只有一处（读回与
移动命令共用）。

**交接（proposal 裁决点 5）**：

- M444 的 tasks §3（「条件落地：composer 作用域的水平移动」，含 ⌃B/⌃F 与扩选对称、模型移动纯函数）由本
  change 承担 ⇒ M444 落地时该组整体标注「未触发，由 composer-emacs-nav 接管」。
- M444 的裁决点 2（原生 ⌃B 是否到得了边界）在本 change 被接管后**不再是决策点**（水平移动不再由原生路径
  决定）；但**探针本身保留价值**——它量的是「原生 caret 在原子卡片边界的行为」，正是本 change §5.4 反向验证
  需要的对照组证据（旧路径不可用的现场读数）。
- **落地次序**：M444 先（或与 M447 同批）——M447 先实现的代价是它必须先把上述三件事做出来（重复一段
  M444 的实现），故不建议。
- M444 的落地使 `docs/specs/harness-composer.md` 里「键盘驱动的换行与视口」一文的适用范围扩到「导航 + 输入」；
  本 change 在其后追加导航条款（§6），不重复定义边界位。

## 8. 后续项（本 change 不做，实现时登记 `docs/backlog.md`）

1. **撤销族迁进表**：composer 的 ⌘Z / ⌘⇧Z / ⌘Y 走面板就地路径，Emacs 别名 ⌃/ 与 ⌃_ 在 composer 内无动作。
   要让撤销族也归表（并让别名生效），须把面板的撤销分支迁进统一表——另一处结构变更，另案。
2. **词移动键位**：本 change 后两侧都没有「按词移动」键（token 口径所限）。若要补，须先修订 token 口径
   （含 Alt 组合纳入 Shift 判定，同时处理 `⌃⌥_` 别名的真机 / 合成事件形状）——`keymap-commands` spec:224
   已把它记为后续 change 的范围。
3. **⌃N/⌃P 的粘性目标列与视觉行口径**：与 Emacs 的 goal column 差异、以及长段落按折行上下移动，留 dogfood
   数据后另裁（proposal 裁决点 6 的 B 方案）。
4. **可发现性**：边界光标位与扩选在无视觉提示（本 change 不新增提示），dogfood 后再看是否需要。
