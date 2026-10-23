# multi-tabs 增量规格

> 起草注记（非规格正文）：本 delta 一条 ADDED。vault 外只读标签的**语义**由 change
> `quick-open-file-oct23` 的 `multi-tabs` 增量定义（尚未归档：恒为结构性只读、不入持久化、不阻止切换）；
> 本条款只补**可见标记**的形态（图形化），与那条不冲突，归档顺序无关。文案侧对应条目 D579
> （读屏名）；旧的可见文字后缀条目 D578 已按「变更默认直接切断」删除、编号不复用。
> 机器判据在 `tests/visual/scenes/quick-open.spec.ts` 的 M660 #7 用例与 `tests/unit/tabs.test.ts`。

## ADDED Requirements

### Requirement: vault 外只读标签的可见标记

vault 外只读标签（`session.external`）的可见标记 SHALL 是一枚小型锁形图标，MUST NOT 用文字后缀
（如「· 只读」）：图标取既有细线 SVG 工艺（10×10、`currentColor`、1.3px 描边），带 `aria-hidden`，
排在文件名之前；可见标签文字 SHALL 只有文件名。只读语义对读屏用户 SHALL 由按钮的可访问名承担
（`{名称}（vault 外只读）`），MUST NOT 依赖图标传达——图形不会自动进入可访问名。判据 SHALL 是
`session.external`：vault 内标签 MUST NOT 出现该图标。图标 MUST NOT 引入新 token / 色值 / 字号
（颜色取既有 `--text-2`，三主题由 token 体系覆盖）。

#### Scenario: 只读标签的可见标记

- **WHEN** 通过快速打开打开一个 vault 外绝对路径
- **THEN** 该标签可见文字只有文件名，文件名前有一枚 `aria-hidden` 的锁形图标；按钮的可访问名仍是 `{名称}（vault 外只读）`，悬停提示仍是完整绝对路径

#### Scenario: vault 内标签没有该图标

- **WHEN** 打开一个 vault 内文件
- **THEN** 它的标签不出现锁形图标（负向对照：判据不是「所有标签」）
