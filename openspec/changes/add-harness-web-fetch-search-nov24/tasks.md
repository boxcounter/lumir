# Tasks: add-harness-web-fetch-search-nov24

> 提案阶段全部未执行。节点 1 通过前不得勾选实现项，不得改产品代码或测试。

## 1. 合同、注册与 provider 解析

- [ ] 1.1 按 design §2 固化 `web_search` / `web_fetch` 输入 schema、`WebSource`、统一成功 / 失败信封、`trust`、`attempts`、`truncated` 与 `truncated_fields`；先写字段形状与反例测试
- [ ] 1.2 新增交互主会话的 `WEB_TOOL_NAMES`，把定义与执行接入同一注册 / 已知工具判据；保持 vault `TOOL_NAMES`、cron 白名单、内建 `general` 与子运行闭集合不变
- [ ] 1.3 更新工具描述与系统固定段：默认 search → fetch、网页为 untrusted data、curl 仅用于另行批准的特殊站点 / 非 HTML，不引入搜索别名
- [ ] 1.4 实现 design §3.1 的 provider 单一解析口：active DeepSeek 优先且不暗换；active 非 DeepSeek 时只接受唯一官方候选；Key / base URL 同出一条目，不消费模型清单
- [ ] 1.5 对无 Key、零 / 多候选、active / 非 active 自定义 base URL 返回 `web_provider_unconfigured`；断言零 HTTP、零 curl，且不拿自定义条目 Key 改投官方地址
- [ ] 1.6 固定官方 `/v1/tools/search` 与 `/v1/tools/fetch` 请求；Search 只发 query / count / need_content，Fetch 只发 url，不发 `ori_question` / `localization`

## 2. `web_read` 权限与批准预览

- [ ] 2.1 把两件 Web 工具排除出只读自动放行集合；按 D1 在三档模式下默认 Ask，保持 deny > 既有硬层 > allow > 模式 / 缓存的顺序
- [ ] 2.2 实现 Search 的完整 query subject 与工具级会话 / 持久规则，以及 Fetch 的规范化 origin subject 与 origin 级会话 / 持久规则；验证 deny 永远优先
- [ ] 2.3 扩展 `ApprovalPreview` 与事件 / 快照的单一 Web 载荷：完整 query / URL、origin、provider id、数据外发与计费说明；不得只依赖 80 字工具行摘要
- [ ] 2.4 批准卡记忆按钮明确显示「本会话后续网页搜索」或具体 origin；普通采纳不记忆，持久规则与缓存互不写对方
- [ ] 2.5 在批准预览前完成基础参数形状与 URL scheme / userinfo 校验，非法调用不生成携带凭据或无效目标的批准卡；证明 allow / 缓存只减少批准，不跳过执行期 DNS、重定向、内容类型、预算或密钥检查
- [ ] 2.6 **全量回扫既有验收场景里的权限 / 批准闸期望并逐条改准**，包括三档模式、full_access、allow / deny 与 curl；不得只新增 Web 场景

## 3. 统一输出、预算与错误映射

- [ ] 3.1 Search 映射 URL / title / snippet / summary / content / site / date / authority；Fetch 返回同一 `WebSource`，未知 date / authority 用 null，不伪造 final URL
- [ ] 3.2 Search 默认 `count=5`、本地允许 1–10、`need_content=false`；空 results 为成功空结果，Fetch 空 Markdown 为 `web_empty_content`
- [ ] 3.3 实现 title / snippet / summary / content / 聚合 / provider_message 的字符预算与 Search / Fetch 的 2 / 4 MiB 字节上限；超限 / 裁剪全部显式标记
- [ ] 3.4 聚合裁剪按 content → summary → snippet 顺序，结果只能整条移除；URL / date / authority / provider 不裁，JSON 始终完整
- [ ] 3.5 实现 design §7 的稳定错误分类；DeepSeek 404 统一 `web_http_error`，不凭状态码伪造 `web_unsupported_content`
- [ ] 3.6 原始 provider body 不直接回送；`provider_message` 脱敏限长，`http_status` / `provider_code` / `request_id` 仅真实存在时出现

## 4. 目标 URL、DNS 与重定向安全

- [ ] 4.1 先写 scheme / userinfo / host / 控制字符 / IP 变体反例，再实现 URL 解析；仅 HTTP(S)，长度 ≤8192，不修复成另一个 URL
- [ ] 4.2 对 DNS 全部 A / AAAA 执行全局单播判据；任一私网 / loopback / link-local / CGNAT / multicast / reserved / documentation / mapped 非全局地址即整条拒绝，DNS 失败 fail closed
- [ ] 4.3 把校验地址集与连接地址绑定，保留原 Host / TLS SNI；用公网 → 私网 rebinding 反例证明连接前没有第二次不受控解析
- [ ] 4.4 实现每 hop 10 秒、整链 30 秒、最多 5 跳的有界 HEAD / Range GET 预检；Range 被忽略时仍只读 4 KiB，预检正文不进入模型
- [ ] 4.5 每跳重新校验相对 / 绝对 Location；同源才继续，跨源在 DNS / 连接前返回 `web_redirect_requires_approval` 与完整 `redirect_url`
- [ ] 4.6 跨源 URL 经新 `web_fetch` 与新 origin 批准后才可继续；scheme downgrade、带凭据 Location、超过 5 跳均 fail closed
- [ ] 4.7 只接受 HTML / XHTML；明确非 HTML 与无法确认分别映射 `web_unsupported_content` / `web_content_type_unknown`，只提示可另选 curl而不自动调用
- [ ] 4.8 tools API 的 3xx 不跟随并归 `web_provider_protocol_error`；预检不携带 DeepSeek Key / Cookie / vault 内容 / 浏览器登录态
- [ ] 4.9 在代码与验收证据中明确区分本地预检保证与 DeepSeek 远端抓取信任边界；不得声称验证 provider 内部 DNS / redirect 或远端 final URL

## 5. 超时、取消与计费重试

- [ ] 5.1 实现预检 / Search / Fetch 各自 deadline、响应 body 读取上限与整次调用上限；DNS / connect 阻塞不通过 join 卡住取消
- [ ] 5.2 复用 `ctx.aborted()`，在发起前、退避、等头与读 body 时检查；取消后关闭响应、无新 attempt、无半截成功，且不持会话锁等待
- [ ] 5.3 只对 DeepSeek HTTP 408 / 429 / 5xx 做初次 + 最多两次重试；`Retry-After` 上限 2 秒，缺省退避 250ms / 1s，测试注入时钟
- [ ] 5.4 对其它 4xx（含 425）、本地 DNS / connect / TLS / timeout、取消、200 后过大 / 非 JSON / 坏 JSON / 空正文均只发一次或不发，attempts 精确
- [ ] 5.5 Web 错误保持 `ToolOutput`，不设置 `Session.failed`、不复用 LLM `FailureKind`、不把 425 混入 Web 分类、不新增错误行重试按钮
- [ ] 5.6 provider 已实际请求后的失败连同 attempts / status / provider / request id 进入同一工具结果与 panel / 后续 wire；不新增第二套 `llm_request` / `llm_response`

## 6. Untrusted content、wire 与历史恢复

- [ ] 6.1 所有网页字段只作为 JSON 数据进入 function output，不注入 system / AGENTS / 权限规则 / 批准理由 / provider 配置
- [ ] 6.2 用含「忽略指令 / 自动批准 / 执行 curl / 修改权限」的页面证明授权事实不变，后续写 / 危险工具仍进闸，不自动发起二次请求
- [ ] 6.3 Responses、Chat Completions、mock 三 client 都能回放 Search / Fetch 输出；多调用保持 call 项组在 output 项组之前
- [ ] 6.4 仅凭 JSONL 恢复 query / URL、来源、错误与 truncated 标记；恢复充分性不依赖 sidecar，旧文件不被改写
- [ ] 6.5 Web 成功或实际请求后失败 → 后续 LLM 失败 → 显式重试：messages 相同、Web HTTP 次数不增、结果不重复；后续新 Web 调用仍重新批准 / 校验
- [ ] 6.6 Web 工具内部重试只重发当前 HTTP 请求，不重放同批已执行工具；取消 / 中断不伪造未完成调用的成功输出

## 7. 自动化测试（先反例、后实现）

- [ ] 7.1 mock HTTP 断言真实 DeepSeek path / Bearer / JSON 字段与响应映射，不打真实计费 API；每个正向用例附一个能判红的错误形状
- [ ] 7.2 覆盖三档权限矩阵、deny / allow / cache、Search 工具级与 Fetch origin 级粒度、跨源重批准、curl 旧语义
- [ ] 7.3 覆盖 design §10.3 全部 SSRF / redirect / DNS 反例，含公私混合答案、rebinding、Host / SNI、跨源零连接与 API 3xx 不泄漏 Bearer
- [ ] 7.4 以唯一 canary 扫描日志、批准卡、panel、JSONL、wire、错误事件和测试输出，确认无 Key；query / URL 与外发说明仍完整可见
- [ ] 7.5 覆盖逐字段 / 聚合 / 错误截断、2 / 4 MiB、Content-Type、空正文、非 JSON / 坏 JSON / 缺字段；`truncated_fields` 必须精确
- [ ] 7.6 覆盖超时、读 body / 退避中取消、Retry-After、408 / 429 / 5xx 成功与耗尽、全部不重试边界与 attempts 计数
- [ ] 7.7 覆盖 search → fetch 链路、默认无正文需第二跳、统一引用字段、untrusted content 不改变权限
- [ ] 7.8 覆盖三 client wire / 历史恢复 / 显式重试，以及工具内部重试不重放其它工具
- [ ] 7.9 对安全与预算关键断言做反向验证：构造必须 FAIL 的输入并确认测试会红，再恢复正确实现；不得用「读不到 = 空」通过

## 8. 本地真机验收与文档

- [ ] 8.1 用本地合成 DeepSeek / 目标 HTTP 服务完成 search → fetch、审批、redirect / DNS、截断、超时取消与历史恢复；不依赖公网，测试端点只经测试装配注入
- [ ] 8.2 新增 / 更新 `scripts/acceptance` 场景与 `COVERAGE.md`，证据落主仓 `.local/acceptance/`；报告逐场景 PASS 计数，不写未验为已验
- [ ] 8.3 为批准卡的完整 query / URL、origin、provider 与外发说明补结构断言；动视觉面后跑本地 `gate.sh visual`，基线 `--update` 前先由 Alex 过目
- [ ] 8.4 运行 `bash scripts/gate.sh quick`；照抄最终 `GATE RESULT` 原文与退出码，视觉门禁另列，不把 SKIP 并入 PASS
- [ ] 8.5 运行 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、`bash scripts/docs-check.sh` 与指定 change 的 archive-check，确认 delta 无静默丢段
- [ ] 8.6 审查 diff 与信息卫生：只含批准的本 change 实现 / 测试 / 文档面，无真实 vault 内容、无 Key、无公网依赖、无 Tavily / Brave 适配器、无兼容别名
- [ ] 8.7 实现完成后逐条核对 tasks 与真实 PASS 证据；归档跟踪与节点 2 材料按流程另办，本提案任务不代表已获归档放行
