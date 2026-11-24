# Design: 统一 DeepSeek Web Search / Fetch

- Change ID: `add-harness-web-fetch-search-nov24`
- 日期: 2026-11-24
- 状态: 提案草稿；方向已由 Alex「采纳建议」采纳，D1 默认批准粒度待节点 1 确认；禁止提前实现

## 1. 结论与边界

本 change 在**交互主会话**增加 `web_search` 与 `web_fetch`，由同一套工具信封、来源结构、
安全校验与错误分类承载。DeepSeek 是第一个也是本期唯一 provider。后续 provider 只能实现同一合同，
不得新增工具别名或另一套结果形状。

请求分成两个平面，不能混谈：

1. **目标预检平面**：Lumir 对目标站做有界 HEAD；必要时用 Range GET 复核 Content-Type。
   这里执行 URL、DNS、重定向与内容类型校验，不下载完整正文，也不携带 DeepSeek Authorization、
   Cookie 或浏览器登录态。
2. **DeepSeek tools 平面**：Lumir 只向官方 `https://api.deepseek.com` 发 Search / Fetch API 请求。
   Search 返回结构化来源，Fetch 返回 Markdown。tools API 的 3xx 不跟随，避免 Bearer 被重定向带走。

DeepSeek Fetch 会在 provider 侧独立访问目标站。Lumir 无法观察其内部 DNS、连接 IP 或重定向链，
因此不能声称提供端到端 SSRF / DNS-rebinding 保证。本设计保证的是：Lumir 自身不连接非法目标，
且只把经过本地预检的最终同源 URL 发给官方 DeepSeek。provider 侧抓取是必须显式接受的信任边界；
若未来要求消除它，应改为直接抓取或取得 provider 的逐跳控制接口，另立 change，不在本提案假装解决。

`curl` 继续承担特殊站点、非 HTML、需要不同抓取策略的内容。它只在模型另行发起 `cli_run` 时使用，
仍走既有 CLI 分类与批准闸；Web 工具失败绝不自动改道 curl。

本期 Web 工具不进入 cron 或子运行白名单。内建 `general` 仍只有 9 件 vault 操作工具；
子代理需要特殊网页时仍只能显式使用 CLI。主会话新增 Web 工具后，旧 spec 中「主会话同样没有 web
工具」的事实陈述必须删除，而不是把子运行也顺带扩权。

## 2. 工具输入与统一输出

### 2.1 输入

`web_search`：

| 字段 | 合同 |
|---|---|
| `query` | 必填；trim 后 1–128 个 Unicode 字符；不全为空白。只把该 query 发给 DeepSeek，不附带 `ori_question` 或 `localization`，避免额外发送用户问题与 IP |
| `count` | 可选；默认 5，允许 1–10。超出本地预算直接 `web_args_invalid`，不静默 clamp；本地 10 的上限低于官方 50，是上下文预算而非 provider 方言 |
| `need_content` | 可选；默认 `false`。`false` 时先搜索再按需 fetch；`true` 也受单项与总预算限制 |

`web_fetch`：

| 字段 | 合同 |
|---|---|
| `url` | 必填；1–8192 字符；HTTP / HTTPS、有 host、无用户名或密码。先经批准与本地预检，再把最终同源 URL 发给 DeepSeek |

工具 schema 不暴露 `api_key`、provider、base URL、超时、重试次数、响应上限或任意 HTTP header。
这些均为实现常量或从现有配置解析，避免模型绕开预算与安全边界。

### 2.2 共用信封与来源形状

成功与失败都使用既有 `ToolOutput` 信封，并增加统一 Web 元数据：

```json
{
  "ok": true,
  "provider": "deepseek",
  "provider_id": "deepseek",
  "operation": "search",
  "attempts": 1,
  "trust": "untrusted",
  "truncated": false,
  "truncated_fields": []
}
```

Search 另带 `query` 与 `results: WebSource[]`。Fetch 另带 `source: WebSource`。
`WebSource` 字段固定如下；缺值用 `null`，不把「读不到」伪造成空字符串：

| 字段 | 类型 / 来源 |
|---|---|
| `url` | string。Search 保留 provider 结果 URL；Fetch 是本地预检后实际提交给 DeepSeek 的 URL，不伪造 final URL |
| `title` | string。provider 未给标题时为空串，与官方 Fetch 口径一致 |
| `snippet` / `summary` | string \| null。Search 映射官方字段；Fetch 为 null |
| `content` | string \| null。Search 仅在 `need_content=true` 时保留正文；Fetch 为 Markdown 正文 |
| `content_format` | `"markdown"` \| null。只有实际拿到 Markdown 正文时为 `"markdown"` |
| `site` | string \| null。Search 映射 `site_name`；Fetch 取 URL host |
| `date` | string \| null。Search 原样保留 RFC 3339 / UTC；Fetch 无此信息，填 null |
| `authority` | integer \| null。Search 保留 -1–4，包括 -1 = 未知；Fetch 无此信息，填 null |

不返回 `site_icon`，避免模型或 UI 再发起未审计的图片请求。Search 空数组是 `ok:true, results:[]`，
不是错误，也不自动重试。Fetch 空 Markdown 是 `web_empty_content`，不冒充有正文的成功。

失败信封统一为：

```json
{
  "ok": false,
  "provider": "deepseek",
  "provider_id": "deepseek",
  "operation": "fetch",
  "attempts": 1,
  "code": "web_http_error",
  "message": "DeepSeek Fetch 返回 HTTP 404；未自动重试",
  "http_status": 404,
  "provider_code": "not_found_error",
  "provider_message": "经脱敏且有界的 provider 文案",
  "request_id": "req_example",
  "trust": "untrusted",
  "truncated": false,
  "truncated_fields": []
}
```

`provider_code` / `provider_message` / `request_id` / `http_status` 只在真实存在时出现。
`code` 是 Lumir 的稳定分类，权限与测试只读它，不按 provider 文案猜测。`message` 由 Lumir 生成；
原始响应 body 不进入工具结果。`provider_message` 必须脱敏、限长，任何裁剪都加入
`truncated_fields`。`attempts` 只计实际 DeepSeek tools 请求次数，本地预检不计入。

### 2.3 上下文与响应预算

初值全部为代码常量，不新增配置项；后续调整须同批改 spec 与测试：

| 预算 | 上限 |
|---|---|
| Search title / snippet / summary | 每项分别 300 / 500 / 1,200 Unicode 字符 |
| Search content | 每项 4,000 Unicode 字符；全部 results 的文本合计 24,000 字符 |
| Fetch Markdown | 24,000 Unicode 字符 |
| Lumir `message` / `provider_message` | 各 1,000 Unicode 字符 |
| Search / Fetch API 成功或错误响应 | 分别 2 MiB / 4 MiB；超限即 `web_response_too_large`，不解析半截 JSON |

Search 聚合预算先裁 `content`，再裁 `summary`，最后裁 `snippet`；URL、date、authority、provider
不裁。结果条数若必须减少，只能在整条边界丢弃并加入 `results`，不得产生半个 JSON 对象。
任何字段或数组被裁都同时置 `truncated:true`，并在 `truncated_fields` 列出稳定路径，如
`results`、`results[].summary`、`results[].content`、`content`、`provider_message`。
未截断时该数组为 `[]`。MUST NOT 只在文本末尾加省略号而不置字段。

API 字节上限与模型字符预算是两道独立闸：前者防内存与协议资源消耗，后者防上下文膨胀。
200 已到达后再发现响应过大、JSON 非法或正文为空，均不自动重试，因为这次请求可能已被计费。

## 3. provider 配置解析与密钥边界

### 3.1 无新增配置的确定性解析

Web 工具仍在模型工具清单中注册；无配置时由执行返回 `web_provider_unconfigured`，而不是变成
另一套「工具不存在」语义。每回合使用既有 `HarnessConfig` 快照，按以下顺序解析：

1. 当前 active 条目是 `preset=deepseek`：只考察该条目。Key 非空且 base URL 为官方地址才可用；
   不可用即失败，MUST NOT 改用另一条 DeepSeek 配置。
2. 当前 active 条目不是 DeepSeek：遍历现有条目，若**恰好一条**满足「DeepSeek + 非空 Key +
   官方 base URL」，复用该完整条目；零条或多条均返回 `web_provider_unconfigured`。多条时不按
   字典序暗选账号，错误提示用户先把目标 DeepSeek 条目设为 active。
3. Key 与 base URL 必须同出一条目，MUST NOT 拼接不同条目的字段。Web tools 不需要模型清单，
   因此不复用要求 `models` 非空的 LLM `configured` 判据，也不发起 LLM preflight。

官方地址只认 `base_url=None`，或规范化后等于 `ProviderPreset::Deepseek.official_base_url()` 的
`https://api.deepseek.com`（允许末尾 `/`）。其余自定义 DeepSeek-compatible base URL 一律不探测、
不假定支持 tools，也 MUST NOT 拿同一 Key 改投官方地址。生产 mock provider 不提供 Web 配置；
测试注入走独立测试装配口，不成为生产配置或兼容层。

请求只包含官方文档字段：Search 为 `query` / `count` / `need_content`，Fetch 为 `url`。
端点固定为 `POST https://api.deepseek.com/v1/tools/search` 与
`POST https://api.deepseek.com/v1/tools/fetch`，与现有 LLM base URL 的 Responses 拼接不共用
（[Search & Fetch guide](https://api-docs.deepseek.com/zh-cn/guides/search)）。

### 3.2 密钥与隐私

- API Key 只从上述 provider 条目读取，只进入 `Authorization: Bearer …`。不新增环境变量，不写入
  URL、请求 JSON、工具参数摘要、批准卡、诊断日志、panel、JSONL、wire、错误或测试输出。
- 对 reqwest / provider / 目标站返回的错误文本统一做 secret redaction，再限长。恶意服务器回显
  Authorization、请求体或 Key 时，也只能留下 `[REDACTED]`。测试用唯一 canary 覆盖全部留存面。
- tools API 不跟随 3xx；目标预检请求不携带 DeepSeek Key、Cookie、 vault 内容或浏览器凭据。
- Search query 会发给 DeepSeek；Fetch URL 会发给 DeepSeek，并会由 Lumir 预检与 DeepSeek 抓取发往
  目标站。批准卡必须完整显示 query / URL、provider id 与这段外发说明。工具成功 / 失败结果也保留
  完整 query / URL，供自动放行后的审计；不能只靠 80 字工具行摘要满足可见性。
- `provider_id` 是会话已有的配置身份，可用于审计；API Key 本身永远不是审计字段。

无配置、配置歧义、自定义 base URL、参数 / URL / DNS 校验失败时，DeepSeek 请求数必须为 0，
也不得产生 curl 子进程。

## 4. `web_read` 权限与批准粒度

`web_read` 是权限分类，不是第三件工具，也不是新的权限模式。`web_search` / `web_fetch` 不加入
`READ_TOOLS`，因此在 D1 推荐值下，`read_only` / `vault_write` / `full_access` 的模式默认均为 Ask。
`full_access` 不代表「可以向任意外网静默发数据并产生费用」。

既有五层判定顺序不变：deny > vault 写重定向 > 危险黑名单 > allow > 模式默认 / 会话缓存。
URL / DNS 校验在执行层，不成为用户 allow 或缓存可以跳过的第六层；每次执行与每次重定向都重验。

| 调用 | permission subject | 批准预览 | 会话记忆 / 持久 allow 粒度 |
|---|---|---|---|
| `web_search` | 完整 query | 完整 query、DeepSeek、query 外发与计费说明 | 工具级：覆盖本会话后续不同 query；持久规则为 `web_search` |
| `web_fetch` | 规范化 origin（scheme + host + 有效 port） | 完整 URL、origin、DeepSeek 与目标站外发说明 | origin 级：规则形如 `web_fetch(https://example.com)`；不覆盖其它 origin |

Fetch 的批准卡显示完整 URL，但规则只按 origin 授权，避免把 query / path 误当稳定身份。
origin 规范化必须小写 scheme / host、省略默认 port、保留非默认 port，不含 userinfo、path、query 或
fragment。Search 的「本会话不再问」必须在按钮上明确写成「本会话的后续网页搜索」，Fetch 必须显示
具体 origin，不能只写「同类操作」。

跨 origin 重定向不继承原 origin 的批准。预检发现跨 origin Location 时，在语法与凭据校验后返回
`web_redirect_requires_approval` 和完整 `redirect_url`，不 DNS、不连接新 origin、不调用 DeepSeek。
模型如继续，应以该 URL 新发一次 `web_fetch`，由新 origin 的批准闸处理。`redirect_url` 本身仍是
untrusted data，不是自动执行指令。

基础参数形状与 URL scheme / userinfo 校验 SHALL 在批准预览之前完成，非法调用不得先产生一张
携带凭据或无效目标的批准卡。完整 DNS / redirect / 内容类型校验仍在每次执行时进行。
既有 deny 永远优先；显式 allow / 会话缓存只能减少批准点击，不能跳过 SSRF、内容类型、预算或密钥检查。
权限语义变更实现时，必须全量回扫既有验收场景的闸期望，而不只新增 Web 场景。

## 5. URL、重定向与 DNS 安全

### 5.1 输入与 DNS

每次 Fetch 及每次同源重定向都执行完整校验：

1. URL 长度 1–8192；只准 HTTP / HTTPS；host 必填；userinfo 为空。拒绝其它 scheme、
   `file:`、`data:`、反斜杠混淆、控制字符与解析失败，不尝试「修复」成另一个 URL。
2. IP 字面量与 DNS 的全部 A / AAAA 结果都必须是全局可路由单播。任一结果为 loopback、private、
   link-local、unspecified、multicast、reserved、documentation、CGNAT、IPv4-mapped / 兼容映射的
   非全局地址，整条拒绝；不得只挑一个公网地址放行。`localhost`、`.local` 与解析失败 fail closed。
3. 对 host 的所有候选地址做有界连接时，只允许连接到已验证 IP，并保留原 host 的 Host 与 TLS SNI；
   禁止连接前再次由系统 resolver 自由选择地址。任一 DNS 答案在后续跳变时，下一跳重新执行全集校验。
4. 校验与连接共用同一个「已验证地址集」，防止 check-then-connect 之间再次发生系统 DNS 解析。
   不在错误中回显完整 DNS 答案或内部网络拓扑，只给稳定 code 与被拒绝的 host。

### 5.2 有界预检

- 每个 hop 先发 HEAD；无法判定时用 `Range: bytes=0-4095` GET，只读取响应头与最多 4 KiB，
  随即关闭，不把预检正文交给模型。目标只支持 GET 而忽略 Range 时，读取硬上限仍生效。
- 单 hop 10 秒、整条预检 30 秒，最多 5 次重定向；超时 / 超限均失败且不调用 DeepSeek。
  预检不自动重试，避免重复访问目标站。
- 只接受 `text/html` 与 `application/xhtml+xml`（可带参数）。明确非 HTML 返回
  `web_unsupported_content`；Content-Type 缺失或冲突且 Range GET 仍无法判定返回
  `web_content_type_unknown`。两者都提示可另行选择 curl，但不自动执行。
- 相对 Location 按当前 URL 解析；每跳重新做 scheme / userinfo / host 校验。同源（scheme + host +
  有效 port 相同）才继续 DNS 与连接；跨源走 §4 的重新批准结果。超过 5 次为 `web_redirect_limit`。
- 预检通过后才调用 DeepSeek Fetch，发送最后一个已验证的同源 URL。预检的 HEAD / Range GET 与
  DeepSeek 的抓取可能产生两次目标访问，这是获得本地安全校验的代价，须在评审与验收中显式承认。

Search 不主动访问结果 URL；结果里的恶意 / 内网 URL 只作为 untrusted 元数据返回，只有模型随后
Fetch 时才进入上述校验。

### 5.3 不能承诺的部分

DeepSeek API 没返回远端 final URL、连接 IP 或 redirect chain，因此 Lumir 不能验证 provider 侧是否
发生 rebinding，也不能证明返回正文与预检时的页面逐字节相同。`source.url` 只证明「这个 URL 通过
本地预检并被提交」，不证明「DeepSeek 实际最终落地 URL」。不得把 post hoc 的内容标题或目标错误
当成 SSRF 防线。官方 DeepSeek 是本期受托抓取方；自定义抓取代理不在信任范围内。

## 6. 可靠性、取消与计费重试

### 6.1 超时与取消

- DeepSeek 每次 attempt：连接 5 秒；Search attempt 总超时 30 秒，Fetch 45 秒；含退避的整次工具调用
  分别不超过 100 / 150 秒。响应头与 body 读取都计入 attempt  deadline。
- 取消复用 `ctx.aborted()` 的同一事实源，在发起前、退避前、响应等待与 body 分块读取时检查；
  100ms 级轮询，不持会话锁。取消后关闭响应、不再发新 attempt，返回 `web_cancelled`。
- 阻塞 DNS / connect 由独立有界工作单元承载；停止时不 join 一个可能仍阻塞的线程。已在 OS /
  provider 处理的请求无法撤销，取消只保证 Lumir 不再等待、不再重试，不承诺撤销潜在费用。
- 取消优先于成功 / 错误收尾；已接收的部分 JSON 不解析、不当作成功结果。目标预检同样可取消。

### 6.2 自动重试真值表

仅下表第一类允许自动重试，且只针对 DeepSeek tools API；本地预检永不自动重试：

| 结果 | 自动重试 | 最终 code / 说明 |
|---|---|---|
| HTTP 408 / 429 / 500–599 | 是，最多初次 + 2 次重试 | 耗尽后 `web_http_error`；保留 status 与 attempts=3 |
| 其它 4xx（含 400 / 401 / 402 / 403 / 404 / 413 / 425） | 否 | `web_http_error`；402 不自动充值、不换 Key；404 不猜具体目标原因 |
| 本地 DNS / connect / TLS / timeout | 否 | `web_network_failed` / `web_timeout`；请求是否到达不确定，不重放 |
| 用户取消 | 否 | `web_cancelled` |
| 200 后响应过大、Content-Type 非 JSON、JSON 非法 / 形状不符 | 否 | `web_response_too_large` / `web_provider_protocol_error` |
| Search 200 空数组 | 否 | 成功空结果，不视为错误 |
| Fetch 200 空 Markdown | 否 | `web_empty_content`；官方不计费，但仍不自动重试 |
| 目标预检任何失败 / 重定向需批准 | 否 | 对应 `web_*` code；DeepSeek attempts=0 |

退避优先尊重有界 `Retry-After`（上限 2 秒）；缺失时使用 250ms、1s 的指数序列。测试注入时钟，
不做分钟级实睡。429 的账号 / 域名限额不因重试而绕过，超过上限即把错误回送模型。

Search / Fetch 官方均为每 1000 次成功请求 5 元，只有 HTTP 200 且产生结果才计费；失败、空结果、
超时不计费（[官方计费与重试说明](https://api-docs.deepseek.com/zh-cn/guides/search)）。
本设计仍按「200 可能已计费」保守处理，绝不因本地解析失败而自动重发。Lumir 不做账单推断或补偿。

### 6.3 与既有 LLM 重试 / 留存的关系

Web 工具错误是 `ToolOutput{ok:false}`，回送模型决定是否改参数或放弃；它不是 `TurnError`，不设置
`Session.failed`，不新增错误行重试按钮。LLM 的 `FailureKind` 与 408 / **425** / 429 / 5xx 分类不变，
Web 不重用它，也不把 425 加入 Web 集合。

每次工具完成仍经 `finish_call` 生成同一 function call / output 项与 panel 记录。provider 已实际请求后
失败时，错误信封（含 attempts / status / provider / request id）同样留在这条工具结果中；下一次
LLM 请求的 wire 历史会携带它。若该后续 LLM 往返失败，显式重试复用原 input，不重放已执行 Web 工具。
若停止发生在工具执行中，已完成的调用照常留存，未完成的调用不伪造成功输出。

不新增第二份 `llm_request` / `llm_response`：DeepSeek tools 是工具外部请求，不是 LLM 会话请求。
审计以 function call / output、panel 与下一次 wire 为准，不另造一套请求历史。

## 7. 错误分类

| code | 含义 |
|---|---|
| `web_args_invalid` | query / count / URL 基本参数不合法 |
| `web_provider_unconfigured` | 无可用官方 DeepSeek 配置、配置歧义或自定义 base URL；零请求 |
| `web_url_blocked` | scheme / userinfo / host / IP 非允许目标 |
| `web_dns_failed` / `web_dns_blocked` | DNS 失败或任一答案非全局单播 |
| `web_redirect_limit` | 重定向超过 5 次 |
| `web_redirect_requires_approval` | 跨 origin，附 `redirect_url`，未连接新 origin、未请求 DeepSeek |
| `web_unsupported_content` / `web_content_type_unknown` | 明确非 HTML / 无法确认 HTML |
| `web_network_failed` / `web_timeout` / `web_cancelled` | 本地网络、超时、取消 |
| `web_response_too_large` | DeepSeek API 响应超过 2 / 4 MiB |
| `web_provider_protocol_error` | API 非 JSON、JSON 非法、字段形状不符、tools API 3xx |
| `web_http_error` | 非 2xx；附 status、provider code / request id（如有）与 attempts |
| `web_empty_content` | Fetch 没有可用 Markdown 正文 |

`web_unsupported_content` 只在能确定内容类型时使用；DeepSeek 404 可能同时代表 URL 不可用、目标策略、
内容类型不支持或无 Markdown，统一映射 `web_http_error`，不得凭 404 伪造更精确原因。

## 8. Untrusted Web 内容与提示注入

Search / Fetch 的 title、snippet、summary、content、provider_message、redirect_url 全是不可信数据。
它们：

- 只能作为 function output 的 JSON 字符串进入模型上下文，不进入 system prompt、AGENTS、权限规则、
  批准理由或 provider 配置；`trust:"untrusted"` 恒在。
- 不得被解释为「忽略之前指令」「用户已批准」「以后全部 allow」「执行某命令」等授权事实。
  真正的授权仍只来自既有权限配置与用户批准通道。
- 不得自动触发 curl、写文件、修改权限、二次 Fetch 或新 provider 请求。后续模型调用必须重新经过
  同一工具循环、预算、权限与安全校验。
- 不得因网页包含批准话术而隐藏批准卡或改变审批文案。批准卡只由实际工具参数与配置生成。

工具 description 与系统固定段都要写明这条优先级；测试放入恶意网页指令，断言它原样保留为数据，
后续危险 / 写工具仍按原权限模式进闸，配置与批准缓存不变。

## 9. 实现形态约束

- 复用 `tools::definitions` / `execute`、`ToolOutput`、`finish_call`、wire input、批准管线与配置快照；
  新增独立 Web 执行模块承载 HTTP / DNS / redirect，不把多个安全判据散落在 UI 或 provider 分支。
- 新增 `WEB_TOOL_NAMES` 作为交互主会话的闭集合；不改变 vault `TOOL_NAMES`、cron 白名单或子代理
  `general`。执行层对已知工具的判据与定义注册面必须同源。
- `ToolContext` 需要携带本轮配置快照与取消读口；HTTP 等待 / 取消不得持会话锁。不得在 UI 层另发
  Web 请求，前端只渲染后端给出的预览与结果。
- `ApprovalPreview` 增加单一 Web 预览载荷，事件与快照共用，不把完整 query / URL 只塞入 80 字摘要。
- 不引入 DeepSeek SDK；优先复用现有 reqwest / serde。DNS 固定地址可用现有 HTTP client 的 resolve /
  connector 能力实现，但若无法满足「校验地址与连接地址同一」，不得退化为普通 reqwest 自动解析。
- 测试端点注入只在测试装配口存在，不能变成生产自定义 base URL 的隐性支持。

## 10. 验证矩阵

### 10.1 DeepSeek mock HTTP 与输出预算

- 断言 POST path、Bearer、JSON 字段；Search 缺省 `count=5, need_content=false`，无 `ori_question` /
  `localization`；Fetch 只带预检后的 url。全程不打真实计费 API。
- Search 结构化映射：URL / title / snippet / summary / content / site / date / authority / provider；
  空 results 成功；need_content=false 后必须第二次 Fetch 才出现 Markdown。
- 逐字段、聚合与错误文本截断；`truncated_fields` 精确且不漏报。2 / 4 MiB 超限、非 JSON、坏 JSON、
  缺字段、非 JSON Content-Type、空 Fetch 正文都有独立反例。
- 每个被声称覆盖的反例先证明旧实现 / 错误实现会 FAIL，不接受只检查子串或空数组的假绿。

### 10.2 权限、隐私与 fail closed

- 三档模式 × search / fetch 默认均 Ask；deny > allow > cache；Search 工具级记忆、Fetch origin 记忆；
  不同 origin 与跨源 redirect 重新问；`curl` 原矩阵不变。
- active DeepSeek 官方、active 非 DeepSeek + 唯一候选、多个候选、无 Key、active 自定义 base URL、
  非 active 自定义 base URL；无配置 / 歧义 / 自定义时零 HTTP、零 curl。
- canary Key 出现在恶意 provider body / 目标 body / 错误 URL 中，扫描日志、panel、JSONL、wire、
  错误事件与测试输出均无 canary；批准卡仍完整显示 query / URL 与数据外发说明。

### 10.3 SSRF / redirect / DNS

- 非 HTTP(S)、userinfo、IP 变体、IPv6 / mapped、loopback、private、link-local、CGNAT、multicast、
  reserved、documentation、localhost / `.local`、DNS 失败、公私混合答案均拒绝。
- 模拟 DNS 第一次公网、第二次私网；断言连接只使用已验证 IP，Host / SNI 不变，不在连接前重解析。
- 同源 redirect 逐跳重验；跨源在连接新源之前返回 `web_redirect_requires_approval`；超过 5 次、
  相对 Location、scheme downgrade、带凭据 Location 都有反例；tools API 3xx 不跟随且不泄漏 Bearer。
- HTML / 非 HTML / 未知 Content-Type、HEAD 失败后的有界 Range GET、忽略 Range 仍只读 4 KiB。

### 10.4 超时、取消与计费边界

- 408 / 429 / 500 / 503 按序列最终成功或三次耗尽；Retry-After 与默认退避有界；400 / 401 / 402 /
  403 / 404 / 413 / 425 均只请求一次。
- DNS / connect / TLS / 本地 timeout、取消、200 后过大 / 坏 JSON / 空正文均不自动重试；attempts 精确。
- 等待头、读 body、退避三个阶段取消；取消后无新请求、无半截成功，且没有持锁死锁。

### 10.5 三 client wire、历史恢复与重试

- Responses、Chat Completions、mock 三种 LLM client 都能把 Search / Fetch function output 原样带入
  下一请求；多调用仍保持全部 call 项在全部 output 项之前。
- 仅凭 JSONL 恢复后，query / URL、来源字段、错误与 truncated 标记不丢；恢复充分性测试不依赖 sidecar。
- Web 成功或实际请求后失败 → 后续 LLM 失败 → 显式重试：messages 与失败请求相同，Web HTTP 次数不增，
  工具结果不重复；重试成功后的新 Web 调用仍重新批准 / 校验。
- Web 工具内部 attempt 重试只重发当前 HTTP 请求，不重放同批其它工具。

### 10.6 search → fetch、untrusted content 与真机

- mock Search 返回来源 → 模型 Fetch 该来源 → 最终回答可引用同一 URL / title / date / authority；
  默认 Search 响应无正文，证明第二跳真实发生。
- 页面含「忽略指令 / 自动批准 / 执行 curl / 修改权限」时仅作为字符串保留；权限配置与缓存不变，
  后续写 / 危险调用仍进闸。
- 真机用本地合成 DeepSeek 与目标 HTTP 服务覆盖上述关键链路、redirect / DNS、超时取消与恢复；
  不依赖公网。测试端点只经测试装配注入，不能借生产自定义 base URL 放行。
- 全量回扫既有验收场景的权限 / 批准期望；新增场景与 `COVERAGE.md` 随实现同 PR。
  动批准卡视觉面时跑结构断言与本地 `gate.sh visual`，基线更新仍须 Alex 过目。

## 11. 评审重点

1. D1 是否在「默认所有档先问」与「搜索工具级 / 抓取 origin 级记忆」之间取得合适的隐私与点击成本。
2. 本地预检会产生额外 HEAD / Range GET；它换来可验证的 redirect / DNS 安全，但也让目标站看到
   Lumir 与 DeepSeek 两路访问。是否接受这一明确代价。
3. DeepSeek 远端抓取的 DNS / redirect 不可观察；本设计只承诺本地防线与官方 provider 信任边界，
   不承诺端到端 rebinding 防护。
4. 多 DeepSeek 条目时不暗选，active 自定义 base URL 时不改投官方；这是有意的 fail-closed 可用性取舍。
5. 仅 408 / 429 / 5xx 自动重试；本地 timeout 与 200 后本地解析失败不重试，优先避免重复计费。
6. Web 仅交互主会话，cron / 子运行不扩权；`curl` 保留现有批准语义，不能成为静默旁路。
