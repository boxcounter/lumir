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
| 配置目录 | app 进程带 `XDG_CONFIG_HOME=<结果目录>/../env` 启动，套件自带 `config.json`；**每场景清空其中的 `recovery/`、`workspaces/`、`vault-sessions/`** | `src-tauri/src/config.rs` 优先读 `XDG_CONFIG_HOME`；用户的 `~/.config/lumir` 全程不读不写。三个子目录都必须清：崩溃备份在配置目录下而非 vault 里（不清会让上一场景的备份串场——实证：08c 恢复出了 keys.md 的内容）；`workspaces/` 决定列表浮层有几行、按路径命中哪个 id；`vault-sessions/` 决定装载后恢复哪些标签。后两者是 M164 补的（多 vault 场景会预置它们，残留会让下一场景看到上一场景的 vault 列表与标签） |
| 验收 vault（两个） | `/tmp/lumir-m102-acceptance` 与 `/tmp/lumir-m102-acceptance-b`，每次运行分别重置为 `fixtures/` 与 `fixtures/second-vault/` 的精确副本 | 合成 vault；用户真实 vault（`/Users/boxcounter/Downloads/Everything-copy`）永不写入（`assertSafeTargets()` 对两个 vault 与配置目录都兜底拒绝）。第二个 vault 是多 vault 场景的切换目标，文件名与第一个刻意不重叠 |
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
seed:                        # 可选：预置隔离配置里的注册表 / 会话（**起 app 之前**写）
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-a: { tabs: [tabs-a.md, tabs-b.md], active: tabs-b.md }
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

### 预置状态（`seed`）

`seed` 写在 front-matter 上，由 runner 在**起 app 之前**应用（`run.mjs` 的每场景重置里）。它表达
的是「这个目录此前已经是我的 vault」「这个 vault 此前开着这几个标签」这类**只能由磁盘上的配置
状态表达**的前置条件。

| 键 | 形状 | 落点 |
|---|---|---|
| `seed.registry[]` | `{ id, path, lastOpenedAt?, missingSince?, archivedAt? }` | `<隔离配置>/lumir/workspaces/<id>.json`（一条一个文件，与 Rust 侧注册表同形） |
| `seed.sessions{}` | `{ <id>: { tabs: [...], active } }` | `<隔离配置>/lumir/vault-sessions/<id>.json` |

- `path` 支持两个记号：`$vault` / `$vault2` 指套件的两个合成 vault（不写死 `/tmp` 路径，
  `LUMIR_ACCEPTANCE_VAULT` 覆写时场景跟着走）；其余按绝对路径原样用。
- **必须写在起 app 之前**：app 打开一个未注册目录时会立刻给它分配一个自动 id 并落盘，事后再预置
  同路径的注册项会让列表里出现两行指向同一目录（一行自动 id、一行预置 id），按路径查找命中哪一行
  还不确定。`prepareSeed()` 因此接在 `resetRegistry()` 之后、`launchApp()` 之前。
- `path` 会先 `realpath`：注册表存的是 canonicalize 后的路径（`reconcile_vault`），而 macOS 的
  `/tmp` 是 `/private/tmp` 的软链接——不归一的话 app 打开同一目录时 `find_by_path` 落空、另生成
  一个 id，预置的会话（按 id 存放）就对不上了。
- `id` 只允许字母数字与 `-_`（与 Rust 的 `workspaces::valid_id` 同源：id 同时是文件名，这是路径
  逃逸防护）；写错在动作处即报错，不会落一个读不回的盘。

### 动作（`do`）

| 动作 | 参数 | 说明 |
|---|---|---|
| （省略） | — | 只做断言 |
| `settle` | — | 读一次 AX 快照并落定（等价于「什么都不做、只等一拍」，用于纯断言步骤前的稳定） |
| `open` | `file`、`marker` | 点左栏文件名打开，等编辑器出现 marker |
| `click` | `target: {role,name\|help\|any,nth,count}` 或 `{x,y,count}` | 节点按 AX 索引点（走 AXPress）；`{x,y}` 走真实鼠标坐标。`count` 原样透传给 KimiCU，那四条通道**产生不出 DOM 的 `dblclick`**（判据与修正见「已知边界」）——要双击类交互请用 `doubleClick` |
| `clickNodeText` | `text` | 点 value/title **逐字等于** `text` 的节点（比 `name` 的正则更死板） |
| `clickInNode` | `target`、`dx`、`dy`、`count` | 点「某个有 bbox 的节点内部」的相对位置（如 `AXTable`）；`count` 同上，未观察到 `dblclick`（判据限制见「已知边界」） |
| `clickEditor` | `dx`（默认 40）、`dy`（默认 6） | 点编辑器顶部建立渲染层焦点（编辑器内元素无 AX bbox，只能按坐标） |
| `doubleClick` | `target`（`{role,name\|any,nth}` 或 `{x,y}`）、`dx`/`dy`、`mode`、`retries`、`settleMs` | **双击**（M209 起套件唯一的双击通道）：swift + `CGEvent` 显式设 `kCGMouseEventClickState`（详见「已知边界」）。`target` 取节点 bbox 中心、`dx`/`dy` 按其宽高比例偏移（默认 0.5）；`{x,y}` 给窗口局部坐标（遮罩这类没有 AX 节点的全屏层用）。动作内部先拿前台（**拿不到即报错**——真鼠标点击落在最上层那扇窗上），再把窗口局部点换算成 Quartz 屏幕坐标。**会移动真实光标**；目标窗口被遮挡或 KimiCU 的 AX 快照退化时按错因报错，不静默 |
| `drag` | `target`（`{role,name\|any,nth}` 节点须有 bbox、`{x,y}` 窗口局部坐标（M236 起，标题栏展示元素这类不一定有 AX bbox 的目标用），或 `{textareaEdge:"left"\|"right"}` 从编辑器列缘内侧起拖）、`dx`/`dy`（窗口局部点，UI 位移是**确定值**）、`allowOutOfBounds`、`retries`、`settleMs` | **拖拽**（M228 起，栏宽手柄这类「只能拖」的控件的唯一通道）：swift + `CGEvent` 显式投 `leftMouseDown → 插值 dragged ×24 → leftMouseUp`（与 `doubleClick` 同一通道——KimiCU 的 `drag` 工具在 WKWebView 里连文本选择都造不出来，M228 实测，见「已知边界」）。坐标换算与 `doubleClick` 同口径：先拿前台（**拿不到即报错**——真鼠标拖拽落在最上层那扇窗上），窗口局部点 + `window_bounds` 原点 → Quartz 屏幕坐标。**会移动真实光标**。起止点默认都必须在窗口内（防坐标空间错乱）；拖标题栏移动窗口时终点**故意**出窗，显式写 `allowOutOfBounds: true` 跳过终点检查。`textareaEdge` 形态存在的原因：WKWebView 把 `role=separator` 暴露成**无 bbox 的 AXSplitter**（M228 实测），栏宽手柄按节点定位不到，只能从 AXTextArea 的 bbox 边缘起拖 |
| `resizeWindow` | `width`（数值，必填）、`height`（缺省保持当前）、`settleMs` | **AX 直写窗口尺寸**（M236，窄窗退让这类「精确几何」验证）：`lib/ax-window.swift` 经 Accessibility API 设 AXSize，确定值通道（不拖窗口边缘——命中区与落点都不稳）。前提是调用进程有辅助功能权限（与 CGEvent 注入同）；窗口管理器的钳制会如实反映在回读值里，断言用 `window.width` 对生效值 |
| `focusWindow` | `retries` | 确保目标窗口在前台（键盘场景的前台纪律，见上） |
| `key` / `keys` | `key` / `keys: [...]`、`gapMs` | 键盘注入（`ctrl+n`、`cmd+s`、`cmd+/` …）。`keys` 对**整串都是可打印单字符**的序列额外做回读 + 有限重试（≤3）；chord / 混合序列 / 无可读目标一律保持盲发不重试（判定边界见「已知边界」） |
| `type` | `text`、`clear`、`retries` | 输入到编辑器（内部先真实点击聚焦，避免落陈旧选区）；回读 + 有限重试与 `keys` **同一口径**：只在编辑器字节完全未变时重试（≤3），partial landing 直接报错不重试（判定边界见「已知边界」） |
| `sleep` | `ms` | 等待 |
| `record` | `as`、`file` | 记下文件 sha256/mtime，供 `changedSince`/`unchangedSince`/`mtimeNewerThan` 比较 |
| `recordEditor` | `as` | 记下编辑器文本，供 `editor.unchangedSince` 做**逐字节**比较 |
| `vaultWrite` / `vaultAppend` | `file`、`content` | 从外部改写验收 vault（模拟外部修改） |
| `vaultRm` | `file` 或 `files` | 从外部**真删除**（不存在即报错）——触发 `fs_not_found` 与「保存冲突」是两条不同分支 |
| `configWrite` | `lastVault`、`keys`、`restart`、`requireVault`、`theme`、`contentWidth`、排版三项 | 改写隔离 config.json（默认重启 app）。`lastVault` **缺省沿用当前值**（显式给才覆盖）——启动恢复的失效路径靠它把 `last_vault` 指向一个不存在的目录；`requireVault: false` 只放宽本步重启的就绪门（见下条）。`theme` / `contentWidth` / 排版三项同样**缺省沿用当前值**（M228 起含 `ui.content_width`）：一次 configWrite MUST NOT 把前面设过的键连表抹掉 |
| `restart` | `requireVault` | 重启 app（崩溃恢复类场景） |

**就绪门与 `requireVault`**（M159 起）：每次起/重启实例后套件等「左栏文件树 + 编辑器节点就位」
（`lib/drive.mjs` 的 `waitAppReady`）。严格门的判据是「树头部的 vault 入口按钮（形态 A，
读屏名 `vault：{名称}（点击查看全部 vault）`，见 deck D96）+ 至少一个
`.md` 行」——`last_vault` 失效 / 无 `last_vault` 时前端**合法地**停在未打开空态（树 pane 里
没有文件行），严格门必不成立。因此 `configWrite` / `restart` 支持 `requireVault: false`：
本步的就绪门放宽为「树 pane 呈现任一种形态（文件行或空态说明行+打开入口）+ 编辑器在位」。
**默认仍是严格门**；放宽是逐步、显式的，终态由该场景自己的断言证明，不是「放宽即放行」。

严格门认**三种**合法终态（M164 补齐第三种）：

| 终态 | 判据（都在 `waitAppReady` 里） | 何时出现 |
|---|---|---|
| 已装载 vault + 有文件行 | 入口按钮在 + 至少一个 `.md` 行 + `AXTextArea` 可读 | 默认形态 |
| 已装载 vault + 空 vault 引导 | 入口按钮在 + D107 的「这个 vault 还没有打开的文件」在 AX 里 | 该 vault 还没有会话历史（**启动常态**，M163 起）：引导层盖住正文，编辑器从 AX 里消失——严格门不认它的话每个场景都会在这一步超时 |
| 未打开 vault 的空态 | 树 pane 的空态说明行（D5）+ 打开入口，且 `ax.textarea` 在位 | `last_vault` 失效 / 无 `last_vault`；**只有** `requireVault: false` 才认 |

第二行的判据是**正**观测（引导文案必须真的在 AX 里），不是「编辑器读不到就当就绪」——REVIEW.md
第 2 条禁的是后者。`editor.*` 类断言仍严格：`AXTextArea` 不可读一律 FAIL，不会在空转的 `""` 上下结论。

### 断言（每个 `expect` 条目一条记录）

| 形态 | 字段 | 说明 |
|---|---|---|
| `ax` | `has` / `not` / `count:{pattern,exact,min,max}` / `focused` | `has`/`not`/`count` 在 AX 树**文本**上匹配；`focused: "AXTextArea"` 走**解析结果**——要求 AX 里恰有一个 focused 节点且其 role 命中（键盘落点类断言用这个，别用跨节点的正则，见「已知边界」） |
| `editor` | `has` / `not` / `unchangedSince` / `changedSince` | 在编辑器文档文本（AXTextArea.value）上匹配；`*Since` 引用 `recordEditor` 记的基线，做逐字节比较 |
| `file` | `path`、`exists`、`has`、`not`、`changedSince`、`unchangedSince`、`mtimeUnchangedSince`、`mtimeNewerThan` | `path` 相对验收 vault；`env:` 前缀指隔离配置目录；`xxxSince` 引用 `record` 记下的基线。`unchangedSince` 只比 sha256，`mtimeUnchangedSince` 比 mtime 精确相等——「不落盘」这类判据两个一起用（写了同一份内容时 sha256 相同而 mtime 会推进）。`path` 含 `*` 时按 glob 在父目录里取**匹配文件里 mtime 最新的那一份**再断言（诊断日志按 UTC 日期命名、`env/` 目录跨天复用，写死日期的断言会在之后每天读到上次 run 的旧文件而永久空过——这条是给那类「按日期滚动、目录不重置」的产物用的） |
| `glob` | `dir`、`pattern`、`min`/`exact` | 文件名由 app 决定的产物（崩溃备份、另存副本）用 glob 断言 |
| `window` | `moved: true/false` 或 `width: N` | 窗口几何（M236）：`moved` 对比**动作前**的 window_bounds 基线（步骤须有 `do`，位移 ≥8pt 才算动——标题栏拖拽移动窗口的判据）；`width` 断言生效宽度（±8pt 容差，对窗口管理器钳制后的真实值，不对请求值） |
| `shot` | 名称 | 截图 + AX dump 留档 |

**占位符**（M236 起）：expect 字符串里可写 `$appName` / `$appVersion`，加载时从本 checkout 的
`src-tauri/tauri.conf.json` 读真值代入（worktree 跑就取 worktree 的 conf，与被测构建同源）——
场景 MUST NOT 硬编码版本号副本（真源唯一，REVIEW.md 第 8 条），版本 bump 后场景跟着真源走。

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
- **清理实例只认「自己起的那个进程组」，禁止用模式匹配 `pkill`**（2026-09-18 M164 的教训，实测代价：
  误伤了用户手头那份 dogfood 实例）：`pkill -f "target/debug/lumir"` 这类按**二进制路径**匹配的模式会连带
  命中用户的实例——同一个二进制路径，只有进程组不同（M164 实测：Alex 的 1420 会话连同它的 vite dev server
  一起退出）。套件自身就是这么隔离的：`findAppPid(pgid)` 只认 `launchApp` 起的那个进程组、`stopApp` 只对
  `-pgid` 发信号；手工清场照抄这个口径——先 `ps -o pid,pgid,command | grep target/debug/lumir` 找到自己的
  pgid，再 `kill -- -<pgid>`（或按 pid 逐个 kill），不确定归属的就别动。
- **无人值守批次要防休眠**（2026-09-18 M164 实测）：机器/显示休眠会让 app 窗口漂到屏幕外（实测
  `window_bounds y≈1076`，屏高只有 ~982pt），KimiCU 随即报
  「target WebArea did not acquire stable keyboard focus」，键盘注入整批不落地、场景里出现一串与产品无关的
  FAIL。跑真机批次时把命令包在 `caffeinate -dimsu <cmd>` 里；套件的 `launchApp` 也已把窗口位置经 `--config`
  钉在主屏（见 `lib/app.mjs` 的说明），两条一起用。
- **dirty 拦截门的可测窗口很窄**（M164 实测）：切换 vault 的 dirty 前置判据是「任一**有路径**的标签
  dirty」（`src/save-controller.ts` 的 `vaultSwitchBlock`），而自动保存的防抖是**停止输入后 2s**
  （`AUTOSAVE_DEBOUNCE_MS`）——落盘后 dirty 收回 false。所以「改完就走」这条真实窗口只有 2s，而本套件
  的键盘注入每键约 250ms + 一次 MCP 往返（`keys` 的 `gapMs` 默认 250），跨步或多键串都抢不到：
  - 抢窗口的两种写法都**实测不成立**（跨步必然等到自动保存，门不触发、直接切走；把刷新字符与
    `⌘O`/`↓`/`Enter` 塞进同一个 `keys` 步仍 2s 以上）。`19-vault-switch-guard` 因此改用
    **外部改写成冲突**制造**持久** dirty——冲突待决期间自动保存暂停（08b 覆盖该行为），守卫可以稳定
    触发，不再与注入耗时赛跑；
  - **未覆盖**：保存并切换在**保存能闭环**时「保存成功 → 继续切换」那条顺路（真机抢不到窗口）。
    由 chromium 视觉通道覆盖：`tests/visual/scenes/mv-vault-switch-guard.spec.ts`（四条用例：拦下文案与
    三出口 / 取消 / 保存并切换 / 放弃修改并切换，含 `document_save` 写动作级判据）。**不要把 19 的
    PASS 读成「三条出口的每条顺路都在真机验过」**；
  - 同族未覆盖：不可保存的脏标签（无落盘基准）不给「保存并切换」这条分支，在
    `tests/unit/vault-switcher.test.ts` 的状态机口径里。

  这类 `NSOpenPanel` 是 app 自己的模态 sheet，本套件没有驱动它的动作（也不打算加：AX 时序不稳、
  控件随系统语言变）。受影响的是 `multi-vault-workspaces` 的「新增 vault…」这条入口路径，顶法是：
  - 入口 → 选择器 → 装载新 vault 的**链路语义**由 chromium 视觉通道覆盖
    （`tests/visual/scenes/app-main.spec.ts`：`vault_open` 桩 + remap 两出口）；
  - 真机侧把「这两个目录此前都已作为 vault 打开过」用 `seed.registry` 预置（见「预置状态」），
    因此 `17/19` 验的是**切换**，不是**首次加入**：真机上「第一次把某个目录加进列表」这一段
    **没有被验证过**——这是本条缺口的准确边界，不要读成「新增路径已验证」。
  - 原生**保存**面板同样不驱动；但「另存为新文件」的落盘路径由 app 自己决定文件名
    （`07b-recovery-saveas` 断言首级产物 `plain-恢复.md`），不经对话框。
- **光标/选区不可断言**：KimiCU 的 AX 输出不暴露 `AXSelectedTextRange`，因此「逐 cell 行移动」
  「kill 到 cell 尾不跨管道符」这类**光标位置**口径无法在真机断言；套件只验「序列按键后文档不被
  破坏、源码不泄漏」，精确语义由 chromium 侧视觉场景覆盖。
  **派生证据**（2026-09-17，M148 的 `13-toc` 起）：确实必须判「跳转后光标落在哪」时，用被测功能
  自己产出的、只可能由该位置生成的字符串当判据——`13-toc` 用两条联合断言：(1) masthead 的标题链
  （口径是「光标在可见范围内取光标」，跳转后光标必在可见范围内，链条因此是光标的函数）；(2) 在
  标题行尾按 ⌃K 会把下一行并进该行（`src/editor.ts` 的 Emacs 口径），断言「带父级的链条 + 合并后的
  标题文本」联合串——该串只可能由指示段产生，文档正文里没有分隔符。写这类断言前先确认「别的位置
  会不会也产生同一个串」，并在场景正文里写清判据为什么只对目标成立。
- **控件内的键盘游标可以顺手验**（同批实证）：WKWebView 会把 `aria-activedescendant` 指向的元素
  带上 `(focused)` 标记（`13-toc` 的浮层条目即如此），于是「↓ 之后游标移到下一条」可以写成
  「同一行同时出现该条 label 与 `(focused)`」——比「面板还开着」这种恒真断言强得多。
- **`click` / `clickInNode` 的 `target` 与断言里的匹配器不是同一套口径**（M148 实证，踩了一整轮）：
  `lib/ax.mjs` 的 `findNode` 把 `name` 直接当**裸正则源**（`new RegExp(name)`），只有 `help` 走
  `findByHelp` 的 `matcher()`（`/.../` 才解成正则）。写 `target: { role: AXButton, name: "/第一部分/" }`
  会让它去找字面量「/第一部分/」，永远找不到。两处口径统一之前，`target.name` 一律写裸正则源，
  需要精确匹配就 `^…$` 锚定——锚定顺带解决另一个陷阱：`AXTextArea.value` 是整个文档文本，不加锚点
  的模式会把它也命中，`nth: 0` 取到的可能不是目标控件。
- **`clickInNode` 的 `dx`/`dy` 是节点宽高的比例（0–1），不是像素**（`lib/execute.mjs` 的 `x + w*dx`）。
  要点「容器里的第 n 个孩子」得自己算比例，或改用 `{x, y}` 绝对坐标（截图像素空间）。
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
  「前端未就绪」，处理办法是重启 KimiCU 服务，不是改场景。退化的树**没有 `window_bounds`**，
  依赖坐标的动作（`doubleClick`）因此会按这条错因报错、不会拿菜单栏的坐标去点（M209 实测：
  一次真机运行里 4 次 `get_app_state` 拿到只剩菜单栏的树，隔几拍又自己恢复）。
- **`dblclick`：KimiCU 的四条通道造不出来，`swift + CGEvent` 那条能（M184 实测，M209 修订
  2026-09-25）**：KimiCU 现有通道实测失败的有四条：`click` 的 `count: 2`（坐标路径）、`click` 的
  `count: 2`（AX 索引路径，即 AXPress ×2）、两次独立的 `click`（两次 MCP 往返的间隔超出系统双击
  间隔）、`drag_paths` 的两条单点路径（`path_gap_ms` 取 10ms 与 0ms 两种）。现场
  `test-results/m184/13`～`/17`（本机，git 外）。
  **M209 修订两处**（探针脚本 `test-results/m209-probe/cgevent-click.swift` + harness
  `probe.mjs`，现场与 AX dump 落 `test-results/acceptance/<日期>/m209-probe/`；探针脚本随后移进
  套件成为 `lib/cgevent-click.swift`，`doubleClick` 动作的驱动）：
  ① **M184 用的那条判据不成立**，不能拿它当「双击没到前端」的证据：`openFile` 对**已打开的同路径**
  会短路（`src/main.ts:380-386`——`existing !== undefined` 时只把这个标签从预览固定住、**不新建
  标签**），而单击文件树行本身就是 `open("preview")` ⇒「双击树行 → 标签数 1→2」在任何可达现场
  **恒不成立**（真双击也只把它固定住）。可用的间接判据是**固定效果**：双击之后再做一次确定的
  「预览意图打开另一文件」——被固定则新开标签（2 个），仍是预览则就地替换（1 个）。
  ② **第五条通道可用、且已接进套件**：`/usr/bin/swift` + `CGEvent` 显式设
  `kCGMouseEventClickState = 1 / 2`（两次 down/up、间隔 60ms，投到 `.cghidEventTap`）**能**造出真实
  DOM `dblclick`：同一点位的正对照（单击树行 → 标签切到该文件）与负对照（单击图片 → 遮罩不开）
  同时成立，两条独立判据都亮——树行被固定（判据①）、图片 lightbox 遮罩打开（AX 树被 `aria-modal`
  接管、放大图 `AXImage` 几何读数 1120×374、`Esc` 关得掉）。套件动作 `doubleClick`（实现
  `lib/{execute,drive}.mjs` + `lib/cgevent-click.swift`）走的就是这条；场景 33 是它的第一个消费者
  （三种引用形态各双击一次 + 三条关闭路径 + 两条 `unchangedSince`，PASS 现场
  `test-results/acceptance/<日期>/33-image-lightbox/`）。
  **用它的三条纪律**：
  - **目标窗口必须在前台且未被遮挡**：真鼠标点击落在该点最上层的那扇窗上，KimiCU 的键盘注入可以
    后台走、这条不行。`doubleClick` 拿到前台失败会**报错**（不是静默点到别处）。跑双击类场景时
    别抢前台、别让别的窗口盖住 Lumir。
  - **判据要用有区分度的形态**：「遮罩打开」这类直接判据最好用，且注意 modal 打开时 AX 树只剩模态
    子树（标签栏消失、「数图像节点 1→2」在模态作用域下恒为 1、内联那张的节点会从树里消失）。
    判据①（固定效果）是没有直接判据时的替代。
  - **「`count: 2` 出不了 dblclick」这句在 M184 的判据下测得，尚未按判据①重跑**，别当成已证结论；
    新增双击类交互请直接用 `doubleClick`。
- **`doubleClick` 的两处环境依赖**：① 它要 `/usr/bin/swift`（Xcode Command Line Tools）与辅助功能
  权限，缺了会在动作处报错；② 它读的是 mode=ax 的**窗口局部**坐标口径（KimiCU 的 mode=full 给的是
  **截图像素**，实测 1152×768 对 1200 点，两种空间混用会让点击落到别处）——口径对不上或 AX 快照
  退化成只剩菜单栏时，动作按错因分别报错，不猜。
- **拖拽：KimiCU 的 `drag` 工具在 WKWebView 里造不出 DOM 拖拽（M228 实测）**：对栏宽手柄与正文
  文本各试一次，手柄的 pointerdown 未到（调试桩零记录）、文本拖选也未发生——与 `dblclick` 同一类
  注入边界。套件动作 `drag` 因此走 doubleClick 同一条 `swift + CGEvent` 通道（mode 5：
  down → 24 步插值 dragged → up），前台纪律与坐标口径与 `doubleClick` 完全相同（会移动真实光标、
  目标窗口必须前台未被遮挡）。另有一条 WKWebView 的 AX 怪癖配套：拖类控件若是 `role=separator`，
  WKWebView 暴露成**无 bbox 的 AXSplitter**（节点在树、名字对、frame 为空），按节点定位不到——
  栏宽手柄用 `textareaEdge` 形态（从 AXTextArea bbox 的列缘内侧 2px 起拖）绕开。场景 38 是首个
  消费者（现场 `test-results/acceptance/<日期>/38-content-width-drag/`）。
- **场景维护权归实现者**：新功能 mission 的 tasks 必须带「新增/更新验收场景」一项（裁决点 3）。

## 加一个场景

1. 需要新文档就加 `fixtures/<名>.md`（短文档，标题行当 `marker`）。
2. 在 `scenarios/` 建 `<项号>-<短名>.md`，front-matter 里写清 `item` / `fixtures` / `open`。
3. 断言优先选**稳定子串**（文案单一来源是 `文案-Copy.md`）与**磁盘事实**（sha256/mtime），少依赖
   toast 停留时长。
4. `node scripts/acceptance/run.mjs --check` 过静态校验，再 `node scripts/acceptance/run.mjs <id>` 跑通
   （FAIL 为零，失败项如实记录不硬凑）。
