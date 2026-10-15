# Design: 裸 marker 行的列表编辑态 + IME 组合期不重复插入 marker

## 1. 探针结论（合同先行的依据）

真机探针（`pnpm tauri dev` 实例 pid 隔离 + 合成 vault `/tmp/lumir-m461-probe`，证据
`test-results/m461-probe/readings.md` + 两张截图）：

### 1.1 缺陷①的语法机制（lezer 直跑，同生产 GFM 配置）

| 输入 | 解析 | 处置 |
|---|---|---|
| `1. `（首行）/ `para\n\n1. ` | OrderedList 空项 | 真列表，既有路径已覆盖 |
| `para\n1. ` | Paragraph lazy | **缺口**：缺陷①现场形态 |
| `para\n2. abc` | Paragraph lazy | 缺口（非 1 起号不能打断段落） |
| `para\n- ` | SetextHeading2 | setext 下线，排除 |
| `para\n+ ` / `para\n* ` | Paragraph lazy | 同族缺口 |
| `> 1. ` | Blockquote › OrderedList | 真列表 |
| `> para\n> 1. ` | Blockquote › Paragraph | 引用内缺口 |
| ```` ``` ```` 内 / 4 空格缩进内 `1. ` | FencedCode / CodeBlock | 排除 |

结论：判定必须是 `listLineInfo` 的**补集**——先按文本形态认出 marker 行，再把树
已接管的形态（`listLineInfo` 给出 `item && first`）全部让回既有路径。同语义不得
两处抢（REVIEW.md 第 8 条）。

### 1.2 缺陷②的事件层定界（自动化可达的边界）

- 英文态逐键：`keydown → beforeinput insertText → input → mutation`，无
  `insertOrderedList`，无 composition，无重复（两张截图之一的现场）。
- CM `handlers.beforeinput`（@codemirror/view dist/index.js:5295）只特殊处理
  insertText / insertCompositionText / insertReplacementText / Android 键，对其余
  inputType **返回 false**——原生自动列表的默认动作不会被我方或 CM 拦截。
- 中文组合态**无法自动化复现**：KimiCU（PostToPid）、osascript（session tap）、
  CGEventPost（HID tap，unicode 串 / 真实 keyCode 两形态，含同脚本切拼音 + 前台 +
  点入编辑器）全部绕过 TSM，`compositionstart` 零命中。旁证定界：全仓无自写 marker
  代码 + CM 不拦 ⇒ 唯一候选插入者 = WebKit 原生 smart-list；inputType 精确形态
  （insertOrderedList 类 beforeinput vs 裸 DOM 变更）只能硬件复现定死。

## 2. 判定设计：`bareListMarkerLine`（src/preview/lists.ts）

```
^((?:>[ \t]*)*)([ \t]*)((\d{1,9})([.)])|([-+*]))([ \t]+)(.*)$
  prefix(引用+缩进)     有序(数字+分隔符)  无序        分隔空白  内容
```

排除链（resolve marker 位、向上走祖先）：FencedCode / CodeBlock / HTMLBlock /
Table / SetextHeading* / ATXHeading* / HeaderMark → null；`listLineInfo` 给出
`item && first`（树接管）→ null。返回 marker 区间、序号 / 分隔符、prefix、内容起点。

选择做成 `listLineInfo` 同文件的导出纯函数而不是扩 `listLineInfo` 的返回：L3 合同
（lists.md）钉死了「归属判定与光标位置无关」，裸行门控恰恰是**光标相关**的新一层
——放进 `ListLineInfo` 会污染既有合同的语义边界。

## 3. Enter 两态分派（src/enter-indent.ts）

`enterWithAutoIndent` 的 md 分支最前插 `enterBareMarkerLine`（先于
`continueMarkupExitEmptyItem`——裸行在树上不是列表项，上游命令必然不命中，顺序
只为语义清晰）：

- `state.readOnly` → false（只读守卫，dispatch 会绕过 CM 命令自身的只读检查）；
- 光标 `head < bare.markerFrom`（行首结构前缀内）→ false，落回默认行为
  （该行之前插空行，M399 行首 Enter 钉固同口径）；
- 空项（内容 trim 为空）→ 单事务删 `[markerFrom, line.to)`，光标 anchor markerFrom；
- 有内容 → 单事务插 `\n{prefix}{下一 marker}`（有序 = 字面序号 +1、分隔符沿用；
  无序 = 同标记 + 空格），光标落在插入后。

单次 dispatch = 单次撤销步（spec 既有条款）。事务用 `state.update(...)` 构造
（不是 spec 对象）——与上游命令同形态，假 view 单测可直接消费。

## 4. 光标驻留渲染（ListLayout.build 的裸行分支）

门控：`revealSelection(state)`（reveal-gate 的按压快照口径，M259）与行范围**相接
即算**——光标在行首（marker 之前）也算驻留，与 M110 行级显露同取向（空 caret 在
行首时该行必须已是编辑态，否则作者看不到刚敲入的标记被接管）。上一行行尾的 caret
（= 本行行首 − 1）不满足 `r.to >= line.from`，不误触发。

装饰：行类 `cm-lp-list-line cm-lp-list-first cm-lp-bare`；`--lp-list-body` =
`(前缀列 + 字面标记宽 + 1) × 单位`、`--lp-list-marker` = `(字面标记宽 + 1) × 单位`
（与真路径 `scan.width = display.length + 1` 同公式）；replace `[line.from,
contentFrom)` 上既有 `ListMarker` widget（有序 = 字面标记文本，无序 =
`bulletGlyph(1)`——裸行不进组，无复合编号）。引用前缀在 replace 区间内——与真实
引用内列表（M138）的落点同口径。

重建触发：`update.selectionSet` 与 `pointerPressFrame` effect 进 build 条件。既有
条件（docChanged / 树变化 / viewport / 字体测量）不含选区——不加的话光标移进移出
裸行时装饰不重建（门控是选区的函数）。代价：每次 caret 移动重扫可见行的列表装饰，
与主 livePreview 装饰层（本就 selectionSet 重建）同量级。

## 5. DOM 入口拒收（缺陷②）

`swallowNativeListBeforeInput`（enter-indent.ts，最小事件结构 `{inputType,
preventDefault}` 以便单测直驱）经 `EditorView.domEventHandlers` 装进 md 模式。
命中 `insertOrderedList` / `insertUnorderedList` → preventDefault + 消费。

- 为什么拦全部时机而不只组合期：英文态无这两个事件（探针实测），平时拦不到任何东西；
  一旦真的出现（原生 smart-list），任何上下文下都不是本仓语义想要的——预防性不扩面
  到此集合之外（不拦 formatBold 等）。
- 若 WebKit 走裸 DOM 变更路径（无 beforeinput）：此拦截不兜。已登记为已知边界，留
  dogfood；再修需要 compositionend 后的 DOM 对账，复杂度不值当预防性投入。

## 6. 验证矩阵

| 层 | 制品 | 覆盖 |
|---|---|---|
| 单测 | `tests/unit/ordered-list-auto-mode.test.ts` | 判定分布（9 条）/ Enter 退出与续行（含撤销步数、引用前缀、只读、真实路径回归）/ beforeinput 拦截放行两态 |
| 合同 | `docs/specs/lists.md` 新增 B1/B2 | 门控相接即算、渲染不改文档 |
| 视觉 | `tests/visual/scenes/lists.spec.ts` 新增用例（chromium 结构断言） | 光标驻留行类 / 离开即还原 |
| 真机 | `scripts/acceptance/scenarios/` 新增场景 | 进入 / 续行 / 退出三态的文档终态；IME 拦截以派发 beforeinput(insertOrderedList) 的静态断言兜底，组合期真 IME 留 dogfood |

## 7. 已知边界（如实登记）

1. 组合期重复的真机复现需要硬件键盘（自动化合成事件不进 TSM）；修复按代码层定界
   先落 DOM 入口拦截，dogfood 复验，若裸 DOM 路径再犯另立项。
2. 裸行续行不做组内重排（字面 +1）；与 Obsidian 一致即可。
3. 探针期间 2 个字母误入前台 app（飞书 / Enpass，详见 readings.md 与 tower 上报），
   非产品行为。
