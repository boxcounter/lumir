# Proposal: 内容区域宽度拖拽调整——双侧手柄调阅读栏宽，持久化到 `[ui]` 配置

- Change ID: content-width-drag
- 日期: 2026-09-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 原话（2026-09-25，mission M223 任务书）：「类 DeepSeek Harness 的通过拖拽调整内容区域宽度……
那是我把光标挪上去之后出现的，通过拖拽它可以调整内容区域宽度。」配套裁决：手柄左右缘都放（对称）。

**一、现状栏宽是一条写死的定值。** 阅读栏宽 = 中列 grid 轨道 `minmax(0, var(--layout-doc-measure))`
（`src/editor.ts:1284-1288`），token `--layout-doc-measure: 664px` 只有一处写值（`src/style.css:193`）、
全仓仅编辑区 grid 一个消费者（`rg "layout-doc-measure" src/` 只命中定义与该模板两行）。664px 是**框宽**，
减去正文内边距 `--sp-13`（44px×2）后文字实测宽 576px（`src/editor.ts:1269-1274` 的注释与定稿图
`.doc { max-width:664px; padding:32px 44px 20px }` 逐项一致）。窗口更宽时，两侧余白被
`minmax(24px, 1fr)` 吸收，栏宽不随窗口变——用户没有任何调整手段。

**二、这是「编辑器即阅读表面」（ADR 0006 / typography-and-zoom D1）的自然延伸。** 字号已经有运行期
步进（三条 `view.text-scale-*` 命令，change typography-and-zoom），行长是另一半排版变量：同一字号下，
宽屏上 576px 的文字宽偏窄（见 D2 的行宽依据），窄窗口下半屏的观感又由 grid 下限自动收缩、与 664 无关
——宽度本质上是「上限值」，用户想调的就是这个上限。

**三、宽度的调整面必须落在 CM 的文档 DOM 之外。** 正文列由 `.cm-scroller` 的 grid 轨道给出，任何塞进
`.cm-content` 内外的间距 hack 都会踩 M110 同族教训（CM 按 border-box 量行高、margin 对高度图不可见，
`src/preview/livePreview.ts:734`、`src/style.css:284-288`）。因此手柄是 shell 层的覆盖元素，宽度值经
CSS token 施加——这与 typography 的 `--editor-font-size` 运行期写入是同一条已跑通的路
（`src/typography.ts:136-154` 写 `documentElement` token + `src/editor.ts:1615-1621` 显式
`view.requestMeasure()`）。

## What Changes

1. **新增配置项 `ui.content_width`**（`[ui]` 表，整数 px）：阅读栏宽上限，默认 **664**（= 现行定值，
   默认口径下零视觉变化；Alex 口述的「680」与代码/定稿证据的出入见 D1）。合法区间建议
   **[480, 1200]**（依据见 D2），越界回落默认 + warning，装配链与 `editor.font_size` 完全同路
   （各类型 `impl Default` + 宽容镜像 `#[serde(default)]` + `validate()` 逐字段区间判定，
   `src-tauri/src/config.rs:413-424` 的既有模板）。
2. **新增双侧拖拽手柄**：正文列左右缘各一条，常态不可见，光标 hover 到列缘命中区时显现；
   拖拽时任一侧的移动**对称**作用于两侧（拖右缘 +Δx ⇒ 栏宽 +2Δx），到上下限即止。手柄 SHALL 是
   shell 层（编辑器 pane）的覆盖元素，MUST NOT 落在 CM 文档 DOM 内、MUST NOT 以 margin 表达任何间距
   （Why 第三节）。md 与只读 code 模式都出现（栏宽对两种模式同一条轨道生效，D5）。
3. **拖拽过程实时生效（live）**：宽度值经 `--layout-doc-measure` token 写入 `documentElement`，每次
   应用后显式 `view.requestMeasure()`（CSS 变量变化不会触发 CM 的 ResizeObserver——它只观察
   `scrollDOM`，本地实证见 design §1.4；不显式请求就是 M103/M110 同族的「坐标与画面错位」）。
   拖动事件按 rAF 合并，**持久化只在松手时发生一次**（拖拽过程不写盘）。若实现期在大文档上实测
   不达标，退路是「幽灵线 + 松手生效」（design §2.3、§3）。
4. **持久化到 `[ui]` 配置**：松手时把生效值写回 `config.json` 的 `ui.content_width`，纪律照
   `write_last_vault_to`（`src-tauri/src/commands.rs:394-428`）：读整份 JSON 为 `Value`、只改该字段、
   tmp+rename 原子替换、保留未知字段；写失败降级为提示、运行期宽度不回滚。这是 `config.json` 的
   **第二个应用侧写字段**（第一个是 `last_vault`）——M180/M195 的「运行期 MUST NOT 回写」针对的是
   瞬态开关，本 change 的宽度是用户显式调整的持久偏好，回写是本提案的核心语义（tower 已确认方向为
   `[ui]` 配置），仍需在 D3 签字确认这条纪律扩展。
5. **重启后保持**：启动时装载 `ui.content_width` 并施加一次（与 `ui.theme` 同一装配区，
   `src/main.ts:939-979`）；运行期拖拽与配置值天然同步（每次拖拽都回写），不存在 M180 那种
   「运行期态 vs 配置默认」的双真源。
6. **宽度变化的行为口径**：宽变化只改变栏宽与折行重排，MUST NOT 改写文档（`EditorState.doc` 与磁盘
   逐字节不变，ADR 0003 §3）、MUST NOT 进撤销栈、MUST NOT 改变 dirty；折行的重算由 CM 测量链承担
   （折行开时 contentWidth 变化超过一个字符宽即触发高度图刷新，实证见 design §1.4），本 change
   不另造折行触发路径；全部标签页（含后台）天然同宽（token 在 `documentElement` 上，与 typography
   同构）。

## 手柄交互面（评审时先看这一节）

| 项 | 口径 |
|---|---|
| 位置 | 正文列左、右缘各一条，垂直贯通编辑区高度 |
| 常态 | 不可见（不占布局、不挡文字） |
| 显现 | 光标 hover 命中区（列缘两侧各约 5px）时显现 2px 竖线；拖拽全程保持显现 |
| 光标 | 命中区上 `col-resize` |
| 拖拽 | 对称调整：栏宽变化 = 2 × 指针位移；实时重排；到 [480, 1200]（D2）即止 |
| 松手 | 写回 `config.json`（值未变则不写）；光标行保持在视口内（复用 typography 的 `keepCaretVisible` 口径） |
| 作用模式 | md 与只读 code 都生效（同一 grid 中列；code 模式列不居中，手柄按实际列缘定位，D5） |
| 落空行为 | 列宽已受窗口宽度约束（轨道是 `minmax(0, token)`，token 是上限）时，拖更宽不报错、不提示、值照存 |
| 反馈 | 无 toast、无数字读数（宽度变化即时可见）；写盘失败才有提示（新文案条目） |

## Non-goals

- **不新增命令与键位**：拖拽是鼠标交互，不进 `COMMAND_IDS`、不动 `[keys]` 面（`src/keys.ts` 零改动）。
  「键盘调宽 / 复位宽度」若日后需要，按证据另提 change（候选：`view.content-width-*` 命令族）。
- **不做双击复位默认值**：v1 没有「回到 664」的快捷手势；改 `config.json` 或拖回去即可。
- **不做拖拽中的数字读数 / 宽度指示条**：宽度即时可见即反馈；dogfood 后若需要再提。
- **不做 per-file / per-vault 宽度**：宽度是应用级显示口径（与主题、字号同级），不与文档绑定。
- **不调侧栏 / 标签栏 / modeline 宽度**：本 change 只动 `--layout-doc-measure` 一个 token 的消费者面；
  `--layout-review-measure` 等其余 layout token 不动。
- **不做窗口宽度跟随**（栏宽占可用宽度的百分比模式）：token 保持定值语义。
- **不做配置热重载**：手改 `config.json` 需重启生效（现状即如此，`config_get` 只在启动读一次）；
  但应用自己回写的值当即生效——回写发生在拖拽之后，运行期值已是新值。
- **不发明「逐字段类型容忍」**：`"content_width": "680"`（字符串）走整文件回落，与 `font_size`
  先例同路（`src-tauri/src/config.rs` 模块头「数值字段的打字代价」），如实记录并用单测钉住。
- **不动视觉容差、不新增配色 token**：手柄竖线取既有 token（hover 态 `--accent`、常态不可见），
  零新配色。

## Impact

- 影响的 specs：**新建 capability `content-width`**（ADDED ×4：拖拽调宽手柄、宽度配置项与校验、
  宽度持久化与写入纪律、宽度变化的测量与重排口径）。
- 影响的代码/系统：`src-tauri/src/config.rs`（`UiConfig` 增字段 + 区间校验 + 单测）、
  `src-tauri/src/commands.rs`（新增回写 IPC，复用 `write_last_vault_to` 的写盘纪律）、
  `src/ipc.ts`（调用包装）、`src/bindings/*`（ts-rs 生成物，bindings 漂移门禁
  `scripts/gate.sh:61-70`）、`src/editor.ts`（宽度施加与重测量入口）、`src/shell.ts`（手柄容器）、
  `src/style.css`（手柄样式 + token 注释更新）、`src/main.ts`（启动装配一行 + 失败提示接线）、
  `tests/visual/scenes/tauri-stub.ts`（config_get 桩补 `ui.content_width`）。
- 影响的测试/验收：Rust 单测（缺字段取默认、越界回落、类型不符整文件回落、回写保留未知字段）、
  TS 单测（钳制与对称换算纯函数）、视觉场景（手柄 hover 显现、拖拽后列宽与折行重排、上下限钳制、
  既有基线零变更核对）、真机验收场景（拖拽后 `config.json` 落值、文档逐字节不变、重启保持）——
  按 AGENTS.md 维护权条款，验收场景随实现同 PR。
- 影响的文档：`docs/specs/design-tokens-v1.md:203` 的 `--layout-doc-measure` 条目（值从「定值」改为
  「默认值，可被 `ui.content_width` 覆盖」）；`文案-Copy.md` 增一条写盘失败提示（续号）。
- 视觉基线：默认值保持 664（D1 建议）时，既有整页基线应**零变化**——变了就是实现引入了与宽度
  无关的位移，按缺陷处理；若 D1 改采 680，全部含编辑区的整页基线位移，按基线纪律走 Alex 过目。
- 关联约束：ADR 0002 §5（配置即数据 + schema 校验——回写纪律是本提案唯一新增的写入面）、
  ADR 0002 §6（性能合同：拖拽帧预算参照 keypress-to-paint <16ms，design §2.3）、ADR 0003 §3
  （不改写源文件）、ADR 0006（编辑器即阅读表面）。
- 性能：拖拽 = 每帧一次 token 写入 + 一次显式 `requestMeasure`；折行开时栏宽变化超过一个字符宽会
  触发 CM 高度图整体刷新（design §1.4 实证）——与折行 toggle（M180）同量级，但拖拽期间逐帧重复，
  大文档实测是 tasks 的硬项。

## 裁决记录（节点 1，2026-09-25，Alex）

逐字裁决原文：

- D1：「D1 默认 680」
- D2：「D2 上下限 [680,1200]」
- D3：「D3 写回 config.json」
- D4：「D4 拖拽 live 生效」
- D5：「D5 手柄也进 code 模式」

D3 的含义（tower 转述）：新建一个 Rust 侧的合并写命令，把 `ui.content_width` 单键写回
`~/.config/lumir/config.json`（读-改-写、原子写、失败 toast 报错）；命令做成**通用键值写入**，
后续 M226 主题切换的 `ui.theme` 会复用同一通道。

另 Alex 问「产品里对它的命名是什么？」——以本提案的命名为准：**内容区域宽度拖拽调整**
（手柄读屏名「调整内容宽度」）。

裁决对提案建议的两处改写：D1 取 680 而非建议的 664（默认口径因此位移 16px，所有含编辑区的
整页基线随本 change 重建，与 heading-hierarchy-ramp 同一批走 Alex 过目纪律）；D2 下限取 680
而非建议的 480——**默认值 = 下限**（680），拖拽只能往宽调，收窄的下限即出厂值。

## 待 Alex 裁决（已于 2026-09-25 全部落槌，结果见上「裁决记录」；本节保留原始论证）

- **D1｜默认值 664 vs 680**（落槌：**680**）：任务书口述「当前定稿宽度 680px 为默认值」，但代码与定稿证据都是
  **664px 框宽**（`src/style.css:193`；`src/editor.ts:1269-1274` 注释明确「与定稿图
  `.doc { max-width:664px }` 逐项一致」；tokens 文档 `docs/specs/design-tokens-v1.md:203` 同值；
  680 在仓内只作为字重 `--fw-display` 出现）。建议取 **664**：默认口径零视觉变化、不动任何既有基线；
  取 680 则是一次独立的观感变更（所有含编辑区的整页基线位移），建议与本 change 分开做。
- **D2｜上下限 [480, 1200]**（落槌：**[680, 1200]**——默认值即下限）：框宽口径（文字宽 = 框宽 − 88px 内边距）。依据与可靠度：
  拉丁行宽 45–75 CPL（Bringhurst，经 [webtypography.net §2.1.2](http://webtypography.net/2.1.2)
  转述）；[Baymard Institute](https://baymard.com/blog/line-length-readability) 的可用性研究取
  50–75 CPL 含空格、超 75 被跳读（可用性测试机构，权威转述级）；[WCAG 2.2 SC 1.4.8
  Visual Presentation](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html)
  给「文本块宽 ≤ 80 字符（CJK 40 字）」的无障碍参照（W3C 一手标准，AAA 级；并说明 CJK 上限减半
  是因为同可读性下 CJK 字宽约为非 CJK 两倍）。中文侧「每行 25–40 字」是行业惯例汇总（社区内容，低一档可靠度，仅作旁证）。
  按默认 15px 字号换算（全角 ≈15px、拉丁 ≈7.5px/字符，未逐字体测量，基于经验值）：480 框宽 ≈
  26 全角 / 52 拉丁字符，贴着两个下限；1200 框宽 ≈ 74 全角 / 148 拉丁，**超出可读性最优区是
  有意的**——上限是护栏不是推荐值，宽屏与代码浏览需要它；现行默认 664 ≈ 38 全角，正在
  「CJK ≤ 40」的参照线内。要收紧（如上限 960 ≈ 58 全角）只需改一对常量。
- **D3｜回写 `config.json` 这条新写通道**（落槌：**写回 config.json**，且命令做成通用键值写入，
  M226 的 `ui.theme` 复用同一通道）：现状运行期只写 `last_vault` 一个字段（两处写入点同纪律），
  M180/M195 的瞬态开关都明确「MUST NOT 回写」。本 change 的宽度是**持久偏好**（重启保持是本提案的
  核心语义，tower 方向已定 `[ui]`），因此新增第二条写字段通道，纪律与 `last_vault` 完全一致
  （读整份 `Value`、只改一字段、tmp+rename、保留未知字段）。若你认为应用不该写用户手编的配置面，
  替代方案是独立状态文件（reading-position 的先例，`src-tauri/src/reading_position.rs`）——代价是
  「宽度」这个用户可手编的值从此有两处居所，与「配置即数据」单一居所的方向相悖，本提案不推荐。
- **D4｜live 拖拽 vs 松手生效**（落槌：**live 生效**）：建议 live（你引用的 DeepSeek 形态就是 live），逐帧 rAF 合并 +
  显式重测量；折行开时每次宽度变化触发 CM 高度图整体刷新（与折行 toggle 同量级），大文档拖拽的
  帧实测是 tasks 的硬项，不达标则退到「幽灵线 + 松手生效」（design §2.3、§3）。
- **D5｜手柄是否也进 code 模式**（落槌：**进**）：建议进——栏宽轨道对两种模式是同一条，code 模式同样是阅读表面；
  差异只是列不居中（gutter 占左列），手柄按 `.cm-content` 实测矩形定位即可。若你只想要 md 模式，
  砍掉的是 code 分支的定位与场景，工作量减约四分之一。
