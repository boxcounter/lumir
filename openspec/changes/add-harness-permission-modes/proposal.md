# Proposal: harness 三档权限模式 + cli_run 分类闸门 + vault 写能力补缺口

- Change ID: add-harness-permission-modes
- 日期: 2026-10-09
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

Alex 的原话诉求：**「我们怎么让 AI 尽可能的使用 vault 提供的写能力而不是 cli_run」**（2026-10-09）。围绕这句诉求，Alex 已批准一个四件打包范围（原话确认「这个打包范围可以，请你动手」）：

1. **三档 permission 模式走应用层闸门**（Kimi Code 路线，不做 OS 沙箱）：Read Only / Vault Write（默认）/ Full Access。
2. **Vault Write 档分界已确认**：只读命令白名单 + vault 内写操作自动放行；cli_run 写命令仍逐个问；危险命令黑名单（rm -rf / shutdown 类）任何档都问。
3. **闸门硬引导**：识别「目标是 vault 内路径的 cli_run 写操作」直接拒绝并回送结构化重定向提示（DeepSeek 式固定标记文本），模型据此改用 vault 工具。
4. **vault 写能力补缺口**：移动/重命名（vault_move）、删除（vault_delete）先行，追加（append）视盘点后补。

现状事实（均已对着代码坐实）：

- 闸门判定在 `src-tauri/src/harness/permissions.rs` 的 `decide`（三态 Allow / Ask / Deny，deny > allow > 默认分层：读类工具 allow、写类工具与 cli_run ask），调用点 `src-tauri/src/harness/turn.rs:718`。
- 配置面只有 `[harness].permissions.{allow, deny}` 前缀规则表（`tool` 或 `tool(模式)` 语法），没有「模式」概念——默认分层是唯一档位，用户只能在规则表里逐条加减。
- **能力不对称**：vault 工具受根目录禁锢（`resolve_in_vault`，写不出 vault）；cli_run 无任何禁锢（argv 直传、无 shell，可写 vault 外任意路径）。模型的自然倾向是用熟悉的 shell 写文件——绕过 vault 工具的禁锢与 CAS 修订保护，也绕过了 diff 批准预览。
- vault 写工具只有局部 patch（vault_patch）与新建（vault_create）两件：**不能移动/重命名、不能删除**——模型想整理 vault 时唯一通路就是 cli_run，闸门又不引导，「用 cli_run 不用 vault 工具」被现状反向激励。
- 每次 ask 都逐个弹批准卡，没有「本会话同类不再问」（Kimi Code 有同款）。
- 已知 bug（**另批修，不属于本提案**）：cli_run 批准卡的 argv 有数组/字符串类型错配，前端渲染口径待修。

业界参照：Kimi Code 三档模式 + 本会话同类不再问 + 永久 allow/deny 规则；Codex / DeepSeek 的 sandbox × approval 双旋钮与结构化拒绝标记（模型按固定标记文本改道）。本提案取 Kimi Code 路线的应用层闸门（Alex 已裁：不做 OS 沙箱），重定向标记取 DeepSeek 式固定文本形态。

「永久 allow/deny」不在本包——持久授权通道维持现状（只有 config 规则表一个真源），会话内缓存是本包唯一的在产物记忆（理由见 Non-goals）。

## What Changes

每条对应 `specs/harness/spec.md`（或 `specs/fs-io/spec.md`）增量中的一个 requirement：

1. **三档权限模式**（harness，MODIFIED「权限机制」）：新增模式维度作为**默认分层**的替换物——`read_only` / `vault_write`（默认）/ `full_access` 三档，逐档定义读类工具 / vault 写工具 / cli_run 只读白名单 / cli_run 写命令 / 危险黑名单五类调用面的放行或询问行为。判定总序：**deny 规则 > vault 内写重定向 > 危险黑名单（任何档都问）> allow 规则 > 模式默认分层**——前四层模式无关，模式只决定最底层默认。
2. **cli_run 命令分类算法与 vault 写硬引导**（harness，ADDED「cli_run 命令分类与 vault 写重定向」）：argv 分类为三态（只读 / 写 / 危险）——命令名白名单 + 参数形态判定；shell 包装器（sh -c 等）与任何含 shell 元字符的 argv 一律保守按写处理；分类不了的未知命令按写处理（保守默认）。分类为写且**写目标解析进 vault 内**的 cli_run，任何档都直接拒绝并回送固定标记文本的结构化重定向提示（错误码 + 固定标记 + JSON 载荷，指明该用哪个 vault 工具），模型据此在下一轮改用 vault 工具——闸门不做自动翻译（不留第二事实源）。
3. **vault_move 与 vault_delete**（harness，ADDED「vault 移动与删除工具」+ MODIFIED「工具循环」）：工具集从 6 扩到 8（ADR 0007 清单外扩张的本次 Alex 裁决）。`vault_move(path, new_path)` = vault 内移动/重命名（跨目录），经 fs-io 新增 `fs_move_entry` 原语（fs-io，ADDED「跨目录移动」：两端都走 `resolve_in_vault` 逃逸防护、MUST NOT 覆盖既有条目）；`vault_delete(path)` = 移入系统废纸篓（可恢复，MUST NOT 永久删除，复用 `trash_entry` 既有口径）。两工具各档行为按语义表落；**vault_delete 在 Vault Write 档是否仍逐个问列为 Alex 裁决点**（倾向：问）。批准预览：vault_move 显示 源→目标 路径对，vault_delete 显示路径 + 「移入废纸篓可恢复」。
4. **本会话同类不再问**（harness，ADDED「会话内批准缓存」）：批准卡新增「采纳且本会话不再问」次级动作；采纳的 (工具, 主体串) 记入会话内存缓存，同会话内同主体串的后续调用直接放行；「新会话」/ 切会话 / app 重启清空。不持久化（持久通道只有 config 规则表）。
5. **模式切换入口与配置默认**（harness，ADDED「权限模式切换」+ MODIFIED「配置节 [harness]」）：composer 控制行新增权限 chip（思考 chip 之后、ctx 读数之前），点击弹三档单选浮层（当前档勾选），选择即生效并经 `config_set_value` 写回 `[harness].permission_mode`；配置键闭集合 `read_only` / `vault_write` / `full_access`，默认 `vault_write`，非法值回落默认 + 人话 warning（沿用既有模板）。
6. **fs-io 跨目录移动原语**（fs-io，ADDED「跨目录移动」）：`fs_move_entry(root, from_rel, to_rel)`——源与目标都经 `resolve_in_vault`，目标撞名 MUST NOT 覆盖（沿用 rename 的「复查 + 极窄窗口」口径并如实标注非原子），跨卷失败如实报错、不做静默 copy+delete。

## Alex 裁决点

节点 1 硬门禁。以下各点给出起草倾向，Alex 逐条裁决（可整批「按倾向」）：

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | **vault_delete 在 Vault Write 档的行为** | A. 与其他 vault 写工具一致自动放行；B. 任何档都逐个问（危险面，删除虽可恢复但打断性强）；C. Vault Write 放行、仅 Read Only 拒 | **倾向 B**——删除不可逆性低于 patch 但高于移动（废纸篓可恢复仍属高打断操作）；与 Alex 已确认的「危险黑名单任何档都问」同一安全侧。Full Access 档倾向放行 |
| 2 | **cli_run 只读白名单首版清单** | 见 design §3.1 初始表（ls / cat / rg / git 只读子命令族 / sed 无 -i / jq 等）；黑盒命令（awk 等）首版不进白名单 | **倾向按初始表落地**，实现后 dogfood 增补走 config 规则表即可，不再逐个问 Alex |
| 3 | **危险黑名单首版清单** | 见 design §3.3 初始表（rm / shutdown·reboot·halt·poweroff / mkfs* / dd / git reset --hard / git clean）；黑名单命中是「任何档都问」而非 deny | **倾向按初始表落地**；黑名单成员全部走批准闸（用户可见命令全文），不静默拒绝 |
| 4 | **会话内缓存的记入方式** | A. 批准卡提供「采纳且本会话不再问」显式次级动作（每次选择性记忆）；B. 凡采纳自动记入缓存 | **倾向 A**——与 Alex 已确认的「cli_run 写命令仍逐个问」精神一致：逐个问是默认，免问是用户每次显式给的 |
| 5 | **allow 规则与模式的关系** | A. deny > 重定向 > 黑名单 > allow > 模式默认（allow 规则在任何档生效，含只读档）；B. 只读档设模式天花板，allow 规则不能越过（只读档最多问到批准闸） | **倾向 A**——模式替换的是「默认分层」，不动用户显式配置的规则；只读档的实际安全姿态 = 「无显式配置则写必问」，与 Kimi Code「模式 × 规则」双旋钮同构。重定向与黑名单两层在 allow 之前，用户 allow 规则也绕不过它们 |
| 6 | **重定向的绝对性** | A. 任何档下，目标在 vault 内的 cli_run 写操作一律重定向（Full Access 也不例外）；B. Full Access 档放行，重定向只管 Read Only / Vault Write | **倾向 A**——Alex 诉求的原点（「尽可能用 vault 写能力而不是 cli_run」）；Full Access 的「完全」体现在 vault 外写自动放行，vault 内写经一次重定向换工具，代价一轮往返、收益是写全程走 CAS / 预览 / 禁锢 |

## Non-goals

- **OS 级沙箱 / seccomp / 容器化**：不做（Alex 已裁：Kimi Code 路线，应用层闸门）。
- **从批准卡写永久 allow/deny 规则**：不做——持久授权通道维持 config 规则表单真源（「配置即数据」，ADR 0002 §5）；批准卡只有会话内缓存一个记忆。Kimi Code 的永久规则按钮不在本包。
- **cli_run 批准卡 argv 类型错配 bug**：另批修（已知 finding，本提案不修、不依赖其修复面；实现时与其解耦）。
- **vault_append（追加工具）**：视盘点后补，本包不做（Alex 打包范围第 ④条原文「视盘点加追加」）。
- **cli_run 加 shell / 管道 / 重定向真执行**：不做——argv 直传形态不变；管道、复合命令（&&/;）、重定向经 shell 包装器出现的，一律保守按写命令处理（逐个问或按档放行），不为之开真执行通道。
- **按 vault / 按工具细分的自定义模式**：不做，三档是全局维度（探针期单用户）。
- **网络维度管控**（出网白名单等）：不做。
- **既有 ask 批准闸的呈现改造**：不动——本提案只在批准卡上加一个次级动作（裁决点 4），diff / argv 预览、收敛行为等既有口径全部保留。

## Impact

- 影响的 specs：`harness`（MODIFIED ×3：权限机制 / 工具循环 / 配置节 [harness]；ADDED ×4：cli_run 命令分类与 vault 写重定向 / vault 移动与删除工具 / 会话内批准缓存 / 权限模式切换）；`fs-io`（ADDED ×1：跨目录移动）
- 影响的代码/系统：src-tauri（`harness/permissions.rs` 模式层与分类闸门重构、`harness/tools.rs` 两新工具与分类表、`harness/turn.rs` 判定管线接入、`config.rs` `permission_mode` 键、`harness/session.rs` 批准缓存字段、`fs_io.rs` `fs_move_entry`）；src（`harness-panel.ts` 权限 chip 与三档浮层、批准卡次级动作、`ipc.ts`、ts-rs 绑定重导出）；scripts/acceptance（新增模式/分类/重定向/新工具验收场景，mock provider 驱动，fixture 合成）
- 关联约束：ADR 0007（工具清单外扩张须经 Alex 裁决——本次即该裁决；探针期边界）；ADR 0002 §5（配置即数据，新键走 schema 校验模板）；REVIEW.md 第 8 条（分类表/黑名单唯一真源，不与前缀规则表语义两处各判一半）；REVIEW.md 第 21 条（不留兼容层——新模式默认 `vault_write` 直接替换旧默认分层，无迁移无过渡）；仓库信息卫生（验收 fixture 合成）
