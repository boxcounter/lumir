# Proposal: 大纲浮层的 Emacs 上下键与最大高度 80%

- Change ID: toc-popover-emacs-keys-and-max-height
- 日期: 2026-09-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

两条独立的小需求，都落在 M148 的轻量大纲浮层上（能力与浮层本体在 `src/toc.ts`，样式的 `.lumir-toc`
段在 `src/style.css`），合在一个 change 里。

**一、浮层里现在只有 `↑↓` 能导航，Emacs 键不生效。** Lumir 当前阶段定位是 Emacs keybinding PKM
（ADR 0006），而浮层打开态的就地键只有 `↑↓` / `Enter` / `Esc` 三组（`src/toc.ts:384` 的
`onKeydown`）。Emacs 里「上下移动」的规范键是 `C-n` / `C-p`（`next-line` / `previous-line`），且这
两个键在**列表缓冲区里照常生效**——dired 就是把它们重定义成 `dired-next-line` /
`dired-previous-line`（[Navigation in the Dired Buffer](https://www.gnu.org/software/emacs/manual/html_node/emacs/Dired-Navigation.html)，
原文「The keys `C-n` and `C-p` are redefined to run `dired-next-line` and `dired-previous-line`」）。
也就是说，在列表语境里 `⌃N` / `⌃P` 不是「另一套键」，而是同一语义的 Emacs 拼法；浮层不认它们，
Emacs 用户的手感就是断的。

**二、浮层最大高度现值是实现期自定的 55vh，且只约束列表、不含底部键位提示。**
`src/style.css:427` 的 `.lumir-toc-list { max-height: 55vh; overflow: auto }`——M148 的 proposal 与
living spec 都没有定过高度数字（现行 spec 只有一句「条目列表超出视口高度时 SHALL 在浮层内滚动」），
55vh 是当时实现的自选值。Alex 现给定口径：**最大高度到窗口的 80%**。

Alex 的需求原话（2026-09-17，M157 需求）：**「TOC 里增加对 Emacs keybinding 的支持，比如 CTRL+N/P」**
与**「TOC 窗口最大高度可以到窗口的 80%」**。

任务另要求论证两个候选键（`⌃V` / `⌥V` 翻页、`⌥<` / `⌥>` 首末项）。两条的结论都是**不纳入**，
理由与信源见下面「键位集的选择」——其中 `⌥<` / `⌥>` 的否决依据是本次调查新发现的既有缺口
（编辑器侧没有 `M-<` / `M->`），已另发 finding 请 tower 路由。

## What Changes

1. **浮层打开态支持 Emacs 上下键**：`⌃N` / `⌃P` 作为 `↓` / `↑` 的等价键（与既有移动同一份实现、
   同一钳制口径）。两键只在浮层打开且持有焦点时生效——不改文档、不动编辑器光标；浮层关闭后同一物理
   键回到原有归属（由 `editor.cursor-down` / `editor.cursor-up` 接管——这两个 token 在统一键位表里
   本来就归它们）。
2. **浮层最大高度 = 窗口内容区高的 80%，且是「浮层总高」的上限（含底部键位提示与内边距）**。
   条目超出时只在浮层内的列表里滚动、键位提示常驻可见；窗口尺寸变化后上限在重排时跟随，不必关闭再
   打开浮层。（口径说明：80% 与实现期自选的 55vh 不是同一件事——55vh 只约束列表，新口径约束整个
   浮层。）
3. **浮层底部的键位提示同步更新**（`文案-Copy.md` D86）：浮层内就地消费的键不进统一键位表、键位面板
   里也看不到，界面上的提示是它们唯一的出口（deck 里 D86 的自述理由）。就地键从三个变成五个，提示
   不覆盖就等于「新键只能试出来」。
4. **delta 落在 `toc-outline` 与 `keymap-commands`**：前者两条 MODIFIED（`大纲浮层`——导航键集、
   高度口径、提示覆盖义务；`命令入口与浮层内键位的归属`——就地键集合与「不构成第二条分发路径」的
   判据），后者一条 MODIFIED 同步那条就地键枚举（该 requirement 点名了浮层的就地键集合，不同步
   就会在归档后留下一份与实现不符的枚举，正是 M150 归档对账里点名的那类漂移）。

## 键位集的选择（Emacs 对齐 vs 实现成本）

任务要求逐条论证「至少 `⌃N`/`⌃P`」之外的候选键。结论是**只纳入 `⌃N` / `⌃P`**：

| 键 | 纳入 | 理由 |
|---|---|---|
| `⌃N` / `⌃P` | **是**（Alex 指定） | Emacs 的 `next-line` / `previous-line`，列表缓冲里照常生效（dired 原文见 Why）。落点与 `↑↓` 完全相同，只是键处理里多两条 token 分支。边界口径也天然对齐：Emacs 的 `C-n` 在 buffer 末行**停止**（[Changing the Location of Point](https://www.gnu.org/software/emacs/manual/html_node/emacs/Moving-Point.html)：原文「`C-n` normally stops at the end of the buffer when you use it on the last line in the buffer」），与浮层既有的钳制、不循环一致。 |
| `⌥<` / `⌥>` | **否**（建议） | 在 Emacs 里这一对是 buffer 级命令 `beginning-of-buffer` / `end-of-buffer`（同页：「Move to the top of the buffer」/「Move to the end of the buffer」），在浮层里的对应物就是首末项，实现也近零成本（把游标下标置 0 / 置末）。**但编辑器侧没有这个能力**：`src/keys.ts` 的表里没有 `⌥<` / `⌥>`（token `Alt-Comma` / `Alt-Period`），编辑器也未装 CM 的 commands keymap——在 Lumir 里这个键唯一的落点会是浮层，而同一个人在编辑器里按它得到的是 macOS Alt 图层替换出来的字符（`src/keys.ts` 已有同类记录：⌥v → `√`、⌥d → `∂`、⌥⇧- → `—`；⌥⇧, / ⌥⇧. 的具体字符待真机确认）。也就是同一物理键「浮层里跳首末、编辑器里插符号」的语义分裂——不值得在一个小 change 里制造。正确顺序是先决定编辑器层的 `M-<` / `M->`（要不要、落点怎么定），浮层的首末项跟随它；该缺口已发 finding 请 tower 路由（见 Non-goals）。若 Alex 要在浮层里先行加入，delta 加一条子句 + 一个 scenario 即可（实现两行），本 change 的结构不会因此变形。 |
| `⌃V` / `⌥V` | **否** | Emacs 的这两个键是**视口命令**，不是「移动光标一页」：`C-v`（`scroll-up-command`）「Scroll forward by nearly a full window」，默认留 2 行重叠（`next-screen-context-lines`），且「若 point 在滚出上边界的那段文本里，它落到新窗口最上面那一行」，到达 buffer 边界时报错而非移动（[Scrolling](https://www.gnu.org/software/emacs/manual/html_node/emacs/Scrolling.html)）。要在浮层里忠实复刻，必须引入几何测量（一屏显示几条、滚动后哪一条成为首条可见、边界怎么落点），把现在的纯下标模型换成几何模型——这会是本 change 里唯一依赖字体渲染与窗口尺寸的不确定面（与项目「确定性优先」的偏好相反），而收益有限：移动游标本身已带 `scrollIntoView` 自动滚动，高度上限提到 80% 后一屏可见条目本已变多。 |
| `n` / `p`（字母键） | **否** | dired 里 `SPC` / `n` / `p` 是 `C-n` / `C-p` 的便利别名（同 Dired 页），本 change 不取：Alex 指定的是 `⌃N` / `⌃P`；字母键留给将来可能的输入式过滤（v1 明确不做过滤，但提前占用会锁死那条路）。 |

## Non-goals

- **不做翻页键**（`⌃V` / `⌥V`）：理由见上表的对齐成本分析。若 dogfood 后发现长文档里确实需要，按
  手感证据单独提 change。
- **不做首末项键**（`⌥<` / `⌥>`，以及 Home / End / `⌃Home` / `⌃End` 等任何形态）：理由见上表。
  Emacs 自己在图形显示上把 `M-<` / `M->` 与 `C-HOME` / `C-END` 并列（同 Moving Point 页），而在
  Lumir 里这两类形态对应的是**编辑器侧**的缺口——它是既有问题、不是本 change 引入的，已发 finding
  请 tower 路由（编辑器没有 `M-<` / `M->`，Emacs 用户按它会往文档里插入 Alt 图层字符）。浮层的
  首末项在那一层定下来之后再对齐，避免「同一物理键两个上下文两种语义、其中一种还是坏的」。
- **浮层就地键不做配置化**：沿用 M148 口径——不进 `KEY_BINDINGS`、不受 `[keys]` 覆盖、不进
  `app.describe-bindings` 面板。`⌃N` / `⌃P` 已被 `editor.cursor-down` / `editor.cursor-up` 占用
  （同 token 的第二条绑定会被分发器构造期的重复绑定检查直接拒绝）。因此这两键的**唯一可见出口是
  浮层底部的提示**，这正是把提示更新放进本 change 的原因。
- **不改浮层的水平定位**：`src/toc.ts` 的 `place()` 只在打开那一刻算一次，浮层打开期间把窗口变窄
  可能让浮层右端越出 masthead 可视区——M148 的既有边界，本 change 只做高度口径。
- **不做输入式过滤、不做侧栏 TOC**：与 M148 的 Non-goals 一致。
- **不加「浮层不越出窗口底边」的钳制逻辑**：浮层锚在 masthead 下沿（`.masthead` 的
  `min-height: 57px`），`57px + 80% ≤ 100%` 在窗口内容区高 ≥ 285px 时成立；更矮的窗口下浮层底边
  可能越出窗口。加钳制要把 masthead 高度复制成第二个真源（CSS 算不出浮层锚点相对窗口顶的偏移），
  而那个窗口尺寸下应用本身已不可用——记为已知边界（写进 spec），不修。

## Impact

- 影响的 specs：`toc-outline`（MODIFIED ×2）、`keymap-commands`（MODIFIED ×1，就地键枚举同步）。
- 影响的代码/系统：`src/toc.ts`（`onKeydown` 增 `⌃N` / `⌃P` 两条 token 分支）、`src/style.css`
  （`.lumir-toc` 加 `max-height: 80vh` 与列向 flex；`.lumir-toc-list` 从 55vh 改为弹性收缩；
  `.lumir-toc-hint` 固定不收缩）。**`src/keys.ts` 零改动**（不新增绑定、不新增命令 id）。
- 影响的文档：`文案-Copy.md` D86（浮层键位提示）与同文件的出处备注段。
- 影响的测试/验收：`scripts/acceptance/scenarios/13-toc.md`（新增 `⌃N` / `⌃P` 步骤；**13 处**
  `↑↓ 选择` 探针串随提示文案同步——该串是套件里「浮层开着」的唯一判据）、
  `tests/visual/scenes/toc-outline.spec.ts`（提示文案断言、Emacs 键导航与关闭后归还、高度上限断言；
  元素级基线 `toc-popover-chromium-darwin.png` 重拍——浮层变高 + 文案变化都会反映在那里）。
- 关联约束：ADR 0006（Emacs keybinding PKM 定位，本 change 与该定位一致）、ADR 0001 §4（chorded +
  非 modal 的键位形态：浮层不是模态，就地键只在持有焦点时生效）、ADR 0003 §3（不改写源文件——两键
  都不碰文档）、ADR 0002 第 6 条（性能合同：键击路径不整篇解析——本 change 不新增解析）、ADR 0004
  第 5 条（功能变更走 OpenSpec）。
- 性能：无新增解析与布局测量。高度口径纯 CSS（`vh` 随窗口重排，不开监听）；键位是下标运算，
  与 `↑↓` 同一路径。
