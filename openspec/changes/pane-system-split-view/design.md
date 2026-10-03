# Design: pane-system-split-view（Phase 1 实施设计）

技术方案与权衡。事实依据：代码集成点的 survey 证据均转写自 ADR 0008（2026-10-03 四路代码探索，
每个结论带 文件:行），本 design 不重复探索、只把证据转成实施注记。

## 1. 范围与过渡形态

Phase 1 = pane 容器 + 双文档 split view（命令路由、活跃 pane、会话所有权、持久化）。Phase 2
（harness 入 pane、chat UX 重做、pin 上下文）不在本 design 范围。

**过渡形态（如实记录）**：Phase 1 期间 harness dock 列保持现状（grid 第三列、钉宽 348px）。因此
「dock 展开 + 双 pane」的瞬态会出现 树 | pane | pane | dock 的过渡四栏——四栏困境的模型层消解
要等 Phase 2 harness 归位 pane 后才彻底完成。这是 ADR 0008 Decision 8 分期裁决的直接后果，
不是本 design 的偏离；Phase 1 的价值是把「内容层」先统一到 pane 模型，Phase 2 只是把 harness
从 chrome 层搬进已有的容器。

单 pane 常态是本仓现有视觉基线、验收场景与 Alex 使用的主形态，Phase 1 的全部单 pane 行为
（骨架几何、标签条位置、命令行为）**逐像素 / 逐语义不变**——这条是实施期的第一判据，也是
既有整页基线不需要整批重刷的理由（按 AGENTS.md 视觉门禁卫生纪律核对受影响基线的时间戳即可）。

## 2. 现状 survey 转写：editor 单例捕获清单

ADR 0008 survey 结论：全应用一个 `EditorView`（`src/editor.ts:1820` 唯一构造点），
`createEditor` 是自包含工厂（`src/editor.ts:1277`），多实例结构上不冲突；约 10 个模块构造期
捕获 `editor` / `editor.view` 单例。改造总注记：**从「构造期捕获单例」改为「按活跃 pane 解析」**，
每个模块的改动面收敛在「注入哪个 editor」的装配层，不改模块内部逻辑的形状。

| # | 模块 | 捕获形态（现状） | 改造注记（Phase 1） |
|---|---|---|---|
| 1 | toc（大纲浮层） | 持有裸 view，滚动跟随 / 条目定位直读 view 状态 | 跟随**活跃 pane** 的 view；活跃 pane 切换时重建浮层内容源，浮层打开期间跨 pane 切换要即时换源 |
| 2 | tabs（标签栏） | 单例标签条 + 全局会话列表 | per-pane 实例：每 pane 自己的会话子列表与标签条挂载点（单 pane 时挂标题栏标签区、逐像素不变；双 pane 时挂标题栏标签区的左右分区槽，槽宽比例随分隔条、与 `pane_split_ratio` 同源，顶部恒为一条横带）；标签条的窗口级命令（⌘W / ⌃⇥ / ⌘1–9 / 右键菜单）作用于**活跃 pane** 的标签条，装配期从「全局 tabs」改为「活跃 pane 的 tabs」；**双 pane 时标题栏右簇退让**——产品标识块退 modeline（沿用 `src/modeline.ts` 窄窗 <640px 版本号退 modeline 的既有先例）、harness 开关钮隐藏（⌘⇧A 照走），单 pane 全量在场 |
| 3 | save-controller | 保存链路以「全局唯一前台会话」为落点 | 保存落点改为「活跃 pane 的前台标签」；dirty 判定 / revision CAS / 崩溃备份 debounce 的逐路径键控不变，只是「前台」的定义从全局唯一变成活跃 pane 局部 |
| 4 | link-follow | ⌘⏎ / ⌘-Click 跟随作用于单例会话 | 链接解析基准改为活跃 pane 的前台文档（「当前文件」的定义随活跃 pane）；打开落点走活跃 pane 的会话（打开语义见 §6） |
| 5 | harness-panel（上下文组装 `assembleHarnessContext`） | `HarnessContextSource` 窄接口（`activeSession()` + `view.state/viewport`，`src/harness-context.ts:31`）钉住单例 | Phase 1 harness 仍在 dock，但其上下文源改为**活跃 pane**——「当前 TAB」的定义随活跃 pane；接口形状不变（ADR 0008 survey：改造面在装配层「注入哪个 editor」，不在接口形状） |
| 6 | content-width drag（阅读栏宽拖柄） | 单例拖柄作用于唯一正文列 | 双 pane 时 v1 **全局共享**同一 `ui.content_width`（ADR Decision 2 注意段：单配置键不动）；拖柄需感知「活跃 pane 的前台文档」决定在场性（空态判定），施加动作遍历全部 pane（每 pane 的 view 各自 `requestMeasure()`） |
| 7 | notice（提示） | 以单例会话身份点名文档（保存 / 外部变更提示） | 提示文案的文档点名跟随活跃 pane；跨 pane 的批量提示（如切 vault 守卫）维持既有「数量 + 当前 vault」口径，逐路径键控不变 |
| 8 | search（面板 / 替换） | 搜索作用域 = 单例 view | 搜索 / 替换作用域改为**活跃 pane** 的 view；面板持有焦点期间活跃 pane 不变（Emacs selected-window 语义），搜索目标不因焦点在面板而漂移 |
| 9 | goto-line（`editor.goto-line`） | 行号输入条作用于单例 view | 作用于活跃 pane 的 view；输入条打开期间前台会话切换（含活跃 pane 切换）的失效路径复用既有「不跨会话跳转」口径 |
| 10 | fullscreen 族（table / code-block 全屏遮罩） | 遮罩源元素与焦点归还钉住单例 view | 遮罩源元素改取自活跃 pane；`Escape` 焦点归还到**来源 pane**（不是机械回活跃 pane——遮罩打开后活跃 pane 可能已切换，焦点归还要还到打开遮罩的那个 pane，如实记录这一例外） |

另有两个以「全局唯一前台会话」为落点的全局函数随本次显式化（ADR 0008 Consequences 已点名）：
`openFile` 的落点改为「活跃 pane 的会话列表」；`syncActiveDocument`（树高亮 / masthead / modeline
的单同步点）改为跟随活跃 pane，成为「活跃 pane 的前台标签 ⇄ chrome」的唯一同步点。

配置施加与能力注入（setMode / applyTypography / setContentWidth / 折行口径等）现状是单例直施，
Phase 1 改为**遍历全部 pane**（每个 EditorView 各自 reconfigure / requestMeasure）。这是
ADR 0008「代价与风险」节点名的主要实施成本之一；遍历面收敛在装配层一个「for each pane」入口，
MUST NOT 在 10 个模块里各写一份遍历。

## 3. 命令分发改造

现状两处写死单例（ADR 0008 survey）：

- `src/main.ts:1282` 的 `isEditorEvent`：editor 作用域判定 =「事件目标落在（唯一）编辑器 contentDOM 内」。
- `src/main.ts:1194`：把 `editor.commands` 直接摊平进全局命令表——每个编辑器命令在装配期绑定到
  那一个单例的闭包。

Phase 1 改造（ADR Decision 3 原文口径）：

1. **`isEditorEvent` 泛化**为「事件目标落在**任一**编辑器 pane 的 contentDOM 内」。判定实现从
   「等于单例 contentDOM」改为「对 pane 列表做 `contains` 判定」，pane 列表由 pane 容器单例提供。
2. **摊平改为按活跃 pane 解析**：编辑器命令不再在装配期绑定单例闭包，而是在分发时从
   **活跃 pane** 的 `editor.commands` 解析目标实现。命令表的不变量（一个 token 一条绑定、
   每条绑定有归属命令与来由、`COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 三者对账、
   孤儿命令装配期拦下）逐条不变——改动的是「绑定解析到哪个实现」，不是表的结构。
3. **活跃 pane 的判定**见 §5；焦点在 chrome（树 / 浮层 / 搜索框）上时 editor 作用域的既有边界
   不变（`isEditorEvent` 只泛化「哪个 pane」，不把 editor 作用域放权到任意焦点）——Emacs 的
   minibuffer 类比落实在「活跃 pane 不随 chrome 焦点漂移」，而不是放宽作用域。
4. 全局命令（`tab.*` / `pane.*` / `document.save` 等）的「作用目标 = 活跃 pane」语义在装配层
   显式化：这些命令本来就经活跃 pane 解析编辑器侧实现，Phase 1 只是把「全局唯一前台」的隐含
   假设换成具名的活跃 pane。

## 4. 装配形状：createEditor 双实例化

`createEditor`（`src/editor.ts:1277`）是自包含工厂——多实例结构上不冲突（ADR 0008 survey
的既有结论）。Phase 1 的装配形状：

```
AppShell
├─ 标题栏（单 pane：一处标签区；双 pane：标签区左右分区为两槽——左槽挂左 pane 标签条、
│   右槽挂右 pane 标签条，槽宽比例随分隔条 = pane_split_ratio，顶部恒为一条横带）
│   └─ 右簇（产品标识块 + harness 开关钮）：单 pane 全量在场；双 pane 退让
│      （标识块退 modeline、harness 钮隐藏）
└─ 内容区（泛化为 pane 容器，v1 ≤2 横向 pane，分隔条相隔）
   ├─ pane A（文档 pane）
   │   ├─ EditorView A ← createEditor(depsA)   // 自包含工厂第二实例
   │   └─ content-width 拖柄（pane 级覆盖元素）
   └─ pane B（同构；未分栏时不在场）
```

- **pane 容器是新的装配层单例**：持有 pane 列表、活跃 pane 指针、分隔条状态；对外提供
  「活跃 pane 的 EditorHandle」「遍历全部 pane」「split / close / moveTab 跨 pane 操作」。
  10 个模块（§2）从「构造期收到 editor 单例」改为「构造期收到 pane 容器（或迟绑定 getter）」。
- **每个 EditorView 完全独立**：自己的 `EditorState`、滚动 DOM、能力注入。per-tab
  `EditorState` 留存语义不变（multi-tabs 的「每标签留存 EditorState」逐 pane 成立），
  切标签仍是 `view.setState`。
- **能力注入 per pane**：能力清单（折行 / 字号 / 主题 / 栏宽等扩展与重配置）逐 pane 施加；
  遍历入口单一（见 §2 末段纪律）。
- **无新 npm 依赖、无 fork 依赖**（ADR 0008 Consequences）；不引入 React/Vue 类组件框架，
  pane 容器是纯 DOM + 现有模块风格。

## 5. 活跃 pane 状态机

活跃 pane 规则（ADR Decision 3，Emacs selected-window 语义）：

- **成为活跃**：焦点进入某 pane 的 contentDOM（鼠标点击 / 键盘焦点路径）即令该 pane 为活跃 pane；
  命令显式作用于某 pane（如 `pane.other`、跨 pane 移动标签的目标激活）同样令该 pane 为活跃。
- **不失去活跃**：焦点移出内容区到 chrome（文件树、modeline、浮层、搜索框、键位面板、
  harness 面板输入框）**不改变**活跃 pane——minibuffer 持焦不改变 current buffer。
- **跟随面**：编辑器命令、`assembleHarnessContext` 的上下文注入、modeline（当前文件 / 位置 /
  行数）、文件树高亮、toc 浮层内容源，全部跟随活跃 pane。
- **单 pane 退化**：只有一个 pane 时活跃 pane 恒为该 pane，全部行为与现状逐语义一致。

## 6. 会话所有权与「移动标签」交互

ADR Decision 4：一份文件同一时刻至多在**一个** pane 打开；跨 pane 是移动标签而非复制标签。
理由（ADR 已裁）：两个独立 `EditorState` 对同一文件的 dirty / 保存冲突；共享 buffer（单 state
双 view）的更新协调复杂度不成比例；已知场景（文档 + 代码）不需要同文件双开。

实施交互口径：

- **标签移动带状态**：标签带着自己的 `EditorState`（撤销史 / 语法树 / 选区）与滚动位置整体迁到
  目标 pane；移动后源 pane 失去该标签，目标 pane 前台变为该标签；移动 MUST NOT 重新解析文档、
  MUST NOT 重建 `EditorState`（`view.setState` 到目标 pane 的 view 上，装载事务的
  `addToHistory(false)` 口径随移动复用——移动不制造撤销事件）。
- **触发路径**：① 在 pane B 里「打开」已在 pane A 打开的文件（单击树 / 链接跟随 / 序号直达
  等一切打开意图）；② 标签条的跨 pane 拖动（拖拽手柄落在另一 pane 的标签条上）；③ 后续
  Phase 2 的 harness 相关路径不在本 design。
- **打开落点**：一切「打开」意图落在**活跃 pane**；命中他 pane 已开的同文件时执行移动
  （源 pane 若因此变空且非唯一 pane，保持空 pane 在场——空 pane 是合法状态，不自动收起，
  如实记录该口径）。
- **`pane.close`（裁决点 2 倾向 A）**：收起 pane 时其全部标签按序并入另一 pane（各带状态），
  该 pane 的前台标签成为目标 pane 前台；收起后回到单 pane 常态。dirty 标签不经确认——
  移动不丢内容；唯一的关闭确认仍发生在「关闭标签」这一既有路径上。
- **`killSlot` 全局单例**：`⌃K` 在 pane A 杀、切活跃 pane 到 B 后 `⌃Y` 插入 B——kill ring
  在 Emacs 本就是全局的，语义正确（ADR Decision 4），Phase 1 保持模块级单例不动。
- **守卫口径**：切 vault / 退出守卫取「**全部** pane 的全部标签」的 dirty 并集（multi-tabs
  既有「任一标签 dirty 即拦」的并集口径跨 pane 成立）；⌘S 只存活跃 pane 的前台标签。

## 7. 持久化：vault-sessions schema 扩展

ADR Decision 6 的 schema 形状（Phase 1 消费其中文档 pane 部分）：

```jsonc
{
  "version": <递增>,
  "panes": [
    { "tabs": ["a.md", "b.md"], "active": "b.md" }   // 每 pane：有序相对路径 + 激活项
    // …（v1 ≤2 条；Phase 2 harness pane 落位后此数组可承载 harness 槽位，形状实现期定）
  ],
  "harness_pane": false,                              // Phase 1 恒 false；Phase 2 消费
  "pane_split_ratio": 0.5                             // 分隔条位置（0–1）
}
```

沿用纪律（ADR Decision 6 + vault-workspace 既有 requirement 的同构口径）：

- **tmp + rename 原子替换**；**版本不符 = 无 pane 历史**（等价于「单 pane 默认布局」，不报错、
  不提示）；**写失败降级 warning**（不拦停切换 / 退出）；**路径校验复用 `valid_entry`**
  （panes 数组内的条目走与既有标签列表同一条越界 / 丢弃口径）。
- **既有兼容**：无 `panes` 字段的旧会话文件按「单 pane = 既有顶层 tabs/active」解释
  （字段向后兼容在读取侧做，不写双份真源）。
- **写入触发点**：pane 集合 / 顺序 / 活跃项 / 分隔条位置变化后落盘（可防抖），切换 vault 前与
  退出前 flush；分隔条拖拽的回写走 `config_set_value("ui", "pane_split_ratio", …)` 之外的
  会话文件通道——**分隔条位置进会话文件**（per-vault 布局即数据），与 `ui.content_width`
  的全局配置键分开，两个真源各管一层（栏宽 = 全局偏好；分栏比例 = vault 布局）。
- **恢复路径**：装载 vault 后按 pane 布局恢复——「标签建立与内容装载分两步」的既有口径落到
  每 pane（先建全部 pane 与其标签条，再逐 pane 装载激活项，其余标签首前台时装载）；全部条目
  不可用时回退单 pane 空态。

## 8. 性能与内存

ADR 0008「代价与风险」节的实测与裁决：

- 常驻内存实测 **206–215MB**，贴 **250MB 门禁**（合同 200MB 与门禁分叉已登记）。
- 第二个 CodeMirror 实例的成本落在窄余量内，**预计顶破现行门禁**。
- **Alex 已裁决（2026-10-03）**：pane 化过程中按实测提高门禁，内存使用的专项治理后置；
  门禁不阻塞 pane 化工作；专项治理仍归 backlog 的 dogfood 性能专项队列。

Phase 1 实施任务因此含两条硬性验证项（tasks.md §7）：

1. **双 pane 常驻内存实测并登记读数**（单 pane 基线 vs 双 pane 常驻，作为提阈幅度与后续
   专项治理的输入）——读数落 `test-results/` 证据目录并在完成报告引用绝对路径。
2. **门禁提阈提案**随实施 PR 一并提交（改门禁数字本身走 Alex 过目，不静默改）。

跨实例全局态（ADR 已点名，实现期验证并如实登记）：

- `killSlot` 全局单例——语义正确，保持不动（§6）。
- mermaid 渲染队列模块级单例——两实例共享（渲染串行、主题失效互相影响，ADR 判可接受）；
  Phase 1 验证双 pane 下同文档 / 异文档 mermaid 的渲染表现并登记。
- `lists.ts` 每实例一条 document 级观察器——两实例翻倍（功能无冲突，ADR 判可接受）；
  Phase 1 验证双 pane 列表行为并登记。
- keypress-to-paint <16ms 与打开 1MB Markdown <100ms 两条阈值对应路径：第二个实例不新增
  热路径（每 pane 各自的输入路径独立），但配置施加的「遍历 pane」入口 MUST NOT 进入
  keypress 路径（仅响应配置变更与拖拽，ADR 0002 §6）。

## 9. 测试面回刷（ADR 0008 点名面，落到 tasks.md）

- **整页像素基线**：单 pane 常态逐像素不变 ⇒ 既有基线预期零 diff（按 AGENTS.md 视觉门禁卫生
  纪律核对受影响基线的时间戳）；新增双 pane 表面整页基线按「基线更新是人肉裁决点」走 Alex 过目。
- **验收套件**：部分场景假设单编辑器（AX 查询锚定唯一 contentDOM / 唯一标签条）；新增双 pane
  场景（分栏 / 活跃 pane 路由 / 移动标签 / 布局恢复）并核对既有场景的 AX 锚点不受影响。
- **视觉场景**：标题栏子节点序列（toggle 钮位置等）在单 pane 下不变；双 pane 的标题栏标签区左右分区槽（槽宽随分隔条）与右簇退让（标识块退 modeline、harness 钮隐藏）是新增表面，新增场景承担。

## 10. 风险与开放问题

| 风险 / 开放问题 | 对冲 |
|---|---|
| 第二实例顶破 250MB 门禁 | Alex 已裁决按实测提阈、专项治理后置（§8）；读数登记作为输入 |
| 约 10 个模块的单例捕获改造漏网（某个模块仍悄悄钉住 pane A） | 装配期注入从「editor 单例」改为「pane 容器 / 活跃 pane getter」后，任何直接引用旧单例的编译点都无处可藏（TS 类型层面单例类型不再可达）；验收场景加「活跃 pane 跟随」断言（B pane 输入 → modeline / 树高亮跟随 B） |
| 活跃 pane 语义与用户直觉不符（焦点在 B 但命令打到 A 的错觉） | 只发生在「焦点移出内容区到 chrome」后；跟随面（modeline / 树高亮 / toc）全部显式指向活跃 pane，用户有据可判；dogfood 期收集反馈 |
| 移动标签的实现坑（滚动位置 / 选区在 setState 后漂移） | 移动复用既有切标签的「逐标签留存」机制（滚动位置单独存取、切回恢复），移动本身 MUST NOT 重新解析；验收场景断言移动后滚动位置与撤销史保留 |
| `harness_pane` 字段 Phase 1 无消费者（类似「声明了却没有消费者」的坑） | 字段由 schema 版本承载、读取侧容忍；它是 ADR Decision 6 登记的 Phase 2 契约位，非孤立开关；tasks.md 标注 Phase 2 消费点 |
| 分隔条拖拽与 `ui.content_width` 拖柄在双 pane 下的视觉共存 | 两个拖柄层级不同（分隔条 = pane 容器级、栏宽柄 = pane 内列缘）；视觉基线逐张过目时一并核对 |
