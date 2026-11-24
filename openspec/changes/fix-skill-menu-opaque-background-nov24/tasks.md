# Tasks: fix-skill-menu-opaque-background-nov24

## 1. 修复

- [x] 1.1 `.lumir-hp-skill-menu` 的 `background` 由 `var(--bg-raise, var(--bg))` 改为 `var(--preview-bg)`；只改这一行，不动尺寸 / 层级 / 字体 / 键位 / 其他浮层
- [x] 1.2 `rg` 确认 `--bg-raise` / `--bg` 全仓无定义、`--preview-bg` 三主题均有值；修复不新增 token、不加别名
- [x] 1.3 不改产品 TS（`git diff --stat` 里没有 `src/**/*.ts`）

## 2. 判据（断言先行）

- [x] 2.1 `tests/visual/scenes/skill-hybrid.spec.ts` 新增三主题用例：计算背景 = 该主题 `--preview-bg` 的写死期望值且 alpha = 1
- [x] 2.2 同三条用例含像素穿透判据：浮层背后换高对比配色后浮层可见面逐字节不变
- [x] 2.3 仪器反证：强制浮层 `background: transparent` 时同一对比必须出现差异（判据有区分度）
- [x] 2.4 修前红：把 CSS 临时回退成缺陷写法，最终判据形状三主题全红，失败点落在像素判据
- [x] 2.5 修后绿：修复形态下 `skill-hybrid.spec.ts` 12/12 通过；既有 9 条 Skill 用例逐条仍绿

## 3. 验证

- [x] 3.1 `scripts/gate.sh quick`
- [x] 3.2 `scripts/gate.sh visual`（完整视觉，隔离端口）
- [x] 3.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- [x] 3.4 `bash scripts/docs-check.sh`
- [x] 3.5 `git diff` 复核改动面：一行 CSS + 场景新增 + 本 change 四份制品，无越界
- [ ] 3.6 真机复验（主会话执行，本 worker 不启动真机）：跑验收场景
      `726-harness-skill-hybrid-invocation`，在候选打开时留截图；核对 light / dark / eink 三主题下
      候选浮层不透底（真机切主题走真实配置通道）
