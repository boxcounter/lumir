---
# 场景草案（M268 提案期产物）：实现期落到 `scripts/acceptance/scenarios/60-vault-switch-restore.md`，
# 并按 `node scripts/acceptance/run.mjs --check` 与一次真机运行核对后再勾 tasks。编号见 proposal 的编号声明。
id: "60-vault-switch-restore"
item: 268
title: vault 切换的写盘段反馈与「标签栏当帧齐、正文按需装载」
fixtures: [note.md, plain.md, tabs-a.md, tabs-b.md, links.md, table.md]
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
  # A 的会话 = 若干 fixture 标签（数量按实现期的读数需要定；**不要**为了撑窗口往会话里塞大文件，
  # M252 那条口径只服务于「指示是否在场」的瞬时观测，本场景要验的是标签当面与按需装载）。
  sessions:
    acc-a:
      tabs: [plain.md, note.md, tabs-a.md, tabs-b.md, links.md, table.md]
      active: plain.md
steps:
  - name: 起始态：A 已装载、会话标签恢复完成
    do: settle
    expect:
      - label: 当前 vault 是 A
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }
      - label: 会话里的标签都在
        ax: { count: { pattern: "关闭 ", exact: 6 } }
      - shot: 01-起始态

  - name: 制造 dirty（写盘段反馈的前置状态）
    do: type
    text: "M268 写盘段"
    expect:
      - label: 编辑器里有了刚输入的内容
        editor: { has: "M268 写盘段" }

  - name: Cmd-o 打开列表，点 B 行（dirty ⇒ 守卫浮条）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开
        ax: { has: "选择一个目录作为新 vault" }
  - name: 点 B 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
    expect:
      - label: 守卫浮条给出三条出口（dirty 拦下）
        ax: { has: "保存并切换" }
      - label: 此刻 MUST NOT 有装载指示（还没开始干活）
        ax: { not: "AXProgressIndicator" }
      - shot: 02-守卫浮条

  - name: 选「保存并切换」：指示应当覆盖写盘与随后的装载（本 change 修的缺口）
    do: click
    target: { role: AXButton, any: "/保存并切换/" }
    expect:
      - label: 选定出口后指示在场（写盘 + 装载 + 恢复的窗口内）
        ax: { has: "AXProgressIndicator" }
      - shot: 03-出口后立即

  - name: B 装载完成
    do: settle
    expect:
      - label: 指示已退场
        ax: { not: "AXProgressIndicator" }
      - label: 当前 vault 换成 B
        ax: { has: "vault：lumir-m102-acceptance-b（点击查看全部 vault）" }
      - shot: 04-B-稳定态

  - name: 切回 A：标签栏与激活项
    do: key
    key: "cmd+o"
  - name: 点 A 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance [0-9]+ 个标签/" }
    expect:
      - label: 浮层收起
        ax: { not: "选择一个目录作为新 vault" }
  - name: 装载完成
    do: settle
    expect:
      - label: 标签栏完整（6 个）
        ax: { count: { pattern: "关闭 ", exact: 6 } }
      - label: 激活项是存储里的那个（plain.md 的正文在场）
        editor: { has: "plain" }
      - label: 指示已退场
        ax: { not: "AXProgressIndicator" }
      - shot: 05-切回A

  - name: 按需装载的可观察面：点一个非激活标签，它的正文应当出现
    do: open
    file: table.md
    marker: "|"
    expect:
      - label: 该标签的正文已装载
        editor: { has: "|" }
      - label: 标签数不变（没有因为装载而多出标签）
        ax: { count: { pattern: "关闭 ", exact: 6 } }
      - shot: 06-按需装载

  - name: 会话快照未被截断（纯惰性案的致命症状：标签被写成 1 条）
    do: sleep
    ms: 1500
    expect:
      - label: A 的会话文件仍是 6 条（等过 1s 防抖窗口后会话已落盘）
        file: { path: "env:lumir/vault-sessions/acc-a.json", has: "table.md" }
      - shot: 07-会话快照
---

# 场景说明（人读）

判据挂在三件事上：

1. **写盘段反馈**：dirty → 守卫浮条（此刻 MUST NOT 有指示，负向配对）→ 选「保存并切换」→ 指示在场。这是 M268 修的缺口在真机上的唯一正面证据。
2. **标签当面**：切回 A 后标签栏是完整的 6 个、激活项正确。
3. **按需装载的正面证据**：点一个非激活标签，它的正文出现——按需实现若把「激活时装载」做丢，这一步会红（打开的是空文档）。

## 覆盖边界（如实记录，别读成「已覆盖」）

- **「指示起于写盘之前」这件事本场景分辨不了**：套件单次 AX 快照的往返延迟是秒级（M252 实测记在场景 49 的覆盖边界里），而一次写盘的窗口是十毫秒级（M154：fsync ≈4ms、1MB ≈10ms）。第 5 步的「指示在场」证明的是「选定出口之后、装载完成之前的窗口里有指示」，**不能**证明它起于写盘前。要真正分辨，需要在实现期做一次一次性探针（在 `saveAll` 里临时注入几百毫秒延迟，量「指示与写盘谁先到」，探针代码随后回退、现场留档）——这也是本 change 反向验证的落点（REVIEW.md 第 1 条：先造一个必须让它 FAIL 的输入）。
- **「标签栏当帧齐」同样分辨不了**：eager（今天）与 shell+按需的差别落在装载窗口内的几百毫秒（读数为证），快照延迟秒级 ⇒ 两者的终态断言相同。这条判据的强度靠读数（`vault_load_restore` 的真机数字）与代码结构，不靠本场景。本场景在这里提供的是**回归保护**（别把标签栏弄丢）与**按需路径的正面证据**。
- **耗时不做断言**（机器间抖动，REVIEW.md 第 3 条同族问题）：三段读数走 `env:lumir/logs/*.jsonl` 的 `vault_load_*`，实现期把读数截进证据目录供人读（`test-results/`，git 外），不做阈值判定。
- **fixture 与会话条数在实现期核定**：上面 `tabs` 的 6 条是按草案写的，实现期 SHALL 按 `scripts/acceptance/fixtures/`（与 `second-vault/`）实际存在的文件名核定，并核 `run.mjs --check` 通过。**不要**沿用场景 49 的 8MB 稀疏放大器——它服务的是「撑开观察窗」，会掩盖本场景要验的东西。
- **第 9 步的 mtime/sha 口径**：会话落盘是防抖写入（1s），`sleep 1500` 后断言文件内容含 `table.md`。若实现期的防抖参数调整，这条的等待时长要跟着调；断言只判内容，不判 mtime。
