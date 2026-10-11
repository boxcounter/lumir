# Harness composer 交互合同（harness composer）

> 状态：新增（M419，2026-10-10；M450 补 HC3）。本文档是 **harness 面板输入区（composer）的
> 换行、视口与边界光标位**质量合同：可被测试证伪的不变量条款。渲染/交互缺陷修复的「合同先行」规则见
> [../process/rendering-defect-contract-first.md](../process/rendering-defect-contract-first.md)——
> 定位到本文件某一条、配不变量级属性测试，两者与修复同 PR。
> composer 的**外观**（圆角卡片、控制行排布、字号）不在本文件；块模型与序列化协议见
> `src/quote-card.ts` 与 `openspec/changes/add-harness-quote-cards` 的 design §3。

## 适用范围

harness 面板的混排输入区：`contenteditable` 容器（`.lumir-hp-composer`），顶层块只有三类
原子卡片（`.lumir-hp-qcard`：引用卡片 / 消息摘录卡片 / 图片卡片，change
harness-composer-image-paste 新增第三类）与问题段落（`.lumir-hp-qpara`）。本文档约束
**键盘驱动的换行**（Enter 发送 / ⇧Enter 换行）与**断行后的视口位置**。输入分布（条款引用
分布，不引用具体案例）：

- **光标落点**：段落内（段中 / 段首 / 段末）· 空段落 · 卡片前缘（含无前段落）· **相邻两张卡之间**
  （两者之间没有段落——卡片与卡片之间、卡片与段落之间的前缘是同一个模型值，此处显式写成独立
  一档，避免读成「卡片前缘只指卡片与段落之间」，见 HC3）；
- **段落文本**：空 / 单字 / 多字 / 已含内部换行（粘贴或快照恢复带进来的 `\n`）· **以换行结尾**
  （原生编辑路径可达：WebKit 删空一行后残留的 `<br>` 经 `paraTextOf` 记为 `\n`、`normalize`
  不剥除——属性测试的生成器枚举这一档，见 §证伪方式）；
- **内容体量**：单行（不滚）· 超出 `max-height`（可滚，`overflow-y: auto`）。

## 不变量

### HC1 — 一次 ⇧Enter 恰好多一行可见行，且光标落在可见行上

对**任意**块序列与**任意**光标位置，一次 ⇧Enter MUST：

1. 让 composer 的**可见行数恰好 +1**；
2. 断行结束后，光标落在**可见行**上——光标的行号 MUST 小于其所在段落的**渲染行数**。

第 2 条不是实现细节，是第 1 条的可判据形态：CSS 里**尾随换行不产生行盒**
（`white-space: pre-wrap` 下 `"ab\n"` 与 `"ab"` 同高，实测见下节），所以「段末追加 `\n`」这种
最自然的写法会让光标落在一个**没有渲染出来的行**上——用户看到的是「按了没反应」，再按一次
才把上一次的尾随换行挤成内部换行。这正是本条款要禁的形态。

第 2 条的判据是**充要**形态、不能省成「段落文本不以 `\n` 结尾」：段落文本可以以 `\n` 结尾
（见 §适用范围 的第二条），此时「段落尾随 `\n`」与「光标落在尾随换行之后」是两件事——
`"\na\n"` 里 offset 1（第二行行首）的光标是**可见**的，`"a\n"` 里 offset 2（尾随换行之后）
的光标才是不可见的那个。按行号 < 渲染行数判，两例各归其位。

落法的形状不做承诺（段内插 `\n`、拆出新段落块、别的表示都可以），只约束上面两条可观测结果。

### HC2 — 断行 / 光标移动后，光标行 MUST 在 composer 视口内

composer 视口（`.lumir-hp-composer` 的 `overflow-y: auto` 区）MUST 把**光标所在行**纳入可见区，
用户 MUST NOT 需要手动滚动才能看到刚断出来的那一行。内容不足以滚动时不适用。

判据形态（可证伪表述）：断行后，光标行的渲染区域与视口可视区有非空交集。

机制按**结果**约束、不按实现约束：composer 的光标是程序化 `Range` 落下的（`renderComposer`
重渲后 `setDomCaret`），引擎在选区变化时的 reveal 行为是**引擎特性**——WKWebView 会 reveal
（实测，2026-10-10），Blink 不会。实现侧因此显式给一条**引擎无关的保证**
（`caretScrollTop` + 写 `scrollTop`，光标已在视口内时不动）：它保证条款在任何引擎 / 任何
重渲路径上成立，而不是依赖引擎的默认行为。

边界光标位（HC3）的 `Range` 可能量出**零高**（它落在两个块级元素的边界上，不是文本行），
此处回落**后一张卡片**的块矩形——「后一张卡片在视口内」是「边界可见」的可用代理。

### HC3 — 边界光标位：相邻卡片之间可停光标，内容输入在该处物化段落

composer 的模型层 SHALL 把「相邻两个原子块之间的位置」当作一等公民的光标位，其表示 SHALL 为
`{block: 后一块的下标, offset: 0}`（等价于「后一块的前缘」）。**相邻两张卡片之间没有段落是
合法状态**，归一化 MUST NOT 为此凭空插入段落（HC1 的「对任意块序列」承诺含这些形态）。对
**任意**块序列与上述任一光标位：

1. **往返对称**：该位置从 DOM 读回 SHALL 得到 `{block: N, offset: 0}`——`Range(composer, N)`
   与「选区锚在某张卡片元素内部或卡片元素本身」两种 DOM 形态归一到同一个模型值；把该位置写回
   DOM SHALL 落在同一个块级边界上；该光标位 SHALL 跨整面重渲（`renderComposer` + 写回光标）与
   撤销 / 重做恢复保持一致；
2. **导航不是编辑**：仅把光标移动到该位置 MUST NOT 改变块序列、MUST NOT 产生撤销步；
3. **内容输入物化段落**：内容型输入到达该位置时 SHALL 在该处物化一个问题段落块并把内容落进它
   ——键入字符与 IME 组合落字落在新段落里；粘贴 / 拖入的纯文本同样落在新段落里；⇧Enter 在该处
   落一个新空段落（与 HC1 的「卡片前缘」档同一条落法，仍满足「恰好多一行可见行」）；插入卡片
   SHALL 把卡片落在该边界上并保证其后仍有承接光标的问题段落。物化 MUST NOT 吞掉被该边界分隔的
   卡片、MUST NOT 把内容折进相邻的其它段落块；
4. **一个撤销步**：物化与该次输入 SHALL 合成**一个**撤销步——一次撤销后回到「两张卡片相邻、
   两者之间无段落、光标在边界位」的前态（新段落与其中的文字一并消失、两张卡片不丢）。

**卡片前缘输入纯文本 MUST NOT 删除该卡片**（`insertPlainTextAtCaret` 的既存缺陷：旧实现把
`blocks[at]` 整个跳过、卡片被删）。退格 / 前删在该位置的语义沿用既有卡片语义（退格删**前**一张、
前删删**后**一张），不在本条另立新语义。

### HC4 — Emacs 文本导航族：停靠点一步必有位移，导航不是编辑、不重渲

composer 内的 Emacs 文本导航族（⌃F / ⌃B、⌃A / ⌃E、⌃N / ⌃P、⌃D / ⌃H、⌥D / ⌥⌫、⌃K / ⌃Y、⌃T、
扩选六键 ⌃⇧F/B/N/P/A/E 与按词扩选 ⌥F / ⌥B）SHALL 经**统一键位表**（作用域 `text` = 编辑器内容区
或 composer 输入区，change composer-emacs-nav）分发并按模型层语义执行；MUST NOT 由引擎的原生
caret 路径决定行为。族外的键位（⌃G、⌥G、翻屏族 ⌃V / ⌥V / ⌃L、`Tab` / `⇧Tab`、撤销族）MUST NOT
被本 capability 改变。

1. **停靠点与同形位归一**：停靠点序列 = 段落各**码点边界**偏移（代理对整体一步；低位代理不构成
   独立停靠点）· 卡片前缘 `(i, 0)`（后缘 = 下一块前缘）· 末尾之后的 `(块数, 0)`。段落**非空**末缘
   `(i, len)` 与紧邻后块的前缘同形，归一到**后块前缘**表示（末段末缘归一到「末尾之后」）；归一
   SHALL 只有一处实现（`normalizeComposerCaret`，移动 / 扩选命令共用）。**归一等价类后，序列上
   任意相邻两个停靠点必不相同**——一步必有位移（不得「原地空走」）。空段落只有 `offset 0` 一个
   停靠点、不参与归一。⌃F / ⌃B SHALL 在停靠点序列上移动**一步**，遇原子卡片 SHALL 整块一步跨过；
   ⌃A / ⌃E 落当前逻辑行行首 / 行尾（`\n` 为界）；⌃N / ⌃P 在逻辑行之间移动（同列位，超出目标行
   长度取行尾），出段落跨到相邻**段落**块，卡片不产生停靠行。
2. **导航不是编辑**：仅移动光标 MUST NOT 改变块序列、MUST NOT 产生撤销步、MUST NOT 触发
   `renderComposer` 那类整面重渲（只允许写选区与滚动位）；移动后光标行 SHALL 在 composer 视口内
   （HC2）。失败形态（无动作、块边界、无法落位）SHALL 表现为「无动作」，MUST NOT 留下半截状态。
3. **扩选**：anchor 不动、head 走与移动族**同一份**移动纯函数；⌥F / ⌥B 是**按词扩选**（与键位表内
   既有语义一致），MUST NOT 被实现为词移动。
4. **删除族与 kill-yank**：⌃D / ⌃H SHALL 与 Delete / Backspace 走**同一份**模型语义（卡片前缘 /
   段末遇卡片时对整块作用；有选区时删除选区），MUST NOT 存在第二份删除判定；⌥D / ⌥⌫ SHALL 按词
   kill 到词尾 / 词首并并入 kill 槽，词边界口径与编辑器侧共用同一份实现；⌥⌫ / ⌥Delete SHALL 由
   本能力接管（MUST NOT 被输入区既有的就地退格 / 前删路径吞掉）。词级 kill 与 ⌃K MUST NOT 跨块
   ——到达段落边界即停（段边界处无动作），MUST NOT 隐式合并段落、MUST NOT 隐式删除卡片。⌃K kill
   到当前逻辑行行尾（已在行尾则杀该行界、段内合并两行）。kill 槽 SHALL 是**跨面共用**的单一真源
   （编辑器与 composer 同一槽、同一份连续 kill 相接判定）；kill 的内容 MUST NOT 含卡片。⌃Y 把
   kill 槽内容插入光标处（有选区先删选区），多行经段落拆分入口落成多个段落块，光标在卡片边界位
   时先物化一个段落。

> 归一口径的一处**实现注记**（与 change 的 design §4.1「读回处也调它」不同）：`caretFromDom` 的
> 编辑读回**不**调 `normalizeComposerCaret`——编辑动词（退格 / 前删 / 键入分派 / 粘贴）依赖
> 「段落末缘 `(i, len)`」与「后块前缘 `(i+1, 0)`」是两个不同的模型值（归一后段落末缘的退格会
> 变成跨块合并、段末键入会插到下一段段首）。等价类服务的是**导航**（移动 / 扩选命令）。

## 证伪方式（属性测试口径）

对「光标落点 × 段落文本 × 内容体量」的输入分布逐个取样：

1. **HC1 模型层（零 DOM 单测）**：按块序列 × 光标位置**全枚举**，断言「可见行数 +1」与
   「光标的行号 < 所在段落的渲染行数」两条（第二个判据是充要形态，见 HC1 条下的说明）；可见
   行数与渲染行数是渲染口径的纯函数复刻——段落按「尾随换行不产生行盒」计（`"ab\n"` 与 `"ab"`
   同为 1 行，空段落 1 行），卡片不占文本行。生成器按 §适用范围的文本分布取样：空 / 单字 /
   多字 / 内部换行 / **尾随换行**，每种再与卡片交错（引用卡片与图片卡片两类，M440 起图片
   卡片纳入分布——它与引用卡同族、同样不占文本行）。
   落点：`tests/unit/harness-composer.test.ts` 的 HC1 属性用例。
2. **HC1 行为层（chromium 探针 / 真机验收）**：`AB` + ⇧Enter + `CD` ⇒ `CD` 落在 `AB` **下一行**
   （不是同一行）。缺陷形态下它是同一行（`ABCD`，见下节实测）。落点：验收场景
   `scripts/acceptance/scenarios/117-harness-composer-soft-break.md`。
3. **HC2 判据层（零 DOM 单测）**：`caretScrollTop` 纯函数——光标在可视区下方 / 上方 / 区内 /
   内容不足一屏 / 越界钳制，逐档断言目标滚动位。落点：同单测文件的 HC2 用例。
4. **HC2 行为层（真机验收）**：内容超 `max-height` 后断行，断言 composer **可视区的最后一行是
   刚断出来的空行**（像素层判据：该行带内无字形，与其右侧空白同色）；缺陷形态下那一带是上一行
   的字形。落点：`scripts/acceptance/scenarios/118-harness-composer-autoscroll.md`。
5. **HC3 判据层（零 DOM 单测）**：`boundaryCaretAt` / `domCaretTarget` / `isCardFrontCaret` 三个
   纯函数——块序 × 全部边界位（含「末尾之后」）全枚举，断言写回落点恒为同一个块级边界、读回
   归一恒为同一模型值、段落位不被边界档吃掉；外加边界位的输入动词矩阵（`insertPlainTextAtCaret`
   卡片档不丢卡、内容落在新段落、块序守恒、offset 落点）与删除语义（退格删前 / 前删删后 / 块首
   无操作）。落点：`tests/unit/harness-composer.test.ts` 的 HC3 用例。
6. **HC3 行为层（真机验收）**：两张合成图片卡片相邻、光标在其后段落，⌃B 回移 → 键入一个探针串
   → 断言该串落在**两张卡片之间**（AX 文本里探针串夹在两条卡片元信息行之间）→ 一次撤销回到
   「两卡相邻、之间无段落」的块序。落点：`scripts/acceptance/scenarios/134-harness-composer-intercard-caret.md`。
   这一条同时是裁决点 2 的**实测闸**（原生 ⌃B 能否落到边界）：落位不成立时的处置见 change
   `composer-intercard-caret` 的 design §6。
7. **反向验证**：把两条修复各自临时改回缺陷形态，断言 MUST 变红；不变红即说明该断言对该缺陷
   无区分度，不算覆盖。
   - **HC1**（段末改回尾随 `\n`）：实测 117 变红——像素条「第二行行位有字形」读到亮度跨度 0
     （修后 186），AX 两条也变红（文本是同行拼接的 `hnl-brk-aahnl-brk-cd`）。区分度成立。
     模型层同口径（r1 补测，生成器已含尾随换行档）：缺陷形态下 **6 条红**，含 HC1 属性用例
     （首个反例 `[para("")] @0:0`：可见行数 1 !== 2）与尾随换行档的逐案断言——判据放宽到
     充要形态后区分度不变。
   - **HC2**（临时停用显式滚动）：**118 仍然绿**。原因是引擎自己会做这件事——WKWebView 在
     程序化改动选区（`selection.addRange`）时会 reveal 光标（Blink 不会：chromium 探针实测
     停用显式滚动后视口停在 max 之前 19px，正好差一行）。因此 118 里「最下一行带是空白」
     那条是**行为守卫**，它**不**区分「显式滚动代码在不在」；显式滚动的判据挂在 HC2 的纯函数
     单测上。118 的区分度落在另两条（`geom` composer 高 ≥140px、AX 里十行逐行落地）——
     它们对**真缺陷形态**红（那十次按键合并成五行、composer 只有 117px 高、根本到不了滚动态）。
   - 已知边界：显式滚动只在 Blink 上可观测到差异，而真机是 WKWebView——118 覆盖不到
     「显式代码被删」这一形态，如需在 chromium 层补一条结构断言另开（本 change 的改动面不含
     `tests/visual/scenes/**`）。
8. **HC4 判据层（零 DOM 单测）**：`normalizeComposerCaret` / `composerCaretStops` 与移动 / 删除 /
   kill / 转置纯函数——小块序列全枚举下断言「相邻停靠点必不同类、序列线性有序」、移动族落点
   （代理对整步、卡片一步跨过、跨段跳过卡片）、词级 kill 不跨块、导航函数在冻结入参上返回
   （块序列逐字节不变）。落点：`tests/unit/composer-nav.test.ts`。
9. **HC4 行为层（真机验收）**：`scripts/acceptance/scenarios/140`–`147` 八条——移动族落点 /
   相邻卡片一步跨过 / 导航不成撤销步 / 删除族按整卡 / ⌥⌫ 是词级删除 / kill 槽跨面共用 /
   扩选 anchor 不动 / 族外键不回退。
   **已知未覆盖**：「导航不重渲」这一条要求 MutationObserver 计数 = 0，而真机套件只有
   KimiCU 的 AX / 截图 / 输入通道、**没有 JS 求值通道**（`scripts/acceptance/lib/cu.mjs`），
   当前判不了；场景 142 用「导航后文本不变 + 导航不成撤销步」这条可观测后果替代，缺口登记在
   change 的 tasks §7 与场景 142 的已知边界节。

## 实测依据（M419 现场，2026-10-10）

缺陷现场（Alex）：「Harness composer 里按两次 SHIFT + Enter 才会换行」「换行时自动滚动到最末
一行，现在需要人工滑动」。

chromium 探针（`vite dev` + 视觉套件的桩，光标读回 / 高度 / 滚动位三组读数，先在宿主页量
纯 DOM 形态，再在真实 composer 上复现）：

| 形态 | 渲染高度 | 说明 |
|---|---|---|
| 空段落 / `"ab"` / `"ab\n"` / `"ab<br>"` | 同高（单行） | 尾随换行（含尾随 `<br>`）**不产生行盒** |
| `"ab\n\n"` / `"ab<br><br>"` | +1 行 | 只有**内部**换行才落地行盒 |

修前实测（真实 composer，键盘注入）：`ab` + ⇧Enter ⇒ 模型 `"ab\n"`，**高度与滚动位零变化**；
继续键入 `cd` ⇒ 文本变成 `abcd\n`（键入落回上一行）。再按一次 ⇧Enter 才看到一行空白。
修后实测：`ab` + ⇧Enter ⇒ 块序列 `[段落 "ab", 段落 ""]`（**新空段落块**，`min-height: 1em`
真实占一行），光标落在新行；继续键入 `cd` ⇒ 第二块为 `"cd"`。滚动位：11 行内容时
`scrollTop = scrollHeight − clientHeight`（贴底），光标行在可视区内。

## 与实现的关系

- HC1 的落法由 `src/harness-panel.ts` 的纯模型层 `insertSoftBreakAtCaret` 决定（段末 / 卡片前缘
  落新空段落块，段中插 `\n`），DOM 只是这个模型的渲染面——**不得**为同一次按键再挂第二套
  键盘处理路径。
- HC2 的判据是纯函数 `caretScrollTop`（`src/harness-panel.ts`），DOM 侧（`setDomCaret` 的
  收尾）只负责量读数、写 `scrollTop`；光标已在视口内时纯函数返回原值，不抖动视口。
- HC3 的读回 / 写回规则是 `src/harness-panel.ts` 的三个纯函数：`boundaryCaretAt`（DOM 边界
  → 模型位）、`domCaretTarget`（模型位 → DOM 落点形态）、`isCardFrontCaret`（是不是边界位）。
  `caretFromDom` / `setDomCaret` 只是这两个规则在真 DOM 上的执行面，两者必须互为逆运算。
  内容型输入的物化收口在两处：`beforeinput` 的 `insertText`（键入）与 `compositionstart`（IME
  组合的首次落字）；粘贴 / 拖入 / ⇧Enter / 插卡片各自的入口**不改落法**——它们的「卡片前缘」
  分支早已实现，本条款只是让那个位置**读得出来**。
- HC4 的模型层是 `src/harness-panel.ts` 的一组纯函数：`normalizeComposerCaret`（同形位归一）、
  `composerCaretStops`（停靠点序列）、`moveCharForward` / `moveCharBackward` / `moveLineStart` /
  `moveLineEnd` / `moveLineDown` / `moveLineUp` / `moveWordForward` / `moveWordBackward`（移动与
  扩选 head）、`killWordForward` / `killWordBackward` / `killLineAtCaret` / `transposeCharsAtCaret`
  （删除族与转置）。装配层的**一处**包装按事件目标分派到 `HarnessPanelHandle.composerCommand`
  （编辑器面走 `src/editor.ts` 的既有命令、composer 面走这些纯函数）；移动 / 扩选只写选区
  （`setDomCaret` / `setDomSelection`）与滚动位，**不**走整面重渲。词 / 字素簇扫描与 kill 槽的
  **共用**实现住在叶子模块 `src/quote-card.ts`（编辑器侧与 composer 侧同一份）。
- 已知边界：卡片上按 ⇧Enter 时「新行」落在卡片那一行的上方（光标所在处），不改变卡片与
  文本块的相对次序——卡片是原子块，本条不承诺它内部出现换行。
- 已知边界（HC3）：`compositionstart` 的物化**不走整面重渲**（`withModel`），只就地插入那一个
  空段落块——重渲会销毁正要开始组合的目标节点、打断 IME 会话。它仍与撤销栈的「前态」口径一致
  （先压前态再插块），代价是这一步的实现偏离「结构性修改一律整面重渲」的常规路径，写在这里备案。
