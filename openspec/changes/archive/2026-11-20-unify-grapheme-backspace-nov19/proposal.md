# Proposal: 统一字素步长的前删——composer ⌃H 与两编辑面的无修饰物理 Backspace

- Change ID: `unify-grapheme-backspace-nov19`
- 日期: 2026-11-20
- 角色: Alex Lee（原始需求与裁决），AI agent（起草 / 实现）

> 评审记录
> 节点 1（提案评审）：来源是 Alex 的原始要求「类似问题主动修复，并强调避免过度工程与工程不足」
> （M843 mission 的 Context 原文），以及 M843 双引擎对抗矩阵登记的两条 finding：
> `.tower/comms/findings/20261119-worker-unicode-clipboard-bug-composer-h-emoji-rtl.md` 与
> `20261119-worker-unicode-clipboard-bug-backspace-rtl.md`（目录不入 git，指针仅本机可查）。
> tower 据此立项 M860 并确定技术取舍：复用 `src/quote-card.ts` 既有的 `clusterBackward`，
> 不新增字素算法、不扩 forward delete、不更新视觉基线。本 change 不引入新的产品行为，只把
> 既有规格中「⌃D/H 与删除键删除字素簇」这句被实现证伪的条款落成可证伪的不变量。

## Why

### 现场

M843 在 Node 与 chromium + webkit-realua 三层实测到同一类缺陷——同一个用户可见字符被删两次或删一半：

- **composer ⌃H**（`editor.delete-char-backward`，`src/harness-composer.ts`）走
  `@codemirror/commands` 的 `deleteCharBackward`：它用 `findClusterBreak(..., includeExtending=false)`
  再补一个变体选择符区间，只退一个「CM 簇后缀」。5 类簇被劈开：肤色修饰 `👍🏽 → 👍`、
  职业 ZWJ `👩🏽‍🚀 → 👩`、组合重音 `e◌́◌̣ → e◌́`、阿拉伯文附标 `مَ → م`、希伯来文附标
  `שָׁ → שָ`。正文的同一命令（`src/editor.ts` 的 `deleteCharBackward`）走
  `quote-card.clusterBackward`（`includeExtending=true`），整簇删除——同一命令 id 在两个
  文本面语义不一致。
- **物理 Backspace**（正文与 composer 的 contenteditable）完全没有接管，粒度由浏览器决定：
  Chromium 对组合标记与阿拉伯文 / 希伯来文附标逐码点退，WebKit 对 RTL 附标同样逐码点
  （`xe◌́◌̣y → xe◌́y`、`A مَ B → A م B`）。连续按会继续吃掉 base 与相邻空格，用户看到的是
  断开的字素；真实 app 是 WKWebView，RTL 附标用户会碰到。

`src/quote-card.ts` 的 `clusterBackward` 已是被正文命令与 composer 的转置 / 词法扫描共用的
唯一字素步长核；缺陷只在「哪条入口用了哪份步长」，不需要新的字素算法。

### 为什么是产品缺陷，不是「引擎行为」

「同一用户可见字符应只删一次且完整删除」是编辑保真的基本不变量：`⌃H`、物理 Backspace、
`⌃D` 在同一个文本面上对同一个簇必须给出同一个结果。把粒度交给引擎即把同一份用户意图解释
两次（REVIEW.md「同一语义两处真源」条的同族）。既有 `harness` living spec 的「CM composer
的 Emacs 文本导航族」已写明「字素簇 / 词边界 SHALL 复用编辑器共享扫描核；⌃D/H 与删除键删除
字素簇或选区」——当前实现是该条款的反例。

## What Changes

1. **composer 的 `⌃H` 改用共享字素核**（`src/harness-composer.ts`）：`editor.delete-char-backward`
   的折叠 caret 分支改走 `quote-card.clusterBackward`，事务形状沿用本文件既有的
   `deleteRange`（删 `[prevCluster, caret)`、caret 落删除起点）；有选区仍删选区。MUST NOT
   再调用 CM 的 `deleteCharBackward`（它的 CM 簇后缀与行首缩进单位口径都与正文不同）。
2. **物理 Backspace 的 beforeinput 闸门**（两编辑面同一份判定）：
   - composer：闸门装进 `composerStateExtensions`（composer 的 CM view 在各处都由
     `createComposerState` 构造），只接管 `deleteContentBackward` 的折叠 caret；
   - 正文：`src/editor.ts` 的 `absorbNativeEdit` 在既有 M836 / M854 / M855 分支之后接同一份
     字素判定；md 与 code 两种模式都装（code 模式只装这一条，不搬选区 / 回读闸门）。
   - 判据只读 `EditorState` 与 `InputEvent.inputType`：修饰键变体以不同 inputType 到达
     （`⌥⌫` = `deleteWordBackward`、`⌘⌫` = `deleteHardLineBackward` / `deleteSoftLineBackward`），
     IME 组合期 / 只读会话 / 非空选区保持既有路径；一个事务 = 一条 history 步。
3. **合同与回归**：
   - `editor-live-preview`：修改「跨 replace 装饰的跨行删除」里被证伪的「行内删除不接管」句，
     新增「折叠光标的字素步长前删」requirement；
   - `harness`：在「CM composer 的 Emacs 文本导航族」里把物理 Backspace 明写进同一步长合同；
   - Node 层（`tests/unit/text-unicode-adversarial.test.ts`）与双引擎视觉层
    （`tests/visual/scenes/text-clipboard-adversarial.spec.ts`）的按引擎 / 码点残留基线表
     改为统一整簇期望，新增普通 ASCII 类、code 模式与修饰键变体用例；`tests/visual/README.md`
     的判据面与基线段同步；
   - 新增真机场景 `scripts/acceptance/scenarios/268-grapheme-backspace.md`（WKWebView 下正文
     物理 Backspace 与 composer 物理 Backspace / `⌃H` 三条 witness）。

## Non-goals

- **不新增字素算法**：`clusterBackward` 是唯一实现，正文、composer、删除命令与闸门都复用
  它；不引入 `Intl.Segmenter`、不复制第二份表。
- **不扩 forward delete**：物理 Delete / `⌃D` 的两引擎原生粒度已按字素簇（M843 实测），
  `delete-char-forward` 的 composer 实现保持 CM 既有命令不动。
- **不改修饰键变体与 IME**：`⌥⌫` / `⌘⌫` 的输入类型、IME 组合期、只读会话、非空选区删除
  （归 M854 的选区编辑合同）语义逐字节不变。
- **不更新视觉基线**：本 change 不改布局 / 配色，像素基线不动。
- **不新增键位**：`⌃H` 仍是 `editor.delete-char-backward`；物理 Backspace 不进入统一键位表。

## Impact

- 影响的 specs：`editor-live-preview`（正文编辑）、`harness`（composer 文本导航族）。
- 影响的代码/系统：`src/editor.ts`（beforeinput 闸门 + code 模式扩展）、
  `src/harness-composer.ts`（composer 命令 + beforeinput 闸门）、两层测试与视觉 README、
  真机验收场景与覆盖表。
- 关联约束：不改写源文件铁律、`docs/specs/lists.md` L7 的适用范围（指向 `editor-live-preview`
  的阀门注释，本条不新增 L7 条款）；不触及性能合同。
