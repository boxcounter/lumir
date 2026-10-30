# Design: composer 自绘选区高亮

- Change ID: `fix-composer-selection-highlight-oct30`
- 日期: 2026-10-30

## 1. 已证实事实与约束

调查报告 `.local/reports/composer-select-all-highlight-oct30/README.md` 已在真实前端证明：
`selectAllComposer` 产生 `(composer,0) → (composer,N)` 端点，模型读回首块前缘到末尾之后，
Backspace 整删正确；首个块为不可编辑卡片时，WebKit 对该形态绘制 0 px，Chromium 正常绘制。

已否决的路径不在本设计复活：`execCommand("selectAll")` 会越出 composer；恒定可编辑首块改变块模型；
文本端点在 WebKit 被钳回卡片内部并破坏整删。

原生 UI 不能由 CSS 单独补足：全局 `::selection` 已存在且颜色正确，最小复现证明缺失的是引擎对该
块级选区形态的绘制，而非配色。自绘只承担瞬时呈现；原生 Selection 继续提供可访问语义、键盘、IME
与编辑集成。内容文本不施加 `user-select: none`。

## 2. 单一真源与同步

`caretFromDom()` 读出的 `ComposerSelection` 是唯一输入。新增纯函数按块模型与选区方向求「需要块级
高亮的下标集合」：

- 选区为 null、折叠或不在 composer 内：集合为空。
- 原子卡片与选区相交：该卡片进入集合，因为卡片是整体选择单位。
- 段落被当前选区完整覆盖：该段落进入集合，补足 WebKit 不画整块原生选区的情况。
- 段落仅局部命中：不画整块带，避免把局部选择夸大成整段选择；该文本继续由原生 `::selection` 绘制。

DOM 侧只在顶层既有块上切换一个呈现 class，不插入 wrapper、伪文本或额外可访问节点。class 的
背景与边框色只消费既有选区 token；块自身矩形就是高亮边界，composer 的 overflow 继续负责视口裁切。

`selectionchange` 是用户拖动、原生折叠与外部选区变化的统一同步入口。`selectAllComposer` 与
`setDomSelection` / `setDomCaret` 在程序化写选区后同步调用同一函数，避免等待事件才出现一帧空窗。
`renderComposer` 重建块后先清掉旧节点，再按当前模型选区同步；结构编辑产生的折叠选区自然清空高亮。
失焦时显式清空，重新聚焦后的 selectionchange 再按真实选区恢复。面板单例长驻，不新增生命周期。

## 3. 模型与几何不变量

纯函数测试扫块类型、卡片首位 / 中间 / 末位、多卡片交错、正反向选区、折叠与非折叠、段落完整 /
局部命中。断言：方向不影响集合；卡片相交必画；完整段落必画；局部段落不画整块带；折叠与空选区
必为空；越界端点按既有模型边界钳制，不产生不存在的块下标。

几何测试以实际块矩形与 composer 截图坐标换算：每个应画块的矩形内必须有像素变化；差异不得落在
composer 外；折叠后的截图不得保留自绘带。高亮不改变布局尺寸，因此 ⌘A 前后块矩形必须一致。

## 4. 先红后绿

新增 `m815-composer-selection-highlight.spec.ts`，同时纳入 `chromium` 与 `webkit-realua` project。
测试直接经草稿桩恢复确定性的合成块序列，覆盖：

1. 卡片首位、卡片中间、卡片末位；
2. 多类卡片与段落交错；
3. 纯文本与含软断行的段落。

每个用例先截折叠态，再按 Meta+A，逐块比较截图，检查 composer 外区域，随后折叠并检查高亮消失。
另保留原生端点、全块覆盖与 Backspace 整删断言。

实现前运行：卡片首位用例必须 WebKit FAIL / Chromium PASS，原始输出与截图归档到
`.local/reviews/composer-selection-highlight-oct30/before-fix/`。不得为适配实现而放宽这些断言。

## 5. 真机与边界

场景 259 使用隔离 XDG_CONFIG_HOME 与 `/tmp/lumir-m102-acceptance` 合成 vault，经 `[keys]`
将 `editor.select-all` 重绑到可注入键。截图与像素采样验证高亮，AX 验证卡片 / 文本覆盖的可观察
结果，Backspace 验证整删，方向键折叠后验证无残留。

真机物理 ⌘A 不可注入，本 change 不声称覆盖该段；按键到命令由 m627 与 Rust 菜单测试覆盖。
真机采样只能验证截图中的可见带与清除，不能读取 DOM Selection；DOM 端点由 Playwright 场景承担。

禁止更新既有视觉基线。全量 visual 若出现既有基线差异，保存 actual / expected / diff 并上报，
不以更新基线换绿。
