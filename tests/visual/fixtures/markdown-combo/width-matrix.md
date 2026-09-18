# 图片显示宽度矩阵（M182）

超栏宽的定尺寸 svg（2000×600）：

![wide svg](assets/wide.svg)

窄于栏宽的定尺寸 svg（240×80）：

![fixed svg](assets/sample.svg)

百分比固有宽度（`width="100%"` + viewBox，无固有像素尺寸）：

![percent svg](assets/percent-width.svg)

同一份百分比固有宽度 svg 的方言形态：

![[percent-width.svg]]

只声明 viewBox（无 width / height 属性）：

![viewbox only](assets/viewbox-only.svg)

固有尺寸声明为零（width=0 height=0 + viewBox）：

![zero declared svg](assets/zero-declared.svg)

空位图（读取成功但没有可解码内容）：

![empty bitmap](assets/empty.png)

目标缺失：

![missing bitmap](assets/missing.png)

行内小图（同一行还有正文）：

前文 ![inline svg](assets/sample.svg) 后文
