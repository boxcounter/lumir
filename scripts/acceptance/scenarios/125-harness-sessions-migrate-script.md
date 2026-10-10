---
# M433（change harness-sessions-per-vault）的**归位**判据。Alex 裁决（2026-10-10）：
# 「迁移不用写进产品里，写一个脚本执行。一次性的工作就不进入产品了。」
# 本场景预置旧布局现场（`sessions/` 根下的平铺 `*.jsonl`，含一个不可归属者与一个畸形文件），
# 然后**手动执行**仓内一次性脚本 `scripts/migrate-harness-sessions.mjs`（动作
# `migrateHarnessSessions`），断言：可归属者归位、不可归属者进 `_orphaned/`、根下零 `*.jsonl`、
# 再跑一次零搬运（幂等）。
#
# 现场与脚本的关系：脚本的入参是**隔离配置目录**（动作传入），读的注册表与平铺文件都在里面；
# 真实 `~/.config/lumir` 全程不读写。
id: "125-harness-sessions-migrate-script"
item: 125
title: 一次性归位脚本：平铺留存按首行 vault_root 归入 vault 目录，不可归属进 _orphaned，根下零 *.jsonl，可重跑幂等
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
seed:
  registry:
    - { id: acc-mig, path: $vault, lastOpenedAt: 1757000002000 }
  # 平铺留存（旧布局现场）。第一条的 `vault_root` 用 `$vault` 的字面拼写——验收 vault 在
  # macOS 上位于 `/tmp/...`，而注册表存的是 realpath 后的 `/private/tmp/...`：两者字符串不等，
  # 脚本的「先规范化再查注册表」一步因此是**承重的**（去掉它这条必进 `_orphaned/`）。
  harnessFlatSessions:
    - { name: "s1759912000-aaaaaa.jsonl", vaultRoot: $vault }
    - { name: "s1759912010-cccccc.jsonl", vaultRoot: /tmp/lumir-nowhere-vault }
    - { name: "s1759912020-eeeeee.jsonl", raw: "{ 不是 JSON\n" }
steps:
  - name: 核对归位前的现场（三份平铺留存、还没有任何 vault 目录内容）
    do: settle
    expect:
      - label: sessions/ 根下三份平铺留存（脚本的输入面）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", recursive: false, exact: 3 }
      - label: 此刻全库共三份 jsonl（没有任何已归位的文件——归位必须是脚本干的事）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
      - shot: 01-归位前

  - name: 手动执行一次性归位脚本（这一步就是「用户手跑一遍」的现场化）
    do: migrateHarnessSessions
    expect:
      - label: 可归属的平铺文件归位到它的 vault 目录（目录名 = 注册表 id acc-mig）
        file: { path: "env:harness/sessions/acc-mig/s1759912000-aaaaaa.jsonl", has: '"session_id":"s1759912000-aaaaaa"' }
      - label: 归位后的文件仍是合法留存（首行装配记录，逐字节只换位置）
        file: { path: "env:harness/sessions/acc-mig/s1759912000-aaaaaa.jsonl", has: '"kind":"session_open"' }
      - label: 注册表里没有该路径的平铺文件进孤儿桶
        file: { path: "env:harness/sessions/_orphaned/s1759912010-cccccc.jsonl", has: '"vault_root":"/tmp/lumir-nowhere-vault"' }
      - label: 首行畸形的文件同样进孤儿桶且内容未被改写
        file: { path: "env:harness/sessions/_orphaned/s1759912020-eeeeee.jsonl", has: "不是 JSON" }
      - label: 跑完 sessions/ 根下零 *.jsonl（唯一例外是 rename 失败留原地者，本例没有）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", recursive: false, exact: 0 }
      - label: 两个桶的内容都在场（1 份归位 + 2 份孤儿）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
      - shot: 02-归位后

  - name: 记录归位后的字节基线（下一步判「幂等 = 零搬运」的对照物）
    do: record
    as: 归位后
    file: env:harness/sessions/acc-mig/s1759912000-aaaaaa.jsonl

  - name: 再跑一次脚本（幂等判据）
    do: migrateHarnessSessions
    expect:
      - label: 归位后的文件逐字节未变（第二次运行没有搬运 / 改写任何东西）
        file: { path: "env:harness/sessions/acc-mig/s1759912000-aaaaaa.jsonl", unchangedSince: "归位后" }
      - label: 计数不变：根下仍零平铺、两侧仍 1 + 2
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", recursive: false, exact: 0 }
      - label: 孤儿桶里仍是那两份（重跑未再搬运）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
      - shot: 03-重跑幂等
---

# 125-harness-sessions-migrate-script —— 一次性归位脚本（change harness-sessions-per-vault）

## 本场景在验什么

规范条款（spec「会话本地留存」）：存量平铺文件（升级前遗留）的归位**由仓内一次性脚本完成**
（`scripts/` 下，手动执行一次即弃，**不进产品运行时**）——按各文件首行 `session_open.vault_root`
（先规范化再查注册表）移入对应 vault 目录；`vault_root` 不可解析 / 注册表里找不到 / 目标已有同名
文件的移入保留目录 `sessions/_orphaned/`；不删除、不改写任何文件；幂等（重复执行零搬运）。

对应的 spec 场景是「平铺文件一次性归位」与「不可归属者进孤儿桶」。

## 判据为什么这样写

- **触发是脚本执行，不是 app 启动**：产品运行时**零迁移代码**（无启动迁移入口、无旧布局读取
  路径），所以「跑一次脚本 → 断言归位」是本 change 对归位这件事唯一的机器判据形态。动作
  `migrateHarnessSessions` 以隔离配置目录为入参跑 `scripts/migrate-harness-sessions.mjs`，并把
  退出码（有文件搬不动时脚本自报非零）与 stdout 计数一并落证据。
- **规范化那一步是承重的**：第一条平铺文件的 `vault_root` 是 `/tmp/...` 字面拼写，注册表里存的
  是 `/private/tmp/...`（macOS 的 `/tmp` 是软链接）——只有「先 realpath 再查注册表」才归得了位。
  脚本自身的 node:test（`scripts/migrate-harness-sessions.test.mjs`）用注入恒等映射做**反向验证**：
  去掉这一步该输入必进孤儿桶，证明这条真机判据有区分度（REVIEW.md 第 1 条）。
- **三条不可归属的原因各覆盖一类**：注册表无该路径、首行非法 JSON；「目标已有同名文件」与
  「首行不是 session_open / 相对路径」两类由脚本单测覆盖（真机上各造一个现场的成本与收益不成比例）。
- **幂等用字节基线判**：`record` + `unchangedSince`（sha256）比「文件还在」强一档——重复执行若
  发生搬运（rename 会踩掉旧文件、重建同名文件），sha 与 mtime 都会变；这里判的是内容逐字节未变
  且 `glob` 计数不变（零搬运）。
- **孤儿桶按文件名直取**：两个孤儿文件的文件名都是场景预置的确定值，直接按字面路径断言，不靠
  glob 取 mtime 最新那一份（两个文件的新旧无法区分，取最新会让断言与「哪个是哪个」脱节）。

## 覆盖边界（如实记录）

- **脚本执行时 app 是起着的**（runner 起实例 → 跑步骤），而 design §4 的并发前提写的是「app 未
  运行时手动执行」。本场景不发起任何对话，此刻没有在写的会话文件，脚本只动 `sessions/` 根下的
  平铺文件与建目录——与「app 未运行」等价；套件没有停 app 的动作（`restart` 会再起一个）。
  真要严格对齐这一条，需要人工在 app 退出后跑一次脚本（脚本单测已覆盖「无 app 参与」的算法面）。
- **不判「失败留原地 + 重跑收敛」**：要造 rename 失败得改目录权限，属脚本单测的现场
  （`scripts/migrate-harness-sessions.test.mjs`），真机侧不重复。
- **不判「产品只读新布局」**：那是场景 124 与 Rust 侧集成测试的事。
