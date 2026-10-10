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

- [ ] 2.1 与 tower 确认与 `composer-intercard-caret`（M444）的落地次序：M444 先（或同批）⇒ 2.2 跳过；
      M447 先 ⇒ 2.2 必须做
- [ ] 2.2 （M444 未落地时）先落地它的三件事：边界光标位表示 `{block: N, offset: 0}`、`caretFromDom` /
      `setDomCaret` 往返对称、卡片边界位的内容输入物化——照 M444 design §3 的落法，MUST NOT 另起一套
- [ ] 2.3 M444 已落地后，在它的 change 里把 tasks §3（条件落地的水平移动）整组标注「未触发，由
      composer-emacs-nav 接管」，其裁决点 2 的实测闸降级为反向验证的对照组证据
- [ ] 2.4 归一等价类作为**一处**函数落地（读回与全部移动命令共用），并补其单测（§4.1 的三形态 + 商集有序）

## 3. 键位层（`src/keys.ts` / `src/main.ts`）

- [ ] 3.1 `KeyScope` 加第三值 `"text"`；新增导出常量 `COMPOSER_TEXT_COMMAND_IDS`（= §逐键定档表「表 1」的
      命令清单，与 design §4 一一对应）
- [ ] 3.2 抽出**唯一**的作用域派生函数 `scopeOfCommand(command)`，`KEY_BINDINGS` 的 `scope` 字段、装配期
      对账、`applyKeyOverrides` 三处共用它（MUST NOT 三处各写一份判据）
- [ ] 3.3 族内绑定（⌃F/⌃B/⌃A/⌃E/⌃N/⌃P/⌃D/⌃H/⌥D/⌥⌫/⌃K/⌃Y/⌃T/⌃⇧F/B/N/P/A/E/⌥F/⌥B）的作用域由 `editor`
      改判 `text`；命令 id 与编辑器侧实现不变；族外 editor 命令（⌥G、widget 族、Tab 缩进等）作用域不动
- [ ] 3.4 `KeymapContext` 加 `isComposerEvent(event)`（装配层实现：`event.target` 在 `.lumir-hp-composer` 内）；
      分发器对 `text` 作用域按「编辑器面或 composer 面」判定命中
- [ ] 3.5 装配层加**一处**命令包装：`text` 面命令按事件目标分派到编辑器侧实现或面板的 composer 命令入口
      （MUST NOT 每个命令各写一遍面判定）；面板未在场 / 该处无动作时不消费事件
- [ ] 3.6 面板句柄（`HarnessPanelHandle`）加 composer 命令入口：按命令 id 分派到模型层操作，返回是否消费
- [ ] 3.7 键位查看面板与文案：`text` 面命令按功能族归入既有分组；来由文案（新 D-code，zh/en 双档）点明
      「编辑器 + composer 两处文本面」；随 `copy-data` 漂移测试对齐
- [ ] 3.8 keys 层单测：表对账（token 唯一、`scopeOfCommand` 单一来源、`text` 面清单与 design §4 逐条对应）、
      `[keys]` 对 `text` 面命令的重绑 / 解绑与 warning、分发器三分支（composer 内族内命中 / 族外 editor 命令
      不命中 / contentDOM 内行为与今天一致 / chrome 上不命中）

## 4. composer 模型层：停靠点与移动族（`src/harness-panel.ts` 或同层新模块，纯函数零 DOM）

- [ ] 4.1 停靠点序列的生成与归一等价类（§4.1）；移动纯函数族：`moveCharForward` / `moveCharBackward`
      （代理对整步、卡片一步跨过）、`moveLineStart` / `moveLineEnd`（逻辑行）、`moveLineDown` / `moveLineUp`
      （段内同列位 + 跨块跳过卡片；无邻块 no-op）
- [ ] 4.2 扩选对称六键 + 按词扩选：anchor 不动、head 复用 4.1 的**同一份**移动函数；按词步进复用共用词边界函数
- [ ] 4.3 模型层单测：小块序列全枚举 × 起始光标的落点断言（含相邻卡片、以卡片开头 / 结尾、空段落、含 `\n`、
      代理对）；「任意相邻停靠点不同类」的商集有序断言；**导航的返回块序列与入参逐字节相等**（导航不编辑）
- [ ] 4.4 三个 DOM 形态（锚在 composer 元素 / 卡片内 / 段落末文本节点）归一到同一模型值的单测（替身驱动）

## 5. 删除族、kill-yank 与转置

- [ ] 5.1 ⌃D / ⌃H 接既有 `deleteForwardAtCaret` / `backspaceAtCaret`（有选区先走 `deleteSelectionRange`）；
      补对账断言：⌃D ≡ Delete、⌃H ≡ Backspace 的模型结果逐字节相同
- [ ] 5.2 词边界与字符簇扫描**提为共用纯函数**（`src/editor.ts:583-584` 的 `WORD_CHAR` / `isWordChar`、
      `prevCluster` / `nextCluster` 今天模块私有）；编辑器侧与 composer 侧共用同一份，MUST NOT 复制第二份
- [ ] 5.3 ⌥D / ⌥⌫（词级 kill，不跨块、段边界无动作）与 ⌃K（kill 到逻辑行行尾 / 行尾则杀 `\n` / 段末行尾
      no-op）；单测覆盖不跨块不变量（段边界处块序列逐字节不变）
- [ ] 5.4 kill 槽提为共用模块并导出（`src/editor.ts:704-728` 的 `killSlot` 与相接判定），编辑器侧改为引用；
      composer 的 kill / yank 共用同一槽；单测：相接合并、跨面共用、**kill 内容永不含卡片**（属性断言）
- [ ] 5.5 ⌃Y：插入当前段落（多行经 `insertPlainTextAtCaret` 拆段）、卡片边界位先物化、有选区先删选区；
      单测覆盖三档
- [ ] 5.6 ⌃T：与 `src/editor.ts:777-799` 的 `transposeChars` 逐条同语义（段首 / 段尾 / 卡片边界 no-op）；
      单测三档

## 6. 合同与视觉

- [ ] 6.1 `docs/specs/harness-composer.md` 追加导航条款（停靠点序列 + 导航不改块序列 / 不成撤销步 / 不重渲），
      配可证伪的模型层属性测试；若 M444 已在该文件落过边界位条款，在其后追加、不重复定义
- [ ] 6.2 导航 MUST NOT 整面重渲：实现侧核对（只写选区 + 滚动位），并在 §7 的验收场景里用 MutationObserver
      计数钉住
- [ ] 6.3 动过视觉相关文件（`src/style.css` / `src/preview/**` / `tests/visual/scenes/**`）时按纪律跑
      `bash scripts/gate.sh visual` 并核对既有基线时间戳；预期零基线更新（导航不产生新元素与新样式）

## 7. 真机验收场景（`scripts/acceptance`，mock provider，fixture 全合成）

- [ ] 7.1 移动族逐键落点（段落 / 相邻卡片 / 卡片边界三类起点）
- [ ] 7.2 卡片边界一步跨过（两卡之间可停靠、可原路返回；继续输入落到新段落）
- [ ] 7.3 导航零 DOM 变更（MutationObserver 计数 = 0）
- [ ] 7.4 导航不成撤销步（导航后 ⌘Z 回到编辑前态）
- [ ] 7.5 删除族按整卡（⌃D 卡片前缘删整卡 / ⌃H 段首遇卡片删整卡 / ⌥⌫ 段首不删卡）
- [ ] 7.6 kill-yank 跨面（编辑器 ⌃K → composer ⌃Y 同一槽）
- [ ] 7.7 扩选 anchor 不变；族外键（⌥G / ⌃V / Tab）在 composer 内不回退
- [ ] 7.8 反向验证（合同先行）：命令改回原生路径 ⇒ 落点断言变红；导航改为整面重渲 ⇒ 7.3 变红；
      ⌥⌫ 改为跨块删卡 ⇒ 不跨块断言变红

## 8. 验证

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 8.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
- [ ] 8.3 验收场景（§7）真机全绿，证据落 `test-results/acceptance/`
- [ ] 8.4 信息卫生：改动面一次 text 级 grep 清扫（无真实 vault 内容；fixture 全部合成）
- [ ] 8.5 归档前逐条对账：tasks / spec 增量 / 实现三者一致；`harness` 的 MODIFIED 与在途
      `harness-composer-image-paste` / `composer-intercard-caret` 的归档次序已按当时文本重新落准
