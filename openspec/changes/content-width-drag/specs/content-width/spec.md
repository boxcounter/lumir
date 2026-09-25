# content-width 增量规格

## ADDED Requirements

### Requirement: 拖拽调宽手柄

正文列的左右缘 SHALL 各有一条拖拽手柄，用于调整阅读栏宽。手柄 SHALL：

- 常态不可见（不占布局、不遮挡文字、不进 Tab 序）；光标 hover 到列缘命中区（列缘两侧各约 5px）
  时显现，拖拽全程保持显现，移开且非拖拽中 SHALL 隐去；
- 是 shell 层（编辑器 pane）的覆盖元素，MUST NOT 落在 CodeMirror 的文档 DOM（`.cm-scroller` /
  `.cm-content`）内部，MUST NOT 以 margin 表达任何间距（CM 按 border-box 量行高，margin 对高度图
  不可见——M110 同族纪律，`src/preview/livePreview.ts:734`、`src/style.css:284-288`）；
- 命中区 SHALL 带 `col-resize` 光标；除命中区外 MUST NOT 拦截文本选择、点击落点与滚动；
- md 模式与只读 code 模式都 SHALL 出现（栏宽轨道对两种模式同一条）；无前台文档的空态下
  MUST NOT 出现；
- 拖拽 SHALL 对称作用于两侧：栏宽变化 = 2 × 指针位移；宽度值钳制在「宽度配置项与校验」规定的
  上下限内，到界后继续拖拽 MUST NOT 改变宽度、MUST NOT 报错或提示；
- 拖拽 SHALL 实时重排（live）：每次宽度应用 SHALL 写 `--layout-doc-measure` token 并显式触发
  CodeMirror 重测量（CSS 变量变化不触发 CM 的 ResizeObserver，见「宽度变化的测量与重排口径」）；
  若实现期大文档实测不达标，允许退化为「拖拽中只画手柄线、松手时一次施加」，该退化 SHALL 记录在
  design 与验收证据里，MUST NOT 静默降级。

拖拽 MUST NOT 改写文档（`EditorState.doc` 与磁盘文件逐字节不变，ADR 0003 §3）、MUST NOT 进撤销栈、
MUST NOT 改变 dirty 状态。本能力 MUST NOT 新增命令或键位（纯鼠标交互）；键盘调宽不在本期范围。

#### Scenario: hover 显现与隐去

- **WHEN** 打开一份 Markdown，光标移到正文列右缘命中区，随后移开
- **THEN** hover 时右缘手柄显现（竖线可见、光标为 `col-resize`），移开后隐去；全程文档内容
  逐字节不变

#### Scenario: 对称拖拽与上下限

- **WHEN** 打开一份文档，把右缘手柄向右拖 80px，再把左缘手柄向左拖到超出下限
- **THEN** 第一次拖拽后栏宽增加 160px（两侧对称）；第二次拖拽在到达下限后宽度停在下限值，
  继续拖不再收窄、无报错

#### Scenario: 空态无手柄

- **WHEN** 未装载任何 vault（空态覆盖层在）
- **THEN** 两条手柄都不可见，hover 原列缘位置无任何反应

#### Scenario: code 模式同样有手柄

- **WHEN** 打开一个非 md 文件（只读 code 模式，列不居中、左侧有行号 gutter）
- **THEN** 左右手柄贴合代码正文列的实际左右缘；拖拽同样对称生效

### Requirement: 宽度配置项与校验

`~/.config/lumir/config.json` 的 `[ui]` 表 SHALL 支持整数像素项 `ui.content_width`（阅读栏宽上限），
键名与 Rust 字段名逐字一致（沿用无 `serde(rename)` 的既有口径）。默认值 = **680**（节点 1 裁决 D1
落槌值；注意它与裁决前仓内定值 664 不同——默认口径位移 16px，含编辑区的整页视觉基线随本 change
整批重建并走 Alex 过目纪律），合法区间 = **[680, 1200]**（节点 1 裁决 D2 落槌值；默认值即下限，
拖拽只能往宽调）。

该配置项 SHALL 与 `editor.font_size` 走同一条装配链：各类型 `impl Default`、宽容解析镜像上的
`#[serde(default)]`、`validate()` 逐字段区间判定（越界回落默认 + warning），MUST NOT 另开装载
路径；取值不合法 MUST 走既有 config warning 语义（console + 诊断日志 `config_warning`），不得导致
启动失败（ADR 0002 §5），本 change MUST NOT 为 warning 新增 UI 面。

**已知边界（如实记录）**：类型不符（如 `"content_width": "680"`）在 serde 解析期让整份宽容结构
失败、走整文件回落（全部默认 + warning），与 `editor.font_size` / `ui.theme` 给错类型同路。本
change MUST NOT 引入「逐字段类型容忍」；实现 SHALL 用一条单测把这条边界钉住。

装载时点 SHALL 与现状一致：只在启动装载读一次（`config_get` 无 watcher），手改配置需重启；
运行期的宽度变更由拖拽承担并回写配置（见「宽度持久化与写入纪律」），因此运行期值与配置值天然
同步，MUST NOT 出现「运行期宽度和配置各执一词」的双真源。栏宽语义是**上限**：窗口可用宽度不足时
实际列宽由 grid 收缩决定（轨道为 `minmax(0, token)`），配置值不被改写。新增字段 SHALL 经 ts-rs
导出到 `src/bindings/` 并受 bindings 漂移门禁约束（`scripts/gate.sh:61-70`）。

#### Scenario: 缺字段时取默认

- **WHEN** `config.json` 的 `[ui]` 表里没有 `content_width`（旧配置原样启动）
- **THEN** 栏宽为默认 680px，不产生任何 config warning

#### Scenario: 显式配置生效

- **WHEN** 配置 `{"ui": {"content_width": 800}}` 后启动
- **THEN** 正文列框宽为 800px（两侧对称变宽），首帧即为该值

#### Scenario: 越界回落默认

- **WHEN** 配置 `{"ui": {"content_width": 200}}` 后启动
- **THEN** 栏宽回落默认 680px，产生一条 config warning（console + 诊断日志），应用照常启动

#### Scenario: 类型不符走整文件回落

- **WHEN** 配置 `{"ui": {"content_width": "680", "theme": "dark"}}` 后启动
- **THEN** 整份配置按默认解释（`theme` 也回默认 light）+ 一条 warning；该边界 SHALL 由单测钉住，
  MUST NOT 出现「部分字段按配置、部分按默认」的混合态

### Requirement: 宽度持久化与写入纪律

拖拽松手（`pointerup`）且宽度值相对拖拽起点有变化时，应用 SHALL 把生效值写回 `config.json` 的
`ui.content_width`；值未变化 MUST NOT 写盘。拖拽过程中 MUST NOT 写盘（写盘频率与手势数一一对应）。

写入 SHALL 遵守既有 `write_last_vault_to` 的纪律（`src-tauri/src/commands.rs:394-428`）：读整份
JSON 为 `Value`（解析失败按空对象起）、只改 `ui.content_width` 一个字段、其余字段（含未知字段与
其它表）逐键保留、`tmp` 文件 + `rename` 原子替换。写入通道是**通用键值合并写命令**
`config_set_ui_value(key, value)`（节点 1 裁决 D3：「命令做成通用键值写入」），`ui.content_width`
是它的第一个调用方，M226 主题切换的 `ui.theme` 将复用同一通道；MUST NOT 复用
「读全量配置再整份序列化前端状态」之类的旁路。

写失败 SHALL 降级为提示（toast + 诊断日志 `config_warning`），MUST NOT 让拖拽本身失败、MUST NOT
回滚运行期宽度（与 `remember_last_vault` 的「主结果不受记忆写失败影响」同口径）。写完后 MUST NOT
回读配置来同步运行期（运行期真源就是刚施加的值）。

重启后 SHALL 呈现最近一次拖拽（或手改配置）后的宽度；`ui.content_width` 是宽度的唯一持久居所，
MUST NOT 另建状态文件存宽度。

#### Scenario: 拖拽后配置落值且其余字段不变

- **WHEN** 拖拽手柄改变栏宽并松手，比对 `config.json` 的前后内容
- **THEN** `ui.content_width` 等于松手时的生效宽度；其余键（含 `last_vault`、`keys`、未知字段）
  逐键不变；文档内容逐字节不变、dirty 不变

#### Scenario: 拖拽过程不写盘

- **WHEN** 按下手柄拖动一段距离但尚未松手，此时读 `config.json`
- **THEN** `config.json` 与拖拽前逐字节相同

#### Scenario: 重启后保持

- **WHEN** 拖拽改宽后退出应用、重新启动，打开同一份文档
- **THEN** 栏宽为拖拽后的值

#### Scenario: 写失败降级

- **WHEN** 配置目录不可写时拖拽改宽并松手
- **THEN** 出现写失败提示（toast）且诊断日志有 `config_warning`；栏宽保持拖拽后的运行期值，
  应用照常可用

### Requirement: 宽度变化的测量与重排口径

每次宽度应用（启动装配、拖拽每帧、松手生效路径）SHALL 由同一入口完成三步：写
`--layout-doc-measure` token（`documentElement` 上）、显式 `view.requestMeasure()`、光标行保持在
视口内（`scrollIntoView` 最小滚动，与 typography 的 `keepCaretVisible` 同口径）。

显式重测量是**正确性条件**，不是优化：CM 的 ResizeObserver 只观察 `scrollDOM`，grid 中列宽变化
不触发它（`@codemirror/view@6.43.11` dist 实证，design §1.4）；缺了它，高度图与坐标停留在旧宽度
（M103/M110 同族的「坐标与画面错位」）。折行开时，栏宽变化超过一个字符宽由 CM 测量 pass 触发高度
oracle 刷新与高度图重建——折行重算 SHALL 由这条 CM 既有链路承担，本 change MUST NOT 另造折行
触发路径；折行关时高度不变，横向溢出范围随列宽更新。宽度 MUST NOT 用 margin 或文档流内间距表达
（M110 纪律）。

宽度是**应用级**口径：token 在 `documentElement` 上，全部标签页（含后台）与随后新建的会话 SHALL
呈现同一栏宽；切标签页 SHALL NOT 改变栏宽。md 与只读 code 模式共用同一栏宽。

图片列数换算、表格与代码块横滚容器等下游几何 SHALL 随列宽变化正确更新（由浏览器布局 + CM 重测量
承担）；若实现期实测发现几何缓存不失效，实现的失效逻辑 SHALL 写进 design 的实测记录。

#### Scenario: 折行下收窄后坐标与画面一致

- **WHEN** 折行开时打开一份含超长正文行的 Markdown，拖窄栏宽 100px
- **THEN** 超长行的折点数增加；点击折行内的文字，光标落在点击的字符处（坐标与画面一致，
  重测量到位的试金石）

#### Scenario: 不折行下变宽更新横向溢出

- **WHEN** `{"editor": {"line_wrap": false}}` 下打开含超长行的 Markdown，拖宽栏宽
- **THEN** `.cm-scroller` 的横向可滚动范围随列宽收缩，超长行仍可横向到达，MUST NOT 被裁掉

#### Scenario: 全部标签页同宽

- **WHEN** 打开两个标签页，在前台标签页拖拽改宽，切到后台标签页再切回
- **THEN** 两个标签页呈现同一新栏宽；新建标签页也取当前运行期宽度

#### Scenario: 大文档拖拽的帧预算

- **WHEN** 折行开时打开 1MB 探针文档，做一次完整拖拽
- **THEN** 「施加 → 重测量 → 绘制」的帧耗时实测数据落在证据目录里；若不达标（参照
  keypress-to-paint <16ms 的合同口径，ADR 0002 §6），实现 SHALL 退化为松手生效并在 design
  记录实测数据，MUST NOT 带损上线且不声明
