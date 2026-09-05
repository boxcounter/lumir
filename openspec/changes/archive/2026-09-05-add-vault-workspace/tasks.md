# Tasks: add-vault-workspace

> 归档状态（M21，2026-09-05）：实现已随 M18（feat/vault-workspace，commit 09cd339 + review r1 修复 d061732）与 M20 接线（f74cd39 + r1 p2 修复 3f79cc1）合并入 master（de145ad）。1.x–5.1 逐项对照实现核实勾选；5.2 未勾，按 tower 裁决由 Alex 人肉验收替代（见该条标注），不伪造完成。归档说明（一致性论证）见文末第 6 节，供 Alex 节点 2 评审。

## 1. fs_io 重写（旧 stub 签名废弃，架构复查 P2-5）

- [x] 1.1 `fs_scan_workspace`：vault 全类型递归枚举，返回条目清单（相对路径、文件/目录、大小、mtime），按裁决点 C 的忽略集过滤
- [x] 1.2 watch 增量事件流：vault 打开期间监听变更，`fs:entry_changed` 事件推送 created/modified/deleted 增量（debounce 合并，初始 100ms 可随实测调整，见裁决点 B）
- [x] 1.3 `fs_read_file`：文本文件读取（UTF-8，非法编码返回人话错误 CommandError）
- [x] 1.4 `fs_read_attachment`：二进制附件读取，接口形态按裁决点 A 的裁决结果实现
- [x] 1.5 所有读取做 vault 内路径约束：拒绝 `..`、绝对路径、符号链接逃逸
- [x] 1.6 新 command 全部遵守 commands.rs 薄约定：`<domain>_<verb>` 命名、`Result<T, CommandError>`、payload 类型 ts-rs 导出至 `src/bindings/`

## 2. vault 打开与记忆（vault-workspace）

- [x] 2.1 `vault_open` command：系统目录选择器打开 vault，成功后写入 `last_vault`
- [x] 2.2 启动恢复：`last_vault` 存在且为合法目录时自动打开；失效时进入未打开状态并给人话提示
- [x] 2.3 配置写入遵守 config.rs 校验纪律（逐字段校验、人话 warning，ADR 0002 §5）

## 3. 文件树 UI 与 shell 集成（file-tree）

- [x] 3.1 文件树挂载 shell `fileTree` pane，展示全类型条目，目录可折叠
- [x] 3.2 点击文件在编辑器打开：md 走编辑器；文本只读显示原文；不支持的二进制给"暂不支持预览"提示
- [x] 3.3 watch 事件驱动文件树增量刷新（不全量重扫）
- [x] 3.4 未打开 vault 空态：显示打开入口

## 4. 提案评审（节点 1）

- [x] 4.1 Alex 评审通过：不看代码即可裁决——动机、接口设计（裁决点 A/B/C）、Non-goals 四者都答清楚；与 add-editor-live-preview 的跨 change 依赖关系明确

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（M21 归档前复验通过）
- [ ] 5.2 打开作者真实 vault：文件树全类型展示、watch 增量刷新生效、`last_vault` 重启恢复；性能门禁（perf.yml）不回归
  - **未勾，由 Alex 人肉验收替代**（tower 裁决，M21 归档标注）：M1 出口标准本身就是"Alex 用 Lumir 只读浏览整个真实 vault"（ADR 0004 §1），本项实质是 M1 出口验收动作，不应由实现 agent 自勾替代。可自动化部分已覆盖：cargo 32 tests 绿（含忽略集、symlink 循环不崩、外部 symlink 不展开、watch 批次推送等单测）；M18 真机 e2e 自测（dialog 打开自建 vault → 树展示 → 点击打开 → 外部变更 watch 批次到达，见 09cd339 commit message）；视觉门禁 3/3 绿；perf.yml 在 master 上以 enforce:true 门禁运行。

## 6. 归档说明（M21 记录，供 Alex 节点 2 评审）

本节回答节点 2 的通过标准："spec 增量与 proposal 的意图一致，无实现期静默扩 scope"。

**实现与 proposal 意图的一致性**

- 三个 capability（vault-workspace / fs-io / file-tree）与 proposal「What Changes」五条一一对应；无新增 capability，无删除或改写 requirement 意图。
- 裁决点落地均与推荐项一致：A 取 invoke + base64（`fs_read_attachment`，单附件 50MB 上限，`ATTACHMENT_MAX_BYTES`）；B 取逐条增量 + 100ms debounce 批次推送（窗口内同路径去重、已知路径集修正 FSEvents 重放误报——属裁决点 B"窗口值可随实测调整"语义内的实现细节，非口径变更）；C 取硬编码最小忽略集 `.git` / `.DS_Store` / `node_modules`，不可配。
- Non-goals 全部守住：无任何写操作；无索引/搜索；无 wikilink 解析；无 `.gitignore` 解析与"显示被忽略项"开关；非 md 文件文本只读显示原文、二进制给"暂不支持预览"提示；无 CSP 变更。

**review 修复历史（透明披露）**

- M18 review r1 P1（d061732）：`scan_workspace` 原实现判型跟随 symlink——指向 vault 外目录的符号链接会被递归展开枚举，实质绕过「vault 内路径约束」requirement 的安全边界。修复：改用 `DirEntry::file_type()` 不跟随 symlink，symlink 条目按文件列出，读取侧仍由 `resolve_in_vault` 拒绝逃逸；size/mtime 与 `refine_with_known` 统一改 `symlink_metadata`。补单测：symlink 循环不崩、外部 symlink 不展开枚举。修复后行为与 spec「路径穿越拒绝」scenario 完全一致，spec 文本无需修订。
- M18 review r1 P2-1（d061732）：`tree.ts` `applyChanges` 删目录时未连带 `path+'/'` 前缀子孙（同路径重建永不挂载）、同批事件未按路径深度排序（子先于父丢条目）。修复后符合 file-tree「watch 驱动的增量刷新」requirement。
- M18 review r1 P2-2（d061732）：`write_last_vault` version 盲写。修复：提取纯函数 `merge_last_vault`，version 仅在缺失或不高于当前 schema 时写入，保留更高版本标记——对齐 config.rs「配置即数据」纪律（ADR 0002 §5）。
- M20 接线（f74cd39）：`setAttachmentProvider` 注入生产 provider（`resolveByName` 走 vault 文件索引活读闭包，setVault / watch 增量同步维护；`readDataUrl` 走 ipc 的 `fsReadAttachment` 封装，裁决点 A 形态）；打开文件改走 `editor.openDocument`，模式裁决收进编辑器内核。
- M20 review r1 p2（3f79cc1）：`openDocument` 对无类型线索文件原回落 `currentMode`，模式随上一个打开文件漂移（打开 .rs 后再开 notes.txt 会停在 code）。修复：引入 `defaultMode` 基线，`setMode`（配置加载 / 用户显式切换）锚定基线，`openDocument` 回落基线而不改基线。此修复使实现与 file-tree「点击打开文件」及 add-editor-live-preview「模式配置来源」的"配置仅作无类型线索时的默认"口径严格对齐——属 spec 意图的兑现，非新增行为。

**归档时对 spec 增量的修订**：无。三份增量按原样并入 living specs。

**Follow-up（不阻塞归档）**

- 5.2 真实 vault 验收：随 M1 出口由 Alex 人肉执行；通过前 living specs 的 vault 三 capability 视为"实现已合并、未经真实 vault 出口验收"状态。
