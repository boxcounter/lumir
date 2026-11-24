# Proposal: 为 harness 增加统一的 DeepSeek 网页搜索与抓取工具

- Change ID: `add-harness-web-fetch-search-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（方向准入、节点 1 裁决），AI agent（起草）

> **评审记录（先读）**
> 方向已采纳：Alex 原话「采纳建议」。已采纳的方向是：统一 `web_fetch` / `web_search` 合同；
> 先接 DeepSeek，真实使用后再决定是否接 Tavily；Brave 只在出现明确的索引 / 控制需求后接入；
> `curl` 保留处理特殊站点与非 HTML 内容。
>
> 节点 1（提案评审）：**待评审**。上述记录锁定方向，不等于本文全部施工默认值已获批准。
> 本文只新增一个需要确认的默认安全裁决 D1（批准粒度）；其余安全项按 fail-closed 技术默认给出，
> 不另扩裁决面。实现尚未开始，也不因方向已采纳而跳过节点 1。

## Why

harness 当前只有 vault 工具、编排工具与调度工具。联网检索需要模型经 `cli_run` 调用外部 CLI，
输出形状、上下文预算、错误分类、密钥处理与网络安全都随 CLI 而变。现有 living spec 还同时写着
「外部能力只能走 Skill + CLI」和「主会话没有 web 工具」，因此本 change 必须显式修改这些旧口径，
不能只追加两件工具而留下相互矛盾的合同。

DeepSeek 已提供与现有 API Key 共用 Bearer 鉴权的原始 JSON API：`POST /v1/tools/search` 与
`POST /v1/tools/fetch`；Search 返回结构化结果，Fetch 返回 Markdown
（[Search & Fetch guide](https://api-docs.deepseek.com/zh-cn/guides/search)、
[Search reference](https://api-docs.deepseek.com/api/search/)、
[Fetch reference](https://api-docs.deepseek.com/api/fetch/)）。先复用现有 provider 配置即可形成
一条完整、可审计的搜索 → 抓取链路，无需先引入第二个搜索服务。

但「能调用 API」不是完整产品合同：

- 搜索结果与网页正文会直接进入模型上下文，必须有统一的来源字段、硬预算与显式截断。
- Search / Fetch 是计费 API，也是数据外发通道；不能把 `vault_read` 的自动放行直接套过来。
- URL 可能指向本机、内网或经重定向 / DNS rebinding 转向这些目标；网页内容还可能包含提示注入。
- 超时、取消、响应过大、空正文与 HTTP 错误必须可区分；重试还要避免重复请求与重复计费。
- DeepSeek-compatible `base_url` 只声明 LLM 协议兼容性，不证明 `/v1/tools/*` 可用。

## What Changes

1. **新增交互主会话的 `web_search` 与 `web_fetch`。** 两件工具共用统一结果信封与来源结构；
   Search 默认 `need_content=false`，先返回可引用来源，再按需 Fetch。Tavily / Brave 不实现，
   也不新增第二套搜索别名。
2. **统一上下文预算与审计字段。** `count`、标题 / 摘要 / 正文 / 错误文本、API 响应字节数均有硬上限；
   顶层 `truncated` 与 `truncated_fields` 明示任何裁剪。来源保留 URL、标题、摘要、站点、日期、
   权威性与 provider；错误保留稳定内部 code、HTTP status、provider code、request id 与尝试次数。
3. **新增独立的 `web_read` 权限类。** 它不是新工具名，也不并入 `vault_read` 的只读白名单。
   推荐默认在所有权限模式下先问；搜索的会话记忆覆盖后续搜索，抓取的会话记忆只覆盖同一
   origin。批准卡与工具结果展示完整 query / URL、DeepSeek provider 与数据外发说明。
4. **只从现有 DeepSeek provider 条目解析凭据。** 仅官方 `https://api.deepseek.com` 可用于
   tools API；自定义 base URL 不探测、不假定支持，也不把该 Key 改投官方地址。无可用配置时返回
   `web_provider_unconfigured`，零网络请求，不静默回落 `curl`。API Key 只进 Authorization 头，
   不进日志、批准卡、会话、历史、工具结果或错误。
5. **建立目标 URL 安全边界。** 只允许 HTTP / HTTPS，拒绝凭据与非全局单播目标；DNS 全地址校验并
   固定已验证地址，重定向逐跳重验。跨 origin 跳转不继承原批准，返回结构化新 URL 供重新调用与批准。
   本地预检只读取有界响应头 / 少量字节，不下载整页；DeepSeek 再执行 Markdown 提取。
6. **如实标注远端抓取边界。** Lumir 能验证自己发出的预检请求，不能观察 DeepSeek 内部的 DNS 与
   重定向。本 change 不声称对 provider 侧 rebinding 提供端到端保证；source URL 只表示实际预检并
   提交给 DeepSeek 的 URL，不伪造 DeepSeek 未返回的 final URL。
7. **固定可靠性与计费边界。** 仅 DeepSeek 返回 HTTP 408 / 429 / 5xx 时做最多两次有界退避重试；
   本地超时、取消、连接失败、200 后协议 / 大小 / 空正文错误均不自动重试。搜索空数组是成功的空结果；
   抓取空 Markdown 是 `web_empty_content`。官方口径为 Search / Fetch 各 5 元 / 1000 次成功请求，
   失败、空结果与超时不计费（[计费说明](https://api-docs.deepseek.com/zh-cn/guides/search)）；
   Lumir 不做账单推测，200 已到达后也不为重试而冒险重复请求。
8. **网页内容永远作为 untrusted data。** 工具描述、结果信封与系统提示共同声明网页文本不是系统指令；
   网页里的命令、批准话术或权限提示不得改变权限、生成 allow 规则或触发自动执行。
9. **复用现有工具历史与重试合同。** Web 工具错误是 `ToolOutput`，不伪装成 LLM 往返失败；
   已执行调用及结果按既有 function call / output 形态留存。后续 LLM 往返失败再显式重试时，
   已执行的 Web 工具不得重放，工具内部重试也不得重放整批工具。
10. **保留 `curl` 的特殊通道。** 非 HTML、特殊站点或 DeepSeek 无法提取的页面可由模型显式选择
    `cli_run("curl", …)`，仍按现有 CLI 分类与批准规则执行；它不是 Web 工具的自动降级路径。
11. **以 mock HTTP 与本地合成服务验收。** 测试 DeepSeek 的真实请求 / 响应形状但不打真实计费 API；
    覆盖权限矩阵、SSRF / redirect / DNS、脱敏、超时取消、计费重试边界、三种 LLM client 的 wire /
    历史恢复 / 重试，以及 search → fetch 全链路。真机不依赖公网。

## 节点 1 裁决点（仅 D1 待确认）

| # | 事项 | 推荐默认值 | 不采纳的代价 |
|---|---|---|---|
| D1 | Web 默认批准与记忆粒度 | **所有权限模式下，`web_search` / `web_fetch` 默认 Ask；搜索可按会话不再问，抓取按 origin 按会话不再问；持久 allow 沿用同一粒度。跨 origin 重定向重新批准。** | 全部逐次问会在 search → 多页 fetch 时造成点击过载；并入只读白名单则会在用户未看见外发目标前发送 query / URL 并产生费用 |

D1 之外的 fail-closed 项不另设产品开关：禁本机 / 内网、禁 URL 凭据、禁自定义 tools base URL、
禁密钥进入任何记录、禁自动 curl 回落、禁 408 / 429 / 5xx 之外的自动重试。它们是该联网能力成立的
安全前提，不作为多个独立裁决点扩张评审面。

## Non-goals

- 本提交只创建 proposal / design / tasks / spec delta，**不实现产品、测试或验收场景**。
- 不实现 Tavily / Brave 适配器；Tavily Extract 仅保留为真实使用后的备选依据
  （[Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract)）。
- 不新增 `search` / `fetch` / `web` 等别名，不做兼容层、双写或第二套工具合同。
- 不新增 Web provider 配置节、API Key 环境变量、模型级搜索开关或自定义 tools base URL 支持。
- 不把 Web 工具授予 cron 或子运行；现有 9 件 vault 工具白名单与内建 `general` 不变。
- 不修改 LLM 的 408 / 425 / 429 / 5xx 显式重试分类；Web 工具自己的重试分类独立且不包含 425。
- 不实现浏览器渲染、JavaScript 执行、图片 / PDF / 下载器、网页存档、登录态或 Cookie 复用。
- 不做账单对账、成本补偿或自动换 provider；不保证 DeepSeek 远端抓取的内部 DNS / redirect 行为。
- 不改 living specs、产品代码、测试、backlog；不进入归档。

## Impact

- **specs**：`harness` 修改「Skill 支持」「工具循环」「权限机制」，新增统一 Web 工具、批准、
  provider 与隐私、目标安全、可靠性及 untrusted content 合同；`harness-subagents` 修改
  「工具集声明与默认收紧」中关于主会话无 Web 工具的旧事实，子运行闭集合保持不变。
- **实现期代码面**：harness 工具注册 / 执行、权限与批准预览、现有 DeepSeek provider 配置解析、
  有界 HTTP 与 DNS / redirect 校验、工具结果留存，以及相应前端批准详情；不新增 provider SDK。
- **实现期验证面**：Rust mock HTTP / 本地 DNS 与目标服务、三种 LLM client wire 与恢复 / 重试测试、
  权限与提示注入回归、既有验收场景闸期望全量回扫，以及本地真机合成 HTTP 验收。
- **关联约束**：不改源文件、配置即数据、密钥不明文外泄、显式截断、权限规则单一真源、
  会话 wire 留存与失败往返不重放工具。无原型，不预设新增视觉系统。

## 验证口径

- 提案阶段：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、
  `bash scripts/docs-check.sh`、指定 change 的 archive-check 与 `git diff --check` 通过；
  diff 只含本 change 的四类制品。
- 实现阶段：先以会失败的反例钉住安全与预算判据，再实现；不得用「mock 显式错误」代替真实 HTTP
  状态、字节流、重定向或 DNS 证据。完整矩阵见 `design.md` 与 `tasks.md`。
- 真机只用本地合成 DeepSeek / 目标 HTTP 服务；真实 DeepSeek 计费 API 不属于验收依赖。
  证据落主仓 `.local/`，不落 worktree；覆盖声明必须附场景名与 PASS 计数。

## 关联材料

- 详细合同、URL 信任边界、错误 / 重试表、测试矩阵：同目录 `design.md`。
- 实现任务与验收拆分：同目录 `tasks.md`。
- 规格增量：同目录 `specs/harness/spec.md` 与 `specs/harness-subagents/spec.md`。
