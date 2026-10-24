# Tasks: semantic-selection-markdown-oct23

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
> D1–D5 的裁决结果回填 proposal 的「评审记录」块，再按裁决修正 design / delta / 本文件。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/editor-live-preview/spec.md`（delta）/ 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；D1–D5 一并裁决，未回的按提案里的倾向落地）——
      2026-10-24「好。请你现在安排。」：D1–D5 全部按倾向（A/A/A/A/A），同时是实现开工口令
- [x] 0.3 裁决结果回填 proposal 的「评审记录」块（逐字），按裁决修正 design §3–§5 / delta 的
      封闭集合与「只适用于指针选区」措辞；D3 裁 A（不做自动外扩、不加显式命令），无命令 / 文案号 /
      键位任务

## 1. 探针（先于实现；结论回写 design 的注记）

- [x] 1.1 chromium 探针：确认拖拽期间「隐藏段零宽、选区带不向隐藏段延伸」的推断（design §3.3 /
      D1=B 的否决理由）；确认 mouseup 时 `EditorState.selection` 已定、`pointerPressFrame` 尚未关
      ——读数：contentDOM mouseup 时选区 {3,25}、标题行仍隐藏 `## `；document 层 mouseup 时已是
      外扩后的 {0,25}（`.local/probes/m687-semantic-release-snap/README.md` §2）
- [x] 1.2 chromium 探针：确认「外扩事务与 `pointerPressFrame.of(null)` 合并成一拍」时装饰只重建
      一次、上屏与选中底色同帧（design §4.1）——读数：`buildDecorations` 计数 = 1，同一次
      contentDOM mouseup 内行文本已变 `## …`；探针证据落 `.local/probes/`，不入 git
- [x] 1.3 真机探针（WKWebView）：确认 mouseup 的事件顺序与 Quote 浮动钮的浮现时机——外扩后
      **不得**多出一次 350ms 的 settle 延迟（design §4.3）。chromium 读数：基线本身就有一次
      ~350ms 的 settle（mouseup 之后的同范围 selectionchange），外扩与该事件合并，读数与基线
      逐项相同；真机侧由验收场景 233 的端到端判据兜住（顺序错位会让 composer 不含 `**…**`），
      该场景与 dogfood 同批跑
- [x] 1.4 探针结论回写 design §4.2 / §4.3 / §4.4 / §7，并把探针读数路径登记在证据目录
      （`.local/probes/m687-semantic-release-snap/`，tower 合并前复制到主 checkout）

## 2. 合同与纯函数（先红后绿）

- [x] 2.1 抽出节点范围与隐藏字符的单一出处：把「构造 → 节点源码范围 + 渲染文本区间」做成纯函数模块
      （design §3.2，`src/preview/syntax-envelope.ts`），`src/preview/livePreview.ts` 的标题 /
      强调 / 链接 / 角括号分支改读它；行为逐字不变（`rg "HeaderMark|EndsWith(\"Mark\")"` 确认
      装饰层只剩这一处字面规则；视觉门禁逐场景比对见 §5.4）
- [x] 2.2 实现外扩纯函数：完整覆盖判定、逐层迭代至不动点（8 轮上限）、幂等、多 range、方向保留；
      只对封闭集合生效（`src/preview/syntax-envelope.ts` 的 `expandSelectionToSyntax`）
- [x] 2.3 单测矩阵（design §8 的输入表）：标题（1/6 级、缩进、闭合 `#`）× 选区形态（恰好覆盖 /
      少一字 / 多覆盖 / 整构造 / 多 range / 空光标）× 上下文（普通段落 / 表格 cell / callout 行内 /
      引用块标题 / frontmatter 之后 / 文档首行）——`tests/unit/syntax-envelope.test.ts`，19 条
- [x] 2.4 反向区分度（REVIEW.md「断言等价于子串」条）：同一 fixture 里「部分覆盖不外扩」与
      「完整覆盖必须外扩」成对断言；「已含定界符」返回同一个 EditorSelection（幂等）
- [x] 2.5 封闭集合的负向用例：行内代码 / 列表项 / wikilink / 链接引用式 / blocked / 图片一律不外扩
      （每条都是会让实现「顺手多纳」的诱因）

## 3. 实现

- [x] 3.1 指针手势结束时的外扩接线（contentDOM mouseup，1.3 的探针结论）：同一事务携带
      `selection` 与 `pointerPressFrame.of(null)`；`reveal-gate.endPointerPress` 的判空使后续调用
      成空操作（探针计数：`buildDecorations` = 1）
- [x] 3.2 双击走同一规则（探针实测 `**粗体词**` → `[32,39)`）；三击自然空操作（不按 `event.detail`
      分支，design §4.5）
- [x] 3.3 与 Quote 手势的时序核对：松开后浮动钮浮现与现状相同（基线本身有一次 post-mouseup
      selectionchange 的 ~350ms settle；外扩与该事件合并，未新增排期）；`last` 记录的是外扩后选区
      ——`src/quote-gesture.ts` 零改动
- [x] 3.4 code 模式与只读态不装/不触发：规则只挂在 `livePreview()`（`src/editor.ts` 的 md 分支），
      code 模式不装该扩展组
- [x] 3.5 不改写文档、不滚动、不动阅读位置（dispatch 只带 selection + effect）；注释写明与
      M259 / M539 / M285 三条的边界（模块头 + mouseup 接线处）
- [x] 3.6 注释与文档清扫：`rg` 搜「选中即复制纯文本」「选不到定界符」类旧表述——产品面零命中，
      无需改准

## 4. 测试与验收场景

- [x] 4.1 新增 chromium 结构层场景 `tests/visual/scenes/m687-semantic-selection.spec.ts`（6 条）：
      拖选整段标题 / 粗体 → 松开后选区覆盖定界符、上屏字符有选中底色；拖拽中途不变；
      部分覆盖不外扩；双击外扩；三击不变；文档逐字节不变 + 阅读位置不变；程序化 / 键盘选区不外扩。
      既有场景 `tests/visual/scenes/m259-bold-click-selection.spec.ts` 的双击对照按 D2=A 更新终态
      期望（CM 的选词仍在，松开后外扩到 `*P斜*`；不是选词回归）
- [x] 4.2 断言要有区分度：把 mouseup 接线临时短路后重跑 → 3 条外扩断言如实变红（部分覆盖 /
      文档不变两条保持绿，符合预期）；恢复接线后 5/5 绿。读数
      `.local/probes/m687-semantic-release-snap/scene-red-run.log`
- [x] 4.3 新增真机验收场景 **233**（落盘前复核：229 / 230 / 231 / 232 已占用；227 归 M650、
      228 归 M647）：双击粗体词 → 摘录浮动钮 → 点钮 → composer 文本含 `**…**`；
      `editor.unchangedSince` + 文件 `unchangedSince` / `mtimeUnchangedSince` 的字节断言。
      **2026-10-24 真机 PASS（1/1，19 条断言）**：卡片 AX value 逐字 `**粗体词**`、编辑器 48 字节
      逐字节不变、磁盘 sha256 / mtime 未变；证据
      `.local/acceptance/2026-10-24/233-semantic-selection-release-snap/`（首跑因坐标落在词后空格
      与基线显露态不一致两条红，修坐标 / 比较态后复跑绿；现场见 run1/run2 日志）
- [x] 4.4 真机场景的证据照实登记：**拖选路径在真机套件里造不出编辑器选区**（`drag` 通道在
      WKWebView 无效），拖选的机器判据只在 chromium 结构层；真机只判双击路径 + dogfood。
      场景正文的「覆盖边界」节逐条写明（含两字词双击落点、350ms settle 既有行为）
- [ ] 4.5 真机 dogfood（Alex 手感项，**归 Alex，本 mission 不代判**）：`pnpm tauri dev` 起真实 app，
      用合成 vault 逐项过——
      拖选标题 / 粗体松开后的观感、引用卡片里 `##`/`**` 的可读性、带 URL 的链接被整条引用时
      是否噪声过大（design §7 第 2 条）、编辑时替换外扩选区是否可接受（D1 的代价）

## 5. 文档与门禁

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过——`gate.sh quick`
      的 `GATE PASS openspec-validate`（2026-10-24，退出码 0）
- [x] 5.2 `bash scripts/docs-check.sh` 通过（含 OpenSpec 相对链接与归档对账）——`gate.sh quick` 的
      `GATE PASS docs-check`（同日，退出码 0）
- [x] 5.3 `bash scripts/gate.sh quick` 全绿：`GATE RESULT: 11/11 PASS（SKIP 0）`，退出码 0
      （日志 `.local/probes/m687-semantic-release-snap/gate-quick-1.log`）
- [x] 5.4 动过 `src/preview/**` 或 `tests/visual/scenes/**` 后本地跑 `bash scripts/gate.sh visual`：
      `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（2026-10-24；视觉回归 542s，792 条用例含
      webkit-realua 项目）。**基线零变化**——未执行 `--update`，无需 Alex 过目。
      首跑 12/13（两条红：m259 双击对照的旧期望已随 D2=A 更新；`render-link` 一条是页面 session
      被关掉的基建抖动，重跑通过），读数见 `.local/probes/m687-semantic-release-snap/`
      `gate-visual-1.log` / `gate-visual-2.log`
- [x] 5.5 信息卫生：新增 fixture / 场景素材 MUST NOT 含真实 vault 内容；改动面做一次 text 级
      grep 清扫（`/Users/` / `~/.config` / `.tower/` / 用户名 零命中；fixture 与场景文案全合成）
- [x] 5.6 归档前逐条对账（tasks / delta / 实现三者一致）：delta 的四段（完整覆盖 / 逐层迭代 /
      封闭集合 / 同上屏同事务）与 `src/preview/syntax-envelope.ts` + livePreview 的 mouseup 接线
      逐条对上；`docs/backlog.md` 已按新机器门禁
      （`scripts/openspec-archive-check.mjs` 随 docs-check）落一条归档跟踪记录，如实写
      待 dogfood / 节点 2 状态；实现期新 finding 已走 TowerFinding（双击两字粗体词的落点位移，
      出本 change 面）
