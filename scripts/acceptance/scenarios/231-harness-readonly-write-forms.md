---
id: "231-harness-readonly-write-forms"
item: 231
title: 只读白名单收紧：写形态进闸、执行形态在完全访问档仍问（change readonly-allowlist-tightening-oct23，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-readonly-tightening.json"
    permissions:
      allow: []
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（后台注入键盘整批丢键错键会显著加剧——REVIEW.md 「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 输入第一条提问并发送（本场景共两条用户消息）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|tighten" }
    text: "tighten"
  - name: 发送
    do: key
    key: enter

  - name: 等第一张批准卡（四条只读调用全部免闸 ⇒ 第一张卡必然是写形态）
    do: waitFor
    waitFor:
      has: ["要运行这条命令吗？"]
    timeoutMs: 40000
    expect:
      - label: 卡上是 base64 的写形态（若 git status / diff / rev-parse / base64 -d 进了闸，这里会是它们的卡）
        ax: { has: "base64 -o /tmp/lumir-h231-out.b64 harness-note.md" }
      - label: 判定依据是模式默认分层（写形态在 vault_write 档逐个问）
        ax: { has: "当前为 保险库写入 档：库内写自动放行；库外命令先问你" }
      - label: 写形态卡上仍有持久放行入口（写不是危险层）
        ax: { has: "以后都允许" }
      - shot: 01-写形态-base64-o

  - name: 拒绝这一条（不执行写形态）
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等第二张卡（git 表外全局 flag）
    do: waitFor
    waitFor:
      has: ["--git-dir=/tmp/lumir-h231-repo/.git diff"]
    timeoutMs: 30000
    expect:
      - label: 确实在批准闸里（待决问句在场）
        ax: { has: "要运行这条命令吗？" }
      - label: 判定依据仍是模式默认分层
        ax: { has: "当前为 保险库写入 档" }
      - shot: 02-写形态-git-dir

  - name: 拒绝这一条
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等第三张卡（只读子命令的 --output 写形态）
    do: waitFor
    waitFor:
      has: ["git log --output=/tmp/lumir-h231-log.txt"]
    timeoutMs: 30000
    expect:
      - label: 确实在批准闸里（待决问句在场）
        ax: { has: "要运行这条命令吗？" }
      - shot: 03-写形态-git-log-output

  - name: 拒绝这一条
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等第一轮收尾
    do: waitFor
    waitFor:
      has: ["写形态都进闸了。"]
    timeoutMs: 30000
    expect:
      - label: git status 确实执行了（wire 留存里有它的 call_id）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"call_id":"call_ro1"/' }
      - label: git diff 确实执行了
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"call_id":"call_ro2"/' }
      - label: git rev-parse 确实执行了
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"call_id":"call_ro3"/' }
      - label: base64 -d 确实执行了
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"call_id":"call_ro4"/' }
      - label: base64 -o 那条被拒绝、未执行（回送里带 approval_rejected）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"call_id":"call_w1".*approval_rejected.*$/' }
      - label: --git-dir 那条被拒绝、未执行
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"call_id":"call_w2".*approval_rejected.*$/' }
      - label: git log --output 那条被拒绝、未执行
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"call_id":"call_w3".*approval_rejected.*$/' }
      - label: 收尾时没有待决卡在场（负向断言）
        ax: { not: "要运行这条命令吗？" }
      - shot: 04-写形态收尾

  - name: 点权限 chip 展开浮层（chip 带 aria-haspopup → WKWebView 映射 AXPopUpButton）
    do: click
    target: { name: "^权限模式：" }
    expect:
      - label: 完全访问档在场（本场景第二段的档位前提）
        ax: { has: "完全访问" }

  - name: 点「完全访问」（浮层项 role=menuitemradio）
    do: click
    target: { name: "^完全访问" }

  - name: 等 chip 读数翻成完全访问档
    do: waitFor
    waitFor:
      has: ["权限模式：完全访问（点击切换）"]
    timeoutMs: 15000
    expect:
      - label: 写回落盘（config.json 的 harness.permission_mode 已是 full_access）
        file: { path: "env:config.json", has: "\"permission_mode\": \"full_access\"" }
      - shot: 05-完全访问档

  - name: 收起浮层（再点权限 chip 走它自己的开合——不注入任何键：按钮持焦时 Esc 会走原生
      关窗并退出 app；现场见 finding `20261024-worker-archive-rmachine-oct24-bug-harness-esc-app.md`）
    do: click
    target: { name: "^权限模式：" }
  - name: 等浮层收起（点 chip 后 AX 会重建一拍，先 settle 再断言）
    do: settle
    expect:
      - label: 浮层已收起（只读档的释义退场；chip 自身只带当前档，读不到这一行）
        ax: { not: "读自动放行；写操作都先问你" }
      - label: composer 仍在位（正观测：pane 没有被误收，后续注入有落点）
        ax: { has: "问点什么" }
  - name: 点 composer 建立落点（浮层万一仍在场，这一下也走「浮层外点击」的关闭路径）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 等界面稳定（浮层收起 / 焦点落定后再注入）
    do: settle

  - name: 第二条提问（执行形态在完全访问档）
    do: typeInNode
    # 注入前后都要能命中：空框读屏名 = 占位文案「问点什么」，非空 = 内容（这里注入的是 pre）
    target: { role: AXTextArea, name: "问点什么|pre" }
    text: "pre"
  - name: 发送
    do: key
    key: enter

  - name: 等危险卡（rg --pre 在 full_access 档仍逐个问）
    do: waitFor
    waitFor:
      has: ["rg --pre /tmp/lumir-h231-pre.sh needle ."]
    timeoutMs: 40000
    expect:
      - label: 判定依据是安全黑名单句（任何权限档都需逐个确认）
        ax: { has: "命中安全黑名单：任何权限档都需逐个确认" }
      - label: 危险卡上没有持久放行入口（D3：死按钮不显示）
        ax: { not: "以后都允许" }
      - label: 危险卡上没有会话记忆入口（同上）
        ax: { not: "采纳且本会话不再问" }
      - shot: 06-执行形态-完全访问档

  - name: 拒绝这一条
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等本轮收尾
    do: waitFor
    waitFor:
      has: ["执行形态在完全访问档也进闸。"]
    timeoutMs: 30000
    expect:
      - label: rg 那条被拒绝、未执行（回送里带 approval_rejected）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"call_id":"call_x1".*approval_rejected.*$/' }
      - label: 收尾时没有待决卡在场（负向断言）
        ax: { not: "要运行这条命令吗？" }
      - shot: 07-收尾
---

# 231-harness-readonly-write-forms —— 只读白名单收紧的真机判据

## 本场景在验什么

change `readonly-allowlist-tightening-oct23` 的三条用户可见行为，对应 proposal 的裁决段：

| 段 | 调用 | 期望 |
|---|---|---|
| 1 | `git status` / `git diff` / `git rev-parse HEAD` / `base64 -d` | 三档免闸、不产卡（Q1：git 只读族保持只读） |
| 2 | `base64 -o /tmp/… harness-note.md` | 写形态 ⇒ `vault_write` 档逐个问（write 层，不是危险层） |
| 3 | `git --git-dir=<外部> diff` | 表外全局 flag ⇒ 写 ⇒ 逐个问 |
| 4 | `git log --output=/tmp/…` | 只读子命令的 argv 级写形态 ⇒ 写 ⇒ 逐个问 |
| 5 | `rg --pre /tmp/… needle .`（`full_access` 档） | 执行形态 ⇒ 危险 ⇒ **任何档都问**，卡上无放行入口 |

第 1 段是**反向判据**：四条只读调用排在写形态之前，若它们进闸，第一张卡会是它们的卡，
`base64 -o` 的卡断言必超时。第 2–4 段拒绝执行，真机零副作用。

## 断言口径与已知边界

- **命令原文整串可断言**：fixture 的 argv 都不含空白（`--git-dir=/tmp/…` 是单 token），
  `formatArgv` 不加引号；`base64 -o /tmp/… harness-note.md` 四个 token 之间是普通空格。
- **`git status` 等在 app 的工作目录执行**（`cli_run` 的 spawn 不设 `cwd`，是 app 进程工作目录，
  不是 vault 根）——dev 模式下是仓库本身，命令成功；即便失败也只影响 stdout，不影响
  「是否进闸」这条判据（与 229 的虚构命令同口径：本场景判权限面，不判命令成败）。
- **`base64 -d /dev/null`** 读空输入、零输出：只读形态且无副作用；它的执行证据是 wire 留存里的
  `call_ro4`，不是 stdout。
- **三条写形态都不真跑**：三张卡全部拒绝；「未执行」的判据是 JSONL 里各自的回送带
  `approval_rejected`（`call_w1` / `call_w2` / `call_w3`），不依赖折叠态 AX 行（M351 起工具清单会
  折叠，行是否进 AX 树与终态渲染无关）。`/tmp/lumir-h231-*` 因此不会被创建。
- **`rg --pre` 指向不存在的脚本**：即便误放行也只会让 rg 报错；本段判的是「完全访问档是否仍出卡」，
  拒绝后不可能执行。
- **关浮层不用 Esc（2026-10-24 真机实证）**：选中档位后焦点落在权限浮层的按钮上，此时
  `do: key { key: escape }` 会落到原生 `cancelOperation` → 关窗请求，整个 app 退出（AX 树随即
  空掉，后续步骤全红）。两次独立复跑同形；AppKit 日志为 `windowShouldClose: prevented close`
  后紧接 `WebPageProxy::close` 与进程退出；app.log 无 panic、同刻无崩溃报告。归因与现场见
  finding `20261024-worker-archive-rmachine-oct24-bug-harness-esc-app.md`（产品面，单列处置）。
  场景因此改用「再点一次权限 chip」这条既有开合路径（与 229 同一处置）：浮层收起与 composer
  在位各有一条正/负判据，不是放宽断言。**Esc 收浮层这条路径因此不在本场景覆盖**；在缺陷修复前
  MUST NOT 把它加回来。
- **第二条提问的 target 要覆盖注入后状态**（2026-10-24 真机实证）：`typeInNode` 的 `target.name`
  在注入前后都会被解析，`问点什么|tighten` 在注入 `pre` 之后两个分支都不命中（空框读屏名变了），
  动作会在「回读目标消失」处判红。现写 `问点什么|pre`。
- **真机执行记录**：初跑两次在第二条提问前被上述 Esc 路径挡下（保留现场
  `.local/acceptance/2026-10-24-m711-flake-r1/231-harness-readonly-write-forms/`）；改用 chip
  关闭并修正 target 后，2026-10-24 1/1 PASS（32 断言，0 FAIL，证据
  `.local/acceptance/2026-10-24-m711/231-harness-readonly-write-forms/`）。

## 环境与副作用

- vault 文件不被改动（所有工具调用都不写 vault；写形态全部拒绝）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；`config.json` 的档位在本场景内
  从 `vault_write` 切到 `full_access`（场景结束后由套件按场景配置重置）。
- 真实 vault 与 `~/.config/lumir` 全程不读写；1420 不碰。
