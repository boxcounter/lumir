# Image fallback fixture

固定尺寸 svg（240×80）：

![fixed svg](assets/sample.svg)

超宽 svg（2000×600，按栏宽收窄）：

![wide svg](assets/wide.svg)

百分比固有宽度、只声明 viewBox 的 svg（固有宽度不定的代表；M178 称「中招形状」，M182 起按栏宽填充）：

![percent svg](assets/percent-width.svg)

同一份「固有宽度不定」svg 的 Obsidian 方言形态：

![[percent-width.svg]]

空位图（0 字节，无可解码内容）：

![empty bitmap](assets/empty.png)

固有尺寸声明为零的 svg（尺寸兜底取不到宽度，走第二道保险）：

![zero declared svg](assets/zero-declared.svg)

目标缺失：

![missing bitmap](assets/missing.png)

外部 URL（http(s) 分支）：

![remote image](https://example.invalid/remote.png)

含 `<script>` 与 `onload` 的 svg：

![script svg](assets/script.svg)

含外部 `<image href>` 的 svg：

![external ref svg](assets/external-ref.svg)
