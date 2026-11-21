# Design: 快速打开的 ⌘A 全选与目录直接子级

## 1. 现状（改动前的三条事实源）

| 层 | 现状 | 缺口 |
|---|---|---|
| 输入解析 `quickOpenAttempts` | 整串 → 剥行号后缀；尾斜杠被 `normalizeQuickOpenInput` 判非法 | 没有「这是目录」的表达 |
| 判决 `resolveQuickOpenSync` / `resolveQuickOpen` | `classifyVaultPath` 能给出 `{kind:"dir"}`；两段式 Enter 已存在 | 判决不携带目录路径，结果区无从收窄 |
| UI 行模型 `render` / `apply` | `hits = filterIndices(files, plan.query)`；提示行只给命中数 | 目录路径作为查询串会命中所有深层后代；输入期间没有目录提示 |

`quick-open` 的既有非目标仍是「不做目录浏览」：本 change 只改**同一列表的筛选范围**，不引入
第二层列表、不展开树、不新增打开目录的动作。

## 2. ⌘A：输入面就地接管

**落点**：`createQuickOpen` 的 popover `keydown` 处理器（与 `Enter` / `Ctrl-G` / 方向键同一处）。
新增 `Cmd-A` 分支：

```ts
case "Cmd-A":
  event.preventDefault();
  input.select();
  return;
```

**为什么不能只靠原生**：

- `src/keys.ts` 的 `Cmd-a` → `editor.select-all`，作用域由 `scopeOfCommand` 派生为 `text`，
  只在 `isEditorEvent` / `isComposerEvent` 时命中；输入框不在其中，所以键位层不会替它全选。
- M627 起原生 Edit 菜单的预置 Select All 已让出 `⌘A` 加速键（菜单项本身还在，只是不带加速键），
  「WKWebView 收到 ⌘A 后是否对 input 执行 select-all」取决于宿主的默认行为，不是本仓可依赖的合同。
- 显式接管把结果变成确定行为：输入串被全选；`preventDefault` 同时让键位层让路
  （`Keymap.handle` 对 `defaultPrevented` 直接 return）。

**不碰的键**：`Ctrl-A`（Emacs 行首）与所有原生编辑键继续由输入框默认路径处理；组合期
（`isComposing` / `keyCode === 229`）早退，不接管。编辑器内的 `Cmd-a` 绑定与实现一字不改。

## 3. 目录语境：判决带出 `directory`，结果区收窄

### 3.1 判决

`QuickOpenResolution` 增加可选字段：

```ts
export interface QuickOpenResolution {
  plan: QuickOpenPlan;
  verdict: QuickOpenVerdict;
  directory?: string; // 目录的 vault 相对路径；非目录语境为 undefined
}
```

`resolveQuickOpenSync` 在两处设置它：

1. 阶梯里 `classifyVaultPath` 返回 `{kind:"dir"}` → `verdict = {kind:"dir", path}`，
   `directory = path`（既有两段式完全不变）。
2. 尾斜杠目录断言：`explicitDirectoryPath(raw, root)` 去掉**恰好一个**尾斜杠后按既有归一化
   得到 vault 内路径；若 `env.isDir(path)` 为真 → 返回 **invalid 判决** + `directory`
   （判决不变，Enter 才能沿用既有 invalid 分支的候选打开行为；本 change 只改结果区）。
   这一步排在「plan.attempts 为空 ⇒ invalid」之前——否则 `notes/` 永远进不了目录语境。

`explicitDirectoryPath` 只做归一化，不发探测、不列目录；目录判据仍只有 `isDir` 一处。

### 3.2 候选

新增纯函数 `directChildIndices(files, dir)`：父目录逐字等于 `dir` 的索引项。

```
prefix = dir + "/"
rest = path.slice(prefix.length)
命中 ⇔ path.startsWith(prefix) && rest !== "" && !rest.includes("/")
```

- 边界是 `/`：`notes-extra/note.md` 不命中 `notes`。
- 只取一层：`notes/sub/deep.md` 的 rest 含 `/`，不命中。
- 保持索引序；不重排、不打分、不高亮。
- 只认文件索引：子目录本身不是可打开候选（既有 spec 的候选来源口径不变）。

`render` / `scheduleProbe` 统一走 `candidateHits(res, files)`：有 `directory` 时用
`directChildIndices`，否则继续用 `filterIndices`。候选来源与上限逻辑不变。

### 3.3 提示与 Enter

`apply` 在 `directory !== undefined` 时改用 `quickOpenDirectoryHint(path, hits.length)`：

| 场景 | 文案 |
|---|---|
| 有直接子级文件 | D943 `{path} 是目录 · 直接子级文件 {count} 条` |
| 超过渲染上限 | D944 同上 + `只显示前 {limit} 条` |
| 没有直接子级文件 | D945 `{path} 是目录 · 没有直接子级文件` |

`empty` 的可见性口径不变（候选为空且无直接行、无在途探测时显示「没有匹配的条目」）——D945
负责说清「目录是空的」，D117 继续只表示候选列表为空。

`confirm` 保持既有判决分支：`verdict.kind === "dir"` 走两段式（第一次 `reveal({kind:"dir"})`
只给 D574「是目录，不能打开」，第二次打开当前游标所在的直接子级候选）；尾斜杠目录断言
（`verdict = invalid` + `directory`）**不进入**这一段——它沿用 `invalid` 的既有行为：游标在候选上
就一次打开，没有游标候选时改给 D574（而不是「找不到」）；其余 `open` / `ambiguous` / `missing`
分支逐字不改。这样「目录直接子级」只改筛选与提示，不改任何既有 Enter 的成功路径。

## 4. 边界与取舍

- **尾斜杠只作目录断言**：`notes/`、`/v/notes/`、`./notes/` 在 `notes` 是目录时进入目录语境；
  `notes.md/`、`ghost/`、`/tmp/x/`、`/v/` 一律退回既有非法 / 找不到口径。理由见 proposal 的
  边界表：不为尾斜杠引入「去斜杠再打开文件」的第二套语义。尾斜杠目录语境只改筛选与提示，
  Enter 的候选打开行为与改动前一致（`invalid` 分支的既有语义）。
- **外部目录不可列举**：本能力没有外部目录索引，`/tmp/x/` 不进入目录语境；`/tmp/x` 仍是
  既有尝试入口，目录原因由 Enter 后的 `fs_read_external` 结果给出。
- **大小写**：目录判定沿用 `FileTree.hasDir` 的逐字口径，不另做折叠；文件索引的折叠等值回退
  只用于「文件是否存在」，不扩到目录语境。
- **不做目录浏览**：没有「进入下一层」的动作；用户要继续往下，直接输入更深一层的目录路径。

## 5. 测试计划（先红后绿）

1. **红（实现前）**
   - 单测：`resolveQuickOpenSync("notes", …).directory` 为 `undefined`；
     `resolveQuickOpenSync("notes/", …).directory` 同样为 `undefined`（判决本来就是 `invalid`，
     本 change 只新增目录语境字段，不改判决）。
   - 浏览器：目录输入的候选混入深层后代 / 同前缀兄弟目录；`notes/` 走子串匹配；
     ⌘A 的合成 keydown `defaultPrevented === false`。
   - 证据：`.local/missions/quick-open-nov21/unit-RED-before-fix.log`、
     `visual-RED-before-fix.log`（4 failed / 18 passed）。
2. **绿（实现后）**
   - 同一批用例全绿；补 `directChildIndices` 的纯函数单测（含中文 / 长路径 / 前缀边界）。
   - `tests/visual/scenes/quick-open.spec.ts` 增加「非目录查询一次 Enter 打开游标候选」，
     证明目录语境之外的 Enter 行为不回归。
   - 证据：`.local/missions/quick-open-nov21/unit-final.log`、`visual-r1.log`（26 passed；r1 补了
     组合期 ⌘A 与 ⌃A 两条）。
3. **不改视觉基线**：本 change 不新增 / 移动可见元素，只改提示行文本与候选集合；`quick-open`
   场景无像素基线（只有 DOM 断言），无需 `--update`。
