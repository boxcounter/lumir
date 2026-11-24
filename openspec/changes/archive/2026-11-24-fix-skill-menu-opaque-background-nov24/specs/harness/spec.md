# harness 增量规格

> 起草注记（非规格正文）：本 change 只新增一条 requirement，把 Skill 候选浮层的**表面**写成
> 可证伪的不变量；既有「Skill 支持」「Skill 的混合调用与入口策略」两条不动。根因、判据设计
> 与真机复验计划见 [design.md](../../design.md)。

## ADDED Requirements

### Requirement: Skill 候选浮层的表面不变量

harness composer 的 Skill 候选浮层 SHALL 是不透底的浮层面：其计算后的 `background-color` SHALL
等于当前主题的 `--preview-bg`，alpha SHALL 为 1。该表面 SHALL 按 `ui-design-system`「设计 token
层」的浮层壳配方（`--preview-bg` + 1px `--border` + `--shadow-raise`）取值，MUST NOT 引用未登记
的 token、MUST NOT 以**失效声明回落成 transparent** 或半透明底落空——「浮层在内容之上」必须在
绘制结果上成立，MUST NOT 只体现为 `z-index`。

判据 SHALL 落在**绘制结果**上：在浮层可见面（圆角与 1px 边框之内）内，浮层背后画了什么 MUST NOT
影响该区域的像素；三主题（light / dark / eink）SHALL 各判一次。

#### Scenario: 三主题下浮层底色等于 --preview-bg

- **WHEN** 打开 Skill 候选浮层，当前主题分别为 light、dark、eink
- **THEN** 浮层计算后的 `background-color` 等于该主题 `--preview-bg` 的值（light `#ffffff` /
  dark `#26272b` / eink `#ffffff`），且 alpha = 1

#### Scenario: 底层文字不穿透

- **WHEN** 在候选浮层背后铺一层高对比文字与底色，再换成另一套高对比配色
- **THEN** 浮层可见面的像素两次逐字节相同（背后内容不进入浮层）；把浮层背景强制改为
  `transparent` 时，同一对比 SHALL 出现差异——判据本身必须有区分度
