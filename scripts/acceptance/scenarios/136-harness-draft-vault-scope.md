---
# M452（change composer-draft-persistence，design §9 ②③）：草稿**按 vault 各留各的** + vault 零写入。
#
# 两条判据：
# - **②** 在 vault A 打字 → 切到 B（B 的输入区是空的、B 的草稿文件不存在）→ 在 B 打自己的字 →
#   切回 A（A 的草稿原样回来、B 的那份不串进来）。A/B 各一份 `harness/drafts/<vault 稳定 id>.json`。
# - **③** 全过程中 vault 目录零新增 / 零修改（负向）：草稿落**配置目录**，MUST NOT 触碰 vault。
#
# **本场景刻意覆盖「切 vault 前的 flush」这一条**（spec：切 vault 时 SHALL 先 flush 当前 vault
# 草稿、再装载目标 vault 草稿）：第二次编辑（追加 `-end`）之后**不等防抖窗口**就切走，切回 A 时
# 那句话必须还在盘上——它只能来自「离开输入区（⌘O 打开浮层 ⇒ 输入区失焦）时的那次 flush」，
# 防抖窗口（1s）没到就切走的话，没有 flush 就必然丢。这给这条需求一个**有区分度**的判据
# （REVIEW.md 第 1 条：先想清楚什么输入会让它红）。
id: "136-harness-draft-vault-scope"
item: 136
title: composer 草稿按 vault 各留各的（含切走前 flush 最后一次编辑）+ vault 零写入
open: harness-note.md
marker: "HNL-ALPHA"
seed:
  # 两个 vault 都预注册：注册表 id 就是草稿 sidecar 的文件名（落点可写死断言）。
  registry:
    - { id: acc-da, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-db, path: $vault2, lastOpenedAt: 1757000001000 }
  sessions:
    acc-da:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
    acc-db:
      panes:
        - { tabs: [beta.md], active: beta.md }
      harnessPane: true
steps:
  - name: 等 A 装载 + harness pane 按存储装配 + 输入区在位
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "问点什么"]
    timeoutMs: 40000
    expect:
      - shot: 01-A-起始态

  - name: 记 A 的 vault 根 mtime 基线（③ 零写入判据的基线，同 127/129 的用法）
    do: record
    as: vault-a-root
    file: "."

  - name: 点 A 的 composer 聚焦
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 在 A 键入库草稿标记
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|draftscopea" }
    text: "draftscopea"
    expect:
      - label: A 的标记落在 composer（注入落地的正观测）
        ax: { has: "draftscopea" }

  - name: 等防抖落盘（1s 窗口 + 2.5s 余量）
    do: sleep
    ms: 2500
    expect:
      - label: ② A 的草稿落在 harness/drafts/<A 的稳定 id>.json
        file: { path: "env:harness/drafts/acc-da.json", has: "draftscopea" }
      - label: ③ B 的草稿此刻不存在（各留各的，不从 A 借）
        file: { path: "env:harness/drafts/acc-db.json", exists: false }
      - label: ③ 草稿不落 vault（A 内零命中）
        glob: { dir: ".", pattern: "acc-d[a-z]?\\.json$", exact: 0 }
      - shot: 02-A-草稿落盘

  - name: 追加第二次编辑（`-end`）
    do: typeInNode
    target: { role: AXTextArea, name: "draftscopea|-end" }
    text: "-end"
    expect:
      - label: 追加落在 A 的 composer
        ax: { has: "draftscopea-end" }

  # 立刻切走（不 sleep）：这一步是 ② 的 flush 判据的输入面——防抖窗口没到，只有
  # 「离开输入区时的离散 flush」能把 `-end` 写走。
  - name: ⌘O 打开 vault 列表（浮层自持焦点 ⇒ 输入区失焦 ⇒ 触发草稿 flush）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开且 B 的行在位
        ax: { has: "/lumir-m102-acceptance-b/" }

  - name: 点 B 行——切到第二个 vault
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }

  - name: 等 B 装载跑完（面板按存储装配）
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）", "分隔条", "/AXButton \\(发送\\)/"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000
    expect:
      - label: ② 切入 B 时输入区是空的（A 的草稿不串台；空态 = D328 占位读名）
        ax: { has: "问点什么" }
      - label: ② 负向：B 的输入区不含 A 的标记
        ax: { not: "draftscopea" }
      - label: ② B 的草稿文件仍不存在（没被 A 的内容写进来）
        file: { path: "env:harness/drafts/acc-db.json", exists: false }
      - label: ② **切走前的 flush 生效**：A 的草稿已含切走前最后那次编辑
        file: { path: "env:harness/drafts/acc-da.json", has: "draftscopea-end" }
      - shot: 03-B-空输入区

  - name: 记 A 的草稿基线（在 B 里编辑期间它不许被动过）
    do: record
    as: draft-a
    file: "env:harness/drafts/acc-da.json"

  - name: 在 B 键入库草稿标记
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 键入 B 的标记
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|draftscopeb" }
    text: "draftscopeb"

  - name: 等防抖落盘
    do: sleep
    ms: 2500
    expect:
      - label: ② B 的草稿落在自己那份文件里
        file: { path: "env:harness/drafts/acc-db.json", has: "draftscopeb" }
      - label: ② 负向：B 的草稿不含 A 的标记（两份互不影响）
        file: { path: "env:harness/drafts/acc-db.json", not: "draftscopea" }
      - label: ② A 的草稿在 B 的编辑期间逐字节未变
        file: { path: "env:harness/drafts/acc-da.json", unchangedSince: draft-a }
      - shot: 04-B-草稿落盘

  - name: ⌘O 再打开列表（切回 A）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层重新出现
        ax: { has: "选择一个目录作为新 vault" }

  - name: 点 A 行（`名称 + 空格` 锚定，排除 `-b` 那一行——与场景 17/91/96 同一手法）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance /" }

  - name: 等 A 装载完、面板重建、草稿恢复进输入区
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "draftscopea-end"]
    timeoutMs: 60000
    expect:
      - label: ② 切回 A：A 的草稿原样还原（含切走前最后那次编辑）
        ax: { has: "draftscopea-end" }
      - label: ② 负向：B 的标记没有串进 A
        ax: { not: "draftscopeb" }
      - label: ② A 的草稿文件内容仍是切走前那份（切回只读不写）
        file: { path: "env:harness/drafts/acc-da.json", unchangedSince: draft-a }
      - label: ③ 全程 vault 根目录 mtime 未推进（vault 零新增 / 零删除）
        file: { path: ".", mtimeUnchangedSince: vault-a-root }
      - label: ③ 两份草稿都在配置目录、vault 侧零命中
        glob: { dir: ".", pattern: "acc-d[a-z]?\\.json$", exact: 0 }
      - shot: 05-A-切回恢复
---

# 136-harness-draft-vault-scope —— 草稿按 vault 各留各的 + 切走前 flush（design §9②③）

## 本场景在验什么

spec「composer 草稿自动保存与恢复」的粒度与边界两条：

- **粒度 = 一个 vault 一份**：A、B 各一份 `harness/drafts/<vault 稳定 id>.json`，互不影响；
  切 vault 时**先 flush 当前 vault 的草稿、再装载目标 vault 的草稿**；
- **不碰 vault**：全过程中 vault 目录零新增 / 零修改。

## 判据为什么这样写

- **「切走前的 flush」用无 sleep 的第二次编辑钉住**：第一次编辑后等满防抖窗口（证明保存路径），
  第二次编辑（`-end`）**紧接着**切 vault——1s 防抖窗口没到，盘上若没有 `-end`，就只可能说明
  「离开输入区时的那次离散 flush」没有发生（或写错了 vault）。这条判据因此有区分度，不是
  「写过了就行」的空过。
- **切走后的三条负向各有输入**：`B 的输入区不含 A 的标记`（A 的草稿没串进 B 的渲染）、
  `B 的草稿文件不存在`（A 的内容没写进 B 的文件——跨 vault 污染的最坏形态）、
  `A 的草稿含 draftscopea-end`（flush 确实落到了 A 的那份文件）。
- **③ 用 vault 根的 mtime**：草稿落配置目录，vault 里零新增即零目录项变化 ⇒ 根 mtime 不动。
  另配一条「vault 内不出现 sidecar 名」（A 的 id 派生的文件名），两条一起才不是「只看一个量」。
  目录不能做 sha256 比较（套件在目录上对 sha 类判据直接判 FAIL），故 mtime 是这里可用的判据。
- **B 的 vault 内侧没有直判**：套件的 `dir: "."` 固定解析到**验收 vault A**，`$vault2` 只活在
  `seed.path` 里（`appMetaTokens` 不含它），B 的 vault 侧因此只能间接覆盖（草稿落 env: 侧、
  B 的 sidecar 各自独立）。这是套件当前能力的边界，如实登记。

## 覆盖边界（如实登记）

- **真机跑绿状态**：本场景随 change 同 PR 交付，**本轮未跑真机**（前台窗口由 tower 统一安排）。
  `--check` 静态校验通过；运行期读数待 tower 排跑的跑批给出。
- **切会话 / 新建会话 / 压缩 / 删除会话不动草稿**（spec 的同一条 requirement）不在本场景：
  那四条在真机上需要会话浮层与 mock 回合的配合，判据已由单元层（`tests/unit/harness-draft.test.ts`
  的 store 语义）与实现面（这些动作都不经过草稿 store）覆盖。若后续要真机判据，另立场景。
- **键盘路径的 flush 依赖「⌘O 的浮层自持焦点 ⇒ 输入区失焦」**（`src/keys.ts` 的作用域注释与
  面板的 composer blur 钩子同源）。若某天浮层改成不抢焦点，本场景的 `-end` 断言会红——那正是
  它要报的信号（flush 时点没了）。

## 环境与副作用

- 两个合成 vault（`/tmp/lumir-m102-acceptance` 与 `-b`）+ 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 只切 vault、只读 AX 与文件；1420 全程不碰（端口走 `LUMIR_ACCEPTANCE_PORT`，缺省 1430）。
