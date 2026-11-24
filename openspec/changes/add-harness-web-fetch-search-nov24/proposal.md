# Proposal: 为 harness 增加统一的 DeepSeek 网页搜索与抓取工具

- Change ID: `add-harness-web-fetch-search-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（方向准入、节点 1 裁决），AI agent（起草）

> **评审记录（先读）**
> 方向已采纳：Alex 原话「采纳建议」。已采纳的方向是：统一 `web_fetch` / `web_search` 合同；
> 先接 DeepSeek，真实使用后再决定是否接 Tavily；Brave 只在出现明确的索引 / 控制需求后接入；
> `curl` 保留处理特殊站点与非 HTML 内容。
>
> r1 独立评审对 `9ccad844` 判 `needs-changes`：系统代理可绕过固定 IP、统一输出存在三处矛盾、
> living 回扫不完整、真机注入链未闭合。本稿逐项修订，并回应 Alex 追问「有没有用户在哪里配置的设计？」，
> 新增「设置 → 自动化 → 网页访问」的 D2 建议。
>
> 节点 1（提案评审）：**待评审 / r2**。D1 默认批准粒度与 D2 设置入口均待 Alex 确认；
> 讨论中的设置建议不记作用户已批准。实现尚未开始，也不因方向已采纳而跳过节点 1。

## Why

harness 当前只有 vault 工具、编排工具与调度工具。联网检索需要模型经 `cli_run` 调用外部 CLI，
输出形状、上下文预算、错误分类、密钥处理与网络安全都随 CLI 而变。现有 living spec 还同时写着
「外部能力只能走 Skill + CLI」「主会话没有 web 工具」「设置面板不得渲染权限规则」等口径，
因此本 change 必须显式修改这些旧合同，不能只追加两件工具而留下相互矛盾的规定。

DeepSeek 已提供与现有 API Key 共用 Bearer 鉴权的原始 JSON API：`POST /v1/tools/search` 与
`POST /v1/tools/fetch`；Search 返回结构化结果，Fetch 返回 Markdown
（[Search & Fetch guide](https://api-docs.deepseek.com/zh-cn/guides/search)、
[Search reference](https://api-docs.deepseek.com/api/search/)、
[Fetch reference](https://api-docs.deepseek.com/api/fetch/)）。先复用现有 provider 配置即可形成
一条完整、可审计的搜索 → 抓取链路，无需先引入第二个搜索服务。

但「能调用 API」不是完整产品合同：

- 用户需要一个集中入口，知道 Web 是否开启、实际使用哪个 provider、哪些 origin 被长期允许，
  并能单独撤销或清空这些授权；不能只能手写配置。
- 搜索结果与网页正文会直接进入模型上下文，必须有统一的来源字段、硬预算与显式截断。
- Search / Fetch 是计费 API，也是数据外发通道；不能把 `vault_read` 的自动放行直接套过来。
- URL 可能指向本机、内网或经重定向 / DNS rebinding 转向这些目标；系统代理还可能绕过固定 IP。
- 超时、取消、响应过大、空正文与 HTTP 错误必须可区分；重试还要避免重复请求与重复计费。
- DeepSeek-compatible `base_url` 只声明 LLM 协议兼容性，不证明 `/v1/tools/*` 可用。

## What Changes

1. **新增默认关闭的「设置 → 自动化 → 网页访问」区（D2 待确认）。** 只有
   `harness.web_access.enabled=true` 时，交互主会话才注册 `web_search` / `web_fetch`；缺省 / false
   不注册、零网络请求。该区域显示实际 Web provider 与解析状态，并可跳回模型接入的对应条目，
   不复制 Key 或另建 provider 选择器。
2. **新增交互主会话的统一 Web 工具。** 两件工具共用结果信封与来源结构；Search 默认
   `need_content=false`，先返回可引用来源，再按需 Fetch。Tavily / Brave 不实现，也不新增搜索别名。
3. **集中管理持久 Fetch origins。** 网页访问区列出来自既有权限规则的 `web_fetch(origin)`，
   支持单独移除与全部清空，复用同一权限写通道，不另建 origin 数据库。默认 Ask 固定；
   Search 免问只存在会话内，不产生持久 Search allow。
4. **统一上下文预算与审计字段。** `count`、标题 / 摘要 / 正文 / 错误文本、API 响应字节数均有硬上限；
   顶层 `truncated` 与 `truncated_fields` 明示任何裁剪。来源保留 URL、标题、摘要、站点、日期、
   权威性与 provider；错误保留稳定内部 code、HTTP status、provider code、request id 与尝试次数。
5. **统一可空 provider 与字段形状。** `provider` / `provider_id` 只在解析成功时填实际值；
   未配置、配置歧义、自定义 base URL 与解析前的参数错误均为 null 且 `attempts=0`，不伪造 id。
   Fetch title 始终是 string，空标题固定 `""`；tools API 3xx 不跟随并统一为
   `web_provider_protocol_error`，4xx / 5xx 才归 `web_http_error`。
6. **新增独立的 `web_read` 权限类。** 它不是新工具名，也不并入 `vault_read` 的只读白名单。
   D1 推荐所有权限模式下默认 Ask；Search 的免问仅覆盖当前会话，Fetch 可按 origin 做会话 /
   持久授权。批准卡与工具结果展示完整 query / URL、provider id 与数据外发说明。
7. **只从现有 DeepSeek provider 条目解析凭据。** 仅官方 `https://api.deepseek.com` 可用于
   tools API；自定义 base URL 不探测、不假定支持，也不把该 Key 改投官方地址。无可用配置时返回
   `web_provider_unconfigured`，零网络请求，不静默回落 `curl`。API Key 只进 Authorization 头，
   不进日志、批准卡、会话、历史、工具结果或错误。
8. **建立目标 URL 与代理安全边界。** 只允许 HTTP / HTTPS，拒绝凭据与非全局单播目标；DNS 全地址校验并
   固定已验证地址，重定向逐跳重验。目标预检与 DeepSeek client 都显式 `no_proxy`，不得继承系统或
   手动代理；`no_proxy + 已验证地址集 + 原 Host / SNI + 手动 redirect` 是同一客户端构造不变量。
9. **保留跨 origin 重批准与远端边界。** 跨 origin 跳转不继承原批准，返回结构化新 URL 供重新调用。
   Lumir 能验证自己发出的预检请求，不能观察 DeepSeek 内部的 DNS 与重定向；source URL 只表示实际
   预检并提交的 URL，不伪造 final URL。
10. **固定可靠性与计费边界。** 仅 DeepSeek 返回 HTTP 408 / 429 / 5xx 时做最多两次有界退避重试；
    本地超时、取消、连接失败、200 后协议 / 大小 / 空正文错误均不自动重试。搜索空数组是成功的空结果；
    抓取空 Markdown 是 `web_empty_content`。官方口径为 Search / Fetch 各 5 元 / 1000 次成功请求，
    失败、空结果与超时不计费（[计费说明](https://api-docs.deepseek.com/zh-cn/guides/search)）。
11. **网页内容永远作为 untrusted data。** 工具描述、结果信封与系统提示共同声明网页文本不是系统指令；
    网页里的命令、批准话术或权限提示不得改变权限、生成 allow 规则或触发自动执行。
12. **复用现有工具历史与重试合同。** Web 工具错误是 `ToolOutput`，不伪装成 LLM 往返失败；
    后续 LLM 往返失败再显式重试时，已执行的 Web 工具不得重放，工具内部重试也不得重放整批工具。
13. **保留 `curl` 的特殊通道。** 非 HTML、特殊站点或 DeepSeek 无法提取的页面可由模型显式选择
    `cli_run("curl", …)`，仍按现有 CLI 分类与批准规则执行；它不是 Web 工具的自动降级路径。
14. **用独立测试 transport / provider 装配验证真实 HTTP。** 生产只走官方 endpoint；
    隔离验收把合成 DeepSeek endpoint 与「合成公网身份 → 本地监听」映射注入同一 Web 核心，
    不开生产自定义 endpoint 或 loopback / SSRF 例外。LLM mock 只驱动模型调用，不能替代真实
    Web HTTP 的 method / path / body / 状态序列 / 请求次数 / 读取字节数证据。

## 节点 1 裁决点（D1 / D2 均待确认）

| # | 事项 | 推荐默认值 | 不采纳的代价 |
|---|---|---|---|
| D1 | Web 默认批准与记忆粒度 | **所有权限模式下默认 Ask；Search 免问仅当前会话；Fetch 可按 origin 做会话 / 持久授权；跨 origin 重定向重新批准。** | 全部逐次问会在 search → 多页 fetch 时造成点击过载；持久 Search 会把不同 query 的长期外发一次授权到底；并入只读白名单则会在用户未见目标时外发并计费 |
| D2 | 用户集中配置入口 | **设置 → 自动化 → 网页访问；默认关闭才注册工具；provider 只读显示并跳回模型接入；持久 origin 单独移除 / 全部清空；默认 Ask 固定，Search 免问仅会话。** | 没有集中入口时，用户无法发现 Web 开关、实际 provider 或撤销长期 origin；把 Key / provider 复制到本区会形成第二配置真源 |

D1 / D2 之外的 fail-closed 项不另设产品开关：禁本机 / 内网、禁 URL 凭据、禁系统 / 手动代理、
禁生产自定义 tools endpoint、禁密钥进入任何记录、禁自动 curl 回落、禁 408 / 429 / 5xx 之外的自动重试。
它们是该联网能力成立的安全前提，不作为多个独立裁决点扩张评审面。

## Non-goals

- 本提交只创建 proposal / design / tasks / spec delta，**不实现产品、测试或验收场景**。
- 不实现 Tavily / Brave 适配器；Tavily Extract 仅保留为真实使用后的备选依据
  （[Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract)）。
- 不新增 `search` / `fetch` / `web` 等别名，不做兼容层、双写或第二套工具合同。
- 不新增 Web provider / Key / endpoint 配置节；`harness.web_access.enabled` 是唯一新增 Web 开关，
  不新增 API Key 环境变量、模型级搜索开关或生产自定义 tools base URL 支持。
- 不提供持久 `web_search` allow，不把 Search 的会话免问带进新会话或设置页。
- 不把 Web 工具授予 cron 或子运行；现有 9 件 vault 工具白名单与内建 `general` 不变。
- 不修改 LLM 的 408 / 425 / 429 / 5xx 显式重试分类；Web 工具自己的重试分类独立且不包含 425。
- 不实现浏览器渲染、JavaScript 执行、图片 / PDF / 下载器、网页存档、登录态或 Cookie 复用。
- 不做账单对账、成本补偿或自动换 provider；不保证 DeepSeek 远端抓取的内部 DNS / redirect 行为。
- 不为真机验收在生产构建保留自定义 endpoint、loopback 白名单、代理或跳过 DNS / URL 校验的开关。
- 不改 living specs、产品代码、测试、backlog；不进入归档。

## Impact

- **specs**：`harness` 修改「配置节 [harness]」「Skill 支持」「工具循环」「权限机制」
  「批准闸呈现与决策后收敛」「Skill 的混合调用与入口策略」，新增统一 Web 工具、批准、provider 与隐私、目标安全、可靠性、
  untrusted content 与真实 HTTP 验收装配合同；`harness-subagents` 修改「工具集声明与默认收紧」
  的旧事实但保持子运行闭集合；`settings` 修改「设置面板的形态与范围」并新增「网页访问设置」。
- **实现期代码面**：`harness.web_access.enabled` 与工具注册、权限与批准预览、现有 DeepSeek provider
  配置解析、有界 `no_proxy` HTTP 与 DNS / redirect 校验、工具结果留存、设置页 provider 跳转与
  既有权限规则管理；不新增 provider SDK 或第二份 origin 状态。
- **实现期验证面**：独立测试 transport / provider 的真实 mock HTTP、合成 DNS / connector、
  系统代理反例、三种 LLM client wire 与恢复 / 重试、权限与提示注入回归、既有验收场景闸期望全量
  回扫，以及隔离真机的本地合成 HTTP 验收。
- **关联约束**：不改源文件、配置即数据、密钥不明文外泄、显式截断、权限规则单一真源、
  会话 wire 留存与失败往返不重放工具。无原型，不预设新增视觉系统。

## 验证口径

- 提案阶段：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、
  `bash scripts/docs-check.sh`、指定 change 的 archive-check 与 `git diff --check` 通过；
  diff 只含本 change 的制品。
- 实现阶段：先以会失败的反例钉住安全与预算判据，再实现；不得用「mock 显式错误」代替真实 HTTP
  状态、字节流、重定向、DNS 或代理证据。完整矩阵见 `design.md` 与 `tasks.md`。
- 真机只用隔离测试装配与本地合成 DeepSeek / 目标 HTTP 服务；真实 DeepSeek 计费 API 不属于验收依赖。
  证据落主仓 `.local/`，不落 worktree；覆盖声明必须附场景名与 PASS 计数。

## 关联材料

- 详细合同、URL / 代理信任边界、测试装配、错误 / 重试表、测试矩阵：同目录 `design.md`。
- 实现任务与验收拆分：同目录 `tasks.md`。
- 规格增量：同目录 `specs/harness/spec.md`、`specs/harness-subagents/spec.md` 与
  `specs/settings/spec.md`。
