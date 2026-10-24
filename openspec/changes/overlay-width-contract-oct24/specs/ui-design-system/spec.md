## ADDED Requirements

### Requirement: 浮层宽度分档与可读宽度注册表

浮层类弹出物（`docs/specs/overlay-visibility.md` 的适用面）的宽度 SHALL 由**内容**决定，并归入且仅归入下列三档之一：
C 紧凑档（单行定长内容）、L 单行列表档（逐行单行、放不下才截断）、P 说明折行档（多行文字换行而不截断）。
档位按**内容类别**分配，MUST NOT 按组件分配。宽度公式 SHALL 是
`clamp(内容固有宽, 档位下限, min(档位上限, 宿主可用宽 − 2×inset))`：内容短时 MUST NOT 被拉伸到超过
`max(内容固有宽, 下限)`，内容长时 MUST NOT 用与内容无关的定值把它挤窄。**列表类浮层**例外：宽度 SHALL 取
约定宽（em 上限 + 视口 / pane 夹取），MUST NOT 随逐帧内容抖动。

宽度上限 SHALL 用 `em`（相对浮层自身 font-size）表达的前提是**该浮层的文字随字号缩放**（本仓即
`--lumir-hp-scale`，由编辑器字号驱动）：这类浮层 MUST NOT 用写死的 px 同时承载「短内容不空旷」与
「放大档不折行」两个目标。不随字号缩放的浮层（编辑器 chrome 的输入面 / 菜单）SHALL 用
`min(<约定宽>, <视口或宿主相对宽>)` 这类相对形式，MUST NOT 只写一个裸 px 宽。

「可用区」SHALL 是浮层**所属 pane** 的矩形（harness 浮层）或视口（`position: fixed` 且包含块不落在裁切
祖先里的浮层），统一扣两侧 inset（8px）。浮层需要横向移位时，SHALL 在「左缘对锚点左缘」与「右缘对锚点
右缘」两侧里选**位移最小**者（换边优先于长距平移）；组件的默认锚定边只在位移相同时生效。收窄、换边、平移
MUST 收敛在一处实现，消费者 MUST NOT 各写一份。

单行截断 SHALL 保住内容的身份主体：路径 MUST 保持**文件名完整**（目录前缀可中段省略），标题保开头，
模型 / 会话名保全名；被截断的条目 MUST 提供 `title`（或等价的可达全文通道）。路径类文本 MUST 采用
仓内既有的「文件名恒完整、中间目录折叠」口径（M606），MUST NOT 另写一套「从尾部截断整串」的实现；
列表行需要同名文件消歧时 MAY 保留目录前缀的可见能力（目录前缀先于文件名收缩），文件名 MUST NOT 被
先裁。带动作提示的行（如快速打开的直接打开行）MUST 让**动作前缀 / 模板尾串先于文件名收缩**：正常
可用宽度下文件名完整，动作提示 MAY 出省略号。

打开态的浮层在所属 pane 或视口尺寸变化后（拖分隔条 / 窗口缩放）SHALL 重夹到新的可用区，MUST NOT 停在
越界位置。

归挡结果 SHALL 登记在可执行注册表（`tests/unit/overlay-width-registry.test.ts`）里，注册表是本条的机器
判据，MUST 与源码**双向**对齐：`src/style.css` / `src/harness-panel.css` 里凡同时声明 `position:
absolute|fixed` 与浮层 elevation 配方（`box-shadow: var(--shadow-raise)`）的选择器，未登记即判红；注册表
条目在源码里已不存在同样判红。同一判据 SHALL 按档位核验声明本身：L / P 档 MUST NOT 持有裸 px 的 `width`；
文字随字号缩放的条目 MUST 持有 `em` 上限；每条目 MUST 持有至少一条宽度声明（`width` / `min-width` /
`max-width`）。新增浮层 SHALL 在同一变更内先归挡、再写宽度，MUST NOT 先给定值等评审发现。

已健康的既有反例（指针菜单的内容驱动 160–280、删除确认的 `min(440px, 100%)`、键位面板的 `100%` +
`max-width: 680px`、代码块全屏内容的 `max-content` + `max-width: 100%`）归登记表的豁免档，本要求 MUST NOT
迫使它们改形态；但它们的宽度声明形式同样受注册表守护（漂移即红）。

#### Scenario: 长路径在 ⌘P 列表里保住文件名

- **WHEN** vault 里存在一条 60 字符以上的深层路径（`areas/work/clients/acme/2026/q4/meetings/…-final-v2.md`），
  用户在快速打开浮层里输入能命中它的查询串
- **THEN** 行的目录前缀在放不下时中段省略，**文件名整段可见**（不被尾部省略号吃掉），行元素带
  `title` 全路径；浮层宽度不超过 `min(26em, 视口 − 28px)` 且不随输入抖动

#### Scenario: 说明浮层按内容长到可读上限

- **WHEN** harness Context 读数出现长读数（如「已用 112.7k / 131k tokens（86%）」）或越线警示句，用户
  hover 读数；或把编辑器字号放大到 2.13 倍后重复同一动作
- **THEN** 气泡宽度取内容固有宽（不折行），不超过 `34em`（该浮层自身 font-size 的 34 倍）与所属 pane
  可用宽；窄 pane 下先换锚定边、再平移到 pane 内，MUST NOT 越出 pane 被祖先裁掉

#### Scenario: 选择器浮层在放大档与窄 pane 下不越界

- **WHEN** 编辑器字号为 2.13 倍（`--lumir-hp-scale` = 2.13）、harness pane 宽 320px，用户打开合并选择器浮层
- **THEN** 浮层包围盒完整落在 pane 内（左右各留 8px inset），宽度收敛到可用宽；MUST NOT 出现「包围盒越出
  pane、右缘被 `.lumir-harness` 的 `overflow: hidden` 裁掉」的形态

#### Scenario: 分栏拖拽后仍打开的浮层重新夹取

- **WHEN** harness 浮层处于打开态，用户拖动分隔条把 pane 收窄（或放大窗口）
- **THEN** 浮层的宽度与横向位置在同一个交互内重算，包围盒仍完整落在新的 pane / 视口可用区内

#### Scenario: 新增浮层未登记即红

- **WHEN** 往 `src/style.css` 或 `src/harness-panel.css` 新增一个 `position: absolute` + `box-shadow:
  var(--shadow-raise)` 的浮层选择器，而未在宽度注册表登记
- **THEN** `pnpm test` 的 `overlay-width-registry` 用例判红并指名未登记的选择器；把它归挡并按档位写宽度后
  转绿。反向同样成立：注册表条目的选择器在源码里查不到（改名 / 删除）时判红并指名僵尸条目

#### Scenario: 定值宽度回潮判红

- **WHEN** 把某个 L / P 档浮层的宽度改回裸 px 定值（如把 Context 气泡改回 `width: 224px`），或删掉随字号
  缩放条目的 `em` 上限
- **THEN** `overlay-width-registry` 用例判红并指名该选择器与缺失的声明形态——「定值 + 越长越挤」的原始缺陷
  形态不得重新进入源码
