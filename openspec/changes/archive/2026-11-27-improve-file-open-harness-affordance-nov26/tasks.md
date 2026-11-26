# Tasks: improve-file-open-harness-affordance-nov26

> 阶段门：节点 1 已过（Alex 2026-11-26「其他你理解是对的，请你安排」+ hover 文案追加）。
> 三条合同：①文件树普通点击 = 当前标签就地打开、⌘ 点击 = 新标签并保留当前标签；
> ②无标签时标题栏 harness 图标贴最右端（有标签时既有落位不变）；③D327 的悬停提示 /
> 可访问名改「Harness pane」/「Harness 面板」，中英同步。
>
> 顺序是硬约束：**先红后绿**——第 1 组判据必须先在未修代码上判红并留证，再进第 2 组实现。
> 本轮不执行真机、不更新像素基线、不 push / merge / 归档。证据落主仓
> `.local/missions/improve-file-open-harness-affordance-nov26/`。

## 1. 合同与红证据

- [x] 1.1 spec delta 落盘：`multi-tabs`「打开语义」MODIFIED（普通 / ⌘ 点击分流、双击与其它修饰键
      同单击）、`vault-workspace`「装载后恢复标签列表」MODIFIED（恢复场景的手势改 ⌘-点击，
      否则与新语义矛盾）、`ui-design-system` ADDED「无标签时标题栏动作钮贴右缘」、`harness`
      ADDED「标题栏 toggle 钮的悬停提示与可访问名」
- [x] 1.2 新增 `tests/unit/tree-open-intent.test.ts`：手势 → 打开意图的纯函数（metaKey = new，
      其余 = current；`shiftKey` / `altKey` / `ctrlKey` 不改变落点），未实现时导入失败 / 断言红
- [x] 1.3 新增 `tests/unit/harness-toggle-copy.test.ts`：D327 两档逐字（en `Harness pane` /
      zh `Harness 面板`）、不含 `Chat pane` / `Chat panel` / 「对话面板」；未改文案前红
- [x] 1.4 视觉结构红测：`tests/visual/scenes/titlebar-identity.spec.ts` 追加「空态动作钮贴右缘」
      断言（空 vault 与已装载 vault 无标签两态，钮右缘 = 视口右缘 − 12px；现落在 236px 处必红）；
      「有标签时右缘不变」保留既有断言
- [x] 1.5 视觉结构红测：`tests/visual/scenes/m149-tabs.spec.ts` 的打开意图用例改写为新合同
      （普通点击 1 个标签、⌘ 点击 2 个且当前标签内容 / dirty 保留、双击与单击同义），未修代码上红
- [x] 1.6 视觉红测：D327 断言改 `Harness pane` / `Harness 面板`（`m303-harness-panel` 等），
      未改文案前红
- [x] 1.7 红跑证据：`RED-*` 日志落 `.local/missions/improve-file-open-harness-affordance-nov26/`

## 2. 实现

- [x] 2.1 `src/tree.ts`：行点击按手势给意图（仅 `metaKey` → `"new"`，其余 `"current"`），
      纯函数与事件绑定共用同一判据；更新 `FileTreeCallbacks.onOpenFile` 的签名与注释
- [x] 2.2 `src/main.ts`：树回调按意图透传给 `openFile`（普通点击 → `"current"`、⌘ 点击 →
      `"new"`），同步更新 `openFile` 的意图注释
- [x] 2.3 `src/harness-panel.css`：`.lumir-hp-toggle` 在弹性行里贴右缘（`margin-left: auto`）——
      有标签时标签段已吃满空闲宽度，位移为 0；无标签时钮贴右缘
- [x] 2.4 `src/copy-data.ts` D327 改 `Harness 面板` / `Harness pane`，同步 `文案-Copy.md` 行；
      同一命令的速查标签 D648 与 ⌘⇧A 来由 D345 的 `harness chat pane` 一并改准（同一叙事，中英同步）
- [x] 2.5 清扫旧文案断言：`tests/visual/scenes/` 与 `scripts/acceptance/scenarios/` 里断言
      「对话面板 / Chat panel」的位置逐条改准（视觉场景 + 真机场景）

- [x] 2.6 `src/harness-panel.ts` 的 chip 看守补「路径」一维：同一会话就地换文档（普通点击 /
      链接跟随）时 chip 也刷新——新语义让这条路径成为主路径，既有 `m303`「上下文 chip 随文档
      切换刷新」在未修时红（全量结构第 605 条），修后绿

- [x] 2.7a `src/main.ts` 的树回调：当前标签 dirty 时普通点击退回「新开一个」（不丢修改、
      不弹拦截；判据是既有 `save-guard` 场景「保存冲突…切换被拦截」一步——未修时红）
- [x] 2.7b `src/tabs.ts` 的 `targetSessionFor("current")` 加守卫：当前标签是图片会话时退回
      「新开一个」（图片会话不能改判成文本会话；未修时 `m629`「切走再切回图片标签」全量结构
      第 717 条红，修后绿）

## 3. 绿跑与回归

- [x] 3.1 目标单测绿：`tree-open-intent` + `harness-toggle-copy` + 既有 `copy.test.ts` /
      `harness-activity-wiring.test.ts`
- [x] 3.2 视觉结构层定向绿：`LUMIR_VISUAL_STRUCTURAL=1` 跑 `titlebar-identity` / `m149-tabs` /
      `m303-harness-panel` / `m756-harness-activity-presence` / `harness-vault-activity`
      （chromium + webkit-realua，按场景配置）
- [x] 3.3 无标签标题栏的像素候选：跑像素层取 `*-actual.png` 候选落证据目录，**MUST NOT**
      `--update`；候选清单与「哪些基线需要 Alex 过目后更新」写进报告
- [x] 3.4 回归面：`tests/visual` 结构层全量——chromium 1625 passed / 1 skipped / 0 failed（4 workers，5.0m）；
      webkit-realua 子集 216 passed / 12 skipped；`editing-oracle` 的 IME 大文档 1 条在 2 workers 下超时、
      单跑 2/2 绿（环境时序 flake，与本 change 无关，证据 `GREEN-visual-structural-webkit.log` 与单独复跑）

## 4. 验收场景（新增 / 更新）

- [x] 4.1 更新 `scripts/acceptance/scenarios/14-tabs.md`（另含 `17-multi-vault-switch` 的第二个标签改 ⌘-点击）：普通点击 = 当前标签替换、⌘ 点击 =
      新标签并保留当前标签；后续依赖多标签的步骤改用 ⌘ 点击建立
- [x] 4.2 新增 `scripts/acceptance/scenarios/883-file-open-harness-affordance.md`（编号按并行批次
      核对结果取 883——880/880b/881/882 已被其他分支占用）：普通点击 / ⌘ 点击两态 +
      无标签时 toggle 贴右缘（可点性判据）+ hover 文案
- [x] 4.3 更新既有真机场景里的「对话面板」断言（148 / 264 / 253 / 252 / 725 / 127 / 868 等）
- [x] 4.4 `node scripts/acceptance/coverage.mjs` 重新生成覆盖表；
      `node scripts/acceptance/run.mjs --check` PASS
- [x] 4.5 **真机执行**：883 PASS 25 断言、14-tabs PASS 51 断言、17-multi-vault-switch PASS 59 断言
      （`.local/acceptance/2026-11-27-ux-goal/{883-file-open-harness-affordance,17-multi-vault-switch}/`
      与 `.local/acceptance/2026-11-27-ux-goal-r5/14-tabs/`，`status.txt` 均 PASS）

## 5. 门禁与静态校验

- [x] 5.1 `pnpm exec tsc --noEmit`（根）
- [x] 5.2 `cd tests/visual && ../../node_modules/.bin/tsc --noEmit`
- [x] 5.3 `bash scripts/docs-check.sh`
- [x] 5.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- [x] 5.5 `node scripts/acceptance/run.mjs --check`

## 6. 收尾

- [x] 6.1 证据（红 / 绿 / 候选截图 / 门禁日志）落主仓
      `.local/missions/improve-file-open-harness-affordance-nov26/`，不落 worktree
- [x] 6.2 在 mission 分支提交（不 push、不 merge、不归档、不动视觉基线）——commit `7df3a995`
- [x] 6.3 归档时同步 `openspec/specs/multi-tabs/spec.md` 的 Purpose 句——已在本归档提交中改为
      「单击 = 当前标签就地打开、⌘-点击 = 新标签并保留当前标签，双击 / 其它修饰键同单击」
- [x] 6.4 已知风险登记：普通点击替换 dirty 标签的未保存内容——**已在本 change 内以「dirty 时退回新开」
      消解**（不是另立项）；图片会话边界同样已用退回新开兜底。两者均写进 delta / proposal
