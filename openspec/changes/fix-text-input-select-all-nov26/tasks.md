# Tasks: fix-text-input-select-all-nov26

> 顺序是硬约束：**先红后绿**。1.x 在旧实现上判红并留证，再进 2.x。真机执行不在本 worker 的
> 面上（Alex 本轮要求「更新相关真机场景，本轮不执行真机」）；场景文件随实现同批提交，执行留给
> 后续验收批。

## 1. 先红：缺陷现场

- [x] 1.1 新增 `tests/visual/scenes/text-input-select-all-nov26.spec.ts`：重命名框 ⌘A（`defaultPrevented`
      必须为真 + 选区 0..len + 键入替换整串 + Enter 仍提交）、新建文件框、搜索框、行号框、键位面板、
      菜单 Select All、非文本面不抢焦点、组合期、编辑器回归、contenteditable 探针。
- [x] 1.2 在基线 `675a804f` 的实现上跑该 spec 留红证据（`.local/missions/fix-text-input-select-all-nov26/`）：
      **7 failed / 3 passed**——重命名 / 新建 / 搜索 / 行号 / 键位面板 / 菜单六条 + contenteditable
      探针的 `defaultPrevented` 断言行按预期判红；组合期、非文本面、编辑器回归三条在基线上本来就是
      绿（对照，证明判据不是恒红）。
- [x] 1.3 静态对账的反向验证：临时新增一个 `document.createElement("input")` + 本地 `"Cmd-A"` +
      未登记 `.select()` 的探针文件，三条判据分别判红后再删除探针（区分度实测，不是只读断言）。
- [x] 1.4 真实浏览器核实 `input` 各类型的 `.select()`：number / email 整值选中；date / time /
      month / week / datetime-local 静默无效（键入仍按段编辑）；`setSelectionRange` 对
      email / number / 日期时间族抛 `InvalidStateError`。据此把 `isTextEntryHost` 改为正向清单
      （text / search / tel / url / email / password / number），日期时间族落回平台；补类型矩阵
      回归（number / email 正例 + date / time 反例 + 全程无 pageerror）。

## 2. 实现

- [x] 2.1 `src/keys.ts`：新增 `NATIVE_INPUT_HOST_COMMAND_IDS` 与 `coversNativeInputHosts`（附加面
      的单一来源）；`KeyBinding.inputHosts`（派生字段）；`KeymapContext.isTextInputEvent`；
      `Keymap.handle` 的 `text` 分支增加附加面判定；新增 `isTextEntryHost`（文本类 input /
      textarea / contenteditable，排除勾选类控件）与文件头 change 段。
- [x] 2.2 `src/main.ts`：`Cmd-a` → `editor.select-all` 的装配条目统一走 `selectAllAt`（遮罩 →
      composer → 编辑器 → 原生文本宿主 → 兜底编辑器）；提取 `isEditorDomNode` 供 `isEditorEvent` 与
      分派共用；`selectAllInTextEntry`（`.select()` / DOM Range）；`keymapContext.isTextInputEvent`；
      菜单 `selectAllByFocusedFace` 改为同一个分派；`composerTextFaceCommands` 跳过附加面命令
      （避免两处面判定）。
- [x] 2.3 `src/quick-open.ts` / `src/toc.ts` / `src/vault-switcher.ts`：删除就地 `case "Cmd-A"` 与
      `input.select()` 副本，注释改为「MUST NOT 再写本地分支」。
- [x] 2.4 `src/tree.ts`：`wireEdit` 注释写明 ⌘A 由统一键位层接管、MUST NOT 另写 `case "Cmd-A"`。
- [x] 2.5 `src/copy-data.ts` + `文案-Copy.md`：D268 的绑定来由改准（落面 = 任意可编辑文本宿主；
      菜单同一分派）。

## 3. 合同与规格

- [x] 3.1 新增 `docs/specs/text-input-faces.md`：输入面定义、T1–T6 不变量、输入面清单（面 /
      实现 / ⌘A 落面 / 证据）、证伪方式与已知边界。
- [x] 3.2 `openspec/.../specs/keymap-commands/spec.md`：MODIFIED「统一键位分发表」（附加面派生、
      单一路径、禁止逐面本地分支 + scenario）与 MODIFIED「⌘A 归文本面」（正文改准为输入面；
      菜单按焦点走同一分派 + scenario）。
- [x] 3.3 `openspec/.../specs/quick-open/spec.md`：MODIFIED「输入面内的全选（⌘A）」（实现改为统一
      键位层显式接管；落面扩到任意输入面；其余键仍走原生）。
- [x] 3.4 `openspec/.../specs/toc-outline/spec.md` 与 `vault-workspace/spec.md`：MODIFIED 各自
      requirement 里「由浮层的就地键处理显式接管」一句，改为「由统一键位层按输入面分派」。
- [x] 3.5 `openspec/.../specs/file-tree/spec.md`：ADDED「内联编辑输入框的全选（⌘A）」——重命名 /
      新建、组合期、关闭浮层后编辑器 ⌘A 不回归。

## 4. 测试与对账

- [x] 4.1 `tests/unit/keys.test.ts`：附加面清单 ↔ 绑定表双向对账、`isTextEntryHost` 矩阵、
      分发器在原生宿主内命中 / 族内其余命令不放宽 / 非文本面不消费 / 组合期让路 / 缺
      `isTextInputEvent` 时逐条不变。
- [x] 4.2 `tests/unit/text-input-faces.test.ts`：输入面清单覆盖 + 新鲜度 + 本地 `Cmd-A` 白名单 +
      `.select()` 白名单（四层判据，含反向探针实测）。
- [x] 4.3 `tests/visual/scenes/text-input-select-all-nov26.spec.ts` 在实现后转绿；既有
      `quick-open` / `selector-aria-ime-nov25` / `m627-composer-select-all` / `default-note-name-nov24`
      场景不回归。

## 5. 真机场景（只更新，不执行）

- [x] 5.1 新增 `scripts/acceptance/scenarios/881-text-input-select-all-nov26.md`：重命名框 ⌘A
      （WKWebView 键盘通道）、菜单 Select All 的落面、输入面矩阵（Quick Open / 大纲 / vault /
      搜索 / 行号）、非文本面不抢焦点；`tier: full`。
- [x] 5.2 `node scripts/acceptance/run.mjs --check` 静态校验通过（不真机）。
- [x] 5.3 覆盖表 / 批次声明与场景 front-matter 一致（`coverage.mjs --check` 随 `--check` 读同一份声明）。

## 6. 验证（本 change 的验收动作）

- [x] 6.1 目标单测：`node tests/unit/run.mjs`（或 `pnpm test`）全绿。
- [x] 6.2 浏览器结构测试：`LUMIR_VISUAL_STRUCTURAL=1 bash scripts/visual/run.sh text-input-select-all-nov26`
      与相关既有场景（quick-open / selector-aria-ime-nov25 / m627 / default-note-name-nov24）全绿。
- [x] 6.3 根 `tsc`（`pnpm exec tsc --noEmit`）与 `tests/visual` 的 tsc 全绿。
- [x] 6.4 `bash scripts/docs-check.sh`、`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
      PASS；`node scripts/acceptance/run.mjs --check` PASS。
- [x] 6.5 证据落 `.local/missions/fix-text-input-select-all-nov26/`：红跑 / 绿跑日志、静态探针记录、
      门禁输出原文行。

## 7. 记录

- [x] 7.1 proposal 的「评审记录」写入节点 1 原话与批准范围；实现期无静默扩 scope（菜单路径与
      搜索 / 设置等面的行为变化已在 proposal / design 明账）。
- [x] 7.2 `docs/backlog.md` 无对应条目（缺陷未入 backlog），无需核销；未新增 finding 文件。
