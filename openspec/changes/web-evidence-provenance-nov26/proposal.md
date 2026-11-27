# Proposal: Web 抓取结果的证据形态与抓取归属（Web 阶段 1）

- Change ID: `web-evidence-provenance-nov26`
- 日期: 2026-11-27
- 角色: Alex Lee（裁决 / 需求），AI agent（起草）
- 设计材料: `.local/reviews/web-fetch-api-provider-proposal.md`（阶段 1 合同在 §3；本提案的事实断言
  均已按当前 master `0018f0a39` 的代码与 living spec 复核，未沿用材料里的旧行号）

> 评审记录
> 节点 1（提案评审）：**推进指令已给出；D1 / D2 两项裁决面未逐条确认**（2026-11-27）。
> Alex 原话（会话指令）：「继续推进 Web Fetch/API 与多 provider 架构中已明确且可验收的下一步」，
> 本任务按设计材料的推荐执行**阶段 1**。该指令批准的是「推进阶段 1 这件事」与材料 §7 的推荐
> 顺序，**不是**材料 §8 标注「必须 Alex 裁」的 D1（`mode` 命名用 `full` 还是 `document`）与 D2
> （是否现在暴露 `selected_chunks`）的逐条选择。本提案按材料的推荐值起草（`full`；现在暴露、
> 失败关闭），两者作为**待确认的默认值**在 [design.md](design.md) §8 给出改判后的裁剪路径；
> 若任一被改判，改动面限于一个枚举名或一条模式的暴露，不影响其余合同。
> 证据状态：本节 MUST NOT 被读作「D1 / D2 已批准」，也不构成无条件的节点 1 通过——若流程要求
> 独立评审通过后才记批准，当前状态是「待独立评审 + D1 / D2 确认」。
>
> 批准范围（已被上述指令覆盖的部分）：阶段 1 的边界——`web_fetch` 增加
> `mode`（`full` | `selected_chunks`，缺省 `full`）与配套 `query`；信封新增
> `content_scope` / `coverage` / `fetched_by` / `binding` / `final_url` 五个可空读数；DeepSeek
> 只声明 `full`；不支持的模式失败关闭（零目标连接、零 provider 请求、无批准卡、不降级）；
> 不新增 provider、不改配置面、不改价格、不做 `answer`、不做 `web_api`。

> 节点 2（归档放行）：**未开始**。本 change 目前只有提案制品，没有实现、没有实现期证据；
> 归档前按 `docs/process/openspec-workflow.md` 的五要件在此追加记录，不提前书写。

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
5. **测试 provider 装配边界**（ADDED「Web 测试 provider 装配边界」）：一个只在
   `acceptance-web` feature + `LUMIR_ACCEPTANCE_WEB_ENDPOINTS` 下可注入的合成 provider，声明
   `[full, selected_chunks]` 并按脚本返回 `content_scope` / `coverage`；生产构造器 MUST NOT 接受；
   `scripts/acceptance/web-production-check.sh` 的源码层与产物层判据须覆盖新注入面。

不新增 capability：全部落在既有 `harness` capability 的 Web requirements 上。

## Non-goals

- **不新增生产 provider、不改 provider 解析、不改配置面**：`resolve_web_provider` 的「只认 DeepSeek
  条目」规则不变；不引入 `web_access.providers` / 槽位 / 密钥编辑（那是阶段 3）。测试 / 验收装配的
  合成 provider 只存在于 `acceptance-web` feature 下，见 What Changes 第 5 条，不构成生产能力。
- **不改价格**：`cost_per_1000_success_cny` 仍是 `5`；本阶段不引入可空价格。
- **不做 `answer` 模式**：生成式答案不是证据形态，不进入 `content_scope` 枚举，也不与正文混在
  同一 `content` 字段。
- **不做 `web_api` / 本地受控 JSON GET**（阶段 2）：本阶段 `fetched_by=local` /
  `binding=address_pinned` 零生产者，MUST NOT 被生产路径产出。
- **不做完整性校验**：不二次抓取、不比对长度、不猜 provider 是否截断；`coverage` 不收
  `verified` 一类「看起来能证明完整」的值。
- **不改 Search 的 `need_content` 语义**，也不给 Search 结果标抓取形态：Search 五个字段恒 null。
- **不改 `content_format` 枚举**：它表达序列化格式（当前只有 Markdown），不是证据形态。
- **不新增 Web 工具**：`WEB_TOOL_NAMES` 仍是 2 件，不触发 ADR 0007 的清单外扩张。
- **不做跨 provider fallback**：失败即失败，不换 provider 再试。

## Impact

- **影响的 specs**：`harness`（3 条 MODIFIED + 2 条 ADDED，见 `specs/harness/spec.md`）。
- **影响的代码 / 系统**：`src-tauri/src/harness/web/{output,mod,executor,provider,budget,acceptance}.rs`
  的字段、schema、能力声明与信封构造；`src/bindings/**` 的 ts-rs 重导出；`src/harness-panel.ts` /
  `src/web-audit.ts` / `src/copy-data.ts` 与文案 deck 的徽标、详情行与外发文案；`tests/unit` 的
  面板解析测试；`scripts/acceptance` 新增真机场景与生产反向断言。
- **关联约束**：ADR 0004（AI-only 开发，本提案即意图层）；`openspec/project.md` 的「配置即数据」
  与「不改写源文件」不在本 change 的面上；工具清单不变，不触发 ADR 0007。
- **修订记录（对设计材料的偏差，详见 design §7）**：材料 §3.4「预计」只改两条 requirement，但
  `web_mode_unsupported` 的稳定错误码清单住在「Web 请求可靠性与计费边界」条里，不改那一条会让
  规格自相矛盾，故本提案 MODIFIED 三条；材料 §3.5 #8「工具描述中英各一条」与当前代码不符
  （工具描述是中文单语硬编码），改为只要求中文一条；材料未定义 `coverage=bounded` 的徽标文案，
  本提案补 ` · 完整性受限`。
