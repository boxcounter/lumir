---
id: "46-dotfile-jsonc-highlight"
item: 46
title: dotfile 与 JSONC 高亮——.gitignore / .gitattributes / x.jsonc 逐字节回读与语言登记，.secret 对照组仍纯文本；三类可编辑（编辑 → 回读 → ⌘S 落盘）
fixtures: [.gitignore, .gitattributes, x.jsonc, .secret]
steps:
  - name: 记下 .gitignore 的磁盘基线（**打开之前**——「打开不改写源文件」的判据必须早于打开）
    do: record
    as: gi 基线
    file: .gitignore
    expect:
      - label: fixture 在盘上且可读（读不到一律 FAIL，不在空值上比较）
        file: { path: .gitignore, exists: true }
  - name: 记下 .gitattributes 的磁盘基线
    do: record
    as: ga 基线
    file: .gitattributes
    expect:
      - label: fixture 在盘上且可读
        file: { path: .gitattributes, exists: true }
  - name: 记下 x.jsonc 的磁盘基线
    do: record
    as: jc 基线
    file: x.jsonc
    expect:
      - label: fixture 在盘上且可读
        file: { path: x.jsonc, exists: true }
  - name: 记下 .secret 的磁盘基线
    do: record
    as: se 基线
    file: .secret
    expect:
      - label: fixture 在盘上且可读
        file: { path: .secret, exists: true }

  - name: 打开 .gitignore：整篇回读 + 状态栏语言名 + 着色现场
    do: open
    file: .gitignore
    marker: "# 依赖目录"
    expect:
      - label: 文档文本与 fixture 整篇一致（多行整体命中，不是若干子串拼凑）
        editor: { has: "# 依赖目录\nnode_modules/\ndist/\n\n# 保留的例外\n!keep.txt\n\n*.log" }
      - label: 状态栏语言名是注册表给出的 gitignore（不是 Plain text）
        ax: { has: "/gitignore · \\d+ 行 · UTF-8/" }
      - label: 反向铺底：探针此刻不在文档里（后面可编辑冒烟的 has 才有区分度）
        editor: { not: "M233DOT" }
      - shot: 打开-gitignore
  - name: 打开没有写盘（sha256 逐字节未变；ADR 0003 §3 只读态不产生写入路径）
    expect:
      - label: .gitignore 磁盘字节未变
        file: { path: .gitignore, unchangedSince: gi 基线 }

  - name: 打开 .gitattributes：整篇回读 + 状态栏语言名 + 着色现场
    do: open
    file: .gitattributes
    marker: "# 文本规范化"
    expect:
      - label: 文档文本与 fixture 整篇一致
        editor: { has: "# 文本规范化\n*.md text eol=lf\n*.png binary\n*.jpg -diff" }
      - label: 状态栏语言名是注册表给出的 gitattributes
        ax: { has: "/gitattributes · \\d+ 行 · UTF-8/" }
      - label: 反向铺底：探针此刻不在文档里
        editor: { not: "M233ATTR" }
      - shot: 打开-gitattributes
  - name: 打开没有写盘
    expect:
      - label: .gitattributes 磁盘字节未变
        file: { path: .gitattributes, unchangedSince: ga 基线 }

  - name: 打开 x.jsonc：整篇回读 + 状态栏语言名 + 着色现场
    do: open
    file: x.jsonc
    marker: "块注释跨两行"
    expect:
      - label: 文档文本与 fixture 整篇一致
        editor: { has: "[\n  // 行注释：jsonc 支持注释与尾逗号\n  1,\n  /* 块注释跨两行\n     仍在注释里 */\n  2,\n  true,\n]" }
      - label: 状态栏语言名是注册表给出的 jsonc
        ax: { has: "/jsonc · \\d+ 行 · UTF-8/" }
      - label: 反向铺底：探针此刻不在文档里
        editor: { not: "M233JSON" }
      - shot: 打开-jsonc
  - name: 打开没有写盘
    expect:
      - label: x.jsonc 磁盘字节未变
        file: { path: x.jsonc, unchangedSince: jc 基线 }

  - name: .secret 对照组：未收录 dotfile 仍以纯文本呈现（状态栏语言名是 Plain text）
    do: open
    file: .secret
    marker: "未收录的 dotfile"
    expect:
      - label: 文档文本与 fixture 一致（原文照显，不着色也不改写）
        editor: { has: "未收录的 dotfile：按纯文本显示，不着色。" }
      - label: 状态栏语言名是 Plain text——「未收录 ⇒ 不选语言包」的结构性判据
        ax: { has: "/Plain text · \\d+ 行 · UTF-8/" }
      - shot: 打开-secret-对照组
  - name: .secret 打开没有写盘
    expect:
      - label: .secret 磁盘字节未变
        file: { path: .secret, unchangedSince: se 基线 }

  - name: 可编辑冒烟①：建立编辑器焦点（.gitignore）
    do: open
    file: .gitignore
    marker: "依赖目录"
  - name: 点击编辑器顶边取得焦点
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }
  - name: 键入探针（可编辑性的直接判据是回读文档文本，不是属性在场）
    do: type
    text: "M233DOT"
    expect:
      - label: 键入生效并回读文档文本
        editor: { has: "M233DOT" }
      - label: dirty 出现（标签读屏名，D90）
        ax: { has: "（未保存）" }
      - label: 反向：探针此刻不在磁盘上（下面 ⌘S 的落盘断言才有区分度）
        file: { path: .gitignore, not: "M233DOT" }
  - name: ⌘S 保存（chord 盲发不重试——丢键时下面的磁盘断言会红，按 README 复跑一次再判）
    do: key
    key: "cmd+s"
  - name: 等 600ms（**短于** 2s 自动保存防抖）后核对落盘
    do: sleep
    ms: 600
    expect:
      - label: 探针已落盘
        file: { path: .gitignore, has: "M233DOT" }
      - label: 同一文件的后段内容仍在（保存没有把文件写残）
        file: { path: .gitignore, has: "dist/\n" }
      - shot: 可编辑-gitignore-落盘

  - name: 可编辑冒烟②：切到 .gitattributes 并建立焦点
    do: open
    file: .gitattributes
    marker: "文本规范化"
  - name: 点击编辑器顶边取得焦点
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 键入探针
    do: type
    text: "M233ATTR"
    expect:
      - label: 键入生效并回读文档文本
        editor: { has: "M233ATTR" }
      - label: 反向：探针此刻不在磁盘上
        file: { path: .gitattributes, not: "M233ATTR" }
  - name: ⌘S 保存
    do: key
    key: "cmd+s"
  - name: 等 600ms 后核对落盘
    do: sleep
    ms: 600
    expect:
      - label: 探针已落盘
        file: { path: .gitattributes, has: "M233ATTR" }
      - label: 同一文件的后段内容仍在
        file: { path: .gitattributes, has: "*.png binary\n" }
      - shot: 可编辑-gitattributes-落盘

  - name: 可编辑冒烟③：切到 x.jsonc 并建立焦点
    do: open
    file: x.jsonc
    marker: "块注释跨两行"
  - name: 点击编辑器顶边取得焦点
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 键入探针
    do: type
    text: "M233JSON"
    expect:
      - label: 键入生效并回读文档文本
        editor: { has: "M233JSON" }
      - label: 反向：探针此刻不在磁盘上
        file: { path: x.jsonc, not: "M233JSON" }
  - name: ⌘S 保存
    do: key
    key: "cmd+s"
  - name: 等 600ms 后核对落盘
    do: sleep
    ms: 600
    expect:
      - label: 探针已落盘
        file: { path: x.jsonc, has: "M233JSON" }
      - label: 同一文件的后段内容仍在
        file: { path: x.jsonc, has: "仍在注释里" }
      - shot: 可编辑-jsonc-落盘

teardown:
  - label: 收尾：.gitignore 停在含探针的已保存形态
    file: { path: .gitignore, has: "M233DOT" }
  - label: 收尾：.gitattributes 停在含探针的已保存形态
    file: { path: .gitattributes, has: "M233ATTR" }
  - label: 收尾：x.jsonc 停在含探针的已保存形态
    file: { path: x.jsonc, has: "M233JSON" }
  - label: 收尾：.secret 未被触碰（对照组不参与编辑链路）
    file: { path: .secret, has: "未收录的 dotfile" }
---

# dotfile 与 JSONC 高亮（change dotfile-jsonc-highlight / M243）

## 这个场景验什么

Alex 请求的三类文件（`.gitignore` / `.gitattributes` / `.jsonc`）在真实 WKWebView 下的**打开与
登记**链路，加上一条未收录 dotfile 的对照，以及 M231 合入后三类文件的可编辑性：

1. **文档逐字节回读**（ADR 0003 §3）：四个 fixture 逐一打开，断言编辑器文档文本与文件内容
   **整篇一致**（多行整体命中），且打开动作没有写盘（打开前后的 sha256 比）。
2. **注册表登记真的接上了显示层**：状态栏语言名分别是 `gitignore` / `gitattributes` / `jsonc`——
   `.secret` 对照组是 `Plain text`。这四条是同一形态的断言、只有取值不同，因此互为区分度：
   若实现漏了文件名表（`.gitignore` 走扩展名 → 未收录 → 纯文本），第一条会红而第四条照绿。
3. **着色现场**（截图留档）：`.gitignore` 的注释/取反/目录标记、`.gitattributes` 的属性名与
   `attr=value` 值、`x.jsonc` 的注释与数字，以及 `.secret` 的无着色对照。
4. **可编辑冒烟**（§7.2 条件项，M231 已合入）：三类各做一次「键入 → 回读 → ⌘S → 落盘」，
   落盘判据带**反向铺底**（键入后先断言探针不在磁盘上）。

## 着色为什么只有截图、没有类名断言

本套件的断言通道里**没有 DOM 类名/计算色**：编辑器内容是 `AXTextArea.value`（渲染后的文档
文本），高亮 `<span class="cm-lp-tok-*">` 不进 AX 树。而 code 模式（整文件打开）用的不是 CSS
类名而是 `src/editor.ts` 的 `HighlightStyle` **内联色值**——即便能读到 DOM，判据形态也与围栏
侧（`cm-lp-tok-*`）不同。因此：

- **token → 颜色的类名断言**落在 `tests/unit/dotfile-jsonc.test.ts`（`highlightCode` 驱动，
  与围栏代码块同一条路径，逐 token 断言 `cm-lp-tok-*`）；
- **整文件 code 模式的 DOM / 计算色**归 chromium 视觉通道（`tests/visual/scenes/
  m120-code-highlight.spec.ts` / `m130-text-open-trap.spec.ts`），不在本 change 的施工面；
- 本场景负责真机侧的**登记与回读**（状态栏语言名 + 文档逐字节 + 截图现场）。

这一分工是**能力边界**，不是漏做：真机套件补上 DOM 断言通道属于套件自身的演进（另立 change）。

## 判据走哪几条通道（可读性如实登记）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 三类文件被注册为 code 类且带语言包 | **状态栏语言名**（`gitignore` / `gitattributes` / `jsonc`） | 它是注册表 → 会话 → 显示层这条链的**可读出口**；只看「文件打开了」分不出纯文本与带语言包 |
| 未收录 dotfile 不被误收 | **同一形态的 `Plain text` 断言**（`.secret`） | 与上一条互为对照：漏收 `.gitignore` 会让第一条红、误收 `.secret` 会让这条红 |
| 打开不改写源文件 | **打开前后的 sha256 比**（`record` → `unchangedSince`） | 只断言「内容在场」挡不住「打开时写回了同一份内容」（mtime 会动） |
| 文档与文件逐字节一致 | **整篇内容作为一条多行断言** | 套件的 `editor.has` 是子串口径；整篇命中 + 无引号 fixture（见下）下等价于逐字节 |
| 可编辑 + 落盘 | **回读文档文本 + 反向铺底 + 落盘断言** | `contenteditable` 属性在场不等于按键能进文档；反向铺底让「探针出现在磁盘」只可能由保存造成 |

## fixture 为什么都不含 `"`

`lib/ax.mjs` 用**引号奇偶**判 `AXTextArea` 多行 value 的边界，文档内容里的 `"` 会让 value 从
引号处截断（README「已知边界」）。因此 `x.jsonc` 用了**无引号形态**（数组 + 注释 + 数字/布尔），
JSON 键与字符串值的着色断言由 `tests/unit/dotfile-jsonc.test.ts` 覆盖（单元层不受此限）。
`.gitignore` / `.gitattributes` / `.secret` 本身不含 `"`。

## 已知边界

- **⌘S 是 chord，套件盲发不重试**（README）。`⟨探针已落盘⟩` 红 ⇒ 先复跑一次再判产品缺陷。
- **⌘S 与自动保存的区分窗口不在本场景**：本场景只要求「键入在文档里、探针最终在盘上」，
  不判「落盘只可能由 ⌘S 造成」（2s 防抖 vs 注入耗时的赛跑归 `41-editable-non-md-files`）。
- **不做手感判定**：配色的观感（哪一类 token 更醒目、`!` / `/` 的着色强度）归 Alex，本场景只留截图。
- **不覆盖**：① 编辑链路的完整护栏（冲突 / 撤销 / 另存为）归 `41` / `42`；② md 围栏里
  `gitignore` / `gitattributes` / `jsonc` 三个 info string 的着色由 `tests/unit/dotfile-jsonc.test.ts`
  与 `tests/visual/scenes/render-codeblock.spec.ts` 覆盖，本场景只走整文件打开。
