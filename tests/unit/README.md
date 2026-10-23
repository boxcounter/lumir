# tests/unit — 前端最小单测层

src/ 里**纯逻辑**的秒级回归。此前这类判定只由 228 个浏览器场景间接兜底：打错一个键位
token 或改错一条保存分支，红的是「某个场景超时」，归因成本极高（M153 立项理由）。

## 怎么跑

```bash
node tests/unit/run.mjs     # = pnpm test
```

`scripts/gate.sh quick` 里有成对的两条：`tsc-unit`（类型防线）与 `unit-tests`（行为）。

当前覆盖：

| 被测文件 | 覆盖内容 |
|---|---|
| `src/keys.ts` | token 归一化（别名 / 定序 / Shift 隐含符号）、`keyToken` 的事件口径（含 Alt 按物理键判定）、键位表的不变量（token 唯一、作用域与命令组一致、⌘1–9 与 `TAB_GOTO_IDS` 一一对应）、分发器（作用域 / `when` / 已消费让路 / IME / chord 超时 / 缺实现抛错）、`applyKeyOverrides` 的重绑与 warning |
| `src/save-controller.ts` | dirty 守卫三分支、保存成功 / 冲突 / 目标被外部删除、崩溃备份的触发与生命周期（含撤销回基线 / 切 vault 放弃的清备份）、自身写盘回声判据与其读失败降级、外部修改分流（clean / dirty / deleted）、另存为逃生口、世代号、诊断埋点 |
| `src/lightbox.ts` | 图片放大查看的遮罩状态机（M184）：打开的动作顺序（载入 → 显示 → 持焦）、`Esc` 的就地消费、三条用户关闭路径都交还焦点 / 焦点兜底不抢焦点、已关闭后的迟到关闭是空操作 |
| `src/bindings-panel.ts` | 键位面板分组的不变量（M240 顺手收 M239 的漏登记）：`COMMAND_IDS` 每条都有组（零兜底「其他」）/ 组里无幻影 id / 分组互斥且条目总数 = 命令总数——兜底组是「新命令忘归组」的静默出口，这三条把它变成 unit 层红灯 |
| `src/table-fullscreen.ts` + `src/preview/table.ts` | 表格放大全屏查看（M240，change table-fullscreen-view）：遮罩状态机（打开的动作顺序、`Esc` 就地消费、三条用户关闭路径都交还焦点 / 焦点兜底不抢焦点、已关闭后的迟到关闭是空操作、toggle 的开-关-开）、`fullscreenTableAt` 的命中判据（caret 在渲染为 grid 的表内 / 表外 / 降级表内 / 非矩形表内 / 空表集）、触发钮读屏名与 deck D124 的对账 |
| `src/cell-geometry.ts` | grid 表格 cell 归属与 ⌃E 落点口径（M185）：形态矩阵下的 `cellContentEdge`（cell 右边界位按前向归属 / 内容紧贴管道符 / 下一 cell 空 cell 或短行补空列 / 末 cell / 多空格对齐空白）、边界位上的两套归属（编辑命令按本 cell 的 `inside`+`next`，⌃E 按前向）、落点幂等、非 grid 表返回 null。⌃F 的落点（= 隐藏管道符左缘）由 chromium 实测提供，view 侧的「可停靠」回退不在本层 |
| `src/pane-layout.ts` | pane 容器账本与活跃 pane 状态机（M315，change pane-system-split-view；纯逻辑，句柄由替身注入、标签用真 `EditorState`）：pane 上限二与第三次 `split` 无操作、`close` 标签按序并入 + 被收起 pane 的前台成为目标前台、`moveTab` 归属唯一且**同一标签对象（含 `EditorState`）原样随行**、空 pane 合法在场不自动收起、活跃指针全部迁移路径、`openTab` 判重（命中他 pane 已开文件走移动、`create` 不被调用）与前台邻居口径、`disposeHandle` 恰好一次 |
| `src/quote-gesture.ts` | 摘录卡片的纯逻辑层（M344，change add-harness-quote-cards）：`quoteLinesOf` 行范围捕获（A-B / A-A / 越界 null）、`parseQuoteLines` 解析、失锚降级链 1–2 层 `resolveQuoteAnchor`（行号 + 前缀校验命中 / 漂移全文搜索命中 / 越界与失配 null，含空串反命中挡板）与 `quotePrefixMatched` 的双向共同长度语义（行尾追加 / 行截短命中、开头改才失配）、`quoteContextOf` 标题链（同级弹出、首个标题前为空串）——反向用例逐判据配一条 |
| `src/harness-panel.ts`（思考纯模型层） | 思考块四态与时长（M363，change add-harness-thinking-display-and-effort）：`accumulateThinkingBlock` 首分片开块 / 同块合并 / 乱序到达按块序号归位、`thinkingDurationSec` 四舍五入与负差 clamp（轮次结束定格 = 不再进分片即冻结）、`thinkingHeadText` 的 zh/en 两串模板（D388）、`thinkingStateOf` 的快照宽容提取（缺键 / 非法档 → null，supported 严格 true）、`effortLabel` 小写原词 → 首字母大写（zh/en 均英文原文的档位名） |
| `src/harness-panel.ts`（工具行摘要人话化 + 快照恢复判定） | M368 起，M406 重写：`humanizeToolArgs` / `humanizeToolArgsStrict` 的参数格展示层提取（按工具名取关键参数——cli_run 拼完整命令行、vault_* 取路径、vault_search 取查询词、skill_load 取技能名；截断 / 非 JSON / 未知工具一律回落不伪造）、`rejectedReasonOf` / `failureTextOf` 的恢复路径拒绝原因与失败尾注（数据源是输出 JSON 原文，summary 那份被 core 80 字截断不取）、`formatArgv` / `diffPathOf` / `approvalArgsText` 的批准载荷拼取，以及 `restoredAssistantText` 的空正文跳过（空串 / 纯空白 / 缺 text / 非字符串 → 不渲染）。后者的**形状在当前流水线上造不出来**（core 侧 M367 起不落空正文面板消息、套件 fixtures 里也没有纯工具轮），故它是「空正文记录被渲染成光秃 who 行」这条缺陷唯一的判据落点——验收场景 96 的覆盖边界里如实登记了这个盲区 |
| `src/harness-panel.ts`（M378 hint 文案；M627 字号） | hint 两行带值文案插值（D395 第一行 ctx、D401 第二行 cache，zh/en 双档，缺占位参数抛错）与面板缩放比口径（M627：`textScaleRatio` = 编辑器当前字号 ÷ 配置基线，1 = 基线；面板不自持档位、不认焦点，M378 的 `nextHarnessFontSize` 与焦点路由已废止） |
| `src/harness-panel.ts`（M510 撤销 force 单一真源） | `STRUCTURAL_EDIT_FORCE` + `deleteFamilyStep` / `selectionDeleteStep` / `softBreakStep` 的 force 单一真源（composer 全部结构性 call site：卡片插入/移除、粘贴、拆段、删除族、kill-yank 族、边界位物化键入、IME 组合物化）：贴图（force 压栈）后 1000ms 聚簇窗口内结构步的复现链，撤销时 MUST 恢复「贴图后、结构步前」状态；反向守卫（把 force 强制回 false）证明该断言确有区分度。三处 `false` 豁免（键入压栈、⌃T 转置、删除族空转空写）不变——契约见 `openspec/specs/harness/spec.md`「混排输入区的撤销栈聚簇与结构操作独立成步」 |
| `src/ipc.ts`（`harness:event` 白名单不变量） | M595：`HarnessEvent` 联合的每个 type 都必须通过 `parseHarnessEvent` 的准入门——从源码取联合声明的 type 清单逐个喂 parser（漏接即 null → 红）、白名单 case 集合与联合逐项对账（多一个 / 少一个都红）、`parseHarnessEvent` 自身不得再另列 case 清单（防第三份真源）；反向输入删任一 case / 加幽灵 case 均实测判红。现场是 `title` 事件被静默丢弃（M576 引入、M590 未补），同族第二次 |
| `src/harness-panel.ts`（事件消费侧穷尽性闸门） | M603：`handleEvent` 的 switch case 集合与 `HarnessEvent` 联合逐项对账（漏 case / 幽灵 case 即红）、default 分支必须经共享的 `uncoveredEventType(event)` 收口（形参确认是 `never`）；`GATED_EVENT_TYPES` 的 `ReadonlySet<HarnessEvent["type"]>` 注解与词元对账（必为联合成员、闸门恒为内容事件五类）；反向输入逐条证明判据有区分度 |
| `src/harness-context.ts` | 上下文组装（M343 / M412：路径恒注入、无卡片时只注入视口行号、携带卡片跳过视口、选区不自动注入）与 M606 的 chip 路径折叠纯函数 `collapseMiddleDirs`（两层及以上目录折成 `…/文件名`、根目录文件与一层目录原样、空串 / 尾斜杠等边界不伪造读数——深 / 浅两侧互为正反观测） |

不在这一层：DOM 交互、CodeMirror view、渲染与布局（归 `tests/visual`）、真实 WKWebView
下的行为（归 `scripts/acceptance`）。真 `EditorView` 需要 DOM，硬造只会得到一层假实现，
所以编辑器用假 `EditorHandle`，但会话内容用真的 `EditorState` 承载。

## 选型：零新增依赖 + Node 自带的类型剥离

- **运行期直接跑 `src/*.ts` 源码**（Node 的类型剥离），不预编译、不落产物：
  没有「跑的是不是当前源码」的核对，也没有第二套模块解释口径。`hooks.mjs` 只补一件事——
  src 内部用的是 bundler 口径的无扩展名相对导入（`from "./ipc"`），Node 的 ESM 解析器要
  全扩展名；钩子按 `.ts` 再解析一次。**不改 src 任何文件。**
- **不加 vitest / tsx / ts-node**：为一个 26 条断言的层引入测试框架与转译链，换来的是更慢的
  启动和一份需要跟着升级的依赖。`node:test` + `node:assert` 足够。
- **不装 `@types/node`**：`node-env.d.ts` 手写补齐用到的那几个 API（同
  `tests/visual/node-env.d.ts` 的惯例）。它是本层唯一「声明可能与真实实现漂移」的地方，
  用到的面很小（`test` / `mock.timers` / `assert` 的几个方法）。将来这一层扩面时，应优先
  换成正装 `@types/node` 并删掉该文件。

### Node 下限的取舍（本层唯一的硬约束）

类型剥离需要 **Node ≥ 22.6**（22.18 起默认开启，22.6–22.17 需 `--experimental-strip-types`，
`run.mjs` 自动带上）。而仓库 `README.md` 声明的开发环境下限是 `^20.19.0 或 >=22.12.0`：

- `>=22.12.0` 这一支没问题（flag 在，Vite 也支持）。
- `^20.19.0` 这一支**跑不了本层**：20.x 没有类型剥离，`run.mjs` 会直接红并给出升级提示
  （**不静默跳过**——留下一个「跑了但其实没跑」的绿，正是这一层要修的病）。
  该分支已 EOL（2026-04-30），且 Vite 8 自身要求 `^20.19 || >=22.12`。

即：本层把 Node 下限抬到 22.6，README 那行未同步（README 不在 M153 的改动面，已作为
finding 上报）。替代方案是 tsc 预编译成 CJS 再打补丁替换模块边界——多一份产物目录、多一层
「产物是否最新」的核对，为的只是兼容一个已 EOL 的运行时，故未采纳。

## 目录

| 文件 | 职责 |
|---|---|
| `run.mjs` | 入口：探测类型剥离可用性 → 显式列出 `*.test.ts` → 起 `node --test` |
| `register.mjs` | 用 `node --import` 挂上解析钩子 |
| `hooks.mjs` | 解析钩子：无扩展名的相对导入按 `.ts` 再解析一次 |
| `harness.ts` | 测试替身：假 Tauri 后端（`window.__TAURI_INTERNALS__`）、假 toast 挂载点、假 `EditorHandle` |
| `syntax-tree.ts` | 「拿到覆盖整篇的语法树快照」的共享 helper（`completeTree`）——读语法树的用例一律先过它 |
| `*.test.ts` | 用例 |
| `node-env.d.ts` | 用到的 Node API 的环境声明 |
| `tsconfig.json` | `tsc --noEmit` 的类型防线（`gate.sh` 的 `tsc-unit`） |

替身边界取在**平台边界**（Tauri invoke、toast 挂载点）而不是业务模块边界：`src/ipc.ts`、
`src/diagnostics.ts`、`src/save-controller.ts` 都是仓里那一份真代码，只有「机器」那一侧是假的
（与 `tests/visual/scenes/tauri-stub.ts` 同一口径）。未注册的 command 一律以 fixture 错误
reject，避免「测试没实现的命令」变成静默怪现象。

## 纪律

- 新增纯逻辑先在这里补断言：这一层的价值是「秒级、可复现、坏了一看就懂」，不是覆盖率数字。
- **读语法树的用例先过 `completeTree`（`syntax-tree.ts`）**：`syntaxTree(state)` 读的是 state
  构造时定格的 **field 快照**，而初始解析只有 20ms 墙钟预算；机器有负载（多 worktree 并发）时
  快照残缺，`ensureSyntaxTree(...) !== null` 这条守卫守的是另一棵树（context），既造成假红，
  又让「MUST NOT 命中」类负向断言因节点缺失而假绿。坑的完整说明与确定性读数见该文件头。
- 三个 `.mjs`（runner 与钩子）不参与 `tsc`（`checkJs` 关）：它们的正确性由「每次门禁都真的
  跑它」承担，不靠声明文件。
- 类型剥离只认**可擦除语法**：`enum`、构造函数参数属性之类会在运行期直接抛
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。本层没开 `tsc` 的 `erasableSyntaxOnly`——`src/preview/*`
  里已有参数属性，开了会让这一层因为别处的写法而红；踩到时按报错改写法即可。
