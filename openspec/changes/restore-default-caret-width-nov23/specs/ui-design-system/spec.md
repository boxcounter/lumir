# ui-design-system Specification Delta

> 起草注记（非规格正文）：本 delta 只改「编辑器光标视觉」一条 requirement，MODIFIED 块按 living spec
> 整条正文复制再改（`openspec archive` 对 MODIFIED 是整块替换，少抄的段落会在归档时静默消失）。
> 机制与取舍见 [design.md](../../design.md)，裁决留痕见 [proposal.md](../../proposal.md)。

## MODIFIED Requirements

### Requirement: 编辑器光标视觉（粗细 / 颜色 / 闪烁）

编辑器光标 SHALL 以**实心竖线**呈现，材质沿用 CodeMirror 基础主题的默认值：宽度 `1.2px`、以
`marginLeft: -0.6px` 相对插入点居中（两者都取 CM 基础主题的既有值——`border-left: 1.2px` 与
`margin-left: -0.6px`；本仓 MUST NOT 再写宽度或居中覆盖）。颜色 SHALL 取 `--text`（三主题取值以
`docs/specs/design-tokens-v1.md` 的 `--text` 行为准）——颜色是唯一保留的覆盖项，MUST NOT 跟随
CM 默认的 `black`（dark 主题下黑线不可见）。光标层 SHALL 以约 `1.2s` 周期闪烁（CM 原生
`steps(1)` 动画，半程 `opacity: 0`；周期取 `EditorView.cursorBlinkRate` 的默认值）；闪烁是
光标可发现性的核心信号——光标 MUST NOT 在聚焦期间常亮不动。选区变化 MUST 重启动画相位：
光标移动后 MUST 立即可见，MUST NOT 停在「灭」相位直到下一个周期。该口径 SHALL 对 md 与
code 两种模式、三个主题一致；eink 下同为 1.2px 黑色并同样闪烁（eink 没有颜色，可发现性由
闪烁承担，线宽回到 2026-10-23 之前的默认档；1.2px 与 1px hairline 的 0.2px 宽度差 MUST NOT
被当作 eink 的可辨识判据）。光标 MUST NOT 改变文字排版、行盒高度或容器几何
（`drawSelection` 的绝对定位层不参与布局）；编辑器未聚焦时光标 MUST NOT 显示。

> 改裁记录（三次，按时间序）：
> ① 2026-10-23（change `cursor-visibility-oct23`，D2）：Alex 反馈光标太细，应用从「只覆盖颜色」
> 改为 2px 宽度 + `-1px` 居中，该档保留至 2026-11-23。
> ② 2026-10-24：Alex 反馈 #6 原话「光标可见性调地有些过头了 —— 现在光标不闪了，也不容易一眼
> 扫到」⇒ D2 改判为 B：保留 2px 宽度与 `--text` 颜色，恢复 1.2s 闪烁。
> ③ 2026-11-23（本 change）：Alex 裁决「按推荐」——**推翻 2026-10-23 的 2px 加粗**，light /
> dark / eink 三档统一恢复 CM 默认的 1.2px 宽度与 `-0.6px` 居中；颜色 `--text` 与 1.2s 闪烁
> 两项增益保留。宽度不是新的组件常量，`docs/specs/design-tokens-v1.md` 的组件常量登记随之撤销。
> 后续 MUST NOT 以「再粗一点更显眼」为由回改 2px；确需变更时走新的裁决并同时改本条与本记录。

#### Scenario: 三主题下的光标计算样式

- **WHEN** 编辑器聚焦、光标停在正文行，分别取 light / dark / eink 三主题的
  `getComputedStyle(.cm-cursor-primary)`、匹配该元素的 CSSOM 声明与 `.cm-cursorLayer` 的动画读数
- **THEN** 级联里匹配光标的 `border-left-width` 声明恰好一条、值为 `1.2px`（CM 基础主题；
  本仓主题规则不声明宽度或居中）、`marginLeft` 计算值为 `-0.6px`、颜色等于该主题 `--text` 的
  计算值；`borderLeftWidth` 的计算值落在 `1px` / `1.2px` 档（渲染引擎按整数 CSS 像素取整，
  Chromium DPR=1 下读回 `1px`）且 MUST NOT 为 `2px`；`.cm-cursorLayer` 的 `animationName`
  为 `cm-blink` / `cm-blink2`（CM 原生闪烁，不是 `none`）、`animation-duration` 为 `1.2s`
  且无限循环、动画处于运行态；三主题的宽度与闪烁口径一致

#### Scenario: 宽度覆盖已移除（反向判据）

- **WHEN** 读取任一主题下匹配 `.cm-cursor-primary` 的 `border-left-width` 声明、`marginLeft`
  计算值与 `borderLeftWidth` 计算值
- **THEN** 声明列表恰为 `["1.2px"]`、`marginLeft` 为 `-0.6px`；`borderLeftWidth` 的计算值
  MUST NOT 为 `2px`、`marginLeft` MUST NOT 为 `-1px`——这两个值一旦回潮，本场景必红
  （区分度对照：2026-10-23 至 2026-11-23 的实现正是这两个值，且其 2px 声明会出现在声明列表里）

#### Scenario: 闪烁的亮 / 灭相位真实交替

- **WHEN** 编辑器聚焦后把光标层的动画暂停在周期起点（0ms）与中点之后（700ms），分别读
  `getComputedStyle(.cm-cursorLayer).opacity`
- **THEN** 0ms 处为 `1`（光标可见）、700ms 处为 `0`（光标不可见）；恢复播放后闪烁照常继续。
  区分度对照：M654 的「常亮」实现没有可暂停的动画（`animationName = none`），本场景的
  相位读数无从取得，判 FAIL

#### Scenario: eink 下闪烁且宽度可辨

- **WHEN** eink 主题下聚焦编辑器
- **THEN** 光标为 1.2px 纯黑实心竖线，并以约 1.2s 周期闪烁；不引入灰度档或彩色。「可辨」
  在本档由闪烁承担：线宽与 1px hairline（结构线）只差 0.2px，本场景 MUST NOT 以「肉眼可分辨
  宽度」为断言——线宽观感归真机 dogfood 手感项

#### Scenario: 非聚焦不显示光标

- **WHEN** 编辑器失去焦点（焦点在文件树 / 浮层 / composer）
- **THEN** `.cm-cursor` 不显示（`display: none` 的既有口径）；闪烁口径 MUST NOT 让失焦状态
  出现残留光标
