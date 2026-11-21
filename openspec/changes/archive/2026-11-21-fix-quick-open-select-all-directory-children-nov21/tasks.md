# Tasks: fix-quick-open-select-all-directory-children-nov21

> 阶段门：节点 1 的正式裁决原话由 tower 回填（mission 指令已携带 Alex 原始需求并授权实现）。
> 顺序是硬约束：**先红后绿**——新增判据先在改动前的代码上判红并留证，再进实现。
> 本 worker 不跑真机、不更新视觉基线。

## 0. 提案与边界

- [x] 0.1 起草 `proposal.md` / `design.md` / 本文件 / `specs/quick-open/spec.md`
- [x] 0.2 边界假设写进 proposal 的边界表（尾斜杠 / 文件 / 不存在目录 / vault 外 / vault 根 /
      大小写 / 子目录 / 空目录）
- [x] 0.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与
      `bash scripts/docs-check.sh` 通过
- [x] 0.4 节点 1 正式裁决原话与时间回填 proposal 的评审记录（tower / Alex）：Alex 2026-11-21
      需求批原话「Cmd+P Cmd+A 全选 + 目录直接子级提示/筛选」+「请你继续」，已回填进 proposal
      的「评审记录」

## 1. 先红（改动前的代码）

- [x] 1.1 单测新增目录语境判据（`resolveQuickOpenSync(...).directory`、`notes/` 的目录断言），
      在改动前代码上判红：`.local/missions/quick-open-nov21/unit-RED-before-fix.log`
      （2 failed / 其余通过；失败原因为 `directory === undefined`——当时把 `notes/` 的判决也一起
      断言成 `dir`，实现后按「不改 Enter」收敛为 invalid + `directory`，见 3.3）
- [x] 1.2 浏览器场景新增 ⌘A / 目录直接子级 / 尾斜杠 / 中文长路径 / 不存在目录五组，在改动前代码上
      判红：`.local/missions/quick-open-nov21/visual-RED-before-fix.log`
      （4 failed / 18 passed：⌘A 的合成 keydown 没有 `preventDefault`；目录输入混入深层后代与
      `notes-extra`；`notes/` 仍走子串匹配；中文目录同样混入深层与同前缀兄弟）
- [x] 1.3 红跑判据有区分度：⌘A 用「合成 keydown 的 `defaultPrevented`」证明没有任何一层接管；
      目录用**逐条文本**断言（不是计数），深层后代与同前缀兄弟目录必须分别消失
- [x] 1.4 既有「非目录查询一次 Enter 打开游标候选」在改动前是绿的（红跑 18 passed 含相关用例），
      证明新增判据没有把既有打开行为一起判红

## 2. 实现

- [x] 2.1 `QuickOpenResolution.directory`：目录判决（`classifyVaultPath` → `dir`）带出目录路径；
      尾斜杠目录断言（`explicitDirectoryPath` + `isDir`）同样带出
- [x] 2.2 `directChildIndices(files, dir)`：父目录逐字相等、边界 `/`、只取一层、保持索引序
- [x] 2.3 `render` / `scheduleProbe` 统一走 `candidateHits`：有 `directory` 用直接子级，否则用既有
      `filterIndices`；候选来源与上限逻辑不变
- [x] 2.4 提示行：目录语境改用 `quickOpenDirectoryHint`（D943 有子级 / D944 截断 / D945 空目录），
      空态文案与可见性口径不变
- [x] 2.5 `confirm`：裸 `notes`（`verdict.kind === "dir"`）走既有两段式——第一次揭示、第二次打开
      游标候选；尾斜杠 `notes/`（`invalid` + `directory`）有候选时一次打开、无候选时揭示目录原因；
      其余 Enter 分支不改
- [x] 2.6 popover `keydown` 新增 `Cmd-A`：`preventDefault` + `input.select()`；组合期早退、
      其余文本编辑键不拦截
- [x] 2.7 文案 D943–D945 进 `src/copy-data.ts` 与 `文案-Copy.md`（含取号沿革、消费点映射、末位
      更新为 D945）

## 3. 修后绿

- [x] 3.1 单测补 `directChildIndices` 与目录语境提示的判据（一层、深层、同前缀、中文 / 长路径、
      空目录、三档提示），全量 `pnpm test` 通过（1686 tests / 0 failed；日志
      `.local/missions/quick-open-nov21/unit-final.log`）
- [x] 3.2 浏览器场景全绿：`LUMIR_VISUAL_PORT=4283 scripts/visual/run.sh scenes/quick-open.spec.ts`
      → 26 passed（r1 后日志 `.local/missions/quick-open-nov21/visual-r1.log`）。其中
      「目录没有直接子级文件」用例补于绿阶段（D945 分支），目录语境的**红**由同一分支的深层后代 /
      前缀兄弟 / 尾斜杠用例代表（红跑日志已留证）
- [x] 3.3 既有 `notes/` 场景保持「一次 Enter 打开游标候选」的判据（尾斜杠只改筛选与提示）；
      另补「非目录查询一次 Enter 打开游标候选」与「裸目录 `notes` 两段式」两条，证明两种既有
      Enter 行为都不回归
- [x] 3.4 三份 tsc 通过：根 `tsc --noEmit`、`tests/visual` 的 `tsc --noEmit`、
      `tsc -p tests/unit/tsconfig.json`（r1 后日志 `tsc-root-r1.log` / `tsc-visual-r1.log` /
      `tsc-unit-r1.log`）
- [x] 3.5 不改视觉基线（本 change 只改提示行文本与候选集合，`quick-open` 场景无像素基线）

## 4. 验收场景（本 worker 不跑真机）

- [x] 4.1 新增 `scripts/acceptance/scenarios/230d-quick-open-select-all-dir-children.md`
      （item 655，与 230a–230c 同组）：⌘A 全选后替换键入、目录直接子级提示 / 深层后代不混入、
      裸目录两段式 Enter
- [x] 4.2 `node scripts/acceptance/coverage.mjs` 重新生成 `COVERAGE.md`（246 个场景 / 222 个
      item；row 655 列出 230d）
- [x] 4.3 真机执行 `node scripts/acceptance/run.mjs 230d`（由 tower 在批次收尾统一安排；本 worker
      无真机时段）：`230d-quick-open-select-all-dir-children` PASS（9 断言，0 FAIL），证据
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-requirements-batch/230d-quick-open-select-all-dir-children/`

## 5. 收尾

- [x] 5.1 提交产品改动到 mission 分支（本 worker 不 push、不操作主仓产品文件 / 主仓 dev 实例 /
      真实 vault）
- [x] 5.2 独立 reviewer clean / merge（tower 安排）：独立 reviewer agent-35 判 `clean/merge`，无
      P1 / P2，绑定 integration tip `7d632e03`；评审文件
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/navigation-batch-nov21/review-final.md`

## 6. r1 评审处置（review `quick-open-nov21/review-r1.md`）

- [x] 6.1 **P2-1**：230d 的 ⌘A 值判据锚到 AX value 的终止处
      （`Value: z(?=[ \t]*(?:@|actions=|\(focused\)|$))`；AX dump 的 `Value: …` 后还有 bbox /
      actions / focused，裸 `$` 会误判红）。在 `scripts/acceptance/lib/execute.test.mjs` 增加
      matcher 自验：`z` 判绿、`zabc` / `abcz` 判红，并反向证明旧「只判包含」判据对 `zabc` 假绿。
      `node --test --test-name-pattern 230d scripts/acceptance/lib/execute.test.mjs` PASS；
      `docs-check` 的验收套件自测 192 passed。
- [x] 6.2 **P2-2**：delta 新增 MODIFIED「结果区与 Enter 的判决同源（直接打开行）」整块（从 living
      逐字复制后改）：两段式限定为 `verdict.kind === "dir"` 的裸目录；尾斜杠目录断言沿用候选打开，
      并补「尾斜杠目录沿用候选打开」场景。`node scripts/openspec-archive-check.mjs --change
      fix-quick-open-select-all-directory-children-nov21` PASS（2 条 MODIFIED / 33 段 / 无静默丢段）；
      `validate --all --strict` 35 passed。
- [x] 6.3 **P3-1**：tasks 2.5 已改为「裸 `notes` 两段式；`notes/` 有候选一次打开、无候选揭示目录
      原因」。
- [x] 6.4 **P3-2**：浏览器场景补「组合期 ⌘A 不消费、不改选区（含 keyCode 229）」与「⌃A 不被浮层
      消费」两条；单测补 `NOTES/`、`notes//` 不进入目录语境与 `/V/notes/` 折叠根前缀进入目录语境。
- [x] 6.5 r1 后读数：三份 tsc 0；`pnpm test` 1686 passed；quick-open spec 26 passed；
      `docs-check` PASS；`validate --all --strict` 35 passed；`acceptance --check` 246 场景
      （230d CHECK PASS）。证据见 `.local/missions/quick-open-nov21/*-r1.log`。
