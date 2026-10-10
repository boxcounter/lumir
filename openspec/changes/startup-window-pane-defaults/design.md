# Design: startup-window-pane-defaults

技术方案与权衡。事实依据均来自本仓现状，逐条附 `文件:行`。

**「视觉保真」一节不适用（显式声明）**：本 change 无原型、不在提案期以屏幕形态定下方向——窗口启动尺寸是**既有界面的尺寸来源**，不改任何布局比例、配色、字层级或状态样式；pane 比例改动只把一个既有数字由 1:2 改 1:1，视觉层无新增表面（整页基线的差异由既有视觉门禁照常兜底）。因此按 [openspec-workflow.md](../../../docs/process/openspec-workflow.md)「有原型时必填」的反面，本节不写。

## 1. 现状锚点（逐条带证据）

| 事项 | 现状 | 证据 |
|---|---|---|
| 窗口尺寸 | 写死 `1200 × 800`，无位置字段，无最小尺寸声明 | `src-tauri/tauri.conf.json:14-18`（`app.windows[0]`） |
| 窗口创建 | 由构建配置驱动、默认可见（无 `visible` 字段）；`setup` 回调里只做 logging 初始化 / 注册表迁移 / 菜单改造 / 启动恢复线程 | `src-tauri/src/lib.rs:138-156` |
| 退出钩子 | `RunEvent::Exit => logging::flush()`；macOS Cmd+Q 经 `applicationWillTerminate` → tao `AppState::exit()` → `Event::LoopDestroyed` → tauri `RunEvent::Exit`（该 arm 因此可达） | `src-tauri/src/lib.rs:205`；`tao-0.35.3/src/platform_impl/macos/app_delegate.rs:131-135`、`app_state.rs:273-275` |
| 配置目录 | `<XDG_CONFIG_HOME 或 ~/.config>/lumir` | `src-tauri/src/config.rs:822-834` |
| 独立小文件先例 | vault 会话 `vault-sessions/<id>.json`（tmp+rename、版本不符=无历史、写失败降级 warning）；阅读位置 `reading-positions/<id>.json`（同纪律 + 键校验复用 `valid_entry`） | `src-tauri/src/vault_session.rs:1-30`、`:81-83`；`src-tauri/src/reading_position.rs:1-25`、`:66-68` |
| 工作区（可用区域）API | `tauri::window::Monitor::work_area()` **可用**（tauri 2.11.5）；macOS 实现取 `NSScreen::visibleFrame()`——正是「排除菜单栏与 Dock」的语义，无需新增依赖、无需自己桥 objc | `tauri-2.11.5/src/window/mod.rs:58-97`；`tauri-runtime-wry-2.11.4/src/monitor/macos.rs:7-34` |
| 显示器查询 | `Window::current_monitor()` / `primary_monitor()`（本 change 只用这两个：取窗口所在显示器的工作区做尺寸钳制） | `tao-0.35.3/src/window.rs:1356-1390` |
| 未指定位置时的默认放置 | tao 在 `position` 为 `None` 时对创建帧调 `ns_window.center()`——本 change 不指定位置，窗口位置即由该 OS 默认放置决定（不落盘、不恢复、不作判据） | `tao-0.35.3/src/platform_impl/macos/window.rs:331-333` |
| harness 默认宽度比 | `HARNESS_DEFAULT_DOC_RATIO = 2/3`（文档侧占比 ⇒ harness:文档 = 1:2），只在「本 vault 无存储比例」时施加 | `src/main.ts:681-683`、`:782`、`:701`、`:773` |
| 双文档 pane 初值 | `DEFAULT_SPLIT_RATIO = 0.5`（1:1），与 Rust 侧同值、由 drift 测试对账 | `src/pane-layout.ts:57`；`src-tauri/src/vault_session.rs:47`；`tests/unit/session-schema-drift.test.ts` |
| 比例重述面 | 5 份 living spec + 文案表 + 1 个视觉场景 + 1 个验收场景 | 见 §6 清单 |

**依赖面结论**：`tauri` 2.11.5 / `tauri-runtime-wry` 2.11.4（`src-tauri/Cargo.lock:3894-3896`）已带 `Monitor::work_area()`，本 change **零新增 crate**。

## 2. 范围

两个彼此独立的默认值，一次改完：

- **A 窗口尺寸**：首启规则（90% 工作区）+ 尺寸的持久化与恢复（**位置不持久化、不恢复、启动时也不施加**）。
- **B pane 默认比例**：harness 自动分栏默认值 1:2 → 1:1，并把 5 份重述 spec、文案表与两处测试断言的值改准。

两件事的共同点只有一个：都是「启动后用户第一眼看到的东西由谁决定」。除此之外的实现面、测试面、风险面互不相干，各自独立成立——若节点 1 只批其中一件，另一件可以整体剔除而不留半成品（见 §10）。

## 3. A 实现形状：窗口尺寸

### 3.1 机制选择：隐藏创建 → 施加尺寸 → 显示（倾向 A）

| 方案 | 做法 | 代价 |
|---|---|---|
| **A（倾向）** | `tauri.conf.json` 置 `visible: false`，窗口按占位尺寸创建（未指定位置 ⇒ tao 居中创建，见 §1）；`setup` 里解析存档 / 算首启尺寸 → `set_size` → `window.show()` | 窗口出现比现状晚几毫秒；若 `setup` 在 `show()` 之前 panic，用户看到的是「什么都没出现」而非白窗（需保证 `show()` 一定执行，见 §3.3） |
| B | 保持默认可见，`setup` 里算完再 `set_size` | **每次启动都可见跳变**——从 1200×800 跳到存档 / 首启尺寸；「记住我的尺寸」的用户体验会被这一跳抵消，不接受 |

A 的「晚几毫秒」不触碰 ADR 0002 §6 的冷启动合同：`setup` 里新增的工作是一次本地小文件 `read_to_string` + 一次窗口所在显示器的查询 + `set_size` / `show` 两次窗口调用，量级与既有 `migrate_legacy_registry_dir_at_startup()`（同处同步执行）相当，且**不阻塞**既有的启动恢复线程（`lib.rs:155` 的 `start_restore` 仍在其后立即起线程并返回）。

`tauri.conf.json` 的 `width` / `height`（1200×800）**降级为占位尺寸**：它仍是窗口创建时的初值（`visible:false` 下用户不可见），并作为「工作区不可得」时的兜底；不删字段（删了窗口创建没有尺寸来源）。

**位置不在本 change 内**（裁决点 1：只记尺寸）：不调 `set_position`、不调 `center()`、不落盘 `x` / `y`。窗口位置在两次启动之间是「创建帧的 OS 默认放置」（§1 证据），既不做首启居中计算、也不做跨显示器位置校验——本 change 对窗口的承诺只有**尺寸**这一维。

### 3.2 首启尺寸的算法（纯函数，可单测）

```
target(work: Rect) -> (w, h):
  w = round(work.w * 0.9)          // 取整走四舍五入
  h = round(work.h * 0.9)
```

- 输入是**物理像素**（`work_area()` 返回 `PhysicalRect<i32, u32>`），输出直接喂 `set_size(PhysicalSize)`——**首启路径全程物理像素**，不引入逻辑 / 物理换算误差。
- 原设计里的 `x` / `y`（居中算式）随裁决点 1 一并删除：位置不由本 change 施加，既无坐标可算，也无坐标系要对齐（`work_area()` 与 `set_position` 坐标系约定那一条随之失去适用对象）。
- 最小尺寸闸门：**不加**。当前构建配置未声明 `minWidth` / `minHeight`，凭空造一个最小值会把 90% 规则在小屏 / 分屏窄窗下破坏掉；是否需要一个「可用性下限」（侧栏 236 + 最小正文）见 §10 开放问题。

### 3.3 接线点（`lib.rs`）

`setup` 回调内、`install_menu_overrides` 之后、`start_restore` 前后均可，实际取 `start_restore` **之前**：尺寸是纯本地计算，不应排在「启动恢复线程」之后（虽然二者互不阻塞，但语义上窗口该先成型）。

```
window_state::apply_startup_size(&app.handle())?;   // 读档 → 存档尺寸（钳进工作区）/ 首启 90% → set_size
window.show()?;                                     // 无论 apply 返回 Ok/Err 都执行（Err 已内部降级）
```

`apply_startup_size` **自身不返回致命错误**：解析失败 / 存档损坏 / 工作区不可得都在内部降级为「按占位尺寸」并记 warning；`show()` 用独立一行保证执行（即使尺寸施加失败也把窗口显示出来，不复现「什么都没出现」）。全程不碰 `set_position` / `center()`——位置是创建帧的 OS 默认放置（§1 证据）。

写侧接线两条：

1. `WindowEvent::Resized` → 更新内存里的「最近尺寸」缓存 → 防抖（建议 500ms）写盘。缓存而非退出时才问窗口要尺寸：`RunEvent::Exit` 时窗口可能已在销毁路径上。**不监听 `WindowEvent::Moved`**——位置不入档，拖动窗口不产生任何写入。
2. `RunEvent::Exit` 的处理臂（现有 `logging::flush()` 那一行旁边）追加一次 `window_state::flush()`。这是 macOS Cmd+Q 路径的**唯一**退出钩子（§1 证据链），也是「防抖窗口内就退出」的兜底。

`CloseRequested` 不需单独接线：单窗口应用关窗即退出（`lib.rs:189-195` 的 dirty 守卫路径），正常关窗会走到 `RunEvent::Exit`。

### 3.4 存档文件形状

路径 `<config_dir>/window-state.json`（`config_dir()` = `<config>/lumir`，即 macOS 上 `~/.config/lumir/window-state.json`）。

```jsonc
{
  "version": 1,
  "width": 1512,        // 逻辑像素（点）
  "height": 945
}
```

**只有尺寸**：`x` / `y`（位置）不落盘——裁决点 1 取「只记尺寸」，位置在两次启动之间交给 OS 默认放置（§1 证据）。本 change 尚未发布、无存量存档，因此**不存在需要兼容的旧格式**（无消费者 ⇒ 不写双读、不做迁移，[REVIEW.md](../../../REVIEW.md) 第 21 条）；存档里出现未知字段按「忽略」处理。

**为什么逻辑像素而不是物理像素**：macOS 的显示器可能是 Retina（scale 2）或非 Retina（scale 1），同一窗口的物理像素尺寸在换屏后会变（同一逻辑尺寸在 scale 2 屏上占两倍物理像素），而逻辑点稳定。落盘前用 `scale_factor()` 换算（`PhysicalSize::to_logical`），恢复时反向换算（`LogicalSize::to_physical`）。

**为什么是单文件而不是目录**：vault-sessions / reading-positions 是 **per-vault** 的（键是 vault id），窗口尺寸是**应用级单份**，无键可分层。文件与两个目录同级（`config_dir()` 根下）。

**写入纪律照抄 `reading_position.rs`**：tmp + rename 原子替换；写失败降级 warning、不拦停退出；`version` 与实现不符 → 「无存档」（等价首启规则），不报错、不提示；字段类型非法 / JSON 破损 → 同上，后两类记 warning（**缺失是首启常态，不报警**）。

### 3.5 恢复时的尺寸钳制（防小屏越界）

存档里只有尺寸，因此恢复时**不需要、也不做任何位置校验**——位置由创建帧的 OS 默认放置决定（§1 证据），本 change 不解读、不施加位置。唯一要校验的是**尺寸**：存档尺寸是「当时那台显示器」上的值，换到更小的屏（或分辨率降低）后按原样施加会越出工作区。

规则：

1. 取**窗口所在显示器**的工作区（`current_monitor()`；取不到时回落 `primary_monitor()`；都取不到 → 不钳、按存档尺寸施加并记 warning），得到物理像素矩形 W×H；
2. 存档尺寸（逻辑 → 物理，按当前 `scale_factor()` 换算）与工作区**逐维取小**：`w = min(stored_w, W)`、`h = min(stored_h, H)`；
3. 不超过工作区的存档尺寸原样施加——把窗口放大到接近满屏是合法状态，MUST NOT 被无谓收缩；钳制只落在超出工作区的那一维上。

按「窗口所在显示器」而不是「存档当年那台屏」：位置不再入档，存档里本来就没有「哪台屏」这条信息，按窗口实际会出现的那台屏取工作区是唯一可判定的口径。

### 3.6 不做的事（与 proposal 的 Non-goals 对齐）

- **不施加、不持久化、不校验窗口位置**（含首启居中）：位置全程交给 OS 默认放置；`WindowEvent::Moved` 不监听、`x` / `y` 不入档、无跨显示器位置校验。
- 不接 `WindowEvent::ScaleFactorChanged` 的即时重算——用户在两次启动之间换屏，下一次启动的钳制（§3.5）已经覆盖；运行期跟着换屏重算会把用户当场拖出的尺寸吃掉。
- 不记全屏 / 最大化状态。
- 不引入 `tauri-plugin-window-state`（理由见 proposal Non-goals）。

## 4. B 实现形状：pane 默认比例 1:2 → 1:1

### 4.1 改动点只有一个常数

`src/main.ts:683` 的 `HARNESS_DEFAULT_DOC_RATIO`：`2 / 3` → `1 / 2`。该常数是 `splitRatio` 的**文档侧**占比（`src/main.ts:681` 注释），1/2 即 harness:文档 = 1:1。

`src/main.ts:782` 的施加判据（`if (!storedRatioApplied) splitRatio = HARNESS_DEFAULT_DOC_RATIO;`）与 `storedRatioApplied` 的生命周期（恢复路径置真、切 vault 复位，`src/main.ts:701` / `:2760`）**原样不动**——这就是裁决点 ②「默认只在无存储值时生效」的现状语义。

`src/main.ts:681`、`:773`、`:2759` 三处注释里的「1:2」一并改「1:1」，并保留「原 1:2 系 Alex 2026-10-05 裁决、本 change 按 2026-10-10 新裁决改为 1:1」这句来由（本仓注释即文档的既有口径）。

### 4.2 为什么不动 `DEFAULT_SPLIT_RATIO`

`src/pane-layout.ts:57` 与 `src-tauri/src/vault_session.rs:47` 的 `0.5` 是 `pane.split`（双**文档** pane）的初值，已是 1:1。改它反而会破坏「落盘值与施加值同区间」的对账（`tests/unit/session-schema-drift.test.ts` 钉着两处同值），且没有必要。

Alex 原话「不论 pane #2 是 content 还是 harness」在本 change 后成立：两条路径（`pane.split` 与 `harness.toggle` 自动分栏）的默认比都是 1:1，但仍是**两个常数、两条路径**——是否进一步合并成一个常数，见 §10 开放问题。

### 4.3 重述面收敛：canonical 定义留在 `pane-layout`

值改准之外，顺手把「同一语义一处真源」（[REVIEW.md](../../../REVIEW.md) 第 8 条）落实：

- **canonical 定义处** = `pane-layout` 的「harness pane」（它本就是该行为的定义 requirement，另外四处都是括号里的复述）；
- 另外四处（`harness` / `ui-design-system` / `keymap-commands` / `vault-workspace`）**保留取值但仍写数**（不回退成纯引用）：spec 是给人读的裁决依据，一处括号里的「1:1」比一次跳转更可裁决；改法是在值后补一句「canonical 定义见 `pane-layout` 的「harness pane」」。

这样做的取舍如实登记：**没有把复述消除掉**（消除要动四处 requirement 的行文结构，超出「值改准」的授权面），只是把「谁是定义处」写明，让下一次数值变更知道该改哪里、哪里只需要跟着扫。

## 5. spec 增量清单（本 change 的 delta 覆盖）

| capability | 操作 | requirement | 改动 |
|---|---|---|---|
| `app-window` | ADDED ×2 | 首启窗口尺寸 / 窗口尺寸的持久化与恢复（只记尺寸；位置不持久化） | 全新增 |
| `pane-layout` | MODIFIED | harness pane | 1:2 → 1:1（canonical）；Scenario「自动分栏：按 2:1 宽度出现」→「按 1:1 宽度出现」 |
| `harness` | MODIFIED | 对话面板 | Scenario「唤起与流式对话」括号值 1:2 → 1:1 |
| `ui-design-system` | MODIFIED | 应用骨架布局 | Scenario「harness 的打开与收起」括号值 1:2 → 1:1 |
| `keymap-commands` | MODIFIED | 对话面板唤起命令（harness.toggle） | 正文括号值 1:2 → 1:1 |
| `vault-workspace` | MODIFIED | 按 vault 持久化 pane 布局 | 正文括号值 1:2 → 1:1 |

`app-window` 是**新建 capability**：归档时 `openspec archive` 会写入占位 Purpose，须手写替换为「这个 capability 是干什么的」，再复跑 validate（[openspec-workflow.md](../../../docs/process/openspec-workflow.md) 批次收尾 checklist 的既有条文）。

## 6. 代码 / 测试 / 文档影响面清单（implementation 期执行）

| 面 | 文件 | 动作 |
|---|---|---|
| 构建配置 | `src-tauri/tauri.conf.json` | 加 `"visible": false`；`width`/`height` 注释性降级为占位（不改数值） |
| 新模块 | `src-tauri/src/window_state.rs` | 存档读写 + 尺寸纯函数 + 工作区钳制；`mod` 登记与 `lib.rs` 接线 |
| 接线 | `src-tauri/src/lib.rs` | `setup` 施加启动尺寸 + `show()`（不 `set_position` / `center()`）；`WindowEvent::Resized` 缓存 + 防抖；`RunEvent::Exit` flush |
| pane 默认值 | `src/main.ts:683`（取值）、`:681` / `:773` / `:2759`（注释） | `2/3` → `1/2` + 三处注释改准（附来由） |
| 文案表 | `文案-Copy.md`（D345 行）、`src/copy-data.ts:785-786` | 正文里的「harness:文档 = 1:2」→「1:1」（zh/en 双档同步；copy drift 测试会拦半边改） |
| 视觉场景 | `tests/visual/scenes/m303-harness-panel.spec.ts:8,95`、`tests/visual/scenes/m345-quote-card.spec.ts:103` | 注释与宽度比断言（现「约两倍」）改 1:1；整页 / 元素基线按「基线更新是人肉裁决点」走 Alex 过目 |
| 验收场景 | `scripts/acceptance/scenarios/86-harness-pane-toggle.md:4,49,100-101` | frontmatter `title`（「自动分栏默认 1:2」）、判据「文档侧 2/3」与注释「默认宽度比 1:2」改 1:1；新增窗口尺寸场景（首启 90% / 二次启动恢复尺寸 / 存档尺寸超工作区被钳制 / 存档损坏回落；位置不作断言） |
| 流程文档 | `docs/process/openspec-workflow.md:46` | 「视觉保真」一节的布局节奏示例「如 pane 1:2」改 1:1。**该处描述的是当前行为**（`docs/process/` 是流程约定，不是本 change 的实现在场物），因此**不在提案期改**，只在实现期随值一起改准 |
| 单测 | `src-tauri/src/window_state.rs` 内嵌 `#[cfg(test)]` | 解析 / 版本 / 首启尺寸算式 / 工作区钳制（存档尺寸大于 / 小于工作区两态）/ 逻辑↔物理换算（注入目录与矩形，纯函数层，**不碰真实配置目录与真实屏幕**——`reading_position.rs` 的 `load_from(dir, id)` 可注入先例） |
| 历史留档 | `openspec/changes/archive/**` | **不回改**（已归档 change 是历史，改它等于篡改存档） |

**sweep 覆盖与结果（r1 评审后已扩针重扫）**：以 `harness:文档`、`文档 pane = 1:2`、`2:1 宽度`、`文档侧 2/3`、**`pane 1:2`（裸形态）**、以及覆盖全部形态的 **`1:2` / `2:1`** 在 `openspec/specs/**`、`docs/**`、`src/**`、`src-tauri/src/**`、`tests/**`、`scripts/**` 与仓根 `文案-Copy.md` 全量检索（排除 `node_modules` / `target` / `test-results` / `.tower` / `openspec/changes/`）。结论：

- **命中即上表各行**（r1 的 finding：首轮只用前四针，漏了裸「pane 1:2」形态；扩针后补出 `docs/process/openspec-workflow.md:46`、`src/main.ts:2759`、`tests/visual/scenes/m345-quote-card.spec.ts:103`、`scripts/acceptance/scenarios/86-harness-pane-toggle.md:4` 四处，已全部进表）。
- **`docs/**` 命中恰一处**（`openspec-workflow.md:46`，处置 = 实现期改准，见上表末行）；`docs/` 其余命中均为假阳性或历史证据。
- **判为不必改的两类**：① 假阳性——`docs/specs/design-tokens-v1.md:158` 的 `--sp-1:2`（token 名）、`src-tauri/src/logging.rs:778,780` 与 `tests/...` 里的时间戳 / 测试输出行号（`scenes/x.spec.ts:22:1`）、`docs/design-parity-contract/evidence/**`（历史证据的截图与日志）；② 原型历史语境——`src/main.ts:650` 的「原型『2:1 flex 近似、差 ~30px』的妥协点 5 不继承」，说的是被放弃的原型做法、不是 harness 默认值，改它会篡改历史结论。
- `openspec/changes/archive/**` 下的命中是历史留档、不回改。

## 7. 性能与启动时序（ADR 0002 §6 核对）

- **冷启动 <300ms**：新增工作 = 一次 `fs::read_to_string`（<1KB）+ 一次窗口所在显示器的查询 + `set_size` / `show` 两次窗口调用，全部在主线程 `setup` 内、与既有 `migrate_legacy_registry_dir_at_startup()` 同量级。MUST NOT 在 `setup` 里同步做 `config::load` / `open_vault` 这条既有约束**不受影响**（本 change 不碰 `start_restore`）。
- **keypress-to-paint / 打开 1MB**：完全不相关（不触碰编辑路径）。
- **防抖写入**：在 `WindowEvent` 回调里延后落盘，MUST NOT 在窗口缩放的事件流里做同步写（缩放每秒可产生几十个事件）。建议 500ms 防抖 + 退出 flush。
- **常驻内存 <200MB**：本 change 新增的常驻状态是内存里的一份尺寸（两个整数）与一个防抖状态，量级为 0。

## 8. 测试面

- **单测（Rust，注入式）**：`window_state` 的纯函数——首启尺寸算式（含取整）、存档解析的六类降级、版本不符、工作区钳制（存档尺寸大于 / 小于工作区）、逻辑↔物理换算往返。
- **真机验收**（`scripts/acceptance/`，环境隔离已有：`XDG_CONFIG_HOME` 指向合成目录）：① 清空存档 → 启动 → 窗口约为工作区 90%；② 调整尺寸 → 退出 → 再启动 → 首帧尺寸与退出前一致；③ 把存档写成非法 JSON → 启动 → 按 90% 规则出现且不报错；④ 把存档尺寸改成大于当前工作区 → 启动 → 窗口被钳到工作区尺寸以内。
  - **已知边界**：验收套件读窗口尺寸走 AX / 截图坐标，而「工作区 90%」依赖运行机显示器尺寸 ⇒ 判据取**相对值**（窗口尺寸 ≈ 工作区 ×0.9 ± 容差），不写绝对值；**位置不进任何断言**（本 change 不记忆、不施加位置，见裁决点 1）。
- **视觉门禁**：窗口尺寸不进 chromium 视觉场景（chromium 下的窗口尺寸由 Playwright 指定，与被测 app 无关）。pane 比例改动会动 `m303-harness-panel.spec.ts` 的断言，可能连带整页基线——按「基线更新是人肉裁决点」走 Alex 过目。
- **文案漂移**：D345 正文改了 `文案-Copy.md` 与 `copy-data.ts` 两侧即由既有 copy drift 测试覆盖，无需新测试。

## 9. 与 ADR 的关系

本 change 不推翻任何既有技术选型、不新增依赖、不改架构分层，**不产生 ADR**（ADR 0004 第 5 条的边界：功能变更走 OpenSpec）。唯一与 ADR 0002 §5 相关的是存储位置与校验纪律——本 change 完全沿用其既有解释（配置目录下的独立小文件 + 逐字段校验 + 非法回落默认），不是新决策。

## 10. 风险与开放问题

| 风险 / 开放问题 | 对冲 |
|---|---|
| `visible: false` 之后 `show()` 未执行（`setup` 提前 `?` 返回 / panic）⇒ 用户屏幕上一个窗口都没有，问题不可自愈 | `show()` 与尺寸施加**分离**、尺寸施加内部降级不返回致命错误；`setup` 里除 `install_menu_overrides` 外不留新的 `?` 早退点；真机验收场景 ① 覆盖「窗口确实出现」这条最基础的断言 |
| 存档尺寸大于**当前**显示器工作区（换到更小的屏 / 分辨率降低） | §3.5 的逐维取小钳制：窗口以不超过工作区的尺寸出现；钳制只落在超出工作区的那一维 |
| 位置不再记忆：窗口不回到上次停留的位置（含副屏 / 屏幕角落） | 这是裁决点 1 的**有意**结果（Alex 只要求记住尺寸）；位置由 OS 默认放置决定（§1 证据），用户拖动窗口不被跨启动保留 |
| 逻辑点落盘在高 DPI 混合布局下的换算误差（±1 点） | 判据取**相对值**（窗口尺寸 ≈ 工作区 ×0.9 ± 容差），1 点误差不改变判定结果 |
| 是否需要一个窗口**最小尺寸**（侧栏 236 + 可用正文） | **开放问题**（proposal Non-goals 已声明本 change 不做）：小屏 / 分屏窄窗下 90% 可能小到主行只剩侧栏。可行解是给 `tauri.conf.json` 加 `minWidth/minHeight` 而非改 90% 规则；留待 dogfood 后按实际观感裁决 |
| `HARNESS_DEFAULT_DOC_RATIO` 与 `DEFAULT_SPLIT_RATIO` 仍是两个常数、两条路径 | **开放问题**：本 change 只对齐取值不合并实现（合并要把「harness 自动分栏」与「pane.split」的初值来源统一，属结构改动，超出「默认值改准」的授权面）。两者取值现已一致，合并的收益从「避免行为不一致」降为「避免下次改一处漏一处」——若 §4.3 的 canonical 注释被证明不足以防漏，届时另开 change |
| 节点 1 只批其中一件（A 或 B） | 两件事在实现面 / 测试面 / spec 增量上完全独立（§2）：A 只动 `app-window` + src-tauri，B 只动 5 份 MODIFIED delta + `main.ts` + 文案表 + 两处测试断言。剔除任一件都不留半成品；`app-window` 若被否，窗口尺寸整段不入 spec，只留「尺寸写死」的现状 |
| 「退出前 flush」依赖 `RunEvent::Exit` 可达 | §1 的证据链已核到 tao 源码（`applicationWillTerminate` → `LoopDestroyed`）；即便如此，防抖写入仍是主要保障，退出钩子只兜「防抖窗口内退出」这一条窄路径 |
