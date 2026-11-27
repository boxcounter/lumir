## ADDED Requirements

### Requirement: Harness 次级动作的视觉与指针命中区

Harness 的次级图标动作 SHALL 遵守 `docs/specs/pointer-targets.md` 的次级图标动作指针命中区合同。
本条首批消费者是 transcript 的消息复制 / 撤回、composer 引用 / 消息摘录 / 图片卡片的移除 ×，以及图片卡片的 @。
实现 MUST 分离图标视觉尺寸、可见按钮底板与实际指针命中区：实际命中区 SHALL 默认至少为 28×28 CSS px，
受限候选的宽、高 MUST 各自不低于 24 CSS px；不得把图标或紧凑底板的尺寸当成命中尺寸，也不得把 28 写成 W3C 标准。
本 requirement MUST NOT 被实现为触屏式 44px 桌面按钮改造。

复制动作 SHALL 使用无依赖的内联 SVG，视觉视盒约为 14×14 CSS px，MUST NOT 继续依赖字符 `⧉` 的字体造型；
× SHALL 保持约 14px 的紧凑 glyph，@ SHALL 保留既有 mono 视觉层级。撤回 SHALL 保持既有 12px 撤销 SVG 与
20×20 CSS px 可见盒，只扩实际命中层，MUST NOT 恢复文字或改为常驻。复制 / 撤回 SHALL 继续只在消息 hover /
动作 focus-visible 等既有路径显现，MUST NOT 变为常驻动作条；图片 @ / × SHALL 继续恒显。可见底板保持轻量，
命中区扩大 MUST NOT 同步放大成视觉大按钮。撤回的 pointer / focus 双激活源预览、tail notice 在场时整段不预览、
完整后果提示与既有后端拒绝语义 MUST NOT 因命中区扩大而改变。

所有相关状态下的实际命中区 MUST 满足：相邻动作的命中矩形无正面积交集；在元素完整可见的稳态下不被祖先裁切、
不越过容器形成不可达区域；不截获正文、摘录、出处或其他既有内容区域的指针操作。复制 success 文案变宽、语言切换、
撤回 disabled 与 focus 状态也属于同一几何合同，撤回动作层 SHALL 在需要时同步让位，且不得推挤消息 / 文档布局。
hover / focus / 显现 / 消退 MUST NOT 改变消息行高、文档文本、composer 精确 anchor、卡片块序、选区或 history。

嵌套在可点击引用 / 消息摘录卡片内的 ×，其整个命中区 SHALL 只执行一次移除并阻止父卡跳转；中心与透明边缘同权。
父卡自身的大面积 MUST NOT 计作 × 的命中区，命中区之外的父卡 SHALL 保持既有跳回行为。图片 @ / × 的整个命中区
SHALL 各自只执行一次插入引用 / 移除，不得互相串发或改变既有选区、编号反查与焦点语义。

全部动作 SHALL 保留既有 accessible name；icon-only 动作 MUST 有可访问名，inline SVG MUST NOT 另产独立读屏控件。
复制源、复制成功反馈与约 1.5s 消退、撤回可用性 / disabled 提示、@ 的 `Image N` 插入行为均保持不变。
复制 / 撤回的既有键盘路径不变；composer 卡片及其 @ / × SHALL 继续遵守既有 `tabIndex=-1` 与 CodeMirror 键盘模型，
MUST NOT 因本条款新增 Tab 停靠点或接管文本编辑按键。

#### Scenario: 消息动作的三层尺寸与状态几何

- **WHEN** 在最后一条用户消息与一条 agent 消息上分别检查复制 / 撤回的正常、hover、focus-visible、disabled、success
  与 zh / en 状态，并读取真实矩形和命中结果
- **THEN** 实际命中区默认达到 28×28 CSS px（含 success 完整文案的复制动作可更宽），任何方向不小于 24；复制 SVG 保持小巧，
  可见底板不变为触屏式大按钮；复制 / 撤回仍只在既有 hover / focus 路径显现，消息行高与正文布局不变
- **AND** 复制 success 显示完整既有文案期间，撤回命中区同步让位，两者无交集；反馈约 1.5s 消退后几何恢复，
  disabled 撤回不执行动作

#### Scenario: composer 动作槽不重叠且不遮内容

- **WHEN** composer 分别含引用 / 消息摘录卡与带 @ + × 的图片卡，在默认 / 窄 pane 和相关缩放档读取动作与内容几何
- **THEN** 每个 × 与 @ 的实际命中区默认达到 28×28 CSS px，@ / × 之间无正面积交集；动作区不被祖先裁切，
  不与可见摘录、出处、正文或其他既有内容矩形相交，卡片块序与 composer 文档 / 选区 / history 不变

#### Scenario: 引用卡 × 的中心与透明边缘不触发父卡

- **WHEN** 用真实指针分别点击引用 / 消息摘录卡 × 的中心、四边内侧与近角透明扩展，再点击紧邻命中区之外的父卡
- **THEN** 每次点击 × 只移除对应卡片一次，父卡跳回处理器零调用；点击命中区之外的父卡才执行既有跳回原文 / 来源消息，
  不把父卡面积当作 × 的命中区

#### Scenario: 图片 @ 与 × 的真实命中互不串发

- **WHEN** 用真实指针点击图片 @ 与 × 的中心及相邻透明边缘
- **THEN** @ 只在当前文本选区插入一次正确的 `Image N`，× 只移除对应图片一次；两者不互相触发，
  既有选区、编号反查与焦点语义不变

#### Scenario: 可访问名与 composer 键盘模型保持

- **WHEN** 读屏读取复制、撤回、@、× 与 composer 子树，并用键盘经过复制 / 撤回和 composer
- **THEN** 全部动作保留既有 accessible name，复制内联 SVG 不另产读屏控件；复制 / 撤回有既有 focus-visible 路径，
  composer 卡片及 @ / × 仍为 `tabIndex=-1`，Enter、IME、Backspace / Delete、⌘A、⌘C 与 history 行为不变

#### Scenario: 机器判据验证真实几何与命中

- **WHEN** 为本条新增或修改自动化断言
- **THEN** 断言使用真实矩形与 `document.elementFromPoint()` 或等效方法检查中心、边缘、相邻隔离、裁切与内容保护，
  并通过真实指针事件核对动作 / 父卡副作用；只读取 CSS 声明 MUST NOT 被判为命中 PASS
- **AND** 每条断言分别以尺寸回退、相邻重叠、祖先裁切、正文覆盖或事件隔离失效等必红输入实测 FAIL，
  恢复后实测 PASS，红 / 绿证据分别留存
