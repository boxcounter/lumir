# Tasks: harness-dir-link

> 阶段门（tower 指令）：**本阶段只做 §1**。§1.1–1.2 完成后用 TowerMission 报
> 「等待 Alex 提案评审」并停工；§1.3 通过后才进入 §2 起的实现。

## 1. 起草与提案评审

- [x] 1.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / `specs/file-tree/spec.md` / 本文件；
      起草期核实两项事实并写进 design §0：① 树侧 reveal 的既有原语（`FileTree.revealPath` /
      `ancestorChain` / `expandNode` / `scrollIntoView`）与两个缺口（会写当前行、无短暂高亮形态）；
      ② 目录集合在前端的可用形态——结论：以文件树模型为唯一判据，不新增目录索引、不新增 IPC
- [x] 1.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
      （2026-10-17 起草读数：`Totals: 25 passed, 0 failed`，退出码 0；`harness` 的 MODIFIED 增量带一条
      预期 INFO「archive would refuse this delta … not found」——原因与本 change 的归档顺序见 design §11，
      tower 需先归档 `harness-path-link`）
- [x] 1.3 等待 Alex 节点 1 评审（**硬门禁**：未通过不动实现代码）——2026-10-17 通过，六个起草期取值
      全部按提案倾向执行（尾斜杠可点 / 目录不消费 `:行号` / 只展开祖先不展开目标自身 / `--sel` 约
      1.2s 淡出 / 卡片目录同口径 / 目录与文件链接外观一致）

## 2. 前置（tower / 环境，实现开工前确认）

- [x] 2.1 扩 mission scope 至 `src/style.css`：目录定位的短暂高亮必须在样式层新增一条行态规则
      （复用 `--sel` 与 eink 的 `--sel-text`，不新增 token）。scope 未扩则 §5.2 无法落地
- [ ] 2.2 确认 `harness-path-link` 已归档（或已排进同批且顺序在前）：本 change 的 `harness` 增量是
      MODIFIED，归档目标是它写入 living spec 的 requirement

## 3. 识别层（`src/harness-path-link.ts`）

- [x] 3.1 `PathCandidate` 增加 `kind: "file" | "dir"`；解析入口从单一 `isVaultFile` 谓词扩展为
      「文件 / 目录」两类只读查询（不引入模块级状态）
- [x] 3.2 解析顺序：每个候选切片**文件先、目录后**；目录判定对单个尾斜杠归一（`text` 保留原文、
      `path` 去尾斜杠），`a/b//`、绝对路径、`..`、空段仍结构性拒绝
- [x] 3.3 行号后缀只对文件消费；目录候选的可点范围止于路径本身
- [x] 3.4 单测（`tests/unit/harness-path-link.test.ts`）：目录命中 / 文件命中 / 都不命中三态；尾斜杠
      归一与多斜杠拒绝；目录不消费 `:12`（与文件的 `:12` 成对对照）；紧贴中文的目录名收缩命中；
      `..` / 绝对路径仍拒绝

## 4. 数据源与装配（`src/tree.ts` / `src/main.ts`）

- [x] 4.1 `FileTree` 增加只读目录查询（模型里存在且 `kind === "dir"`；根 `""` 不算）；不碰 DOM、
      不发 IPC、不触发取数
- [x] 4.2 装配层把「是不是目录」与「定位目录」两条能力注入面板：前者转到 4.1 的查询（用就绪布尔守卫
      `createHarnessPanel` 早于 `tree` 赋值这一时序窗口），后者转到 §5 的目录定位
- [x] 4.3 文件索引（`vaultFilePaths` / `patchAttachmentPaths` / `setPathLinkIndex`）**零改动**
      ——不新增目录数组、不新增增量口径

## 5. 树定位（`src/tree.ts` + `src/style.css`）

- [x] 5.1 目录定位能力：复用 `ancestorChain`（含惰性祖先按需取数）+ `expandNode` + 
      `scrollIntoView({ block: "nearest" })`；不写 `currentPath`、不加 `is-current` / `aria-current`
- [x] 5.2 短暂高亮：行态类 + 计时器（约 1.2s）；同一时刻至多一行；重入重启计时；换 vault / 空态 /
      行被删时清理登记；内联编辑行只滚动不高亮
- [x] 5.3 并发守卫：自增令牌保证连续定位只有最后一次落地（旧调用 await 返回后不再展开 / 滚动 / 高亮）
- [x] 5.4 `src/style.css` 行态规则：底色 `--sel`、eink 下前景 `--sel-text`（名称与 caret 手工带上）、
      声明在 `:hover` 之后；不新增色值 / 字号 / 动效曲线
- [x] 5.5 单测（扩展 `tests/unit/tree-reveal.test.ts` 或新增文件，最小 DOM 替身）：祖先展开 + 只滚一次 +
      `block: "nearest"`；**当前行不变**（同一夹具上 `revealPath` 改当前行作对照）；不可达 / 取数失败
      是空动作；目标目录自身不展开、已展开不折叠；连点两次只认最后一次；高亮加 / 摘与编辑行不闪；
      高亮类不残留到换 vault 之后

## 6. 面板分发（`src/harness-panel.ts`）

- [x] 6.1 `HarnessPanelDeps` 新增「是否目录」与「定位目录」两条注入；`openVaultPath` 保持原样
- [x] 6.2 渲染上下文按目标类型分发：正文 / 行内代码用候选自带的 `kind`；工具卡片用同一 resolver
      判类型（文件 → 打开 + 行落点，目录 → 定位）；可点元素形态与可见文本不变，不新增文案 / 图标
- [x] 6.3 面板单测：目录候选产可点元素且点击分发到定位、文件候选仍分发到打开；卡片上的目录同口径；
      未命中的目录候选仍是纯文本（反向对照）

## 7. 真机验收（`scripts/acceptance/`）

- [x] 7.1 新增场景：运行期造「目录 + 其下文件」（`vaultWrite` 嵌套路径，留一拍等 watch），mock 回复里
      引用一个目录（含一个尾斜杠写法）；点击前判「子文件行不在 AX」；点击后判「子文件行出现 = 祖先已
      展开」、「标签数不变」、「其他标签仍是前台」、「编辑器文本不变」；截图见证高亮
- [x] 7.2 **回扫既有场景 161**：它今天断言「真实目录不产出可点元素」（`ax: { not: AXButton (path-link-dir) }`）
      与正文里的「目录不链接化」说明——本 change 会翻转该期望，必须改准（断言 + 正文），否则 161 必红
      且归因会被带偏
- [ ] 7.3 本地真机跑 161 + 新场景，证据落 `test-results/acceptance/`（git 外），报告附可 `ls` 的路径

## 8. 门禁与收口

- [x] 8.1 `scripts/gate.sh quick` 全绿；报告照抄 `GATE RESULT` 原文行 + 退出码
      （2026-10-17 读数：`GATE RESULT: 9/9 PASS（SKIP 1）`，退出码 0；SKIP 项 = `tsc-visual`
      「tests/visual 依赖未装」，装依赖后由 §8.2 的 visual 档覆盖）
- [x] 8.2 动过 `src/style.css` ⇒ 另跑 `scripts/gate.sh visual`，同样照抄原文行；基线更新若需要，先经
      Alex 过目（基线更新是人肉裁决点）
      （2026-10-17 读数：`GATE RESULT: 12/12 PASS（SKIP 0）`，退出码 0；`visual-regression` 593s。
      新行态类 `.ft-row.is-revealed` 在静态场景里永不在场，基线无需更新）
- [ ] 8.3 文档回改：tasks 勾选状态、覆盖声明与实际 PASS 证据逐条对齐（REVIEW.md『覆盖声明超出真实验证』条）
