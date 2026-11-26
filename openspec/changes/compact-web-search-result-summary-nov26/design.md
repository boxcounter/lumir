# Design: compact-web-search-result-summary-nov26

## 1. 问题与约束

Web 工具行当前由两段组成：工具行（`.lumir-hp-tool-row`）+ 审计块（`.lumir-hp-web-audit`）。
审计块被 `appendWebAuditToBlock` 推进 `ToolsBlock.rows`，于是它既是常驻的第二行，又被组摘要
当成「另一次工具调用」计数。设计要同时解决三件事：

- 默认密度：只留 query / URL 与一行结果健康摘要；审计收进默认关闭的「查看详情」。
- 读数可信：条数与文本字节必须是**预算裁剪后实际回送模型**的那一份，而不是 provider 原始响应
  或前端二次统计。
- 计数准确：组摘要只数真实工具调用，审计 / 健康摘要作为调用附属内容不计数；组展开不改变各详情
  的展开态。

硬约束（来自批准口径与仓库纪律）：

- 不删除事件、面板记录、JSONL、安全元数据；旧记录缺新读数时降级，不做留存迁移。
- live 事件与快照 / 会话恢复共用同一份审计投影，同形同默认态。
- Ask 待决卡（`renderWebApprovalBlock` / `WebApprovalPayload`）完整信息不变。
- 不改普通工具行的全局 padding / 高度；不新增 overflow 容器；不新增全局键位。
- 视觉基线更新是人肉裁决点，本轮不动基线。

## 2. 数据合同

### 2.1 信封新增两个可空字段

`WebEnvelope`（`src-tauri/src/harness/web/output.rs`）新增：

| 字段 | 类型 | 语义 |
|---|---|---|
| `result_count` | `Option<u32>` | 成功 Search 在**预算裁剪后**实际回送模型的结果条数 |
| `result_text_bytes` | `Option<u64>` | 同一批结果的 `title` + `snippet` + `summary` + `content` 各字符串 UTF-8 字节数之和 |

序列化后两键恒在场（未设置时为 `null`，不是缺键、不是 0）。ts-rs 导出为
`number | null`（`src/bindings/WebEnvelope.ts`）。

**为什么是 `null` 而不是 0**：0 是一个合法读数（真正成功的空结果），失败 / 非 Search / 旧记录
没有读数。用 0 兜底会把「不知道」显示成「0 条结果」，正是 REVIEW.md「读不到当成空」条的形态。
前端解析同样只接受非负整数，其余（缺键、`null`、字符串、负数、小数）一律归 `null`，MUST NOT
`?? 0`。

### 2.2 单一计算点

`budget::search_success` 是唯一裁剪点，读数在裁剪全部完成、构造信封之前计算一次：

```
field truncation → aggregate content → summary → snippet → pop whole results
                 → result_count = results.len()
                 → result_text_bytes = Σ utf8_len(title, snippet?, summary?, content?)
                 → WebEnvelope::search_success(...) + 回填两个字段
```

- **条数口径**：`results.len()`，不是 provider 的 `count` 参数，也不是原始响应条数。聚合裁剪整条
  移除结果后，读数随之变小。
- **字节口径**：只算四个文本字段的 UTF-8 字节；不含 URL / site / date / authority / query /
  JSON 结构开销 / 传输字节。中文按 UTF-8（例如 `"中文"` = 6 字节）。
- **非 Search 成功 / 失败**：构造函数保持 `None`；失败路径（含 Fetch 预检失败、deny、未配置）
  不伪造读数。
- `WebEnvelope::search_success` 直接构造（测试桩 / 非预算路径）时为 `None`——它是「没有经过预算
  计算的信封」，诚实表达未知；只有 `budget::search_success` 产出带读数的成功 Search 信封。

`output::audit_metadata` 只**透传**信封里的两个值（`clone().unwrap_or(Null)`），不重算。面板记录
持久化的也是同一个信封 JSON（`turn::finish_call`），因此 live 事件与恢复路径消费的是同一份数据。

### 2.3 Web 工具的参数摘要（纯 query / URL）

`turn::summarize_args` 目前对 Web 工具回落到原始 arguments JSON（80 字截断），这是 running 行
「原始 JSON / 默认参数」的来源。新增按工具名的入口：

- `web_search` → `query` 原文（截断上限沿用 `SUMMARY_LIMIT`）
- `web_fetch` → `url` 原文
- 其余工具 → 既有 `summarize_args`

调用点：`turn::handle_call`（live started / 面板持久化）、`harness.rs` 的 JSONL 恢复面板记录
（`function_call` 项，此处已知工具名）。前端 `keyArgOf` 同步加 `web_search` / `web_fetch` 两档，
用于旧快照里仍是 JSON 的 summary——两边都收敛到纯 query / URL，不显示 `count` / `need_content`
这类默认参数。

## 3. 前端结构

### 3.1 DOM

每个 Web 调用在工具行之后追加一个**附属单元**（不进入 `ToolsBlock.rows`）：

```
<div class="lumir-hp-web-unit">                     ← 附属单元，组折叠时随行隐藏
  <div class="lumir-hp-web-meta">                   ← 第二行：健康摘要 + 详情入口
    <span class="lumir-hp-web-health">5 条结果 · 文本 12 KB</span>
    <button type="button" class="lumir-hp-web-detail-toggle" aria-expanded="false">
      <span class="lumir-hp-tool-more"><svg…/>查看详情</span>
    </button>
  </div>
  <section class="lumir-hp-web-audit" hidden>       ← 既有审计内容，默认关闭
    …provider / attempts / truncated fields / 完整 query / 外发与费用 / untrusted…
  </section>
</div>
```

- 健康摘要在 `operation=search` 且 `code=null` 且两个读数都是合法整数时渲染；四种形态按批准口径：
  - 正常：D1030 `N 条结果 · 文本 X`
  - 字段截断（`truncated=true` 且 `truncated_fields` 不含 `results`）：D1032 `N 条结果 · 文本 X · 已截断`
  - 结果裁剪（`truncated_fields` 含 `results`）：D1033 `保留 N 条结果 · 文本 X · 已截断`
  - 真正成功空结果（`count=0` 且未截断）：D1031 `0 条结果 · 搜索成功`
  - 英文同义双语；`count=1` 用 `tPlural` 的 `enOne` 档。
- 文本大小复用 `byteSizeText`（B / KB / MB，ASCII 单位，与图片 modeline 的 `imageSizeText` 同一份
  格式化）；不另写第二套。
- 失败 / 非 Search 成功 / 缺读数：不渲染健康摘要（不显示 `0 条` / `0 B`）。
- 详情入口复用既有「查看详情」文案（D407）、`.lumir-hp-tool-more` 的 chevron 形态与
  `.lumir-hp-tool-more svg` 的旋转规则；详情内容复用既有 `createWebAuditBlock` 的 `<dl>` /
  `.lumir-hp-argv` / `.lumir-hp-approval-note`，不新增 overflow 容器。
- 单元整体左缩进 17px（= 工具图标 14 + 间距 3，与 `.lumir-hp-term-body` 同一算式）；不修改
  `.lumir-hp-tool-row` 的全局 padding / 高度。

### 3.2 组折叠与计数

`ToolsBlock` 增加 `extras: HTMLElement[]`（附属单元）与 `collapsed: boolean`：

- `appendWebAuditToBlock` 把单元推进 `extras`，**不**推进 `rows`；`rows` 仍只装真实工具行
  （含 `task` 包装、批准终态 `termwrap`）。
- `collapseBlock` 的判据仍是 `rows.length`：单 Web 调用 `rows=1`，不产生摘要；两个真实调用
  `rows=2`，摘要显示 `data-count=2`，即使挂了两个审计单元。
- 折叠时 `rows` 与 `extras` 一起隐藏；展开时一起显示。各单元的 `.lumir-hp-web-audit` 自身的
  `hidden` 状态不被组开合改写——组展开后各审计仍默认关闭。用户单独展开某个审计后，再折 / 展开组
  仍保留该审计的展开态（`renderWebAuditUnit` 记在单元上）。
- 若 done 到达时所属块已被折叠（防御路径），新单元按 `block.collapsed` 初始隐藏。

### 3.3 live 与恢复同形

live（`tool_call done` 的 `web` 载荷）与 restored（`tool` 面板记录的 `text` 信封）都走同一个
`createWebAuditUnit(metadata)`；健康摘要与详情内容从 `WebAuditMetadata` 单份渲染。恢复路径的
行文本沿用既有 `toolArgsText`（新摘要为纯 query；旧 JSON 经 `keyArgOf` 人话化为纯 query）。

语言切换：附属单元登记进 `webAuditUnits`，`applyLabels` 重渲同一份 metadata（保留各详情展开态），
健康摘要、`查看详情`、审计键名随语言重取；不改写行文本。

### 3.4 错误形态

- 行尾注沿用既有 `{code}: {message}` 语义；live 路径在 Web 调用失败时剥掉 `error · ` / `denied · `
  状态前缀，使 live 与 restored 都显示稳定 code + 人话原因。非 Web 工具不变。
- 失败行不渲染健康摘要；审计单元仍可展开（provider / attempts / 外发事实）。

### 3.5 旧记录降级

旧面板记录的信封没有两个读数键：`webAuditFromEnvelope` 归 `null`，健康摘要不渲染；详情仍按
provider / attempts / truncated fields / 外发 / untrusted 渲染。不做迁移、不写回旧 JSONL。

## 4. 被否方案

- **前端从 `results` 重算条数与字节**：违反「后端预算裁剪后单一计算」，且恢复路径的 `text` 是
  完整信封（含正文），前端重算等于第二份真源。否。
- **用原生 `<details>` 做详情**：既有终态行已用「查看详情 + chevron + hidden body」形态，`<details>`
  会引入第二套开合语义与默认焦点行为；且 `<summary>` 的内建三角与设计 token 不一致。否。
- **把审计块留在 `rows` 但给折叠计数加 `-1`**：计数仍依赖「审计块存在」这一布局事实，且多审计 /
  无审计时易错。改为附属单元、从结构上不进入计数。否。
- **失败时也显示 `0 条结果`**：把未知当空结果。否。

## 5. 验证面

- Rust：`budget::search_success` 的条数 / UTF-8 字节 / 字段截断 / 结果整条移除 / 空结果；
  `audit_metadata` 的透传与失败 null；`summarize_args` 的 Web 纯 query / URL。
- 前端单测（DOM）：单 Web 调用不出摘要；两个真实调用 + 两个审计仍显示 2；组展开后审计仍默认
  关闭；健康摘要四形态；失败不显示条数 / 大小；旧记录降级；live 与 restored 同形；
  secret-canary 不因详情展开而上屏；Ask 待决卡不变。
- 视觉结构（m384）：默认收起 / 展开后内容完整 / 计数不变量；不新增像素基线。
- 真机（本轮不执行，只改场景期望）：869 / 871 / 872 单调用不再有组摘要，需点「查看详情」看
  审计；873 / 876 两条真实调用仍折叠为 2；870 Ask 不变。

## 6. 视觉保真

无独立原型。视觉口径全部复用既有设计 token 与既有形态：

- 第二行字号 `--fs-meta`、颜色 `--text-2`（与工具行正文同档）；详情入口沿用
  `.lumir-hp-tool-more`（`--fs-micro`、`--text-3`）。
- 缩进 17px 与 `.lumir-hp-term-body` 一致；无新底色、无新边框、无新阴影。
- 折叠 / 展开沿用既有 chevron 旋转过渡（`--dur-ui` / `--ease-standard`）。
- eink 主题不新增彩色；健康摘要只用文字色阶。
