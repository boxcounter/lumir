# Design: Foundation Markdown 质量合同

## 端点模型

打开请求生成单调递增 request token。路径确认、文档绑定和旧响应丢弃先于首帧计时。F0 以真实 Tauri/WKWebView 的用户点击为起点，以正确文档的可见 decoration/frontmatter ready 后一次 `requestAnimationFrame` paint 为终点。图片、wikilink 等资源以独立 F1 计时，必须成功、失败或有界降级。

## 覆盖与降级

P0 组合是基础出口。P1/P1.5 进入 Foundation 的实现顺序，未完整实现时必须展示明确降级，不得出现无限 loading。P2 记录为延后裁决。列表与 pipe table 优先复用 parser 结构信息。非矩形表格回退可读源码，不猜测修复；宽表使用局部可聚焦横向滚动区。

## 性能与证据

装饰按可见区域增量构建。现有 `open-file.mjs` 和 headless CDP keypress 继续作为子指标/近似，并在报告中明确边界。真实 F0/F1 在代表 fixture 上测量，先报告 p50/p95/max 与完整端点，再由独立裁决节点确定预算；不将未测量的绝对预算写成事实。ADR 0002 四项既有数字不变。

## Fixture 与验收

fixture 使用确定性匿名生成器和 manifest。tiny（≤4 KiB）验证单屏 correctness，small（>4–16 KiB）承载画像中的日常规模与 P0/P1/P1.5，medium（>16–64 KiB）验证滚动、嵌套和保存，large（>64–256 KiB）验证压力。不得引用真实 vault 文本、标题、路径、实体、标签或 URL。验收必须同时覆盖真实渲染、原始源码复制、文件字节/版本保护、AX 语义与性能端点。

## 边界与评审

本 change 是质量合同，不授权实现和不扩张产品范围。OpenSpec strict、build、文档 link/diff、真实 fixture 验收和独立 review 是出口；节点 2 前不得 archive。若新增行为超出合同，须重新走 proposal 节点 1。
