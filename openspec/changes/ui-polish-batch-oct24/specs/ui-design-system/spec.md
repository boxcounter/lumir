# ui-design-system 增量规格

> 起草注记（非规格正文）：本 delta 一条 MODIFIED，基线是 living spec
> [openspec/specs/ui-design-system/spec.md](../../../../specs/ui-design-system/spec.md) 的「阅读面横向滚动条」。
> 按 `openspec archive` 的整块替换语义，整条复制现行正文后就地增补（作用域扩到浮层列表、隐藏档消费者
> 清单 + 三处浮层、右缘 12px 不变量、溢出态前置判据与一条 scenario），未改动的段落逐字保留。
> 标题保留旧名（「阅读面横向滚动条」）不重命名：改名需要 RENAMED 块且对账门禁按名字配对，收益只是
> 字面更准；正文第一段已显式写明适用面不限于阅读面。

## MODIFIED Requirements

### Requirement: 阅读面横向滚动条

承载阅读内容的滚动容器（harness transcript 的代码块与工具详情、编辑器 / 预览的横向滚动区等）
以及**浮层 / 列表的滚动容器**（vault 切换浮层、harness 会话浮层、权限规则段等）SHALL 使用细滚动条
或按场景隐藏，MUST NOT 让系统默认粗滚动条上屏——默认粗条遮挡内容、且与产品「两档 hairline + 底色差」
的层次语汇冲突。两档实现 SHALL 由共用选择器组承担（`src/harness-panel.css` 的细条组、`src/style.css`
的标签栏隐藏组），组件 MUST NOT 各抄一份值：

- **细条配方**（M406 起）：`scrollbar-width: thin` + `::-webkit-scrollbar { width: 4px; height: 4px }`
  + thumb 取 `--border`、轨道 `transparent`。两条声明都要——标准通道管标准渲染，`::-webkit-scrollbar`
  管 WKWebView 与 chromium（只写前者时 WKWebView 仍是系统默认条）。现行消费者：harness 的代码块 /
  diff / argv（M628 把代码块并入同一份声明；机器判据 `tests/visual/scenes/m628-harness-bubble-and-scrollbar.spec.ts`
  按 CSSOM 断言三处消费者逐值一致）。
- **隐藏档**（M257 起）：`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`。滚动能力
  保留（触控板手势 / 程序化对齐），只是不占位、不上屏。现行消费者：标签栏（与浏览器标签条同形态）；
  浮层列表——vault 切换浮层的 `.vault-list`、harness 会话浮层的 `.lumir-hp-sesspop-list`、权限规则段的
  `.lumir-hp-permpop-rules`（M660：这三处容器右缘 0 留白、逐行有常驻钮，4px 细条仍会压住钮的右缘，
  故取隐藏档；三处共用 `src/style.css` 的同一份声明）。

新增滚动容器时 SHALL 先归入上述两档之一；两档都落不了（例如必须可见的纵向滚动条）时，SHALL 在实现处
写明取舍，MUST NOT 留在系统默认形态。**滚动容器右缘 12px 内 MUST NOT 放常驻可交互件，除非该容器归
隐藏档**——overlay 型滚动条不占布局、直接画在内容右缘，钮与滑道重叠是唯一会伤到操作的形态。

#### Scenario: 代码块横向溢出是细条

- **WHEN** harness transcript 里出现横向溢出的代码块（超长代码行）
- **THEN** 其滚动条为 4px 细条（`scrollbar-width: thin` + `::-webkit-scrollbar` 的 4px 声明，与工具详情的 diff / argv 同一份声明逐值一致），系统默认粗条不出现

#### Scenario: 标签栏不出滚动条

- **WHEN** 打开的标签多到标签栏横向溢出
- **THEN** 标签栏没有可见滚动条（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`），横向滚动能力保留，标签宽度与正文列宽不受影响

#### Scenario: 浮层列表的滚动条不压行尾钮

- **WHEN** vault 切换浮层 / harness 会话浮层 / 权限规则段在**溢出态**（`scrollHeight > clientHeight`）下滚动
- **THEN** 三处都不出现可见或占位的滚动条（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`，实测 `offsetWidth === clientWidth`），滚动能力保留（`scrollTop` 可推进），行尾的移除 / 删除钮不被滑道覆盖
- **AND** 验收断言 MUST 先构造确实溢出的列表再判滚动条形态——不溢出的列表上该断言是空测量（M658 的判据要求）
