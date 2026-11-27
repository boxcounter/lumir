# Design: Web 抓取证据形态与归属（阶段 1）

- Change: `web-evidence-provenance-nov26`
- 基线：master `0018f0a39`（2026-11-27）。本文所有代码行号按该基线核对，未沿用设计材料的旧行号。
- 设计材料：`.local/reviews/web-fetch-api-provider-proposal.md` §3；与材料的偏差集中在 §7。

## 1. 事实基线

| 事实 | 位置（当前基线） |
|---|---|
| 只有两件 Web 工具；`web_fetch` schema 仅 `url`、`additionalProperties:false` | `src-tauri/src/harness/web/mod.rs:27`、`:46-58` |
| 统一信封无证据形态 / 完整性 / 抓取者 / 绑定字段 | `src-tauri/src/harness/web/output.rs:135-175` |
| `content_format` 枚举只有 `Markdown` | `output.rs:4-10` |
| 预检由 executor 调用，进入 executor 即 `local_precheck=true` | `src-tauri/src/harness/web/executor.rs:94-116` |
| DeepSeek Fetch 响应只取 `title` / `content`；请求 body 只有 `url` | `src-tauri/src/harness/web/provider.rs:671-686`、`:396-408` |
| provider 解析只认 DeepSeek 条目，自定义 base URL fail closed | `src-tauri/src/harness/web/config.rs:150-201` |
| Fetch 正文预算 24,000 字符，裁剪只动 `content` | `src-tauri/src/harness/web/budget.rs:88-105` |
| 面板用 `local_precheck && provider_fetch` 推导 Fetch 外发文案 | `src/harness-panel.ts:1080-1087` |
| 面板健康行只服务 Search（`webHealthText`） | `src/harness-panel.ts:1106-1117` |
| 审计解析要求 `cost_per_1000_success_cny === 5` | `src/web-audit.ts:36` |
| 外发 / 费用文案写死 DeepSeek 与 5 元 | `src/copy-data.ts:2959-2966`（D1021 / D1022） |
| `web::precheck` 在权限判定之前；`approval_preview` 只在 Ask 分支、deny 之后 | `src-tauri/src/harness/turn.rs:1805`、`:1993-1997` |
| 验收注入面只在 `acceptance-web` feature；生产反向断言已有脚本 | `src-tauri/src/harness/web/acceptance.rs`、`scripts/acceptance/web-production-check.sh` |

## 2. 数据形状

### 2.1 新枚举（Rust，ts-rs 导出）

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum WebFetchMode { Full, SelectedChunks }      // 请求意图

pub enum WebContentScope { Full, SelectedChunks }    // 结果形态
pub enum WebCoverage { Unknown, Bounded }
pub enum WebFetchedBy { Provider, Local }
pub enum WebBinding { UrlSubmitted, AddressPinned }
```

**为什么 `mode` 与 `content_scope` 是两个枚举**：它们的值在阶段 1 恰好一一对应，但语义不同——
请求 `selected_chunks` 可能因 provider 只返回整页而仍需保守标注（阶段 3 的 Tavily 边界即此），
而阶段 2 的 `content_scope` 会新增 `structured`（结构化 JSON），那不是任何 Fetch 模式。合并成
一个类型会让阶段 2 往「模式」里塞一个不可请求的值。映射规则写死在适配器：`full → full`；
`selected_chunks → selected_chunks`（保守标注，不从正文反推）。

### 2.2 信封字段

`WebEnvelope` 追加五个字段，**不带 `skip_serializing_if`**（键恒在场，无信息为 null；与既有
`result_count` 同位做法一致，与 `code` / `message` 的「缺键」形态不同）：

```rust
pub content_scope: Option<WebContentScope>,
pub coverage: Option<WebCoverage>,
pub fetched_by: Option<WebFetchedBy>,
pub binding: Option<WebBinding>,
pub final_url: Option<String>,
```

`WebEnvelope::base` 全部置 `None`，因此 Search 成功 / 失败、各类参数与权限拒绝默认就是五个 null，
不需要在每个失败分支手工置空；Fetch 路径的取值由 §5 的单一构造漏斗在 `provider.rs::execute_until`
收口处统一写入（成功与 `attempts>0` 失败各一态）。

`WebApprovalPayload` 追加 `mode: Option<WebFetchMode>`（仅 Fetch 为 `Some`，Search 为 `None`），
并沿用既有 `query` 字段承载 `selected_chunks` 的选取查询（Search 也用 `query`，语义都是「会发给
provider 的查询串」，不另造字段）。前端按 `operation` + `mode` 决定是否渲染 query 行。

`mode` / `query` **不进 `WebEnvelope`**：它们是请求事实，不是结果读数。它们有两条持久化来源，
两者都必须存在，否则 live 与恢复不同形（评审 P1-1）：

- **live `done`**：`audit_metadata` 的 `input` 参数就是调用原始 arguments（`turn.rs:1873`），
  因此 `mode` 与 Fetch 的选取 `query` 在审计投影里一次取到；`deny` 路径同样走这条路。
- **快照 / 会话恢复**：面板记录只持久化原始信封与 `PanelWebInput`（`turn.rs:1892`、
  `session.rs:60`），不持久化审计投影。因此 `PanelWebInput` SHALL 增加可选 `mode`，Fetch 分支
  SHALL 持久化选取 `query`（现状固定写 `query: None`，`output.rs:101-108`）；恢复时
  `withWebPanelInput` 只补空缺、不覆盖审计事实。旧记录缺键 → null / 不渲染，不做迁移。

信封只承载五个**结果**读数；`mode` / `query` 的展示一律来自审计投影（live）或经
`withWebPanelInput` 合并后的结果（恢复），两条路径必须逐字段同形。

## 3. 解析顺序与能力检查落点

合同顺序（spec ADDED 条）：参数形状 → URL 静态安全 → origin deny → provider 解析 → **能力检查** →
可选批准 → 本地预检 → provider 请求。

实现落点必须与既有调用序对齐，不能只按合同文字摆：

- `basic_args`（`mod.rs:306-394`）已承担参数形状 + URL 静态安全 + 主机类拒绝，且发生在
  `web::precheck`（`turn.rs:1805`）里，即**权限判定之前**——保持不动，只扩 `mode` / `query` 校验。
- origin deny 由 `ctx.decide` 在 `turn.rs:1806-1830` 完成，先于任何 web 执行入口——保持不动，
  deny 因此天然优先于能力检查。
- 能力检查**不能**放进 `precheck`：那会让它在 deny 之前执行，违反「deny 永远优先」。它必须落在
  provider 解析成功之后，共两处入口：
  1. `ConfiguredWebToolPort::approval_preview`（`mod.rs:126-168`）：取当前活跃适配器（注入取
     executor，生产取解析结果），模式不支持时返回 `Err(failure_envelope)`——`gated_execute`
     （`turn.rs:1993-1997`）对预览错误的既有语义是「错误直接回送模型，不进批准闸」，正好得到
     「无批准卡」。
  2. `ConfiguredWebToolPort::execute`（`mod.rs:170-224`）：同一判定之后、任何执行分派之前返回
     `web_mode_unsupported` 信封。生效路径包括 `allow_all`、`ask` 批准后，**以及注入 executor 的
     验收路径**。
- **必须修掉注入路径的绕过**（评审 P1-2）：现状 `execute` 在 `resolve_web_provider` **之前**
  就 `if let Some(executor) = &self.executor { return executor.execute(...) }` 提前返回
  （`mod.rs:209-212`），所以「解析后检查」对验收装配不生效。修法是让 port 先解析**当前活跃
  适配器**的身份与能力，再做检查，最后才分派：
  - 注入路径：身份取 `executor.identity()`，能力取 `executor.fetch_modes()`（测试 provider 声明
    `[full, selected_chunks]`）；能力声明覆盖只在 `acceptance-web` 装配里成立。
  - 生产路径：身份取 `resolve_web_provider` 的成功结果，能力取适配器常量。
  两条路径都保持「解析（或验收装配的等价解析）→ 能力检查 → 预检/请求」的顺序；解析失败仍先返回
  `web_provider_unconfigured` 或预览里的「未解析」，**先于**能力检查。验收装配的 config 仍须能
  解析出 provider（现有阶段 5 fixture 即如此，`web_acceptance.rs` 的 `set_deepseek`）——能力覆盖
  只改 `fetch_modes`，不改解析规则。
- `approval_preview` 与 `execute` 共用同一个判定函数（单一语义源）：

```rust
fn unsupported_mode(mode: WebFetchMode, adapter: &dyn FetchModeSource) -> Option<WebEnvelope>
```

失败信封：`provider` / `provider_id` 为当前活跃适配器的身份；`attempts=0`；`local_precheck=false`；
五个抓取读数 null；`message` 写明该适配器支持的模式（如「DeepSeek Fetch 只支持 full」）。

- **内部请求**：`WebProviderRequest::Fetch` 增加 `mode` / `query`（内部字段，不进 wire）。测试
  provider 消费 `query` 并记录；生产 DeepSeek 在能力检查之后仍只序列化 `{"url": …}`。这一层是
  「query 与 URL 一起发往 provider」在实现上的唯一通道，没有它测试 provider 收不到 query。

## 4. 能力声明的单一来源

能力的唯一真源是**当前活跃适配器**的方法，不是 `mod.rs` 里的一张常量表：

```rust
// provider.rs
pub const DEEPSEEK_FETCH_MODES: &[WebFetchMode] = &[WebFetchMode::Full];
impl DeepSeekWebProvider {
    pub fn fetch_modes(&self) -> &'static [WebFetchMode] { /* 生产恒为常量；验收装配可覆盖 */ }
    pub fn identity(&self) -> WebProviderIdentity;
}
// executor.rs
impl WebExecutor { pub fn fetch_modes(&self) -> &'static [WebFetchMode]; pub fn identity(&self) -> WebProviderIdentity; }
```

`ConfiguredWebToolPort` 的检查读 `executor.fetch_modes()`（注入）或适配器常量（生产）；
`mod.rs` 不复制模式表，`config.rs` 与前端也不复制——REVIEW.md「同一语义两处真源」条。阶段 3 引入
provider kind 后，由解析结果携带该适配器的声明，调用点不变。

测试 provider 的能力覆盖 SHALL 只在 `acceptance-web` 装配里生效（`LUMIR_ACCEPTANCE_WEB_ENDPOINTS`
的显式字段 + `#[cfg(feature = "acceptance-web")]`），生产构造器 MUST NOT 接受能力参数。

## 5. 信封构造点与失败矩阵

| 路径 | 构造点 | `local_precheck` | `fetched_by` | `binding` | `attempts` | `content_scope` / `coverage` / `final_url` |
|---|---|---|---|---|---|---|
| 参数非法 / URL 静态拒绝 / 能力不支持 / 未配置 / deny | `mod.rs` 的失败信封 | false | null | null | 0 | null |
| 预检失败（含超时 / 取消） | `executor.rs:107-115` | true | null | null | 0 | null |
| 预检通过、provider 前 deadline 用尽 | `provider.rs` 的 `attempts=0` 超时分支 | true | null | null | 0 | null |
| provider 已请求后失败（含取消覆盖） | `provider.rs::execute_until` 收口 | true | `provider` | `url_submitted` | >0 | null |
| provider 成功 | 适配器产出（生产 `provider_full()`；测试 provider `scripted`），`execute_until` 只保留已有值 | true | `provider` | `url_submitted` | >0 | 适配器声明：生产 `full` / `unknown`；测试 provider 按脚本（如 `selected_chunks` / `bounded`） |

实现上**只有一个收口写入点**：`provider.rs::execute_until` 在应用取消覆盖、补齐 query / source 之后
统一收口。失败与取消由收口写 `provider_attempted()`；**成功则保留当前活跃适配器已经产出的成功
provenance，收口只在缺失时补 `provider_full()`**——否则测试 provider 的
`scripted(selected_chunks, bounded)` 会被覆盖成 `full` / `unknown`（复核 P1）：

```rust
pub struct FetchProvenance { /* 五个字段 */ }
impl FetchProvenance {
    pub fn provider_full() -> Self;       // 生产成功：full / unknown / provider / url_submitted / null
    pub fn provider_attempted() -> Self;  // attempts>0 的失败：null / null / provider / url_submitted / null
    #[cfg(any(test, feature = "acceptance-web"))]
    pub fn scripted(scope: WebContentScope, coverage: WebCoverage) -> Self; // 测试 provider 成功
}

// execute_until 收口（唯一收口点，仅 Fetch；Search 五字段恒 null）
if operation == WebOperation::Fetch && envelope.ok {
    // 保留适配器已产出的成功 provenance（测试 provider 的 scripted）；
    // 生产 DeepSeek 不自行产出，由这里补 provider_full()
    if !envelope.has_provenance() {
        envelope.apply_provenance(FetchProvenance::provider_full());
    }
} else if operation == WebOperation::Fetch && envelope.attempts > 0 {
    envelope.apply_provenance(FetchProvenance::provider_attempted());
}
// 其余（含 Search）不写：五字段保持 null
```

成功 provenance 的产出责任在适配器：生产 DeepSeek **不写**，由收口补 `provider_full()`；测试
provider 在 `budget::fetch_success` 之后写 `scripted(scope, coverage)`（cfg 门控），收口 MUST NOT
覆盖。`!ok && attempts>0` 的失败与取消覆盖只由收口写 `provider_attempted()`，适配器不写失败
provenance。

`local` / `address_pinned` / 非空 `final_url` 在阶段 1 没有构造函数：需要断言序列化或前端降级的
单测直接在 `#[cfg(test)]` 里构造枚举值，MUST NOT 为它们留一个无人调用的 `local_pinned()`。

`budget::fetch_success` **不再**接收 provenance（避免成功路径与失败路径两处写入）：它只做预算裁剪，
`apply_truncation` 只动 `truncated` / `truncated_fields`，**不读写**五个新字段——「截断是独立轴」
在代码层是一句「不碰」，不是一段需要推理的分支。

`local_precheck` 的写入位置不变（executor 内），但**语义收窄**：它只表示预检执行过。面板与审计
不得再由它推导抓取方。

## 6. 面板、审计与文案

### 6.1 前端数据投影

- `WebAuditMetadata` 追加 `content_scope` / `coverage` / `fetched_by` / `binding` / `final_url`
  五个可空字段与 `mode: WebFetchMode | null`。live 路径由后端 `audit_metadata` 从调用 arguments
  投影 `mode`，五个结果读数由信封透传。解析规则：缺键 / null → null；取值不在闭集合 → **null**
  （不渲染、不猜映射）；不做跨字段推导（尤其不得由 `local_precheck` / `attempts` 反推
  `fetched_by` / `binding`）。
- `webAuditFromEnvelope` 只透传；`webAuditFromPanelText` 相同。
- `PanelWebInput`（`output.rs:76-111` 与 `src/web-audit.ts:120-135`）**必须扩形状**：增加可选
  `mode`，Fetch 分支持久化选取 `query`（现状固定 `None`）。这是快照 / JSONL 恢复能显示
  mode/query 的唯一来源（评审 P1-1）。
- `withWebPanelInput` 只补空缺：`query` / `url` / `input_url` / `mode` 各自独立，缺失才用输入补，
  MUST NOT 用输入覆盖已有的审计事实。旧记录缺键 → null，整行不渲染。

### 6.2 徽标与详情

- 徽标复用既有第二行容器（`.lumir-hp-web-health`，`src/harness-panel.ts:7421-7424`）与既有字号 /
  颜色，不新增视觉档位：`full` + `unknown` → `文档提取 · 完整性未验证`；`selected_chunks` →
  `相关段落`；`coverage=bounded` 追加 ` · 完整性受限`；`truncated_fields` 含 `content` 追加
  ` · 已截断`。失败 / `content_scope=null` → 不渲染。
- 「查看详情」新增行：`证据形态` / `完整性` / `抓取方` / `绑定` / `最终 URL`（仅非 null），
  Fetch 且 `mode=selected_chunks` 时另有 `模式` / `选取查询`。值直接显示合同 token
  （`full` / `unknown` / `provider` / `url_submitted`），与既有「截断字段 `content`」的呈现口径
  一致，避免为每个枚举值再造一套人话文案。
- 批准预览：`mode=selected_chunks` 时显示 query 与「query 随 URL 一起发往 provider」说明；
  `parseWebApprovalPreview`（`harness-panel.ts:981-1006`）SHALL 接受并保留 `mode`——现状会丢弃
  未知字段，不更新解析器则预览拿不到 mode（评审 P2-3）。默认工具行仍只显示原始输入 URL。
- `webInputText`（`src/web-audit.ts:151-164`）SHALL 按 operation 分支：Fetch 恒取 `url`（原始输入
  URL），Search 取 `query`。现状实现无条件优先 `query`——给 Fetch 持久化选取 `query` 后它会顶掉
  默认行 URL，必须同批修正并加「Fetch + query 的默认行仍是 URL」单测（评审 P1-1 的连带面）。
- 外发文案：Fetch 分支由 `fetched_by === "provider"` 决定，替换现有
  `local_precheck && provider_fetch`（`harness-panel.ts:1080-1087`）。
- 文案键：新增 `D1076`–`D1086`（徽标 2 + 后缀 2 + 行标签 5 + 模式 / 选取查询标签 2），
  `src/copy-data.ts` 与 `文案-Copy.md` 同步——`tests/unit/copy.test.ts` 的全量漂移门禁会判红。

### 6.3 审计

`output.rs::audit_metadata` 追加五个键，逐字透传信封（`output.get(...)`），不重算；既有
`local_precheck` / `provider_fetch` 事实字段保留（后者仍是 `attempts > 0`，与阶段 2 的
`fetched_by=local` 互补，语义不重叠）。

## 7. 与设计材料的偏差

| 偏差 | 理由 |
|---|---|
| MODIFIED 四条而非两条：额外改「Web 请求可靠性与计费边界」与「Web 真实 HTTP 验收装配边界」 | 前者住着 `web_mode_unsupported` 的稳定错误码清单（living spec `:4798-4806`），不改会自相矛盾；后者是验收装配的既有真源，新增近义 ADDED 会命中「同一语义两处真源」（评审 P2-2） |
| 工具描述只要求中文一条（材料 §3.5 #8 写「中英各一条」） | 当前工具描述是 `definitions()` 里的中文单语硬编码（`mod.rs:33-58`），仓库没有工具描述的双语机制；凭空要求英文会给一个不存在的消费者 |
| 补 `coverage=bounded` 的徽标后缀 ` · 完整性受限` | 材料只给了 `full` / `selected_chunks` 两种徽标文案；`bounded` 已被真值表收录，若沿用「完整性未验证」会把「已知被截断」说成「未知」，方向错 |
| `WebApprovalPayload` 增加 `mode` 字段 | 材料只要求预览显示 query；不携带 mode 前端无法区分「Fetch 的 query 行是否该渲染」与 Search 的 query |
| `mode` / Fetch 选取 `query` 不进信封，但要**两条持久化来源** | 放进信封会把「请求意图」混进「结果读数」，且 `WebEnvelope.query` 的既有语义是 Search query。live 由审计投影从 arguments 取；快照 / JSONL 只能靠 `PanelWebInput` 持久化（评审 P1-1 纠正了「投影一次取到、四条路径同源」的错误假设） |
| `budget::fetch_success` 不接收 provenance | 成功与失败要在两处写入就会漂移；改为 `provider.rs::execute_until` 收口单点写入，由 `ok` / `attempts` 选构造器（评审 P1-3） |
| 第四条 MODIFIED 而非新增近义 ADDED | living 已有「Web 真实 HTTP 验收装配边界」；再 ADDED 一条近义 requirement 会命中 REVIEW.md「同一语义两处真源」条（评审 P2-2） |
| 详情值显示合同 token 而非逐值人话 | 控制文案面（11 键 vs 约 20 键），且与既有详情行风格一致 |

## 8. 已裁决项与实现期默认

| 编号 | 问题 | 结论 | 依据 |
|---|---|---|---|
| D1 | `mode` 命名 `full` / `document` | **`full`** + 徽标固定搭配「完整性未验证」 | 最新推进授权明确选择推荐值 |
| D2 | 是否现在暴露 `selected_chunks` | **现在暴露**，DeepSeek 失败关闭 | 同上；且独立评审确认阶段 1 范围保留双模式 |
| D3 | 缺省模式 | `full` | 材料「实现期可自定」；改缺省会破坏所有既有默认调用 |
| D4 | `coverage` 的模型显著性 | 字段 + 工具描述，不加每结果 prose | 材料「实现期可自定」；实测忽略再补（单独 change） |

D1 / D2 已裁决，不再是阻塞项，也不再提供「推迟到阶段 3」的裁剪路径；实现期 MUST NOT 借这两项
扩展其他范围（例如不得因此引入 provider 配置或 `web_api`）。

## 9. 「无生产生产者枚举值」的处置（REVIEW.md「值或开关声明了却没有消费者」条）

阶段 1 的生产生产者只有四个值：`content_scope=full`、`coverage=unknown`、`fetched_by=provider`、
`binding=url_submitted`（外加各字段的 null）。`selected_chunks` / `coverage=bounded` 由测试 provider
产出；`fetched_by=local` / `binding=address_pinned` / 非空 `final_url` 在生产路径**无生产生产者**。
处置如下（REVIEW.md 条要求的是「同一 change 内有测试生产者 + 断言真实消费者的可观察效果」，
不是必须有生产生产者，评审 P2-1）：

1. **测试生产者**：`selected_chunks` / `coverage=bounded` 由验收装配的测试 provider 真实产出
   （§3 的能力覆盖 + §5 的 `scripted`）；`local` / `address_pinned` / 非空 `final_url` 由 TS 单测
   直接构造审计 JSON 产出，不需要 Rust 构造函数。
2. **消费者功效断言**（逐项，缺一不算满足）：
   - `fetched_by=local` → **不**渲染 provider 外发文案；
   - `binding=address_pinned` 与非空 `final_url` → 在「查看详情」可见；
   - 闭集合外的取值 → 归 null、不渲染、不猜映射；
   - `coverage=bounded` → 徽标出现 ` · 完整性受限`。
   这些是 DOM / 投影层断言，仅声明枚举、增加构造函数或做序列化断言不算。
3. **单一构造漏斗 + 文本级兜底**：五个值只能经 §5 的 `FetchProvenance` 写入；生产构造器只有
   `provider_full()` / `provider_attempted()`，`local` / `address_pinned` / 非空 `final_url` 在
   Rust 侧不是可构造状态。`scripts/acceptance/web-production-check.sh` 增加文本级兜底：
   `fetched_by` / `binding` / `final_url` 的赋值点只允许出现在白名单文件（`output.rs` 字段声明、
   `provider.rs` 构造漏斗），白名单外出现即红。这是文本级判据，判的是「有人绕过漏斗手写取值」，
   不声称能证明语义正确。
4. **不裁剪**：保留五个值（阶段 2 / 3 复用同一词汇）。REVIEW.md 条已由第 1–3 点满足；若评审仍
   认为不足，再改为只声明有生产生产者的四个值——但那要多改一次 schema，不是本提案的默认。

## 10. 测试与验收装配

- **Rust 单测**（`mod.rs` / `output.rs` / `provider_tests.rs` / `budget.rs`）：
  - 参数矩阵：`selected_chunks` 缺 query、`full` 带 query、query 超 256 / 全空白、未知 mode →
    `web_args_invalid`，五个读数 null；
  - 能力矩阵：DeepSeek × `selected_chunks` → `web_mode_unsupported`，provider 在场、
    `attempts=0`、`local_precheck=false`；用带计数 resolver / transport 的 executor 注入 port，
    断言计数为 0（零连接 / 零 provider 请求的机器证据，不靠日志）；
  - **错误优先级四连**：deny + 不支持模式 → `permission_denied`；静态非法 URL + 不支持 →
    `web_url_blocked` / `web_args_invalid`；未配置 + 不支持 → `web_provider_unconfigured`;
    已解析 + 不支持 + Ask → `web_mode_unsupported` 且 `approval_preview` 返回 Err（无卡）；
  - **失败真值表逐行**（五行各一测）：参数/deny/未配置/不支持 → 五字段 null 且
    `local_precheck=false`；预检失败 → `local_precheck=true`、抓取字段 null、`attempts=0`；
    provider 前 deadline 用尽 → 同上；provider 已请求后失败 → `fetched_by=provider` /
    `binding=url_submitted` / `attempts>0`、其余 null；成功 → `full` / `unknown` / null。
    另加取消覆盖分支：provider 已 attempt 后取消仍保留 `fetched_by=provider`；
  - Search 成功与 provider 后失败：五字段恒 null；
  - DeepSeek 请求 body 仍只有 `{"url": …}`（MUST NOT 因 mode 新增字段）；
  - 截断独立：30k 正文 → `truncated=true` 且 `coverage` 仍 `unknown`；
  - 工具描述含三句语义（full 非完整、selected_chunks 不降级、truncated 仅本地裁剪）。
- **TS 单测 / DOM**（`tests/unit`）：`parseWebAudit` 的缺键 / 非法枚举归 null / 不推导；徽标
  三形态与「无全文字样」；外发文案由 `fetched_by` 决定（`local` 不显示 DeepSeek 外发说明）；
  `binding=address_pinned` 与非空 `final_url` 在详情可见；`coverage=bounded` 出现
  ` · 完整性受限`；Fetch `selected_chunks` 的详情行取 `mode` / `query`，旧记录缺键整行不渲染。
- **验收装配（`src-tauri/tests/web_acceptance.rs`，`--features acceptance-web`）**：一条
  **`selected_chunks` + `bounded` 成功端到端**——测试 provider 声明 `[full, selected_chunks]`
  并脚本化返回；真实 socket 记录证明 URL 与 query 都到达测试 provider；覆盖
  `allow_all` 与 `ask` → 批准 → 执行两条路径；断言信封五字段、live 事件与快照 / JSONL 恢复的
  字段一致（评审 P1-4）。另证生产 DeepSeek 请求体没有扩字段。
- **生产反向断言**：`web-production-check.sh` 源码层 + rlib 产物层覆盖新注入面，并加 §9 的赋值点
  白名单判据。
- **真机**：新增验收项 886（`886-harness-web-mode-unsupported`：配置假 key 的 DeepSeek 条目 +
  `mode=selected_chunks` → 解析成功、能力检查在任何网络动作前失败 → `web_mode_unsupported`、
  无批准卡、无徽标、无条数读数；Ask 下同样无卡）与
  `886b-harness-web-no-fabricated-evidence`（未配置 provider + `full` → 错误、无徽标、五字段不伪造）；
  回扫 869–873、876 的闸期望（本次改了「能力检查先于批准」的次序，既有 Ask / deny 场景须逐条复核）。
  **覆盖边界写明**：GUI 生产装配无法产出成功 Fetch（无真实 provider key），因此
  `selected_chunks + bounded` 成功链与 `full + unknown` 徽标的成功形态由
  `src-tauri/tests/web_acceptance.rs` + TS DOM 单测覆盖，**MUST NOT 在 tasks 里记成「真机已验」**
  （REVIEW.md「覆盖声明超出真实验证」条）。若主评审要求 GUI 层也验成功徽标，需先给验收 runner
  接入 `acceptance-web` 构建与合成 provider——那是独立装配工作，不在本 change 面上。

## 11. 视觉与门禁

无原型，不适用「视觉保真」合同。但 Fetch 成功新增第二行徽标会改变工具行的纵向节奏：
`scripts/gate.sh visual` 的整页 / 元素像素判据可能变红，基线更新是**人肉裁决点**
（`tests/visual/README.md`），实现期不得自行 `--update`。徽标复用既有 `lumir-hp-web-health`
容器的字号 / 颜色，不新增视觉档位。

## 12. 备选方案与否决理由

| 方案 | 结论 | 理由 |
|---|---|---|
| 只加一个布尔 `is_full` | 否决 | 无法表达 provider 是否声明截断、谁抓的、绑定强度；阶段 2 必然重改 |
| 从正文是否含 `[...]` 推断形态 | 否决 | 设计材料 §1.3 的一手事实：Tavily 在块数不超上限时返回整页且无字段区分；正文本身可能含该字面量 |
| 把五个字段放进 `WebSource` | 否决 | 它们是「这次抓取」的属性，不是「这个来源」的属性；Search 结果没有抓取，放进去会诱导错误标注 |
| 用 `document` 替代 `full`（D1） | 否决 | D1 已裁决为 `full`；`document` 只作为历史备选记录 |
| 推迟 `selected_chunks`（D2） | 否决 | D2 已裁决为现在暴露；推迟会在阶段 3 再改一次 schema |
| 每次结果附一句人话提示（D4） | 否决（本阶段） | 每个结果重复 prose 与 token 开销；先靠字段 + 工具描述，实测忽略再补 |
| 持久化完整审计投影供恢复使用 | 否决 | 改动面大于给 `PanelWebInput` 补 `mode` + Fetch `query`；且会把「展示投影」变成第二份持久化事实源（评审 P1-1 给了两案，取小） |

## 13. r1 / r2 评审逐项对照（needs-changes，r1 绑定 `c7cfb951`、r2 绑定 `e9364c79`）

| 编号 | 评审要点 | 落点 |
|---|---|---|
| P1-1 | `mode/query` 在快照 / JSONL 恢复丢失 | §2.2 两条持久化来源；§6.1 `PanelWebInput` 扩形状；§6.2 `webInputText` 按 operation 分支；tasks 1.2 / 4.2 / 7.2 / 7.4 |
| P1-2 | 测试 provider 能力与 query 传递不生效 | §3 活跃适配器检查 + 注入路径；§4 单一真源；内部请求携带 `mode/query`；tasks 2.x / 7.x |
| P1-3 | provenance 构造合同自相矛盾 | §5 收口 + `provider_full()` / `provider_attempted()`；tasks 3.x |
| P1-4 | tasks 会把未跑通模式误记已验收 | §10 端到端 + 错误优先级矩阵；§10 真机覆盖边界；tasks 6.x / 7.x / 8.x |
| P2-1 | 缺消费者功效证据 | §9 测试生产者 + 四项 DOM 断言；tasks 7.1 |
| P2-2 | 新增 ADDED 与 living 两处真源 | 删除该 ADDED，改第四条 MODIFIED「Web 真实 HTTP 验收装配边界」 |
| P2-3 | ts-rs 与失败矩阵漏项 | tasks 1.4 绑定清单、4.6 `parseWebApprovalPreview`、6.4 五行逐行 |
| P2-4 | D1/D2 应按最新授权收口 | §8 已裁决表；proposal 节点 1 |
| r2-P1 | 成功收口把 `scripted(selected_chunks, bounded)` 覆盖成 `full/unknown` | §5 收口改为「成功保留已有 provenance，缺失才补 `provider_full()`」；tasks 3.1 / 3.3 |
| r2-P2 | Ask 预览缺实际渲染断言 | tasks 7.3（完整 URL + query + 外发说明；批准后默认行仍 URL） |
