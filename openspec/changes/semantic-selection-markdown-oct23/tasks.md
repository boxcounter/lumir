# Tasks: semantic-selection-markdown-oct23

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
> D1–D5 的裁决结果回填 proposal 的「评审记录」块，再按裁决修正 design / delta / 本文件。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/editor-live-preview/spec.md`（delta）/ 本文件
- [ ] 0.2 Alex 节点 1 评审通过（硬门禁；D1–D5 一并裁决，未回的按提案里的倾向落地）
- [ ] 0.3 裁决结果回填 proposal 的「评审记录」块（逐字），按裁决修正 design §3–§5 / delta 的
      封闭集合与「只适用于指针选区」措辞；D3 若裁 B（加显式命令），补「新命令 + 文案号 + 键位」
      三项任务与本文件 §3 的对应条目

## 1. 探针（先于实现；结论回写 design 的注记）

- [ ] 1.1 chromium 探针：确认拖拽期间「隐藏段零宽、选区带不向隐藏段延伸」的推断（design §3.3 /
      D1=B 的否决理由）；确认 mouseup 时 `EditorState.selection` 已定、`pointerPressFrame` 尚未关
- [ ] 1.2 chromium 探针：确认「外扩事务与 `pointerPressFrame.of(null)` 合并成一拍」时装饰只重建
      一次、上屏与选中底色同帧（design §4.1）；探针证据落 `.local/probes/`，不入 git
- [ ] 1.3 真机探针（WKWebView，需向 tower 申报机器窗口总时长）：确认 mouseup 的事件顺序与
      Quote 浮动钮的浮现时机——外扩后**不得**多出一次 350ms 的 settle 延迟（design §4.3）；
      若顺序与假设不符，回写 design 并调整落点（候选 ①/②）
- [ ] 1.4 探针结论回写 design §4.2 / §4.3 的「待确认」处，并把探针读数路径登记在证据目录

## 2. 合同与纯函数（先红后绿）

- [ ] 2.1 抽出节点范围与隐藏字符的单一出处：把「构造 → 节点源码范围 + 渲染文本区间」做成纯函数模块
      （design §3.2），`src/preview/livePreview.ts` 的标题 / 强调 / 链接分支改读它；行为逐字不变
      （`rg` 确认没有第二份「`#` 后跟空格」类字面规则）
- [ ] 2.2 实现外扩纯函数：完整覆盖判定、逐层迭代至不动点、幂等、多 range；只对封闭集合生效
- [ ] 2.3 单测矩阵（design §8 的输入表）：标题（1/6 级、缩进、闭合 `#`）× 选区形态（恰好覆盖 /
      少一字 / 多覆盖 / 整构造 / 多 range / 空光标）× 上下文（普通段落 / 表格 cell / callout 行内）
- [ ] 2.4 反向区分度（REVIEW.md「断言等价于子串」条）：构造一个「部分覆盖却外扩」的反例输入，
      确认断言如实失败；再确认「已含定界符」的输入不被改写
- [ ] 2.5 封闭集合的负向用例：行内代码 / 列表项 / wikilink / 链接引用式与 blocked 形态一律不外扩
      （每条都是会让实现「顺手多纳」的诱因）

## 3. 实现

- [ ] 3.1 指针手势结束时的外扩接线（落点按 1.3 的探针结论）：同一事务携带 `selection` 与
      `pointerPressFrame.of(null)`；`reveal-gate.endPointerPress` 的判空使后续调用成空操作
- [ ] 3.2 双击走同一规则；三击自然空操作（不按 `event.detail` 分支，design §4.5）
- [ ] 3.3 与 Quote 手势的时序核对：松开后浮动钮浮现不晚于现状；`last` 记录的是外扩后的选区
      （`src/quote-gesture.ts` 预期零改动——若需改动，改动 MUST 最小且不回退时机门语义）
- [ ] 3.4 code 模式与只读态不装/不触发；`rg` 确认规则只挂在 md 的 live preview 扩展组
- [ ] 3.5 不改写文档、不滚动、不动阅读位置；注释里写明与 M259 / M539 / M285 三条的边界
      （防下一个人把外扩塞进 transactionFilter 或与 M539 合并）
- [ ] 3.6 注释与文档清扫：`rg` 检查「选中即复制纯文本」「选不到定界符」这类旧表述是否需要改准

## 4. 测试与验收场景

- [ ] 4.1 新增 chromium 结构层场景（`tests/visual/scenes/`，命名随 mission 号）：
      拖选整段标题 / 粗体 → 松开后选区覆盖定界符、上屏字符有选中底色；拖拽中途不变；
      部分覆盖不外扩；双击外扩；三击不变；文档逐字节不变
- [ ] 4.2 断言要有区分度：先造一个「外扩没有发生」的红色读数（实现前跑一次并记录），再实现转绿
- [ ] 4.3 新增真机验收场景 **229**（227 归在途的 M650、228 归 M647，落盘前用
      `ls scripts/acceptance/scenarios` 复核；撞号则顺延并回写本行）：
      双击粗体词 → 摘录浮动钮 → 点钮 → composer 文本含 `**…**`；`editor.unchangedSince` +
      文件 `unchangedSince` 的字节断言
- [ ] 4.4 真机场景的证据照实登记：**拖选路径在真机套件里造不出编辑器选区**（`drag` 通道在
      WKWebView 无效），拖选的机器判据只在 chromium 结构层；真机只判双击路径 + dogfood
- [ ] 4.5 真机 dogfood（Alex 手感项）：`pnpm tauri dev` 起真实 app，用合成 vault 逐项过——
      拖选标题 / 粗体松开后的观感、引用卡片里 `##`/`**` 的可读性、带 URL 的链接被整条引用时
      是否噪声过大（design §7 第 2 条）、编辑时替换外扩选区是否可接受（D1 的代价）

## 5. 文档与门禁

- [ ] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（提案阶段先跑一次）
- [ ] 5.2 `bash scripts/docs-check.sh` 通过（含 OpenSpec 相对链接与归档对账）
- [ ] 5.3 `bash scripts/gate.sh quick` 全绿，报告照抄 `GATE RESULT` 原文行与退出码
- [ ] 5.4 动过 `src/preview/**` 或 `tests/visual/scenes/**` 后本地跑 `bash scripts/gate.sh visual`；
      基线若有变化逐张列出并由 Alex 过目（视觉基线更新是人肉裁决点）
- [ ] 5.5 信息卫生：新增 fixture / 场景素材 MUST NOT 含真实 vault 内容；改动面做一次 text 级
      grep 清扫（含场景 229 的文档内容）
- [ ] 5.6 归档前逐条对账（tasks / delta / 实现三者一致）；`docs/backlog.md` 不新增条目——
      若实现期发现新的 finding，按「首选提议安排处理」规则处置
