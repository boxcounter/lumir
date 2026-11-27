# Design: Tab 动态编号

## 1. 状态与事件

物理 Meta 键码（`MetaLeft` / `MetaRight`）按 window 共享一份瞬态输入状态，因为按住期间新建的 pane 不可能收到此前那次 keydown。窗口级 keydown/keyup 只更新这份状态；不调用 `preventDefault` / `stopPropagation`，不进入键位分发器，也不触发标签动作。重复 keydown 幂等；双 Meta 同时按住时，抬起其中一侧不清除另一侧仍成立的状态。

各 `createTabs` 实例订阅这份输入状态，但显示与否仍由自己的 `isActivePane` 决定，不共享活跃 pane 或标签状态。订阅采用引用计数：最后一个标签实例销毁时解绑 window/document 监听并清空输入状态；单个实例销毁只退订并摘自己的 class。`window.blur` 与 `document.visibilitychange`（`document.hidden === true`）清物理键集合并通知所有实例。标签全量重建时从共享输入状态恢复当前实例的显示态，不引入第二份标签清单。

## 2. 活跃 pane 边界

`TabsDeps` 新增 `isActivePane(): boolean` 只读注入，装配层以 `paneLayout.active().id === paneId` 实现。每个实例收到窗口事件后都重算自己的 class，但仅活跃文档 pane 可显示；活跃 pane 变化后既有 `syncActiveDocument → renderAllTabStrips` 会同步两侧。harness pane 没有 Tabs 实例；harness 持焦时活跃文档 pane 的口径与既有 `⌘1–9` 一致。

不通过焦点是否落在标签上、DOM 顺序或全局可变「当前标签条」推断活跃 pane。多实例监听各自可销毁，不共享可变单例，不跨 pane 串号。

## 3. 序号生成

渲染复用 `editor.sessions()` 过滤出的同一份可见标签数组。数组下标 0–8 各追加一个文本为 1–9 的 `span.tab-cmd-index`，第 10 个起不创建序号节点。节点带 `aria-hidden="true"`，CSS `pointer-events: none`，不进入 `.tab-open` 的读屏名计算子树；既有按钮 `aria-label`、title、role、aria-selected、dirty 与 read-only 节点均不改。

## 4. 视觉保真

### 布局节奏

- 标签仍高 29px、最大宽 230px，既有左右 padding 12px、内部 gap 7px、标签间距与横向滚动规则不动。
- 序号绝对定位于标签左内边距：水平中心对齐既有 12px 左留白，垂直居中于标签盒；不参与 flex 测量。
- 未按住 Command 时 `display: none`。显示/隐藏前后每条标签矩形、tabstrip `scrollLeft` / `scrollWidth`、正文矩形必须逐值相等。

### 字层级与克制落点

- 序号使用 10px、既有 mono 字族与 `--text-2`；单行、固定 12px 宽，不加按钮边框、阴影、动画或新 token。
- 落点限制在标签内容左侧的既有留白内，右缘不得碰到文件名/dirty 点/read-only 锁的实际字形区，也不得覆盖右侧关闭钮。
- 不替换或隐藏关闭钮，因此不存在把序号误认成新关闭动作的外观变化；序号本身无命中语义。

### 各状态与主题

- light / dark / eink 共用结构，只随既有颜色 token 变化；eink 不新增彩色强调。
- active / inactive、dirty / clean、read-only / 普通标签都显示同一序号，不与状态标记竞争。
- 候选至少覆盖三主题、窄 pane、长名称、1 个、9 个、>9 个标签与双 pane；实际看图后记录，候选落主仓 `.local/reviews/tab-dynamic-numbering-nov27/`，正式基线零变更。

## 5. 验收与反向必红

- 单元层：左右 Meta 与双 Meta、重复事件、松开、blur、visibility、destroy、重建、活跃 pane 隔离、1–9 顺序和 >9 无号；监听解绑后不得响应。
- 浏览器层：真实 `page.keyboard.down/up("Meta")`，显示/隐藏、ARIA/读屏名不变、标签宽度与滚动零变化、正文与文档不变；⌘1 仍恰好切到第一个，序号不消费事件。
- 每条新增断言先以明确的错误输入/退化实现实测红，再恢复实测绿；红绿日志落 `.local/reviews/tab-dynamic-numbering-nov27/`。
- 真机场景用 CGEvent 的按住/松开动作留 WKWebView 截图；通道在异常路径也必须尝试复位 Command，禁止留下系统级卡键。真机由主会话串行运行，本任务只更新场景、覆盖表与静态/自测。
- 完整像素 visual 由主会话串行执行；新增候选不是正式基线，不执行 `--update`。
