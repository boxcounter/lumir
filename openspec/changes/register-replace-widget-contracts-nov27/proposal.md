# Proposal: replace 装饰的责任登记与设计闸门

- Change ID: `register-replace-widget-contracts-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（裁决 / 采纳），AI agent（盘点与起草）
- 基线: `a959986e`

> 评审记录
> 节点 1（提案评审）：**通过**（2026-11-27）。Alex 原话：「采纳建议，请你安排」。
> 批准范围：只做 replace 装饰构造的**静态责任登记 + 设计闸门**——新增构造未登记即红、
> 僵尸条目即红、七项责任字段与测试指针可核；不复制运行时闸门、不改任何渲染行为、不新增依赖。
> 来源：2026-11-27 编辑器治理复盘（Alex 已采纳）的 P0 项「replace widget 注册表 + 设计闸门」。
> K3 评审（2026-11-27）：**needs-changes**，无 P1。P2-1（不支持参数形态静默误分类）、P2-2（几何 owner /
> nativeEdit 锚点 / 符号锚点三处字段判据缺口）、P2-3（人读文档失效测试路径）、P3（元素访问边界文档与实现相反）
> 已逐项返修并补反向必红用例，见 tasks §8。

## Why

replace 装饰是 live preview 里最容易「换一个构造就漏一条责任」的一层：它同时决定源码是否
可见、指针落在哪里、只读会话能否改动、原生编辑会不会把渲染文本写回文档、谁写几何、IME
组合期谁收口。这些责任今天分散在 5 个 replace 构造文件与各自的 widget / 几何实现里，**没有任何机制强制新构造先回答它们**。

复盘给出的判据不是「按已知 widget 名称多写几条测试」——那仍然依赖 reviewer 想起某种构造；
缺的是**新增构造必红的准入面**。滚动条分档与文本输入面已经用同一形态解决过同类问题：
把判据反过来，凡命中结构特征者都必须先在注册表归位，注册表与源码双向对账。

盘点（基线 `a959986e`，`src/**/*.ts` 全扫 `Decoration.replace`）：

- **29 个实际站点**，归入 `src/preview/` 的 5 个文件（`livePreview.ts` 21、`lists.ts` 4、`math.ts` 2、`callout.ts` 1、`mermaid.ts` 1）。
- 形态不止「带 widget 的替换」：`Decoration.replace({})` 的纯隐藏占 9 个站点，`block: true`
  的块级替换 3 个，`widget` 为工厂调用（`buildWikiEmbedWidget`）1 个，`widget` 为简写属性
  （表格空 cell）1 个——只扫 `widget: new` 会漏掉近三分之一。
- 同一函数内的多个站点承担不同责任：`collectSyntaxDecorations` 的四处隐藏分别是标题定界符、
  强调定界符、标准链接的 `](target)`、角括号自动链接；`ListLayout.build` 的四处分别是真列表
  marker、续行缩进、裸 marker 编辑态、setext 屏蔽。按「函数名 + widget 类」粗分会把不同显露 /
  指针策略压成一条，注册表就退化成登记表抄写。

责任面盘点同时暴露了三类**必须如实登记、不能按直觉写**的现状（本 change 只登记，不改）：

1. **恒渲染**：表格的管道 / 对齐空白 / 分隔行、真列表项的 marker 与续行缩进、标准图片、
   wikilink 嵌入图片与全部附件提示，都不随选区显露源码；其中 `buildWikilink` 的 embed 分支
   先于 `revealSource` 返回，所以嵌入图片与提示在光标进入时仍是 widget。
2. **选区显露有三种口径**：行级（标题行取含端点相接、引用 / 分隔线取严格重叠）、范围级
   （强调范围含端点相接）、节点级（标准链接 / 角括号自动链接严格重叠），外加裸 marker 行
   与 setext 屏蔽的「行相接」编辑态门控——都出自 `reveal-gate.ts` 与 `lists.ts`，但消费者
   不是同一个谓词。
3. **原生编辑只有一处实现**：`src/editor.ts` 的 `absorbNativeEdit` 只读 `EditorState`，不识别
   widget 类型、不读 DOM 形状；`src/preview/**` 里没有任何 `beforeinput` 监听。注册表必须把
   这条「唯一实现」写成可核判据，防止有人给新 widget 补一份局部闸门。

## What Changes

1. **新增静态注册表测试** `tests/unit/replace-widget-registry.test.ts`：
   - 扫描 `src/**/*.ts` 的全部 `Decoration.replace(...)` 调用，按
     `(file, owner, widget 类 / null, inline|block, 组内出现序号)` 定位每个站点；
   - 每个站点 MUST 在 `REGISTRY` 里恰好有一条登记；登记条目在源码里找不到（改名 / 删除 /
     换序后的僵尸条目）同样判红；
   - 每条登记七项责任：inline/block、显露策略、指针/只读策略、原生编辑策略、几何写入者、
     IME 策略、测试指针；策略值取受控词表，锚点（代码符号 / CSS 选择器）与测试文件路径
     MUST 在仓库里当下可解析；
   - 反向断言单一实现：所有条目的原生编辑策略 MUST 指向 `src/editor.ts` 的 `absorbNativeEdit`，
     `src/preview/**` MUST NOT 出现 `beforeinput` 监听；`Decoration.replace` MUST NOT 被别名
     引用（别名会让静态扫描失明）。
2. **新增合同文档** `docs/specs/replace-widget-contracts.md`：自然语言版本的适用面、不变量
   R1–R5、29 条清单（人读表）与证伪方式；测试文件是机器判据的真源。
3. **新增 spec delta**（`editor-live-preview`，ADDED requirement）：把「新增 replace 构造
   先登记、注册表与源码双向对账、注册表只分配责任不复制运行时实现」写成可证伪的不变量。
4. **登记册维护约定**：`tests/unit/README.md` 的覆盖表补一行；注册表条目按站点序号定位，
   同组内插入 / 删除 / 换序会判红，要求在同一 change 内重新登记——这是闸门而不是噪音。

## Non-goals

- **不改任何运行时行为**：不重构 `livePreview.ts` / `lists.ts` / `math.ts` / `mermaid.ts` /
  `attachments.ts` / `callout.ts` / `frontmatter.ts`，不新增装饰、不改显露判据、不改指针监听。
- **不复制运行时闸门**：注册表是静态数据 + 测试，不提供 `shouldReveal()` / `handleNativeEdit()`
  之类的第二套运行时分派；原生编辑仍只走 `absorbNativeEdit`。
- **不新增依赖**：扫描复用已有 `typescript` 与 `node:test` / `node:assert`。
- **不证明运行时正确**：注册表只分配责任；行为正确性由各条目「测试指针」指向的既有单测 /
  视觉场景 / 验收场景承担，本 change 不新增行为断言。
- 不动视觉基线、不跑真机、不改真实 vault、不做归档 / merge / push。
- 不把「未登记即红」扩到 `Decoration.mark` / `Decoration.line` / `Decoration.widget`——
  它们没有「整段源码消失」这一层责任，混进来会让注册表失去焦点。

## Impact

- **新增**：`tests/unit/replace-widget-registry.test.ts`、
  `docs/specs/replace-widget-contracts.md`、本 change 的 proposal / tasks / delta。
- **修改**：`tests/unit/README.md`（覆盖表一行）。
- **规格**：`editor-live-preview` 新增一条 requirement（ADDED），不改既有 requirement。
- **运行时 / 视觉**：零改动；`pnpm test`、`scripts/gate.sh quick`、`docs-check`、
  `validate --all --strict` 为本 change 的机器验收面。
- **维护成本**：新增或移动 replace 站点时需同步注册表；这是刻意的准入成本，不是漏判。
