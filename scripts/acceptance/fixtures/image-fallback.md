# 图片引用场景（image-svg-and-fallback）

带 `width`/`height` 的 svg：

![normal svg](image-fallback-normal.svg)

百分比固有宽度、只声明 viewBox 的 svg（中招形状）：

![percent svg](image-fallback-percent.svg)

空位图（0 字节：读取成功、但没有可解码内容）：

![empty bitmap](image-fallback-empty.png)

目标缺失：

![missing svg](image-fallback-missing.svg)

含 `<script>` 与 `onload` 的 svg：

![script svg](image-fallback-script.svg)
