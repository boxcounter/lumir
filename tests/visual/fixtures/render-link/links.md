---
title: 链接场景
tags: [render]
---

# 链接

正文里的 [示例站点](https://example.invalid/site) 是外链。

相对路径 [本地笔记](note.md) 与同目录子路径 [指南](docs/guide.md) 是应用内跳转。

上层 [上层笔记](../top.md) 与无扩展名 [配置](config) 同样按笔记解析。

纯锚点 [去标题](#链接) 只给提示。

资产 [说明书](docs/manual.pdf) 与目录 [资料目录](docs/) 交系统默认应用。

缺失 [不存在的笔记](missing.md) 仍然装饰，激活时才提示。

裸网址 https://example.invalid/bare 与自动链接 <https://example.invalid/auto> 都不是标准链接形态。

`[代码里的](https://example.invalid/code)` 不渲染。

邮件 [写邮件](mailto:someone@example.invalid) 也是外链。

不支持 [别开我](javascript:alert(1)) 不装饰也不打开。

尖括号包裹 [包裹形式](<https://example.invalid/wrapped>) 同样是外链。

| 链接列 | 说明 |
| --- | --- |
| [表格内外链](https://example.invalid/cell) | 单元格文本 |
| [表格内笔记](guide.md) | 第二条 |
