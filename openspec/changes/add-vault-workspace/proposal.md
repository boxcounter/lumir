# Proposal: vault 打开与全类型文件树——fs_io 重写 + shell 文件树集成

- Change ID: add-vault-workspace
- 日期: 2026-09-05
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

M1 范围（[ADR 0004 §1](../../../docs/adr/0004-development-and-openness-strategy.md) 里程碑表）的前两项是 vault 打开与全类型文件树；M1 出口标准是"能用 Lumir 只读浏览作者的整个真实 vault"——本 change 是该出口的承载面。

"全文件类型一等公民"是定位空位的四个角之一（[ADR 0001](../../../docs/adr/0001-product-positioning-and-boundaries.md) Context：Obsidian 只原生支持 md 与少数媒体附件，任意文本与代码文件无一等公民支持）。因此文件树必须递归展示 vault 内全部文件类型，而不是只列 Markdown。

架构复查（reviewer-arch-m0，2026-09-04）P2-5 判定：`fs_io` 现有 stub（快照式 `scan_workspace`、模块 doc 写"Markdown 文件"）边界必被本 change 撑破——缺 watch 增量事件流、缺二进制附件读取、措辞与全类型文件树矛盾；并明确"所有 stub 签名应当视为可丢弃，不得在其上累代码"。本 change 据此整体重写 fs_io，旧签名废弃。

Foundation（M16 已合并）已备好本 change 的全部接缝，提案接口设计与真实缝对齐：command 命名空间 `<domain>_<verb>` 与 `CommandError` 信封（src-tauri/src/commands.rs）、`last_vault` 字段已定义未消费（src-tauri/src/config.rs，注释明写"mid-M1 记住上次 vault 消费"）、shell 三 pane 布局与 `fileTree` 挂载点（src/shell.ts）、前端 invoke 薄封装（src/ipc.ts）。事件命名遵循 `<domain>:<event>`（如 `fs:entry_changed`）。

## What Changes

新增三个 capability：`vault-workspace`、`fs-io`、`file-tree`。每条对应 specs/ 增量中的 requirement。

1. **vault 打开与记忆**（`vault-workspace`）：`vault_open` command 调系统目录选择器打开 vault；打开成功后写入 `last_vault`；启动时若 `last_vault` 存在且仍为合法目录则自动恢复，否则进入未打开状态并给出人话提示。配置写入复用 config.rs 的"配置即数据"校验纪律（ADR 0002 §5）。
2. **fs_io 重写为全类型递归枚举**（`fs-io`）：`fs_scan_workspace` 返回 vault 全量条目清单（相对路径、文件/目录、大小、mtime），不按扩展名过滤。旧 stub 签名（`WorkspaceSnapshot` / `scan_workspace` 返回 `Option`）废弃，不再保留兼容。
3. **watch 增量事件流**（`fs-io`）：vault 打开期间监听文件系统变更，经 `fs:entry_changed` 事件向 webview 推送增量（created / modified / deleted，携带相对路径），前端据此增量刷新文件树而非全量重扫。
4. **文件内容读取与二进制附件读**（`fs-io`）：`fs_read_file` 读文本文件内容（UTF-8，非法编码给人话错误）；`fs_read_attachment` 读二进制附件，供编辑器渲染图片等附件引用（消费方为 add-editor-live-preview，跨 change 关系见该提案的显式声明）。所有读取做 vault 内路径约束，拒绝逃逸 vault 根的路径（`..`、绝对路径、符号链接逃逸）。
5. **文件树 UI 与 shell 集成**（`file-tree`）：文件树挂载到 shell 的 `fileTree` pane；展示全类型条目，目录可折叠；点击文件在编辑器打开（md 走编辑器，其余类型本波只读显示原文或提示不支持预览——见 Non-goals）；watch 事件驱动增量刷新；未打开 vault 时显示空态与打开入口。

**⚠ 裁决点 A——二进制附件读接口形态**：两个候选：
- **invoke + base64**（推荐）：走既有 invoke/CommandError 契约，错误信封一致、实现直接；代价是体积膨胀约 33% 且经 serde 拷贝，大图片有开销。
- **Tauri asset protocol**（`convertFileSrc`）：webview 原生加载、零拷贝、性能更好；代价是要配置 asset protocol scope，并在 invoke 契约之外引入第二条数据通道（该通道的错误面不经 CommandError 信封）。CSP 不再是本选项的额外成本：M16 已把 `img-src 'self' asset: data:` 落地进 tauri.conf.json，两种形态在 CSP 侧均已放行。

推荐 invoke + base64 的理由：M1 附件引用以图片为主、单张体积有限；契约单一来源（payload 类型 ts-rs 导出、错误走 CommandError 信封）不被第二条通道稀释；若 dogfood 期大图片成为性能痛点，再经 OpenSpec 循环切换 asset protocol，对消费方的接口语义（"按路径取附件字节"）不变。（r1 评审修正：原将"CSP 需配置"计为 asset protocol 的代价，该成本已随 M16 消失；修正后推荐项不变——推荐理由不依赖该项成本。）**该取舍请 Alex 裁决；add-editor-live-preview 只声明依赖"按路径读附件字节"这一能力，不绑定具体形态。**

**⚠ 裁决点 B——watch 事件粒度**：逐条增量事件（created/modified/deleted 各一条，前端精确打补丁）vs 粗粒度"tree dirty"信号（前端 debounce 后重扫）。推荐逐条增量：真实 vault 条目数在千级，全量重扫在频繁变更（如 git 操作）下会造成文件树闪烁；代价是前端要维护一个小的增量应用逻辑。debounce 窗口建议 100ms 合并连续事件，具体值实现期可在 spec 允许的语义内调整。

**⚠ 裁决点 C——枚举忽略规则**：全类型一等公民不等于"无差别枚举一切"。候选默认忽略集：`.git/`、`.DS_Store`、`node_modules/`（硬编码忽略，不可配）vs 全量枚举不忽略。推荐硬编码最小忽略集：`.git` 在作者 vault 中存在且含数万对象文件，枚举它直接威胁性能合同（ADR 0002 §6）与常驻内存；`node_modules` 同理。这不与"全文件类型一等公民"冲突——一等公民的是文件类型，不是 VCS 内部目录。是否在 UI 提供"显示被忽略项"开关，本波不做（Non-goals）。

## Non-goals

- 不做任何写操作：文件创建、重命名、删除、编辑保存均不在本 change（M1 出口是只读浏览；写入路径等 M2 agent 变更流统一设计，避免先做一套再被审批/回滚体系推翻）。
- 不做文件内容与索引、搜索（index 模块 M1 无调用者，架构复查 P2-11）。
- 不做 wikilink 跳转与链接解析——那是独立 change（本 change 的 `fs_read_file` 只是它的读接口）。
- 不做 `.gitignore` 解析与遵循；不做"显示隐藏文件/被忽略项"开关。
- 不做非 md 文件的预览渲染（图片除外——图片显示在 add-editor-live-preview 的附件显示里）；其余类型点击后只读显示原文（文本）或"暂不支持预览"提示（二进制）。
- 不涉及 CSP 变更：完整 CSP 策略（含 `img-src 'self' asset: data:`）已随 M16 落地于 tauri.conf.json，裁决点 A 的两种形态在 CSP 侧均已放行。

## Impact

- 影响的 specs：新增 capability `vault-workspace`、`fs-io`、`file-tree`。
- 影响的代码/系统：`src-tauri/src/fs_io.rs`（整体重写）、`src-tauri/src/commands.rs`（新增 vault/fs 命名空间 command）、`src-tauri/src/config.rs`（last_vault 消费与写入）、`src/shell.ts` 与 `src/main.ts`（文件树挂载与装配）、新增文件树 UI 模块、`src/ipc.ts`（薄封装扩充）、`src/bindings/`（ts-rs 新 payload 类型）。watch 需要引入文件系统监听 crate（如 `notify`），依赖新增随实现 PR 评审。
- 关联约束：ADR 0001（全文件类型一等公民）；ADR 0002 §3（文件 IO/监听全部在 Rust core，webview 不直接触文件系统）、§6（性能合同：枚举与事件推送不得威胁打开 1MB <100ms 与常驻内存 <200MB，裁决点 C 的直接依据）、§7（fs_io 数据结构不得依赖 UI 类型）；ADR 0003 §3 铁律（本 change 只读，天然满足）；架构复查 P2-5（stub 签名可丢弃）。
