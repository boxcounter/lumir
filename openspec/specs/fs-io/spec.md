# fs-io Specification

## Purpose

定义 vault 文件系统 IO 的 webview 侧契约：全类型递归枚举（全文件类型一等公民，ADR 0001）、watch 增量事件流、文本/二进制附件读取，以及所有按路径读取的 vault 内路径约束安全边界（ADR 0002 §3：webview 不直接触文件系统）。由 change `add-vault-workspace` 归档并入（2026-09-05，实现 M18；fs_io 经架构复查 P2-5 整体重写，旧 stub 签名废弃）。

## Requirements

### Requirement: 全类型递归枚举

系统 SHALL 提供 `fs_scan_workspace` command 对当前 vault 做全类型递归枚举，返回条目清单：相对路径、文件/目录类型、大小、mtime。枚举 MUST NOT 按扩展名过滤（ADR 0001 全文件类型一等公民）。默认忽略集 SHALL 硬编码为 `.git/`、`.DS_Store`、`node_modules/`（⚠ 裁决点 C，理由：忽略集保护性能合同，一等公民的是文件类型而非 VCS 内部目录）；该集合本 change 内不可配置。旧 stub 签名（`WorkspaceSnapshot` / 返回 `Option`）废弃，MUST NOT 在其上累代码（架构复查 P2-5）。

#### Scenario: 混合类型 vault 全量列出

- **WHEN** vault 内含 md、代码文件、图片、PDF、无扩展名文本与嵌套目录
- **THEN** 枚举结果包含全部条目（忽略集除外），不只含 Markdown

#### Scenario: 忽略集生效

- **WHEN** vault 根含 `.git/` 目录与 `.DS_Store` 文件
- **THEN** 枚举结果不含这些条目及其子孙

### Requirement: watch 增量事件流

vault 打开期间系统 SHALL 监听文件系统变更，并经 `fs:entry_changed` 事件（commands.rs `<domain>:<event>` 命名约定）向 webview 推送增量，事件 payload SHALL 携带变更类型（created / modified / deleted）与相对路径。连续事件 SHALL 在 debounce 窗口内合并推送，窗口初始值 100ms、可随实测调整（⚠ 裁决点 B：逐条增量而非"tree dirty"重扫信号）。watch SHALL 与枚举共用同一忽略集。vault 关闭或替换时 watch SHALL 停止。

#### Scenario: 外部变更实时到达

- **WHEN** vault 打开期间，另一个程序在 vault 内新建、修改、删除文件
- **THEN** webview 在 debounce 窗口后收到对应增量的 `fs:entry_changed` 事件

#### Scenario: 突发变更合并

- **WHEN** 100ms 内发生 50 次文件变更（如 git checkout 切换分支）
- **THEN** 事件合并为少量批次推送，不逐条冲刷 webview

### Requirement: 文本文件读取

系统 SHALL 提供 `fs_read_file` command 按相对路径读取 vault 内文本文件内容，按 UTF-8 解码；非合法 UTF-8 SHALL 返回 `CommandError`（code 稳定、message 为人话中文），MUST NOT 静默替换字符。读取结果 SHALL 经 ts-rs 导出 payload 类型至 `src/bindings/`。

#### Scenario: 非法 UTF-8 人话报错

- **WHEN** 前端请求读取一个 GBK 编码的文本文件
- **THEN** invoke reject 携带 `CommandError`，message 说明文件编码不受支持，前端可直接展示

### Requirement: 二进制附件读取

系统 SHALL 提供按相对路径读取 vault 内二进制附件字节的能力（⚠ 裁决点 A：invoke + base64 为推荐形态，Tauri asset protocol 为候选；最终形态以 Alex 裁决为准，spec 语义不绑定形态），供编辑器渲染附件引用（`![[image.png]]` 等，消费方见 add-editor-live-preview）。附件读取 SHALL 与文本读取走同一 vault 内路径约束。单附件大小 SHALL 设上限（建议 50MB），超限返回人话错误，防止误读大文件撑破常驻内存合同（ADR 0002 §6）。

#### Scenario: 超限附件拒绝

- **WHEN** 请求读取超过大小上限的附件
- **THEN** 返回人话错误，不分配对应内存

### Requirement: vault 内路径约束

fs-io 所有按路径读取的接口 SHALL 校验目标路径解析后不逃逸 vault 根：`..` 穿越、绝对路径、符号链接逃逸均 SHALL 拒绝并返回 `CommandError`。该约束是安全边界，MUST NOT 由调用方（webview）自觉保证。

#### Scenario: 路径穿越拒绝

- **WHEN** 请求路径为 `../../etc/passwd` 或指向 vault 外的符号链接
- **THEN** 返回 `CommandError`，不读取任何 vault 外内容
