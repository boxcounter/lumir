# Design: Escape 顶层关闭与窗口隔离

> 依据：finding `.tower/comms/findings/20261024-worker-archive-rmachine-oct24-bug-harness-esc-app.md`
> （severity high，两次独立真机复跑同形）；代码基线 master `152559fc`；原生链的两条库行为取自
> 本机实际的依赖版本（`tao 0.37.1` / `tauri-runtime-wry 2.12.2`，见 `src-tauri/Cargo.lock`）。
> 本文件只写「为什么、怎么做、判据落在哪」；Requirement 正文在 `specs/` 的两份 delta。

## 1. 不变量

- **E1 顶层唯一**：一次 `Escape` 只关闭**最上层**那一层，MUST NOT 连带关闭下层；层栈按「打开序」
  排序，后打开者在栈顶。
- **E2 焦点回还**：关闭一个层之后，焦点 SHALL 回到该层的触发元素；层没有单一触发元素时（面板这类
  容器层）回到它关闭前承接键盘的区域（harness pane 与搜索 / 键位面板均回文档编辑器），hover 泡
  这类本就不持焦的层 MUST NOT 因关闭而移动焦点。焦点 MUST NOT 因为「关闭 / 重建」被送到 `body`。
- **E3 窗口隔离**：`Escape` 在任何焦点位置（含 `body`、含层内持焦件已被摘除）MUST NOT 产生窗口
  关闭请求、MUST NOT 退出应用。窗口关闭的用户入口仍只有红灯按钮与 `⌘Q`。
- **E4 既有归属不被改写**：有层时 `Escape` 归层；无层时 `Escape` 归焦点的既有归属（编辑器 widget
  容器的 `editor.widget-escape`、输入条就地取消、面板收起）。在 `body` 这类没有归属的焦点上为
  无操作——「无操作」是新增语义，不是「保持现状」：现状是退出应用，那正是缺陷。
- **E5 单一关闭实现**：每层的关闭与焦点回还只有一份实现（组件已有的 `close()` / `setXxxPop(false)`）；
  就地键处理器与兜底 MUST 调用同一份，MUST NOT 各写一遍。
- **E6 退出守卫不削弱**：`⌘Q` / 红灯按钮 / `ExitRequested` / `CloseRequested` 的既有权衡与提示
  一字不动；本 change 只保证 `Escape` 不再混进这些路径。未保存文档在 `Escape` 路径上的安全性
  必须由真机反例给出证据，而不是由「守卫还在」推断。

## 2. 根因链（代码级证据）

### 2.1 DOM 段：焦点被重建摘走，处理器没运行

1. 权限浮层的开合语义是「选定不自动关」——`src/harness-panel.ts:6046-6056`（`setPermPop` 的注释
   与实现），关它的三条路是 chip 再点 / 浮层外点击 / Esc。
2. 选定一档触发 `selectPermissionMode`（`src/harness-panel.ts:6131`），它同步调用
   `rebuildPermPopIfOpen()`（`:6136`）→ `buildPermPop()` → `permPop.replaceChildren()`
   （`:5953`）。原先持焦的档位按钮在这一步被从 DOM 摘除；浏览器在持焦节点被移除时把焦点送回
   `body`（与 `docs/specs/overlay-visibility.md` O6 记录的焦点修复行为同一条机制）。
3. 面板的 Escape 处理器挂在 `panel` 元素上（`src/harness-panel.ts:9896-9915`）。事件目标变成
   `body` 之后，keydown 不冒泡经过 `panel`，处理器**没有运行**——它既没有关浮层，也没有
   `preventDefault`。
4. 合并选择器（provider 列表）走同一形态：`selectProvider`（`:6151-6156`）→ `rebuildSelPopIfOpen()`
   → 重建列表。权限浮层只是最容易被点到的一处。

关键判据：缺陷不在「Escape 被谁吃了」，而在「没有人吃，也没有人挡」。

### 2.2 原生段：未消费的 Escape 等价于一次关窗请求

1. `Escape` 在 WKWebView 内没有任何 DOM 处理器调用 `preventDefault` 时，落到原生取消路径；窗口
   框架的 `windowShouldClose` **无条件**把关闭请求交给应用层并返回 `NO`
   （`tao 0.37.1` 的 `src/platform_impl/macos/window_delegate.rs:326-331`）。
2. 真正决定窗口去留的是运行时：`tauri-runtime-wry 2.12.2` 的 `on_close_requested`
   （`src/lib.rs:4351-4378`）在应用没有调用 `prevent_close` 时**主动销毁窗口**；最后一个窗口销毁
   时派发 `ExitRequested`，没人拦就退出进程（同文件 `:4256-4270`）。
3. 产品侧的 `CloseRequested` 守卫只在文档 dirty 时调用 `api.prevent_close()`
   （`src-tauri/src/lib.rs:255-262`）。这次文档不脏，守卫不触发 ⇒ 窗口被销毁 ⇒ 进程退出。
4. A/B 对照：composer 持焦时按 Escape，面板的处理器正常运行并 `preventDefault`，只收面板、不
   退出（finding 记录的同批对照跑）。这证明「DOM 层 `preventDefault` 能拦住原生关窗」，因此修复
   点应当在 DOM 层，而不是原生层。

### 2.3 对 finding 归因的一处更正

finding 把系统日志里的 `windowShouldClose: prevented close` 读作「产品的未保存守卫拦住了关闭」。
代码对照显示：这句话来自第 2.2 节第 1 步——窗口框架对 AppKit 的无条件 `NO`，与产品守卫无关；产品
守卫（dirty 判定）在该次运行里根本没有被触发。结论有两条：

- 非 dirty 文档下的退出链已完整解释，不需要新机制；
- **dirty 文档在这条路径上是否保得住，现有证据为零**（finding 已注明「本次合成文档非 dirty，未覆盖
  丢数据路径」）。按代码推断应当保得住：dirty 时守卫会 `prevent_close`，运行时因此不销毁窗口，只
  弹出一次与按键无关的退出拦截提示。但「推断」不是「证据」，而且这条推断若成立，缺陷形态会变成
  「按 Esc 弹出一个退出确认」——同样不是用户意图。本 change 的判据因此比「不丢数据」更严：
  `Escape` 根本不得产生关闭请求，提示也不得出现（任务 5.3 的 ①）。

### 2.4 为什么这是「一类」而不是「一例」

任何「打开时持焦、内容重建时把持焦件摘掉」的浮层都能制造同一个失焦态；任何「挂在层内容器上」的
处理器都收不到 `body` 上的按键。今天已经能指出的同形 / 相邻现场：

- 合并选择器选 provider（§2.1 第 4 条）；
- 面板与会话浮层可以同时打开，而面板的 Escape 分支只检查权限 / 合并 / hover 三泡
  （`src/harness-panel.ts:9896-9915`），会话浮层另有自己的段级处理器（`:9869-9875`）——「谁是最
  上层」没有单一判据，第二下 Escape 会越过会话浮层去收面板；
- 各浮层各写一份「关闭 + 焦点回还」，`docs/specs/overlay-visibility.md` O6 已经记录过同一族
  （重建不得改变可见态、不得把焦点送出浮层），本缺陷是它在窗口层的后果面。

## 3. 方案

### 3.1 窗口级兜底（`src/escape-router.ts`）

一个纯逻辑模块 + 一个装配函数。核心是「在事件生命周期的最后一个可靠点上做决定」：

```ts
export interface EscapeLayer {
  id: string;
  /** 关闭该层（含焦点回还）。MUST 与组件自己的就地键处理器共用同一份实现。 */
  close(): void;
}

export interface EscapeRouter {
  /** 层打开时登记；同 id 重复登记 = 提到栈顶（幂等）。 */
  push(layer: EscapeLayer): void;
  /** 层关闭时注销；不存在时静默（关闭是幂等的）。 */
  remove(id: string): void;
  top(): EscapeLayer | null;
  /** 决策入口：true = 已消费（调用方 preventDefault）。 */
  handle(event: EscapeKeyEvent): boolean;
}

export function installEscapeRouter(win: Window, router: EscapeRouter): () => void;
```

`handle` 的决策表（按顺序短路）：

| 输入 | 输出 |
|---|---|
| `event.key !== "Escape"` | 不消费 |
| 输入法组合期（`isComposing` / `keyCode === 229`） | 不消费（归输入法） |
| 已被下游消费（`defaultPrevented`） | 不消费（不重复关层） |
| 带修饰键的 Escape（⇧ / ⌘ / ⌃ / ⌥） | 消费默认行为、**不关层**（它同样会落到原生取消路径） |
| 层栈非空 | 消费默认行为 + 关闭栈顶层 |
| 层栈为空 | 消费默认行为（无操作，保证不落到原生关窗） |

装配点与顺序：`installEscapeRouter` 在 `src/main.ts` 每次 `Keymap.attach` 之后调用
（`:3483` 的首次装配与 `:3500` 的配置重绑都要），使它成为 **window 冒泡阶段最后一个** keydown
监听器。这样统一键位分发器先取值（命中绑定会 `preventDefault`，见 `src/keys.ts:1103-1105`），
兜底只处理「没人要」的按键。若将来有代码在它之后再挂 window 监听，顺序由单测（假 window 上
断言监听器调用序）与真机回归场景共同守住。

为什么不是 capture 阶段：capture 会先于各层的就地键处理器运行，一旦在「无层」时无条件消费，
就会抢走 `editor.widget-escape`（表格 / 代码块容器的 Escape 是键位表里的既有绑定）；兜底必须
排在所有下游处理器之后，「谁都没要」才是它的判据。

### 3.2 层栈（「谁是最上层」的唯一判据）

- **登记点与开合点同源**：在每个浮层 / 面板的 `setXxx(open)` 里登记 / 注销，MUST NOT 在别处补
  一次登记（否则会出现「层已关还在栈里」）。层对象只携带 `id` 与 `close`，不复制开合状态——开合
  状态仍在组件里，层栈只记录「打开序」。
- **`close` 复用组件的关闭函数**：例如 `permPop` 的层 `close` 就是「`setPermPop(false)` +
  `permChip.focus()`」，与面板就地处理器里那两段是**同一个函数**。就地处理器保留（它先于兜底
  运行，覆盖焦点在层内的常态），但两者 MUST 调同一个关闭实现——这正是 E5。
- **重复登记 = 提到栈顶**：同一个层被重新打开时，先 `remove` 再 `push`，保证「最近打开的在最上
  层」。
- **关闭即注销**：`close()` 内部负责 `remove(id)`；兜底调用 `close()` 之后不需要再 `remove`，
  幂等由 `remove` 保证。

### 3.3 重建保焦（根因修复，不只靠兜底）

兜底能让「按 Escape 不退出」，但焦点仍然丢了——键盘用户下一次 Tab / 方向键会从 `body` 重新开始。
所以两处重建要在重建前记住「语义键」，重建后按语义键找回焦点：

- 权限浮层：语义键 = 档位 id（`read_only` / `vault_write` / `full_access`）。重建后找到
  `aria-checked` 所在的那一项（选中项），焦点落回它；找不到（理论上不会）回落 `permChip`。
- 合并选择器：语义键 = 当前 provider id（provider 段）+ 当前 effort id（effort 段）。重建后
  按同一语义键找回；找不到回落 `modelChip`。
- 实现口径沿用 `docs/specs/overlay-visibility.md` O6 的收口方式（重建前收焦到不会被重建的元素 /
  重建后接回），不引入第二套「焦点看守」。落点集中在 `buildPermPop` / `buildSelPop` 的调用方，
  不在每一行 DOM 上补。

这条与兜底是**两层**：保焦修因（绝大多数情况下事件目标仍在层内，面板处理器正常运行），兜底修果
（任何原因导致焦点不在层内时，Escape 仍只关层、不关窗）。

### 3.4 与统一键位表的边界

`Escape` 在 `KEY_BINDINGS` 里已有一条绑定（`editor.widget-escape`，带 `when` 条件，
`src/keys.ts:678`）。兜底 MUST NOT 在表里再加一条——「一个 token 一条绑定」的装配期不变量不变；
它在表之外，属于与面板就地键（`Escape` / `⌃G`）同族的「就地消费」，理由是同一句：表内绑定在
层持焦时不命中，就地消费与表内分发互斥（living spec `keymap-commands` 的键位查看面板条已立此
判词）。兜底命中时 `preventDefault`，恰好也是分发表「已消费即让路」的信号
（`src/keys.ts:1042-1045`），两条通路不会互相重复动作。

### 3.5 层清单（实现批的登记义务）

| 层 | 打开 / 关闭点 | 关闭实现（复用） | 焦点回还 |
|---|---|---|---|
| harness 面板 | 装配层 `togglePane` / `disposePaneHandle` | `deps.togglePane()` | 编辑器（装配层既有口径） |
| 权限浮层 `permPop` | `setPermPop` | `setPermPop(false)` + `permChip.focus()` | chip |
| 合并选择器 `selPop` | `setSelPop` | `setSelPop(false)` + `modelChip.focus()` | chip |
| 会话浮层 `sessPop` | `setSessPop` | `setSessPop(false)` + `sessionButton.focus()` | 触发钮 |
| Context hover 泡 `ctxPop` | `ctxPop.hidden = false/true` | 隐藏（无触发焦点） | 不移动焦点 |
| ⌘P / 大纲 / vault 切换器 / 跳转行 | 各自 `close()` | 复用各自 `close()` | 各自既有回还 |
| 搜索面板 / 键位面板 | 各自 `toggle()` | 复用 | 编辑器 / 触发钮 |
| 文件树菜单 / 标签菜单 | 各自 `close()` | 复用 | 产生菜单的元素 |
| 图片 lightbox / 表格全屏 / 代码块全屏 | `createOverlayState` 的 `open/close` | `close("escape")` | 编辑器（状态机既有） |

登记义务覆盖上表全部层；实现期审计出的新层（含未在第一版清单里的）一并登记。**不引入源码扫描
注册表**：层是运行期概念（同一组件可开关多次），静态扫描只能查到字符串字面量，假红多于真红；
覆盖由「每类层一条真机场景」的矩阵守（§5.3），新增层不写场景就不算覆盖。

## 4. 弃案

- **只把面板处理器从 `panel` 换挂到 `document`**：能修好权限浮层这一条，但会话浮层、各全屏遮罩、
  `body` 焦点仍然会落到原生关窗；且「谁是最上层」仍由各处理器各判一次（E5 不成立）。
- **只做重建保焦、不加兜底**：修好已知两处重建，但任何未来的重建 / 焦点修复路径都能再次制造
  `body` 焦点；缺陷的后果（退出应用）与成因（失焦）耦合在一个很远的地方，必须有一层结果面的
  兜底。
- **在原生层拦截 Escape**：`CloseRequested` 不带成因，分不出「用户点红灯」与「按键漏下来」；
  一律拦截会改变用户关窗语义（红灯失效），一律放行就是现状。原生层不是本缺陷的正确修复面（D4）。
- **用 `beforeunload` / 页面级 unload 拦**：finding 的日志顺序是网页进程先被关闭、再退出应用，
  页面生命周期事件在那一刻已经不可靠；且它拦不住窗口销毁本身。
- **把验收场景改成点 chip 收浮层**：不修产品，只让验收集不再看这条路径；违反「禁止以改场景规避」。
- **给 `Escape` 在 `KEY_BINDINGS` 加一条全局绑定**：违反「一个 token 一条绑定」，装配期即抛；
  且会把「无层时也消费」的需求塞进键位表，语义错位。

## 5. 判据落点

### 5.1 纯逻辑层（必红先于实现）

`tests/unit/escape-router.test.ts`：

- 决策矩阵：`key`（Escape / Escape+Shift / Enter）× 组合期 × `defaultPrevented` × 层栈
  （0 / 1 / 2 层）× 焦点（层内 / 层外 / body）；断言「消费与否」「关闭恰一次」「关闭的是栈顶」；
- 幂等：同 id 重复 `push` 只留一项且置顶；重复 `remove` 静默；关闭后 `top()` 前移；
- 顺序：假 window 上先挂一个「消费型」监听器、再装路由，断言被消费的事件不触发关层；反过来
  （路由先装）断言测试变红——用来钉住「必须最后装」；
- 反向验证：把「层栈为空也消费」去掉，`body` 焦点用例 MUST 变红；把「栈顶」改成「栈底」，
  两层用例 MUST 变红。

`tests/unit/harness-panel-control.test.ts`（或同目录新文件）：重建保焦的纯模型——给定旧焦点语义键
与重建后的项列表，断言返回的落点；语义键不存在时回落触发钮。反向验证：返回 `null`（丢弃焦点）
时用例 MUST 变红。

### 5.2 真机层：先红后绿（硬要求）

新增 `scripts/acceptance/scenarios/235-escape-overlay-close.md`（id 235 当前未占用；实现批按
`coverage.mjs` 重新生成 `COVERAGE.md`）。主路径（与 finding 的复现逐字对齐）：

1. ⌘⇧A 打开 harness 面板（旁侧分栏），点权限 chip 展开浮层；
2. 点「完全访问」，等 chip 读数翻档、`config.json` 落 `full_access`，并断言**浮层仍然打开**
   （`完全访问` 项仍在 AX 树里）——否则这条场景测的就不是「收一个开着的浮层」；
3. 记一次 Esc 之前的 AX 快照（红跑时用来确认焦点状态：预期没有 `(focused)` 节点，即焦点已不在
   层内——这是根因链第 2 步的现场证据），然后 `do: key { key: escape }`；
4. 断言：**应用仍在**（AX 树里仍有 `发送` 按钮 / 权限 chip）、浮层已收（`完全访问` 项不可见）、
   composer 仍在、编辑器 `unchangedSince` 基线未变、`config.json` 的 `permission_mode` 仍是
   `full_access`。

红跑（实现前，master 代码）：同一条场景必须在第 4 步判红，且证据里必须能区分「产品退出」与
「普通过时」——记录 AX 快照退化成单节点、`ps -p <pid>` 空输出、统一日志里
`windowShouldClose → WebPageProxy::close` 的同秒链。证据目录：
`.local/acceptance/<日期>/235-escape-overlay-close/RED-before-fix/`。
**红跑不得以「改场景 / 跳步 / 加 sleep」换绿**；实现后同一条场景（同一份文件、同一批步骤）跑绿，
证据目录 `.../GREEN-after-fix/`。

### 5.3 其他浮层回归（同类路径，逐类一条）

同一批新增 / 扩充场景覆盖：①会话浮层选中后按 Esc；②合并选择器切 provider 后按 Esc；③⌘P 输入
筛选后按 Esc；④大纲浮层按 Esc；⑤搜索面板按 Esc；⑥图片 / 表格 / 代码块全屏遮罩按 Esc；
⑦harness 面板内 Context hover 泡出现时按 Esc。每一步都断言「应用仍在 + 层已收 + 焦点落点」，
缺一不算覆盖（REVIEW.md「覆盖声明超出真实验证」条）。

### 5.4 退出路径反例（E6）

同批场景覆盖：①文档有未保存修改时按 Esc → 应用仍在、dirty 标记仍在、文档逐字节不变，且**不出现
退出拦截提示**（今天这一条大概率以「应用保住但弹出提示」的形态存在——代码推断守卫会 `prevent_close`，
红跑会给出实证；提示出现同样是缺陷，因为用户按的是 Esc）；②同一 dirty 文档按 `⌘Q` → 仍被守卫
拦下并出现提示、应用不退出；③干净文档按 `⌘Q` → 正常退出（放在该场景末步或单独的 restart 场景）。
这三条是「不削弱守卫」的证据面，不是形式检查；①与②的提示必须能区分来源（①不允许出现，②必须出现）。

### 5.5 门禁

- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- `bash scripts/docs-check.sh`（含 MODIFIED delta 的归档对账）
- `bash scripts/gate.sh quick`（照抄 `GATE RESULT` 原文行）
- `bash scripts/gate.sh visual`（动过焦点 / 浮层行为，本地必跑）
- `node scripts/acceptance/run.mjs --check` + 真机跑批证据落 `.local/acceptance/`

## 6. 风险与边界

- **全局吞掉 Esc 的副作用**：无层时也会 `preventDefault`。可能影响的只有原生默认行为；输入法
  组合期已排除；文本编辑的 Esc 在产品里没有默认语义（widget 交还由键位表先行消费）。用 235 与
  5.3 的编辑器 / 输入条场景回归。若真机发现某个原生浮层（自动填充等）依赖 Esc，按 finding 另行
  评估，不在本 change 里改回「放行」。
- **监听顺序**：兜底必须最后装。配置重绑会 `detach` + 重新 `attach`（`src/main.ts:3500`），
  装配点必须同时重装兜底；单测钉住顺序，真机场景 09（Emacs 键）与 235 的 widget 步骤回归。
- **焦点回还的目标可能已不在 DOM**：`close()` 里先判 `isConnected` 再 `focus()`，否则回落触发钮
  ——否则 `focus()` 静默失败，焦点仍在 `body`。
- **层栈泄漏**：层在关闭时未注销会让下一次 Esc 去调一个已关闭层的 `close()`（无害但掩盖「谁在
  最上层」）。登记点与开合点同源 + `remove` 幂等 + 单测覆盖。除 harness 面板外，面板被装配层
  收起时不走组件自己的 `setXxx`，登记点必须挂在**装配层实际收起的那条路径**上（实现期逐个核对）。
- **性能**：一个 window keydown 监听，非 Escape 时字符串比较即返回；Escape 时才访问栈顶与调用
  关闭。不新建 DOM、不触发布局，不影响性能合同。
- **原生层边界**：若焦点不在 webview（窗口失活），按键根本不会到达 DOM；本方案不覆盖、也不
  声称覆盖。这一档由 OS 行为决定，不是产品路径（D4）。
- **`⌘Q` 的 applicationWillTerminate 通道**：既有注释已注明 Dock 退出 / 系统关机不产生
  `ExitRequested`、守卫不生效（`src-tauri/src/lib.rs:243-248`）。本 change 不改这条已知限制，
  也不把它当成 Escape 的兜底。

## 7. 实现顺序（每步都可独立验证）

1. 写 235 场景 + 5.4 反例场景；在 master 代码上红跑，留证据（先红）。
2. `src/escape-router.ts` 纯逻辑 + `tests/unit/escape-router.test.ts`；不接装配，`pnpm test` 绿。
3. `src/main.ts` 接兜底（首次 attach 与重绑两处）+ 层栈；先登记 harness 面板与四个浮层。
4. 重建保焦（权限 / 合并选择器）+ `harness-panel-control` 单测；跑 235 → 绿（后绿）。
5. 登记其余层（§3.5 清单），跑 5.3 矩阵；补漏。
6. 5.4 退出反例；`gate quick` / `gate visual` / `docs-check` / 真机全量回归。
7. 归档对账（MODIFIED 段落逐字落进 living spec；由 `docs-check` 机器判）。

## 8. 事实核验清单（本设计的承重断言与证据源）

| 断言 | 证据源 | 可靠性 |
|---|---|---|
| 选定档位不关浮层、且会重建列表 | `src/harness-panel.ts:6046-6056`、`:6131-6136`、`:5953` | 代码直读 |
| 面板 Escape 处理器挂在 `panel` 容器上 | `src/harness-panel.ts:9896-9915` | 代码直读 |
| 焦点在 `body` 时处理器不运行 | DOM 冒泡语义（事件目标不在 `panel` 子树内） | 稳定共识 |
| 重建摘除持焦节点会把焦点送回 `body` | `docs/specs/overlay-visibility.md` O6 的实测记录（chromium / WebKit 两引擎） | 仓内实测 |
| 未消费的 Escape 会走到窗口关闭链 | finding 的统一日志链（两次同形） | 外部实测 |
| 窗口框架无条件派发关闭请求并返回 `NO` | `tao 0.37.1` `window_delegate.rs:326-331` | 依赖源码 |
| 运行时在未 prevent 时主动销毁窗口 | `tauri-runtime-wry 2.12.2` `lib.rs:4351-4378` | 依赖源码 |
| 产品守卫只在 dirty 时 prevent | `src-tauri/src/lib.rs:255-262` | 代码直读 |
| DOM `preventDefault` 能拦住原生关窗 | finding 的 A/B 对照（composer 持焦不退出） | 外部实测 |
| 窗口关闭的用户入口只有红灯与 `⌘Q` | `openspec/specs/keymap-commands/spec.md`「⌘W 归标签」条 | living spec |

**未坐实、留给实现批第一件事确认的**：具体哪一个焦点位置开始「DOM 收不到 Escape」（本设计按
「`body` / 层外焦点」处理，红跑会给出实证）；dirty 文档在 Escape 路径上是否真的保得住（5.4 的
①是它的判据）。
