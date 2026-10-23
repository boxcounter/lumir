# scrollbar-tiers-oct24 · ui-design-system 增量

> 改名通道说明：旧条「阅读面横向滚动条」的作用域、档位定义与「新增容器先归挡」口径都要改，且标题本身
> 已不成立（作用域不再是「阅读面」、档位从两档变三档）——按仓内先例走 **REMOVED + 新名 ADDED**
> （MODIFIED 不允许改 requirement 名，且改名后的 MODIFIED 会被 `scripts/openspec-archive-check.mjs`
> 判「MODIFIED 指向的 requirement 不在 living spec 里」）。旧条的实质内容逐条承接在新条里：
> 细条 / 隐藏两档的配方与消费者、`scrollbar-width` + `::-webkit-scrollbar` 两条声明都要的理由、
> 「组件 MUST NOT 各抄一份值」、m628 的机器判据指针——没有一条被静默丢下。

## REMOVED Requirements

### Requirement: 阅读面横向滚动条

整条移除并由下条新名 requirement（「滚动条分档与滚动容器注册表」）承接。原条的三处不成立是本 change
的动机：作用域只写「阅读面」（harness 代码块 / 工具详情 / 编辑器横滚区），仓内 19 个滚动面里 16 个
因此未归挡；档位只有细条与隐藏两档，装不下「改档就会让全部像素基线失效、而收益只是滚动瞬间看着细」
的纵向阅读面（编辑器主滚动、transcript、文件树等）；「新增容器先归挡」只有文字承诺，机器判据仅覆盖
m628 写死的三个选择器，新容器绕过它们即无人拦。原条的两档配方、消费者名单与 m628 判据指针逐字承接在
新条正文里；新条另补第三档（原生 overlay 豁免白名单）、可执行注册表、右缘 12px 不变量与浮层验收的
「先断言溢出」判据。

## ADDED Requirements

### Requirement: 滚动条分档与滚动容器注册表

凡在任一轴声明 `overflow: auto` / `overflow: scroll` 的滚动容器（含 chrome、浮层、编辑器与预览的横滚面）
SHALL 归入且仅归入下列三档之一，MUST NOT 留在未登记的默认形态。档位按**容器**分配，MUST NOT 按轴分配：
WebKit 一旦为某容器自绘 `::-webkit-scrollbar`，就把它两条轴一起从 overlay 切成占位经典条——只写
`height` 时纵向仍变占位条（实测 17px）、只写 `width` 时横向同理；逐轴的 `::-webkit-scrollbar:horizontal`
在 WKWebView 上是死规则（与不写声明逐字节相同）；`scrollbar-width` 不改变 WKWebView 的 overlay 条。
因此「同一容器一轴细条、一轴 overlay」在实现上不可达，判据的分配单位只能是容器整体。

- **细条档**：`scrollbar-width: thin` + `::-webkit-scrollbar { width: 4px; height: 4px }` + thumb 取
  `--border`、轨道 `transparent`。两条声明都要——标准通道管标准渲染，`::-webkit-scrollbar` 管
  WKWebView 与 chromium（只写前者时 WKWebView 仍是系统默认条）。配方 SHALL 由**一份共用选择器组**承担，
  消费者 MUST NOT 各自再写一份值。现行消费者：harness transcript 的代码块 / diff / argv（M406 起，
  M628 把代码块并入同一份声明）、编辑器预览的块级横滚容器——代码块 `.cm-lp-block-scroll`、宽表
  `.cm-lp-table-scroll`、公式 `.cm-lp-math-block`、mermaid 图 `.cm-lp-mermaid`（M663）。
- **隐藏档**：`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`。滚动能力保留（触控板手势 /
  程序化对齐），只是不占位、不上屏。现行消费者：标签栏（M257，与浏览器标签条同形态）、右缘 0 留白且
  逐行有常驻钮的三处浮层列表——vault 切换浮层 `.vault-list`、harness 会话浮层 `.lumir-hp-sesspop-list`、
  权限规则段 `.lumir-hp-permpop-rules`（M660）。
- **原生 overlay 豁免档（白名单，逐条枚举）**：保留平台 overlay 条，MUST NOT 为该容器声明
  `scrollbar-width`（含 `thin` / `auto`），MUST NOT 为它写任何 `::-webkit-scrollbar` 规则——写了就把该
  容器翻成占位经典条，与本档的「不占宽」前提相悖。准入判据（三条同时成立）：静止态不占宽、右缘 8px 以上
  是留白或空轨道、改档会让像素基线全量失效而收益只是「滚动瞬间看着细」。现行白名单：编辑器主滚动
  `.cm-scroller`（两轴；正文列两侧是 `1fr` 空轨道，纵向条不压任何正文或可点件——且自绘即双轴占位，见上）、
  文件树 `.tree-pane`、键位面板体 `.lumir-bindings-body`、表格全屏壳 `.lumir-table-fs-panel`、
  代码块全屏壳 `.lumir-codeblock-fs-panel`、大纲浮层列表 `.lumir-toc-list` 与快速打开列表
  `.lumir-qo-list`（行右 padding 8 + 列表 padding 4 = 12px 净留白）、harness transcript
  `.lumir-hp-transcript`、composer `.lumir-hp-composer`，以及 `.pane`（备而不用：编辑器撑满高度时
  实际不滚动）。白名单之外的容器 MUST NOT 使用本档。

归挡结果 SHALL 登记在可执行注册表（`tests/unit/scrollbar-registry.test.ts`）里，注册表是本条的机器判据，
MUST 与源码**双向**对齐：`src/style.css` / `src/harness-panel.css` / `src/preview/theme.ts` 里凡声明
`overflow(-x|-y): auto|scroll` 的选择器，未登记即判红（拦新增容器）；注册表条目在源码里已不存在
（选择器改名或删除）同样判红（拦僵尸条目）。同一判据 SHALL 按档位核验声明本身：细条与隐藏档消费者
MUST 实际持有该档的声明且全档共用一份选择器组，豁免档消费者 MUST NOT 持有任何 `scrollbar-width` /
`::-webkit-scrollbar` 声明。新增滚动容器时 SHALL 在同一变更内先定档、再写 `overflow`，MUST NOT 先写
`overflow` 等评审发现。

滚动容器右缘 12px 内 MUST NOT 放常驻可交互件（逐行删除钮、复制钮、浮动操作钮），除非该容器归隐藏档：
overlay 条不占布局、直接画在内容上，条与钮占同一条带时滚动期间钮会被压住。第二解是给容器右缘留出
≥12px 净留白把 overlay 条吸收进 padding；两种做法都 SHALL 在实现处写明取舍，MUST NOT 只调细条尺寸
了事（4px 条仍会盖住 0 留白容器的钮右缘）。

横向细条容器 MUST NOT 声明 `scrollbar-gutter`：其纵向已显式 `overflow-y: hidden`，不存在「纵向条出现
导致抖宽」的场景，该声明只在 classic 滚动条环境换来常驻沟槽（M177 实测 `offsetWidth − clientWidth = 15`，
overlay 环境为 0）。浮层 / 列表类滚动容器的验收场景 SHALL 先断言容器确实溢出
（`scrollWidth > clientWidth` 或 `scrollHeight > clientHeight`），再断言滚动条形态——在不溢出的容器上
量滚动条是空测量（同 m628 注释里的「区分度输入」口径）。

#### Scenario: 代码块横向溢出是细条

- **WHEN** harness transcript 里出现横向溢出的代码块（超长代码行）
- **THEN** 其滚动条为 4px 细条（`scrollbar-width: thin` + `::-webkit-scrollbar` 的 4px 声明，与工具详情的 diff / argv 同一份声明逐值一致），系统默认粗条不出现

#### Scenario: 预览横向滚动面是细条，且断言前先证明溢出

- **WHEN** md 文档里同时出现「默认不折行」的超长代码行、宽于正文列的表、宽于正文列的块级公式与宽图
- **THEN** 四个块级横滚容器（`.cm-lp-block-scroll` / `.cm-lp-table-scroll` / `.cm-lp-math-block` /
  `.cm-lp-mermaid`）各自先满足 `scrollWidth − clientWidth > 0`（本场景的区分度输入），再各自取到
  `scrollbar-width: thin` 的计算值与 `::-webkit-scrollbar` 的 4px 声明；宽表容器的
  `scrollbar-gutter` 计算值为 `auto`（其声明已删除）

#### Scenario: 编辑器主滚动保留平台 overlay 条

- **WHEN** 检查编辑器主滚动容器 `.cm-scroller`（md 与 code 两种模式、三主题）
- **THEN** 它不持有任何 `scrollbar-width` 声明，也没有 `.cm-scroller::-webkit-scrollbar` 规则（`scrollbar-width`
  的计算值为 `auto`），两条轴的滚动条仍是平台 overlay 条；正文列宽与行盒高度逐值不变

#### Scenario: 标签栏不出滚动条

- **WHEN** 打开的标签多到标签栏横向溢出
- **THEN** 标签栏没有可见滚动条（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`），横向滚动能力保留，标签宽度与正文列宽不受影响

#### Scenario: 右缘带常驻钮的浮层列表归隐藏档

- **WHEN** vault 切换浮层 / harness 会话浮层 / 权限规则段的列表长到纵向溢出（每行右侧有 20×20 常驻钮）
- **THEN** 三个列表先满足 `scrollHeight > clientHeight`，且都不显示滚动条（隐藏档），滚动期间行尾的 ✕ / × / 删除钮始终完整可点

#### Scenario: 新增滚动容器未登记即红

- **WHEN** 往 `src/style.css`、`src/harness-panel.css` 或 `src/preview/theme.ts` 里新增一个声明
  `overflow: auto`（或 `overflow-x` / `overflow-y`）的选择器，而未在注册表登记
- **THEN** `pnpm test` 的 `scrollbar-registry` 用例判红并指名未登记的选择器；把它登记进任一档后转绿。
  反向同样成立：注册表里的条目在源码里查不到（改名 / 删除）时判红并指名僵尸条目

#### Scenario: 豁免档不许持有滚动条声明

- **WHEN** 为白名单里的某个容器（如 `.cm-scroller` / `.lumir-hp-transcript`）加上 `scrollbar-width: thin`
  或任意 `::-webkit-scrollbar` 规则
- **THEN** `scrollbar-registry` 用例判红——豁免档的判据是「一条声明都没有」，写了就翻成占位经典条，
  与该档「不占宽」的前提相悖；要改档必须先把容器从白名单移出并写明取舍
