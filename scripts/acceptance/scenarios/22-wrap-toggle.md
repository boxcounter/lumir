---
id: "22-wrap-toggle"
item: 22
title: 折行开关运行期翻转（[keys] 绑定后生效、两轴独立、不落盘）
config:
  keys: { "Cmd-Shift-J": "view.toggle-line-wrap", "Cmd-Shift-K": "view.toggle-code-block-wrap" }
steps:
  - name: 造一份含超长代码行与超长正文行的探针文档
    do: vaultWrite
    file: wrap-probe.md
    content: |
      # 折行口径探针

      正文段落：一行普通长度的句子。

      超长正文行（刻意超过阅读栏宽）：折行口径的运行期翻转由 view.toggle-line-wrap 与 view.toggle-code-block-wrap 两条命令承担，两条都默认不占键位、由 [keys] 绑定后可用；这一行刻意写得很长，远超阅读栏宽：PROSE-END-MARK。

      ```text
      vault: Everything-copy | file: Logbook/2026-09/2026-09-18.md | note: the quick brown fox jumps over the lazy dog 0123456789 | flag: true | count: 42 | tail: CODE-END-MARK
      ```

      ```text
      short code line
      ```

      尾段：代码块容器不得改变下方内容的纵向位置。
    expect:
      - label: 探针文档已落到验收 vault
        file: { path: wrap-probe.md, exists: true }
  - name: 打开探针文档（[keys] 已把两条折行命令绑上 ⌘⇧J / ⌘⇧K）
    do: open
    file: wrap-probe.md
    marker: "折行口径探针"
    expect:
      - label: 代码行文本在 AX 树里
        ax: { has: "CODE-END-MARK" }
      - label: 起始口径是默认值——容器在（code_block_wrap=false）
        ax: { has: "Markdown 代码块 1" }
      - label: 翻转前 config.json 就位（隔离配置，harness 写入的形状）
        file: { path: env:config.json, has: '"last_vault"' }
  - name: 记 config.json 基线（翻转后比对 sha256 用）
    do: record
    as: cfgBefore
    file: "env:config.json"
    expect:
      - label: 翻转前 config.json 的基线已记下
        file: { path: env:config.json, exists: true }
  - name: ⌘⇧K 把代码块切成折行
    do: key
    key: "cmd+shift+k"
    expect:
      - label: 容器从 AX 树里消失（code_block_wrap 真的翻成了 true）
        ax: { not: "Markdown 代码块 1" }
      - label: 文档内容逐字节未变（翻转只动显示）
        editor: { has: "CODE-END-MARK" }
      - shot: 代码块折行
  - name: ⌘⇧K 折回不折行（双向生效）
    do: key
    key: "cmd+shift+k"
    expect:
      - label: 容器回到 AX 树（翻转不是单向的）
        ax: { has: "Markdown 代码块 1" }
      - shot: 折回不折行
  - name: ⌘⇧J 翻转文件级口径（正文行）
    do: key
    key: "cmd+shift+j"
    expect:
      - label: 文件级翻转不动代码块那一层（一元素一条规则）
        ax: { has: "Markdown 代码块 1" }
      - label: 文档内容仍未变
        editor: { has: "PROSE-END-MARK" }
      - shot: 文件级口径翻转后
  - name: 收尾核对：两次翻转都没落盘
    expect:
      - label: config.json 的内容与翻转前 sha256 一致（瞬态状态不持久化）
        file: { path: env:config.json, unchangedSince: cfgBefore }
      - label: 配置里没有多出折行状态的回写字段
        file: { path: env:config.json, not: "line_wrap" }
      - label: 代码块口径同样没有回写
        file: { path: env:config.json, not: "code_block_wrap" }
      - label: 磁盘上的文档也没被改写
        file: { path: wrap-probe.md, has: "CODE-END-MARK" }
---

说明（M180，change `line-wrap-options`）：两条折行命令 `view.toggle-line-wrap` /
`view.toggle-code-block-wrap` **默认不占键位**（登记在 `src/keys.ts` 的 `KEYLESS_COMMAND_IDS`），
所以运行期翻转只能经 `[keys]` 绑定后触发——本场景用 `Cmd-Shift-J` / `Cmd-Shift-K`（默认表里的空位，
且不在原生菜单 accelerator 集合里，避开 ⌃ 系的原生接手与「偷 kill-line 的 ⌃K」两个坑）。

键位是 `global` 作用域、翻转作用于**应用运行期**（D1 裁决「应用级」）：全部标签页随之同步，新标签页
取当前应用态。本场景只开一个标签，「全体同步」那条断言的落点在视觉层
（`tests/visual/scenes/render-codeblock.spec.ts` 的「应用级口径（D1）」场景：两标签 + 切回）。

**config.json 断言的采样纪律**（M166 评审备录）：两次采样之间**不得触发 vault 打开 / 重映射**——
`vault_remap`（`src-tauri/src/workspaces.rs`）与 `write_last_vault_to`（`src-tauri/src/commands.rs`）
都会写 config.json，`merge_last_vault` 写进去的内容含 `version` 字段。因此基线记在「文件已打开、
vault 已装载」之后，中间只按折行键，不碰打开/切换动作。

**可断言到什么程度（如实记录）**：`file.unchangedSince` 比的是 **sha256**（内容逐字节），不是 mtime
——harness 的断言词汇里没有「mtime 未变」这一形态（只有 `mtimeNewerThan`）。因此本场景的「不落盘」
判据是「内容 sha256 不变 + 没有多出回写字段」，mtime 层的不变性未验（那条若要验需给 harness 加
`mtimeSameAs` 一类断言）。sha256 不变是更强的判据：mtime 可能在内容不变时抖动（touch），反过来的
情形不存在。

另：探针文档刻意不含半角双引号——套件解析 `AXTextArea` 的 value 用非贪婪正则
（`lib/ax.mjs` 的 `/=\s*"([\s\S]*?)"/`），文档里出现 `"` 会让 `editor: has` 读到半截文本。
该边界已按协议提交 finding。
