---
id: "29-typography-and-zoom"
item: 29
title: 排版与字号步进：配置字号端到端生效、⌘= / ⌘− / ⌘0 / ⌘⇧= 的可见结果、config.json 与源文件逐字节不变
fixtures: [toc-long.md]
open: toc-long.md
marker: "第 1 章 概览"
steps:
  - name: 出厂口径前置（15px，D1 裁决的出厂锚）：第 1、3 章都在渲染行里（档位判据的基线）
    do: settle
    expect:
      - shot: 出厂口径-15px
      - label: 第 1 章在渲染行里
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 3 章也在渲染行里（32px 档它必然消失，见下）
        ax: { has: "第 3 章 概览 第 3 章概览正文。" }

  - name: 配置面前置：隔离 config.json 存在且此刻没有 font_size
    do: settle
    expect:
      - label: 隔离 config.json 存在（否则后面的「不变」在空值上恒真）
        file: { path: "env:config.json", exists: true }
      - label: 配置里此刻没有 font_size（下面那次 configWrite 才是它出现的唯一原因）
        file: { path: "env:config.json", not: "font_size" }

  - name: 记录源文件基线（ADR 0003 §3：显示层改动绝不写源文件）
    do: record
    as: 长文文件
    file: toc-long.md

  - name: 配置通道端到端：font_size 32 写进隔离配置并重启（配置面的唯一入口）
    do: configWrite
    fontSize: 32
    expect:
      - label: 隔离 config.json 现在写着 font_size 32
        file: { path: "env:config.json", has: '"font_size": 32' }

  - name: 重启后重新打开同一文件（全新装载，AX 快照因此是新鲜的）
    do: open
    file: toc-long.md
    marker: "第 1 章 概览"
    expect:
      - shot: 配置32px
      - label: 第 1 章仍在渲染行里（视口没被推到文末/篇首）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 3 章**已不在**渲染行里——配置的 32px 真的生效了（出厂 15px 时它会在场）
        ax: { not: "第 3 章 概览 第 3 章概览正文。" }

  - name: 建立编辑器焦点（键盘注入的前置；⌘ 系绑定是 global，但注入要落在前台窗口里）
    do: clickEditor
    expect:
      - label: 文档已装载（编辑器里能读到首章标题）
        editor: { has: "第 1 章 概览" }

  - name: 记录**写后**基线：configWrite 与启动恢复的 last_vault 写回都已发生之后
    do: record
    as: 配置写后基线
    file: "env:config.json"
    expect:
      - label: 写后基线取自确实含 font_size 32 的那份文件（基线内容本身是判据的前提）
        file: { path: "env:config.json", has: '"font_size": 32' }

  - name: 记录键盘段之前的编辑器文档文本（末步做逐字节比较）
    do: recordEditor
    as: 键盘前文档
    expect:
      - label: 编辑器文本可读（读不到一律 FAIL，不允许在空值上比较）
        editor: { has: "第 1 章 概览" }

  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: ⌘− 连按十次（32 → 12px 下限；单批跨 3s+，留两次丢键余量）
    do: keys
    keys: ["cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus"]
    gapMs: 260

  - name: 注入前确保窗口在前台（被遮挡时 KimiCU 自报 occluded，注入可能整批丢键）
    do: focusWindow

  - name: 关掉当前标签（⌘W）——AX 渲染行快照只在**重新装载**时才刷新（见正文「判据形态」）
    do: key
    key: "cmd+w"

  - name: 重新打开同一文件（同字号、全新装载）：字号变小到 ≤17px 档：第 3 章回到渲染行里
    do: open
    file: toc-long.md
    marker: "第 1 章 概览"
    expect:
      - shot: ⌘−缩小后重装
      - label: 第 1 章在渲染行里（视口在篇首——判定不建立在「整页跳走」上）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 3 章**在**渲染行里（字号变小到 ≤17px 档：第 3 章回到渲染行里）
        ax: { has: "第 3 章 概览 第 3 章概览正文。" }

  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: ⌘0（单键重置回配置值）
    do: key
    key: "cmd+0"

  - name: 注入前确保窗口在前台（被遮挡时 KimiCU 自报 occluded，注入可能整批丢键）
    do: focusWindow

  - name: 关掉当前标签（⌘W）——AX 渲染行快照只在**重新装载**时才刷新（见正文「判据形态」）
    do: key
    key: "cmd+w"

  - name: 重新打开同一文件（同字号、全新装载）：回到**配置值 32**（出厂 15px 时它会在场）：第 3 章被挤出
    do: open
    file: toc-long.md
    marker: "第 1 章 概览"
    expect:
      - shot: ⌘0重置后重装
      - label: 第 1 章在渲染行里（视口在篇首——判定不建立在「整页跳走」上）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 3 章**不在**渲染行里（回到**配置值 32**（出厂 15px 时它会在场）：第 3 章被挤出）
        ax: { not: "第 3 章 概览 第 3 章概览正文。" }

  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: ⌘− 连按十次（回到 12px 档，为放大那条准备）
    do: keys
    keys: ["cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus"]
    gapMs: 260

  - name: 注入前确保窗口在前台（被遮挡时 KimiCU 自报 occluded，注入可能整批丢键）
    do: focusWindow

  - name: 关掉当前标签（⌘W）——AX 渲染行快照只在**重新装载**时才刷新（见正文「判据形态」）
    do: key
    key: "cmd+w"

  - name: 重新打开同一文件（同字号、全新装载）：已回到小字号：第 3 章在渲染行里
    do: open
    file: toc-long.md
    marker: "第 1 章 概览"
    expect:
      - shot: ⌘−到下限后重装
      - label: 第 1 章在渲染行里（视口在篇首——判定不建立在「整页跳走」上）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 3 章**在**渲染行里（已回到小字号：第 3 章在渲染行里）
        ax: { has: "第 3 章 概览 第 3 章概览正文。" }

  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: ⌘=（放大键的正键形态）连按十二次（12 → 32 到顶）
    do: keys
    keys: ["cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals"]
    gapMs: 260

  - name: 注入前确保窗口在前台（被遮挡时 KimiCU 自报 occluded，注入可能整批丢键）
    do: focusWindow

  - name: 关掉当前标签（⌘W）——AX 渲染行快照只在**重新装载**时才刷新（见正文「判据形态」）
    do: key
    key: "cmd+w"

  - name: 重新打开同一文件（同字号、全新装载）：⌘= 在真机命中，字号变大：第 3 章再次被挤出
    do: open
    file: toc-long.md
    marker: "第 1 章 概览"
    expect:
      - shot: ⌘=放大后重装
      - label: 第 1 章在渲染行里（视口在篇首——判定不建立在「整页跳走」上）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 3 章**不在**渲染行里（⌘= 在真机命中，字号变大：第 3 章再次被挤出）
        ax: { not: "第 3 章 概览 第 3 章概览正文。" }

  - name: 不落盘、不碰文档、不碰源文件
    do: settle
    expect:
      - label: config.json 内容逐字节不变（字号步进 MUST NOT 回写配置）
        file: { path: "env:config.json", unchangedSince: 配置写后基线 }
      - label: config.json 的 mtime 也未推进（没有被写过同一份内容）
        file: { path: "env:config.json", mtimeUnchangedSince: 配置写后基线 }
      - label: 源文件逐字节不变（ADR 0003 §3）
        file: { path: toc-long.md, unchangedSince: 长文文件 }
      - label: 源文件 mtime 也未推进
        file: { path: toc-long.md, mtimeUnchangedSince: 长文文件 }
      - label: 编辑器文档文本逐字节不变（字号命令只改样式：不进撤销栈、不改文档、不碰 dirty）
        editor: { unchangedSince: 键盘前文档 }

---

# 排版与字号步进（M195，change typography-and-zoom）

## 这个场景验什么

真机（WKWebView）上验三件在 chromium 层验不到的事：

1. **配置通道端到端**：`font_size` 从隔离 `config.json` 经 Rust `config_get` → 前端
   `applyTypography` → `documentElement` 上的 token → 编辑器内容面，真的生效。
2. **`⌘=` / `⌘−` / `⌘0` 三条绑定的真机行为**（`⌘=` 走正键形态；`⌘⇧=` 的 `Cmd-+` 形态在注入
   通道下给不出，见「判据形态与档位标定」的末段——真机未验，如实登记）。
3. **不落盘**：命令只改应用运行期，`config.json` 与源文件的 sha256 与 mtime 全程不变。

## 判据形态与档位标定（真机实测，2026-09-24 首轮）

字号是**计算属性**，而本套件没有计算属性通道（`scripts/acceptance/README.md` 的断言表）。
因此机器判据取 **AX 渲染行**：`AXTextArea` 的文本随渲染范围变化，字号变大 ⇒ 装下的内容变少 ⇒
某些章从 AX 里消失（`28-remember-reading-position` 已用同一形态判「翻屏前后某章在不在」）。

**判据必须按实测标定，不能按「我以为的可见范围」推**——首轮（`test-results/m195/acceptance-r2-first-real-run/`）
就是这么红的：我原以为 32px 下「第 2 章」会被挤出，实测它在场（AX 文本覆盖的不止可视区，
还包括 CM 的渲染余量）。首轮实测的 AX 章界：

| 字号档 | AX 文本里最后一个「第 N 章 X」 | 第 2 章 | 第 3 章 | 第 4 章 |
|---|---|---|---|---|
| 15px（出厂，D1 裁决的锚） | 第 4 章 细目 | 在 | **在** | 在 |
| 32px（配置） | 第 2 章 深一层 | 在 | **不在** | 不在 |
| 12px（⌘− 到底） | 第 4 章 细目 | 在 | **在** | 在 |

**标定的口径变更（restyle-ui-tokens-v1 的 D1：出厂锚 16px → 15px）**：上表实测于 16px 锚，
15px 比它更小 ⇒ 同一视口装下的内容**只多不少**，因此「出厂档第 3 章在场」这条方向不变
（本场景的档位判据是「第 3 章在不在」，不是精确字号）。首轮跑 15px 锚时若该行观测到的章界
与上表不同，**按实测改上表**而不是改产品——标定数据是判据的前提，不是结论。

于是本场景的档位判据取 **`第 3 章 概览 第 3 章概览正文。`**：它在 12/15px 在场、32px 不在场，
因此「在 → 不在」只能由**字号变大到 32px 档**造成，「不在 → 在」只能由**字号变小**造成。
每条「不在」都配一条「第 1 章仍在」——否则「整页跳到文末」会让「不在」恒真（REVIEW.md 第 1 条）。

**AX 快照只在「重新装载」时刷新**（第三轮实测 + 交互实验坐实，这是本场景判据成立的关键）：

- 一次**纯 CSS 字号变化不会刷新** WKWebView 的 AX 文本快照。实测：把字号从 32px 连按 ⌘−
  降到 15px（截图已明显变小），AX 的渲染行清单**逐字不变**（仍只到第 2 章 深一层）；
  再加 ⌘0 升回 32px，AX 仍旧。用 `sleep` 等 1.5s 也不刷新。
- 而**重新装载文档**（关标签 ⌘W → 再打开）后，AX 快照立刻反映**当前**字号：
  交互实验中降到 15px 再重开，AX 渲染行一次给到第 3 章 深一层 ✓。
- 所以每个「改字号 → 判定」的循环都写成三步：**按键批次 → ⌘W 关标签 → 重新打开 → 读 AX**。
  首轮/次轮都没做这一步，红的两条（⌘0、放大）是**仪器**的错，不是产品的错——两次运行的
  `shots/` 截图都显示字号确实按预期变了（见 `test-results/m195/acceptance-r2-*/`）。

**这套仪器分辨不出 12px 与 15px**（两者 AX 渲染行清单逐字节相同）：所以本场景的结论口径是
「字号落在 32px 那一档的内 / 外」，不是「精确等于 12px」——精确档位由
`tests/unit/typography.test.ts` 的纯函数与 `tests/visual/scenes/typography.spec.ts` 的计算属性覆盖。
每个档位都有 `shot` 截图留档，人眼可复核「字确实大了 / 小了」。

**键位注入的实测纪律**（首轮踩到，都写进步骤序）：

- KimiCU 的键名是 xdotool 风格：`=` 必须写 **`equals`**（首轮写 `equal` 直接被拒：
  `error: unknown key 'equal'`），`-` 写 `minus`。数字键直接写 `0`。
- **每个键盘批次前插一步 `focusWindow`**：首轮的第二次「⌘− ×20」整批丢失（批次前后截图逐字节相同），
  而同机还跑着 Alex 的另一份 Lumire 实例（1420）——与 REVIEW.md 第 11 条「同机第二个实例显著加剧
  丢键」一致。批次因此缩短到 10–12 次（留 2–4 次丢键余量），并在每批前重新取前台。

## 基线取点自查（每个 `unchangedSince` / `mtimeUnchangedSince` 的 record 点都在该文件「最后一次写」之后）

| 基线 | record 点 | 该文件在此之后的写者 | 结论 |
|---|---|---|---|
| `长文文件`（`toc-long.md`） | 第 3 步（configWrite 之前） | 本场景无任何写 vault 的动作（字号步进只改样式；`configWrite`/`restart` 不碰 vault；无 `vaultWrite`/`type` 步） | ✅ |
| `配置写后基线`（`env:config.json`） | 第 7 步（**configWrite + 重启 + 重新打开 + 建立焦点之后**） | 写 `config.json` 的路径只有两条：① 套件自己的 `writeConfig`（第 4 步，之后不再调）；② Rust 的 `remember_open` → `remember_last_vault`，**只在用户主动打开 vault 时调**，且代码注释明确「启动恢复不调本函数」（`src-tauri/src/commands.rs:462-470`）。本场景第 4 步之后没有 vault 打开动作 | ✅ |

反面教材（r1 P1-1 的原状）：基线若取在第 4 步 configWrite **之前**，末步就是拿「写后文件」比「写前基线」——
sha256 与 mtime 都必然不同，与屏幕是否解锁无关，一跑就红。修法即上表的取点，并让基线步自己断言
「这份基线确实含 `font_size: 32`」——基线内容本身进判据，取错点会当场红在这一步，而不是拖到末步才以
「内容已变」的面目暴露。

## 已知边界（如实登记）

- 「第 3 章在 / 不在」是**AX 渲染范围装得下几章**的代理判据：它与窗口高度、`--line-height: 1.75`、
  阅读栏宽、CM 的渲染余量共同决定。窗口尺寸由套件钉死（`--config` 的窗口位置与
  `tauri.conf.json` 的 1200×800），因此档位边界是稳定的；若将来改窗口尺寸、行高或 CM 的渲染余量
  策略，本场景的档位断言需要**重新标定**（标定数据见上表，重标只需跑一次并 dump AX）。
- 分辨不出 12px 与 15px（AX 文本逐字节相同）—— 见「判据形态与档位标定」的末段。
- 覆盖不到：鼠标滚轮缩放（本 change 不做）、行宽联动（不做）、字体族配置的真机呈现
  （`font_family` / `mono_font_family` 由视觉场景 `tests/visual/scenes/typography.spec.ts`
  以计算属性覆盖；真机层没有字体族读数通道）。
