# Design: 统一 DeepSeek Web Search / Fetch

- Change ID: `add-harness-web-fetch-search-nov24`
- 日期: 2026-11-24
- 状态: D1「默认允许所有」与 D2「设置 → 自动化 → 网页访问」均已获 Alex 批准；初始提案期已结束。阶段1的合同、provider 解析、注册与 settings 后端，阶段2的权限管线、Ask 预览与设置 UI，以及阶段3的 URL / DNS、固定地址 transport、手动 redirect、预检与取消均已完成。真实 DeepSeek executor 尚未实现；本分支是本地中间态，不能 merge 或 dogfood

## 1. 结论与边界

本 change 在「设置 → 自动化 → 网页访问」提供总开关与批准策略：`harness.web_access.enabled`
缺省为 `true`，`harness.web_access.approval` 缺省为 `allow_all`，因此两件工具默认在**交互主会话**
注册并直接执行。用户可全局关闭或改为 `ask`。两件工具由同一套工具信封、来源结构、安全校验与
错误分类承载。DeepSeek 是第一个也是本期唯一 provider。后续 provider 只能实现同一合同，
不得新增工具别名或另一套结果形状。

请求分成两个平面，不能混谈：

1. **目标预检平面**：Lumir 对目标站做有界 HEAD；必要时用 Range GET 复核 Content-Type。
   这里执行 URL、DNS、重定向与内容类型校验，不下载完整正文，也不携带 DeepSeek Authorization、
   Cookie 或浏览器登录态。client 必须显式 `no_proxy`，禁止系统 / 手动代理代连或代解析目标。
2. **DeepSeek tools 平面**：Lumir 只向官方 `https://api.deepseek.com` 发 Search / Fetch API 请求。
   Search 返回结构化来源，Fetch 返回 Markdown。该 client 同样显式 `no_proxy`；tools API 的 3xx
   不跟随并统一归 `web_provider_protocol_error`，避免代理或重定向带走 Bearer。

DeepSeek Fetch 会在 provider 侧独立访问目标站。Lumir 无法观察其内部 DNS、连接 IP 或重定向链，
因此不能声称提供端到端 SSRF / DNS-rebinding 保证。本设计保证的是：Lumir 自身不连接非法目标，
且只把最后一个通过全部预检的 URL（允许跨 origin）发给官方 DeepSeek。provider 侧抓取是必须显式接受的信任边界；
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
| `url` | 必填；1–8192 字符；HTTP / HTTPS、有 host、无用户名或密码。先按当前 `web_access.approval` 处理，再经本地预检，把最后一个通过全部校验的 URL（允许跨 origin）发给 DeepSeek |

工具 schema 不暴露 `api_key`、provider、base URL、超时、重试次数、响应上限或任意 HTTP header。
这些均为实现常量或从现有配置解析，避免模型绕开预算与安全边界。

### 2.2 共用信封与来源形状

成功与失败都使用既有 `ToolOutput` 信封，并增加统一 Web 元数据。`provider` 与 `provider_id`
均为 `string | null`：只有 provider 解析成功才填 `"deepseek"` 与实际配置映射键；未配置、配置歧义、
自定义 base URL，以及解析前的参数 / 权限 / URL 拒绝都填 null，且 `attempts=0`。不得把
`"deepseek"` 伪造成 provider id，也不得在多候选时任选一个。

```json
{
  "ok": true,
  "provider": "deepseek",
  "provider_id": "deepseek-work",
  "operation": "search",
  "attempts": 1,
  "trust": "untrusted",
  "truncated": false,
  "truncated_fields": []
}
```

Search 另带 `query` 与 `results: WebSource[]`。Fetch 另带 `source: WebSource`。
`WebSource` 字段固定如下；除 title 外，可空字段缺值用 `null`，不把「读不到」伪造成空字符串：

| 字段 | 类型 / 来源 |
|---|---|
| `url` | string。Search 保留 provider 结果 URL；Fetch 是本地预检后实际提交给 DeepSeek 的 URL，不伪造 final URL |
| `title` | **始终为 string**。Fetch 未给标题时固定为空串 `""`，与官方 Fetch 口径一致；Search title 必须是 string，否则为协议错误 |
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
  "provider_id": "deepseek-work",
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

未配置、配置歧义或解析前参数错误的同一信封则是 `provider:null, provider_id:null, attempts:0`；
测试必须对这三类分别做精确 JSON 断言。`provider_code` / `provider_message` / `request_id` /
`http_status` 只在真实存在时出现。`code` 是 Lumir 的稳定分类，权限与测试只读它，不按 provider
文案猜测。`message` 由 Lumir 生成；原始响应 body 不进入工具结果。`provider_message` 必须脱敏、
限长，任何裁剪都加入 `truncated_fields`。`attempts` 只计实际 DeepSeek tools 请求次数，
本地预检不计入。

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

`harness.web_access.enabled` 缺省为 `true`，因此 Web 工具默认进入模型工具清单。显式 false 时
不注册，幻觉调用按同一注册闸回送 `tool_unknown`，且不解析 provider、不产生网络请求。
`harness.web_access.approval` 缺省为 `allow_all`，只决定默认 Allow 还是 Ask，不改变注册条件。
无可用 provider 由执行返回 `web_provider_unconfigured`，而不是变成另一套「工具不存在」语义。
每回合使用既有 `HarnessConfig` 快照，按以下顺序解析：

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
  目标站。默认 Allow 下不弹批准卡，工具行与成功 / 失败结果仍完整保留 query / URL、provider id、
  费用与 untrusted 说明，供审计；不能只靠 80 字工具行摘要满足可见性。用户改为 `ask` 后，
  批准卡必须显示同样的完整输入、双路外发与费用说明。
- `provider_id` 是会话已有的配置身份，可用于审计；API Key 本身永远不是审计字段。

无配置、配置歧义、自定义 base URL、参数 / URL / DNS 校验失败时，DeepSeek 请求数必须为 0，
也不得产生 curl 子进程。

### 3.3 网页访问设置与注册（D2 已批准）

「设置 → 自动化 → 网页访问」是网络授权区，不是第五种自动 LLM 行为。它包含：

- **总开关与批准策略**：`harness.web_access.enabled` 缺省 `true`，`harness.web_access.approval`
  缺省 `allow_all`，可选 `ask`。设置快照 / patch / revision 均覆盖两键；改动经既有
  `settings_apply` 原子写通道，下一回合生效。恢复默认 = 删键，页级还原同样删键，但不要求重启，
  也不清空 origin deny。provider 增删 / 切换不重置它们；关闭只隐藏工具，不删除 provider、deny
  或会话历史。
- **provider 只读状态**：复用 §3.1 同一解析口，显示实际 provider id、官方 DeepSeek / 未配置 /
  配置歧义 / 自定义 base URL 等状态。提供「前往模型接入」动作，选中对应 provider 表单；
  未解析出条目时跳到模型接入的 DeepSeek 管理面。本区不显示 Key、不复制 provider 字段、
  不提供第二 provider 选择器。
- **origin deny 列表**：只读既有 `harness.permissions.deny` 中规范 `web_fetch(origin)` 规则，
  默认空。支持新增封禁、单独移除 deny 与「全部清空」。写入复用权限规则治理的原子写通道与
  revision，不另建 origin 表。移除 / 清空只影响 deny：在默认 `allow_all` 下恢复允许，在 `ask`
  下恢复 Ask；不得暗中重置 approval。
- **审计说明**：默认 Allow 不再逐次弹卡，但本区与工具结果持续展示 query / URL、provider、费用、
  双路外发与 untrusted 提示。`allow_all` 表示用户选择了默认执行策略，不表示网页可以修改授权。

本区与四个自动 LLM 开关并列但不改变它们的数量、顺序或归属。provider / Key / endpoint 仍归
模型接入，origin deny 仍归权限规则，不在网页访问区复制任何一项。

### 3.4 配置校验与设置写通道

**键缺失与显式非法必须分开。** 只有 `web_access` 表 / 键缺失才使用 `enabled=true` 与
`approval=allow_all`。整表错形状、`enabled` 非布尔、`approval` 非字符串或未知枚举均进入局部
Invalid 状态：安全读数为 `enabled=false, approval=ask`，同时产生稳定
`web_access_config_invalid`。Invalid 不注册工具，直接调用也返回该错误且不解析 provider、
零网络请求。校验只作用于 `web_access` 节，MUST NOT 触发整文件回落，provider、permissions.allow /
deny 与其它配置原样保留；设置修复写不会顺手清空 origin deny。

设置 snapshot 同时携带 Web 状态、Invalid 诊断、实际 provider 状态和 origin deny 列表及 revision。
`settings_apply` patch 增加 `web_access.enabled` / `.approval` 与 `add_origin` / `remove_origin` /
`clear_origins`。revision 的 canonical 集合增加这两个 Web 键与 permissions.allow / deny。
保存仍在同一写锁内完成「严格读 → revision → patch（含 deny）→ 重载校验 → 原子写」。
权限 writer 必须支持 deny 的新增 / 精确删除 / 定向清空；只清规范 `web_fetch(origin)`，不改 allow、
其它 deny 或未知 / 非规范规则。权限表错形状不得被静默重置为空。`clear_origins=true` 不得与
`add_origin` / `remove_origin` 同 patch；同一规范 origin 也不得同时 add / remove，比较发生在 origin
规范化之后，因此仅大小写、默认 port、path 等字面差异不构成不同 origin。不同 origin 的 add / remove
可以同 patch。两类冲突均返回 `settings_patch_invalid`，文件逐字节不变且 revision 不推进，不定义或依赖
add / remove / clear 的处理顺序。

同一 revision 的并发保存只有一笔成功，另一笔返回 `settings_revision_conflict`，revision 已变化且
文件逐字节不变。以本页为准只在当前文件重应用同一 patch，不用旧快照覆盖。非法规格 patch 或非法
Web 值同样文件不变；对已有 `web_access_config_invalid`，允许用显式合法 Web 值修复，其它路径的
诊断规则不变。

## 4. `web_read` 权限与批准粒度

`web_read` 是权限分类，不是第三件工具，也不是新的权限模式。`web_search` / `web_fetch` 不加入
`READ_TOOLS` 的通用只读集合，而由 `harness.web_access.approval` 单独决定默认层：
`allow_all`（默认）在所有权限模式下直接 Allow，`ask` 才进入批准闸。`enabled=false` 时工具不注册，
不存在权限判定。

`approval=ask` 的批准卡依据 SHALL 使用独立 `DecisionReason::WebAccessPolicy { approval: "ask" }`，
事件与 `harness_state` 快照同源，文案明确「网页访问策略 = Ask」。它 MUST NOT 使用
`ModeDefault`，也不显示 `read_only` / `vault_write` / `full_access` 的档释义作为进闸原因。
`allow_all` 自动放行不产依据；origin deny 沿用 `DenyRule`，不产批准卡。

Web 判定顺序为 deny > 既有硬层 > `web_access.approval`；deny 永远优先。Web 不使用 allow 规则或
会话缓存来派生另一套授权模型，也不生成 Web 专用持久 allow / 免问动作。其它工具的 allow / 缓存
语义不变。URL / DNS / redirect / 内容类型 / 预算 / 密钥检查在执行层，任何 approval 值都不得跳过。

| 调用 | permission subject | 默认行为 | origin deny |
|---|---|---|---|
| `web_search` | 完整 query | 默认直接执行并保留完整 query / provider / 费用 / untrusted 审计；`ask` 时才显示完整批准预览 | 不支持按搜索词推断 origin；工具级 deny 仍可按既有规则拒绝 |
| `web_fetch` | 规范化 origin（scheme + host + 有效 port） | 默认直接执行并保留完整 URL / provider / 费用 / untrusted 审计；`ask` 时才显示完整批准预览 | `web_fetch(https://example.com)` 在每次初始调用与每跳重定向重新判定 |

Fetch origin 规范化必须小写 scheme / host、省略默认 port、保留非默认 port，不含 userinfo、path、
query 或 fragment。跨 origin 重定向不是新工具调用，不另开批准：先校验 Location 的 scheme / 凭据 /
host，再检查目标 origin deny；未封禁则继续 DNS / 连接 / 内容类型校验，全部通过后可执行。
被封禁目标在任何 approval 值下都返回 `permission_denied`，且不连接该 origin、不调用 DeepSeek。

基础参数形状与 URL scheme / userinfo 校验在可选批准预览之前完成，非法调用不产生携带凭据的批准卡。
权限语义变更实现时，必须全量回扫既有验收场景的闸期望，而不只新增 Web 场景。

## 5. URL、重定向与 DNS 安全

### 5.1 输入与 DNS

每次 Fetch 及每次重定向都执行完整校验：

1. URL 长度 1–8192；只准 HTTP / HTTPS；host 必填；userinfo 为空。拒绝其它 scheme、
   `file:`、`data:`、反斜杠混淆、控制字符与解析失败，不尝试「修复」成另一个 URL。
2. IP 字面量与 DNS 的全部 A / AAAA 结果都必须是全局可路由单播。任一结果为 loopback、private、
   link-local、unspecified、multicast、reserved、documentation、CGNAT、IPv4-mapped / 兼容映射的
   非全局地址，整条拒绝；不得只挑一个公网地址放行。`localhost`、`.local` 与解析失败 fail closed。
3. 对 host 的所有候选地址做有界连接时，只允许连接到已验证 IP，并保留原 host 的 Host 与 TLS SNI；
   禁止连接前再次由系统 resolver 自由选择地址。任一 DNS 答案在后续跳变时，下一跳重新执行全集校验。
4. 校验与连接共用同一个「已验证地址集」，防止 check-then-connect 之间再次发生系统 DNS 解析。
   预检 client 必须显式 `no_proxy`，每个 hop 都不得重新继承 HTTP(S)_PROXY / ALL_PROXY /
   NO_PROXY 或手动 Proxy。`no_proxy + 已验证地址集 + 原 Host / SNI + 手动逐跳 redirect` 是同一构造
   不变量；代理可以绕过固定 IP，不能只靠 resolver override。错误中不回显完整 DNS 答案或内部网络拓扑。
5. DeepSeek client 同样显式 `no_proxy`，不因共享构造便利而意外打开系统代理或自动 redirect。
   两个 client 的 3xx / redirect 策略分别断言，不互相推定。

### 5.2 有界预检

- 每个 hop 先发 HEAD；无法判定时用 `Range: bytes=0-4095` GET，只读取响应头与最多 4 KiB，
  随即关闭，不把预检正文交给模型。目标只支持 GET 而忽略 Range 时，读取硬上限仍生效。
- 单 hop 10 秒、整条预检 30 秒，最多 5 次重定向；超时 / 超限均失败且不调用 DeepSeek。
  预检不自动重试，避免重复访问目标站。
- 只接受 `text/html` 与 `application/xhtml+xml`（可带参数）。明确非 HTML 返回
  `web_unsupported_content`；Content-Type 缺失或冲突且 Range GET 仍无法判定返回
  `web_content_type_unknown`。两者都提示可另行选择 curl，但不自动执行。
- 相对 Location 按当前 URL 解析；每跳重新做 scheme / userinfo / host 与 origin deny 校验。
  跨 origin 不是新工具调用、不另开批准；目标未封禁才继续 DNS 与连接。超过 5 次为
  `web_redirect_limit`。
- 预检通过后才调用 DeepSeek Fetch，发送最后一个通过全部校验的 URL（允许跨 origin）。
  预检的 HEAD / Range GET 与
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
| 目标预检任何失败 / origin deny | 否 | 对应 `web_*` code 或 `permission_denied`；DeepSeek attempts=0 |

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
| `web_access_config_invalid` | 显式非法 `web_access` 表 / 字段；`provider:null, provider_id:null, attempts:0`，不注册、零请求；MUST NOT 映射为 `tool_unknown` 或 `web_provider_unconfigured` |
| `web_provider_unconfigured` | 无可用官方 DeepSeek 配置、配置歧义或自定义 base URL；零请求 |
| `web_url_blocked` | scheme / userinfo / host / IP 非允许目标 |
| `web_dns_failed` / `web_dns_blocked` | DNS 失败或任一答案非全局单播 |
| `web_redirect_limit` | 重定向超过 5 次 |
| `web_unsupported_content` / `web_content_type_unknown` | 明确非 HTML / 无法确认 HTML |
| `web_network_failed` / `web_timeout` / `web_cancelled` | 本地网络、超时、取消 |
| `web_response_too_large` | DeepSeek API 响应超过 2 / 4 MiB |
| `web_provider_protocol_error` | API 非 JSON、JSON 非法、字段形状不符、tools API 3xx |
| `web_http_error` | 4xx / 5xx；附 status、provider code / request id（如有）与 attempts；3xx 走上一行且不跟随 |
| `web_empty_content` | Fetch 没有可用 Markdown 正文 |

`web_unsupported_content` 只在能确定内容类型时使用；DeepSeek 404 可能同时代表 URL 不可用、目标策略、
内容类型不支持或无 Markdown，统一映射 `web_http_error`，不得凭 404 伪造更精确原因。

## 8. Untrusted Web 内容与提示注入

Search / Fetch 的 title、snippet、summary、content 与 provider_message 全是不可信数据。
它们：

- 只能作为 function output 的 JSON 字符串进入模型上下文，不进入 system prompt、AGENTS、权限规则、
  批准理由或 provider 配置；`trust:"untrusted"` 恒在。
- 不得被解释为「忽略之前指令」「用户已批准」「以后全部 allow」「执行某命令」等授权事实。
  真正的授权仍只来自既有权限配置与用户批准通道。
- 不得自动触发 curl、写文件、修改权限、二次 Fetch 或新 provider 请求。后续模型调用必须重新经过
  同一工具循环、预算、权限与安全校验。
- 不得因网页包含批准话术而改变 `approval`、origin deny 或审批文案。默认 Allow 来自用户配置，
  可选批准卡只由实际工具参数与配置生成。

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
- 不引入 DeepSeek SDK；优先复用现有 reqwest / serde。两个 HTTP client 的公共安全构造必须显式
  `no_proxy`。DNS 固定地址可用现有 HTTP client 的 resolve / connector 能力实现，但若无法满足
  「no_proxy + 校验地址与连接地址同一 + 原 Host / SNI」，不得退化为普通 reqwest 自动解析或系统代理。

### 9.1 生产与隔离验收的装配边界

生产装配只有 `DeepSeekWebProvider::official`：endpoint 由官方常量给出，配置只负责选择凭据，
没有 endpoint 参数、loopback 白名单、代理开关或跳过 URL / DNS 校验的路径。生产 `WebTransport`
与 `DnsResolver` 分别执行真实 HTTP 与系统 DNS，两个 client 都显式 `no_proxy`。

隔离测试 / 真机验收使用独立的测试 provider / transport 装配，但复用同一 Web 核心的参数校验、
DNS 全集检查、地址固定、redirect、预算、重试与错误分类：

1. **DeepSeek**：测试 provider 构造器接收合成 endpoint，生产构造器没有该参数。合成服务记录真实
   HTTP method / path / body / 状态序列 / 请求次数 / 读取字节数；LLM mock 只负责让模型发出确定的
   工具调用，不能替代这些 Web HTTP 证据。
2. **目标 DNS / connector**：合成 resolver 给 `target.test` 返回脚本化的公网身份；测试 connector
   再把「已验证公网 IP + 原 host」映射到本地监听地址。生产同款全集校验与地址固定仍先执行，
   不得为验收全局放行 loopback。rebinder 脚本可先给公网、再给私网，非法序列必须零连接。
3. **HTTPS**：另用只含 `target.test` 的测试 CA / 证书与隔离 trust store 验证原 Host / SNI；
   不关闭证书校验，不把系统根证书或真实浏览器凭据挂入。HTTP 用例不能冒充 SNI 证据。
4. **激活边界**：注入只能由隔离验收专用 build / 装配显式激活；普通 `config.json`、环境变量、
   真实 vault、生产 `pnpm tauri dev` 与发布构建都没有激活入口。反向断言包括：生产构造器拒绝自定义
   endpoint、无测试 feature / 装配时本地映射不存在、生产 URL / DNS 拒绝规则不变。
5. **代理反例**：本地同时启动代理与目标双服务，设置 HTTP(S)_PROXY / ALL_PROXY。正确实现只能经
   测试 connector 到达已验证目标，代理零请求；恢复使用系统代理的错误实现必须能判红。DeepSeek
   client 单独证明 `no_proxy + 3xx 不跟随 + Bearer 不泄漏`，不与预检结果互相代替。

测试装配不是生产兼容层，也不改变「生产 official endpoint only」。它只替换网络边界的事实来源，
不用 mock fixture 跳过真实 HTTP。

## 10. 验证矩阵

### 10.1 DeepSeek mock HTTP 与输出预算

- 断言 POST path、Bearer、JSON 字段；Search 缺省 `count=5, need_content=false`，无 `ori_question` /
  `localization`；Fetch 只带预检后的 url。全程不打真实计费 API。
- Search 结构化映射：URL / title / snippet / summary / content / site / date / authority / provider；
  空 results 成功；need_content=false 后必须第二次 Fetch 才出现 Markdown。Fetch 空标题固定 `""`，
  其它可空字段才用 null。
- 无配置、配置歧义、解析前参数错误分别精确断言 `provider:null, provider_id:null, attempts:0`；
  成功及解析后错误才带实际 id。301 / 302 / 307 / 308 均零跳转、Bearer 不泄漏且只归
  `web_provider_protocol_error`。
- 逐字段、聚合与错误文本截断；`truncated_fields` 精确且不漏报。2 / 4 MiB 超限、非 JSON、坏 JSON、
  缺字段、非 JSON Content-Type、空 Fetch 正文都有独立反例。
- 每个被声称覆盖的反例先证明旧实现 / 错误实现会 FAIL，不接受只检查子串或空数组的假绿。

### 10.2 权限、隐私与 fail closed

- 默认 `enabled=true, approval=allow_all` 注册并直接执行；三档权限模式都不逐次 Ask。
  `enabled=false` 不注册；`approval=ask` 才进批准闸；deny 恒优先，Web allow / 会话缓存不参与授权。
- 缺键才取默认值。整表错形状、enabled 非布尔、approval 非字符串 / 未知枚举均为
  `web_access_config_invalid`：安全读数 enabled=false / ask、不注册、零请求，provider / origin deny /
  其它配置不变；合法修复可保存，非法 patch 文件不变。
- `full_access + approval=ask` 的判定依据为 `WebAccessPolicy{approval:"ask"}`，不是 ModeDefault；
  allow_all 不产卡，deny 不产卡。
- 设置页 provider 显示与跳转不暴露 Key；origin deny 新增、单独移除 / 全部清空统一走 settings_apply
  与同一 revision。两个并发操作只有一个成功，另一笔 `settings_revision_conflict` 且文件不变；
  非规范规则 / allow / 其它 deny 保留，不错形状清空权限表。
- 完整 query / URL、provider、费用与 untrusted 审计在默认无批准卡时仍存在；`curl` 原矩阵不变。
- active DeepSeek 官方、active 非 DeepSeek + 唯一候选、多个候选、无 Key、active 自定义 base URL、
  非 active 自定义 base URL；无配置 / 歧义 / 自定义时零 HTTP、零 curl。
- canary Key 出现在恶意 provider body / 目标 body / 错误 URL 中，扫描日志、panel、JSONL、wire、
  错误事件与测试输出均无 canary；批准卡仍完整显示 query / URL 与数据外发说明。

### 10.3 SSRF / redirect / DNS

- 非 HTTP(S)、userinfo、IP 变体、IPv6 / mapped、loopback、private、link-local、CGNAT、multicast、
  reserved、documentation、localhost / `.local`、DNS 失败、公私混合答案均拒绝。
- 模拟 DNS 第一次公网、第二次私网；断言连接只使用已验证 IP，Host / SNI 不变，不在连接前重解析。
- 本地代理与目标双服务在 HTTP(S)_PROXY / ALL_PROXY 下运行：预检只到已验证目标，代理零请求；
  DeepSeek 也单独证明 `no_proxy`、3xx 不跟随与 Bearer 不泄漏；错误实现必须判红。
- 每跳 redirect 都重验 scheme / 凭据 / DNS / origin deny；跨源未封禁时不另开批准即可继续，
  被封禁时零连接、零 DeepSeek；超过 5 次、相对 Location、scheme downgrade、带凭据 Location
  都有反例；tools API 3xx 不跟随且不泄漏 Bearer。
- 跨 origin A → B 全部通过后，精确断言发给 DeepSeek 的 url 是最后一个通过校验的 B URL，
  `source.url` 同值；不得拒绝跨源、错误提交 A URL 或伪造 provider final URL。
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
  工具结果不重复；重试成功后的新 Web 调用仍按当前 approval / deny 与全部硬校验执行。
- Web 工具内部 attempt 重试只重发当前 HTTP 请求，不重放同批其它工具。

### 10.6 search → fetch、untrusted content 与真机

- mock Search 返回来源 → 模型 Fetch 该来源 → 最终回答可引用同一 URL / title / date / authority；
  默认 Search 响应无正文，证明第二跳真实发生。
- 页面含「忽略指令 / 自动批准 / 执行 curl / 修改权限」时仅作为字符串保留；权限配置与缓存不变，
  后续写 / 危险调用仍进闸。
- 真机按 §9.1 用隔离测试 provider / transport 与本地合成服务覆盖上述关键链路、redirect / DNS、
  超时取消与恢复；记录真实 HTTP method / path / body / 状态序列 / 请求次数 / 读取字节数。
  合成公网身份经脚本 resolver / connector 映射本地，HTTPS 用 `target.test` 测试 CA 与隔离 trust store；
  不开生产自定义 endpoint 或 SSRF 例外。LLM mock 只驱动调用，不替代 Web HTTP 证据。
- 反向断言普通配置 / 真实 vault / 生产构建无法激活注入，生产仍 official endpoint only 且 URL / DNS
  拒绝规则不变。
- 全量回扫既有验收场景的权限 / 批准期望；新增场景与 `COVERAGE.md` 随实现同 PR。
  动批准卡视觉面时跑结构断言与本地 `gate.sh visual`，基线更新仍须 Alex 过目。

## 11. 评审重点

1. D1 已批准 `enabled=true, approval=allow_all`：复审重点是默认直接执行是否仍完整保留 query / URL、
  provider、费用与 untrusted 审计，而不是重新引入逐次批准。
2. D2 已批准网页访问入口：复审全局关闭 / Ask、origin deny 单项恢复与全部清空是否复用同一权限规则
  与 revision，且不暗改 approval、不复制 Key / provider / origin 第二真源。
3. 只有键缺失使用批准默认值；任何显式非法 Web 配置必须是 `web_access_config_invalid`，安全读数
  enabled=false / ask、零请求，且不触发整文件回落或清 deny。
4. settings snapshot / patch / revision 与 deny 必须在同一写锁闭合；并发冲突文件不变，clear 只清规范
  `web_fetch(origin)`，allow / 其它 deny / 非规范规则不受影响。
5. `full_access + approval=ask` 必须产独立 `WebAccessPolicy` 依据，不能回退为 `ModeDefault`；
  allow_all / deny 不产卡。
6. A → B 跨 origin 全部通过后，DeepSeek 请求与 `source.url` 都必须是最后一个通过校验的 B URL；
  不得重新限定同源或复活旧重定向输出字段。
7. 本地预检会产生额外 HEAD / Range GET；它换来可验证的 redirect / DNS 安全，但也让目标站看到
   Lumir 与 DeepSeek 两路访问。是否接受这一明确代价。
8. `no_proxy` 是固定 IP 的一部分，不是可选网络优化；两个 client 都必须有系统代理反例。
9. DeepSeek 远端抓取的 DNS / redirect 不可观察；本设计只承诺本地防线与官方 provider 信任边界，
   不承诺端到端 rebinding 防护。
10. 多 DeepSeek 条目时不暗选，active 自定义 base URL 时不改投官方；这是有意的 fail-closed 可用性取舍。
11. 仅 408 / 429 / 5xx 自动重试；本地 timeout 与 200 后本地解析失败不重试，优先避免重复计费。
12. Web 仅交互主会话，cron / 子运行不扩权；`curl` 保留现有批准语义，不能成为静默旁路。
13. 隔离测试 transport 只替换网络事实来源，生产不能激活自定义 endpoint / loopback 例外；
   LLM mock 与真实 Web HTTP 证据不得互相冒充。
