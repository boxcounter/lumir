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
不需要在每个失败分支手工置空；只有 Fetch 的成功与「provider 已请求后失败」两条路径显式写入。

`WebApprovalPayload` 追加 `mode: Option<WebFetchMode>`（仅 Fetch 为 `Some`，Search 为 `None`），
并沿用既有 `query` 字段承载 `selected_chunks` 的选取查询（Search 也用 `query`，语义都是「会发给
provider 的查询串」，不另造字段）。前端按 `operation` + `mode` 决定是否渲染 query 行。

`mode` / `query` **不进 `WebEnvelope`**：它们是请求事实，不是结果读数。审计投影
（`output.rs::audit_metadata`）的 `input` 参数就是调用原始 arguments（`turn.rs:1873` 的
`serde_json::from_str(&call.arguments)`），因此 `mode` 与 Fetch 的选取 `query` 在审计里一次取到，
live、deny、快照与恢复四条路径同源；信封只承载五个**结果**读数。`PanelWebInput` 的持久化形状
**不变**（仍只有 query / url），旧记录不需要迁移。

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
  1. `ConfiguredWebToolPort::approval_preview`（`mod.rs:126-168`）：解析成功且模式不支持时返回
     `Err(failure_envelope)`——`gated_execute`（`turn.rs:1993-1997`）对预览错误的既有语义是
     「错误直接回送模型，不进批准闸」，正好得到「无批准卡」。
  2. `ConfiguredWebToolPort::execute`（`mod.rs:170-224`）：`resolve_web_provider` 成功后、
     构造 executor 之前返回 `web_mode_unsupported` 信封。生效路径包括 `allow_all` 与
     `ask` 批准后。
- 解析失败（未配置 / 歧义 / 自定义 base URL）仍按现状返回 `web_provider_unconfigured` 或
  预览里的「未解析」，**先于**能力检查——契约顺序如此，不给未解析 provider 报模式错误。

两处入口共用同一个判定函数（单一语义源）：

```rust
fn unsupported_mode(operation: WebOperation, mode: WebFetchMode, provider: &WebProviderIdentity)
    -> Option<WebEnvelope>
```

失败信封：`provider` / `provider_id` 为已解析值；`attempts=0`；`local_precheck=false`；五个抓取
读数 null；`message` 写明该 provider 支持的模式（如「DeepSeek Fetch 只支持 full」）。

## 4. 能力声明的单一来源

`provider.rs` 声明一个常量并在适配器方法上暴露：

```rust
pub const DEEPSEEK_FETCH_MODES: &[WebFetchMode] = &[WebFetchMode::Full];
impl DeepSeekWebProvider { pub fn fetch_modes(&self) -> &'static [WebFetchMode] { DEEPSEEK_FETCH_MODES } }
```

`mod.rs` 的预检调用点读同一常量（阶段 1 只有 DeepSeek，解析结果不含 kind，读常量即可；阶段 3 引入
provider kind 后由解析结果携带 `fetch_modes`，不另造第二张表）。**MUST NOT** 在 `config.rs` 或
前端复制一份模式表——REVIEW.md「同一语义两处真源」条。

## 5. 信封构造点与失败矩阵

| 路径 | 构造点 | `local_precheck` | `fetched_by` | `binding` | `attempts` | `content_scope` / `coverage` / `final_url` |
|---|---|---|---|---|---|---|
| 参数非法 / URL 静态拒绝 / 能力不支持 / 未配置 / deny | `mod.rs` 的失败信封 | false | null | null | 0 | null |
| 预检失败（含超时 / 取消） | `executor.rs:107-115` | true | null | null | 0 | null |
| 预检通过、provider 前 deadline 用尽 | `executor.rs` / `provider.rs` 超时分支 | true | null | null | 0 | null |
| provider 已请求后失败 | `provider.rs` 各失败分支 | true | `provider` | `url_submitted` | >0 | null |
| provider 成功 | `budget::fetch_success` | true | `provider` | `url_submitted` | >0 | `full` / `unknown` / null |

实现上用一个小结构体把五个值一起传递，避免五处散写：

```rust
pub struct FetchProvenance { /* 五个字段 */ }
impl FetchProvenance {
    pub fn provider_full() -> Self;                       // 生产唯一构造点
    #[cfg(any(test, feature = "acceptance-web"))]
    pub fn scripted(scope: WebContentScope, coverage: WebCoverage) -> Self; // 测试 provider 用
}
```

`local` / `address_pinned` 在阶段 1 没有构造函数：需要断言序列化或前端降级的单测直接在
`#[cfg(test)]` 里构造枚举值，MUST NOT 为它们留一个无人调用的 `local_pinned()`——REVIEW.md「值或
开关声明了却没有消费者」条同样适用于函数。

`budget::fetch_success` 增加 `provenance` 参数并在裁剪前写入，`apply_truncation` 只动
`truncated` / `truncated_fields`，**不读写**五个新字段——「截断是独立轴」在代码层是一句「不碰」，
不是一段需要推理的分支。

`local_precheck` 的写入位置不变（executor 内），但**语义收窄**：它只表示预检执行过。面板与审计
不得再由它推导抓取方。

## 6. 面板、审计与文案

### 6.1 前端数据投影

- `WebAuditMetadata` 追加 `content_scope` / `coverage` / `fetched_by` / `binding` / `final_url`
  五个可空字段与 `mode: WebFetchMode | null`。`mode` 由后端 `audit_metadata` 从调用 arguments
  投影（与 `input_url` 同一份来源），五个结果读数由信封透传。解析规则：缺键 / null → null；取值
  不在闭集合 → **null**（不渲染、不猜映射）；不做跨字段推导（尤其不得由 `local_precheck` /
  `attempts` 反推 `fetched_by` / `binding`）。
- `webAuditFromEnvelope` 只透传；`webAuditFromPanelText` 相同。
- `PanelWebInput`（`output.rs:76-111` 与 `src/web-audit.ts:120-135`）形状不变：`mode` / `query`
  已经在审计投影里，恢复路径不需要第二次来源。改动只落在 `parseWebAudit` 的字段白名单与
  `WebAuditMetadata` 的类型上。
- `withWebPanelInput` 不变（仍只补 query / url），不覆盖已有审计事实。

### 6.2 徽标与详情

- 徽标复用既有第二行容器（`.lumir-hp-web-health`，`src/harness-panel.ts:7421-7424`）与既有字号 /
  颜色，不新增视觉档位：`full` + `unknown` → `文档提取 · 完整性未验证`；`selected_chunks` →
  `相关段落`；`coverage=bounded` 追加 ` · 完整性受限`；`truncated_fields` 含 `content` 追加
  ` · 已截断`。失败 / `content_scope=null` → 不渲染。
- 「查看详情」新增行：`证据形态` / `完整性` / `抓取方` / `绑定` / `最终 URL`（仅非 null），
  Fetch 且 `mode=selected_chunks` 时另有 `模式` / `选取查询`。值直接显示合同 token
  （`full` / `unknown` / `provider` / `url_submitted`），与既有「截断字段 `content`」的呈现口径
  一致，避免为每个枚举值再造一套人话文案。
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
| MODIFIED 三条而非两条：额外改「Web 请求可靠性与计费边界」 | `web_mode_unsupported` 的稳定错误码清单住在该条（living spec `:4798-4806`）；不改会让规格自相矛盾，`validate` 也看不出来 |
| 工具描述只要求中文一条（材料 §3.5 #8 写「中英各一条」） | 当前工具描述是 `definitions()` 里的中文单语硬编码（`mod.rs:33-58`），仓库没有工具描述的双语机制；凭空要求英文会给一个不存在的消费者 |
| 补 `coverage=bounded` 的徽标后缀 ` · 完整性受限` | 材料只给了 `full` / `selected_chunks` 两种徽标文案；`bounded` 已被真值表收录，若沿用「完整性未验证」会把「已知被截断」说成「未知」，方向错 |
| `WebApprovalPayload` 增加 `mode` 字段 | 材料只要求预览显示 query；不携带 mode 前端无法区分「Fetch 的 query 行是否该渲染」与 Search 的 query |
| `mode` / Fetch 选取 `query` 由审计投影从 arguments 取，不进信封 | 材料未规定来源；放进信封会把「请求意图」混进「结果读数」，且 `WebEnvelope.query` 的既有语义是 Search query。审计投影的 `input` 本就是调用 arguments，一次取到、四条路径同源 |
| 详情值显示合同 token 而非逐值人话 | 控制文案面（11 键 vs 约 20 键），且与既有详情行风格一致 |

## 8. 待确认的默认值（D1 / D2 及可自定项）

| 编号 | 问题 | 本提案默认 | 改判路径 |
|---|---|---|---|
| D1 | `mode` 命名 `full` / `document` | `full` + 徽标固定搭配「完整性未验证」 | 改 `WebFetchMode` / `WebContentScope` 的 `full` 变体名 + 文案；合同其余不变 |
| D2 | 是否现在暴露 `selected_chunks` | 现在暴露，DeepSeek 失败关闭 | 推迟到阶段 3：删 `SelectedChunks` 变体、`query` 参数与相关场景；代价是阶段 3 再改一次 schema |
| D3 | 缺省模式 | `full` | 若改 `selected_chunks` 缺省，所有既有调用会被强制 `query`，破坏兼容——不建议 |
| D4 | `coverage` 的模型显著性 | 字段 + 工具描述，不加每结果 prose | 若实测模型忽略字段，再补一条短提示（单独 change） |

材料把 D3 / D4 列为「实现期可自定」，本提案按推荐执行；D1 / D2 材料列为「必须 Alex 裁」，
本提案不伪称已裁决（见 proposal 的节点 1 证据状态）。

## 9. 「零生产者枚举值」的处置（REVIEW.md「值或开关声明了却没有消费者」条）

阶段 1 的真实生产者只有四个值：`content_scope=full`、`coverage=unknown`、`fetched_by=provider`、
`binding=url_submitted`（外加各字段的 null）。`selected_chunks` / `coverage=bounded` 由测试 provider
与构造信封的单测产出；`fetched_by=local` / `binding=address_pinned` / 非空 `final_url` 在生产路径
**零生产者**。处置如下，且不把它写成「已实现的能力」：

1. **消费者在场**：五个字段被前端解析器、徽标、详情、审计与工具描述消费；不是无人分支。枚举的
   未知取值在前端归 null，不猜映射。
2. **生产构造面收窄**：能产出 `local` / `address_pinned` 的构造函数只在
   `#[cfg(any(test, feature = "acceptance-web"))]` 下存在（§5 的 `FetchProvenance`），无 feature
   构建里类型层面不可达。
3. **单一构造漏斗 + 文本级兜底**：五个值只能经 `FetchProvenance` 写入（字段私有，构造器见 §5），
   生产构造器只有 `provider_full()`，因此 `local` / `address_pinned` / 非空 `final_url` 在阶段 1
   没有可达的赋值路径。`scripts/acceptance/web-production-check.sh` 增加文本级兜底：`fetched_by` /
   `binding` / `final_url` 的赋值点（`fetched_by:` / `fetched_by =` 等形态）只允许出现在白名单文件
   （`output.rs` 的字段声明、`provider.rs` 的构造漏斗、`budget.rs` 的搬运），白名单外出现即红。
   这是文本级判据，判的是「有人绕过漏斗手写取值」，不声称能证明语义正确。
4. **若主评审要求更严**：裁剪为只声明有生产者的四个值，阶段 2 再扩枚举。代价是阶段 2 要再改一次
   `output.rs`、bindings、前端解析与一条 MODIFIED delta；收益是阶段 1 的字段集合 100% 有生产者。
   这是本提案唯一的「合同词汇稳定性 vs 声明即被消费」取舍点，需主评审裁决。

## 10. 测试与验收装配

- **Rust 单测**（`mod.rs` / `output.rs` / `provider_tests.rs` / `budget.rs`）：
  - 参数矩阵：`selected_chunks` 缺 query、`full` 带 query、query 超 256 / 全空白、未知 mode →
    `web_args_invalid`，五个读数 null；
  - 能力矩阵：DeepSeek × `selected_chunks` → `web_mode_unsupported`，provider 在场、
    `attempts=0`、`local_precheck=false`；用带计数 resolver / transport 的 executor 注入 port，
    断言计数为 0（零连接 / 零 provider 请求的机器证据，不靠日志）；
  - 信封：五个键在成功 / 失败 / Search 下都恒在场；Search 五者恒 null；
  - DeepSeek 请求 body 仍只有 `{"url": …}`（MUST NOT 因 mode 新增字段）；
  - 截断独立：30k 正文 → `truncated=true` 且 `coverage` 仍 `unknown`；
  - 工具描述含三句语义（full 非完整、selected_chunks 不降级、truncated 仅本地裁剪）。
- **TS 单测**（`tests/unit`）：`parseWebAudit` 的缺键 / 非法枚举 / 不推导；徽标三形态与「无全文
  字样」；外发文案由 `fetched_by` 决定；Fetch `selected_chunks` 的详情行取 `mode` / `query`，
  旧记录缺键时整行不渲染。
- **验收装配**：合成 provider 经 `acceptance.rs` 的 env 显式字段启用（`#[cfg(feature =
  "acceptance-web")]`），声明 `[full, selected_chunks]` 并可脚本化返回两种形态；`TestServer`
  记录真实请求形状与次数。
- **生产反向断言**：`web-production-check.sh` 源码层 + rlib 产物层覆盖新注入面，并加 §9 的计数断言。
- **真机**：新增验收项 886（`886-harness-web-evidence-badge` 文档提取 + 未验证徽标；
  `886b-harness-web-mode-unsupported` 不支持模式 → 错误 + 无批准卡 + 无徽标）；回扫 869–873、
  876 的闸期望（本次改了「能力检查先于批准」的次序，既有 Ask / deny 场景须逐条复核）。

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
| 用 `document` 替代 `full`（D1） | 备选 | 语义更保守，但与材料推荐不一致；改判成本只是重命名，列入 §8 |
| 推迟 `selected_chunks`（D2） | 备选 | 首阶段更小，但阶段 3 会再改一次 schema；列入 §8 |
| 每次结果附一句人话提示（D4） | 否决（本阶段） | 每个结果重复 prose 与 token 开销；先靠字段 + 工具描述，实测忽略再补 |
