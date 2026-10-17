# Design: harness 目录引用 → 左栏文件树定位

- Change ID: harness-dir-link
- 日期: 2026-10-17
- 基分支：master `77cd3c8a`（含 change `harness-path-link` 的实现）
- 前置：change `harness-path-link`（下文简称 M552）尚未归档；本文的 `harness` 增量以它的
  requirement 文本为基线（归档顺序见 §11）。

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时逐一读过原文）

### 0.1 树侧按路径 reveal 的既有原语与缺口

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 既有定位能力 | `src/tree.ts:283`（`FileTree.revealPath` 接口）、`:1108`（实现入口）、`:1131`（`reveal`） | 直接复用它的两段式结构 |
| 可达性确认（祖先链 + 惰性取数） | `src/tree.ts:1114` `ancestorChain`；取数 `:705` `fetchLazyChildren`；取数登记 `:408` `lazyFetching` | 目录定位沿用同一份可达性判据；惰性祖先的按需取回**已实现**，无缺口 |
| 展开祖先 | `src/tree.ts:681` `expandNode`（`toggle` / `reveal` / `beginCreate` 共用） | 直接复用，MUST NOT 另写一套展开 |
| 滚动定位 | `src/tree.ts:1141` `scrollIntoView({ block: "nearest" })`；先例 `src/tree-menu.ts:281`、`src/tabs.ts:718`、`src/vault-switcher.ts:1174` | 目录定位取同一条几何口径（已在视口内不动） |
| **缺口 ①：定位会把目标行标成当前行** | `src/tree.ts:1137`–`:1138`（`currentPath = path; syncCurrent()`）；规格 `openspec/specs/file-tree/spec.md:307`-`308`、`multi-tabs`「文件树联动与空态」 | 目录不是文档，标成当前行会污染「当前打开文档」的语义；本 change 新增一条不写当前行的定位路径 |
| **缺口 ②：没有短暂高亮的形态** | `src/style.css:980`（`is-current`）、`:1002`（`is-menu-target`）、`:1010`（`is-drop-target`）；三者的在场期语义各自绑定（当前文档 / 菜单开着 / 一次拖拽） | 三种既有行态都不能借用（语义会在场期不符，违反「类名即语义」的既有纪律）；需新增一条行态规则 |
| 树模型 | `src/tree.ts:399` `createFileTree`、`:401` `nodes: Map<string, Node>`；条目 `src/bindings/FsEntry.ts`（`path` / `kind` / `lazy`） | 目录成员判定的**唯一真源**（见 §2） |
| 惰性目录的模型语义 | `src/tree.ts:310`-`315`（`Node.lazy`）；`src-tauri/src/fs_io.rs:558` `scan_workspace`（`lazy` 行照常发出、子孙不递归）、`:675` `scan_dir`（展开时一层） | 惰性目录**自身**在模型里 ⇒ 可点；其子目录未取回前不在模型里 ⇒ 不可点 |
| 内置规则挡住的目录 | `src-tauri/src/fs_io.rs:38` `BUILTIN_NAMES`、`:370` `is_builtin_hidden` | 它们在枚举阶段就消失 ⇒ 不在树模型 ⇒ 自然不可点，前端 MUST NOT 再抄名单 |
| 编辑 / 拖拽 / 菜单的行态 | `src/tree.ts:970` `beginRename`（行元素被换成 div）、`:483` `dragSource`、`src/tree-menu.ts:39` `MENU_TARGET_CLASS` | 高亮的生命周期要与它们共存（见 §4.5） |

### 0.2 目录集合在前端的可用形态

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 装载时手上有完整枚举（含目录） | `src/main.ts:2905`（`entries.filter(e => e.kind === "file" && !e.lazy)`）、`:2919` `tree.setVault(root, entries)` | 目录条目在装载参数里就有，但当前只提取了文件 |
| watch 增量只维护文件索引 | `src/main.ts:2958` `vaultFilePaths = patchAttachmentPaths(...)`；纯函数 `src/tree.ts:185`（三条口径：deleted 级联、lazy 不进、非文件不进） | 若要另维护目录数组，就得写第二份增量口径 |
| 展开惰性目录的取数结果只进树模型 | `src/main.ts:2853` `onExpandLazyDir` → `fsScanDir`；`src/tree.ts:728` `mergeEntry` | 另维护的目录数组会**漏掉**这些运行时取回的目录（树里有、面板不知道） |
| 面板侧索引下发 | `src/harness-panel.ts:184`（接口）、`:3309`-`:3315`（`pathLinkPaths` + `pathLinks`）、`:6662` `setPathLinkIndex` | 文件侧保持不动；目录侧走新注入 |
| 装配层的树句柄 | `src/main.ts:2716` `let tree!`、`:2835` 赋值；`:624` `revealInTree: (path) => tree.revealPath(path)`（闭包在动作发生时读） | 目录判定同样用「动作/渲染时读」的闭包；需就绪守卫（§2.3） |
| 面板构造早于树赋值 | `src/main.ts:2267` `createHarnessPanel` < `:2835` `tree = createFileTree(...)` | 见 §2.3 的 TDZ 守卫 |

**结论（写进 §2）**：目录可点性**不新增一份索引数组**，直接读文件树模型（`nodes` Map，一次 `has`）。
理由：① 与定位能力同一份数据，「可点 ⟺ 可定位」成为结构性成立而非两处对账；② 自动覆盖运行时
`fs_scan_dir` 取回的目录；③ 零新增 IPC、零新增增量口径。

### 0.3 识别层与装配层

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 候选提取 | `src/harness-path-link.ts:126` `findPathCandidates`；收缩 `:94` `resolveRun`；形状校验 `:55` `isWellFormedVaultPath`；行号后缀 `:68` `lineSuffixAt` | 扩展为「文件 / 目录」两类目标 |
| 候选结构 | 同文件 `:23` `PathCandidate` | 增加 `kind` 字段 |
| 面板渲染上下文 | `src/harness-panel.ts:2437` `PathLinkRenderContext`（`isLinkable` 为唯一判据）、`:2474` `appendText`、`:5294` `createToolText`（卡片路径在 `:5313` 判 `isLinkable`） | 判据从「是否文件」扩展为「文件还是目录」；点击按类型分发 |
| 面板依赖 | `src/harness-panel.ts:159` `openVaultPath`；`src/main.ts:2280` 的注入 | 新增一条「定位目录」的注入 |
| 打开链路（不透明复用，改不改） | `src/main.ts:2280` 起 `openPathAtLine`；`src/harness-path-link.ts:279` `openPathAtLine` | **目录点击完全不进这条链路** |

## 1. 范围与总体形状

三层改动，自内向外：

1. **识别层（纯函数）**：候选多一个 `kind`（`"file" | "dir"`），目录候选按「文件先、目录后」解析；
   尾斜杠归一；行号后缀只归文件。
2. **树层（表现）**：新增只读查询 `hasDir(path)` 与目录定位 `revealDir(path)`——可达性与展开复用
   既有实现，差别是**不写当前行**、加一次短暂高亮。
3. **装配 / 面板（接线）**：装配层把 `hasDir`（判定）与 `revealDir`（动作）注入面板；面板按
   `kind` 分发「打开文件」/「定位目录」。

不新增后端命令、不新增配置项、不改 prompt、不改文件索引语义。

## 2. 目录可点性：树模型是唯一判据

### 2.1 判据

`FileTree` 增加一个**只读**查询（名字实现期定，语义如下）：

```
hasDir(path: string): boolean   // 模型里存在该路径且条目类型是目录；根 "" 不算
```

- 返回 `true` 的**充要条件**：`nodes.get(path)?.entry.kind === "dir"`。不碰 DOM、不发 IPC、不触发取数。
- 面板侧把它包成渲染上下文里的 `isDir`，与文件侧的 Set 查找并列；解析顺序**文件先、目录后**
  （proposal / mission 的口径；真实 vault 里同一路径不可能既是文件又是目录，这个顺序只用于让判据明确）。
- **不新增目录数组、不新增增量口径**：`patchAttachmentPaths` 与 `vaultFilePaths` 完全不动。

### 2.2 为什么不是「装配层再维护一份目录数组」

被否的三条具体代价（都是为了 REVIEW.md『同一语义两处真源』条）：

1. **watch 增量要写第二份规则**：`patchAttachmentPaths` 的三条口径（deleted 级联 / lazy 不进 /
   非文件不进）在目录侧语义不同（惰性目录**要**进），照抄会立刻产生「两条规则表」。
2. **`fs_scan_dir` 取回的目录会漏**：用户展开过的惰性目录，其子目录只合并进了树模型
   （`src/tree.ts:728`），另维护的数组不知道它们；于是「树里明明有这一行，agent 引用了却不可点」。
3. **判据与能力会漂**：可点性若来自数组、定位能力来自树模型，二者在删除 / 改名的时序窗口内可以
   不一致（数组说可点、树说不可达 → 点击静默无反应）。用同一份模型就没有这个窗口。

### 2.3 装配时序（TDZ / 就绪守卫）

`createHarnessPanel`（`src/main.ts:2267`）早于 `tree = createFileTree(...)`（`:2835`）。判定闭包
**只在渲染期被调用**，而渲染最早由挂载 / 快照触发；为消除「模块求值期同步渲染」这一理论窗口，
装配层用一个就绪布尔（树赋值后置真）守卫：未就绪时 `isDir` 一律返回 `false`（与「未装载 vault
时没有可点路径」的既有形态一致，**不是**把「读不到」当成「空」的负向判据——这里没有断言，只是
不链接化）。

## 3. 识别层

### 3.1 候选与目标类型

- `PathCandidate` 增加 `kind: "file" | "dir"`；`path` 字段对目录是**去掉尾斜杠后的**路径，`text`
  仍是逐字原文（可点范围与展示文本不变）。
- 解析入口的判据从单个 `isVaultFile` 谓词换成一组只读查询（实现形态可以是 `{ isFile, isDir }`
  或一个返回 `"file" | "dir" | null` 的 resolver），**不引入模块级状态**（M552 的同一纪律：
  流式尾帧每帧重渲、单测并行）。

### 3.2 解析顺序与尾斜杠

对 run 内的每一个候选切片（沿用 M552 的「整串先试、两端剥 CJK / 句末点号」的尝试序列）：

1. 先按**文件**判定：`isWellFormedVaultPath(slice) && isFile(slice)` → `kind: "file"`；
2. 再按**目录**判定：切片以单个 `/` 结尾时去掉它（`a/b//` 仍非法：去一个后还剩空段），
   对归一后的串跑 `isWellFormedVaultPath` 与 `isDir` → `kind: "dir"`；
3. 都不命中 → 该切片不可点，继续下一个尝试（与 M552 完全一致）。

几何/语义要点：

- 尾斜杠**只允许一个**；`/` 开头、`~/` 开头、`..` / `.` 段、空段、反斜杠等结构性拒绝**全部沿用**
  `isWellFormedVaultPath`（对目录不做任何放宽——放宽只发生在「末尾那一个 `/`」）。
- 行号后缀只对**文件**消费：目录候选的可点范围止于路径本身，`docs:12` 里的 `:12` 留作文本。
  理由：目录没有行上下文，把 `:12` 并进可点范围会让一次点击携带无意义信息。
- run 长度上限、CJK 收缩、一次 run 至多一个候选——全部沿用 M552，不改。

### 3.3 哪些目录不在列（自然结果，不需要名单）

| 形态 | 为什么不可点 |
|---|---|
| 内置规则挡住的目录（`node_modules` / `target` / `.git` …） | 枚举阶段就不出现（`fs_io.rs:370`），模型里没有 |
| vault 外绝对路径、含 `..` 的路径 | 候选阶段结构性拒绝（M552 既有） |
| 惰性目录之下、本会话从未取回的目录 | 不在模型里（树里也没有这一行） |
| 用户规则挡住的目录**自身** | 在模型里（惰性行）⇒ **可点**；祖先取数失败时点击是空动作（§4.3） |
| 图片 / 二进制「目录」 | 不存在这种形态；目录判定只看 `kind === "dir"` |

## 4. 树侧：目录定位

### 4.1 `revealDir(path)` 的语义

**两段式保持 M552 的形状**（先确认可达、再动界面），落地段与 `revealPath` 的差别只有一条：

1. **可达性**：复用 `ancestorChain`（逐段确认祖先都是目录；惰性祖先 `fetchLazyChildren` 取一层；
   取数失败 = 不可达）。目标本身必须在模型里且是目录，否则空动作——**不展开任何祖先、不滚动、
   不闪**（与「半截现场比什么都不做更糟」同一条理由）。
2. **展开祖先**：由外到内 `expandNode`（复用，MUST NOT 另写）。
3. **滚动**：目标行 `scrollIntoView({ block: "nearest" })`（与 `revealPath` 完全同一口径）。
4. **不标当前行**：MUST NOT 写 `currentPath`、MUST NOT 加 `is-current` / `aria-current`。
   目标行只获得一次**短暂高亮**（§4.4）。
5. **只做表现层动作**：不打开文件、不切标签、不改前台文档、不移动焦点。

### 4.2 目标目录自身不展开

按 proposal 起草期取值 3：目录定位只展开祖先链，目标行保持当前的展开 / 折叠状态。若目标恰好已
展开，什么都不折叠（定位从不折叠）。

### 4.3 不可达 / 取数失败

与文件定位同一条口径：空动作、无 toast。理由：① 面板侧的判据与树模型同源，正常时不可达只来自
「惰性祖先取数失败」或「刚刚被删的竞态窗口」；② 面板没有「目录定位失败」的文案产物，新造一条
toast 会引入新的文案与抖动噪声（点一下就报错），而归 Alex 的观感面在 dogfood 里可见。

### 4.4 短暂高亮

- **形态**：目标行加一个行态类（名字实现期定，语义 = 「这一行刚刚被定位」），计时器在约 1.2s
  后摘除；类只影响底色（`--sel`）与 eink 下的配套前景，不改变行高 / 缩进 / 布局。
- **重入**：同一行再次定位 → 计时从零开始；另一行定位 → 先摘旧行的类再上新行（任意时刻至多
  一行带这个类，与 `is-menu-target` / `is-drop-target` 的「至多一行」形态一致）。
- **清理点**：换 vault（`setVault`）、空态（`showEmpty`）、行被增量删除（行元素已脱离文档时摘类
  是无害的，但计时器与「当前闪烁行」的登记要一并清）。
- **编辑行不闪**：重命名中的行元素已被换成 `div.ft-row.is-editing`（`src/tree.ts:970`），此时
  仍滚动定位，但不加高亮（不在一行输入框上闪底色）。
- **代际号**：连续点击两个目录时，祖先链的确认是异步的（惰性祖先取数）；用一个自增令牌保证
  **只有最后一次调用的落地段会执行**（旧调用在 await 之后发现令牌过期即返回，不展开、不滚、不闪）。
  这是本 change 新增的唯一并发守卫，可与 M552 的「下一帧复核」各管一段、互不替代。
- **不新增动效**：`.ft-row` 已有 background 过渡，高亮的进/出走这条既有时长；不引入动画曲线。

### 4.5 与既有树操作共存

| 操作 | 共存口径 |
|---|---|
| 右键菜单（`is-menu-target`，在场期 = 菜单开着） | 高亮类与它独立；两者同强度底色，声明次序让菜单作用行仍然可辨（CSS 层：菜单态在后）。菜单不收、闪烁不摘——不互相清场（各自的在场期由各自的所有者定义） |
| 拖拽（`is-drop-target`） | 同上：拖拽高亮由拖拽监听独占，定位不参与、也不清除拖拽态 |
| 内联编辑 | 定位仍可更新行态；但若编辑提交导致行被重建，闪烁登记随旧元素失效（摘类空操作），不需要额外分支 |
| 当前行（`is-current`） | 目标若恰是当前打开的文档（文件）——本能力只接收目录，不存在该交集；目录行本就不该有 `is-current` |

## 5. 面板与装配接线

### 5.1 依赖面

`HarnessPanelDeps` 新增两条（名字实现期定，语义如下）：

- `isVaultDir(path): boolean` —— 渲染期同步查询，装配层直接转到 `tree.hasDir`（带就绪守卫）；
- `revealVaultDir(path): void` —— 点击目录时的动作，装配层转到 `tree.revealDir`。

`openVaultPath(path, line?)` 保持原样（文件路径的唯一入口）。

### 5.2 渲染分发

- `PathLinkRenderContext` 由「`isLinkable` + `open`」扩展为「解析出 `kind` + 按 `kind` 分发」：
  文件 → `open(path, line)`；目录 → `reveal(path)`（忽略 line）。
- 正文 / 行内代码：候选自带 `kind`，直接分发（候选已是唯一判据，不再二次查询）。
- 工具卡片：`splitToolText` 的目标只有路径（无 kind），渲染时用同一 resolver 判类型；命中文件
  才可带行号，命中目录按目录分发。**卡片与正文共用同一套判定**，不写第二套。
- 可点元素形态、键盘行为、可见文本、`title` 全部沿用 M552 的 `<button>` 形态；MUST NOT 新增
  文案或图标（proposal 起草期取值 6）。

### 5.3 点击语义清单（可验收的「不做」）

目录点击 MUST NOT：打开文档、切标签、新建标签、创建文件 / 目录、切换 pane、移动焦点、改
`currentPath` / `aria-current`、改编辑器视口。允许：展开祖先目录、滚动左栏、给目标行一次短暂高亮。

## 6. 安全与边界

- 三层结构与 M552 相同：① 候选阶段结构性拒绝（绝对路径 / `..` / 空段）；② 成员判定（目录必须是
  当前 vault 树模型里的目录）；③ 定位只操作树模型，不拼文件系统路径、不触磁盘。
- **不新增「目录可创建 / 可展开」的写入面**：`revealDir` 对未知路径是空动作，不向磁盘发起任何
  创建请求（ADR 0003 铁律）。
- 惰性目录的 `fs_scan_dir` 取数由**用户点击**触发，一次一层；取数失败不标记已取回（沿用 M300 的
  重试语义）。

## 7. 视觉口径

- 高亮底色取 `--sel`（与 `.ft-row.is-current` / `.is-menu-target` / `.is-drop-target` 同强度档），
  eink 下按既有三处的同一手法补前景 `--sel-text`（名称与 caret 手工带上）。
- 规则位置与声明次序：`src/style.css` 的 `.ft-row` 族内、排在 `:hover` 之后（与菜单作用行 /
  拖拽落点行同一理由：指针下的 hover 不得盖过「这一行被点中了」的反馈）。
- 时长约 1.2s：**归 Alex 手感裁决**，不进机器判据（截图只能证明「曾经闪过」，不能证明节奏）。
- 目录链接本身不加任何视觉区分（与文件链接同色同下划线）；这是 proposal 起草期取值 6。

## 8. 已知边界（如实登记）

1. **惰性目录的子目录**要等用户在树里展开过（或本次定位触发取数）才进模型；在那之前 agent 对它的
   引用不可点。与「惰性文件不进索引」同源，是有意的确定性取舍。
2. **尾斜杠只允许一个**；`a/b//` 与「路径中含空格」仍不识别（后者是 M552 的既有边界）。
3. **定位失败无提示**（§4.3）：点击与左栏无反应是唯一信号。
4. **闪烁时长 / 强度不进机器判据**：验收截图只证明高亮发生过，节奏与观感归 Alex。
5. **目录引用不带行号语义**：`:12` 后缀不参与可点范围，也不影响定位。
6. **惰性目录自身的定位**在祖先取数失败时是空动作；重试路径是用户再次点击或再次展开树。

## 9. 验证策略（判别性优先）

- **候选层单测**（`tests/unit/harness-path-link.test.ts`）：
  - 目录命中 → `kind: "dir"`；文件命中 → `kind: "file"`；两者都不命中 → 无候选；
  - 尾斜杠：`docs/` 命中目录、`path` 去尾斜杠、`text` 含尾斜杠；`a/b//` 拒绝；
  - 目录不消费 `:12`：可点范围止于路径、`:12` 留作文本；文件的 `:12` 行为不变（对照成对）；
  - 中文行文紧贴目录名（`见docs/里的`）收缩命中；
  - `..` / 绝对路径 / `/` 结尾的**文件**形态仍拒绝。
- **树定位单测**（`tests/unit/tree-reveal.test.ts` 扩展或新文件）：
  - 祖先逐级展开、目标行只滚一次且 `block: "nearest"`；
  - **当前行不变**（对照：同一夹具上 `revealPath` 会改当前行，证明判据有输入）；
  - 目标不在模型 / 惰性取数失败 → 什么都不发生（不展开、不滚、不闪）；
  - 目标目录自身不展开；已展开的不折叠；
  - 连点两次（含一次惰性取数延迟）只认最后一次；
  - 高亮类的加 / 摘（假计时器）与「编辑行不闪」。
- **面板渲染 / 分发单测**：候选解析出目录 → 可点元素 + 点击走 `revealVaultDir`；文件 → 仍走
  `openVaultPath`；卡片上的目录路径同口径。
- **真机验收**（`scripts/acceptance/`）：
  - 新增场景（mock provider）：运行期造「目录 + 其下文件」，回复里引用该目录（含一个尾斜杠写法）；
    点击前判「子文件行不在 AX 里」，点击后判「子文件行出现 = 祖先已展开」、「标签数不变」、
    「编辑器文本不变」；截图见证高亮。
  - **回扫既有场景 161**：它今天断言「真实目录不产出可点元素」——本 change 会把该期望翻转。
    必须改准该断言与其正文说明，否则 161 必红且看起来像产品缺陷（`docs/process/openspec-workflow.md`
    「改权限 / 闸语义的 change」节同一条纪律的推广：语义翻转必须回扫既有期望）。
- **门禁**：`scripts/gate.sh quick`；动过 `src/style.css` 必须另跑 `scripts/gate.sh visual`，按
  GATE RESULT 原文行报告。

## 10. 不做的事（与 proposal 的 Non-goals 对齐，不重复）

实现期若发现需要：新目录索引、后端改动、prompt 改动、树右键菜单新项——一律停下走 proposal 修订，
不在实现期静默扩 scope。

## 11. 依赖与归档顺序

- `harness` 的增量是 **MODIFIED**，目标是 M552 写入 living spec 的 requirement 文本；M552 当前
  仍未归档。`validate --all --strict` 现在只给 INFO（「archive would refuse this delta」），不报红；
  但本 change 归档前 MUST 先归档 `harness-path-link`，否则 MODIFIED 找不到目标。
- 若 tower 决定两个 change 同批归档，顺序是先 `harness-path-link` 再 `harness-dir-link`。
- `file-tree` 的增量是纯 ADDED，不受这个顺序影响。

## 12. 协同预留

「内置名单分档」（让 `test-results` 等从完全隐藏变为惰性可见）落地后，这些目录进入树模型，本
change 的判据自动让 agent 引用里的它们变成可定位入口——无需再改识别层。本 change 不实现分档本身。
