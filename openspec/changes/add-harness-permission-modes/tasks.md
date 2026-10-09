# Tasks: add-harness-permission-modes

> 提案阶段任务清单；Alex 节点 1 裁决通过后方可进入实现。裁决点见 proposal「Alex 裁决点」——实现按裁决结果落表，不替 Alex 选。

## 1. 判定管线与三档模式

- [ ] 1.1 `permissions.rs` 重构为五层判定管线（design §1）：deny 规则 > vault 内写重定向 > 危险黑名单 > allow 规则 > 模式默认分层；`decide` 签名保留，新增模式参数与分类器输入
- [ ] 1.2 三档语义表落地（design §2）：`read_only` / `vault_write`（默认）/ `full_access`；Read Only 档 vault 写工具为 Deny（非 Ask），危险黑名单任何档 Ask
- [ ] 1.3 `config.rs` 新增 `[harness].permission_mode`：闭集合三值、默认 `vault_write`、非法回落 + 人话 warning（沿用既有校验模板）；ts-rs 绑定重导出随实现同 PR

## 2. cli_run 分类与重定向

- [ ] 2.1 分类器实现（design §3）：只读白名单 / 保守降级规则 / 危险黑名单三张表为代码内唯一真源；输出 ReadOnly / Write / Dangerous 三态；未知命令保守归写
- [ ] 2.2 写目标提取与 vault 内判定（design §4.1）：cp/mv/ln/sed -i/tee/dd of=/curl -o/字面重定向 token 的目标提取；绝对路径 containment + vault 相对路径存在性佐证；判定不确定不重定向
- [ ] 2.3 重定向回送协议（design §4.2）：错误码 `cli_redirected_to_vault_tool` + 固定标记 `<<<LUMIR_REDIRECT_VAULT_TOOL>>>` + JSON 载荷（reason/targets/suggested_tool）；建议工具按写动词形态映射
- [ ] 2.4 `cli_run` 工具 description 更新：明示「写 vault 内路径会被重定向到 vault 工具」

## 3. vault_move / vault_delete

- [ ] 3.1 fs-io 新增 `fs_move_entry`（design §5.2）：两端 resolve_in_vault、撞名不覆盖（复查 + 极窄窗口口径如实注释）、跨卷如实报错不静默 copy+delete、目标父目录须已存在
- [ ] 3.2 `vault_move` 工具：定义 / 执行 / 批准预览（源 → 目标路径对）/ 权限主体串取 `path`
- [ ] 3.3 `vault_delete` 工具：定义 / 执行（底层 `trash_entry`，无永久删除路径）/ 批准预览（路径 + 「移入废纸篓可恢复」）/ 权限主体串取 `path`
- [ ] 3.4 两工具的档行为按裁决点 1 落定后实现（倾向：Vault Write 档 vault_delete 仍走批准闸，Full Access 放行）
- [ ] 3.5 工具集扩为 8：`TOOL_NAMES` / `definitions()` / `execute` / `approval_preview` / 系统上下文中的工具清单描述同步更新（单一真源，不留两处各写一份）

## 4. 会话内批准缓存

- [ ] 4.1 Session 加批准缓存字段：键 `(工具名, 规范化主体串)` 精确匹配；新会话 / 切会话 / 重启清空；不落盘不进 JSONL
- [ ] 4.2 批准卡新增次级动作「采纳且本会话不再问」（裁决点 4 倾向 A：显式逐次记忆，点采纳不自动记）；缓存命中在模式默认分层内短路，deny / 重定向 / 黑名单三层永远先于缓存

## 5. UI 与配置写回

- [ ] 5.1 权限 chip：composer 控制行第三位（思考 chip 后、ctx 读数前），文案走文案表（zh：只读 / 保险库写入 / 完全访问）；浮层三档单选、当前档勾选、无释义（M373 浮层形态与 AX 纪律复用）
- [ ] 5.2 切换写回 `config_set_value("harness", "permission_mode", …)`；对下一个判定生效，不打断进行中轮次
- [ ] 5.3 会话建立 / 每轮读取配置的既有装载时点接入新模式键（与 M302 同路，不热重载）

## 6. 验证

- [ ] 6.1 分类器单测：三表正反例（含包装器类：`bash -c "…"` 在 `full_access` 档仍问——r1 P2-2 口径洞回归）+ 保守降级规则（元字符参数 / 解释器 eval 形态 / 未知命令归写）+ 反向验证（期望改坏必红）
- [ ] 6.2 判定管线集成测试（mock provider）：三档 × 五类调用面全矩阵；deny 在只读档仍第一、黑名单在 full_access 仍问、allow 规则在只读档仍生效
- [ ] 6.3 重定向链测试（mock provider 脚本）：cli_run 写 vault → 收固定标记 → 改调 vault 工具 → 终态断言；「不确定不重定向」反例
- [ ] 6.4 `fs_move_entry` 四例（逃逸 / 撞名 / 跨目录 / 跨卷）+ `vault_delete` 废纸篓与失败不留半态
- [ ] 6.5 缓存测试：同主体串免闸、新会话清空、黑名单成员不受缓存影响
- [ ] 6.6 `permission_mode` 配置测试：缺省 / 非法回落 / 写回
- [ ] 6.7 scripts/acceptance 新增场景：模式切换 chip 与浮层、批准卡次级动作、重定向链、vault_move / vault_delete 面板呈现（mock provider 驱动，fixture 合成，证据落 test-results/acceptance/）
- [ ] 6.8 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
