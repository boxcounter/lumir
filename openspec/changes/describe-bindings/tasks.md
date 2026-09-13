# Tasks: describe-bindings

## 1. 命令与键位

- [x] 1.1 `src/keys.ts`：新增全局命令 id `app.describe-bindings`（`GLOBAL_COMMAND_IDS`）与默认绑定 `⌘/`（`scope: "global"`），`doc` 写明来由（mac 帮助惯例实为 `⇧⌘?`、`⌃H` 已被后删字符占用）
- [x] 1.2 `src/main.ts`：命令实现落到装配层（打开 / 关闭面板），进 `CommandRuntime`（编译期合同：表里每条绑定都有归属命令）
- [x] 1.3 `[keys]` 可重绑 / 解绑：走既有 `applyKeyOverrides`，不新增配置面、不新增第二套键位写入路径

## 2. 面板内容（生效表）

- [x] 2.1 `applyKeyConfig` 记录 `applyKeyOverrides` 的产物（`effectiveBindings`），面板渲染这一份；MUST NOT 在面板里重新合并一遍默认表
- [x] 2.2 功能分组：移动与选择 / 扩选 / 删除 / kill-yank / 翻屏 / 撤销 / widget / 全局（8 组覆盖全部命令；未归组命令兜底进「其他」，新增命令不会静默消失）
- [x] 2.3 每条绑定一行：键位写法 + 命令 id + 来由（`doc`，含「用户配置重绑」的来由）
- [x] 2.4 有实现但无任何绑定的命令（被解绑的）仍列出并标注「未绑定」
- [x] 2.5 打开时重读生效表（配置重挂后不留旧表）

## 3. 打开与关闭

- [x] 3.1 `⌘/` 打开面板并接管焦点（`panel.focus()`），打开态再按即关
- [x] 3.2 关闭路径三条：`Escape`、`⌃G`、点击遮罩；点击面板本体不关
- [x] 3.3 关闭后焦点交还编辑器（`editor.view.focus()`），编辑键恢复生效
- [x] 3.4 关闭键就地消费（不进 `KEY_BINDINGS`，理由：一个 token 一条绑定且这两个 token 已被 editor 作用域占用）；token 匹配复用 `keyToken` 的归一化口径
- [x] 3.5 面板打开期间 `editor` 作用域键不穿透到文档（焦点在遮罩上，作用域天然不命中——以场景断言，不靠假设）

## 4. 视觉与文案

- [x] 4.1 `src/style.css`：面板样式只用既有排版基线与 CSS 变量（占位实现，不引入新视觉语言），补齐 `[hidden]` 的显式规则
- [x] 4.2 `文案-Copy.md`：新增用户可见文案按编号追加（D63 标题 / D64 分组标题 / D65 未绑定标注 / D66 未绑定的行说明 / D67 关闭提示）

## 5. 回归场景与规格制品

- [x] 5.1 `tests/visual/scenes/m133-describe-bindings.spec.ts`：打开与分组渲染、生效表口径（重绑）、解绑后的「未绑定」标注、不穿透 + 关闭后恢复、三条关闭路径
- [x] 5.2 面板截图基线（`toHaveScreenshot`）入库，人工过目
- [x] 5.3 既有场景零基线更新（面板默认隐藏，不改既有视觉）
- [x] 5.4 openspec 制品：proposal（Why / What Changes / Non-goals / Impact，含 ⌘/ 来由与「关闭键不进表」的如实记录）/ spec delta（keymap-commands 一条 ADDED requirement）/ 本 tasks

## 6. 验证

- [x] 6.1 `pnpm build`（tsc --noEmit + vite build）通过
- [x] 6.2 `LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh` 全量：新增 5 条场景全绿、既有场景零基线更新；唯一失败项是 `lists.spec.ts` 的 100k 密集项性能预算场景（p95 52.1ms > 40ms），已在**基线 commit（不含本 change 改动）**上复现同一条失败，判定为既有环境相关抖动，另报 finding（不改本 change 范围外的测试阈值）
- [x] 6.3 `cargo test`（`src-tauri/`）通过
- [x] 6.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 6.5 自查：无真实 vault / 真实 `~/.config/lumir/` 读写（场景用桩）；无 scope 外文件改动

## 7. 评审 round 1 修复（p2-2items → fix-then-merge）

- [x] 7.1 P2-1：文案册编号引用错位一行——deck 实为 D63–D67 五条，proposal 的 What Changes #6 与 Impact、tasks 的 4.2 三处原文写「D63–D66」且把「关闭提示」映射到 D66（实为 D67，D66 是未绑定的行说明）。三处改为 D63–D67 并更正 4.2 的逐条映射
- [x] 7.2 P2-2：spec delta 中「SHALL 就地消费」与「MUST NOT 在表外注册与表内绑定相同的物理组合」字面自相矛盾。措辞改为「SHALL 由面板在模态遮罩上就地消费，MUST NOT 为同一物理组合在统一键位表之外注册**第二条分发绑定**」，并补一句说明就地消费与表内分发互斥、不构成两份分发映射（实现与场景未动）
- [x] 7.3 复跑 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过；本 round 只动 openspec 制品（无 `.ts` / `.css` 改动），故不再复跑 build / 视觉 / cargo

