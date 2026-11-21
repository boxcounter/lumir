# Tasks: fix-bare-url-cjk-boundary-nov21

## 1. 实现与测试

- [x] 1.1 在 `src/preview/links.ts` 的 `literalLinkOfNode` 加裸 URL 边界：目标在首个非 ASCII
      字符前结束；显式形态（`Autolink` / `LinkReference`）不裁；`literalLinkAt` 拒绝边界之后的
      位置。
- [x] 1.2 先写修前红、修后绿的单测：中文 / 全角标点 / 查询值终止；拉丁 URL 合法字符与百分号
      编码完整保留；角括号与定义行保留中文；边界之后的位置不命中。
- [x] 1.3 新增 chromium 视觉场景：装饰区间、`title`、⌘-Click 目标、中文内部 ⌘⏎ 无操作、显式
      语法不裁、`EditorState.doc` 不变；不新增像素基线。
- [x] 1.4 新增 / 更新真机验收场景（`269-url-paste-and-cjk-boundary-nov21` 的 A 段），并由
      `coverage.mjs` 重生成覆盖表。

## 2. 验证

- [x] 2.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 2.2 `pnpm exec tsc --noEmit` 通过
- [x] 2.3 `node tests/unit/run.mjs` 全绿（含 `literal-link.test.ts` 新增用例）
- [x] 2.4 `LUMIR_VISUAL_PORT=4282` 跑受影响 Playwright spec：新场景 7/7 PASS；既有 `render-link` 结构 / 行为 19/19 PASS，2 条整页像素为环境级字形差异（证据 `playwright-render-link.txt`，未更新基线）
- [x] 2.5 `node scripts/acceptance/run.mjs --check` 与 `coverage.mjs --check` PASS
- [x] 2.6 未更新任何视觉基线；`src/style.css` / `tests/visual/baselines/**` 不在 diff 内
