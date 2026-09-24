---
id: "16-startup-restore"
item: 16
title: 启动自动恢复 last_vault（终态与失效路径）
fixtures: [plain.md]
steps:
  - name: 默认 config 启动（last_vault = 验收 vault）自动进入 vault
    expect:
      - label: 树已装载验收 vault 的文件
        ax: { has: "plain.md" }
      - label: 无「恢复中」残留（进行态已落到终态）
        ax: { not: "正在恢复上次打开的 vault" }
      - label: 未出现恢复失败提示
        ax: { not: "上次打开的 vault 已不可用" }
      - shot: 自动恢复后的终态
  - name: last_vault 指向不存在的目录后重启（失效路径）
    do: configWrite
    lastVault: /tmp/lumir-m159-no-such-vault
    requireVault: false
    expect:
      - label: 进入未打开空态并给出失效原因（人话提示，文案与既有实现逐字一致）
        ax: { has: "上次打开的 vault 已不可用" }
      - label: 空态说明行在位（复用未打开空态布局，不是空白区域）
        ax: { has: "打开一个目录作为 vault" }
      - label: 「打开 vault」入口可用（按钮在 AX 里可见，与空态说明行不是同一条）
        ax: { has: "/AXButton[^\\n]*打开 vault/" }
      - label: 失效路径的终态不残留「恢复中」
        ax: { not: "正在恢复上次打开的 vault" }
      - label: 树里没有装载任何 vault 文件（失效的 last_vault 未被打开）
        ax: { not: "plain.md" }
      - shot: 失效路径的未打开空态
---

说明：本场景覆盖 `openspec/changes/archive/2026-09-18-startup-restore-off-main-thread/` 的两条机器可判路径
（tasks 3.3）——① 默认 config 启动后自动进入 vault 且不残留「恢复中」；② `last_vault` 失效时
进入未打开空态 + 既有失效提示 + 「打开 vault」入口。

判定口径与边界：

- **「恢复中」态本身不进本场景的断言**。恢复在典型 vault 上远比前端挂载快，那一态通常不可见；
  这里断言的是**它没有残留**（`ax: { not: "正在恢复上次打开的 vault" }`）——该串只可能由
  `src/main.ts` 的 `RESTORING_NOTICE`（文案-Copy.md D95）产生，因此「不残留」是可判定的：若
  恢复完成信号丢失或 `restore_pending` 未清，这一行会一直显示在空态里，断言即 FAIL。
- **「打开 vault」入口的断言带 role 前缀**：空态说明行「打开一个目录作为 vault」也含「打开 vault」
  这四个字，裸子串在这个空态里恒真；`/AXButton[^\n]*打开 vault/` 要求它在**按钮节点行**上
  （AX 行格式 `- [n] AXButton (名) …`），才是真正的入口（M148 实证的同族陷阱：断言看着更强、
  实际等价于子串）。**M211 起这条判据的旧对照物消失**：旧 masthead 的「未打开 vault」文案随
  masthead 整块删除（该串在 `src/` 已零命中），role 前缀因此改为对着空态说明行这条真正的同族子串。
- **失效路径允许空态**：第 2 步的 `requireVault: false` 只放宽**本步重启的就绪门**（未打开空态
  时树 pane 里没有 `.md` 行，严格门必不成立）；终态仍由上面五条断言证明，不是「放宽即放行」。
- **不点「打开 vault」按钮**：它会拉起系统目录选择器（rfd 原生对话），真机上无法可靠自动收起；
  「入口可用」的判据是按钮在 AX 树里可见，点击后的装载链路由既有场景（07/14）与 chromium
  场景覆盖。
- 恢复耗时与首帧的手感（「树晚出现」的观感）是手感项，不下沉；截图证据在第 1 步的 shots 里。
