# Proposal: Web Search 结果密度与结果健康摘要

- Change ID: `compact-web-search-result-summary-nov26`
- 日期: 2026-11-26
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**已通过**（2026-11-26）。Alex 对最终方案回复原文：
> 「Web Search 按推荐」。批准口径（本轮合同的完整抄录，实现与评审都以此为准）：
>
> - running 默认单行显示状态 + 纯 query，不显示原始 JSON / 默认参数。
> - done 默认紧凑显示 query，并有第二行结果健康摘要：正常 `N 条结果 · 文本 X`；若字段截断追加
>   `已截断`；若 `truncated_fields` 含 `results` 用 `保留 N 条结果 · 文本 X · 已截断`；真正成功
>   空结果显示 `0 条结果 · 搜索成功`。英文同样双语。
> - N 是预算裁剪后实际回送模型的结果数，不是全网总数；文本大小是最终保留结果 title + snippet +
>   summary + content 各字符串 UTF-8 字节之和，不含 URL / site / date / authority / query / JSON
>   开销，不是网页大小或网络流量。缺失 / 不可信 / 失败时指标为 null，不得 `?? 0` 冒充空结果。
>   中文按 UTF-8 字节。
> - error 直接显示稳定 code + 人话原因，不显示 0 条 / 0B；其余审计可展开。
> - provider、attempts、完整 query、截断字段、实际外发与费用、untrusted 全部保留在默认关闭的
>   「查看详情」，不删除事件 / 面板记录 / JSONL / 安全元数据。Ask 待决卡完整信息不变。
> - live 与 restored 同形同默认态；旧记录缺指标不显示条数 / 大小。
> - 修复审计块被算成另一次工具调用：单 Web 调用不出组摘要，两个真实调用 + 两个审计仍显示 2；
>   展开组后各审计仍默认关闭。
>
> 节点 2（归档评审）：实现完成后按五要件记录。

## Why

Web 工具行现在是「工具行 + 审计块」常驻两行（`src/harness-panel.ts` 的 `createWebAuditBlock`），
审计块还进 `ToolsBlock.rows`，被折叠计数当成一次工具调用。后果有三类：

1. **密度**：每次 Web 调用常驻 provider / attempts / 截断字段 / query 全文 / 外发与费用说明，
   一次「搜一下再抓一篇」就占掉半屏；模型给的 `arguments` JSON（`{"query":…,"count":5,
   "need_content":false}`）还会在 running 行原样出现，默认参数与原始 JSON 都成了噪声。
2. **读数缺位**：信封只带 `truncated` / `truncated_fields`，没有「预算裁剪后实际回送模型几条
   结果、多少文本」的读数；用户无法一眼判断这次搜索是空、是正常、还是被预算砍过。
3. **计数失真**：审计块被算成另一次调用——单次 Web 调用会折叠成「2 个工具调用」，两个真实调用
   + 两个审计显示 4，与用户实际看到的两次调用不符。

`budget.rs` 的 `search_success` 是唯一的预算裁剪点（字段截断 → 聚合裁剪 content / summary /
snippet → 整条移除 results），读数在这里算一次即可同时服务 live 事件与恢复路径
（`output::audit_metadata` 从同一信封派生，面板记录持久化同一个信封 JSON），不需要前后端各算一份。

## What Changes

对应 spec delta：修改 `harness` 的五条 requirement（整块复制后改，见
`specs/harness/spec.md`）：

1. **统一 Web 搜索与抓取工具**：统一信封新增两个可空结果读数 `result_count` /
   `result_text_bytes`；成功 Search 在预算裁剪后由后端单一一次计算，语义按批准口径（条数 = 实际
   回送模型的结果数；字节 = 最终保留结果 title / snippet / summary / content 的 UTF-8 字节和）。
   非 Search 成功、失败、缺读数时为 `null`，MUST NOT 用 0 冒充空结果。
2. **Web 访问策略与 origin 例外**：默认无批准卡时 Web 工具行改为紧凑形态——running 单行
   （状态 + 纯 query / URL，不显示原始 JSON / 默认参数）；done 显示 query / URL + 第二行结果健康
   摘要（四种形态见 proposal 评审记录）；失败直接显示稳定 code + 人话原因，不显示条数 / 大小。
   provider、attempts、完整 query / URL、截断字段、实际外发与费用、untrusted 移入默认关闭的
   「查看详情」。live 与 restored 同形，旧留存缺读数不显示条数 / 大小；Ask 待决卡不变。
   本条 supersede living 里「工具行与结果 SHALL 仍完整展示 … MUST NOT 只靠 80 字摘要满足可见性」
   的旧措辞。
3. **工具调用呈现**：组摘要的计数只计真实工具调用行；Web 结果健康摘要与审计详情是该调用的附属
   内容，MUST NOT 计为另一次调用、MUST NOT 影响单行 / 多行判定；组展开 MUST NOT 改变各附属详情
   的展开态（仍默认关闭）。
4. **批准闸呈现与决策后收敛**：把「默认 Allow 的工具行 / 结果 SHALL 保留同样的输入、provider、
   费用与 untrusted 审计」改准为「同形紧凑行 + 默认关闭的详情，审计保留在详情中」；Ask 待决卡
   的完整预览与既有决策后收敛行为不变。
5. **权限机制**：该条 Web 场景里「工具行 / 结果保留完整 query / URL、provider、费用与 untrusted
   审计」的措辞按第 2 条的呈现口径改准（审计仍保留，只是默认收进详情）。

## Non-goals

- 不改 Web 工具 schema、不缩 `count` 上限、不改 provider / 预算 / 预检 / 安全判定。
- 不删除任何事件、面板记录、JSONL 字段或安全元数据；不做留存格式迁移（旧记录缺新读数即降级）。
- 不改 Ask 待决卡的完整预览（query / URL / origin / provider / 双路外发 / 费用 / untrusted）。
- 不改普通工具行的全局 padding / 高度 / 折叠样式；不新增 overflow 容器；不新增全局键位。
- 本轮不执行真机验收、不更新视觉基线（基线更新是人肉裁决点）。

## Impact

- 影响的 specs：`harness`（五条 MODIFIED requirement）。
- 影响的代码/系统：
  - `src-tauri/src/harness/web/output.rs`：信封两个可空字段 + 审计投影透传。
  - `src-tauri/src/harness/web/budget.rs`：预算裁剪后单一一次计算读数。
  - `src-tauri/src/harness/turn.rs`、`src-tauri/src/harness.rs`：Web 工具的纯 query / URL 参数摘要
    （live 事件、面板持久化、JSONL 恢复同源）。
  - `src/web-audit.ts`：审计投影新增两个可空读数（旧记录缺键 → null）。
  - `src/harness-panel.ts`：紧凑工具行 + 结果健康摘要 + 默认关闭的「查看详情」；审计单元不计入
    组摘要行数。
  - `src/harness-panel.css`：新附属单元的第二行样式，复用既有 token 与「查看详情」形态。
  - `src/copy-data.ts` / `文案-Copy.md`：结果健康摘要四条双语模板（D1029–D1032）。
  - 新增 `src/byte-size.ts`：字节读数格式化单一来源（与图片 modeline 的既有读数同源）。
- 关联约束：不动性能合同路径（渲染只在工具行完成后一次）；不动「不改写源文件」与配置即数据；
  不新增依赖。
- 测试：Rust 单测（预算读数 / 审计投影 / 摘要）、前端单测（DOM 紧凑形态 / 计数 / live-restored
  一致 / 旧记录降级 / secret canary）、视觉结构断言（m384）、真机场景 869/871/872/873/876 的
  期望改写（本轮只改场景，不执行真机）。
