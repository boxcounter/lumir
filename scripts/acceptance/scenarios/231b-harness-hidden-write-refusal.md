---
# hidden 档写入口拒绝（M656 前提）的真机判据：`vault_patch` 指名隐藏路径 `.git/config`
# 必须在写入口被拒、不落盘。合成的 `.git` 由 `vaultWrite` 在场景内造出（resetVault 每场景清
# 非 md 产物，不依赖残留）。
#
# 为什么这条判据在真机层：change readonly-allowlist-tightening-oct23 的 1.11 把「git 只读族
# 保持只读」的安全前提押在 M656 的 hidden 写入口关闭上。Rust 单测验的是函数级
# （`fs_patch_file_refuses_hidden_target_and_respects_policy`）；本场景验的是**产品链路**：
# harness 工具分发 → fs_io 写入口 → 工具结果回送模型 → 面板失败尾注，四段都真的经过。
#
# 判据形态：工具行失败尾注里的错误码 `fs_name_invalid` + 磁盘事实（sha256 与 mtime 都不变）。
# 负向断言「没有落盘」配正观测：模型能在工具结果之后继续回话（收尾文本），
# 说明工具调用确实执行到了写入口并返回，而不是卡在批准闸上。
id: "231b-harness-hidden-write-refusal"
item: 231
tier: full
title: hidden 档写入口拒绝（M656 前提）：vault_patch 指名 .git/config 被 fs_name_invalid 拒绝且文件逐字节不变（mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-hidden-write.json"
    permissions:
      allow: []
steps:
  - name: 在合成 vault 里造出 hidden 档命中的目标（.git 在默认 hidden 档，树里没有这一行）
    do: vaultWrite
    file: .git/config
    content: "[core]\n\trepositoryformatversion = 0\n"
  - name: 记下基线（拒绝的判据是内容与 mtime 都不变）
    do: record
    as: hidden_before
    file: .git/config

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板以旁侧 pane 出现（发送钮在场是 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（后台注入键盘整批丢键 / 错键会显著加剧——REVIEW.md「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 输入提问并发送（vault_write 档下 vault_patch 自动放行，判据落在写入口而不是批准闸）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|hidden" }
    text: "hidden"
  - name: 发送
    do: key
    key: enter

  - name: 等 mock 在工具结果之后继续回话（正观测：调用真的执行到写入口并返回）
    do: waitFor
    waitFor:
      has: ["hidden 写被拒了。"]
    timeoutMs: 30000
    expect:
      - label: 工具行失败尾注 = 写入口的错误码（fs_name_invalid）
        ax: { has: "/fs_name_invalid/" }
      - label: 失败原因点名 hidden 档（人话，不伪造成「文件不存在」这类别的错因）
        ax: { has: "在忽略集内（hidden 档），不能修改、移动或删除" }
      - label: 没有卡在批准闸（vault_write 档的 vault_patch 免闸；有卡则收尾文本到不了）
        ax: { not: "要运行这条命令吗？" }
      - label: 工具结果回送模型（JSONL 里同一 call_id 带 fs_name_invalid）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"call_id":"call_hidden1".*fs_name_invalid/' }

  - name: 落盘复核（拒绝的硬判据：内容逐字节与 mtime 都没动）
    do: settle
    expect:
      - label: .git/config 内容未变（sha256 与基线相同）
        file: { path: ".git/config", unchangedSince: hidden_before }
      - label: .git/config mtime 未推进（不是「写了同样的内容」）
        file: { path: ".git/config", mtimeUnchangedSince: hidden_before }
      - shot: 01-hidden-写被拒
---

# 231b-harness-hidden-write-refusal —— hidden 档写入口拒绝（M656 前提的真机复核）

## 本场景在验什么

change `readonly-allowlist-tightening-oct23` 的 1.11 把「git 只读子命令族保持只读」的安全
前提写成一条**前提**而不是承诺：仓库配置能驱动 git 执行程序，因此 git 只读族能保持只读，
靠的是 vault 内**没有默认档的免闸写入口**——hidden 档命中的 `.git/config` 必须被写入口拒绝。

本场景把这条前提在产品链路里跑一遍：

| 段 | 事实 | 判据 |
|---|---|---|
| 1 | 合成 vault 里存在 `.git/config`（hidden 档命中，树里没有行） | `vaultWrite` + `record` 基线 |
| 2 | mock provider 让模型调用 `vault_patch(".git/config")` | 场景 fixture |
| 3 | 写入口返回 `fs_name_invalid`，原因点名 hidden 档 | 工具行失败尾注 + JSONL 的 `call_id` 关联 |
| 4 | 文件没有落盘 | sha256 与 mtime 双判据（`unchangedSince` + `mtimeUnchangedSince`） |

## 断言口径与已知边界

- **为什么不是批准闸判据**：`vault_write`（缺省档）对 `vault_patch` 是自动放行，路径在 vault
  字符串面内、权限层没有 hidden 特判（hidden 闸在 `fs_io` 的写入口）。因此本场景的判据必须落在
  **写入口的错误码 + 磁盘事实**上；如果实现把 hidden 闸搬到权限层，本场景会以「收尾文本等不到」
  的形态红，那是实现形态变化、不是判据失效。
- **错误码是 `fs_name_invalid`**：`IgnorePolicy::validate_not_hidden` 用的就是它（message 里点名
  hidden 档）。这里同时断言错误码与原因句，避免只靠一句可能被改写的文案。
- **模型不会对失败做反应**：mock fixture 的第二条响应是固定文本——它证明「工具结果已回送、这一轮
  继续」，不验模型如何解读错误。解读与重试策略不在本 change 的合同内。
- **`.git` 由场景自建、不是 fixture**：`resetVault` 每场景把 vault 根重置为 `.md` fixture 副本并
  清掉非 md 产物，因此 hidden 目录不落 git、也不跨场景串味。
- **与 M656 的边界**：M656 的单测覆盖 patch / move / delete 三类既有目标；本场景只复核
  readonly 1.11 点名的那一条（patch），不冒充三类都已在真机验过。

## 环境与副作用

- vault 文件不被改动（唯一一次写是 `vaultWrite` 造的 hidden 目标，之后被拒绝；基线在拒绝前记录）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 与
  `~/.config/lumir` 全程不读写；1420 不碰。
