# 真机验收套件（scripts/acceptance）

把 backlog「待真机验收」里的**行为判定**下沉成 agent 可执行、可复现的制品。设计依据与裁决点见
[docs/process/real-machine-acceptance.md](../../docs/process/real-machine-acceptance.md)。

## 一条命令跑完

```bash
node scripts/acceptance/run.mjs              # 全部场景
node scripts/acceptance/run.mjs 01 08        # 按 id 前缀 / backlog 项号筛选
node scripts/acceptance/run.mjs --list       # 列出场景
node scripts/acceptance/run.mjs --keep-app   # 跑完保留 app，人工接手看现场
```

退出码：全 PASS = 0，有 FAIL = 1，运行失败 = 2。

前提：本机已装 KimiCU.app（`/Applications/KimiCU.app`）并授予辅助功能 + 屏幕录制。套件自身零新增
依赖——只用 Node 内置模块 + 仓库已有的 `js-yaml`，GUI 通道复用 KimiCU 官方 MCP server。

## 它做了什么

1. **起真实 app**：`pnpm tauri dev`（WKWebView，非 chromium 近似）。
2. **驱动**：经 KimiCU MCP（stdio JSON-RPC）读 AX 树 / 截图 / 注入键盘与点击。
3. **断言**：AX 文本、编辑器文档文本、磁盘文件（sha256 / mtime / 内容）。
4. **落证**：`test-results/acceptance/<日期>/<场景>/`（git 外）。

### 运行环境是隔离的（三件事一起保证可复现）

| 隔离项 | 做法 | 为什么 |
|---|---|---|
| 配置目录 | app 进程带 `XDG_CONFIG_HOME=<结果目录>/../env` 启动，套件自带 `config.json` | `src-tauri/src/config.rs` 优先读 `XDG_CONFIG_HOME`；用户的 `~/.config/lumir` 全程不读不写，`[keys]` 重绑场景可以随便改 |
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
| `clickEditor` | `dx`（默认 40）、`dy`（默认 6） | 点编辑器顶部建立渲染层焦点（编辑器内元素无 AX bbox，只能按坐标） |
| `key` / `keys` | `key` / `keys: [...]`、`gapMs` | 键盘注入（`ctrl+n`、`cmd+s`、`cmd+/` …） |
| `type` | `text`、`clear` | 输入到编辑器（内部先真实点击聚焦，避免落陈旧选区） |
| `sleep` | `ms` | 等待 |
| `record` | `as`、`file` | 记下文件 sha256/mtime，供后续 `changedSince`/`unchangedSince`/`mtimeNewerThan` 比较 |
| `vaultWrite` / `vaultAppend` | `file`、`content` | 从外部改写验收 vault（模拟外部修改/删除） |
| `configWrite` | `keys`、`restart` | 改写隔离 config.json（默认重启 app） |
| `restart` | — | 重启 app（崩溃恢复类场景） |

### 断言（每个 `expect` 条目一条记录）

| 形态 | 字段 | 说明 |
|---|---|---|
| `ax` | `has` / `not` / `count:{pattern,exact,min,max}` | 在 AX 树文本上匹配 |
| `editor` | `has` / `not` | 在编辑器文档文本（AXTextArea.value）上匹配 |
| `file` | `path`、`exists`、`has`、`not`、`changedSince`、`unchangedSince`、`mtimeNewerThan` | `path` 相对验收 vault；`env:` 前缀指隔离配置目录；`xxxSince` 引用 `record` 记下的基线 |
| `shot` | 名称 | 截图 + AX dump 留档 |

匹配值：字符串按**子串**；`/.../` 包起来按正则。

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
- **AX 快照可能退化**：`get_app_state` 偶尔只返回菜单栏（`truncated: [..., cycle]`）。这通常是
  KimiCU 后台服务进了坏状态，表现为**全局**退化（Finder、别的 app 一起坏）。此时全套会一起报
  「前端未就绪」，处理办法是重启 KimiCU 服务，不是改场景。
- **场景维护权归实现者**：新功能 mission 的 tasks 必须带「新增/更新验收场景」一项（裁决点 3）。

## 加一个场景

1. 需要新文档就加 `fixtures/<名>.md`（短文档，标题行当 `marker`）。
2. 在 `scenarios/` 建 `<项号>-<短名>.md`，front-matter 里写清 `item` / `fixtures` / `open`。
3. 断言优先选**稳定子串**（文案单一来源是 `文案-Copy.md`）与**磁盘事实**（sha256/mtime），少依赖
   toast 停留时长。
4. `node scripts/acceptance/run.mjs <id>` 跑通再提（FAIL 为零，失败项如实记录不硬凑）。
