# Tasks: heading-hierarchy-ramp

## 1. token 层与 tokens 文档

- [x] 1.1 `src/style.css`：`--fs-h1` 19→21、`--fs-h2` 16.5→18；新增 `--fs-h3: 16px`、
  `--fs-h4: 15px`、`--fs-h5: 14px`、`--fs-h6: 13px`（语义位独立命名，不跨语义引用
  `--fs-body`/`--fs-ui`，见 design §3.1）
- [x] 1.2 `docs/specs/design-tokens-v1.md` 按 design §3 落成修订 diff：§字号阶梯
  （删 19/16.5、增 21/18/16/14、命名行补 h3–h6）、§字重阶梯（650 档语义改 h1–h6，
  600 档去掉 h4–h6）、§字距（标题负字距序列改写）、§间距（补 h4–h6 块距出处）、
  §统计（103→105）

## 2. 编辑器渲染层

- [x] 2.1 `src/preview/theme.ts:117-122`：`cm-lp-h1..h6` 按 design §3.6 逐档改值
  （em 比值机制不变；H6 去 italic 与 `--text-2`）
- [x] 2.2 `src/preview/livePreview.ts`（现 :894-898 一带）：H1–H3 块距保持 24/9、20/6、
  16/5 不动；H4–H6 块距由 0 补为 14/5、12/4、10/4
- [x] 2.3 注释同步：`theme.ts:111-116`「h4–h6 不在阶梯里」等过时注释按新口径改写

## 3. 视觉门禁与基线

- [x] 3.1 `tests/visual/scenes/typography.spec.ts` 的 heading 计算属性断言更新为六档
  逐档口径（H1–H6 字号/字重/字距；含负向断言：19px/16.5px 与 italic 不在场）
- [x] 3.2 整页基线识别与重建（Alex 2026-09-26 过目批准后入库，19+6 张分两波逐张核对；
  入库后 `gate.sh visual` 全量含像素层 12/12 绿）
- [x] 3.3 基线更新前截图经 Alex 过目（2026-09-26 批准，过目包
  `test-results/m228/baseline-review/index.html` + wave2.html；sha256 对账表同目录）

## 4. 真机验收（随实现同 PR）

- [x] 4.1 新增 `scripts/acceptance/scenarios/37-heading-hierarchy.md`：H1–H6 fixture
  （中文标题 + 正文混排），计算属性断言六档取值（15px 基准下 21/18/16/15/14/13、字重
  全 650）、H6 无 italic、H4–H6 块距非零；负向断言旧值 19/16.5 不在场
  （编号 37：36 已由 live-theme-switch 占用并合并；registry 口径 36=theme、37=heading）
- [x] 4.2 `node scripts/acceptance/run.mjs` 全量复跑：**42/45 PASS**（含 37/38 双 PASS）。3 条红
  （20/23 图片宽度判据区间失配、32 vault 路径断言）经 master 对照实验证实为既有红、与本
  change 无关（master 同跑 0/3、失败签名逐条一致）——已单独立项登记，不在本 change 修

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.2 `scripts/gate.sh quick` 10/10 绿；`scripts/gate.sh visual` 全量（含本地像素层）
  基线入库后 12/12 绿（visual-regression 345s PASS）
- [x] 5.3 真机复验：场景 37 两次 PASS（首跑 + 探针删除后复跑），截图证据在
  test-results/acceptance/2026-09-25/37-heading-hierarchy/shots/；H1–H6 混排层级辨识度
  手感项归 Alex（套件只留证据）
