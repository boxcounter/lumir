# 真机验收套件（scripts/acceptance）

把 backlog「待真机验收」里的**行为判定**下沉成 agent 可执行、可复现的制品。设计依据与裁决点见
[docs/process/real-machine-acceptance.md](../../docs/process/real-machine-acceptance.md)。

## 一条命令跑完

```bash
node scripts/acceptance/run.mjs              # 全部场景
node scripts/acceptance/run.mjs 01 08        # 按 id 前缀 / backlog 项号筛选
node scripts/acceptance/run.mjs --list       # 列出场景
node scripts/acceptance/run.mjs --check      # 静态校验场景（不真机，秒级；挡 key 拼错/断言形态错）
node scripts/acceptance/run.mjs --keep-app   # 跑完保留 app，人工接手看现场
```

退出码：全 PASS = 0，有 FAIL = 1，运行失败 = 2。

前提：本机已装 KimiCU.app（`/Applications/KimiCU.app`）并授予辅助功能 + 屏幕录制。套件自身零新增
依赖——只用 Node 内置模块 + 仓库已有的 `js-yaml`，GUI 通道复用 KimiCU 官方 MCP server。

## 它做了什么

1. **起真实 app**：`pnpm tauri dev`（WKWebView，非 chromium 近似）。
2. **驱动**：经 KimiCU MCP（stdio JSON-RPC）读 AX 树 / 截图 / 注入键盘与点击。
3. **断言**：AX 文本、编辑器文档文本、磁盘文件（sha256 / mtime / 内容 / glob）。
4. **落证**：`test-results/acceptance/<日期>/<场景>/`（git 外）。

### 起实例前的环境纪律（tower 定，2026-09-16）

runner 在启动前做预检，不满足直接退出且不产生半截证据：

| 检查 | 规则 | 为什么 |
|---|---|---|
| KimiCU 可用 | 二进制不存在即报错并给安装命令 | 驱动通道缺失时跑也是白跑 |
| 磁盘水位 | `< 2G` 拒绝启动（可选显式绕过，见下） | 真机实例触发 cargo/vite 时 ENOSPC 硬失败（批次四实证） |
| 1420 端口 | 只报告占用情况 | 全机同一时刻只能有一个 `pnpm tauri dev`（vite strictPort 1420）；本套件走独立端口，但仍先看一眼同机负载 |

**键盘场景的前台纪律**（tower 定，M134 实证）：KimiCU 对 WKWebView 内 CodeMirror 的键盘注入在窗口
**被遮挡时不落地**（返回 `occluded:true`），activate 后也未必恢复。因此 runner 在每个场景就绪后、
以及每次 `restart` 之后都会 `ensureForeground`：已在前台不动窗口，否则 AXRaise 并复验 `lsappinfo`
的前台归属；**拿不到前台就报 FAIL**，不静默跳过、也不改用 `set_value` 伪造键盘语义（`set_value`
不经键位分发链路，验不到 `keys.ts`）。副作用：跑套件期间 Lumir 窗口会到前台。

**磁盘水位绕过**：`LUMIR_ACCEPTANCE_ALLOW_LOW_DISK=1` 可越过 2G 阈值，**只在 target 已热、本次不会
触发 Rust 重编**（实际磁盘需求仅几 MB）时使用；绕过会写进 run.log 留痕，不静默。

### 运行环境是隔离的（三件事一起保证可复现）

| 隔离项 | 做法 | 为什么 |
|---|---|---|
| 配置目录 | app 进程带 `XDG_CONFIG_HOME=<结果目录>/../env` 启动，套件自带 `config.json`；**每场景清空其中的 `recovery/`** | `src-tauri/src/config.rs` 优先读 `XDG_CONFIG_HOME`；用户的 `~/.config/lumir` 全程不读不写。清 `recovery/` 是必须的——崩溃备份在配置目录下而非 vault 里，不清会让上一场景的备份串场（实证：08c 恢复出了 keys.md 的内容） |
| 验收 vault | `/tmp/lumir-m102-acceptance`，每次运行重置为 `fixtures/` 的精确副本 | 合成 vault；用户真实 vault（`/Users/boxcounter/Downloads/Everything-copy`）永不写入（`assertSafeTargets()` 兜底拒绝） |
| 端口 | dev server 走 `LUMIR_ACCEPTANCE_PORT`（默认 1430），经 `--config` 覆写 | 绝不与 Alex 手头的 `pnpm tauri dev` 抢 1420 |

app 进程的定位用**进程组**（`pnpm tauri dev` 以 detached 起，自成一组）：Tauri CLI 以相对路径
`target/debug/lumir` 起子进程，命令行里没有 worktree 路径，按路径区分会误抓 Alex 手头那份实例。

## 场景格式

一个验收项一个 markdown，YAML front-matter 声明机器可执行部分，正文写人读说明。

```markdown
---
id: "01-mermaid-click"
item: 1                      # 对应 backlog「待真机验收」项号
title: Mermaid 图表点击进源码编辑
fixtures: [mermaid.md]       # 场景开始前覆盖进验收 vault 的 fixture
open: mermaid.md             # 用左栏点击打开的文件
marker: "Mermaid 场景"       # 等编辑器出现该内容才算打开成功
config: { keys: {...} }      # 可选：覆盖隔离 config.json（触发重跑 app）
steps:
  - name: 渲染态              # 人读的步骤名，步骤下所有断言都挂在它下面
    expect:
      - label: 图表 widget 存在
        ax: { has: 'help="```mermaid' }
      - label: 源码未显露
        editor: { not: "A[入口] --> B[出口]" }
      - shot: 渲染态           # 截图证据（同时存 AX dump）
  - name: 点击图表
    do: click
    target: { role: AXGroup, help: "/```mermaid/" }
    expect:
      - label: 点击后源码显露
        editor: { has: "A[入口] --> B[出口]" }
---
```

### 动作（`do`）

| 动作 | 参数 | 说明 |
|---|---|---|
| （省略） | — | 只做断言 |
| `open` | `file`、`marker` | 点左栏文件名打开，等编辑器出现 marker |
| `click` | `target: {role,name\|help\|any,nth}` 或 `{x,y}` | 节点按 AX 索引点（走 AXPress）；`{x,y}` 走真实鼠标坐标 |
| `clickInNode` | `target`、`dx`、`dy` | 点「某个有 bbox 的节点内部」的相对位置（如 `AXTable`） |
| `clickEditor` | `dx`（默认 40）、`dy`（默认 6） | 点编辑器顶部建立渲染层焦点（编辑器内元素无 AX bbox，只能按坐标） |
| `focusWindow` | `retries` | 确保目标窗口在前台（键盘场景的前台纪律，见上） |
| `key` / `keys` | `key` / `keys: [...]`、`gapMs` | 键盘注入（`ctrl+n`、`cmd+s`、`cmd+/` …）。`keys` 对**整串都是可打印单字符**的序列额外做回读 + 有限重试（≤3）；chord / 混合序列 / 无可读目标一律保持盲发不重试（判定边界见「已知边界」） |
| `type` | `text`、`clear`、`retries` | 输入到编辑器（内部先真实点击聚焦，避免落陈旧选区）；回读 + 有限重试与 `keys` **同一口径**：只在编辑器字节完全未变时重试（≤3），partial landing 直接报错不重试（判定边界见「已知边界」） |
| `sleep` | `ms` | 等待 |
| `record` | `as`、`file` | 记下文件 sha256/mtime，供 `changedSince`/`unchangedSince`/`mtimeNewerThan` 比较 |
| `recordEditor` | `as` | 记下编辑器文本，供 `editor.unchangedSince` 做**逐字节**比较 |
| `vaultWrite` / `vaultAppend` | `file`、`content` | 从外部改写验收 vault（模拟外部修改） |
| `vaultRm` | `file` 或 `files` | 从外部**真删除**（不存在即报错）——触发 `fs_not_found` 与「保存冲突」是两条不同分支 |
| `configWrite` | `keys`、`restart` | 改写隔离 config.json（默认重启 app） |
| `restart` | — | 重启 app（崩溃恢复类场景） |

### 断言（每个 `expect` 条目一条记录）

| 形态 | 字段 | 说明 |
|---|---|---|
| `ax` | `has` / `not` / `count:{pattern,exact,min,max}` / `focused` | `has`/`not`/`count` 在 AX 树**文本**上匹配；`focused: "AXTextArea"` 走**解析结果**——要求 AX 里恰有一个 focused 节点且其 role 命中（键盘落点类断言用这个，别用跨节点的正则，见「已知边界」） |
| `editor` | `has` / `not` / `unchangedSince` / `changedSince` | 在编辑器文档文本（AXTextArea.value）上匹配；`*Since` 引用 `recordEditor` 记的基线，做逐字节比较 |
| `file` | `path`、`exists`、`has`、`not`、`changedSince`、`unchangedSince`、`mtimeNewerThan` | `path` 相对验收 vault；`env:` 前缀指隔离配置目录；`xxxSince` 引用 `record` 记下的基线。`path` 含 `*` 时按 glob 在父目录里取**匹配文件里 mtime 最新的那一份**再断言（诊断日志按 UTC 日期命名、`env/` 目录跨天复用，写死日期的断言会在之后每天读到上次 run 的旧文件而永久空过——这条是给那类「按日期滚动、目录不重置」的产物用的） |
| `glob` | `dir`、`pattern`、`min`/`exact` | 文件名由 app 决定的产物（崩溃备份、另存副本）用 glob 断言 |
| `shot` | 名称 | 截图 + AX dump 留档 |

匹配值：字符串按**子串**；`/.../` 包起来按正则。注意**正则一律带 `m` flag**（`lib/execute.mjs` 的 `matcher()`），
所以 `^`/`$` 是**行**边界而不是字符串边界：要断言「文档末尾」得写 `(?![\\s\\S])`（负向先行断言后面没有字符）。
M140 r1 评审实证：`/PAUSE-PROBE[\\s\\S]*$/` 在 `m` 下恒真（`[\s\S]*` 能吞到末尾、`$` 恰好也成立），
探测串在文档中部照样 PASS——这类「看着更强、其实等价于子串」的断言是本套件最该盯的假绿形态。

反过来说，`^`/`$` 也是**跨行保护**：JSONL 一行一事件，要断言「同一个事件里两个字段同时出现」就写
`/^.*"category":"asset".*"outcome":"opened".*$/`——不加锚点的 `.*` 会被文件里别的事件满足，断言退化成
「两串都在文件里出现过」（M145 的 `12-links` 用这个形态断言 `link_open` 的类别与结果）。

## 证据布局（`test-results/acceptance/<日期>/`，git 外）

```
<日期>/
├── summary.md            # 场景 → PASS/FAIL 汇总表
├── results.json          # 机器读
├── run.log               # 每次场景结果的追加日志
├── app.log               # pnpm tauri dev 的完整输出
└── <场景 id>/
    ├── status.txt        # PASS / FAIL
    ├── meta.json         # 场景元信息 + 开始时间
    ├── steps.md          # 逐步骤逐断言结果；失败项单列一节
    ├── shots/NN-*.jpeg   # 截图证据
    └── ax/NN-*.txt       # 断言失败时的 AX dump（复盘用）
```

Alex 抽审路径：先看 `summary.md`，再进 FAIL 场景看 `steps.md` + `shots/`。手感项只看截图。

## 已知边界（写清楚，别当成 bug 去追）

- **不做手感/审美判定**：表头双击选中手感、表格宽度观感、WKWebView 下的翻屏节奏等归 Alex；
  套件只留截图证据（与 `tests/visual/README.md` 同一原则）。
- **不进 CI（v0）**：macos runner 跑真机 Tauri 成本高、失败模式多，稳定后再评。
- **光标/选区不可断言**：KimiCU 的 AX 输出不暴露 `AXSelectedTextRange`，因此「逐 cell 行移动」
  「kill 到 cell 尾不跨管道符」这类**光标位置**口径无法在真机断言；套件只验「序列按键后文档不被
  破坏、源码不泄漏」，精确语义由 chromium 侧视觉场景覆盖。
- **编辑器内容是 AXTextArea.value**：它等于**渲染后**的文档文本（被 widget 替换掉的源码在里面
  看不见）——这正是「渲染态 vs 源码显露」断言的判据。长文档只有视口内的行在 AX 里，场景 fixture
  因此都很短。
- **AX 解析用「引号奇偶」判多行 value 的边界**：`AXTextArea` 的文档文本跨行展开，解析器按引号是否
  闭合决定续行到哪。若**文档内容本身含 `"`**，value 会被从引号处截断，导致 `editor.has` 假 FAIL /
  `editor.not` 假 PASS。当前 fixtures 不含引号；加含引号的 fixture 前要先修 `lib/ax.mjs` 的启发式。
- **AX 的 `(focused)` 标记**：KimiCU 在 AX 文本里给当前聚焦节点标 `(focused)`（多行 value 落在**末行**上，
  故 `lib/ax.mjs` 在合并后的整段里找），解析成 `node.focused`——`keys` 动作的落点判定与
  `ax: { focused: "AXTextArea" }` 断言都读它。**不要用 AX 原始文本上的正则做落点断言**：正则没有节点
  边界，`AXTextArea[\s\S]*?\(focused\)` 在 `(focused)` 落在后面的节点（冲突 toast 的按钮等）上照样
  匹配（r1 评审实证）；`focused` 形态要求**恰一个** focused 节点且 role 命中，堵死这条假阳性路径。
  局限：如果**文档正文本身含 `(focused)` 字样**，该节点会被误标（当前 fixtures 不含）；另外输入法/多窗口
  切换瞬间 AX 的 focused 标记可能滞后于 DOM 焦点，此时回读会盯在旧目标上——按「按键未落地/部分落地」
  报错，不会静默放过。
- **文本注入偶发不落地**：KimiCU 的 `type_text` 对 WKWebView 偶发返回 `ok` 但编辑器没变（M134 实证，
  M135 r2 也撞到一次：07b 首轮因输入没落地而 FAIL，重跑即过）。`do: type` 因此做「注入 → 回读校验 →
  没落地才重试」，**重试口径与 `keys` 统一（M143 对齐）**：
  - **只在目标字节完全未变时才重试**（回读 `AXTextArea.value`，最多 3 次）。值变了却没凑齐目标串
    （partial landing）**直接报错不重试**——再注入整串会原地拼到已经落地的残段后面。回读目标在注入
    过程中变得不可读（无 `AXTextArea`，如 modal 打开）也直接报错，不在不可观测的窗口里下结论。
  - **判据是出现次数**：注入前记目标串出现 N 次，落地要求恰为 N+1。N+2 记「重复落地」；次数不够
    且字节未变记「未落地」（可重试）；次数不够但字节已变记「部分落地」（报错）。重试次数写进证据
    （`type 注入第 N 次才落地`）。
  - **历史教训（别再回到旧口径）**：加固前是「次数 ≠ N+1 就重试」，且注释声称次数校验能挡住前缀型
    partial landing——两处都错。真机例（M140 r1 评审独立复验）：搜索框先有 `n`，注入 `eedle` 只落地
    `dl` 得 `ndl`，按次数口径重试拼成 `ndleedle`，`eedle` 恰现 1 次 = N+1 即放行，而输入框已坏；
    旧注释举的 `MEM-` + `MEM-EDIT-2` → `MEM-MEM-EDIT-2` 记 2 次也算错，后者在该串里只出现 1 次
    （split 计数）。仅靠 `editor.has(want)` 子串匹配挡不住这类路径，必须字节判据 + 次数一起用。
- **`press_key` 的逐键注入会整批丢键（原生 input 与编辑器 contenteditable 都有）**：M139 往搜索
  panel 的原生 `<input>` 逐字符注入 `needle` 只落地 `ndl`（三个 `e` 全丢）、`a..z` 只落地
  `abcdghijkl`（丢 e、f 与 m..z），且 app 侧 keydown 探针证明被丢的键**从未到达 DOM**（收到的
  keydown 序列就是 `N,D,L`，输入框依次 `[n][nd][ndl]`）；M138 在 08b 里对编辑器盲发 `m,o,r,e`
  **2/2 稳定全丢**（两次文本逐字相同），`git stash push -- src/preview src/style.css` 对照后仍复现
  （排除产品代码因果）——因此那条「contenteditable 稳定落地」的旁证被证伪，编辑器路径同样会整批丢。
  `do: keys` 的对策是回读 + 有限重试（≤3），判定边界（M140 定死，别扩大适用面）：
  - **只对「整串都是单个可打印字符」的 keys 做回读/重试**。chord（`cmd+s`/`ctrl+n`/`escape`）没有
    文本语义，重试还会重复触发副作用（⌘S 再存一次盘、⌃N 再挪一次光标），一律保持原路径盲发。
  - **回读目标按 AX 的 `(focused)` 标记选**：标记在谁身上键盘就往谁落。`AXTextArea` → 读 `.value`
    （编辑器路径）；`AXTextField`/`AXSearchField` → 读 `.value`（原生 input 路径）；焦点落在按钮这类
    非文本节点上时回读它自己的可读字段，如实判成「焦点不在文本目标上」。没有 focused 标记时才退到
    「编辑器优先、其次第一个可读输入框」。目标取不到 → 保持盲发并留一条 note。
  - **判据仍是出现次数**（注入前 N、注入后须恰为 N+1），且**只在目标字节完全没变时才重试**：整批丢键
    正是本重试要修的；值变了却没凑齐目标串（partial landing）**直接报错不重试**——再注入整串会原地拼接
    出脏文本（M140 真机复现：`needle` 被丢成 `ndl`，按次数口径重试会拼成 `ndlneedle` 并通过 N+1 校验，
    而子串断言照样绿，正是本口径要挡的假绿）。重试次数写进证据（`keys「more」第 N 次注入才落地`）。
  - **无效的缓解**（M140 实测过，别再试）：加长 `gapMs`（250→700）、注入前 settle 2.5s、坐标点回
    编辑器（连跑 5 次全 FAIL）、补一个 `⌘→` 归位。丢的是注入链路本身，不是节奏或光标位置。
- **冲突待决态下 `press_key` 丢键而 `type_text` 仍可用**（M140 实证，08b 的现场）：`⌘S` 提出保存冲突后，
  同一编辑器上 `press_key` 的可打印序列连续 6 次「未落地」（工具自报 `ok/occluded=false`），而
  `do: type`（type_text）在同一现场稳定落地。08b 的「冲突期间继续输入」因此走 `do: type`，并把落点
  设计成对「光标保留」与「光标被重置到文档末尾」两种 app 行为都成立：探测串先追加到文档末尾，再断言
  紧跟其后的追加——落点跑到别处就 FAIL，不是恒真断言。
- **编辑器不可读 ≠ 文档为空**：modal（⌘/ 键位面板、对话框）打开期间 AX 快照里**没有 AXTextArea**，
  此时 `editor.*` 一律记 FAIL，`recordEditor` 直接报错——否则负向断言与逐字节比较会在 `"" === ""`
  上空转假绿（r2 评审实证）。断言需要读文档时，基线要在 modal 打开前记录、关闭后比较。
- **AX 快照可能退化**：`get_app_state` 偶尔只返回菜单栏（`truncated: [..., cycle]`）。这通常是
  KimiCU 后台服务进了坏状态，表现为**全局**退化（Finder、别的 app 一起坏）。此时全套会一起报
  「前端未就绪」，处理办法是重启 KimiCU 服务，不是改场景。
- **场景维护权归实现者**：新功能 mission 的 tasks 必须带「新增/更新验收场景」一项（裁决点 3）。

## 加一个场景

1. 需要新文档就加 `fixtures/<名>.md`（短文档，标题行当 `marker`）。
2. 在 `scenarios/` 建 `<项号>-<短名>.md`，front-matter 里写清 `item` / `fixtures` / `open`。
3. 断言优先选**稳定子串**（文案单一来源是 `文案-Copy.md`）与**磁盘事实**（sha256/mtime），少依赖
   toast 停留时长。
4. `node scripts/acceptance/run.mjs --check` 过静态校验，再 `node scripts/acceptance/run.mjs <id>` 跑通
   （FAIL 为零，失败项如实记录不硬凑）。
