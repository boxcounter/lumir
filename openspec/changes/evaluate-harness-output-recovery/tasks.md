# Tasks: evaluate-harness-output-recovery

> 本 change 是**实验提案**，不是实现。第 1–2 组由本次提案 mission 完成；第 3 组起在节点 1
> 通过后按组推进，未完成项保持未勾选。三项候选独立裁决，任何一组都不以「三项一起」为前提。

## 1. 制品

- [x] 1.1 `proposal.md`：为什么评估、三项候选各改什么、不做什么、需要 Alex 裁决的参数与判据；
      明确三项独立裁决、不预设成功
- [x] 1.2 `design.md`：证据底账（230 份结果 / 中位 648 / 193 未截断 / 37 截断 / 原始超长未知）、
      三项候选的 control 与 treatment、离线 fixture 清单、真实 provider 矩阵、判据与风险
- [x] 1.3 `specs/harness-tool-evaluation/spec.md`：4 条 ADDED requirement（候选独立裁决、离线
      机器判据、真实 provider 预注册、证据边界与隐私）
- [x] 1.4 审阅包复制到主仓 `.local/reviews/harness-output-recovery-oct29/`，含 `README.md`
      （给 Alex 的裁决导读与可整段运行的 `open` 命令）

## 2. 制品自验

- [x] 2.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 2.2 `bash scripts/docs-check.sh` 通过（含 OpenSpec 相对链接、归档对账、验收契约、backlog 出口）
- [x] 2.3 文本级自检：制品不含真实 vault 内容、真实人名、真实绝对路径或凭据；`.local` 指针
      全部写在行内代码里（不产生仓库内死链）

## 3. 节点 1（Alex 裁决）

- [ ] 3.1 Alex 对 `proposal.md`「需要 Alex 在节点 1 裁决的事项」9 项逐条裁决（参数值、判据阈值、
      是否接受候选 C 的合成证据）
- [ ] 3.2 按裁决修订 design 的取值与阈值；若裁决改变候选范围或判据结构，重新送节点 1

## 4. 离线回顾聚合（不依赖实现，本地只读）

- [ ] 4.1 搜索后的追加读：统计 `vault_search` 之后同一路径 `vault_read` 的比例与 offset 距
      命中行的分布（只出计数与行号差，不复制正文）
- [ ] 4.2 截断结果形状：37 份截断结果里 stdout / stderr 各自触顶、`exit_code` 非零、结构化
      输出（以 `{` / `[` 开头）的计数
- [ ] 4.3 patch 失败案例序列：3 次失败之后 3 次调用的去向与是否重试成功（案例序列，不做统计）
- [ ] 4.4 三项读数落 `.local/experiments/harness-output-recovery-oct29/retro/`，报告只写
      「机会规模」不写「收益」

## 5. 实验用 control / treatment（独立实验分支，不合入 master）

- [ ] 5.1 从当时 master 切独立实验分支 `exp/harness-output-recovery-*`；该分支只服务测量与
      证据，不合入 master、不进入本 change 的合并面；本 change 的 diff 始终只有 OpenSpec 制品
- [ ] 5.2 `cli_run` 中间截断 helper + treatment：头尾各 5,000、标记 `…[省略 N 字符]…`、短输出
      逐字节不变；**`task` 摘要不改任何字节**（预算、头尾比例、标记文案都不动；由 B9 守门）
- [ ] 5.3 `vault_search` 的 `context` 参数：缺省 0、夹取 0–5、窗口裁剪、相邻 / 重叠合并、
      `blocks` 形状、每行 `text` ≤200（超长行为前 199 字符 + `…`）、12,000 字符 / 400 行预算、
      两种截断文案、`context=0` 与 control 逐字段同形且不出现 `hint`
- [ ] 5.4 错误回执模板：`patch_not_found` / `patch_not_unique`（含命中行号，前 20）/
      `document_conflict`（含路径）/ `read_out_of_range`（含 1–N）/ `list_not_a_directory`
      （含上级目录指引）；`code` 与信封不变；单条 ≤ 400 字符
- [ ] 5.5 单测：design §3.4 / §4.4 / §5.4 的全部 fixture，按三类口径记录证据：
      **候选行为断言**红侧有读数、treatment 绿（收益侧 A1–A3、A5–A11，B3–B7、B10b，
      C1–C6；代价侧 B10c）；**identity / 守门**两版均绿（A4、A12，B1、B2、B8、B9、B10a、
      B11，C8、C9）；**静态对账元判据**两版同跑，记录「模板表 ↔ 声明清单」双向比对与
      「清单内 code 有产出点」的输出（C7）
- [ ] 5.6 mock provider 端到端：搜索 context 的块状结果、头尾截断的标记、错误回执文案各一条
      脚本化会话（不依赖真实 provider）
- [ ] 5.7 工具描述按 design §3.2 / §4.2 更新；描述改动与 treatment 同批（只在实验分支）

## 6. 离线判据执行

- [ ] 6.1 三条候选的离线断言按各自口径通过；红 / 绿两侧输出落
      `.local/experiments/harness-output-recovery-oct29/offline/`
- [ ] 6.2 证据按三类分别记录：候选行为断言（含代价侧 B10c）必须有 control 红侧读数；
      identity / 守门断言记录两版均绿、不要求红侧；静态对账元判据（C7）记录两版同跑的比对
      输出。缺红侧读数的候选行为断言不得进入判据
- [ ] 6.3 报告的「离线结论」只写形状合同与 fixture 事实，不写收益

## 7. 真实 provider 实验（需 provider 与真机窗口）

- [ ] 7.1 Tier 1 筛查：三候选 × DeepSeek × 主任务族 × 每臂 8 对；只做停滞 / 继续判断，不采纳
- [ ] 7.2 Tier 2 确认：达到继续条件的候选跑主族 20 对 + 守门族 10 对
- [ ] 7.3 Kimi 确认：只对 DeepSeek 达标的候选跑 12 对，方向一致才采纳
- [ ] 7.4 三项独立结论记录：`adopt` / `reject` / `undecided` + 依据 + 可重启条件；报告附每臂
      成功率区间、配对不一致表、成本中位数与区间
- [ ] 7.5 协议偏离清单：任何改判据 / 补跑 / 换模型 / 换 fixture 均逐条记录

## 8. 真机（`document_conflict` 批准窗，另行排期）

- [ ] 8.1 `read_only` 档下让 `vault_patch` 进入批准闸，在挂起期间由脚本改写目标文件，再批准；
      断言回执为 `document_conflict` 且含路径与下一步
- [ ] 8.2 证据落 `.local/acceptance/`，不进 git

## 9. 收尾

- [ ] 9.1 独立评审（clean / merge，绑定当前 tip）
- [ ] 9.2 按实验结果决定：采纳项另立实现 change；拒绝项记录不排期；`undecided` 保留矩阵待窗口
- [ ] 9.3 若归档本 change：手写新 capability 的 Purpose（归档会写 `TBD - created by archiving change` 占位），
      再跑 `validate --all --strict` 与归档后审计 `--archived` 至 PASS

## 10. 归档前最终验收（届时重跑；提案批次的自验见第 2 组）

- [ ] 10.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 10.2 `bash scripts/docs-check.sh` 通过
- [ ] 10.3 审阅包在主仓 `.local/reviews/harness-output-recovery-oct29/` 可开，`README.md` 的
      `open` 命令可整段运行
