---
# M312（现有缺陷修复，非 backlog「待真机验收」项 78 那个编号）：backlog「记录在案」①——harness
# 事件流带 vault/会话标识、面板按当前 vault 过滤，与「切 vault 后面板不刷新」一并修。本场景是
# 这条修复的**合同**：切 vault 后面板必须显示当前 vault 的会话（B 是空的就回空态），另一 vault
# 的对话（包括切走之后才到达的在途事件）不得串进来。
id: "78-harness-vault-scope"
item: 78
title: 切 vault 后 harness 面板显示当前 vault 的会话（另一 vault 的对话不串台）
open: harness-note.md
marker: "HNL-ALPHA"
# mock 的这条响应带 `delay_ms: 45000`（M312 为验收新增的脚本化延迟）：回合会在途 45 秒，
# 切换动作（⌘O + 点行 + 装载，AX 读取是秒级的）落得进这个窗口里——「切换发生在回合进行中」
# 正是事件过滤要验的现场，毫秒级响应下这个窗口不存在。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-vault-scope.json"
seed:
  # 两个 vault 都预先注册（`$vault2` 的记号解析见套件 README）：本场景验的是**切换**，
  # 不是「第一次把目录加进列表」（那条链路真机未覆盖，见 README 的已知边界）。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  - name: ⌘⇧A 唤起面板（当前 vault = A）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板出现（发送钮在场 = 本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: transcript 是空态提示（它只在 transcript 没有子节点时挂上）
        ax: { has: "与当前文档对话" }
      - shot: 01-A-面板唤起

  - name: 在 A 里输入提问标记（两串字符两个 vault 都不复现）
    do: keys
    keys: ["a", "l", "p", "h", "a", "o", "n", "l", "y"]
    expect:
      - label: 标记落在 composer 里（注入落地）
        ax: { has: "alphaonly" }

  - name: 发送——回合进入在途（mock 这条响应要睡 45s）
    do: key
    key: enter
    expect:
      - label: 提问回声渲染在 A 的 transcript 里（回合真的开始了）
        ax: { has: "alphaonly" }
      - label: 此刻回答还没到（这一步钉住「我们确实在在途窗口里」）
        ax: { not: "VSWITCH-A" }
      - shot: 02-A-回合在途

  - name: ⌘O 打开 vault 列表
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开且 B 的行在位
        ax: { has: "/lumir-m102-acceptance-b/" }

  - name: 点 B 行——此刻 A 的回合仍在途
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }

  - name: 等切到 B 的装载跑完（状态驱动，不用 settle 猜装载时长）
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000

  # ── 判据一：切 vault 后面板换成本 vault 的会话 ─────────────────────────────
  # 修复前：面板没有任何切 vault 的刷新路径，DOM 里还是 A 的 transcript（提问回声与回答都在），
  # 空态提示因为 transcript 非空而不会挂上——下面两条负向 + 一条正向一起判红。
  - name: 切到 B 后面板 = B 的会话（空态），A 的对话不留在面板里
    do: settle
    expect:
      - label: 面板仍在（正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: transcript 回到空态提示（B 还没有会话）
        ax: { has: "与当前文档对话" }
      - label: A 的提问没有留在 B 的面板里
        ax: { not: "alphaonly" }
      - label: A 的回答没有留在 B 的面板里
        ax: { not: "VSWITCH-A" }
      - shot: 03-B-空态

  # ── 判据二：切走之后才到达的在途事件被丢弃（事件带 vault 标识）─────────────
  # 走到这里时 A 的回合仍在途（mock 延迟 45s，前端从上面那一步起一直停在 B）。再等过延迟点，
  # 让 A 的回答**在 B 显示期间**发射出去：
  #   - JSONL 断言证明这一轮真的跑完了（`assistant_text` 是回合终点的盘上事实，不是猜时长）；
  #   - B 的面板里既没有回答也没有提问 —— 修复前这两个 text_chunk 会直接渲染进 B 的 transcript。
  # 45s 的 sleep 是「等一个已知时长的在途回合落地」，不是猜装载时长（那类等待一律用 waitFor）。
  - name: 等到 A 的回合结束（前端这段时间一直停在 B）
    do: sleep
    ms: 45000
    expect:
      - label: A 的回合真的完成了（盘上留存的 assistant_text）
        file: { path: "env:harness/*.jsonl", has: "VSWITCH-A" }
      - label: 回答在途落到 B 时被丢弃
        ax: { not: "VSWITCH-A" }
      - label: A 的提问也没有串台
        ax: { not: "alphaonly" }
      - label: B 的面板仍是空态
        ax: { has: "与当前文档对话" }
      - shot: 04-B-回合结束后

  # ── 判据到此为止（为什么不判「切回 A 看得到自己的会话」，见文末覆盖边界）────────────
---

# 场景说明（人读）

判据两件事，都是用户能观察到的：

1. **切 vault 后面板显示当前 vault 的会话**：A 里有一段对话 → 切到 B（B 没有会话）→ 面板必须
   回到空态，A 的提问与回答都不在。修复前面板没有切 vault 的刷新路径（只在挂载时拉一次
   `harness_state`），DOM 里一直是 A 的 transcript。
2. **切走之后才到达的在途事件不串台**：A 的回合在切换时仍在进行（mock 延迟 45s），前端停在 B
   期间回答才发射——`harness:event` 带 vault 标识后，面板按当前 vault 过滤，这些事件被丢弃。

## 判据为什么这样写

- **空态提示是「transcript 为空」的构造性判据**：`syncEmptyHint()` 只在 transcript 没有子节点时
  把提示挂进去、有内容就摘掉。因此「提示在场」等价于「transcript 是空的」——它同时是负向断言
  （A 的内容不在）的**正观测**：读不到 transcript 与 transcript 为空不是一回事（REVIEW.md 第 2 条）。
- **JSONL 是「回合终点」的盘上事实**：`assistant_text` 记录只在这一轮结束时落盘，用它把「等 45s
  之后回答确实已经发射过」钉死，避免「负向断言在事件根本没来时空过」这一类假绿（REVIEW.md 第 1 条）。
- **两串标记都是本场景独有**：`alphaonly` 只由本场景注入；`VSWITCH-A` 只由本场景的 mock fixture
  产出（fixture 里没有第二个 vault 的响应，本场景也不在 B 里发送提问——mock 每次发送都从脚本头
  重新弹起，在 B 里发送会拿到同一条延迟响应，反而把判据搅浑）。

## 覆盖边界（如实记录）

- **「面板按当前 vault 过滤事件」这条判据依赖时序**：需要切换动作在 mock 的 45s 延迟窗口内完成
  （切换的时间线在 `steps.md` 的步骤耗时里可复核）。若某次运行里切换慢到这个窗口之外，判据二会
  退化成「空过」（回答落在 A、B 面板本来就看不到它）——判据一不受影响（它不含时序假设）。因此
  **本场景 PASS 必须连同时序一起读**，不要把它当成与时间无关的判据。
- **「切回 A 看得到自己的会话」不判**（本条是覆盖缺口，不是已覆盖）：本场景最早写过这一步，
  实现后实测判红，根因**不在本修复面**——harness 会话以 vault 根路径字符串为键，而同一个 vault
  在本次现场有两种拼写：启动恢复用的是配置里的 `last_vault`（验收套件写的是 `/tmp/lumir-m102-acceptance`），
  切回时走的是注册表里的规范化路径（`/private/tmp/lumir-m102-acceptance`，`reconcile_vault` 的产物）。
  两次打开因此各自建了一个会话，切回时那个（空）会话才是「当前 vault 的会话」——面板显示空态是
  **如实**的。证据：`env:harness/*.jsonl` 的文件名（后端会话键）是 `_x2ftmp_x2flumir-m102-acceptance.jsonl`
  即 `/tmp/...`，而同时刻的注册表项与 app 自己写回的 `last_vault` 都是 `/private/tmp/...`。
  这条缺陷（同一 vault 两种拼写 ⇒ 两个会话、切回后对话不可见）已作为 finding 上报，修它要动
  `src-tauri/src/commands.rs` 的打开路径（不在本 mission 的 scope），故本场景不断言它。
- **不验「B 里也能发起新对话」**：本场景的 mock 只有一条响应（理由如上），在 B 里发送会拿到
  同一条延迟响应。B 的会话可用性由场景 70–77 在同一代码路径上覆盖（面板发送链路不因本修复变化）。
- **不验跨 vault 的批准闸**：批准请求的归属靠 `harness_state` 快照的 `pending_approval`（本修复
  只管面板刷新与事件过滤），它的真机覆盖见场景 72/73。
