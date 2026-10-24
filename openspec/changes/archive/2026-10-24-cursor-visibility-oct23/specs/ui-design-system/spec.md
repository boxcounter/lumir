## ADDED Requirements

### Requirement: 编辑器光标视觉（粗细 / 颜色 / 闪烁）

编辑器光标 SHALL 以**实心竖线**呈现：宽度取组件常量 `2px`（登记在
`docs/specs/design-tokens-v1.md` 的「阴影与 hairline」节，不新增颜色或字号 token），
颜色取 `--text`（三主题取值以 `docs/specs/design-tokens-v1.md` 的 `--text` 行为准），并 MUST 以
`marginLeft: -1px` 使竖线相对插入点居中。光标层 SHALL 以约 `1.2s` 周期闪烁（CM 原生
`steps(1)` 动画，半程 `opacity: 0`；周期取 `EditorView.cursorBlinkRate` 的默认值）；闪烁是
光标可发现性的核心信号——光标 MUST NOT 在聚焦期间常亮不动。选区变化 MUST 重启动画相位：
光标移动后 MUST 立即可见，MUST NOT 停在「灭」相位直到下一个周期。该口径 SHALL 对 md 与
code 两种模式、
三个主题一致；eink 下同为 2px 黑色并同样闪烁（eink 没有颜色，线宽是它唯一的强调手段，
见 tokens 文档规则⑧；2px 引用块竖线是既有先例；该档闪烁的残影风险登记在 change design
§3.5，归真机 dogfood 手感项）。光标 MUST NOT 改变文字排版、行盒高度或容器几何
（`drawSelection` 的绝对定位层不参与布局）；编辑器未聚焦时光标 MUST NOT 显示。

> 改裁记录（2026-10-24）：M654 曾按原 D2=A 落地「2px 常亮（无闪烁）」。Alex 2026-10-24
> 反馈 #6 原话「光标可见性调地有些过头了 —— 现在光标不闪了，也不容易一眼扫到」⇒ D2 改判为
> B：保留 2px 宽度与 `--text` 颜色，**恢复 1.2s 闪烁**。宽度 / 颜色 / 居中的取值不变。

#### Scenario: 三主题下的光标计算样式

- **WHEN** 编辑器聚焦、光标停在正文行，分别取 light / dark / eink 三主题的
  `getComputedStyle(.cm-cursor)` 与 `.cm-cursorLayer` 的动画读数
- **THEN** `borderLeftWidth` 为 `2px`、`marginLeft` 为 `-1px`、颜色等于该主题 `--text` 的
  计算值；`.cm-cursorLayer` 的 `animationName` 为 `cm-blink` / `cm-blink2`（CM 原生闪烁，
  不是 `none`）、`animation-duration` 为 `1.2s` 且无限循环、动画处于运行态；三主题的宽度与
  闪烁口径一致

#### Scenario: 闪烁的亮 / 灭相位真实交替

- **WHEN** 编辑器聚焦后把光标层的动画暂停在周期起点（0ms）与中点之后（700ms），分别读
  `getComputedStyle(.cm-cursorLayer).opacity`
- **THEN** 0ms 处为 `1`（光标可见）、700ms 处为 `0`（光标不可见）；恢复播放后闪烁照常继续。
  区分度对照：M654 的「常亮」实现没有可暂停的动画（`animationName = none`），本场景的
  相位读数无从取得，判 FAIL

#### Scenario: eink 下闪烁且宽度可辨

- **WHEN** eink 主题下聚焦编辑器
- **THEN** 光标为 2px 纯黑实心竖线，并以约 1.2s 周期闪烁；与 1px hairline（结构线）在宽度上
  可区分，不引入任何灰度或颜色

#### Scenario: 非聚焦不显示光标

- **WHEN** 编辑器失去焦点（焦点在文件树 / 浮层 / composer）
- **THEN** `.cm-cursor` 不显示（`display: none` 的既有口径）；闪烁口径 MUST NOT 让失焦状态
  出现残留光标
