# Tasks: add-harness-web-fetch-search-nov24

> 历史：2026-11-24 的初始提交只含提案制品；D1 / D2 已由 Alex 批准。原提案期「不得提前实现」约束不描述后续实现提交。
>
> 当前：阶段1已落地输出合同、provider 解析、注册闭集合与 settings 后端写通道；阶段2已落地 Web 权限管线、Ask 结构化预览与设置 UI；阶段3已落地 URL / DNS、固定地址 transport、手动 redirect、预检与取消；阶段4已落地真实 DeepSeek provider / executor、attempt 与整次 deadline、重试、预算、默认无卡审计、三 client wire 与 JSONL 恢复。全量验收场景回扫、真机隔离验收与配置参考同步仍归阶段5。当前分支是**本地中间态，不能 merge 或 dogfood**。
>
> 勾选口径：只勾已完整完成项；部分完成在项内写明阶段归属，不用勾项掩盖未完成面。

## 1. 网页访问设置、注册与 provider 解析

- [x] 1.1 按 design §2 固化 `web_search` / `web_fetch` 输入 schema、`WebSource`、统一成功 / 失败信封、`trust`、`attempts`、`truncated` 与 `truncated_fields`；先写字段形状与反例测试
- [x] 1.2 新增 `harness.web_access.enabled`（缺省 true）与 `.approval`（缺省 `allow_all`，可选 `ask`）及「设置 → 自动化 → 网页访问」区；默认注册并直接执行，显式 false 才不注册、幻觉调用 `tool_unknown`、零网络请求
- [x] 1.3 设置快照 / patch / revision 覆盖两键，经既有 `settings_apply` 原子写通道在下一回合生效；恢复默认 / 页级还原 = 删键，关闭不删除 provider、origin deny 或历史，页级还原不顺带清空 deny。
- [x] 1.4 设置区复用 provider 单一解析口，显示实际 id / 未配置 / 歧义 / 自定义 base URL，并跳回模型接入对应条目；不显示 / 复制 Key，不建第二 provider 选择器
- [x] 1.5 新增交互主会话的 `WEB_TOOL_NAMES`，把定义与执行接入同一注册 / 已知工具判据；保持 vault `TOOL_NAMES`、cron 白名单、内建 `general` 与子运行闭集合不变
- [x] 1.6 更新工具描述与系统固定段：默认 search → fetch、网页为 untrusted data、默认 Allow 来自用户配置而非网页授权、curl 仅用于特殊站点 / 非 HTML，不引入搜索别名
- [x] 1.7 实现 design §3.1 的 provider 单一解析口：active DeepSeek 优先且不暗换；active 非 DeepSeek 时只接受唯一官方候选；Key / base URL 同出一条目，不消费模型清单
- [x] 1.8 对无 Key、零 / 多候选、active / 非 active 自定义 base URL 返回 `web_provider_unconfigured`；断言零 HTTP、零 curl，且不拿自定义条目 Key 改投官方地址
- [x] 1.9 固定官方 `/v1/tools/search` 与 `/v1/tools/fetch` 请求；Search 只发 query / count / need_content，Fetch 只发 url，不发 `ori_question` / `localization`
- [x] 1.10 局部校验 `web_access`：只有表 / 键缺失使用 enabled=true / allow_all；整表错形状、enabled 非布尔、approval 非字符串 / 未知枚举均为 `web_access_config_invalid`，安全读数 enabled=false / ask，不注册、零请求，不触发整文件回落
- [x] 1.11 用既有 provider / origin deny 反例证明非法配置不会变成 allow_all、不清 deny、不联网；显式合法值可修复，非法 patch 文件逐字节不变

## 2. `web_read` 默认 Allow、可选 Ask 与 origin deny

- [x] 2.1 两件 Web 工具不并入通用只读集合；`approval=allow_all` 在三种权限模式下默认直接执行，`ask` 才进批准闸，`enabled=false` 不注册，其它工具权限矩阵不变
- [x] 2.2 Web 判定保持 deny > 既有硬层 > `web_access.approval`；Web 不使用 allow 规则或会话缓存派生授权，不生成 Web 专用持久 allow / 免问动作，deny 永远优先
- [x] 2.3 Search 以完整 query 供审计与既有工具级 deny；Fetch 以规范化 origin 供 `web_fetch(origin)` deny 在初始调用与每跳 redirect 重判。
- [x] 2.4 默认无批准卡时，工具行与结果仍完整保留 query / URL、provider id、Lumir 预检 + DeepSeek 双路外发、费用与 `trust:"untrusted"`；不得只靠 80 字摘要。**阶段4已完成：done 事件带白名单审计投影，live 与 panel 恢复同形；`web_allow_all_finishes_without_approval_card`、`restored_web_panel_preserves_source_error_and_truncation_metadata` 与 `tests/unit/harness-web-stage4.test.ts` 覆盖，事件不携带 results / content。**
- [x] 2.5 仅在 `approval=ask` 时扩展 `ApprovalPreview` 与事件 / 快照的 Web 载荷：完整 query / URL、origin、provider id、双路外发与计费说明；不添加默认免问 / 持久 allow 动作
- [x] 2.6 基础参数形状与 URL scheme / userinfo 校验先于可选批准预览，非法调用不生成携带凭据或无效目标的批准卡；任何 approval 值都不跳过执行期安全校验
- [x] 2.7 网页访问区只读既有 `harness.permissions.deny` 中的 `web_fetch(origin)`，默认空；统一经 `settings_apply` patch 的 `add_origin` / `remove_origin` / `clear_origins` 操作 deny，与 Web 两键共用 snapshot / revision / 写锁，不另建 origin 表，不改 allow / 其它 deny / 非规范规则，权限表错形状不重置为空
- [x] 2.8 移除 / 清空只恢复当前 approval：默认 `allow_all` 下恢复允许，`ask` 下恢复 Ask；不得暗改 approval 或重写会话历史
- [x] 2.9 跨 origin redirect 不另开批准：每跳先校验 scheme / 凭据 / host / origin deny，未封禁才继续 DNS / 连接 / 内容类型校验；封禁目标零连接、零 DeepSeek
- [ ] 2.10 **全量回扫既有验收场景里的权限 / 批准闸期望并逐条改准**，包括 allow_all、ask、deny、三档模式与 curl；不得只新增 Web 场景。**全量场景回扫归阶段5，故本项不勾。**
- [x] 2.11 整块更新 settings「设置写通道」：snapshot 带 Web 状态与 origin deny，revision 覆盖 Web 两键与 allow / deny；同一写锁完成 revision → patch（含 deny）→ 重载校验 → 原子写，clear 只清规范 Fetch origin；clear 与 add / remove 互斥，同一规范 origin 不得同时 add / remove，不同 origin 可同 patch。**阶段1完成后端写通道与测试，阶段2已完成设置 UI 与页级还原。**
- [x] 2.12 增加独立 `DecisionReason::WebAccessPolicy{approval:"ask"}`，事件 / 快照同源，不显示 ModeDefault 或权限档释义；覆盖 full_access + ask、allow_all 无卡、deny 无卡

## 3. 统一输出、可空 provider、预算与错误映射

- [x] 3.1 Search 映射 URL / title / snippet / summary / content / site / date / authority；Fetch 返回同一 `WebSource`，未知 date / authority 用 null，不伪造 final URL
- [x] 3.2 `provider` / `provider_id` 仅解析成功时填实际值；无配置、歧义、解析前参数错误分别精确断言二者为 null 且 `attempts=0`，不伪造 `"deepseek"` 为配置 id
- [x] 3.3 title 始终为 string，Fetch 空标题固定 `""`；其它可空字段才用 null，并写字段形状反例
- [x] 3.4 Search 默认 `count=5`、本地允许 1–10、`need_content=false`；空 results 为成功空结果，Fetch 空 Markdown 为 `web_empty_content`
- [x] 3.5 实现 title / snippet / summary / content / 聚合 / provider_message 的字符预算与 Search / Fetch 的 2 / 4 MiB 字节上限；超限 / 裁剪全部显式标记
- [x] 3.6 聚合裁剪按 content → summary → snippet 顺序，结果只能整条移除；URL / date / authority / provider 不裁，JSON 始终完整
- [x] 3.7 实现 design §7 的稳定错误分类；301 / 302 / 307 / 308 不跟随并统一 `web_provider_protocol_error`，4xx / 5xx 才归 `web_http_error`
- [x] 3.8 原始 provider body 不直接回送；`provider_message` 脱敏限长，`http_status` / `provider_code` / `request_id` 仅真实存在时出现

## 4. 目标 URL、DNS、代理与重定向安全

- [x] 4.1 先写 scheme / userinfo / host / 控制字符 / IP 变体反例，再实现 URL 解析；仅 HTTP(S)，长度 ≤8192，不修复成另一个 URL
- [x] 4.2 对 DNS 全部 A / AAAA 执行全局单播判据；任一私网 / loopback / link-local / CGNAT / multicast / reserved / documentation / mapped 非全局地址即整条拒绝，DNS 失败 fail closed
- [x] 4.3 目标预检与 DeepSeek client 都显式 `no_proxy`；每个 hop 不得重新继承系统 / 手动代理，保持 `no_proxy + 已验证地址集 + 原 Host / SNI + 手动 redirect` 同一构造不变量。**阶段3完成目标预检；阶段4由 `redirects_and_proxy_do_not_receive_bearer_or_follow_location` 在 HTTP(S)_PROXY / ALL_PROXY 下单独证明 DeepSeek client 的 `no_proxy`、代理零请求。**
- [x] 4.4 把校验地址集与连接地址绑定，保留原 Host / TLS SNI；用公网 → 私网 rebinding 反例证明连接前没有第二次不受控解析
- [x] 4.5 用本地代理与目标双服务，在 HTTP(S)_PROXY / ALL_PROXY 下证明预检只到已验证目标、代理零请求；恢复系统代理的错误实现必须判红。**阶段3已覆盖 HTTP / HTTPS 目标；test-only 负向开关恢复系统代理后真实触达代理并判红。4.6 的 DeepSeek client 独立证明已由阶段4 provider 反例补齐。**
- [x] 4.6 DeepSeek client 单独证明 `no_proxy + 301 / 302 / 307 / 308 零跳转 + Bearer 不泄漏`，不与预检结果互相推定
- [x] 4.7 实现每 hop 10 秒、整链 30 秒、最多 5 跳的有界 HEAD / Range GET 预检；Range 被忽略时仍只读 4 KiB，预检正文不进入模型
- [x] 4.8 每跳重新校验相对 / 绝对 Location、scheme / 凭据 / host / origin deny；跨源未封禁不另开批准即可继续，封禁目标零连接、零 DeepSeek
- [x] 4.9 scheme downgrade、带凭据 Location、超过 5 跳均 fail closed；allow_all 不绕过任何一项
- [x] 4.10 只接受 HTML / XHTML；明确非 HTML 与无法确认分别映射 `web_unsupported_content` / `web_content_type_unknown`，只提示可另选 curl 而不自动调用
- [x] 4.11 预检不携带 DeepSeek Key / Cookie / vault 内容 / 浏览器登录态；在证据中区分本地预检保证与 DeepSeek 远端抓取信任边界，不伪造远端 final URL
- [x] 4.12 A → B 跨 origin 全部通过后，精确断言提交 DeepSeek 的 url 与 `source.url` 都是最后一个通过校验的 B URL，不拒绝跨源、不提交 A URL、不保留已退场的重定向输出字段。**阶段3断言预检接口的 `submitted_url` / `source_url`；阶段4由 `executor_preflights_redirect_and_submits_only_b_url_without_permission_changes` 断言真实 DeepSeek `/v1/tools/fetch` 请求体与 `source.url` 同为 B。**

## 5. 超时、取消与计费重试

- [x] 5.1 实现预检 / Search / Fetch 各自 deadline、响应 body 读取上限与整次调用上限；DNS / connect 阻塞不通过 join 卡住取消。**阶段3完成预检；阶段4由 `attempt_and_total_deadlines_fail_without_retry_or_partial_success` 与 `fetch_response_limit_is_four_mib_while_search_stays_two_mib` 覆盖 Search / Fetch 的 attempt deadline、整次 deadline 与 2 / 4 MiB 读取上限；阻塞工作单元由 `run_bounded` 超时不 join。**
- [x] 5.2 复用 `ctx.aborted()`，在发起前、退避、等头与读 body 时检查；取消后关闭响应、无新 attempt、无半截成功，且不持会话锁等待。**阶段3预检已覆盖；阶段4把同一拥有所有权的取消句柄穿过 `ToolContext`，`cancellation_during_headers_body_and_backoff_stops_without_new_attempt` 覆盖等头、读 body 与退避三处取消，发起前由 `web_cancelled_wins_over_unconfigured_provider` 覆盖。**
- [x] 5.3 只对 DeepSeek HTTP 408 / 429 / 5xx 做初次 + 最多两次重试；`Retry-After` 上限 2 秒，缺省退避 250ms / 1s，测试注入时钟
- [x] 5.4 对其它 4xx（含 425）、本地 DNS / connect / TLS / timeout、取消、200 后过大 / 非 JSON / 坏 JSON / 空正文均只发一次或不发，attempts 精确
- [x] 5.5 Web 错误保持 `ToolOutput`，不设置 `Session.failed`、不复用 LLM `FailureKind`、不把 425 混入 Web 分类、不新增错误行重试按钮
- [x] 5.6 provider 已实际请求后的失败连同 attempts / status / provider / request id 进入同一工具结果与 panel / 后续 wire；不新增第二套 `llm_request` / `llm_response`

## 6. Untrusted content、wire 与历史恢复

- [x] 6.1 所有网页字段只作为 JSON 数据进入 function output，不注入 system / AGENTS / 权限规则 / 批准理由 / provider 配置
- [ ] 6.2 用含「忽略指令 / 自动批准 / 执行 curl / 修改权限」的页面证明 approval 与 origin deny 不变，后续写 / 危险工具仍按原权限进闸，不自动发起二次请求。**阶段4已证明页面文本原样保留为 JSON、权限配置逐字节不变、API 只请求一次；后续写工具仍进闸依赖阶段5端到端装配，故本项不勾。**
- [x] 6.3 Responses、Chat Completions、mock 三 client 都能回放 Search / Fetch 输出；多调用保持 call 项组在 output 项组之前
- [x] 6.4 仅凭 JSONL 恢复 query / URL、来源、错误与 truncated 标记；恢复充分性不依赖 sidecar，旧文件不被改写
- [ ] 6.5 Web 成功或实际请求后失败 → 后续 LLM 失败 → 显式重试：messages 相同、Web HTTP 次数不增、结果不重复；后续新 Web 调用仍按当前 approval / deny 与全部硬校验执行。**阶段4已用 `retry_after_web_output_reuses_identical_input_without_replaying_tools` 证明重试逐字节复用失败 input、工具行不重复、不新增 LLM 请求；真实 provider 下的 Web HTTP 次数不增需阶段5注入装配，故本项不勾。**
- [ ] 6.6 Web 工具内部重试只重发当前 HTTP 请求，不重放同批已执行工具；取消 / 中断不伪造未完成调用的成功输出。**阶段4已证明单工具重试只新增当前 HTTP 请求（429 → 503 → 200，共 3 次）且取消不产生半截成功；同批多工具不重放需阶段5场景，故本项不勾。**

## 7. 自动化测试（先反例、后实现）

- [x] 7.1 mock HTTP 断言真实 DeepSeek path / Bearer / JSON 字段与响应映射，不打真实计费 API；每个正向用例附一个能判红的错误形状
- [x] 7.2 覆盖默认 enabled=true / allow_all、全局关闭、切换 Ask、provider 显示跳转、origin deny 新增 / 单项移除 / 全部清空与 revision；不写第二份 provider / origin 状态
- [ ] 7.3 覆盖三档权限模式下默认直接执行、Ask 可选、deny 恒优先、Web allow / 缓存不参与、跨源不另开批准但硬校验不变、curl 旧语义。**阶段2已覆盖权限矩阵，阶段3已覆盖跨源与预检硬校验；executor 端到端与 curl 全量场景回扫归后续，故本项不勾。**
- [x] 7.4 覆盖 design §10.3 全部 SSRF / redirect / DNS / 系统代理反例，含公私混合答案、rebinding、Host / SNI、跨源 deny 零连接、代理零请求与 API 3xx 不泄漏 Bearer
- [ ] 7.5 以唯一 canary 扫描日志、工具行、panel、JSONL、wire、错误事件和测试输出，确认无 Key；默认无批准卡时 query / URL、provider、费用与 untrusted 说明仍完整可见。**阶段4已扫描错误信封与审计投影（`request_id_provider_code_and_audit_projection_never_leak_the_key`），默认无卡可见性另由 turn / panel 测试覆盖；panel / JSONL / wire 全 surface 端到端扫描归阶段5，故本项不勾。**
- [x] 7.6 覆盖可空 provider 三类精确 JSON、Fetch 空标题、301 / 302 / 307 / 308 唯一错误码、逐字段 / 聚合 / 错误截断、2 / 4 MiB、Content-Type、空正文、非 JSON / 坏 JSON / 缺字段
- [x] 7.7 覆盖超时、读 body / 退避中取消、Retry-After、408 / 429 / 5xx 成功与耗尽、全部不重试边界与 attempts 计数
- [x] 7.8 覆盖 search → fetch 链路、默认无正文需第二跳、统一引用字段、untrusted content 不改变权限
- [ ] 7.9 覆盖三 client wire / 历史恢复 / 显式重试，以及工具内部重试不重放其它工具。**阶段4已覆盖三 client wire、JSONL 恢复与显式重试；「工具内部重试不重放其它工具」需同批多工具场景，归阶段5，故本项不勾。**
- [x] 7.10 对安全与预算关键断言做反向验证：构造必须 FAIL 的输入并确认测试会红，再恢复正确实现；不得用「读不到 = 空」通过
- [x] 7.11 覆盖 `web_access` 表 / enabled / approval 的缺失与非法矩阵：`web_access_config_invalid`、enabled=false / ask、零请求、provider / origin deny 不变；合法修复成功、非法 patch 文件不变
- [x] 7.12 两个同 revision 请求分别改 approval 与 origin deny：只有一笔成功，另一笔 `settings_revision_conflict`，revision 变化且文件不变；单项删除 / 全部清空保留 allow、其它 deny 与非规范规则，错形状权限表不被重置；clear+add / remove、同字面及 canonicalization 后相同的 add / remove 均返回 `settings_patch_invalid` 且文件 / revision 不变，不同 origin 的非规范输入可合法组合
- [x] 7.13 覆盖 `full_access + approval=ask` 的独立 `WebAccessPolicy` 依据，断言不是 ModeDefault；allow_all 与 deny 不产卡

## 8. 隔离真机验收与文档

- [x] 8.1 按 design §9.1 建立独立测试 provider / transport：生产构造器只有 official endpoint；测试 provider 才能接收合成 DeepSeek endpoint，生产配置 / 环境变量 / 发布构建无此入口。**阶段3完成独立测试 transport；阶段4补 `DeepSeekWebProvider::with_endpoint_for_test`（`#[cfg(test)]`）与 `production_official_constructor_has_no_custom_endpoint`，生产装配仍只有 `official`。**
- [x] 8.2 用合成 resolver 给 `target.test` 脚本化公网身份，再由测试 connector 把已验证公网 IP + 原 host 映射本地监听；生产同款全集校验 / 地址固定仍执行，不为验收全局放行 loopback
- [x] 8.3 用仅含 `target.test` 的测试 CA / 证书与隔离 trust store 验证 HTTPS Host / SNI，不关闭证书校验、不挂真实浏览器凭据；HTTP 用例不冒充 SNI 证据
- [ ] 8.4 本地合成 DeepSeek / 目标服务记录真实 HTTP method / path / body / 状态序列 / 请求次数 / 读取字节数，完成 search → fetch、allow_all / ask / deny、redirect / DNS、代理、截断、超时取消与恢复；LLM mock 只驱动调用，不替代 Web HTTP 证据。**阶段4已用单元级合成 HTTP 覆盖 search → fetch、2 / 4 MiB、截断、超时取消、A → B 与代理；allow_all / ask / deny 与恢复走 turn 层 mock port，不是同一条真实 HTTP 链路；整链真机证据归阶段5。**
- [ ] 8.5 反向断言普通 config、真实 vault、生产 `pnpm tauri dev` 与发布构建不能激活注入，生产仍 official endpoint only 且 URL / DNS 拒绝规则不变。**阶段3注入仅存在于 `#[cfg(test)]`，非 test lib check 已通过；真实 vault、生产 dev / 发布构建的反向验收归后续，故本项不勾。**
- [ ] 8.6 新增 / 更新 `scripts/acceptance` 场景与 `COVERAGE.md`，证据落主仓 `.local/acceptance/`；报告逐场景 PASS 计数，不写未验为已验
- [ ] 8.7 为网页访问设置区、默认无卡审计与可选 Ask 预览的完整 query / URL、origin、provider、费用 / 外发说明、deny 单项 / 清空补结构断言；动视觉面后跑本地 `gate.sh visual`，基线 `--update` 前先由 Alex 过目。**阶段2设置与 Ask 结构目标已完成；阶段4补默认无卡审计的投影与渲染接线（前端单测覆盖投影，DOM 结构断言与完整 visual、基线过目归阶段5），故本项不勾。**
- [x] 8.8 运行 `bash scripts/gate.sh quick`；照抄最终 `GATE RESULT` 原文与退出码，视觉门禁另列，不把 SKIP 并入 PASS。**阶段4 复跑：`GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0。**
- [ ] 8.9 同步 `docs/specs/config-reference.md` 的 `harness.web_access.enabled` / `.approval` 字段面、缺失默认与显式非法 fail-closed 语义，以及 settings / deny revision 生效时机；保持行为真源在本 change 的 harness / settings delta，不复制 provider 或 origin 状态
- [x] 8.10 运行 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、`bash scripts/docs-check.sh` 与指定 change 的 archive-check，确认 delta 无静默丢段
- [x] 8.11 审查 diff 与信息卫生：只含批准的本 change 实现 / 测试 / 文档面，无真实 vault 内容、无真实 API Key、无公网依赖、无 Tavily / Brave 适配器、无兼容别名；唯一入库私钥是 `target.test` 合成 TLS fixture，CA 私钥不留存
- [x] 8.12 实现完成后逐条核对 tasks 与真实 PASS 证据；归档跟踪与节点 2 材料按流程另办，本提案任务不代表已获归档放行

## 9. 阶段4主评审返修（2026-11-25，本地中间态）

- [x] 9.1 ask 批准后的 done 在已决行之后渲染完整 Web 审计；恢复路径同形；allow_all 回归。DOM 单测 `tests/unit/harness-web-audit-visibility.test.ts`（红档 `stage4-rework/red-frontend-audit-visibility.log`）
- [x] 9.2 所有 Web `message` / `provider_message` / `request_id` / `provider_code` 按 1,000 字符限长并进 `truncated_fields`；preflight 失败路径同口径。反例 `executor_preflight_failure_message_is_budgeted_and_marked`、`request_id_provider_code_and_provider_message_each_stay_within_budget`
- [x] 9.3 重试耗尽的 `message` 如实写「初次 + 重试」，单次不可重试才写「未自动重试」。反例 `retry_exhaustion_names_the_initial_request_and_retries_without_claiming_no_retry`
- [x] 9.4 Fetch 的本地预检与 provider 共享 ≤150 秒总 deadline（Search ≤100 秒）；耗尽后不再发 provider 请求。反例 `executor_total_deadline_includes_preflight_and_never_reaches_provider_after_expiry`
- [x] 9.5 `local_precheck` 按「实际是否执行预检」记录（预览仍表达「将要」），`provider_fetch` 按 attempts 记录；allow_all / ask / deny / 未配置矩阵。反例 `web_done_audit_local_precheck_and_provider_fetch_follow_actual_facts`、`audit_metadata_records_actual_preflight_and_provider_reach_instead_of_operation`
- [x] 9.6 无 running 行的乱序 done 保持「工具行 → 审计」顺序。DOM 单测同上
- [x] 9.7 DeepSeek client 代理测试补正向基线与 no_proxy 红档（`red-no-proxy.log`）；`preflight_tests` / `provider_tests` 的环境变量锁合并为同一把
- [x] 9.8 `Retry-After` 支持 delta-seconds 与 RFC 2822 / IMF-fixdate HTTP-date（复用既有 chrono，不新增依赖），obsolete RFC 850 / asctime 按缺失回落；有界测试 `retry_after_http_date_is_parsed_and_bounded_while_obsolete_forms_fall_back`
