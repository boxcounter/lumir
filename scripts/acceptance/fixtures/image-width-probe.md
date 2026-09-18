# 图片宽度场景（M182）

百分比固有宽度 svg（mermaid 形态：`width="100%"` + viewBox + 根上 max-width，无固有像素尺寸）：

![percent svg](image-width-probe-percent.svg)

同一份 svg 的第二次引用（同一 data URL，缓存命中）：

![percent svg again](image-width-probe-percent.svg)

定固有尺寸 svg（2000×300，超栏宽）：

![wide svg](image-width-probe-wide.svg)

定固有尺寸 svg（1000×100）：

![fixed svg](image-width-probe-fixed.svg)
