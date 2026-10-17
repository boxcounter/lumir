---
# M442：会话浮层「点击闪现即消失」的根因现场——vault 只有**旧布局**平铺留存（归位脚本未跑），
# 新布局列举源为空 ⇒ 清单为空。缺陷形态：setSessPop 先开出空浮层、取数 resolve 后因空清单收起
# （「闪现」）；且空清单路径**静默**（无任何反馈）。修法（合同先行，docs/specs/overlay-visibility.md
# 的 O5）：先取数、确认非空才揭示；空清单给可感知反馈（D362）。
# 本场景预置的正是这个现场（既有 106/124 都预置/产生新布局会话，清单恒非空 ⇒ 结构性看不见它）。
id: "130-harness-session-empty-flash"
item: 130
title: 会话浮层空态不闪现（M442）：vault 只有旧布局平铺留存时点会话名钮不揭示浮层、给可感知反馈
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
seed:
  # 显式注册让 vault 稳定 id = `acc-empty`（会话目录名取注册表 id）——下面 glob 断言能写死路径。
  registry:
    - { id: acc-empty, path: $vault, lastOpenedAt: 1757000002000 }
  # 旧布局现场：平铺留存落在 sessions/ 根下（产品运行时只读新布局 sessions/<id>/，根下平铺不参与
  # 列举）。本场景**不跑**归位脚本——正是「升级到新布局后、脚本未跑」的真实形态。
  harnessFlatSessions:
    - { name: "s1759913000-flat00.jsonl", vaultRoot: $vault }
steps:
  - name: 核对现场——只有旧布局平铺留存，新布局目录下零会话
    do: settle
    expect:
      - label: 平铺留存落在 sessions/ 根下（旧布局现场；未被归位）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", recursive: false, exact: 1 }
      - shot: 01-归位前的现场

  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 会话名钮落在未命名态（D330「新会话」，AXPopUpButton——本 vault 还没有会话）
        ax: { has: "/AXPopUpButton \\(新会话\\)/" }
      - label: transcript 是空态提示（无当前会话）
        ax: { has: "与当前文档对话" }

  - name: 点会话名钮展开浮层（清单为空——M442 的现场；旧布局平铺文件对新布局列举不可见）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等空清单反馈浮条出现（O5：空内容路径不得静默，必须给可感知反馈）
    do: waitFor
    waitFor:
      has: ["当前 vault 还没有对话会话"]
    timeoutMs: 15000
    expect:
      - label: 空清单反馈上屏（D362）——这是「点击确实触达了取数、且走了空清单分支」的可区分正观测；缺陷形态此路径静默（先开后收、.catch 吞错），这条必红
        ax: { has: "当前 vault 还没有对话会话" }
      - label: 浮层没有揭示——浮层行（删除该会话钮）不在 AX 里（O5：不得先开后收）
        ax: { not: "删除该会话" }
      - label: transcript 空态提示仍在（浮层连盖都没盖面板）
        ax: { has: "与当前文档对话" }
      - label: 新布局列举源确为空（sessions/<vault id>/ 下零 *.jsonl）——证明清单为空是「源真的空」，不是「没去读」
        glob: { dir: "env:harness/sessions/acc-empty", pattern: "\\.jsonl$", exact: 0 }
      - label: 旧布局平铺留存仍在原地（产品不消费 / 不迁移它——归位是脚本的事）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", recursive: false, exact: 1 }
      - shot: 02-空清单反馈

  - name: 再点一次会话名钮（空态下重复点击仍不把浮层打开——幂等）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 复核浮层仍未揭示
    do: settle
    expect:
      - label: 重复点击后浮层仍不开（无浮层行）
        ax: { not: "删除该会话" }
      - label: 会话名钮仍是未命名态（重复点击不改会话）
        ax: { has: "/AXPopUpButton \\(新会话\\)/" }
      - shot: 03-重复点击仍不开
---

# 130-harness-session-empty-flash —— 会话浮层空态不闪现（M442）

## 本场景在验什么

Alex 原话：「harness pane 顶部的会话列表点击不展开列表了。点击时会闪现一个小浮层、但瞬间
消失。」M441 诊断（survey）判死根因：M433 会话清单改单读**按 vault 分目录**布局
（`sessions/<vault 稳定 id>/*.jsonl`）后，本机归位脚本未跑 ⇒ 新布局目录为空 ⇒ 列举结果为空；
而 `setSessPop(true)` **先** `hidden = false` + 定位、**后**异步拉清单，空清单在取数 resolve 后
收起——先画出一个空盒、一个 IPC 往返后收回 = 「闪现即消失」，且该路径**静默无反馈**。

本场景预置的正是根因现场：vault 只有**旧布局**平铺留存（`sessions/` 根下，未跑
`migrateHarnessSessions`），新布局列举源为空 ⇒ 清单为空。判据对应合同
`docs/specs/overlay-visibility.md` 的 **O5**（空内容浮层不得先开后收、不得不静默）。

断言三条链：

1. **空清单反馈上屏**（D362「当前 vault 还没有对话会话」）——这是本场景**有区分度的核心判据**
   （缺陷形态此路径静默、必红，见下节）。
2. **浮层没有揭示**——浮层行（`删除该会话` 钮）不进 AX，点后与重复点击后都判不到。
3. **现场自证**——新布局列举源确为零份、旧布局平铺留存仍在原地（证明「为空」是源真的空、
   且产品不消费旧布局文件）。

## 判据为什么这样写（区分度）

- **核心判据是反馈浮条，不是「浮层没开」**：缺陷形态与修复形态的**终态**都是「浮层没开」
  （旧码先开一帧再收，终态也收敛到收起）——所以「浮层没开」这条单独**没有区分度**（REVIEW.md「断言等价于子串」条）。真正区分二者的是**空清单路径是否给可感知反馈**：旧码空清单静默
  （`setSessPop(false)` / `.catch(() => {})`），新码（M442）吐 D362。断言这条浮条出现，旧行为
  必红。
- **「闪现」本体不在真机可观测面内（如实登记）**：闪现是一个 IPC 往返（ms～数十 ms，一帧级）
  的可见↔不可见往返，真机套件没有逐帧采样通道——AX 快照与截图都在点击之后的时刻读，那时闪现
  早已结束。因此**开-闭往返本身不可能在真机层直接断言**，它由 `tests/unit/harness-session-picker.test.ts`
  的决策层矩阵（`sessPopDecision` / `sessPopDom`：空清单 / 零条 / 非空 / 失败 × 揭示与反馈 +
  aria 一致性）钉死；真机层只判**后果面**（不给反馈就红、浮层不开就红）。
- **`glob acc-empty exact 0` 有区分度**：`list_sessions` 走 `vault_sessions_dir`（按需建目录）
  ——点击触达取数后 `sessions/acc-empty/` 必已存在，此时 `exact 0` 是「源确实空」的真读数，
  而不是「目录不存在」的假过（`glob` 断言对不存在的目录回退 `hits=[]`，所以这条断言明确定在
  **点击之后**才有意义）。
- **平铺留存仍在（`recursive: false … exact 1`）**：证明旧布局文件没被产品搬走 / 消费——「清单
  为空」的原因是列举范围（只读新布局），不是文件被删。这条与 acc-empty 的 exact 0 合起来把
  「为什么为空」钉死。

## 已知边界（如实登记）

- **闪现的时序本体不判**（见上）：判据落在「空清单有反馈 + 浮层不开」，时序往返由单测矩阵承担。
- **迁移脚本不跑**：本场景**故意不**跑 `migrateHarnessSessions`（场景 125 才跑）——预置的就是
  「升级后脚本未跑」的真实现场。
- **取数失败路径（`.catch`）不判**：真机上造不出「命令未注册 / 后端不可用」的现场（`list_sessions`
  对空目录返回空数组而非报错——`vault_sessions_dir` 按需建目录）。该分支的不揭示 + 反馈由单测
  矩阵的 `{ kind: "failed" }` 取样钉住。
- **不判 aria-expanded**：KimiCU 的 AX dump 不暴露 `aria-expanded`（README「已知边界」的 M364
  条），真机层不可断言；一致性由单测的 `sessPopDom` 判据承担。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；平铺留存写在隔离配置目录的
  `harness/sessions/` 根下（合成留存），真实 vault 与用户配置全程不碰。mock 只回文案、不写 vault。
  1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
