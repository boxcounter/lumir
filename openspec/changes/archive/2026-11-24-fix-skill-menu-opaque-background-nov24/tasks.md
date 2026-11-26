# Tasks: fix-skill-menu-opaque-background-nov24

## 1. 修复（Skill 样式的 token 错引用簇）

- [x] 1.1 `.lumir-hp-skill-menu` 的 `background` 由 `var(--bg-raise, var(--bg))` 改为 `var(--preview-bg)`；只改这一行，不动尺寸 / 层级 / 字体 / 键位 / 其他浮层
- [x] 1.2 `.lumir-hp-skill-name` 的 `color` 由 `var(--text-1)` 改为 `var(--text)`；不动其他字色档
- [x] 1.3 `rg` 确认 `--bg-raise` / `--bg` / `--text-1` 全仓无定义、`--preview-bg` / `--text` 三主题均有值；修复不新增 token、不加别名
- [x] 1.4 不改产品 TS（`git diff --stat` 里没有 `src/**/*.ts`）

## 2. 像素判据（浮层表面）

- [x] 2.1 `tests/visual/scenes/skill-hybrid.spec.ts` 新增三主题用例：计算背景 = 该主题 `--preview-bg` 的写死期望值且 alpha = 1
- [x] 2.2 同三条用例含像素穿透判据：浮层背后换高对比配色后浮层可见面逐字节不变
- [x] 2.3 仪器反证：强制浮层 `background: transparent` 时同一对比必须出现差异（判据有区分度）
- [x] 2.4 修前红：把 CSS 临时回退成缺陷写法，最终判据形状三主题全红，失败点落在像素判据
- [x] 2.5 修后绿：修复形态下 `skill-hybrid.spec.ts` 12/12 通过；既有 9 条 Skill 用例逐条仍绿

## 3. 静态防线（token 引用链）

- [x] 3.1 新增 `tests/unit/css-token-references.test.ts`：扫 `src/**/*.css` 的定义与全部 `var()`，按「CSS 定义 / 运行时赋值 / 有效回退链」求值
- [x] 3.2 回退链求值语义：主引用未定义时回退里每个 `var()` 都必须解析；主引用已定义时死回退不误报；空回退判红
- [x] 3.3 运行时白名单只含 `--lumir-hp-scale` / `--toc-depth` / `--cm-lp-table-columns`，并双向核对（TS 赋值点 + CSS 引用）
- [x] 3.4 反向输入造红：bare 引用（`--text-1`）、未定义回退链（`--bg-raise` / `--bg`）
- [x] 3.5 正向输入判绿：`var(--border-strong, var(--border))`、字面量 / 多级回退、运行时 token、跨文件定义、注释里的 `var()`（反向排除）
- [x] 3.6 修前红：`--text-1` 未修时该测试真实判红（`src/harness-panel.css:2772 --text-1`，1 failed / 9 passed）
- [x] 3.7 修后绿：改为 `var(--text)` 后 10/10 通过，诊断行记录扫描面读数

## 4. 验证

- [x] 4.1 `node tests/unit/run.mjs`（前端单测全量）
- [x] 4.2 `scripts/gate.sh quick`
- [x] 4.3 `scripts/gate.sh visual`（完整视觉，隔离端口）
- [x] 4.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- [x] 4.5 `bash scripts/docs-check.sh`
- [x] 4.6 `git diff` 复核改动面：两行 CSS + 两个测试文件（新增一、改一）+ `tests/unit/README.md` + 本 change 五份制品，无越界
- [x] 4.7 真机复验（主会话执行，本 worker 未启动真机）：验收场景
      `726-harness-skill-hybrid-invocation` **1/1 PASS**（36 断言、52.6s）——覆盖候选打开 / 方向键选择 /
      显式 ref 注入的真实 WKWebView 路径；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-24-skill-menu-background/`，
      日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/skill-hybrid-nov24/acceptance-726-background.log`。
      浮层底色与字色档的机器判据由 chromium 像素层（I1–I3）与静态 token 层（I4）承担；726 的截图证据只有
      会话清单一张（`shots/01-03-恢复会话清单.jpeg`），未声称真机已逐主题核外观
