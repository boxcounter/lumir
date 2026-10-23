# fs-io 增量规格

> 起草注记（非规格正文）：本 delta 一条 ADDED，基线是 living spec
> [openspec/specs/fs-io/spec.md](../../../../specs/fs-io/spec.md)。既有「vault 内路径约束」条
> **逐字不动**——本增量新增的是一条**只读、只按显式绝对路径、只读单个文件**的旁路通道，消费方只有
> `quick-open` 的 vault 外只读会话；两者的边界必须能各自独立读懂，故不写进既有条款。设计与安全面
> 见 [design.md](../../design.md) §5。

## ADDED Requirements

### Requirement: vault 外只读读取通道

系统 SHALL 提供 `fs_read_external` command：按**绝对路径**读取一个 vault 外的文本文件内容，供
`quick-open` 的 vault 外只读会话使用。它是本仓**唯一**一条允许读取 vault 外文件的接口，且 SHALL
只服务「用户显式输入了一条绝对路径」这一种触发（MUST NOT 用于目录扫描、批量读取、后台任务或任何
自动发现）。

入参校验 SHALL 全部在 Rust 侧完成（MUST NOT 由 webview 保证），逐条为：

- 入参 SHALL 是绝对路径；相对路径、裸文件名与含 `..` 段的路径一律拒绝；
- 目标 SHALL 经归一化后是**常规文件**——归一化 SHALL 跟随符号链接（否则 `/tmp` 这类本身是符号链接
  的常见路径会被误拒）；目录、设备文件与不存在的路径一律返回人话 `CommandError`；
- 目标大小 SHALL 不超过既有文本读取上限（50MB，与 vault 内文本读取共用同一个常量，MUST NOT 另写
  一个数值）；
- 内容 SHALL 按 UTF-8 解码；非法 UTF-8 SHALL 返回与 vault 内文本读取**同一组**错误码与同一套人话
  措辞，MUST NOT 发明平行错误码（错误码到文案的映射表只应有一份）。

返回的 payload SHALL 只含内容，MUST NOT 含磁盘 revision、MUST NOT 含 mtime——外部会话不保存、
不参与监听，这两个字段没有消费者。payload 类型 SHALL 经 ts-rs 导出至 `src/bindings/`。

该 command MUST NOT：列举目录、通配、递归、读取目录项、创建 / 改写 / 删除任何文件。它 MUST NOT 改变
vault 状态（未打开 vault 时同样可用——它不依赖 vault）。它 MUST NOT 被设计成「把任意目录当 vault」
的入口。

**与既有约束的关系（边界必须能各自读懂）**：`fs-io` 既有的「vault 内路径约束」继续逐字有效——
所有按 vault 相对路径读取的接口仍拒绝绝对路径 / `..` / 符号链接逃逸，本增量 MUST NOT 放宽其中任何
一条。本命令不参与枚举、索引、监听与保存链路；vault 内文件若要读，仍走既有接口（调用方按「路径
是否落在 vault 根之下」决定走哪条，判据只在前端装配层一处）。

#### Scenario: 绝对路径文本文件可读

- **WHEN** 以 `/tmp/lumir-probe/notes.md`（存在、常规文件、合法 UTF-8、小于 50MB）调用
  `fs_read_external`
- **THEN** 返回文件全文；不产生任何写操作，vault 状态不变

#### Scenario: 目录与非绝对路径拒绝

- **WHEN** 分别以 `/tmp`（目录）、`notes.md`（相对路径）、`/tmp/../etc/passwd`（含 `..` 段）调用
- **THEN** 三次都返回人话 `CommandError`，不读取任何内容

#### Scenario: 超限与非法编码拒绝

- **WHEN** 以一个超过 50MB 的文本文件、以及一个 GBK 编码的文本文件调用
- **THEN** 前者返回大小超限的人话错误（不分配对应内存），后者返回与 vault 内读取同码的编码错误；
  两次都不静默替换字符

#### Scenario: 既有 vault 内接口不被放宽

- **WHEN** 以 `../../etc/passwd` 或一个 vault 外绝对路径调用既有的 vault 内读取接口
- **THEN** 仍返回路径越界错误（「vault 内路径约束」逐字不变）；vault 外读取只经本增量新增的 command
