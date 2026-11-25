# Proposal: 为 harness 增加统一的 DeepSeek 网页搜索与抓取工具

- Change ID: `add-harness-web-fetch-search-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（方向准入、节点 1 裁决），AI agent（起草）

> **评审记录（先读）**
> 方向已采纳：Alex 原话「采纳建议」。统一 `web_fetch` / `web_search` 合同；先接 DeepSeek，
> 真实使用后再决定 Tavily；Brave 只在明确索引 / 控制需求后接入；`curl` 保留处理特殊站点与非 HTML。
>
> r1 独立评审对 `9ccad844` 判 `needs-changes`：系统代理可绕过固定 IP、统一输出存在三处矛盾、
> living 回扫不完整、真机注入链未闭合。上述技术修订已全部保留。
> r2 对 `8d1821c8` 仍判 `needs-changes`：显式非法 `web_access` 会 fail-open，设置写通道未覆盖 Web /
> deny，Ask 依据会误归权限模式，跨 origin 仍有旧表述。本稿继续修正这些技术缺口，不重裁已批准方向。
>
> 节点 1（提案评审）：**D1 / D2 均已批准**（2026-11-24）。Alex 对默认批准策略明确回复
> 「默认允许所有」，对「设置 → 自动化 → 网页访问」入口回复「好」。最新决定明确：
> Web 默认启用并允许 Search / Fetch，设置页可全局关闭或改回 Ask，origin 采用 deny 例外。
> 本稿没有默认批准策略待裁项；等待 r2 技术复审，不提前实现。

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

「默认允许所有」解决逐次点击成本，但不减少用户可撤销性与技术防线：

- 用户需要集中入口，能全局关闭 Web、改回 Ask、封禁或恢复特定 origin，并看到实际 provider。
- 搜索结果与网页正文会直接进入模型上下文，必须有统一来源字段、硬预算与显式截断。
- Search / Fetch 是计费 API，也是数据外发通道；即使不逐次批准，也必须保留 query / URL、provider、
  费用与 untrusted 审计。
- URL 可能指向本机、内网或经重定向 / DNS rebinding 转向这些目标；系统代理还可能绕过固定 IP。
- 超时、取消、响应过大、空正文与 HTTP 错误必须可区分；重试还要避免重复请求与重复计费。
- DeepSeek-compatible `base_url` 只声明 LLM 协议兼容性，不证明 `/v1/tools/*` 可用。

## What Changes

1. **D1：默认启用并允许 Web Search / Fetch。** `harness.web_access.enabled` 缺省为 `true`，
   `harness.web_access.approval` 缺省为 `allow_all`；两件工具在交互主会话默认注册并直接执行，
   不再逐次 Ask，也没有会话范围限制。用户可在网页访问区全局关闭或改为 `ask`。
2. **D2：批准「设置 → 自动化 → 网页访问」入口。** 该区域显示实际 Web provider 与解析状态，
   可跳回模型接入的对应条目，不复制 Key 或另建 provider 选择器；同时显示费用、数据外发与
   untrusted 提示。只有键缺失使用批准默认值；显式非法 `web_access` 表 / 字段产生
   `web_access_config_invalid`，按 `enabled=false` 与保守 `ask` 处理，不注册、零请求，且不清空
   provider、origin deny 或其它配置。
3. **origin 使用 deny 例外，写通道同锁闭合。** 网页访问区列出既有 `harness.permissions.deny`
   中的 `web_fetch(origin)`，默认空。`settings_apply` 的 snapshot / patch / revision 同时覆盖
   `enabled` / `approval` 与 origin deny；patch 支持 add / remove / clear origins，在同一写锁内
   校验 revision、精确改 deny、重载校验并原子写。清空只清规范 Fetch origin，不改 allow、其它 deny
   或非规范规则；冲突返回 `settings_revision_conflict`，文件逐字节不变。
4. **批准卡退出默认路径，但审计不退出，Ask 依据独立。** 只有用户显式选择 `ask` 时才进入批准闸；
   判定依据使用独立的 `WebAccessPolicy`，明确实际 `approval=ask`，不套用 `ModeDefault` 或
   `full_access` 档释义。工具行、结果、panel / JSONL / wire 始终保留完整 query / URL、provider id、
   attempts、费用相关错误与 `trust:"untrusted"`。
5. **跨 origin 不另开批准。** 每一跳仍须通过 scheme / 凭据 / DNS / IP / `no_proxy` /
   内容类型校验，origin deny 也必须重新判定；全部通过后把最后一跳 URL 提交 DeepSeek。
   `source.url` 是最后一个通过全部校验的 URL（允许跨 origin），不保留已退场的重定向输出字段。
6. **统一上下文预算与审计字段。** `count`、标题 / 摘要 / 正文 / 错误文本、API 响应字节数均有硬上限；
   顶层 `truncated` 与 `truncated_fields` 明示任何裁剪。来源保留 URL、标题、摘要、站点、日期、
   权威性与 provider；错误保留稳定内部 code、HTTP status、provider code、request id 与尝试次数。
7. **统一可空 provider 与字段形状。** `provider` / `provider_id` 只在解析成功时填实际值；
   未配置、配置歧义、自定义 base URL 与解析前参数错误均为 null 且 `attempts=0`。Fetch title 始终是
   string，空标题固定 `""`；tools API 3xx 不跟随并统一为 `web_provider_protocol_error`，
   4xx / 5xx 才归 `web_http_error`。
8. **只从现有 DeepSeek provider 条目解析凭据。** 仅官方 `https://api.deepseek.com` 可用于
   tools API；自定义 base URL 不探测、不假定支持，也不把该 Key 改投官方地址。无合格配置时返回
   `web_provider_unconfigured`，零网络请求，不静默回落 `curl`。API Key 只进 Authorization 头，
   不进日志、会话、历史、工具结果或错误。
9. **建立目标 URL 与代理安全边界。** 只允许 HTTP / HTTPS，拒绝凭据与非全局单播目标；DNS 全地址校验并
   固定已验证地址，重定向逐跳重验。目标预检与 DeepSeek client 都显式 `no_proxy`，不得继承系统或
   手动代理；`no_proxy + 已验证地址集 + 原 Host / SNI + 手动 redirect` 是同一构造不变量。
10. **保留 DeepSeek 远端边界。** Lumir 能验证自己发出的预检请求，不能观察 DeepSeek 内部的 DNS 与
    重定向；source URL 只表示实际预检并提交的 URL，不伪造 final URL。默认 Allow 不改变这一事实。
11. **固定可靠性与计费边界。** 仅 DeepSeek 返回 HTTP 408 / 429 / 5xx 时做最多两次有界退避重试；
    本地超时、取消、连接失败、200 后协议 / 大小 / 空正文错误均不自动重试。搜索空数组是成功的空结果；
    抓取空 Markdown 是 `web_empty_content`。官方口径为 Search / Fetch 各 5 元 / 1000 次成功请求，
    失败、空结果与超时不计费（[计费说明](https://api-docs.deepseek.com/zh-cn/guides/search)）。
12. **网页内容永远作为 untrusted data。** 网页里的命令、批准话术或权限提示不得改变权限、生成规则或
    触发自动执行；默认 Allow 是用户已批准的执行策略，不是网页可修改的授权事实。
13. **复用现有工具历史与重试合同。** Web 工具错误是 `ToolOutput`，不伪装成 LLM 往返失败；
    后续 LLM 往返失败再显式重试时，已执行的 Web 工具不得重放，工具内部重试也不得重放整批工具。
14. **保留 `curl` 的特殊通道。** 非 HTML、特殊站点或 DeepSeek 无法提取的页面可由模型显式选择
    `cli_run("curl", …)`，仍按现有 CLI 分类与权限规则执行；它不是 Web 工具的自动降级路径。
15. **用独立测试 transport / provider 装配验证真实 HTTP。** 生产只走官方 endpoint；
    隔离验收把合成 DeepSeek endpoint 与「合成公网身份 → 本地监听」映射注入同一 Web 核心，
    不开生产自定义 endpoint 或 loopback / SSRF 例外。LLM mock 只驱动模型调用，不能替代真实
    Web HTTP 的 method / path / body / 状态序列 / 请求次数 / 读取字节数证据。

## 节点 1 已批准口径

| # | Alex 原话 | 已批准施工口径 |
|---|---|---|
| D1 | 「默认允许所有」 | 默认 `enabled=true, approval=allow_all`；Search / Fetch 不再逐次 Ask，跨 origin 在完整硬校验后可继续，不另开批准；审计与硬边界不变 |
| D2 | 「好」（针对「设置 → 自动化 → 网页访问」） | 默认启用；可全局关闭、改回 Ask、封禁或恢复 origin；origin 管理为 deny 例外（默认空），单项移除 / 全部清空复用现有权限规则与 revision |

D1 / D2 已批准，不再列默认批准策略裁决点。以下 fail-closed 硬边界不属于 allow_all 的放宽面：
禁系统 / 手动代理、禁私网 / 本机与 URL 凭据、禁生产自定义 tools endpoint、无合格 DeepSeek 配置即失败、
禁密钥进入任何记录、上下文预算、untrusted content、以及 408 / 429 / 5xx 之外的自动重试禁止。

## Non-goals

- **历史范围（仅指最初提案提交）**：当时只创建 proposal / design / tasks / spec delta，不实现产品、测试或验收场景；该范围限制不描述后续已批准实现提交。阶段1已实现合同、provider 解析、注册与 settings 后端，阶段2已实现权限管线、Ask 预览与设置 UI，阶段3已实现 URL / DNS、固定地址 transport、手动 redirect、预检与取消，阶段4已实现真实 DeepSeek provider / executor、deadline、重试、预算、默认无卡审计与 wire / 恢复；全量场景回扫与真机验收归阶段5。
- 不实现 Tavily / Brave 适配器；Tavily Extract 仅保留为真实使用后的备选依据
  （[Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract)）。
- 不新增 `search` / `fetch` / `web` 等别名，不做兼容层、双写或第二套工具合同。
- 不新增 Web provider / Key / endpoint 配置节；`web_access` 只含启用与批准策略，
  不新增 API Key 环境变量或生产自定义 tools base URL 支持。
- 不把默认 Allow 扩展到 cron、子运行、curl 或其它 vault / CLI 工具；现有 9 件 vault 工具白名单、
  内建 `general` 与它们的权限模式不变。
- 不修改 LLM 的 408 / 425 / 429 / 5xx 显式重试分类；Web 工具自己的重试分类独立且不包含 425。
- 不实现浏览器渲染、JavaScript 执行、图片 / PDF / 下载器、网页存档、登录态或 Cookie 复用。
- 不做账单对账、成本补偿或自动换 provider；不保证 DeepSeek 远端抓取的内部 DNS / redirect 行为。
- 不为真机验收在生产构建保留自定义 endpoint、loopback 白名单、代理或跳过 DNS / URL 校验的开关。
- **历史范围（仅指最初提案提交）**：当时不改 living specs、产品代码、测试、backlog；实现期按已批准 delta 与 tasks 修改对应制品。本 change 尚未归档，当前阶段分支不能 merge 或 dogfood。

## Impact

- **specs**：`harness` 修改「配置节 [harness]」「Skill 支持」「工具循环」「权限机制」
  「批准闸呈现与决策后收敛」「Skill 的混合调用、入口策略与候选交互」，新增统一 Web 工具、访问策略、
  provider 与隐私、目标安全、可靠性、untrusted content 与真实 HTTP 验收装配合同；
  `harness-subagents` 保持子运行闭集合；`settings` 修改「设置面板的形态与范围」「设置写通道」
  并新增「网页访问设置」。
- **实现期代码面**：`harness.web_access.enabled` / `.approval` 与工具注册、现有 deny 规则、
  按需批准预览、现有 DeepSeek provider 配置解析、有界 `no_proxy` HTTP 与 DNS / redirect 校验、
  工具结果留存、设置页 provider 跳转与 deny origin 管理；不新增 provider SDK 或第二份 origin 状态。
- **实现期验证面**：独立测试 transport / provider 的真实 mock HTTP、合成 DNS / connector、
  系统代理反例、allow_all / ask / deny 矩阵、三种 LLM client wire 与恢复 / 重试、权限与提示注入回归、
  既有验收场景闸期望全量回扫，以及隔离真机的本地合成 HTTP 验收。
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
