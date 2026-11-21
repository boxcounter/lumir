# Tasks: fix-list-enter-indent-nov21

## 1. 实现

- [x] 1.1 `src/enter-indent.ts`：md 的散文 / 列表续行回落改为裸换行（`insertNewline`），
      只有围栏 / 缩进代码块继续走 `insertNewlineAndIndent`；回落分支显式挡只读会话
- [x] 1.2 `src/enter-indent.ts`：裸行空项退出的删除起点前移到行首缩进之后（保留合法 `>` 引用
      前缀、丢掉纯空白缩进），光标落在删后位置
- [x] 1.3 `src/preview/lists.ts`：`markerTextAt` 把行首前缀拆成 `quote`（`>` 引用）与
      `indent`（空白）两段，仍是一处真源；裸行续行沿用两段原文（行为逐字节不变）
- [x] 1.4 更新模块头 / 行内注释与 `docs/specs/lists.md` B2，使口径与实现一致

## 2. 验证

- [x] 2.1 单测：`tests/unit/enter-indent.test.ts` 覆盖报告矩阵第 7/12 行（无行首空白、光标列 0）
      与第 2/5/6/8 行、代码块、引用的对照；`tests/unit/ordered-list-auto-mode.test.ts` 跟进
      `quote` / `indent` 字段；`node tests/unit/run.mjs` 全绿（1684/1684）
- [x] 2.2 视觉层：`tests/visual/scenes/m264-enter-auto-indent.spec.ts` 断言 doc，
      `tests/visual/scenes/lists.spec.ts` 断言「下一行文本左缘 = 顶层段落左缘」并带
      项内续行 / 真列表 / 围栏 / 引用四组对照；端口 4297 跑通（30/30）；旧源码上两条修复
      判据红、两条对照绿
- [x] 2.3 `pnpm exec tsc --noEmit`、`pnpm exec tsc -p tests/unit/tsconfig.json`、
      `tests/visual` 的 `tsc --noEmit` 三份全绿
- [x] 2.4 `bash scripts/docs-check.sh` 与
      `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 2.5 `node scripts/acceptance/run.mjs --check` 通过（新增场景 269 + 覆盖表重生成）
- [x] 2.6 真机验收场景 269 由主会话统一执行（本任务不自行跑真机；执行记录落
      `.local/acceptance/`）：`269-list-enter-indent` PASS（16 断言，0 FAIL），证据
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-requirements-batch/269-list-enter-indent/`

## 3. review r1 返修（2026-11-21）

- [x] 3.1 P2-1：md 回落保留上游 leading-whitespace 归一化、但不把行首空白复制给新行；
      行首 / 空白内 / 末端光标与行尾空白一组 doc+selection 断言
- [x] 3.2 P2-2：代码块判定改为按行取行首（右邻）、首个非空白、行尾（左邻）三处锚点，
      行首 / 缩进内 / 正文起点 / 行尾一组边界断言（含非首行代码块与围栏）
- [x] 3.3 P2-3：md 换行改为一次 `state.changeByRange` 按每 range 上下文分派；混合多光标
      两种 mainIndex 顺序各断言一次（段落不缩进、代码行保留缩进）
- [x] 3.4 P2-4：只读守卫统一到 `enterWithAutoIndent` 入口（早于裸行与上游委派）；补真实
      列表 / 引用 / 项内续行只读断言。归因：base 存量行为，不是 97edc72d 的新回归
- [x] 3.5 P3-1：同步 `tests/unit/editing-oracle-model.ts` 的普通 Enter 合同与注释，加入
      带行首空白的最小确定性对拍（含非首行）
- [x] 3.6 P3-2：delta 的历史引用改指 `openspec/changes/archive/2026-09-28-enter-auto-indent/`
      的 `proposal.md` D1 与 `design.md` §1 / §1.3 / §4，不再指向本 change 不存在的制品
- [x] 3.7 新判据对旧实现（97edc72d）反向验证为红：6 组全红，恢复后 37/37 绿

## 4. review r2 文字收口（2026-11-21）

- [x] 4.1 P2-1：delta 的多光标条款收窄到「md 的普通段落 / 代码块换行回落」，明确列表 / 引用
      续行与裸 marker 行的混合多光标不在本 change 内（相关实现未改）
- [x] 4.2 P3-1：`enterMarkdownNewline` 的理由改为真实归因——上游本身逐 range 取缩进，本地
      `changeByRange` 是因为调用方需要在「散文零缩进」与「代码块行首缩进」之间按 range 选模式
