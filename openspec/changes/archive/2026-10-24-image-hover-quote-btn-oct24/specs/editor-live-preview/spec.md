# editor-live-preview 增量规格（M670）

> 起草注记（非规格正文）：一条 ADDED，基线是 living spec
> [openspec/specs/editor-live-preview/spec.md](../../../../../specs/editor-live-preview/spec.md)。
> 与既有「块级复制触发钮」条款的关系：那条定的是**表格与代码块**两个消费者；图片引用钮
> （change `add-image-quote-to-chat`，尚未归档）是共享形态类的第五个消费者，它的浮现判据此前只写在
> 那份活跃 change 的 `harness` delta 里（「悬停其可视盒时浮现」一句）。本规格把**可见性双向**这一层
> 独立钉住：它判的不是「有没有这颗钮」，而是「钮的在场必须由指针的当前命中决定」。

## ADDED Requirements

### Requirement: 图片引用钮的可见性双向跟随指针

对任意已渲染出 `<img>` 的图片引用（标准 Markdown `![alt](target)` 与 Obsidian 方言
`![[target]]` 两种形态），图片引用钮的可见性 SHALL 双向跟随指针：

- 指针进入该图片的**挂载盒**（贴住图片自身宽度的 `.cm-lp-image-box`）时，钮 SHALL 在该盒处于
  悬停态的同一拍内变为可见（`opacity: 1`、`visibility: visible`）；
- 指针离开该盒时，钮 SHALL 在淡出过渡结束后回到静止态——不可见、不占位、不进读屏树、
  不可聚焦、不接收指针。

可见性 SHALL 由指针的**当前命中**决定，MUST NOT 依赖「指针曾经到过」的历史状态：指针在盒外时，
钮 MUST NOT 仍处于可见态或仍在读屏树里。

判据 SHALL 分三态读（静止态 / 悬停态 / 指针移开后），MUST NOT 只读悬停态——只读悬停态无法
区分「本次悬停让钮出现」与「钮从更早的悬停一直亮着」（后者在指针的移动事件整批不投递时成立，
是实测过的假绿形态，见 change `image-hover-quote-btn-oct24` 的 design D2）。

本条款不改变既有形态口径：静止态零足迹、形态来自共享类 `.lumir-block-trigger`、位置 class 只承担
偏移（`.lumir-image-quote-trigger` 贴图片右下角内侧），均由既有条款与视觉场景负责。

#### Scenario: 位图的三态读数

- **WHEN** 打开一份含已渲染位图引用的文档，依次读取静止态、指针进入图片挂载盒后、指针离开该盒后
  三个时点的钮状态（计算样式 + 读屏树在场性）
- **THEN** 静止态钮不可见且不在读屏树；指针进入后钮可见且带读屏名（「摘录到对话」D370）；
  指针离开后钮重新不可见、不在读屏树

#### Scenario: svg 的三态读数

- **WHEN** 对文档里一张渲染为 `<img>` 的 svg 引用重复同一组三个时点的读数
- **THEN** 三个时点的读数与位图那张逐项同形（svg 与位图在预览层是同一条渲染路径，钮的形态与
  出现时机 MUST NOT 按扩展名分叉）

#### Scenario: 占位与加载态的负向（既有条款的配对正观测）

- **WHEN** 同一文档里另有一张读取失败的引用（占位块，没有 `<img>`），指针悬停该占位
- **THEN** 它没有引用钮；同文档里三张终态图片各有一颗钮——「没有钮」不是选择器写错的结果
