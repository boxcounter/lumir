# harness 增量规格

> 起草注记（非规格正文）：本 change 给 Web 抓取结果加「证据形态」与「抓取归属」，只改
> `web_fetch` 的输入面、统一信封的可空读数与面板呈现，不新增生产 provider / 配置 / 价格 / 网络路径。
> 四条 MODIFIED requirement 均基于当前 living spec（`openspec/specs/harness/spec.md`，master
> `0018f0a39`）的原文**整块复制**后改，未改动的段落与场景逐字保留；新增一条 ADDED requirement
> 承载字段词汇与真值表。活跃期不改 living spec。

## MODIFIED Requirements

### Requirement: 统一 Web 搜索与抓取工具

`harness.web_access.enabled` 缺省为 `true`，交互主会话 SHALL 默认提供 `web_search` 与 `web_fetch`，
两者 SHALL 使用同一结果信封与 `WebSource` 来源结构；显式 false 不注册这两件工具。`web_search` 输入 SHALL 仅含 `query` / `count` / `need_content`：query trim 后为 1–128 个
Unicode 字符且不全为空白；count 缺省 5、本地允许 1–10，越界 SHALL 返回 `web_args_invalid` 而非静默
clamp；`need_content` 缺省 `false`。`web_fetch` 输入 SHALL 含 1–8192 字符的 `url`，并 SHALL 另含两个可选
参数：`mode`（枚举 `full` | `selected_chunks`，缺省 `full`）与 `query`（1–256 Unicode 字符且不全为
空白；仅 `mode=selected_chunks` 时允许且必填，`mode=full` 时出现 SHALL 返回 `web_args_invalid`）。
`mode` 与 `query` 是请求意图，不是能力协商参数：provider 不支持所请求的模式时 MUST NOT 暗换模式、
MUST NOT 暗换 provider、MUST NOT 产生批准卡（见「Web 抓取证据形态与归属」）。工具 schema
MUST NOT 暴露 API Key、provider、base URL、超时、重试、响应上限或任意 HTTP header。

统一信封 SHALL 含 `ok` / `provider` / `provider_id` / `operation` / `attempts` / `local_precheck` /
`trust` / `truncated` / `truncated_fields`，并 SHALL 另含两个可空结果读数 `result_count` /
`result_text_bytes`。成功 Search 的两个读数 SHALL 在预算裁剪全部完成后由后端**单一一次**计算：
`result_count` = 实际回送模型的结果条数（不是 provider 原始条数、不是请求的 `count`）；
`result_text_bytes` = 最终保留各结果的 title / snippet / summary / content 各字符串 UTF-8 字节数
之和（不含 URL / site / date / authority / query 与 JSON 结构开销，不是网页大小或网络流量）。
非 Search 成功、失败、缺读数时两键 SHALL 为 null，MUST NOT 以 0 冒充空结果。`local_precheck` SHALL 记录 Fetch 是否**实际执行过**
本地预检：未配置、配置非法、参数非法、权限拒绝等未进入 executor 的路径为 `false`；进入 executor
后无论预检成功、失败还是取消均为 `true`。审计 MUST NOT 仅按 `operation=fetch` 推断该值。`local_precheck`
只回答「预检是否实际执行过」，MUST NOT 被用作「抓取被交给了谁」或「远端已被验证」的判据——这两件事
分别由 `fetched_by` 与 `binding` 承担（见「Web 抓取证据形态与归属」）。`provider` / `provider_id` SHALL 为 `string | null`：只有 provider
解析成功才填 `"deepseek"` 与实际配置映射键；未配置、配置歧义、自定义 base URL 及解析前的参数 /
权限 / URL 拒绝均填 null 且 `attempts=0`，MUST NOT 伪造 `"deepseek"` 为配置 id 或在多候选时暗选。
统一信封 SHALL 另含五个可空读数 `content_scope` / `coverage` / `fetched_by` / `binding` /
`final_url`，键恒在场、无信息时为 null；取值与置空规则、真值表见「Web 抓取证据形态与归属」。
Search 侧五者恒为 null，MUST NOT 用 Search 结果冒充抓取证据。
基础参数形状与 URL 静态安全校验（scheme / userinfo / 控制字符 / 反斜杠 / 缺失 host，以及
`localhost`、`.local`、非全局单播 IP 字面量）SHALL 在 provider 解析与可选批准预览之前完成：
任一 provider 配置状态（未配置、配置歧义、自定义 base URL）都 MUST NOT 掩盖 URL 安全拒绝，
被拒调用 MUST NOT 变成 `web_provider_unconfigured`，也 MUST NOT 产生批准卡；这些路径的
`local_precheck` 为 `false`（预检未执行），`attempts` 为 `0`，可解析出 origin 的拒绝仍带
`source.url`，带凭据的输入 MUST NOT 被抄进 `source`。
Fetch 的 `mode` / `query` 形状与一致性 SHALL 与 URL 静态校验同在 provider 解析之前完成；provider
解析成功后的**能力检查** SHALL 早于可选批准预览与本地预检——不支持的模式 MUST NOT 生成批准卡、
MUST NOT 进入预检、MUST NOT 触达 provider（见「Web 抓取证据形态与归属」）。
成功 Search SHALL 另带完整 query 与 `results: WebSource[]`，成功 Fetch SHALL 另带
`source: WebSource`。`WebSource` SHALL 固定包含 `url` / `title` / `snippet` / `summary` /
`content` / `content_format` / `site` / `date` / `authority`。title SHALL 始终为 string，
Fetch 空标题固定 `""`；其它可空字段的无信息值才用 null，MUST NOT 混用空串与 null。
Search SHALL 原样保留 date 与 -1–4 的 authority（含 -1 = 未知）；Fetch 无这两项信息时填 null。
`site_icon` MUST NOT 进入结果，避免派生未审计的图片请求。

Search 的 `need_content=false` SHALL 作为默认工作流：先返回来源与摘要，再由模型按需调用 Fetch 获取
Markdown。Search 空数组 SHALL 是成功的空结果；Fetch 空 Markdown SHALL 返回 `web_empty_content`，
不得冒充有正文的成功。Fetch 的 `source.url` SHALL 是本地预检后实际提交给 DeepSeek 的 URL，
MUST NOT 伪造 provider 未返回的 final URL。

系统 SHALL 同时限制 API 响应字节与进入模型上下文的字符：Search title / snippet / summary 每项上限
300 / 500 / 1,200 Unicode 字符，Search content 每项 4,000 字符且全部 results 文本合计 24,000 字符，
Fetch Markdown 24,000 字符，Lumir message / provider_message / request_id / provider_code 各 1,000
字符；Search / Fetch API 响应
分别不得超过 2 / 4 MiB。聚合裁剪 SHALL 按 content → summary → snippet 顺序，结果只能整条移除；
URL / date / authority / provider MUST NOT 被裁剪。任何字段或数组被裁剪时 SHALL 同时置
`truncated:true` 并在 `truncated_fields` 列出稳定路径；未截断时该数组为 `[]`。只在文本末尾加省略号
而缺少这些字段 SHALL 视为违约。API 字节超限 SHALL 返回 `web_response_too_large`，不解析半截 JSON。

#### Scenario: 默认搜索后再抓取

- **WHEN** 模型以默认参数调用 `web_search`，随后选择一个来源调用 `web_fetch`
- **THEN** Search 请求携带 `count=5, need_content=false`，返回结构化来源但无需返回正文；Fetch 第二跳
  返回同一 `WebSource` 形状的 Markdown 内容，最终回答可引用 URL / title / date / authority / provider

#### Scenario: 空结果与空正文不同

- **WHEN** DeepSeek Search 返回空 results，或 Fetch 返回空 Markdown
- **THEN** 前者为 `ok:true, results:[]` 且不自动重试；后者为 `web_empty_content`，不得返回伪造正文

#### Scenario: 可空 provider 与空标题形状一致

- **WHEN** 分别发生无配置、配置歧义、解析前参数错误，以及 Fetch 无标题
- **THEN** 前三者的 `provider` / `provider_id` 均为 null 且 `attempts=0`，不暗选或伪造 id；
  最后一者的 `source.title` 为 `""` 而非 null

#### Scenario: URL 安全拒绝先于 provider 解析

- **WHEN** `web_fetch` 收到 `localhost`、`.local`、非全局单播 IP 字面量、非 HTTP(S) scheme 或带凭据的
  URL，且 provider 处于未配置 / 配置歧义 / 自定义 base URL 任一状态（`approval` 为任意值）
- **THEN** 结果恒为 `web_url_blocked`（参数形状非法则为 `web_args_invalid`），MUST NOT 被配置状态
  改写成 `web_provider_unconfigured`；`provider` / `provider_id` 为 null、`attempts=0`、
  `local_precheck=false`，不产生批准卡，可解析出 origin 的路径仍带 `source.url`

#### Scenario: 截断显式且 JSON 完整

- **WHEN** 搜索摘要、正文、结果数组或 provider 错误文案超过预算
- **THEN** 输出仍为完整 JSON，顶层 `truncated:true`，`truncated_fields` 精确指出被裁路径；未裁的
  URL / date / authority / provider 保持完整，不出现只加省略号的无标记截断

#### Scenario: 响应字节与上下文预算独立

- **WHEN** DeepSeek 响应超过对应 2 / 4 MiB 上限，或合法响应的正文超过模型字符预算
- **THEN** 前者返回 `web_response_too_large` 且不解析半截 JSON；后者可返回有界结果但必须显式标记截断

#### Scenario: 错误元数据同样有界

- **WHEN** provider 的错误响应带超长 `message` / `provider_message` / `request_id` / `provider_code`，
  或本地预检失败的错误串包含完整 8,192 字符 URL
- **THEN** 四个字段各自不超过 1,000 字符，且被裁字段逐一进入 `truncated_fields`；URL 本身的
  `source.url` 不被裁剪

#### Scenario: 审计按实际发生记录预检与外发

- **WHEN** 分别发生 allow_all 正常执行、ask 批准后执行、deny、未配置
- **THEN** 只有进入 executor 的 Fetch 审计 `local_precheck=true`；`provider_fetch` 只在
  `attempts>0` 时为 true；deny / 未配置的审计两个布尔均为 false，MUST NOT 按 operation 恒猜

#### Scenario: 结果读数按预算裁剪后的实际回送计算

- **WHEN** Search 返回的结果被字段截断、聚合裁剪或整条移除
- **THEN** `result_count` 等于最终仍回送模型的结果条数，`result_text_bytes` 等于这些结果的
  title / snippet / summary / content 的 UTF-8 字节和；真正成功的空结果为 `0` 而不是 null，
  失败 / 非 Search 成功为 null（MUST NOT 以 0 冒充）

#### Scenario: Fetch 模式与 query 的形状矩阵

- **WHEN** `web_fetch` 分别收到 `mode=selected_chunks` 缺 `query`、`mode=full` 同时带 `query`、
  `query` 超过 256 字符或全为空白、以及未知的 `mode` 值
- **THEN** 四种情形都返回 `web_args_invalid`，`attempts=0`、`local_precheck=false`、五个抓取读数
  全为 null，且零目标连接、零 provider 请求

#### Scenario: 不支持的模式失败关闭且不降级

- **WHEN** 已解析 provider 的静态能力声明不含请求的 `mode`（如 DeepSeek 收到 `selected_chunks`）
- **THEN** 返回 `web_mode_unsupported`，`provider` / `provider_id` 为已解析值，`attempts=0`、
  `local_precheck=false`、五个抓取读数全为 null，零目标连接、零 provider 请求、无批准卡；
  MUST NOT 改用另一模式或另一 provider 重试，`message` 写明当前 provider 支持的模式

### Requirement: Web 访问策略与 origin 例外

`harness.web_access.approval` 缺省为 `allow_all`，`web_search` / `web_fetch` SHALL 在所有权限模式中
默认直接执行；只有显式 `approval=ask` 才进入批准闸。Web 判定顺序 SHALL 为 deny > 既有硬层 >
`web_access.approval`，deny 永远优先。Web MUST NOT 使用 allow 规则或会话缓存派生授权，也 MUST NOT
生成 Web 专用持久 allow / 免问动作；其它工具的 allow / 缓存语义不变。

Search 的 permission subject SHALL 为完整 query；Fetch 的 subject SHALL 为规范化 origin
（scheme + host + 有效 port），origin 规范化 SHALL 小写 scheme / host、省略默认 port、保留非默认 port，
且不含 userinfo / path / query / fragment。默认无批准卡时，Web 工具行 SHALL 默认紧凑：运行中单行
显示状态与纯 query（Fetch 为纯 URL），MUST NOT 显示原始 arguments JSON 或默认参数；完成后默认
显示 query（Fetch 为 URL）；Fetch 的默认行 URL SHALL 是调用 arguments 的原始输入 URL，重定向后的
最终 `source.url` SHALL 只在默认关闭的「查看详情」中呈现，MUST NOT 覆盖默认行。Search 成功另有
第二行结果健康摘要——正常为 `N 条结果 · 文本 X`，
字段截断追加 `· 已截断`，`truncated_fields` 含 `results` 时为 `保留 N 条结果 · 文本 X · 已截断`，
真正成功的空结果为 `0 条结果 · 搜索成功`（英文同义双语；N 与 X 的口径见「统一 Web 搜索与抓取
工具」条）。Fetch 成功另有第二行证据徽标：`content_scope=full` 为 `文档提取 · 完整性未验证`，
`selected_chunks` 为 `相关段落`；`coverage=bounded` 追加 ` · 完整性受限`，Lumir 本地按预算裁剪正文
（`truncated_fields` 含 `content`）追加 ` · 已截断`；失败或 `content_scope=null` 不显示徽标。
徽标与工具行 MUST NOT 出现「全文」「完整页面」一类措辞——任何 `coverage` 取值下都不得声称页面
完整（本阶段不存在 `verified`，见「Web 抓取证据形态与归属」）。失败时直接显示稳定错误码与人话原因，
MUST NOT 显示条数或文本大小。provider id、
attempts、完整 query / URL、截断字段、实际外发与费用、`trust:"untrusted"` SHALL 全部保留在默认
关闭的「查看详情」中，可展开完整回看；`content_scope` / `coverage` / `fetched_by` / `binding` /
`final_url` 与 Fetch 的 `mode` / `query` SHALL 同样只在「查看详情」呈现（`final_url` 仅在场时），
MUST NOT 进入默认行。MUST NOT 删除事件 / 面板记录 / JSONL / 安全元数据。Ask
待决卡的完整预览信息 SHALL 保持完整：Fetch `mode=selected_chunks` 的预览另 SHALL 显示 `query`，
并说明该 query 会随 URL 一起发往 provider。

Fetch 的 provider 外发说明 SHALL 只在 `fetched_by=provider` 时呈现；`local_precheck` 与
`provider_fetch` 的组合 MUST NOT 继续作为外发文案的唯一判据（本地预检执行过不等于字节发给了
provider，见「Web 抓取证据形态与归属」）。live 事件与快照 / 会话恢复两条路径 SHALL 同形同默认态：恢复行的
query / URL SHALL 从该调用的持久化输入（同一份 arguments，完整不截断；Fetch 为原始输入
URL，`selected_chunks` 时另含 `mode` 与选取 `query`）恢复，MUST NOT 把失败摘要（`状态 · code: message`）或最终 `source.url` 当默认行参数；
持久化的选取 `query` MUST NOT 顶替默认行 URL——Fetch 默认行恒为原始输入 URL，query 只进「查看详情」
与批准预览。
旧留存缺该输入时 SHALL 安全降级为空、MUST NOT 伪造。
旧留存缺结果读数时 SHALL 不显示条数与文本大小（MUST NOT 补零）。
旧留存缺 `content_scope` / `coverage` / `fetched_by` / `binding` / `final_url`，或缺 Fetch 的
`mode` / `query` 时，SHALL 不显示对应徽标与详情行，MUST NOT 补默认值，也 MUST NOT 由
`local_precheck` / `attempts` 反推 `fetched_by` / `binding`。
`harness.permissions.deny` 中的 `web_fetch(origin)` SHALL 在初始调用与每跳重定向重新判定。

跨 origin 重定向不是新工具调用，MUST NOT 另开批准。预检 SHALL 先校验 Location 的 scheme / 凭据 /
host，再检查目标 origin deny；未封禁才继续 DNS / 连接 / 内容类型校验，全部通过后可执行。
被封禁目标在任何 approval 值下都 SHALL 返回 `permission_denied`，且不连接该 origin、不调用 DeepSeek。
基础参数形状与 URL scheme / userinfo 校验 SHALL 在可选批准预览之前完成，非法调用不得产生携带凭据
或无效目标的批准卡。provider 能力检查 SHALL 同样早于可选批准预览：不支持的模式 MUST NOT 产生
批准卡、MUST NOT 进入本地预检。任何 approval 值都不得跳过 DNS、重定向、内容类型、预算或密钥检查。

#### Scenario: 默认 Allow 不逐次弹卡且审计完整

- **WHEN** approval 缺省为 `allow_all`，模型以不同 query 连续搜索并抓取多个页面
- **THEN** 所有调用默认直接执行，没有会话范围限制或逐次批准卡；每次工具行显示 query / URL 与
  结果健康摘要，provider、attempts、费用与 untrusted 说明保留在默认关闭的「查看详情」中

#### Scenario: origin deny 恢复默认策略

- **WHEN** 权限 deny 含 `web_fetch(https://example.com)`，用户单独移除或清空该 deny
- **THEN** 写入复用既有权限规则与 revision；默认 `allow_all` 下该 origin 恢复直接执行，`ask` 下恢复
  批准闸，approval 不被暗改，其它规则不变

#### Scenario: 跨 origin 重定向只做硬校验与 deny

- **WHEN** Fetch 收到指向另一 origin 的 Location，目标未封禁；另一序列的目标命中 origin deny
- **THEN** 未封禁目标经 scheme / 凭据 / DNS / no_proxy / 内容类型校验后可继续，不另开批准；
  封禁目标返回 `permission_denied`，未连接新 origin、未请求 DeepSeek
- **AND** A → B 全部通过后，提交给 DeepSeek 的 url 与 `source.url` 都是最后一个通过校验的 B URL，
  不得拒绝跨源或继续提交 A URL

#### Scenario: 默认紧凑与详情默认关闭

- **WHEN** allow_all 下一次 Search 成功完成
- **THEN** 工具行显示 query，第二行显示 `N 条结果 · 文本 X`；详情入口读「查看详情」且
  `aria-expanded=false`，审计正文不可见；展开后可见 provider / attempts / 完整 query / 截断字段 /
  外发与费用 / untrusted，再次点击收回

#### Scenario: 空结果、字段截断与结果裁剪

- **WHEN** Search 真正成功但没有结果 / 某字段被截断 / 结果数组被整条移除
- **THEN** 三种分别显示 `0 条结果 · 搜索成功`、`N 条结果 · 文本 X · 已截断`、
  `保留 N 条结果 · 文本 X · 已截断`；N 与 X 取预算裁剪后的实际回送值

#### Scenario: 失败不显示条数与大小

- **WHEN** Web 调用以 `web_provider_unconfigured` / `web_http_error` / `permission_denied` 等失败
- **THEN** 工具行直接显示稳定错误码与人话原因，MUST NOT 出现 `0 条结果` / `0 B` 一类读数；
  provider / attempts / 外发事实仍可在「查看详情」中回看

#### Scenario: 实时与恢复同形

- **WHEN** 同一 Web 调用分别经 live 事件与快照 / 会话恢复重建
- **THEN** 两者工具行（含默认行可见的 query / URL）、第二行健康摘要、详情入口与默认关闭态一致；
  旧留存缺输入 / 读数时不显示 query / URL / 条数 / 大小（MUST NOT 伪造）

#### Scenario: Fetch 重定向的原始输入与最终 URL

- **WHEN** Fetch 从原始 URL A 重定向到最终 URL B 后成功或失败
- **THEN** live、快照恢复与 JSONL 恢复的默认行都显示原始 A；展开「查看详情」后显示最终 B 与
  其余审计事实；默认行 MUST NOT 被最终 B 覆盖

#### Scenario: Fetch 证据徽标如实反映形态与截断

- **WHEN** 分别发生 `full` + `coverage=unknown` 成功、`selected_chunks` 成功、以及 `full` 成功但正文
  被本地 24,000 字符预算裁剪
- **THEN** 三种分别显示 `文档提取 · 完整性未验证`、`相关段落`、`文档提取 · 完整性未验证 · 已截断`；
  三种都不出现「全文」；失败调用不显示徽标

#### Scenario: selected_chunks 的批准预览显示 query

- **WHEN** `approval=ask`，provider 能力声明支持 `selected_chunks`，模型以 `url` +
  `mode=selected_chunks` + `query` 调用 `web_fetch`
- **THEN** 批准预览同时显示完整 URL 与 query，并说明 query 会随 URL 一起发往 provider；批准卡的
  subject 仍是 origin，默认工具行仍只显示原始输入 URL，query 只在预览与「查看详情」出现

#### Scenario: 旧留存缺证据字段不伪造

- **WHEN** 快照 / 会话恢复读到不含 `content_scope` / `coverage` / `fetched_by` / `binding` /
  `final_url`（或不含 Fetch `mode` / `query`）的旧记录
- **THEN** 不显示证据徽标与对应详情行，MUST NOT 补默认值，也 MUST NOT 由 `local_precheck` /
  `attempts` 反推 `fetched_by` / `binding`

### Requirement: Web 请求可靠性与计费边界

DeepSeek 每次 attempt SHALL 连接超时 5 秒；Search / Fetch attempt 总超时分别 30 / 45 秒，含退避与
本地预检的整次工具调用分别不超过 100 / 150 秒。Fetch 的本地预检与 DeepSeek 阶段 SHALL 共享同一
deadline：预检只使用剩余时间，整次 deadline 用尽后 MUST NOT 再发 provider 请求，返回 `web_timeout`
且 `attempts=0`。响应头与 body 读取 SHALL 计入 deadline。取消 SHALL 复用
`ctx.aborted()` 的同一事实源，在发起前、退避、响应等待与 body 分块读取时检查，且 MUST NOT 持会话锁。
取消后 SHALL 关闭响应、不再发新 attempt、返回 `web_cancelled`，部分 JSON 不得当成功解析；
已在 OS / provider 处理的请求无法撤销，系统 MUST NOT 承诺取消可撤销潜在费用。

自动重试 SHALL 只针对 DeepSeek tools API 的 HTTP 408 / 429 / 5xx，最多初次 + 2 次重试；退避优先使用
上限 2 秒的 `Retry-After`（delta-seconds 或 RFC 2822 / IMF-fixdate 的 HTTP-date；obsolete RFC 850 /
asctime 形态按缺失处理），缺失时使用 250ms、1s。重试耗尽后的 `message` SHALL 如实写明「已尝试
初次 + 重试」；单次不可重试的失败才使用「未自动重试」。其它 4xx（含 425）、本地 DNS / connect / TLS /
timeout、取消、200 后响应过大 / 非 JSON / 坏 JSON / 形状不符 / 空正文 MUST NOT 自动重试。
本地预检 MUST NOT 自动重试。Search 空 results 不视为错误，Fetch 空 Markdown 即使官方不计费也不重试。
200 已到达后的本地解析失败 MUST NOT 为追求成功而重复请求。

错误 SHALL 使用稳定内部分类：`web_args_invalid` / `web_access_config_invalid` /
`web_provider_unconfigured` / `web_mode_unsupported` / `web_url_blocked` / `web_dns_failed` / `web_dns_blocked` /
`web_redirect_limit` / `web_unsupported_content` / `web_content_type_unknown` / `web_network_failed` /
`web_timeout` / `web_cancelled` / `web_response_too_large` / `web_provider_protocol_error` /
`web_http_error` / `web_empty_content`。4xx / 5xx SHALL 归 `web_http_error` 并保留真实 status、
attempts 与可得的 provider code / request id；3xx SHALL 不跟随并统一归
`web_provider_protocol_error`，不得双重映射。DeepSeek 404 MUST NOT 被伪造为更精确的目标原因。
`web_access_config_invalid` 的结果 SHALL 为 `provider:null, provider_id:null, attempts:0`，不注册、
零请求，MUST NOT 映射为 `tool_unknown` 或 `web_provider_unconfigured`。
`web_mode_unsupported` SHALL 只由 provider 能力检查产生：`provider` / `provider_id` 为已解析值、
`attempts=0`、`local_precheck=false`、五个抓取读数全为 null，零目标连接、零 provider 请求、无批准卡；
它 MUST NOT 自动重试、MUST NOT 退避等待，MUST NOT 映射为 `web_args_invalid` 或
`web_provider_unconfigured`，也 MUST NOT 为「换个模式 / 换个 provider 试试」而重发请求。

Web 工具错误 SHALL 是 `ToolOutput{ok:false}`，不是 LLM `TurnError`，MUST NOT 设置 `Session.failed`
或新增错误行重试按钮。Web 分类 MUST NOT 复用 LLM 的 `FailureKind`，也不得把 LLM 集合中的 425 加入
Web 自动重试。工具内部重试只重发当前 HTTP 请求，MUST NOT 重放同批其它工具。

#### Scenario: 可重试状态有界退避

- **WHEN** mock DeepSeek 依次返回 429、503，随后成功；另一序列持续返回 500
- **THEN** 前者在第三次 attempt 成功且 attempts=3；后者三次后以 `web_http_error` 收尾，退避不超过
  合同上限，不重放同批其它工具

#### Scenario: 其它失败不自动重试

- **WHEN** 分别出现 HTTP 400 / 401 / 402 / 403 / 404 / 413 / 425、本地 timeout、取消，以及 200 后
  过大 / 坏 JSON / 空正文
- **THEN** 每类都按对应稳定 code 收尾且没有第二次 DeepSeek 请求；本地 timeout 与 200 后失败不得因
  「也许未计费」而重发

#### Scenario: 3xx 不跟随且只有一个错误码

- **WHEN** DeepSeek 分别返回 301 / 302 / 307 / 308 与带敏感目标的 Location
- **THEN** 每种都只归 `web_provider_protocol_error`，实际跳转请求为 0、Bearer 不泄漏，
  不得再同时映射为 `web_http_error`

#### Scenario: 取消不产生半截成功

- **WHEN** 工具在等待响应头、读取 body 或退避期间收到停止
- **THEN** 返回 `web_cancelled`、关闭响应且不再发新 attempt；已收部分 JSON 不进入成功结果，
  会话锁不被 HTTP 等待占用

#### Scenario: 不支持的模式不产生请求或退避

- **WHEN** 已解析 provider 不支持请求的 fetch mode
- **THEN** 直接以 `web_mode_unsupported` 收尾：`attempts=0`、零目标连接、零 provider 请求、
  无退避等待、无批准卡；不进入重试循环，也不改试另一模式或另一 provider


### Requirement: Web 真实 HTTP 验收装配边界

生产 Web provider SHALL 只有 official 装配：DeepSeek endpoint 来自官方常量，生产配置 MUST NOT 提供
endpoint 参数、loopback 白名单、代理开关或跳过 URL / DNS 校验的路径。生产 transport / resolver
SHALL 执行真实 HTTP 与系统 DNS，目标预检与 DeepSeek client 均显式 `no_proxy`。

隔离测试与真机验收 SHALL 使用独立测试 provider / transport 装配，同时复用生产同款参数校验、DNS
全集检查、地址固定、redirect、预算、重试与错误分类。只有测试 provider 构造器可接收合成 DeepSeek
endpoint；生产构造器 MUST NOT 接收该参数。合成 resolver SHALL 给 `target.test` 返回脚本化公网身份，
测试 connector SHALL 再把已验证公网 IP + 原 host 映射到本地监听地址，不得为验收全局放行 loopback。
HTTPS SHALL 使用只含 `target.test` 的测试 CA / 证书与隔离 trust store，不得关闭证书校验或挂载真实
浏览器凭据。

注入 SHALL 只能由隔离验收专用 build / 装配显式激活；普通 `config.json`、环境变量、真实 vault、
生产 `pnpm tauri dev` 与发布构建 MUST NOT 有激活入口。验收 SHALL 记录真实 HTTP method / path / body /
状态序列 / 请求次数 / 读取字节数；LLM mock 只驱动确定的工具调用，MUST NOT 用 fixture 声明的错误
替代这些 Web HTTP 证据。

验收装配 SHALL 能覆盖**当前活跃适配器**的 `fetch_modes`：生产 DeepSeek 恒声明 `[full]`，测试 provider
SHALL 声明 `[full, selected_chunks]`，覆盖只存在于隔离验收装配，生产构造器 MUST NOT 接受能力参数。
测试 provider SHALL 能按脚本返回 `content_scope` / `coverage`，至少覆盖 `full` + `unknown` 与
`selected_chunks` + `bounded` 两种形态。

隔离验收装配 SHALL 以**测试专用请求头**（仅 `acceptance-web` 构建编译，如
`X-Lumir-Test-Fetch-Mode` / `X-Lumir-Test-Fetch-Query`）把 `mode` 与选取 `query` 交给测试 provider；
真实 socket 记录 SHALL 断言这些请求头与 body，并证明生产 DeepSeek 的请求体仍只有 `url`、wire 上
MUST NOT 出现任何测试头或新的 body 字段。新增注入面与
`fetched_by` / `binding` / `final_url` 的赋值点 MUST 被 `web-production-check.sh` 的源码层与产物层
判据覆盖：赋值点仅允许出现在白名单文件（`output.rs` 字段声明、`provider.rs` 构造漏斗），白名单外
出现即红。

#### Scenario: 合成公网身份映射本地服务

- **WHEN** 隔离验收以 `target.test` 跑 search → fetch、redirect / DNS 与超时取消
- **THEN** 生产同款全集校验与地址固定先执行，测试 connector 才把已验证公网身份映射到本地监听；
  记录包含真实 HTTP 请求形状与次数，不是仅断言 mock fixture 被调用

#### Scenario: HTTPS 保留 Host / SNI 与证书校验

- **WHEN** 隔离验收以 HTTPS 访问 `target.test`
- **THEN** 仅信任测试 CA / 证书与隔离 trust store，原 Host / SNI 与证书链均被验证；不得关闭证书
  校验或以 HTTP 用例冒充 SNI 证据

#### Scenario: 生产不能激活测试旁路

- **WHEN** 普通配置 / 环境变量 / 真实 vault / 生产构建尝试提供合成 endpoint 或 loopback 映射
- **THEN** 没有激活入口，生产仍只使用官方 DeepSeek endpoint，URL / DNS 拒绝规则不变；
  测试装配不出现在发布构建里

#### Scenario: 多模式测试 provider 的请求与结果记录

- **WHEN** 隔离验收以测试 provider 分别执行 `full` 与 `selected_chunks`（后者带 query）的 Fetch
- **THEN** 真实 socket 记录显示两次请求都到达测试 provider；`selected_chunks` 的请求带
  `X-Lumir-Test-Fetch-Mode: selected_chunks` 与携带选取 query 的测试头，body 仍只有 `url`；
  前者产出 `full` + `unknown`，后者产出 `selected_chunks` + `bounded`，两者 `fetched_by=provider` /
  `binding=url_submitted`；记录不是仅断言 mock fixture 被调用

#### Scenario: 生产请求体不因模式扩字段

- **WHEN** 生产装配对 DeepSeek 执行 `mode=full` 的 Fetch
- **THEN** 请求体仍只有 `{"url": …}`；`mode` / `query` 只存在于本地参数与能力检查，MUST NOT 进入
  DeepSeek 请求 JSON

## ADDED Requirements

### Requirement: Web 抓取证据形态与归属

`web_fetch` 的结果 SHALL 能回答三个彼此独立的问题：这段正文是**文档提取**还是**按查询选出的相关
段落**（`content_scope`）；provider 是否**声明了自身截断**（`coverage`）；**抓取被交给了谁**、Lumir 对
「内容来自预检过的地址」能保证到哪一步（`fetched_by` / `binding` / `final_url`）。三者 MUST NOT 被
压成一个布尔值，也 MUST NOT 由正文文本长相（如是否含 `[...]` 分隔符）反推。

`mode` 的语义 SHALL 为：`full` = 不按查询选段的文档提取，**不是**「已验证完整」；`selected_chunks` =
按 query 选出的相关段落。`mode` 缺省 `full`。`query` 只在 `mode=selected_chunks` 时允许且必填，
1–256 Unicode 字符且不全为空白；`mode=full` 携带 `query` SHALL 返回 `web_args_invalid`。
`selected_chunks` 的批准 subject 仍是 origin，query 与 URL 一起发往 provider 的事实 SHALL 在批准
预览与「查看详情」可见。

每个 provider 适配器 SHALL 静态声明 `fetch_modes`（该 API 结构上能保证什么），MUST NOT 从响应内容
反推。能力检查 SHALL 读取**当前活跃适配器**的声明（生产 DeepSeek `[full]`；隔离验收装配的测试
provider `[full, selected_chunks]`，见「Web 真实 HTTP 验收装配边界」），MUST NOT 硬编码成一张与
活跃适配器无关的表。Fetch 的解析顺序 SHALL 为：参数形状与
`mode` / `query` 一致性 → URL 静态安全校验 → origin deny（deny 永远优先，先于能力检查）→
provider 解析 → 能力检查 → 可选批准 → 本地预检 → provider 请求。能力检查不通过 SHALL 返回
`web_mode_unsupported`：`provider` / `provider_id` 为已解析值，`attempts=0`、`local_precheck=false`、
五个抓取读数全为 null，零目标连接、零 provider 请求、不产生批准卡；`message` SHALL 写明当前
provider 支持的模式。系统 MUST NOT 暗换模式、MUST NOT 暗换 provider、MUST NOT 跨 provider 重试。

错误优先级 SHALL 为：参数形状与 URL 静态校验 > origin deny > provider 解析 > 能力检查。
`web_mode_unsupported` MUST NOT 掩盖前三类错误——被 deny 的调用仍是 `permission_denied`，静态非法
URL 仍是 `web_url_blocked` / `web_args_invalid`，无可用 provider 的调用仍是
`web_provider_unconfigured`。

结果字段 SHALL 为五个可空读数，键恒在场：

- `content_scope`：`"full"` | `"selected_chunks"` | null——正文形态；无正文时为 null。
- `coverage`：`"bounded"` | `"unknown"` | null——`bounded` = provider 明确声明其输出被自身上限截断；
  `unknown` = 无完整性信号。MUST NOT 收 `verified`：本阶段与已排期的阶段 2 / 3 都没有任何 provider
  提供「完整性已证明」的声明机制，收这个值等于给 UI 一个可以无条件说「已验证完整」的词。它与下文
  `local` / `address_pinned` 的区别在语义可达性：后者描述的是抓取路径本身的事实（阶段 2 的本地 GET
  会真实产出），前者是一种本阶段没有任何依据可以声称的证明。
- `fetched_by`：`"provider"` | `"local"` | null——本次调用把内容抓取**交给谁**（发起方，不是「是否
  收到字节」）：`provider` = 已向 provider 发起至少一次抓取请求（含传输层失败），`local` = Lumir
  自己发出内容 GET（阶段 2），null = 没有任何抓取被发起。Fetch 的判据可机器判定：
  `attempts>0` ⇒ `fetched_by=provider` 且 `binding=url_submitted`。
- `binding`：`"url_submitted"` | `"address_pinned"` | null——`url_submitted` = 本地预检过的 URL 提交给
  provider、Lumir 无法验证 provider 内部的 DNS / redirect / final URL；`address_pinned` = Lumir 自己
  发 GET 且连接只使用预检验证过的地址集。
- `final_url`：string | null——仅当 `binding=address_pinned` 时允许非 null；`url_submitted` 时
  MUST NOT 填，也 MUST NOT 拿 `source.url`（提交 URL）冒充最终 URL。

Search 的五个字段 SHALL 恒为 null：搜索结果不是抓取证据，MUST NOT 被标注为 `full` / `provider`。

本阶段（阶段 1）**生产路径**允许的**生产者** SHALL 只有四个值：`content_scope=full`（provider 文档
提取成功）、`coverage=unknown`（provider 无完整性信号）、`fetched_by=provider`、
`binding=url_submitted`；`selected_chunks` / `coverage=bounded` 只由「Web 真实 HTTP 验收装配边界」
一节的测试 provider 与构造信封的单测产出，不构成生产能力。`fetched_by=local` /
`binding=address_pinned` / 非空 `final_url` 在阶段 1
**无生产生产者**，MUST NOT 被任何生产路径产出——它们的第一个真实生产者是后续的本地受控 JSON 读取
change。枚举值先行声明是为了让阶段 2 / 3 复用同一词汇、不再改一次工具 schema；实现 MUST NOT 为
这些无生产者的值提供配置开关、UI 开关或能力声明，它们只能被类型层与呈现层当作可处理取值。

无生产者的取值 MUST 有**测试生产者 + 消费者功效断言**，仅声明枚举或只做序列化断言不满足：测试
SHALL 断言 `fetched_by=local` 不渲染 provider 外发文案、`binding=address_pinned` 与非空
`final_url` 在「查看详情」可见、闭集合外的取值归 null 且不渲染、`coverage=bounded` 的
「完整性受限」后缀真实出现。

五个抓取字段的赋值 SHALL 收敛到单一收口点（`FetchProvenance`）：失败由收口写
`provider_attempted()`（`attempts>0`，含 `execute_until` 的取消覆盖分支，此时 `content_scope` /
`coverage` / `final_url` 为 null）；成功 SHALL 保留当前活跃适配器已产出的成功 provenance——生产
DeepSeek 不自行产出、由收口补 `provider_full()`（`full` / `unknown`）；隔离验收装配的测试 provider
产出 `scripted(...)`，收口 MUST NOT 用 `provider_full()` 覆盖它。`local` / `address_pinned` /
非空 `final_url` MUST NOT 存在可达的生产赋值路径。

真值表 SHALL 为：

| `content_scope` | `coverage` | 含义 | 可否称「全文」 |
|---|---|---|---|
| `full` | `unknown` | provider 返回文档提取，未按查询选段；完整性无声明 | 否，只能表述为「提取内容，完整性未验证」 |
| `full` | `bounded` | provider 明确表示其输出被自身上限截断 | 否 |
| `selected_chunks` | `bounded` / `unknown` | 按查询选出的相关段落 | 否 |
| null | null | 没有抓取正文（失败 / 预检拒绝 / Search） | 不适用 |

`truncated` 是独立轴：`truncated=false` 只表示 Lumir 未按预算裁剪，**不等于**完整性已验证；
`truncated=true` 与 `coverage=bounded` 可同时为真。预算裁剪 MUST NOT 改写 `content_scope` /
`coverage` / `fetched_by` / `binding` / `final_url`。

失败与未发生抓取时五个字段 SHALL 按实际发生的事实置空，MUST NOT 互相推导：

| 路径 | `local_precheck` | `fetched_by` | `binding` | `attempts` | `content_scope` / `coverage` / `final_url` |
|---|---|---|---|---|---|
| 参数非法 / origin deny / provider 未配置 / 模式不支持 | false | null | null | 0 | null |
| 预检已执行且失败（含超时 / 取消） | true | null | null | 0 | null |
| 预检通过但 provider 请求前 deadline 用尽 | true | null | null | 0 | null |
| provider 已请求后失败 | true | `provider` | `url_submitted` | >0 | null |
| provider 请求成功 | true | `provider` | `url_submitted` | >0 | 按上表 |

失败归因 SHALL 分开：预检失败属目标侧或本地预检错误、`attempts=0`，MUST NOT 表述为「provider 抓取
失败」；预检通过但 provider 失败属 provider 侧、`attempts>0`，MUST NOT 反推目标站不可读。任何路径
MUST NOT 伪造 provider，MUST NOT 声称验证了 provider 内部 DNS / redirect。

`web_fetch` 的工具描述 SHALL 写明三件事：`mode=full` 是不按查询选段的文档提取、不是「已验证完整」，
`coverage` 为 `unknown` / `bounded` 时不得声称页面缺少某内容；`selected_chunks` 只在 provider 支持
时可用，不支持返回 `web_mode_unsupported` 且不会降级；`truncated=true` 只表示 Lumir 按预算裁剪，
不表示 provider 返回的内容本身不完整。

审计 SHALL 透传 `content_scope` / `coverage` / `fetched_by` / `binding` / `final_url`（MUST NOT
重算、MUST NOT 由 `local_precheck` / `attempts` 推导），并保留既有 `local_precheck` /
`provider_fetch` 事实字段。

#### Scenario: DeepSeek 成功结果的证据形态唯一

- **WHEN** DeepSeek Fetch 成功返回 Markdown（请求未带 `mode` 或 `mode=full`）
- **THEN** `content_scope=full`、`coverage=unknown`、`fetched_by=provider`、`binding=url_submitted`、
  `final_url=null`；即使正文里恰好出现 `[...]` 等分隔符，上述字段也不改变

#### Scenario: 本地预检失败不冒充 provider 抓取

- **WHEN** 本地预检因 DNS / 内容类型 / 超时失败，provider 请求从未发出
- **THEN** `local_precheck=true`、`fetched_by=null`、`binding=null`、`final_url=null`、
  `content_scope=null`、`coverage=null`、`attempts=0`；错误归因为目标侧或本地预检，
  MUST NOT 表述为「provider 抓取失败」

#### Scenario: provider 请求后失败保留抓取归属

- **WHEN** 预检通过、DeepSeek 已实际请求但返回 5xx / 空正文 / 协议错误
- **THEN** `local_precheck=true`、`fetched_by=provider`、`binding=url_submitted`、`attempts>0`，
  `content_scope` / `coverage` / `final_url` 为 null；不得反推目标站不可读

#### Scenario: provider 已请求后取消仍保留抓取归属

- **WHEN** provider 已发起 attempt，随后用户停止（取消覆盖分支替换错误码）
- **THEN** `attempts>0` 保持不变，`fetched_by=provider`、`binding=url_submitted`，
  `content_scope` / `coverage` / `final_url` 为 null；取消 MUST NOT 把抓取归属清空

#### Scenario: 能力错误不掩盖更早的拒绝

- **WHEN** 同一 `selected_chunks` 请求分别命中 origin deny、静态非法 URL、无可用 provider，以及
  「已解析 provider + `approval=ask`」四种前置状态
- **THEN** 前三种分别返回 `permission_denied`、`web_url_blocked` / `web_args_invalid`、
  `web_provider_unconfigured`，不得改写成 `web_mode_unsupported`；第四种返回
  `web_mode_unsupported`，不产生批准卡、`local_precheck=false`、零目标连接、零 provider 请求

#### Scenario: 截断与完整性是两个轴

- **WHEN** DeepSeek 成功返回 30,000 字符正文、`mode=full`
- **THEN** 正文被本地预算裁剪为 24,000 字符，`truncated=true`、`truncated_fields=["content"]`，
  `coverage` 仍为 `unknown`、`content_scope` 仍为 `full`；面板同时显示「已截断」与
  「完整性未验证」，MUST NOT 因截断而改写 `coverage`

#### Scenario: Search 不带抓取归属

- **WHEN** `web_search` 成功或失败（含 `need_content=true` 返回的 provider 附带正文）
- **THEN** 五个字段恒为 null；结果不得被标注为 `full` / `provider`，也不得据此声称抓取过结果页

#### Scenario: 生产 provider 不产出本地抓取值

- **WHEN** 以生产装配（无验收注入）执行任意 Fetch
- **THEN** `fetched_by` 只会是 `provider` 或 null，`binding` 只会是 `url_submitted` 或 null，
  `final_url` 恒为 null；生产路径 MUST NOT 存在 `local` / `address_pinned` / 非空 `final_url`
  的赋值入口。
