# Design: tab-cycle-keys

## 1. 现状（全部 file:line 锚点，2026-09-26 核对）

### 1.1 键位统一层与 `⌘{` / `⌘}` 的事件形态

- 唯一分发表在 `src/keys.ts:293`（`KEY_BINDINGS`）；token 归一化与运行期事件同源
  （`normalizeKey` `src/keys.ts:458-472` / `keyToken` `src/keys.ts:481-497`）。重复绑定
  在构造期抛错、缺实现的绑定在 attach 期抛错（Keymap 构造器 `src/keys.ts:573` 与
  attach `src/keys.ts:594-603`）。
- **事件形态（核心事实）**：US 布局上 `{` / `}` 必须按 Shift 才能打出，所以 `⌘{`
  的物理按键就是 `⌘⇧[`、`⌘}` 就是 `⌘⇧]`。WKWebView 收到的 keydown 事件为
  `event.key === "{"`（Shift 后的字符）、`metaKey = true`、`shiftKey = true`、`altKey =
  false`。经 `keyToken` 归一：不带 Alt 不走物理键分支（`src/keys.ts:492-494`），
  mods 为 `[Cmd, Shift]` 拼上 key `{` 得 `Cmd-Shift-{`，而 `{` ∈ `SHIFT_IMPLIED_KEYS`
  （`src/keys.ts:452`，集合含 `_+{}|:"<>?~!@#$%^&*()`），Shift 被删掉——最终 token 是
  **`Cmd-{`**。表内因此 MUST 写 `Cmd-{` / `Cmd-}`，MUST NOT 写 `Cmd-Shift-[`
  （永不命中的静默失配形态）。
- **实测先例**：M195 的 `Cmd-+` 是同机制的姊妹案例——真机 macOS 上 `⌘⇧=` 的事件
  `event.key === "+"`，归一成 `Cmd-+`；该实测连同「合成事件可能给 `key === "="` +
  shiftKey → 归一成 `Cmd-Shift-=`（不命中）」的警示写在 `src/keys.ts:374-385` 的
  注释段。本 change 的两条绑定按同一机制推导；真机验收（场景 45）用 KimiCU 的
  CGEvent 真实注入（物理按住 ⇧，WKWebView 自会给出 `{` / `}`），不用合成 DOM 事件
  当判据——「注入过就算验过」的假绿教训见 REVIEW.md 第 5 条与 M195 注释段。
- 标签命令族现状（M149）：`tab.next` / `tab.prev` 已绑 `Ctrl-Tab` / `Ctrl-Shift-Tab`
  （`src/keys.ts:389-390`），scope `global`；实现是装配层的
  `"tab.next": () => tabs.cycleTab(1)` / `"tab.prev": () => tabs.cycleTab(-1)`
  （`src/main.ts:522-523`）；能力 `cycleTab` 在 `src/tabs.ts:225-230`——
  `(current + delta + tabs.length) % tabs.length`，**首尾回卷**；少于 2 个标签时
  无操作（`src/tabs.ts:227`）。可见标签口径 = 有路径的会话按打开顺序
  （`visibleTabs`，`src/tabs.ts:208-210`），标签栏 / ⌘1–9 / ⌃⇥ 共用。
- [keys] 覆盖：`applyKeyOverrides`（`src/keys.ts:522-560`）单键重绑 / 解绑，
  作用域随命令归属派生（`tab.*` → global）；Rust 侧 `validate_keys`
  （`src-tauri/src/config.rs:470`）只校验形状（拒绝空 / 含空白），`Cmd-{` 形态合法。
- describe-bindings 面板渲染生效表（applyKeyOverrides 的产物），`tab.*` 按
  `TAB_COMMAND_IDS`（`src/keys.ts:163`）单列一组；本 change 不新增命令 id，面板零改动。

### 1.2 冲突核对（三条独立来源，零冲突）

- **表内**：grep `Cmd-{` / `Cmd-}` 在 `src/keys.ts` 与 `tests/unit/keys.test.ts` 零命中
  （2026-09-26 实测）；`Ctrl-Tab` / `Ctrl-Shift-Tab` 归一化后是不同 token，互不干扰。
- **原生菜单 accelerator**：tauri 2.11.5 的 `Menu::default()` 逐项来自 muda 0.19.3
  `items/predefined.rs` 的 `accelerator()`——Copy ⌘C / Cut ⌘X / Paste ⌘V / Undo ⌘Z /
  Redo ⇧⌘Z / SelectAll ⌘A / Minimize ⌘M / Fullscreen ⌃⌘F / Hide ⌘H / HideOthers ⌥⌘H /
  Quit ⌘Q（清单留痕于 `src/keys.ts:72-79` 与 `src-tauri/src/lib.rs:183-185`、`:306-308`；
  预置 CloseWindow 的 ⌘W 已被 M149 换成不带加速键的自定义项）。应用自建菜单项里唯一
  带 accelerator 的是 `CmdOrCtrl+Q`（`src-tauri/src/lib.rs:290`）。`⇧⌘[` / `⇧⌘]` 均不在
  其中——菜单键等价只截获带 accelerator 的项（M149 对 ⌘W 的实证），所以这两个键会
  到达 webview 的 keydown。
- **系统级**：macOS 不给系统菜单预置 `⇧⌘[` / `⇧⌘]`（窗口循环键是 ⌘`；AppKit 的
  「Show next/previous tab」预置是 ⌃⇥ 系）。Safari / Firefox 自身把这对键用作标签循环
  （WebKit 官方快捷键文档：Show next tab `⇧⌘}`、Show previous tab `⇧⌘{`，
  [webkit.org/web-inspector/keyboard-shortcuts](https://webkit.org/web-inspector/keyboard-shortcuts/)）——
  本 change 正是把这个惯例接进应用内，不构成对系统键的抢占。

### 1.3 验收套件现状

- 既有标签场景 `scripts/acceptance/scenarios/14-tabs.md:49-51` 已用 `do: key` +
  `key: "ctrl+tab"` 覆盖 `⌃⇥` 循环；场景 45 按同一注入通道覆盖 `⌘}` / `⌘{`，
  键名形态用 xdotool 风格（KimiCU `press_key` 的 DSL，`scripts/acceptance/lib/cu.mjs:
  143-145` 透传）——实现期先试 `cmd+shift+bracketleft` / `cmd+shift+bracketright`，
  以回读到的实际激活标签为判据，不以注入自报为准（REVIEW.md 第 11 条丢键防线：
  断言走「回读 + 只在字节未变才重试」）。

## 2. 命令设计（D1/D3 推荐项的展开）

- **零新命令**：复用 `tab.next` / `tab.prev`。命令实现、作用域派生（global）、
  [keys] 可重绑 / 解绑、面板收录全部沿用 M149 既有路径，本 change 只新增「键 → 命令」
  的两条对应。语义边界一字不动：环绕切换（`cycleTab` 既有行为）、少于 2 个标签无操作、
  未命名文档不是标签（`visibleTabs` 过滤）。
- **D1 = 环绕**：`cycleTab` 的模运算就是环绕；若选「停住」，要么给命令加参数通道
  （违反「命令层没有参数通道」的既有口径），要么分叉出第二条实现（同一语义两处真源，
  REVIEW.md 第 8 条）。环绕与 `⌃⇥` 及 WebKit / Safari 的标签循环键行为一致。
- **默认绑定表落点**（`src/keys.ts` 的「全局：标签（M149）」区段，`:387-391`）：

  ```ts
  { key: "Cmd-}", command: "tab.next", scope: "global", doc: "…" },
  { key: "Cmd-{", command: "tab.prev", scope: "global", doc: "…" },
  ```

  doc 字段各写清三件事（沿袭 M149 的留痕纪律）：方向映射依据（WebKit 惯例：
  `}` = next、`{` = prev）；token 形态依据（`{` ∈ SHIFT_IMPLIED_KEYS，写
  `Cmd-Shift-[` 永不命中，机制见 §1.1）；冲突核对结论（§1.2 三条来源零冲突）。
- **不变量自动覆盖**：构造期重复绑定检查、attach 期缺实现检查、`tests/unit/
  keys.test.ts` 的孤儿命令 / KEYLESS 对账（每条 COMMAND_IDS 要么有绑定要么在
  KEYLESS_COMMAND_IDS）对两条新绑定自动生效，不为新条目新写表级断言——先例 =
  list-tab-indent tasks §1.3。可加一条「`Cmd-}` → `tab.next`」定点断言比照既有
  `Ctrl-Tab` → `tab.next` 断言（`tests/unit/keys.test.ts:118`），非必须。
- 渲染层 / 保存 / dirty / 撤销 / 原生菜单：零改动。

## 3. spec 增量形态

MODIFIED `keymap-commands` 的 requirement「标签命令族——关闭 / 循环切换 / 序号直达」
（living spec `openspec/specs/keymap-commands/spec.md:424-455`）：默认绑定句加
`⌘}` → `tab.next`、`⌘{` → `tab.prev`（`⌘}` 物理为 `⇧⌘]`，`⌘{` 物理为 `⇧⌘[`，
token 形态 `Cmd-}` / `Cmd-{`）；新增一条 scenario 钉住「同一命令两条绑定同语义 +
环绕 + 边界无操作」。delta 全文见 `specs/keymap-commands/spec.md`。

## 4. 被否决方案

- **新增独立命令 id（如 `tab.cycle-next`）**：语义与 `tab.next` 逐字相同，制造
  「两条 id 同一语义」的幻影，[keys] 与面板反而要回答「这两条有什么区别」。
- **「停住不环绕」**：见 §2 D1——需要命令参数通道或第二份实现，两者都贵于收益；
  且与既有 `⌃⇥` 行为分叉。
- **同时绑 `⌘[` / `⌘]`**：Safari 前进 / 后退的惯例键，本仓无对应语义；Alex 原话
  只点名 `{` / `}`。留空（Non-goal），用户可经 [keys] 自绑。
- **同步绑 Emacs 风格备选（D2-b）**：Emacs 无规范 buffer 循环键，`C-x ←/→` 是多段
  chord 而本版键位层不支持（`applyKeyOverrides` 拒绝含空白键位，
  `src/keys.ts:530-533`）；占位自造键位纯属猜测。
- **写 `Cmd-Shift-[` 形态的绑定**：永不命中的静默失配（§1.1 归一化机制）——这正是
  M195 注释段钉过的同一类坑，写进 doc 防回潮。
