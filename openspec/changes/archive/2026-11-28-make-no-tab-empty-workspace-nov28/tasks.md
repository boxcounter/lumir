# Tasks: make-no-tab-empty-workspace-nov28

> 开工前先过 `REVIEW.md`，重点核对自己的改动面：『同一语义两处真源』（「有没有标签」只留一处读数）、
> 『断言等价于子串』（空态用例要有「有文档」的对照面）、『读不到当成空』（焦点 / 可编辑性读数缺失
> 一律 FAIL）、『标题栏 mousedown preventDefault』（本 change 不碰标题栏监听）。

## 1. 无路径会话是结构性只读空工作区

- [x] 1.1 `src/editor.ts` 的 `makeSession`：无路径会话 `editable=false`、`structuralReadOnly=true`；
      `reloadSession` 装载有路径文档时按既有表达式恢复并清结构只读。
- [x] 1.2 `src/main.ts` 的 `renderAllTabStrips`：`structuralReadOnly = foreground.path === undefined ||
      firstRunTipsVisible`；`editable = !structuralReadOnly && isEditablePath(path)`。
- [x] 1.3 删除 `src/pane-layout.ts` 的 `paneBlocksInput` / `emptyPaneGuideVisible` 及其过时注释；
      「有没有标签」统一取 `visibleTabsOf`（从 `src/tabs.ts` 导出）。

## 2. 空工作区表面与共享 tips

- [x] 2.1 `createPaneHandle` 为每个 doc pane 建 `.pane-empty-workspace`，与首启共用
      `createWorkspaceTips()`；去掉旧水印、Open / New 按钮与通用快捷键目录。
- [x] 2.2 在场判据：该 pane 无带路径标签；首启 / notice 覆盖宿主 pane 时普通副本让位。写入点与
      `renderAllTabStrips` 同一个 `hasTabs` 读数。
- [x] 2.3 四条固定为 Outline / Quote / Wikilink / Harness；只从默认表派生两条产品特有键位，
      中英文说明共用文案真源，布局按容器容量退让。
- [x] 2.4 删除 `showEmptyVaultState` / D107 分支：空 vault 与普通无 Tab 同一表面；
      `syncWidthHandleVisibility` 在空工作区不显示栏宽手柄。

## 3. 焦点落点

- [x] 3.1 `focusDocPaneEntry(paneId)`：首启 / 空工作区 → 静态 region，有文档 → 正文（M280 口径）。
      复合句柄、标签条、分栏 / 切 pane / 收起 pane、Close All、各浮层 `restoreFocus` 全部改走它。
- [x] 3.2 `tabs.closeTabNow` 关闭最后一个可见标签后交还一次焦点（落 region，不落正文 / body）。
- [x] 3.3 Quick Open 的取消 / 关闭经同一入口把焦点还给空工作区 region；成功打开后仍聚正文。
- [x] 3.4 被覆盖编辑器宿主同步 `inert`，正文退出 Tab 序、程序焦点与读屏树；region 仅
      `tabindex=-1`，不为留焦点伪造按钮。

## 4. 删除不可达的旧分支

- [x] 4.1 `src/save-controller.ts`：`guard()` 的无路径分支改为直接放行；`save()` 的无路径 dirty
      反馈删除；`reportUnsaveable` 只服务有路径未登记 revision（D234）。
- [x] 4.2 `src/tabs.ts`：`targetSessionFor` 的「dirty 草稿不复用」条件删除（无路径恒 clean）；
      相关注释按新身份改准。
- [x] 4.3 文案：新增四条共享说明；删除 D107 / D233 / D369 / D882、Open / New 与通用提示旧文案，
      编号不复用。

## 5. 规格与验收制品

- [x] 5.1 `specs/` 增量：`pane-layout`（REMOVED 旧两条 + ADDED 空工作区）、`multi-tabs`
      （REMOVED 未命名 dirty 守卫 + ADDED 空工作区与 dirty 判定 + MODIFIED Close All 焦点）、
      `fs-io`（MODIFIED 不可保存反馈）、`first-run-onboarding`（MODIFIED 首启构成 + Purpose）、
      `keymap-commands`（MODIFIED 行号条款表述 + 右键复制的不可达表述）、
      `quick-open`（ADDED 空工作区入口与焦点归还）、`file-tree`（MODIFIED 默认名条款的不可达表述）。
- [x] 5.2 更新 885 / 877 / 263 / 79 / 50：改为共享 tips、无按钮 / 通用提示、region 焦点与
      既有右键新建；静态 `--check` 通过，真机不在本批运行。
- [x] 5.3 `docs/backlog.md`：删除已裁的 M416「未保存新文档」条目；补本 change 的归档跟踪条目。

## 6. 验证

- [x] 6.1 目标单测：`node --test tests/unit/pane-layout.test.ts tests/unit/save-controller.test.ts
      tests/unit/tabs.test.ts tests/unit/tab-menu.test.ts tests/unit/line-numbers.test.ts` 通过。
- [x] 6.2 根 `pnpm exec tsc --noEmit` 与 visual `tsc -p tests/visual/tsconfig.json --noEmit` 通过。
- [x] 6.3 前端全量 `pnpm test` 通过。
- [x] 6.4 结构层视觉（目标场景，`LUMIR_VISUAL_STRUCTURAL=1`）：`no-tab-empty-workspace-nov28`、
      `m320-pane-split`、`m281-goto-line`、`first-run-empty-state`、`gutter-copy-path-line`。
- [x] 6.5 `bash scripts/docs-check.sh` 与 `npx --yes @fission-ai/openspec@1.12.0 validate --all
      --strict` 通过。
- [x] 6.6 门禁 `bash scripts/gate.sh quick`（不跑完整 visual / 真机）。
- [x] 6.7 新增 / 修改的断言逐条做**反向必红**实测：把无路径 `editable` 改回 true、把焦点落点
      改回正文、把空态动作去掉，各实测一次判红；恢复后判绿。读数记进完工报告。
- [x] 6.8 普通 / 双 pane / 首启候选截图落 `.local/reviews/no-tab-empty-workspace-nov28/`；
      MUST NOT 更新视觉基线。

## 7. 独立评审返修（K3 needs-changes @ `aa4634a4`）

- [x] 7.1 P2-1：vault 切换器的 `focusEditor` 接 `focusActiveDocPaneEntry()`；补「空工作区 → ⌘O → Esc → 静态 region持焦」回归并做旧红新绿。
- [x] 7.2 P2-2：tips 覆盖判据收窄到实际宿主 pane（`firstRunTipsEl.parentElement`），结构只读同步收窄；补「首启 → 收起 harness → 分栏 → 右 pane 空工作区静态 region持焦」回归并做旧红新绿。
- [x] 7.3 P2-3：同步 native 场景 50（Close All 焦点 / 旧未命名守卫叙述）与 79（D369 → 空工作区）；native 复跑清单加入 50 + 79（不自行 native）。
- [x] 7.4 P3-1：`ax.focused` 支持 `{ role, name }`，885 三条静态 region焦点断言改用它；补读数与静态校验自测。
- [x] 7.5 P3-2：修 Quick Open 双 pane scenario 的「成功打开后又要求回静态 region」矛盾。
- [x] 7.6 P3-3：清扫文案末位、m320 注释、`src/tabs.ts` Close All 注释、验收 29 的空态表述。
- [x] 7.7 P3-4：清三个 delta 的 EOF blank line，`git diff --check` 通过。
- [x] 7.8 清理 keymap「行号 gutter 右键复制」与 file-tree「默认名其他创建链路」两处不可达旧表述（新增 MODIFIED 增量）。
- [x] 7.9 候选补「首启收起 harness 再分栏」一张，五张全量重生成。

## 8. 真机首轮返修（885 / 50）

- [x] 8.1 根因：空工作区的占位会话仍被 `editor.goto-line` 当成编辑器目标（真机 885 的 AXTextField「1」）。`editor.goto-line` 在 `active.path === undefined` 时直接返回；有路径文档（含只读 / 未装载异常会话）行为不变。
- [x] 8.2 885 oracle：`ax.not "跳转到行"` 在预填非空时不可观察（输入框只暴露值）；改用输入条必显的「共 N 行」，并补「静态 region持焦」与「正文持焦」两档真实 ⌥G 断言。
- [x] 8.3 50 oracle：Close Other 后「单击开新标签」与 `treeOpenIntent`（单击 = current、⌘-单击 = new，change improve-file-open-harness-affordance-nov26）冲突；三处开新标签改 ⌘-单击并改准 label。
- [x] 8.4 结构回归：正文持焦 + ⌥G 不打开输入条、焦点不被夺；旧红（去掉 goto 门）实测。
- [x] 8.5 native 串行复跑 885 + 50（不并行）→ 2/2 PASS；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-28-no-tab-empty-workspace-r2/evidence/`（885 36 断言 / 50 79 断言，含 263/79 上一轮 PASS 的索引）。
- [x] 8.6 885 的 Esc 步：KimiCU `press_key("escape")` 连续两轮零事件（同状态 CGEvent keycode 53 一次即关闭）⇒ `channel: cgevent` 在 `do: key` 单数形态放行命名键（escape / tab / return …），885 改走该通道；`do: keys` 列表里的命名键与普通字符仍走 KimiCU（100 的逐键分工不变），判据自测同步。
- [x] 8.7 K3 r3 P2-1：`isNamedKeySpec` 改为独立**非打印控制键白名单**（escape / tab / return / 方向 / 删除 …），`space` 与命名标点（minus / comma / period / slash / 括号 / grave …）排除；`keyChannel` / `channelSpecProblem` / 执行器自测补正反例，README 与注释同步。885 的 escape 仍走 keycode 53。

## 9. Alex 空态重设计（2026-11-28）

- [x] 9.1 先写共享内容 / 反向提示 / region 读屏 / inert 焦点合同；旧实现 12/12 判红，最终实现
      新 spec 12/12、相邻结构回归 171/171 PASS。
- [x] 9.2 两个克制候选各 11 张，覆盖中英文、三主题、首启、单双 pane、窄窗与焦点；推荐 A
      编号清单，B 仅留评审证据。路径 `.local/reviews/no-tab-empty-workspace-nov28/redesign/`；
      正式基线未更新。
- [x] 9.3 对 editable / inert / region 焦点 / 通用提示 / 空态按钮分别做反向必红，恢复后判绿；
      五份 mutant 日志均先构建成功再命中目标断言（`redesign/verification/`）。
- [x] 9.4 前端 2206/2206、目标 12/12 与相邻 171/171、focus-created 13/13、OpenSpec 39/39、
      验收静态 313/313 通过；quick r2 `13/13 PASS（SKIP 0）`，末两轮 r3/r4 仅既有
      `link-suggest` 万文件过滤时序项失败（隔离 15/15 均过）。不跑完整 visual / native / merge / archive。

## 10. K3 重设计终审返修（needs-changes @ `b218549e`）

- [x] 10.1 `waitAppReady` 与 11 个既有场景改用当前 A 标题「开始使用 / Get started」；
      新标题中英文正例、旧标题与缺树头反例、README / 合成 fixture 同步。
- [x] 10.2 885 不再 `do:type` 定位 inert 正文，改 `typeInNode + channel:cgevent` 向 focused
      region 注入真实 Unicode；静态校验与 native 证明目标未变且 region 持焦，partial / target-lost 仍失败。
- [x] 10.3 proposal / design 对齐主会话 quick 13/13、per-pane `tipsCoversPane` 与 closeTab
      焦点路径；完整 visual / native 保持未验，不复用旧 native PASS。
- [x] 10.4 静态 313/313、drive 31/31、execute 137/137、quick `13/13 PASS（SKIP 0）`
      （`redesign/verification/gate-quick-acceptance-sync.log`）通过；主会话 native 全清单 16 个：
      885 / 263 / 50 / 79 / 877，以及 17 / 18 / 29 / 47a / 47b / 47c / 47d / 49 / 60 / 67 / 107。
      不跑完整 visual / native / merge / archive / 基线。

## 11. Native 六项失败逐项返修（2026-11-28）

- [x] 11.1 263：旧 oracle 把 vault 根角色写死为 AXButton，实际为 AXPopUpButton；改角色后
      右键新建全链 PASS（40 断言）。
- [x] 11.2 29：AXTextArea.value 保留节点内换行，旧「标题 + 空格 + 正文」假红；改匹配真实
      正文节点，保留第 1 章正例与第 3 章字号正反变化，并补旧拼接必红（32 断言）。
- [x] 11.3 47a：macOS 将 /tmp 规范化为 /private/tmp；精确断言改取同一规范化绝对路径，
      in-run 对照保留（46 断言）。
- [x] 11.4 60：typeInEditor 只落下「M283 」、中文丢失；改 typeInNode 注入，写盘段与
      恢复全链 PASS（39 断言）。
- [x] 11.5 877：宽泛 not「查看全部」误伤合法 vault 入口；负向收窄到完整旧脚注，并补
      合法入口反例与旧脚注可检测对照（39 断言）。
- [x] 11.6 885：press_key 序列误开 vault 浮层，type_text 又拒绝静态 region，导致焦点
      AXStaticText 与重开超时；改 typeInNode + channel:cgevent 的真实 Unicode 注入，目标未变
      且 region 持焦、重开与双 pane 全链 PASS（36 断言）。
- [x] 11.7 六项 native 证据：`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-28-no-tab-empty-workspace-redesign-r1/evidence/`，
      6/6 PASS、232 断言；静态 313/313、drive 31/31、execute 137/137、quick 13/13。
      未发现需改产品代码的缺陷；完整 visual / merge / archive / 基线仍不执行。

## 12. 基线与归档收口（2026-11-28）

- [x] 12.1 Alex「空态选 A」；仅更新首启 tips / 老用户空 vault 三主题与 m320 空右 pane 共七张
      基线，实际图逐张复核且 `cmp` 一致，未扩大其它基线。
- [x] 12.2 完整 visual `GATE RESULT: 15/15 PASS（SKIP 0）` exit 0（1448s）；
      quick 13/13；native 合计 16/16；最终 K3 clean/merge 绑 `cc67bfb1`（`independent-review-baselines.md`）。
- [x] 12.3 节点 2 五要件、五态与候选批准记录写入 proposal；归档跟踪队列恰一条且
      `docs/backlog.md` 不超过 80 行；执行包装器归档并提交归档结果，`--archived` 至 PASS。
