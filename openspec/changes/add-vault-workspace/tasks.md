# Tasks: add-vault-workspace

> 正常循环：实现未开始，全部任务未勾选。经 Alex 提案评审（节点 1）通过后才进入实现。

## 1. fs_io 重写（旧 stub 签名废弃，架构复查 P2-5）

- [ ] 1.1 `fs_scan_workspace`：vault 全类型递归枚举，返回条目清单（相对路径、文件/目录、大小、mtime），按裁决点 C 的忽略集过滤
- [ ] 1.2 watch 增量事件流：vault 打开期间监听变更，`fs:entry_changed` 事件推送 created/modified/deleted 增量（debounce 合并，初始 100ms 可随实测调整，见裁决点 B）
- [ ] 1.3 `fs_read_file`：文本文件读取（UTF-8，非法编码返回人话错误 CommandError）
- [ ] 1.4 `fs_read_attachment`：二进制附件读取，接口形态按裁决点 A 的裁决结果实现
- [ ] 1.5 所有读取做 vault 内路径约束：拒绝 `..`、绝对路径、符号链接逃逸
- [ ] 1.6 新 command 全部遵守 commands.rs 薄约定：`<domain>_<verb>` 命名、`Result<T, CommandError>`、payload 类型 ts-rs 导出至 `src/bindings/`

## 2. vault 打开与记忆（vault-workspace）

- [ ] 2.1 `vault_open` command：系统目录选择器打开 vault，成功后写入 `last_vault`
- [ ] 2.2 启动恢复：`last_vault` 存在且为合法目录时自动打开；失效时进入未打开状态并给人话提示
- [ ] 2.3 配置写入遵守 config.rs 校验纪律（逐字段校验、人话 warning，ADR 0002 §5）

## 3. 文件树 UI 与 shell 集成（file-tree）

- [ ] 3.1 文件树挂载 shell `fileTree` pane，展示全类型条目，目录可折叠
- [ ] 3.2 点击文件在编辑器打开：md 走编辑器；文本只读显示原文；不支持的二进制给"暂不支持预览"提示
- [ ] 3.3 watch 事件驱动文件树增量刷新（不全量重扫）
- [ ] 3.4 未打开 vault 空态：显示打开入口

## 4. 提案评审（节点 1）

- [ ] 4.1 Alex 评审通过：不看代码即可裁决——动机、接口设计（裁决点 A/B/C）、Non-goals 四者都答清楚；与 add-editor-live-preview 的跨 change 依赖关系明确

## 5. 验证

- [ ] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 5.2 打开作者真实 vault：文件树全类型展示、watch 增量刷新生效、`last_vault` 重启恢复；性能门禁（perf.yml）不回归
