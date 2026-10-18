# note-templates 增量规格

> 起草注记（非规格正文）：本 delta 新建 capability `note-templates`。设计见
> [design.md](../../design.md)，裁决背景见 [proposal.md](../../proposal.md)。本 capability 是
> **独立原语**：定义「定期笔记」的创建与打开，被 cron 及其它调用方复用；MUST NOT 依赖 cron 的
> 任务配置、通知或调度——cron 只单向引用模板 id（见 [cron 增量](../cron/spec.md)）。

## ADDED Requirements

### Requirement: 模板定义

系统 SHALL 以配置即数据形态定义模板（ADR 0002 第 5 条）：`[note_templates].<id>` =
`{path, body, prompt?}`。`path` SHALL 是 vault 相对路径模板（非空、非绝对路径、不含 `..`），
`body` SHALL 是正文行字符串数组（可为空数组），`prompt` SHALL 为可选字符串。`path` 与 `body`
SHALL 支持唯一占位符 `{{date}}`，替换为本机本地日期 `YYYY-MM-DD`；MUST NOT 提供其它占位符或
格式化 DSL。

校验 SHALL 逐项进行：模板 id 为空 / 含空白、`path` 缺失或非法、`body` 缺失或非字符串数组 ⇒
丢弃该模板并给一条人话 warning；`prompt` 类型非法 ⇒ 只丢弃 `prompt`、保留模板并给一条 warning。
未知 `{{…}}` 占位符 SHALL 只在装载时给一条 warning，`path` / `body` 原样保留（MUST NOT 改写
用户内容）。`[note_templates]` 整节形状非法 SHALL 走既有解析模型的整文件回落；整节缺席 SHALL 表示
空模板表（不告警），此时模板入口调用返回人话错误。

模板定义 MUST NOT 读取或依赖 cron 配置：模板模块不知道任务、调度与通知的存在。

#### Scenario: 合法模板装载

- **WHEN** 配置定义模板 `daily-log`：`path = "daily/{{date}}.md"`、`body` 含日期 frontmatter 与小节
- **THEN** 装载成功、无 warning；占位符在实例化时替换为当天本地日期

#### Scenario: 非法路径丢该项

- **WHEN** 某模板 `path` 为绝对路径或含 `..`
- **THEN** 该模板被丢弃并给出一条人话 warning；其它模板照常生效

#### Scenario: prompt 类型非法只丢 prompt

- **WHEN** 某模板 `prompt` 为数字
- **THEN** 模板仍可用（`path` / `body` 保留），`prompt` 被丢弃并给出一条人话 warning

#### Scenario: 未知占位符原样保留

- **WHEN** `body` 含 `{{time}}`
- **THEN** 装载时给出一条 warning；实例化后文件正文仍含字面量 `{{time}}`，不被报错或删除

#### Scenario: 模板不依赖 cron

- **WHEN** 配置只有 `[note_templates]`、没有 `[cron]` 节
- **THEN** 模板定义照常装载，模板入口可用；无任何与 cron 相关的 warning 或副作用

### Requirement: 模板实例化

系统 SHALL 提供「按模板创建当日实例」的能力，语义为 **create-if-absent**：

- 目标路径 SHALL 由 `path` 替换占位符后拼到目标 vault 根、并遵守 vault 内路径约束（与 fs-io
  同一套边界：拒绝绝对路径、`..`、解析后越界）；违反者 SHALL 返回人话错误，MUST NOT 写盘。
- 目标已存在（文件、目录、符号链接或尚未下载的 iCloud 占位文件）⇒ SHALL 返回「已存在」，
  MUST NOT 读取、覆盖或改写任何字节（ADR 0003 第 3 条铁律）。
- 目标不存在 ⇒ SHALL 创建缺失的父目录，并以原子创建语义（`create_new` / `O_EXCL`）写入正文：
  `body` 各行以 `\n` 连接、文件以单个 `\n` 结尾。MUST NOT 用「先探测再写」的非原子路径替代。
- 写入失败 ⇒ SHALL 删除本次已创建的文件（MUST NOT 留下半截实例）、返回人话错误信封并落一条
  诊断事件。
- 同一模板同日的多次调用 SHALL 幂等：第二次及以后不写盘（内容与 mtime 不变）。

实例化 SHALL 只接受 `(vault 根、模板、日期)` 三个输入，MUST NOT 感知 cron、通知或调度。

#### Scenario: 首次创建内容正确

- **WHEN** 调用实例化，目标路径不存在，日期为 2026-10-18
- **THEN** 文件被创建，`path` 与 `body` 中的 `{{date}}` 均为 `2026-10-18`，正文按行以 `\n` 连接并以单个 `\n` 结尾

#### Scenario: 二次调用不覆盖

- **WHEN** 已存在今日实例且用户已写入内容，再次调用实例化
- **THEN** 返回「已存在」，文件内容与 mtime 均不变

#### Scenario: 父目录自动创建

- **WHEN** 目标路径为 `daily/2026-10-18.md` 且 `daily/` 目录不存在
- **THEN** `daily/` 被创建，随后实例文件创建成功

#### Scenario: 非法路径拒绝

- **WHEN** 模板 `path` 解析后越出 vault（绝对路径 / `..` / 符号链接指向 vault 外）
- **THEN** 返回人话错误且不写盘；不创建任何目录或文件

#### Scenario: 写入失败不留半截

- **WHEN** 目标目录只读或写入中途失败
- **THEN** 本次已创建的文件被清理，返回人话错误并记录诊断事件

### Requirement: 当日实例的打开入口

系统 SHALL 提供独立于 cron 的打开入口（应用命令）：按 `template_id` 打开当日实例，`vault` 显式
给出时用该 vault、省略时用当前打开的 vault。入口 SHALL 先执行实例化（见「模板实例化」），再打开：
不存在则创建后打开、已存在则直接打开，MUST NOT 覆盖既有字节。

打开 SHALL 复用既有文档打开链路（既有标签 / 分屏规则），MUST NOT 实现第二套打开逻辑；打开动作
SHALL 以与 cron 点击链路相同的单一前端事件交付（载荷含 vault、路径、创建与否、可选 prompt），
前端只有一处处理器。

模板声明了 `prompt` 时，入口 SHALL 把 prompt 预载进该 vault 的 harness composer 草稿（复用既有
草稿持久化通道），MUST NOT 自动发送，MUST NOT 因此发起任何模型请求。vault 未打开、路径不可写等
失败情形 SHALL 返回人话错误，MUST NOT 静默。

本入口 SHALL 在无 cron 任务、无通知权限、通知插件不可用时照常可用——模板机制不依赖 cron。

#### Scenario: 无 cron 时打开当日笔记

- **WHEN** 配置只有模板定义、没有 cron 任务，调用独立入口
- **THEN** 今日实例被创建（若不存在）并在标签中打开；全程无通知、无调度参与

#### Scenario: 已存在时只打开

- **WHEN** 今日实例已存在且含有用户内容，调用独立入口
- **THEN** 文件字节与 mtime 不变，仅打开该文件

#### Scenario: prompt 预载不发送

- **WHEN** 模板声明了 prompt，调用独立入口成功
- **THEN** composer 草稿内容为该 prompt，对话未被发送、无模型请求、无 token 消耗

#### Scenario: 打开复用既有链路

- **WHEN** 当前已打开同一文件所在 vault 的其它文档，调用独立入口
- **THEN** 文件按既有标签 / 分屏规则打开，行为与「从文件树打开同一文件」一致

#### Scenario: 失败出声

- **WHEN** 入口的 vault 未打开且无法解析，或目标路径不可写
- **THEN** 返回人话错误信封（不静默、不创建半截文件），应用其余功能不受影响
