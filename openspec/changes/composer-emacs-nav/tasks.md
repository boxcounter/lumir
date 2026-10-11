# Tasks: composer-emacs-nav

> 本 change 先走节点 1（提案评审）。§1 是提案期的勾选面；§2 起是实现期的落地面，**节点 1 通过前不得开工**。

## 1. 提案期（已完成）

- [x] 1.1 读 finding 原文（`.tower/comms/findings/20261011-worker-m444-improve-composer-emacs-b-f.md`）与
      在途 `composer-intercard-caret`（M444）的 proposal / design / tasks，定清整族接管面与两者衔接
- [x] 1.2 现状逐键核实（读源码 + 既有测试；行号对 master `f64aaf0`），产出逐键定档表并如实标注
      「实测 / 静态推断」两类证据口径（proposal §逐键定档表）
- [x] 1.3 起草 proposal / design / tasks / specs 增量（harness + keymap-commands 两份 delta），
      含接管方案、与 M444 的衔接声明、机器判据设计、观测闸三问、裁决点与起草倾向
- [x] 1.4 `npx --yes @fission-ai/openspec@1.12.0 validate composer-emacs-nav --strict` 通过
- [ ] 1.5 呈 tower 报 Alex 节点 1 裁决（本任务在呈报后勾选）

## 2. 前置与落地次序（proposal 裁决点 5）

- [x] 2.1 与 tower 确认与 `composer-intercard-caret`（M444）的落地次序：**M444 已先落地**
      （合并进 master），⇒ 2.2 跳过
- [x] 2.2 （M444 未落地时）先落地它的三件事——**未触发**：M444 已落地，其 `boundaryCaretAt` /
      `domCaretTarget` / `isCardFrontCaret` 三个纯函数与读回 / 写回归一即本 change 的模型层前置
      （本 change 只在其上加导航语义，未另起一套）
- [x] 2.3 M444 已落地后，在它的 change 里把 tasks §3（条件落地的水平移动）整组标注「未触发，由
      composer-emacs-nav 接管」，其裁决点 2 的实测闸降级为反向验证的对照组证据
      （落点：`openspec/changes/composer-intercard-caret/tasks.md` §3）
- [x] 2.4 归一等价类作为**一处**函数落地（`normalizeComposerCaret`，读回由移动 / 扩选命令共用），
      并补其单测（§4.1 的三形态 + 商集有序）——落点 `src/harness-panel.ts` 与
      `tests/unit/composer-nav.test.ts`

## 3. 键位层（`src/keys.ts` / `src/main.ts`）

- [x] 3.1 `KeyScope` 加第三值 `"text"`；新增导出常量 `COMPOSER_TEXT_COMMAND_IDS`（= §逐键定档表
      「表 1」的 21 条命令，与 design §4 一一对应）
- [x] 3.2 抽出**唯一**的作用域派生函数 `scopeOfCommand(command)`，`KEY_BINDINGS` 的 `scope` 字段、
      装配期对账（`tests/unit/keys.test.ts` 的泛化断言）、`applyKeyOverrides` 三处共用它
- [x] 3.3 族内绑定（⌃F/⌃B/⌃A/⌃E/⌃N/⌃P/⌃D/⌃H/⌥D/⌥⌫/⌃K/⌃Y/⌃T/⌃⇧F/B/N/P/A/E/⌥F/⌥B 及方向键两条
      别名）的作用域由 `editor` 改判 `text`（由 `scopeOfCommand` 派生）；命令 id 与编辑器侧实现
      不变；族外 editor 命令（⌥G、widget 族、Tab 缩进等）作用域不动
- [x] 3.4 `KeymapContext` 加 `isComposerEvent(event)`（装配层实现：`event.target` 在
      `.lumir-hp-composer` 内）；分发器对 `text` 作用域按「编辑器面或 composer 面」判定命中
- [x] 3.5 装配层加**一处**命令包装 `composerTextFaceCommands()`：`text` 面命令按事件目标分派到
      编辑器侧实现或面板的 composer 命令入口（与 `isComposerEvent` 调同一个 `isComposerTarget`
      助手——面判定只有一处）
- [x] 3.6 面板句柄（`HarnessPanelHandle`）加 `composerCommand(command)`：按命令 id 分派到模型层
      操作，返回是否消费
- [x] 3.7 键位查看面板与文案：`text` 面命令**归入既有分组**（`BINDING_GROUPS` 不动——族内命令
      本就在「移动与选择 / 扩选 / 删除 / kill-yank」四组里）；来由文案（本例采取**改准既有条目**
      而非另铸编号：D260–D267 / D278–D284 / D286–D293 三条连续段的 zh/en 各追加一句「M447：编辑器
      与 composer 两处文本面共用同一绑定」），随 `copy-data` 漂移测试对齐
- [x] 3.8 keys 层单测：表对账（token 唯一、`scopeOfCommand` 单一来源、`text` 面清单逐条对应）、
      `[keys]` 对 `text` 面命令的重绑 / 解绑、分发器三分支（composer 内族内命中 / 族外 editor
      命令不命中 / contentDOM 内行为与今天一致 / chrome 上不命中）——落点 `tests/unit/keys.test.ts`

## 4. composer 模型层：停靠点与移动族（`src/harness-panel.ts` 或同层新模块，纯函数零 DOM）

- [x] 4.1 停靠点序列的生成与归一等价类（§4.1）；移动纯函数族：`moveCharForward` / `moveCharBackward`
      （代理对整步、卡片一步跨过）、`moveLineStart` / `moveLineEnd`（逻辑行）、`moveLineDown` / `moveLineUp`
      （段内同列位 + 跨块跳过卡片；无邻块 no-op）——落点 `src/harness-panel.ts`
- [x] 4.2 扩选对称六键 + 按词扩选：anchor 不动、head 复用 4.1 的**同一份**移动函数（`extendSelection`
      在面板命令层；按词步进 `moveWordForward` / `moveWordBackward` 复用共用词边界函数）
- [x] 4.3 模型层单测：小块序列全枚举 × 起始光标的落点断言（含相邻卡片、以卡片开头 / 结尾、空段落、含 `\n`、
      代理对）；「任意相邻停靠点不同类」的商集有序断言；**导航的返回块序列与入参逐字节相等**（导航不编辑）
      ——落点 `tests/unit/composer-nav.test.ts`
- [x] 4.4 三个 DOM 形态（锚在 composer 元素 / 卡片内 / 段落末文本节点）归一到同一模型值的单测（替身驱动）

## 5. 删除族、kill-yank 与转置

- [x] 5.1 ⌃D / ⌃H 接既有 `deleteForwardAtCaret` / `backspaceAtCaret`（有选区先走 `deleteSelectionRange`）；
      对账断言：⌃D ≡ Delete、⌃H ≡ Backspace 走**同一个函数**（不是两份实现）
- [x] 5.2 词边界与字符簇扫描提为共用纯函数（`WORD_CHAR` / `isWordChar` / `scanRunForward` /
      `scanRunBackward` / `wordEndForward` / `wordStartBackward` / `clusterForward` / `clusterBackward`
      住在叶子模块 `src/quote-card.ts`）；编辑器侧与 composer 侧共用同一份，MUST NOT 复制第二份
- [x] 5.3 ⌥D / ⌥⌫（词级 kill，不跨块、段边界无动作）与 ⌃K（kill 到逻辑行行尾 / 行尾则杀 `\n` / 段末行尾
      no-op）；单测覆盖不跨块不变量（段边界处块序列逐字节不变）
- [x] 5.3a **面板就地分支收窄**：`composer.addEventListener("keydown")` 的 Backspace / Delete 分支改为只处理
      **不带任何修饰键**的那一拍（`!metaKey && !ctrlKey && !altKey`）——不收窄则 ⌥⌫ 的表内绑定永不命中、
      退化为逐字符退格（§4.5 的陷阱）；补了行为判据（验收场景 144：`alpha beta gamma` 行尾 ⌥⌫ 删掉整个词）
- [x] 5.3b 复核其余族内键会不会被就地路径吞掉：⌥F/⌥B/⌥D 不经 `:5002`（`mod` 不含 altKey），且它们的
      `event.key` 被 macOS 的 Alt 层替换（`f`→`ƒ` 等），面板的 Enter / Backspace / Delete 分支都不命中
      ⇒ 落空放行给分发器；⌃ 系走 `mod` 早退同理。**结论：只有 ⌥⌫ / ⌥Delete 需要 5.3a 的收窄**
- [x] 5.4 kill 槽提为共用模块并导出（`KillSlotState` / `currentKillSlot` / `setKillSlot` / `mergeKillText`
      住在 `src/quote-card.ts`），编辑器侧改为引用；composer 的 kill / yank 共用同一槽
- [x] 5.5 ⌃Y：插入当前段落（多行经 `insertPlainTextAtCaret` 拆段）、卡片边界位先物化、有选区先删选区
- [x] 5.6 ⌃T：与 `src/editor.ts` 的 `transposeChars` 逐条同语义（段首 / 卡片边界 no-op）；单测三档。
      **规格措辞更正**：specs 增量原写「段首 / 段尾 / 卡片边界处无动作」，而编辑器侧的转置在**行尾**是
      「转置末两个字符簇」（Emacs C-t 的原义）——实现取「与编辑器侧逐条同语义」，spec 的对应句已改准

## 6. 合同与视觉

- [x] 6.1 `docs/specs/harness-composer.md` 追加 **HC4** 导航条款（停靠点序列 + 导航不改块序列 / 不成撤销步 /
      不重渲），配可证伪的模型层属性测试；接在 HC3（M444 的边界位条款）之后追加、不重复定义
- [x] 6.2 导航 MUST NOT 整面重渲：实现侧核对（只写选区 + 滚动位，`setDomCaret` / `setDomSelection`，
      不调 `renderComposer`）；§7 的 MutationObserver 计数判据**本套件判不了**（无 JS 求值通道），
      已登记为未覆盖项（见 §7.9 与场景 142 的已知边界）
- [x] 6.3 未动视觉相关文件（`src/style.css` / `src/preview/**` / `tests/visual/scenes/**` 零改动）
      ⇒ 预期零基线更新；本轮未跑 `gate.sh visual`（无改动面）

## 7. 真机验收场景（`scripts/acceptance`，mock provider，fixture 全合成）

- [x] 7.1 移动族逐键落点——场景 `140-harness-composer-nav-move.md`（⌃B/⌃A/⌃E/⌃N/⌃P，⌃F 与 ⌃B 对称）
- [x] 7.2 卡片边界一步跨过——场景 `141-harness-composer-nav-intercard.md`（⌃B 两次跨过一张卡）
- [x] 7.3 导航零 DOM 变更——**部分**：`142-harness-composer-nav-no-rerender.md` 用「导航后文本不变 +
      导航不成撤销步」的可观测后果判；MutationObserver 计数判不了（见 6.2 / §7.9 的登记）
- [x] 7.4 导航不成撤销步——同场景 142
- [x] 7.5 删除族按整卡 / 词级不跨块——场景 `143`（⌥⌫ 段首不删卡 / ⌃H 删整卡 / ⌃D 卡片前缘删整卡）
- [x] 7.6 ⌥⌫ 确实走表（面板让位生效）——场景 `144-harness-composer-alt-backspace.md`
      （`alpha beta z` 正向 + `alpha beta gam` 负向 + ⌃Y 插回 + 裸 Backspace 逐字符）
- [x] 7.7 kill-yank 跨面——场景 `145-harness-composer-kill-yank.md`（编辑器 ⌃K → composer ⌃Y）
- [x] 7.8 扩选 anchor 不变 / 族外键不回退——场景 `146-harness-composer-extend.md` 与
      `147-harness-composer-family-outside.md`
- [ ] 7.9 反向验证（合同先行）：**未执行**。四条都需要真机读数（把某条命令临时改回原生路径 / 把导航改成
      整面重渲 / ⌥⌫ 改成跨块删卡 / 面板分支放回「带修饰键也处理」，逐条断言 MUST 变红），而真机跑绿本轮由
      tower 统一安排（见 mission 说明）。四条中的「整面重渲」一条还受 6.2 的判据缺口阻塞

## 8. 验证

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（`gate.sh quick` 的
      `openspec-validate` 一档 PASS）
- [x] 8.2 `bash scripts/gate.sh quick` 全绿（读数见 §9）
- [ ] 8.3 验收场景（§7）真机全绿，证据落 `test-results/acceptance/`——**未执行**（本轮不真机；场景已就绪、
      `run.mjs --check` 150 个全过）
- [x] 8.4 信息卫生：改动面 text 级 grep 清扫（无真实 vault 内容；fixture / 探针串全合成）
- [x] 8.5 归档前逐条对账：tasks / spec 增量 / 实现三者一致（§9）；`harness-composer-image-paste` 与
      `composer-intercard-caret` 的归档次序按当前文本核过（两者的 MODIFIED 文本未与本 change 重叠改同一句）

## 9. M453 执行结论（对账）

**改动面**：`src/keys.ts`（`KeyScope` 三值、`COMPOSER_TEXT_COMMAND_IDS`、`scopeOfCommand`、族内绑定
作用域、`KeymapContext.isComposerEvent`、分发器、`applyKeyOverrides`）、`src/main.ts`
（`isComposerTarget` / `composerTextFaceCommands` 一处包装 / `keymapContext.isComposerEvent`）、
`src/harness-panel.ts`（模型层纯函数族 + `domPointOf` / `setDomCaret` / `setDomSelection` 重构 +
`composerCommand` 命令入口 + 就地 Backspace/Delete 分支收窄）、`src/editor.ts` 与 `src/quote-card.ts`
（词 / 字素簇扫描与 kill 槽提为共用实现）、`src/copy-data.ts` + `文案-Copy.md`（三条连续段的来由文案改准）、
`docs/specs/harness-composer.md`（HC4）、`tests/unit/{keys,composer-nav}.test.ts`、
`scripts/acceptance/scenarios/140`–`147`、`openspec/changes/composer-emacs-nav/{proposal,tasks}.md`、
`openspec/changes/composer-intercard-caret/tasks.md`。**零改动**：`src/style.css`、`src/preview/**`、
`tests/visual/**`、投递序列化面、`src-tauri/**`。

**与 design §4.1 的一处偏差（实现期判断，已写进 HC4 的注记）**：`caretFromDom` 的编辑读回**不**调
`normalizeComposerCaret`——编辑动词（退格 / 前删 / 键入分派 / 粘贴）依赖「段落末缘」与「后块前缘」是两个
不同的模型值（归一后段落末缘的退格会变成跨块合并、段末键入会插到下一段段首）。等价类服务的是导航
（移动 / 扩选命令），在那里它正是避免「原地空走」所需要的。

**共用模块的落点**：词 / 字素簇扫描与 kill 槽住在叶子模块 `src/quote-card.ts`（编辑器侧与 composer 侧
同一份）。选址原因是硬约束：composer 的模块图必须能进零 DOM 单测（`tests/unit`），而 `src/editor.ts` 的
import 图里有 TypeScript 参数属性（`src/preview/livePreview.ts` 一族），`node --experimental-strip-types`
直接报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`（同 `src/enter-indent.ts` / `src/list-indent.ts` 的模块头所述）
——两个方向分开 import 会把 livePreview 拖进 composer 的单测图，`node tests/unit/run.mjs` 立刻红。
若归档期认为应另立 `src/text-primitives.ts` 一类模块，属另一次改动（本 mission 的写入面无新文件位）。

**机器验证**：`node tests/unit/run.mjs` 全绿（849 用例，含新增 `composer-nav.test.ts` 与 keys 层 M447 组）；
`tsc --noEmit` 通过；`gate.sh quick` **9/9 PASS（SKIP 1 = tsc-visual，`tests/visual` 依赖未装——既有边界，
非本次改动引入）**；`node scripts/acceptance/run.mjs --check` 150 个场景静态校验全过；视觉面零改动
（未跑 `gate.sh visual`）。

**未完成项（如实登记）**：① §7.9 反向验证四条（需真机，且「整面重渲」一条受 §6.2 的判据缺口阻塞）；
② §7.3 / §6.2 的 MutationObserver 计数判据——真机套件无 JS 求值通道，需另加一条 suite verb 或在
`tests/visual` 加 chromium 结构断言（两者都超出本 mission 的写入面）；③ §8.3 真机跑绿（场景已就绪，
`--check` 已过，等 tower 统一安排前台窗口）。
