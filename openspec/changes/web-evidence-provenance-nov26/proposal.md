# Proposal: Web 抓取结果的证据形态与抓取归属（Web 阶段 1）

- Change ID: `web-evidence-provenance-nov26`
- 日期: 2026-11-27
- 角色: Alex Lee（裁决 / 需求），AI agent（起草）
- 设计材料: `.local/reviews/web-fetch-api-provider-proposal.md`（阶段 1 合同在 §3；本提案的事实断言
  均已按当前 master `0018f0a39` 的代码与 living spec 复核，未沿用材料里的旧行号）

> 评审记录
> 节点 1（提案评审）：**通过**（2026-11-27）。批准依据是 Alex 的推进授权：会话指令「继续推进
> Web Fetch/API 与多 provider 架构中已明确且可验收的下一步」，并明确选择阶段 1 的推荐值
> **D1=`full`、D2=现在暴露 `selected_chunks`**。二者因此不再是待裁产品问题，也不构成节点 1 的
> 阻塞项；D3（缺省 `full`）/ D4（只用字段 + 工具描述）按材料「实现期可自定」执行。实现期不得
> 借这两项扩展任何其他范围。
>
> 独立评审（K3）结论为 needs-changes，**不构成本节批准**：它的作用是收口实施级断链（P1 四项、
> P2 四项），并确认「阶段 1 的范围可以保留：`full` + 现在暴露 `selected_chunks`，不新增生产
> provider、配置面或 `web_api`」。r1 修订按该结论逐项落实（见 tasks 与 design §13 的对照），
> 关闭以复核结论为准。
>
> 批准范围：阶段 1 的边界——`web_fetch` 增加
> `mode`（`full` | `selected_chunks`，缺省 `full`）与配套 `query`；信封新增
> `content_scope` / `coverage` / `fetched_by` / `binding` / `final_url` 五个可空读数；DeepSeek
> 只声明 `full`；不支持的模式失败关闭（零目标连接、零 provider 请求、无批准卡、不降级）；
> 不新增生产 provider、不改配置面、不改价格、不做 `answer`、不做 `web_api`。
> 评审修订（r1 / r2，2026-11-27）：按 needs-changes 的 P1 / P2 逐项收口，行为边界不变；r2 只修
> 「成功收口保留测试 provider 的 scripted provenance」与「Ask 预览 DOM 断言」两处。

> 节点 2（归档放行，2026-11-27）：**五要件齐，机器 + 独立评审放行**（`docs/process/openspec-workflow.md`）。
> 1. **方案已批准**：节点 1 依据 Alex 推进指令与 D1=`full` / D2=现在暴露的明确选择；实现期无静默
>    扩 scope（r3 后仅一处 test-only 收窄：886 的负断言 `相关段落` → `相关段落 ·`）。
> 2. **独立 reviewer clean / merge**：K3 结论 clean/merge，绑 `21b6da72`（rebase 前 tip；rebase 到
>    `2e6d5e17` 后同内容为 `9cb6200a`）。其后的 `a3f49ad2`（rebase 后 `d065e6d8`）只改 886 场景的
>    负断言（test-only，无产品代码）；按主会话归档指令接受为最终 tip，本节不声称重新评审。
> 3. **tasks 完成**：56/58 已勾；剩余 9.7 / 9.8 即本次归档与归档后审计动作，完成后在归档目录勾选。
> 4. **门禁与真机证据**（证据落 `.local/`，不落 worktree）：
>    - `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）` exit 0（当前 tip `d065e6d8`；
>      期间 `link-suggest` 的 16ms 性能断言在宿主负载下偶发，三次单跑与最终 quick 均全绿）。
>    - 完整 visual：`bcc0faa2` 上 `GATE RESULT: 15/15 PASS（SKIP 0）` exit 0（主会话读数）；其后仅
>      两处 test-only 变化，无产品代码与视觉基线改动。
>    - 真机：r1 8 场景 7 PASS / 1 FAIL（886 因 mock 文案「用相关段落模式」误命中负断言，886b PASS），
>      收窄为实际徽标 `相关段落 ·` 后 r2 **886 PASS 14 断言**；
>      `.local/acceptance/2026-11-27-web-evidence-provenance/`（r1）、`…-r2/`（886 复跑）。
>    - Rust 单测 1296 / `web_acceptance` 16（含测试专用 header 的真实 socket 证据）/ TS 2156 /
>      `web-production-check.sh` 3 项 PASS。
> 5. **规格对账（归档前读数）**：`openspec-archive-check.mjs` 门禁模式 PASS（9 份 delta / 11 条
>    MODIFIED / 171 段 / 无静默丢段）；`validate --all --strict` 39 passed / 0 failed；归档跟踪
>    队列有且仅有一条本 change 条目。

## Why

### 现状：结果信封无法表达三件事

Lumir 今天有两件 Web 工具、一个 provider、一种内容格式。安全管线是完整的，但模型与用户拿到
Fetch 结果时无法区分三件事：

| 缺口 | 现状（master `0018f0a39`） | 后果 |
|---|---|---|
| 证据形态 | `WebEnvelope` 只有 `truncated` / `truncated_fields`；`WebContentFormat` 只有 `Markdown`（`src-tauri/src/harness/web/output.rs:4-10`、`:135-175`） | 「按查询选出的相关段落」可以冒充「文档提取」，下游无从判断 |
| 完整性信号 | DeepSeek Fetch 只取 `title` / `content`（`src-tauri/src/harness/web/provider.rs:671-686`），不返回任何截断或完整性标记 | 「Lumir 没裁剪」被读成「页面完整」 |
| 抓取归属 | `local_precheck` 只回答「预检是否实际执行过」（living spec「统一 Web 搜索与抓取工具」条，`openspec/specs/harness/spec.md:4500-4502`）；provider 不返回远端 final URL | 本地预检被读成「远端已验证」；面板今天用 `local_precheck && provider_fetch` 推导外发文案（`src/harness-panel.ts:1080-1087`），一旦出现本地 GET 就会失真 |

living spec 已经有原则：`openspec/specs/harness/spec.md:4742-4745` 写明「本地预检可验证自己的
DNS / redirect / 内容类型，但 DeepSeek 不返回远端 final URL … 系统 MUST NOT 声称验证 provider
内部 DNS / redirect」。**原则已在，信封没有字段承载它**；面板于是只能靠两个布尔值猜，
这正是 REVIEW.md「值或开关声明了却没有消费者」条要防的「看着有、实际判不了」形态。

### 为什么先做阶段 1

材料 §0 / §7 的排序理由，按当前代码复核后仍然成立：

1. 阶段 1 不新增网络路径、不新增 provider、不动配置面与价格，风险最低。
2. 阶段 2（本地受控 JSON GET）与阶段 3（provider 能力矩阵）都要消费本阶段定义的字段词汇；
   先做阶段 1 可以避免后面反复改工具 schema 与结果形状。
3. 它直接消灭两类最危险的语义错误：片段冒充全文、预检冒充远端验证。

### 用户价值

1. 模型与用户能看到「文档提取」还是「按查询选出的相关段落」，不再把片段当全文。
2. 能看到 provider 是否声明了完整性，不再把「Lumir 没截断」当「页面完整」。
3. 能看到谁实际抓的、Lumir 验证到哪一步，不再把本地预检说成远端验证。
4. 为阶段 2 / 3 提供稳定字段词汇，避免后面反复改工具 schema 与结果形状。

## What Changes

1. **`web_fetch` 输入扩两个可选参数**（MODIFIED「统一 Web 搜索与抓取工具」）：`mode`
   （`full` | `selected_chunks`，缺省 `full`）与 `query`（1–256 Unicode 字符且不全为空白；仅
   `selected_chunks` 允许且必填，`full` 携带 → `web_args_invalid`）。schema 仍
   `additionalProperties:false`，仍不暴露 key / provider / base URL / 超时 / 重试 / header。
2. **统一信封加五个可空读数**（MODIFIED 同上 + ADDED「Web 抓取证据形态与归属」）：`content_scope`
   / `coverage` / `fetched_by` / `binding` / `final_url`，键恒在场、无信息为 null；Search 侧恒 null。
   真值表、失败矩阵与「`truncated` 是独立轴」的规则由 ADDED 条承载。
3. **能力检查与失败关闭**（MODIFIED「统一 Web 搜索与抓取工具」「Web 访问策略与 origin 例外」
   「Web 请求可靠性与计费边界」）：provider 适配器静态声明 `fetch_modes`，DeepSeek 只声明
   `[full]`；解析顺序为 参数 → URL 静态安全 → origin deny → provider 解析 → **能力检查** →
   可选批准 → 本地预检 → provider 请求；不通过返回新稳定错误码 `web_mode_unsupported`
   （`attempts=0`、`local_precheck=false`、零目标连接、零 provider 请求、无批准卡、不重试、
   不换模式、不换 provider）。
4. **面板与审计如实呈现**（MODIFIED「统一 Web 搜索与抓取工具」「Web 访问策略与 origin 例外」）：
   Fetch 成功加第二行证据徽标（`文档提取 · 完整性未验证` / `相关段落`，可追加
   ` · 完整性受限` / ` · 已截断`；禁止「全文」措辞）；「查看详情」扩五个字段与 Fetch 的
   `mode` / `query`；外发文案改由 `fetched_by=provider` 判定；live 与恢复同形，旧留存缺字段
   不显示、不伪造；审计只透传、不重算。
5. **验收装配与多模式测试 provider**（MODIFIED「Web 真实 HTTP 验收装配边界」，不新增近义
   requirement）：只在 `acceptance-web` feature + `LUMIR_ACCEPTANCE_WEB_ENDPOINTS` 下可注入的合成
   provider，能力声明覆盖为 `[full, selected_chunks]` 并按脚本返回 `content_scope` / `coverage`；
   真实 HTTP 记录须证明 URL 与 query 都到达测试 provider，且生产 DeepSeek 请求体仍只有 `url`；
   生产构造器 MUST NOT 接受；`scripts/acceptance/web-production-check.sh` 的源码层与产物层判据
   覆盖新注入面。

不新增 capability：全部落在既有 `harness` capability 的 Web requirements 上（4 条 MODIFIED +
1 条 ADDED）。

## Non-goals

- **不新增生产 provider、不改 provider 解析、不改配置面**：`resolve_web_provider` 的「只认 DeepSeek
  条目」规则不变；不引入 `web_access.providers` / 槽位 / 密钥编辑（那是阶段 3）。测试 / 验收装配的
  合成 provider 只存在于 `acceptance-web` feature 下，见 What Changes 第 5 条，不构成生产能力。
- **不改价格**：`cost_per_1000_success_cny` 仍是 `5`；本阶段不引入可空价格。
- **不做 `answer` 模式**：生成式答案不是证据形态，不进入 `content_scope` 枚举，也不与正文混在
  同一 `content` 字段。
- **不做 `web_api` / 本地受控 JSON GET**（阶段 2）：本阶段 `fetched_by=local` /
  `binding=address_pinned` 无生产生产者（由测试构造并断言消费者行为），MUST NOT 被生产路径产出。
- **不做完整性校验**：不二次抓取、不比对长度、不猜 provider 是否截断；`coverage` 不收
  `verified` 一类「看起来能证明完整」的值。
- **不改 Search 的 `need_content` 语义**，也不给 Search 结果标抓取形态：Search 五个字段恒 null。
- **不改 `content_format` 枚举**：它表达序列化格式（当前只有 Markdown），不是证据形态。
- **不新增 Web 工具**：`WEB_TOOL_NAMES` 仍是 2 件，不触发 ADR 0007 的清单外扩张。
- **不做跨 provider fallback**：失败即失败，不换 provider 再试。

## Impact

- **影响的 specs**：`harness`（4 条 MODIFIED + 1 条 ADDED，见 `specs/harness/spec.md`）。
- **影响的代码 / 系统**：`src-tauri/src/harness/web/{output,mod,executor,provider,budget,acceptance}.rs`
  的字段、schema、能力声明与信封构造；`src/bindings/**` 的 ts-rs 重导出；`src/harness-panel.ts` /
  `src/web-audit.ts` / `src/copy-data.ts` 与文案 deck 的徽标、详情行与外发文案；`tests/unit` 的
  面板解析测试；`scripts/acceptance` 新增真机场景与生产反向断言。
- **关联约束**：ADR 0004（AI-only 开发，本提案即意图层）；`openspec/project.md` 的「配置即数据」
  与「不改写源文件」不在本 change 的面上；工具清单不变，不触发 ADR 0007。
- **修订记录（对设计材料的偏差，详见 design §7）**：材料 §3.4「预计」只改两条 requirement，实际
  MODIFIED 四条——`web_mode_unsupported` 的稳定错误码清单住在「Web 请求可靠性与计费边界」条里，
  不改会自相矛盾；「Web 真实 HTTP 验收装配边界」必须整条替换而不是再加一条近义 ADDED
  （REVIEW.md「同一语义两处真源」条）。材料 §3.5 #8「工具描述中英各一条」与当前代码不符
  （工具描述是中文单语硬编码），改为只要求中文一条；材料未定义 `coverage=bounded` 的徽标文案，
  本提案补 ` · 完整性受限`。
