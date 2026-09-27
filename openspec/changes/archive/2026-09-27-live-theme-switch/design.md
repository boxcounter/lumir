# Design: live-theme-switch

本文件是「重启生效」的拆解报告与即时切换的机制设计。§1 逐子系统盘点现状（全部锚点可复核），
§2 给出热切换分类表（本文件的核心交付），§3 是机制设计，§4 被否决方案。

## 1. 现状盘点：主题加载全链路

链路：`config.json` → Rust 校验 → `config_get` 快照 → 启动装配写 `data-theme` → 各子系统取色。

| 环节 | 事实 | 锚点 |
|---|---|---|
| 配置定义与校验 | `[ui] theme`（`light`/`dark`/`eink`，默认 `light`）是结构化表字段；取值非法 → warning + 回落 `light`；表错形状 → 整文件回落 | `src-tauri/src/config.rs:167-185`（UiConfig / UiTheme）、`:426-436`（validate 段）、`:270-276`（RawUiConfig） |
| 配置快照出口 | 前端经既有 `config_get` 一次读取 `ConfigSnapshot.config.ui.theme` | `src/ipc.ts:40-42`；`src-tauri/src/commands.rs:84` |
| **主题施加（唯一的「重启生效」成因点 A）** | 启动装配层写一次 `document.documentElement.dataset.theme`，此后运行期无任何写入者 | `src/main.ts:980`（注释块 :969-979 自述「本版不做运行期切换」） |
| token 层 | 色彩 29 个按三主题写三组 `:root[data-theme]` 块；非色 token（字体 / 间距 / 圆角 / 布局 / 动效）一组 `:root` 三主题共享 | `src/style.css:15`（light）、`:50`（dark）、`:89`（eink） |
| chrome 表面 | 文件树 / 标签 / modeline / 搜索面板 / 浮层 / toast 全部经 `var(--…)` 与 `:root[data-theme="eink"]` 组件级覆盖取色 | `src/style.css` 全文；`src/search-panel.css:105-138`（eink 覆盖示例） |
| CM 编辑器主题（md live preview） | `livePreviewTheme` 全部取色走 `var(--…)`；eink 组件级覆盖用 `:root[data-theme="eink"] & …` 键（CM6 `buildTheme` 把 `&` 替换为主题 class，选择器穿透作用域、随 `data-theme` 自动命中 / 失效） | `src/preview/theme.ts:98-608`（文件头 :13-14 为 `&` 机制说明） |
| code 模式语法高亮 | `codeHighlight`（`HighlightStyle`）的色值是 `var(--tk-*)` 字面写进 CM 生成的 CSS——CSS 变量引用，随主题跟随；既有缺口（eink keyword 700 无法按 `data-theme` 限定）在案，与切换无关 | `src/editor.ts:1008-1023`（CODE_COLORS / codeHighlight）、`:1004-1007`（缺口自述） |
| 围栏代码块着色 | `preview/code.ts` 出 `cm-lp-tok-*` class，色在 `theme.ts` 的 `var(--tk-*)` 规则 + eink `&` 覆盖 | `src/preview/theme.ts:268-274` |
| 其它 CM 主题 | `codeBindingTheme`（`var(--code-bg)`）、`baseTheme`（`var(--…)` + eink `&` 覆盖） | `src/preview/theme.ts:94-96`；`src/editor.ts:1263-1314` |
| **mermaid（「重启生效」成因点 B，三层叠加）** | ① `mermaid.initialize(mermaidConfig())` 只在首次渲染执行一次（`initialized` 全局标志）；② `mermaidConfig()` 在那一刻把 `getComputedStyle` 的 token 计算值读进 `themeVariables`；③ `renderCache` 以源码为唯一键——已渲染 SVG 把颜色烧进内联样式，缓存键不含主题 | `src/preview/mermaid.ts:122/182-184`（initialize 一次性）、`:56-110`（mermaidConfig 读计算值）、`:224-249`（renderCache 键 = source）；文件头 :12-16 自述「运行期不切换」 |
| mermaid → 装饰层的刷新桥 | settle 后经 `onMermaidSettled` 通知，装饰层 dispatch `previewRefresh` 重建——失效重渲的既有通路原样可复用 | `src/preview/livePreview.ts:606-617`；`previewRefresh` 定义在 `:43` |
| KaTeX 公式 | 本地打包 `katex.min.css` 继承 `currentColor` 与底色 token，无烧色 | `src/preview/theme.ts:556-569`（注释自述口径） |
| 图片附件 / lightbox | 无主题着色（裸图 + `--scrim` 遮罩） | `src/lightbox.ts`；`src/style.css` lightbox 段 |
| 列表 marker 测量 | `getComputedStyle` 只用于字体度量（canvas 测宽），三主题共享同一套字体 token——主题切换不改变字体度量 | `src/preview/lists.ts:91` |
| 配置写回先例 | `write_last_vault_to`：读既有 JSON → 合并字段 → tmp+rename 原子写；失败 `CommandError`，调用侧降级为 warning 不阻塞主流程 | `src-tauri/src/commands.rs:380-457` |
| 文档自述 | `UiConfig.ts` / `UiTheme.ts`（ts-rs 生成，真源是 `config.rs` 的 doc comment）与 `main.ts:969-979`、`mermaid.ts:12-16` 的注释都写着「重启生效 / 运行期不切换」——实现期须同步改写 | 上列各行 |

**「重启才生效」的成因点只有两处**：A = `main.ts:980` 的一次性施加；B = mermaid 的一次性
initialize + 烧色 SVG + 无主题维度的缓存键。除此之外没有任何子系统把主题钉在启动时刻——
这正是「免重启切换」成本低的结构原因。

## 2. 热切换分类表

| 子系统 | 取色机制 | 切换时行为 | 策略 |
|---|---|---|---|
| token 层（`src/style.css` 三组块） | `data-theme` 属性选择器 | 属性一改全部重算 | **即时**，无需 JS |
| chrome 表面（树 / 标签 / modeline / 搜索 / 浮层 / toast） | `var(--…)` + eink 覆盖 | 跟随 | **即时** |
| CM 编辑器主题（livePreview / codeBinding / baseTheme） | `var(--…)` + eink `&` 键 | 跟随 | **即时** |
| code 模式语法高亮（HighlightStyle） | `var(--tk-*)` 字面进 CM 生成 CSS | 跟随 | **即时**（eink 字重缺口照旧，不修） |
| 围栏代码块着色（`cm-lp-tok-*`） | class + `var(--tk-*)` | 跟随 | **即时** |
| KaTeX / 图片 / 列表测量 | currentColor / 无着色 / 字体度量 | 跟随 / 不涉及 / 不涉及 | **即时或不涉及** |
| **mermaid 已渲染 SVG** | 颜色烧进 SVG 内联 | **不跟随** | **失效重渲**（§3.2） |
| 配置持久化 | config.json 是启动真源 | 不写回则分叉 | **切换即写回**（§3.3，裁决点 D3 推荐项） |

## 3. 机制设计

### 3.1 单一施加点：`applyTheme(theme)`

- 新增 `applyTheme(theme: UiTheme)`：写 `document.documentElement.dataset.theme` + 刷新 modeline
  主题指示钮文案。**启动路径（现 `main.ts:980`）与切换命令都经它**——施加点收敛为一个函数
  （REVIEW.md 第 8 条：同一语义不留两处真源）。`main.ts:969-979` 的「运行期不切换」注释同步
  改写。
- 主题真源的分层不变：config.json = 启动真源；`data-theme` = 运行期唯一生效面。不引入第三处
  「当前主题」状态——modeline 钮的文案读 `documentElement.dataset.theme`，不自带副本。

### 3.2 mermaid：按主题世代失效重渲

- `mermaid.ts` 新增出口 `invalidateMermaidTheme()`：`initialized = false` + `renderCache.clear()`
  + 世代号（`themeGeneration`）自增。`applyTheme` 在写完 `data-theme` 后调用它，随后对编辑器
  dispatch `previewRefresh`（`livePreview.ts:43` 的既有 effect）触发装饰重建——重建时
  `ensureMermaidRender` 缓存未命中，各块回到 pending 占位，经既有串行队列重渲、settle 后
  再次 `previewRefresh`。三态 widget（pending / ok / error）与有限 settle 全部复用，
  **不引入新状态机**。
- **竞态（必须钉死）**：切换瞬间可能有 in-flight 渲染（旧主题 config）尚未 settle。缓存的唯一
  写入点是 `ensureMermaidRender` 的 settle 回调（`mermaid.ts:244-246` 的
  `renderQueued(source).then(result => { renderCache.set(source, result); … })`），世代号检查
  SHALL 守在写入点：渲染任务入队时（`ensureMermaidRender` 登记 pending 处）记下当前世代号，
  settle 回调写缓存前比对，不一致则**丢弃结果——不写缓存、不触发 settle 通知、不重排队**，
  旧色 SVG MUST NOT 落地。不重排队是正确的：失效后 `applyTheme` 派发的 `previewRefresh` 已
  触发装饰重建，重建路径上的 `ensureMermaidRender` 会因缓存未命中按新主题重渲同一 source——
  若 settle 回调再排一次，同一 source 会被渲染两遍（队列里重复排队）。世代号是模块内私有
  计数，不进缓存键（缓存键仍是源码——切换后缓存已整体清空，世代只用于在写入点丢弃迟到
  结果）。
- 切换时 mermaid 尚未懒加载（无 ```mermaid 块出现过）的情形：`invalidateMermaidTheme()` 对
  未初始化的模块是幂等 no-op（`initialized` 本就是 false、缓存本就空），首次渲染照旧读新
  主题的计算值——懒初始化发生在 `data-theme` 写入之后的既有性质（`mermaid.ts:14-16`）不变。
- 代价如实记录：含 N 个 mermaid 块的文档切换主题 = N 次串行重渲（既有队列与超时口径），期间
  块显示「渲染中…」占位。这是「切换中状态」的全部——其余表面同步完成，无中间态。

### 3.3 配置写回：复用通用合并写 IPC（原稿的 `config_set_ui_theme` 实现期被否，2026-09-26 M237）

> **实现期修正**：本节原稿要求新增 Rust 命令 `config_set_ui_theme(theme)`。动工时按 Alex 节点 1
> 的裁决口径改为**复用 M228 已落地的通用合并写 IPC `config_set_ui_value(key, value)`**
> （`src-tauri/src/commands.rs`）——它与原稿要的模板同源（serde_json::Value 级合并 + tmp+rename
> 原子写 + 失败 `CommandError`），且已经是「`[ui]` 表单键写」的既有通道：为 `theme` 再开一条
> 命令就是同一语义两套写通道（REVIEW.md 第 8 条）。写回纪律（合并而非整写、tmp+rename、失败
> 降级不阻塞切换）逐条不变，只有「落点是新命令还是既有通用命令」这一处不同。

- 写回通道：`config_set_ui_value("theme", "light" | "dark" | "eink")`，后端做法与
  `write_last_vault_to` 同源（读既有 config.json → 合并 `ui.theme` 字段 → tmp+rename 原子写）。
  入参校验：命令本身是**通用**键值写（不做取值校验，原稿为 `UiTheme` 入参设计的 serde 校验随之
  不适用）；闭集合由前端 `UiTheme` 类型 + Rust 侧 `validate()` 的「非法值 warning + 回落 light」
  两层承担——前端只会送出三档之一，写盘产物即使被外部改坏，下次启动照样按既有口径回落。
- 前端切换**不等写回结果**：`applyTheme` 已生效，写回异步进行；失败 → `logEvent` +
  toast「主题已切换，但写入配置失败，重启后将回到配置文件里的主题（{原因}）」（降级口径照
  `warn_last_vault_failed` 先例——主流程不被配置写失败阻塞）。
- 启动行为零变化：`config_get` 快照照旧是启动真源；写回只是让文件跟上运行态。

### 3.4 命令与键位

- 命令 id `view.theme-cycle` 进 `NON_TAB_GLOBAL_COMMAND_IDS`（`view.` 前缀 = 应用运行期显示
  口径族，与 `view.toggle-line-wrap` / `view.text-scale-*` 同族；MUST NOT 取 `editor.` 前缀——
  前缀与作用域不互相打脸是既有纪律）。作用域 global：焦点在文件树 / 搜索框 / 浮层里同样要能
  切（与 ⌘F、⌘⇧O 同理由）。
- 默认键位 ⌘⇧T（裁决点 D2 推荐项），实现期按三来源格式复核并写进 keys.ts 的 doc：
  ① 表内 ⌘⇧ 系现有 ⇧⌘Z（redo，`src/keys.ts:312`）与 ⇧⌘O（toc.toggle，`src/keys.ts:362`）
  两条，⌘⇧T 不在其中；② muda 预置 accelerator 集合（⌘C/⌘X/⌘V/⌘Z/⇧⌘Z/⌘A/⌘M/⌃⌘F/
  ⌘H/⌥⌘H/⌘W/⌘Q）无 ⌘⇧T；③ macOS 系统级不占用 ⌘⇧T（浏览器「重开标签页」语义不适用于本
  应用）。绑定写法 `Cmd-Shift-t`（单字符键名归一大写为 `Cmd-Shift-T`，归一化机制自动处理），
  单段无空白，`[keys]` 可重绑 / 解绑。
- 命令实现落装配层 `main.ts`（与 `toc.toggle` / `vault.switcher` 同路）：读当前
  `dataset.theme` → 循环取下一档 → `applyTheme` → mermaid 失效 + previewRefresh → 写回。
- modeline 主题钮：`shell.ts` 在 modeline 右段加容器（button，照 `modelineSection` 先例），
  `main.ts` 维护文案（当前主题名）与点击接线——点击与命令走**同一条路径**（不调命令分发器，
  直接调同一实现函数）。样式吃 token（eink chip 描边化规则适用），零新色值；形态观感归
  Alex 手感项。

### 3.5 文档口径同步（实现期必做，防自述漂移）

实现落地时同步改写三处「重启生效 / 运行期不切换」自述：`src-tauri/src/config.rs` 的
`UiConfig` doc comment（ts-rs 重新导出会刷新 `src/bindings/UiConfig.ts`）、`src/main.ts:969-979`、
`src/preview/mermaid.ts:12-16`。

## 4. 被否决方案

| 方案 | 否决理由 |
|---|---|
| 跟随系统主题（`prefers-color-scheme`） | 用户明确的非目标；eink 无系统级对应物，配置面少不了，自动跟随是纯增量复杂度（restyle design §3 既有否决理由原样成立） |
| 整窗 reload（webview 刷新）当切换 | 丢会话状态（标签 / 滚动 / 未保存内容守卫全被卷入），把「改一个 DOM 属性」做成「重启一次应用」——与免重启的目标直接矛盾 |
| mermaid SVG 后处理（运行时改写内联色 / CSS 变量化注入） | mermaid 烧进 SVG 的色值与 token 槽位的对应没有稳定映射，后处理是按字符串猜语义；失效重渲复用既有队列与三态 widget，成本是一次重渲，正确性是渲染器自己保证 |
| mermaid 缓存键加主题维度（不清缓存） | 保留旧主题 SVG 副本换「切回去秒出」；缓存上限 1000 按三主题膨胀三倍，而「切回上一主题」是低频路径——清空重渲更简单且无私 |
| 运行期不落盘（typography D5 / M180 先例） | 裁决点 D3 的备选：主题与字号 / 折行不同——它有配置字段占着启动真源，不写回则文件与运行态分叉且被 modeline 常驻指示持续暴露；写回模板现成（write_last_vault） |
| 三条直达命令（view.theme-light/dark/eink） | 裁决点 D1 的备选：三个 id + 三条默认绑定（或三个 keyless 命令）换「一键直达」，主题切换是低频动作，循环最多按两下；不为三档复制 tab.goto-1..9 的序号烙 id 形态 |
| 视觉基线改为「切换后截图」 | 基线口径稳定性优先：桩注入固定主题的三主题场景（restyle-theme / callout-theme / mermaid-theme 等）已覆盖「每个主题长什么样」；切换场景只加结构层断言（data-theme + 计算样式 + mermaid SVG 内联色变化），不进像素基线 |
