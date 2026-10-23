## ADDED Requirements

### Requirement: 编辑器光标视觉（粗细 / 颜色 / 闪烁）

编辑器光标 SHALL 以**实心竖线**呈现：宽度取组件常量 `2px`（登记在
`docs/specs/design-tokens-v1.md` 的「阴影与 hairline」节，不新增颜色或字号 token），
颜色取 `--text`（三主题取值以 `docs/specs/design-tokens-v1.md` 的 `--text` 行为准），并 MUST 以
`marginLeft: -1px` 使竖线相对插入点居中。光标层的闪烁 SHALL 关闭（`.cm-cursorLayer` 无
动画）：光标在编辑器聚焦期间常亮，MUST NOT 以半程 opacity 0 的闪烁降低可发现性。该口径
SHALL 对 md 与 code 两种模式、三个主题一致；eink 下同为 2px 黑色常亮（eink 没有颜色，
线宽是它唯一的强调手段，见 tokens 文档规则⑧；2px 引用块竖线是既有先例）。光标 MUST NOT
改变文字排版、行盒高度或容器几何（`drawSelection` 的绝对定位层不参与布局）；编辑器未聚焦
时光标 MUST NOT 显示。

#### Scenario: 三主题下的光标计算样式

- **WHEN** 编辑器聚焦、光标停在正文行，分别取 light / dark / eink 三主题的
  `getComputedStyle(.cm-cursor)`
- **THEN** `borderLeftWidth` 为 `2px`、`marginLeft` 为 `-1px`、颜色等于该主题 `--text` 的
  计算值；`.cm-cursorLayer` 的 `animationName` 为 `none`；三主题的宽度与闪烁口径一致

#### Scenario: eink 下常亮且宽度可辨

- **WHEN** eink 主题下聚焦编辑器
- **THEN** 光标为 2px 纯黑实心竖线且不闪烁；与 1px hairline（结构线）在宽度上可区分，
  不引入任何灰度或颜色

#### Scenario: 非聚焦不显示光标

- **WHEN** 编辑器失去焦点（焦点在文件树 / 浮层 / composer）
- **THEN** `.cm-cursor` 不显示（`display: none` 的既有口径）；光标常亮口径 MUST NOT 让
  失焦状态出现残留光标
