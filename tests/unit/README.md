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
| `src/save-controller.ts` | dirty 守卫三分支、保存成功 / 冲突 / 目标被外部删除、自动保存 debounce 与崩溃备份、外部修改分流（clean / dirty / deleted）、另存为逃生口、世代号、诊断埋点跃迁去重 |

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
| `*.test.ts` | 用例 |
| `node-env.d.ts` | 用到的 Node API 的环境声明 |
| `tsconfig.json` | `tsc --noEmit` 的类型防线（`gate.sh` 的 `tsc-unit`） |

替身边界取在**平台边界**（Tauri invoke、toast 挂载点）而不是业务模块边界：`src/ipc.ts`、
`src/diagnostics.ts`、`src/save-controller.ts` 都是仓里那一份真代码，只有「机器」那一侧是假的
（与 `tests/visual/scenes/tauri-stub.ts` 同一口径）。未注册的 command 一律以 fixture 错误
reject，避免「测试没实现的命令」变成静默怪现象。

## 纪律

- 新增纯逻辑先在这里补断言：这一层的价值是「秒级、可复现、坏了一看就懂」，不是覆盖率数字。
- 三个 `.mjs`（runner 与钩子）不参与 `tsc`（`checkJs` 关）：它们的正确性由「每次门禁都真的
  跑它」承担，不靠声明文件。
- 类型剥离只认**可擦除语法**：`enum`、构造函数参数属性之类会在运行期直接抛
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。本层没开 `tsc` 的 `erasableSyntaxOnly`——`src/preview/*`
  里已有参数属性，开了会让这一层因为别处的写法而红；踩到时按报错改写法即可。
