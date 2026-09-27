# 代码块全屏场景

文档开头段落（阅读位置不变量的锚点之一）。

## 短围栏块（带超长行）

```js
const short = "短块";
const long = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";  // 明显长于阅读栏宽度（>1200px）
```

## 长块（行数明显超过一屏，且块尾的文本只可能来自整块呈现）

```text
line 0001
line 0002
line 0003
line 0004
line 0005
line 0006
line 0007
line 0008
line 0009
line 0010
line 0011
line 0012
line 0013
line 0014
line 0015
line 0016
line 0017
line 0018
line 0019
line 0020
line 0021
line 0022
line 0023
line 0024
line 0025
line 0026
line 0027
line 0028
line 0029
line 0030
line 0031
line 0032
line 0033
line 0034
line 0035
line 0036
line 0037
line 0038
line 0039
line 0040
line 0041
line 0042
line 0043
line 0044
line 0045
line 0046
line 0047
line 0048
line 0049
line 0050
TAIL-MARKER 块尾标记
```

## 缩进代码块（无围栏行 ⇒ 没有头部条）

    indented body one
    indented body two
