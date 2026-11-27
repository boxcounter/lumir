## ADDED Requirements

### Requirement: replace 装饰构造的责任登记

凡在 `src/**/*.ts` 中创建 `Decoration.replace(...)`（含纯隐藏 `{}`、带 `widget` 的替换、
`block: true` 的块级替换、`widget` 为工厂调用或简写属性的形态）的构造，SHALL 先在
`tests/unit/replace-widget-registry.test.ts` 的 `REGISTRY` 中登记为一条责任，并同时声明：

- **span**：`inline` 或 `block`（MUST 与调用处的 `block: true` 相符）；
- **显露策略**：渲染态何时撤下替换、显示源码，或明确声明「恒渲染、不显露」；
- **指针 / 只读策略**：点击落在 widget 上时进入源码、跟随链接、打开图片，还是不消费；
  只读会话下的行为（同样进入 / 恢复原选区 / 不消费）；
- **原生编辑策略**：MUST 指向共享 state 闸门（`src/editor.ts` 的 `absorbNativeEdit`），
  MUST NOT 声明某个 replace 构造自己的 `beforeinput` / DOM 回读实现；
- **几何写入者**：承担该构造纵向 / 横向几何的模块或样式规则；
- **IME 策略**：组合期由共享组合生命周期收口，还是交给编辑器的原生组合路径；
- **测试指针**：至少一个当下存在的单测 / 视觉场景 / 真机验收场景路径。

注册表 SHALL 与源码**双向**对齐：静态扫描到的每个 replace 站点 MUST 恰好对应一条登记；
登记条目在源码中找不到对应站点（改名 / 删除 / 同组内换序后的僵尸条目）同样 MUST 判红。
站点定位 MUST 使用「文件 + 所属函数 + widget 类（纯隐藏为 null）+ inline/block + 同组出现
序号」，MUST NOT 使用行号——行号会随无关改动漂移，序号只在同一构造组内变化，变化即要求
重新登记。登记字段的策略值 SHALL 取自受控词表；每个字段的锚点（代码符号、CSS 选择器、
测试路径）MUST 在仓库里当下可解析，锚点失效即判红。

注册表只分配责任，MUST NOT 成为第二套运行时实现：它 MUST NOT 提供显露判定、指针分派、
原生编辑接管或 IME 收口的可执行替代；运行时行为仍只由 `reveal-gate.ts`、各构造的既有监听、
`absorbNativeEdit` 与共享组合生命周期承担。新增 replace 构造 SHALL 在同一变更内先登记、
再实现；MUST NOT 先加构造等评审发现问题。`Decoration.replace` MUST NOT 被别名引用
（`const replace = Decoration.replace` / 解构等），否则静态扫描失明，判据随之失效。

本条不证明运行时行为正确——它只保证每个构造的七项责任被显式分配、且「新构造」不能再绕过
准入面；行为正确性由各条目的测试指针与既有门禁承担。

#### Scenario: 新增未登记的 replace 构造判红

- **WHEN** 在 `src/preview/` 新增一个 `Decoration.replace({ widget: new TagWidget() })`（或纯隐藏
  `Decoration.replace({})`），未在注册表登记
- **THEN** `pnpm test` 的 `replace-widget-registry` 用例判红，指名该站点的文件、所属函数、
  widget 类与 span；把它登记并写清七项责任后转绿

#### Scenario: 删除 / 改名后的僵尸条目判红

- **WHEN** 删除一个 replace 构造，或把 `widget` 类改名 / 把纯隐藏改成 widget 替换，而注册表
  仍保留原条目
- **THEN** 用例判红并指名僵尸条目的 id 与它在源码里已不存在的定位键

#### Scenario: 同组站点序号漂移判红

- **WHEN** 在 `collectSyntaxDecorations` 的隐藏站点之间插入一个新的 `Decoration.replace({})`
  （同一文件、同一函数、同一 widget 类、同一 span）
- **THEN** 后续站点的序号整体后移，用例判红并指出哪些登记条目对不上；重新登记（含新条目）
  后转绿。MUST NOT 用行号定位来消除这条红——序号变化正是「新构造进入准入面」的信号

#### Scenario: 责任字段或测试指针失效判红

- **WHEN** 登记条目的显露锚点函数被改名、几何选择器被删除，或测试指针指向的文件已不存在
- **THEN** 用例判红并指名该条目的字段与失效锚点；更新锚点 / 指针后转绿

#### Scenario: 单实现防线

- **WHEN** 给某个 replace widget 单独加 `beforeinput` 监听（或把 `Decoration.replace` 赋给
  局部别名以绕开扫描），或某条登记把原生编辑策略写成共享闸门之外的实现
- **THEN** 用例判红：`src/preview/**` MUST NOT 出现 `beforeinput`；所有条目的原生编辑策略
  MUST 指向 `absorbNativeEdit`；`Decoration.replace` MUST NOT 出现在非调用位置
