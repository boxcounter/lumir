# Tasks: add-harness-permission-modes

> 提案阶段任务清单；Alex 节点 1 裁决通过后方可进入实现。裁决点见 proposal「Alex 裁决点」——实现按裁决结果落表，不替 Alex 选。
>
> 勾选与说明由后端实现 mission（M407）填写；第 5 节（UI）与 6.7（验收场景）归面板批次与验收套件维护者，本行以下未勾选项即「本轮未做」的真实状态。
>
> **r1 复评后的两项增量**（2026-10-09，同为 M407）：① 修 r1 P2-1（`vault_create_file` 对绝对路径输入会在 vault 里留下 stray 目录——校验趟补绝对路径拒绝 + 用例补「不建任何东西」断言）；② Alex 语义修订：`read_only` 由「拒绝写」改为 **Always Ask**（写逐个问），模式层不再产出 Deny，只读档的批准窗 CAS 用例随之复活（见 1.2 / 6.1 / 6.2 注记）。
>
> **r3 追加（2026-10-09，纯文档口径）**：design §7 呈现口径修订——chip 显示**短名**（只读 / 写入 / 完全；Read / Write / Full）、浮层列表项显示**全名**并每档附一行释义（原「chip 显示全名」「无释义」作废）。落点：design §7/§8、proposal 评审记录、spec delta「权限模式切换」requirement + 「三档浮层」scenario、本条 5.1 注记；判定代码未动（5.1 仍归 UI 批次勾选）。

## 1. 判定管线与三档模式

- [x] 1.1 `permissions.rs` 重构为五层判定管线（design §1）：deny 规则 > vault 内写重定向 > 危险黑名单 > allow 规则 > 模式默认分层；`decide` 签名保留，新增模式参数与分类器输入
- [x] 1.2 三档语义表落地（design §2）：`read_only` / `vault_write`（默认）/ `full_access`；危险黑名单任何档 Ask
  - 说明（M407 r1 修订，2026-10-09 Alex 裁决）：本条原文写作「Read Only 档 vault 写工具为 Deny（非 Ask）」，该口径已作废——`read_only` 改为 **Always Ask**（Kimi Code 语义：读自动放行、一切写逐个问），vault_patch / vault_create / vault_move / vault_delete 在只读档由 Deny 改为 Ask；模式层不再产出 Deny（Deny 只来自 deny 规则）。design §2/§5.3/§8、proposal 评审记录、spec delta 与代码同步。
- [x] 1.3 `config.rs` 新增 `[harness].permission_mode`：闭集合三值、默认 `vault_write`、非法回落 + 人话 warning（沿用既有校验模板）；ts-rs 绑定重导出随实现同 PR

## 2. cli_run 分类与重定向

- [x] 2.1 分类器实现（design §3）：只读白名单 / 保守降级规则 / 危险黑名单三张表为代码内唯一真源；输出 ReadOnly / Write / Dangerous 三态；未知命令保守归写
- [x] 2.2 写目标提取与 vault 内判定（design §4.1）：cp/mv/ln/sed -i/tee/dd of=/curl -o/字面重定向 token 的目标提取；绝对路径 containment + vault 相对路径存在性佐证；判定不确定不重定向
- [x] 2.3 重定向回送协议（design §4.2）：错误码 `cli_redirected_to_vault_tool` + 固定标记 `<<<LUMIR_REDIRECT_VAULT_TOOL>>>` + JSON 载荷（reason/targets/suggested_tool）；建议工具按写动词形态映射
- [x] 2.4 `cli_run` 工具 description 更新：明示「写 vault 内路径会被重定向到 vault 工具」
- [x] 2.5 `cli_run` schema 增加必填 `purpose` 字段 + 入口校验（design §3.4）：`required: ["command", "purpose"]`；缺省或 trim 后空白在判定管线之前按统一错误信封回送（指明需补填用途），模型补填重发；purpose 不进判定管线任何一层

## 3. vault_move / vault_delete

- [x] 3.1 fs-io 新增 `fs_move_entry`（design §5.2）：两端 resolve_in_vault、撞名不覆盖（复查 + 极窄窗口口径如实注释）、跨卷如实报错不静默 copy+delete、目标父目录须已存在
- [x] 3.2 `vault_move` 工具：定义 / 执行 / 批准预览（源 → 目标路径对）/ 权限主体串取 `path`
- [x] 3.3 `vault_delete` 工具：定义 / 执行（底层 `trash_entry`，无永久删除路径）/ 批准预览（路径 + 「移入废纸篓可恢复」）/ 权限主体串取 `path`
- [x] 3.4 两工具的档行为按裁决点 1 落定后实现（倾向：Vault Write 档 vault_delete 仍走批准闸，Full Access 放行）
- [x] 3.5 工具集扩为 8：`TOOL_NAMES` / `definitions()` / `execute` / `approval_preview` / 系统上下文中的工具清单描述同步更新（单一真源，不留两处各写一份）
  - 说明（M407）：前四项已完成；**系统上下文里的工具清单在 `harness/context.rs`（不在 M407 scope）**，仍写「vault_create 父目录必须已存在」且未列 vault_move / vault_delete——已按 finding 20261009-worker-m407 报出，待后续批次收编。
  - 说明（M407，M405 修订一并落地）：`vault_create` 自动建父目录（mkdir -p 语义）已在 `fs_io::vault_create_file` + `ensure_parent_dirs` 实现，重定向的 `mkdir` → `vault_create` 映射同步生效。

## 4. 会话内批准缓存

- [x] 4.1 Session 加批准缓存字段：键 `(工具名, 规范化主体串)` 精确匹配；新会话 / 切会话 / 重启清空；不落盘不进 JSONL
  - 说明（M407）：实现为 `harness/permission_cache.rs` 的进程内单例，键 `(工具, 规范化主体串)`、**命名空间 `(vault 根, 会话 id)`**——命名空间一变整表换新，即「新会话 / 切 vault / 重启清空」的同一机制。未加到 `Session` 结构上（`session.rs` 归面板批次 mission），语义等价且不必在每个重置点各挂一支清理钩子。
- [ ] 4.2 批准卡新增次级动作「采纳且本会话不再问」（裁决点 4 倾向 A：显式逐次记忆，点采纳不自动记）；缓存命中在模式默认分层内短路，deny / 重定向 / 黑名单三层永远先于缓存
  - 说明（M407，后半句已完成）：缓存命中在第 5 层短路、三层先于缓存已落地并有用例（`permissions.rs::cache_short_circuits_mode_layer_only` + `harness_runtime::session_approval_cache_skips_gate_for_same_subject_only`）。**前半句（次级动作与写入 transport）不在本轮**：按钮是前端动作，且 `ApprovalDecision` / `harness_approve` 的参数表在 `approval.rs` / `commands.rs` / `harness.rs`（均不在 M407 scope，tower 已裁决归后续前端批次）。缓存因此当前恒空——已知中间态，接口契约见 M407 的 review-request。
  - 说明（M407）：`approval.rs` 的 `ApprovalRequest` / `ApprovalDecision` 与 `session.rs` 的 `PendingApprovalSnapshot` 需增 `purpose` / `remember` 字段（plumbing 见 review-request）。

## 5. UI 与配置写回

- [ ] 5.1 权限 chip：composer 控制行第三位（思考 chip 后、ctx 读数前），文案走文案表；浮层三档单选、当前档勾选（M373 浮层形态与 AX 纪律复用）
  - 说明（M407 r3，2026-10-09 Alex 裁决的 §7 修订）：本条原文写作「chip 文案 = 全名（zh：只读 / 保险库写入 / 完全访问）；浮层…无释义」，已作废——**chip 显示短名**（zh：只读 / 写入 / 完全；en：Read / Write / Full）、**浮层列表项显示全名并每档附一行释义**（Kimi 风格，消歧档名与语义）。口径见 design §7 与 spec delta「权限模式切换」requirement；验收场景须断言 chip 短名与浮层「全名 + 释义」（design §8）。属面板批次实现，本条仍归 UI 批次勾选。
- [ ] 5.2 切换写回 `config_set_value("harness", "permission_mode", …)`；对下一个判定生效，不打断进行中轮次
- [x] 5.3 会话建立 / 每轮读取配置的既有装载时点接入新模式键（与 M302 同路，不热重载）
  - 说明（M407）：后端消费已接好——`turn.rs` 的 `handle_call` 每轮从 `config.permission_mode` 现读（「切换对下一个判定生效」因此天然成立），无需新增装载时点。
- [ ] 5.4 批准卡呈现 `purpose`（design §3.4）：cli_run 批准卡命令上方显眼位置展示用途句，命令原文完整可见、不被替代或截断；批准卡载荷带 purpose 字段（既有 argv 类型错配 bug 另批修，本条不依赖其修复面）
  - 说明（M407，后端半边已完成）：`approval_request` 事件在 cli_run 被挂起时已带 `purpose` 键（`tools::ApprovalPreview.purpose` → `turn.rs` 注入），`argv` 仍带完整命令原文。渲染（命令上方显眼位置）归面板批次；`events::approval_request` 的参数表按 tower 裁决由面板批次补可选参数。

## 6. 验证

- [x] 6.1 分类器单测：三表正反例（含包装器类：`bash -c "…"` 在 `full_access` 档仍问——r1 P2-2 口径洞回归）+ 保守降级规则（元字符参数 / 解释器 eval 形态 / 未知命令归写）+ 反向验证（期望改坏必红）
- [x] 6.2 判定管线集成测试（mock provider）：三档 × 五类调用面全矩阵；deny 在只读档仍第一、黑名单在 full_access 仍问、allow 规则在只读档仍生效
  - 说明（M407 r1 修订）：只读档那一格按 Always Ask 断言（`vault_patch` 进批准闸、拒绝后磁盘不变）；另补 `read_only_patch_approval_window_cas_conflict`——只读档下 `vault_patch` 批准窗期间文件被外部改 ⇒ `document_conflict` 回送模型、磁盘不与已批准 diff 分叉（该路径在 r1 的三档全不 gate 形态下不可达，语义修订后复活）。
- [x] 6.3 重定向链测试（mock provider 脚本）：cli_run 写 vault → 收固定标记 → 改调 vault 工具 → 终态断言；「不确定不重定向」反例
- [x] 6.4 `fs_move_entry` 四例（逃逸 / 撞名 / 跨目录 / 跨卷）+ `vault_delete` 废纸篓与失败不留半态
  - 说明（M407）：「跨卷」在单机测试里不可构造，用例以 `rename` 失败（目录移进自身内部）钉住同一语义——失败即如实报 `fs_move_failed`，源与既有内容都不动、目标位置不存在（不做静默 copy+delete、不留半态）。
  - 说明（M407 r1 P2-1 修复）：`vault_create_file_rejects_invalid_targets` 补「不建任何东西」断言（绝对路径输入 `/abs/new.md`、`/abs/deep/new.md` 被拒后 `root/abs`、`root/deep` MUST NOT 存在）——原断言只看错误码，漏掉「码对但目录已建」的假绿。
- [x] 6.5 缓存测试：同主体串免闸、新会话清空、黑名单成员不受缓存影响
- [x] 6.6 `permission_mode` 配置测试：缺省 / 非法回落 / 写回
- [ ] 6.7 scripts/acceptance 新增场景：模式切换 chip 与浮层、批准卡次级动作、批准卡 purpose 用途句呈现、重定向链、vault_move / vault_delete 面板呈现（mock provider 驱动，fixture 合成，证据落 test-results/acceptance/）
  - 说明（M407）：`scripts/acceptance/**` 不在 M407 scope（归面板批次与验收套件维护者），本轮未做。
- [x] 6.8 purpose 链测试（mock provider）：带 purpose 调用在批准卡载荷中 purpose 与命令同达；空 purpose（缺省 / 空白串）不执行且回送补填错误、补填重发成功；同命令带粉饰性 purpose 与否判定结果相同
- [x] 6.9 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
