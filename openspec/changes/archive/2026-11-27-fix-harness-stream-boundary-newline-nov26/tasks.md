# Tasks: fix-harness-stream-boundary-newline-nov26

> 阶段门：节点 1 已过（Alex 2026-11-26「好。请你安排」；排期顺序 = 先修流式丢字符）。本 change 是
> 数据正确性修复：不做视觉改动、不改渲染语义；`openspec/specs/**` 活跃期只读，规格变更只写本
> change 的 delta（ADDED 一条新 requirement，不提前写进 living spec）。
> 顺序是硬约束：**先红后绿**——1.x 的判据必须先在未修代码上判红并留证，再进 2.x。

## 1. 合同与红证据

- [x] 1.1 在 delta 写下边界不变量（`[0, source.length]`）、跨片字符守恒与「既有定稿语义不变」的
      边界声明（`specs/harness/spec.md`）
- [x] 1.2 新增 `tests/unit/harness-stream-boundary.test.ts`：纯函数层边界上界属性（全部切点）+
      两阶段字符守恒属性 + 旧实现越界形状的反向验证；真面板层驱动
      `text_chunk → flushChunks → 冻结块 / 尾块`（rAF 逐帧排干）
- [x] 1.3 **红跑（实现前）**：`node --experimental-strip-types --import ./tests/unit/register.mjs
      --test tests/unit/harness-stream-boundary.test.ts` 四个用例全红，含真面板路径的
      `'' !== '续段首字保留。'` / `'段首字保留。' !== '续段首字保留。'`；证据
      `.local/missions/fix-harness-stream-boundary-newline-nov26/RED-unit-before-fix.log`
- [x] 1.4 纯函数探针留证：未修代码上边界恒为 `源长 + 1`（空串 / 单换行 / 段落 / 连续空行 / CRLF /
      闭合围栏六种形态），列表内部空行仍为 0；证据 `probe-boundary-before-fix.log`

## 2. 实现（最小修复）

- [x] 2.1 `src/harness-panel.ts` 的 `finalizedUpTo` 出口把边界夹到 `[0, source.length]`，并在函数
      注释写明「边界是下一片尾块的起点，越界即吞首字符」与末尾空串行的成因
- [x] 2.2 不新增第二份边界判断：`finalizedBoundaryFromTop` 的列表守卫、围栏内空行不候选等既有
      语义原样保留（只夹上界，不改候选与筛选）

## 3. 绿跑与回归

- [x] 3.1 目标单测 + 既有流式 / 粗体单测全绿：`harness-stream-boundary.test.ts` 与
      `harness-transcript-render.test.ts` 合计 48 tests / 0 fail；证据
      `.local/missions/.../GREEN-target-unit-after-fix.log`
- [x] 3.2 前端全量单测绿：`node tests/unit/run.mjs` → 2079 tests / 0 fail；证据
      `.local/missions/.../GREEN-unit-all.log`
- [x] 3.3 纯函数探针复跑：修复后六种形态的边界都不超过源长（空串 0、单换行 1、段落 6、…），
      列表内部空行仍为 0；证据 `probe-boundary-after-fix.log`

## 4. 验收场景（新增）

- [x] 4.1 核对当前最大编号（场景 878；877 空缺不复用）→ 取 879；
      `scripts/acceptance/scenarios/879-harness-stream-boundary-newline.md`（`item: 879`、
      `tier: full`）
- [x] 4.2 fixture `scripts/acceptance/fixtures/harness-mock-newline-chunks.json`：显式分片
      `["边界前段。\n\n边界后段。\n", "首字符检验。", "结束。"]` + `chunk_delay_ms: 6000`；
      判据本体 = 第二片到达后、第三片未到时的中间态 `ax.has "首字符检验。"`（旧实现只有
      `字符检验。`）；终态断言只作回归面（终态全量重渲会补齐，如实登记在场景正文）
- [x] 4.3 `node scripts/acceptance/coverage.mjs` 重新生成覆盖表（300 个场景 / 269 个 item），
      `node scripts/acceptance/run.mjs --check` PASS（300 个场景静态校验通过）
- [x] 4.4 **真机执行 879**：PASS——16 条 PASS（13 条断言 + 3 张截图证据），中间态判据
      「第二片首字符在中间态即上屏」逐字命中；窗口钉尺寸 1200×800 回读生效。证据
      `.local/acceptance/2026-11-27-ux-goal/879-harness-stream-boundary-newline/`
      （`status.txt` = PASS，`steps.md` 逐条 PASS，`ax/` + `shots/` 齐全）。本轮未更新任何像素基线

## 5. 门禁与静态校验

- [x] 5.1 `pnpm exec tsc --noEmit`（tsc-root）通过（exit 0，`GREEN-tsc-root.log`）
- [x] 5.2 `pnpm exec tsc -p tests/unit/tsconfig.json`（tsc-unit）通过（exit 0，`GREEN-tsc-unit.log`）
- [x] 5.3 `tests/visual` 的 tsc 通过（`cd tests/visual && ../../node_modules/.bin/tsc --noEmit`，
      exit 0，`GREEN-tsc-visual.log`）
- [x] 5.4 相关浏览器 / 视觉结构层：`LUMIR_VISUAL_STRUCTURAL=1` 定向跑
      `harness-async-adversarial`（text_chunk 流式）/ `harness-markdown-bold-nov25` /
      `harness-typography-nov23`（chromium + webkit-realua）→ 29 passed / 0 failed；不跑像素层、
      不更新基线。全量结构套件（1853 条单 worker）跑到第 159 条 0 失败后按 mission 范围中止，
      读数记在证据目录 `PARTIAL-visual-structural-fullrun-aborted.log`
- [x] 5.5 `bash scripts/docs-check.sh` 通过（归档批复跑 PASS；`openspec-archive-check` 门禁模式、
      links、backlog 出口与归档队列判据一并绿）
- [x] 5.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（45 passed / 0 failed）
- [x] 5.7 `node scripts/acceptance/run.mjs --check` 通过（300 个场景）

## 6. 收尾

- [x] 6.1 证据落主仓 `.local/missions/fix-harness-stream-boundary-newline-nov26/`（红 / 绿 /
      探针 / 门禁日志），不落 worktree
- [x] 6.2 在 mission 分支提交（不 push、不 merge、不归档、不动视觉基线）
- [x] 6.3 真机 879 PASS 后落 `docs/backlog.md` 归档跟踪条目并走节点 2：条目已落（删最老的一条
      已归档历史记录腾行，队列保持 80 行硬上限）；节点 2 五要件记录写进 proposal「评审记录」块，
      按常规通道（机器 + 独立评审放行）执行归档，归档读数回填同一块
