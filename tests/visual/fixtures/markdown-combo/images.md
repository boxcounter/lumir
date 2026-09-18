# Image fallback fixture

固定尺寸 svg（240×80）：

![fixed svg](assets/sample.svg)

超宽 svg（2000×600，按栏宽收窄）：

![wide svg](assets/wide.svg)

百分比固有宽度、只声明 viewBox 的 svg（design §8.1 的中招形状）：

![percent svg](assets/zero-size.svg)

同一份中招 svg 的 Obsidian 方言形态：

![[zero-size.svg]]

空位图（0 字节，无可解码内容）：

![empty bitmap](assets/empty.png)

目标缺失：

![missing bitmap](assets/missing.png)

外部 URL（http(s) 分支）：

![remote image](https://example.invalid/remote.png)

含 `<script>` 与 `onload` 的 svg：

![script svg](assets/script.svg)

含外部 `<image href>` 的 svg：

![external ref svg](assets/external-ref.svg)
