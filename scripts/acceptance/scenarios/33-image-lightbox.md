---
id: "33-image-lightbox"
item: 33
title: 图片双击放大查看（lightbox）：三种引用形态打开遮罩、三条关闭路径、焦点归还、不改写源文件
fixtures: [lightbox.md, lightbox-fixed.svg, lightbox-percent.svg, lightbox-bitmap.png]
open: lightbox.md
marker: "图片放大查看场景"
steps:
  - name: 终态：三张引用都渲染成图（双击的靶子在场）
    expect:
      - label: 固定尺寸 svg 的替换区在 AX 里带非零几何读数（不可见图的文本照样读得到，所以判几何不判文本）
        ax: { count: { pattern: "/AXImage \\(!\\[lightbox fixed svg\\]\\(lightbox-fixed\\.svg\\)\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/", exact: 1 } }
      - label: 百分比宽度 svg 的替换区带非零几何读数
        ax: { count: { pattern: "/AXImage \\(!\\[lightbox percent svg\\]\\(lightbox-percent\\.svg\\)\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/", exact: 1 } }
      - label: 位图的替换区带非零几何读数
        ax: { count: { pattern: "/AXImage \\(!\\[lightbox bitmap\\]\\(lightbox-bitmap\\.png\\)\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/", exact: 1 } }
      - label: 三条引用都无读取失败占位（有占位说明上面三条几何判的是别的东西）
        editor: { not: "图片读取失败" }
      - label: 三条引用的源码都被 replace 装饰藏起来（渲染态而非源码态）
        editor: { not: "![lightbox percent svg](lightbox-percent.svg)" }
      - shot: 终态三张图

  - name: 基线：记录编辑器内容（供 6.5 的两条 unchangedSince 逐字节比较）
    do: recordEditor
    as: before
    expect:
      - label: 打开前标签栏有一条标签（遮罩打开后它会从 AX 树里消失，这条是那个变化的对照）
        ax: { has: "关闭 lightbox.md" }

  - name: 基线：记录磁盘文件 sha256/mtime
    do: record
    file: lightbox.md
    as: doc
    expect:
      - label: 磁盘基线记下后的读数（文档此时是渲染态，源码被装饰藏起）
        editor: { has: "图片放大查看场景" }

  - name: 负对照：单击内联图不打开遮罩（双击那条断言因此不是恒真）
    do: click
    target: { role: AXImage, name: "lightbox percent svg" }
    expect:
      - label: 单击后遮罩未打开（标签栏还在、放大图的几何读数不存在）
        ax: { has: "关闭 lightbox.md" }
      - label: 单击后没有遮罩放大图（1120×374 是遮罩内容盒宽度推导出的读数，内联那张是 766×256）
        ax: { not: "/AXImage .*@40,229 1120×374/" }

  - name: 双击百分比宽度 svg：遮罩打开，放大图几何读数 = 遮罩可用区
    do: doubleClick
    target: { role: AXImage, name: "lightbox percent svg" }
    expect:
      - label: 遮罩放大图在 AX 里且几何读数非零（1120×374 = 窗口 1200 减两侧 padding 40、按 svg 3:1 比例）
        ax: { count: { pattern: "/AXImage .*@40,229 1120×374/", exact: 1 } }
      - label: AX 树被模态接管（标签栏节点从树里消失——这条把上一条钉在「遮罩里那张」上，内联那张的读数是 766×256）
        ax: { not: "关闭 lightbox.md" }
      - shot: 遮罩打开

  - name: 关闭路径一：Esc（就地消费）关闭并交还焦点
    do: key
    key: "escape"
    expect:
      - label: 遮罩已退场（放大图读数消失）
        ax: { not: "/AXImage .*@40,229 1120×374/" }
      - label: 标签栏回到 AX 树里（模态作用域撤销）
        ax: { has: "关闭 lightbox.md" }
      - label: 焦点回到编辑器（键盘落点判据，写在编辑器上）
        ax: { focused: "AXTextArea" }
      - shot: Esc 关闭后

  - name: 关闭路径二：点击遮罩（图片以外的区域）
    do: doubleClick
    target: { role: AXImage, name: "lightbox percent svg" }
    expect:
      - label: 先证遮罩开着（否则下面那条负向断言在空转）
        ax: { count: { pattern: "/AXImage .*@40,229 1120×374/", exact: 1 } }
    # 遮罩是铺满窗口的固定层（position: fixed; inset: 0），窗口局部 (600,60) 落在标签栏上方、
    # 图片以外的区域——点它即「点击遮罩」这条关闭路径。
  - name: 点击遮罩空白区关闭（坐标点击走 KimiCU 的窗口局部点）
    do: click
    target: { x: 600, y: 60 }
    expect:
      - label: 遮罩已退场
        ax: { not: "/AXImage .*@40,229 1120×374/" }
      - label: 标签栏回到 AX 树里
        ax: { has: "关闭 lightbox.md" }
      - shot: 点遮罩关闭后

  - name: 关闭路径三：遮罩内再次双击放大图
    do: doubleClick
    target: { role: AXImage, name: "lightbox percent svg" }
    expect:
      - label: 先证遮罩开着（此时这棵树里唯一的 AXImage 就是放大图）
        ax: { count: { pattern: "/AXImage .*@40,229 1120×374/", exact: 1 } }
  - name: 在遮罩内双击放大图（关闭已打开的那张）
    do: doubleClick
    target: { role: AXImage, name: "lightbox percent svg" }
    expect:
      - label: 遮罩已退场（再次双击放大图走的是「关闭」而非「重开」）
        ax: { not: "/AXImage .*@40,229 1120×374/" }
      - label: 标签栏回到 AX 树里
        ax: { has: "关闭 lightbox.md" }
      - shot: 双击放大图关闭后

  - name: 固定尺寸 svg（240×80）：双击同样打开遮罩，按自然尺寸显示
    do: doubleClick
    target: { role: AXImage, name: "lightbox fixed svg" }
    expect:
      - label: 放大图读数非零且为自然尺寸（240×80 居中：水平 40+(1120-240)/2=480，垂直 72+(688-80)/2=376）
        ax: { count: { pattern: "/AXImage .*@480,376 240×80/", exact: 1 } }
      - label: 模态接管（标签栏消失）
        ax: { not: "关闭 lightbox.md" }
      - shot: 固定尺寸 svg 放大
  - name: 关闭固定尺寸 svg 的遮罩
    do: key
    key: "escape"
    expect:
      - label: 遮罩已退场
        ax: { not: "/AXImage .*@480,376 240×80/" }

  - name: 位图（96×32）：双击同样打开遮罩，按自然尺寸显示（不放大）
    do: doubleClick
    target: { role: AXImage, name: "lightbox bitmap" }
    expect:
      - label: 放大图读数非零且为自然尺寸（96×32 居中：水平 40+(1120-96)/2=552，垂直 72+(688-32)/2=400）
        ax: { count: { pattern: "/AXImage .*@552,400 96×32/", exact: 1 } }
      - label: 模态接管（标签栏消失）
        ax: { not: "关闭 lightbox.md" }
      - shot: 位图放大
  - name: 关闭位图的遮罩
    do: key
    key: "escape"
    expect:
      - label: 遮罩已退场
        ax: { not: "/AXImage .*@552,400 96×32/" }

  - name: 全程不改写源文件（ADR 0003 §3）：编辑器内容与磁盘文件逐字节不变
    expect:
      - label: 编辑器内容与基线逐字节相同
        editor: { unchangedSince: before }
      - label: 磁盘文件 sha256 与基线相同
        file: { path: lightbox.md, unchangedSince: doc }
      - shot: 收尾
---

# 33 图片双击放大查看（lightbox）

真机（WKWebView）层的行为验收：`dblclick` 是图片放大查看的**唯一**打开路径，而 KimiCU 的注入通道
造不出 DOM 的 `dblclick`——本场景用套件的 `doubleClick` 动作（swift + `CGEvent` 显式投递
`kCGMouseEventClickState`）驱动，通道的来历与判据见
[README 的「已知边界」](../../../scripts/acceptance/README.md#已知边界写清楚别当成-bug-去追)。

## 覆盖（对应 `openspec/changes/open-image-lightbox/tasks.md` 的 6.1 / 6.2 / 6.3 / 6.5 / 8.3）

| 任务 | 本场景的承接 |
|---|---|
| 6.1 新增场景 | 本文件；三种引用形态（固定尺寸 svg / 百分比宽度 svg / 位图）各双击一次，三条关闭路径各走一遍，`Esc` 后焦点回编辑器 |
| 6.2 fixture 落库 | `fixtures: [lightbox.md, lightbox-fixed.svg, lightbox-percent.svg, lightbox-bitmap.png]`，随 `runScenario` 拷进合成 vault |
| 6.3 反向验证 | 把本场景驱动双击的两条 `do: doubleClick` 换成 `do: click`（单击）后重跑：遮罩断言必须 FAIL（现场留 `test-results/acceptance/<日期>/33-image-lightbox/`） |
| 6.5 不改写源文件 | 最后一步的两条 `unchangedSince`（编辑器内容逐字节 + 磁盘 sha256） |
| 8.3 跑一次留档 | `node scripts/acceptance/run.mjs 33`，`status.txt` = PASS，`steps.md` 逐条可读 |

## 判据口径（为什么这么写）

- **几何读数而不是文本存在性**：不可见的图在 AX 文本里照样有节点行（M178 finding，
  `docs/backlog.md` 的验收套件节），所以三条「图已渲染」的断言判的是节点行里的 `@x,y w×h` 非零。
- **遮罩开着用两条一起钉**：① 放大图的几何读数（`1120×374` 等，由窗口与 CSS padding 推导，
  与内联那张的读数不同）；② 标签栏节点从 AX 树里消失——`aria-modal` 的 dialog 会让 AX 作用域
  收到模态子树，这条把①钉在「遮罩里那张」而不是内联那张上。**只判①是不够的**：内联图也有非零
  几何读数，单靠几何无法区分两处。
- **负对照在前**：第 3 步先做一次单击（KimiCU 的 AX 索引点击），断言遮罩**没有**打开；否则后面
  「双击打开了遮罩」无法排除「随便点一下就会开」。
- **`focused` 断言走解析结果**：`ax: { focused: "AXTextArea" }` 要求 AX 里恰有一个 focused 节点
  且 role 命中——跨节点正则在这里没有节点边界意识（REVIEW.md 第 1 条）。
- **坐标口径**：`do: doubleClick` 的 `target` 取节点 bbox（AX dump 的**窗口局部**坐标），动作内部
  加 `window_bounds` 原点换成 Quartz 全局屏幕坐标再交给 swift；`do: click` 的 `{x,y}` 是 KimiCU
  的窗口局部点。两种空间不混用。

## 副作用

`doubleClick` 会**移动真实光标**并在目标窗口上产生真实点击；每条双击前场景会先拿前台
（`tryForeground`），因此跑本场景期间 Lumir 窗口需要在前台且不被遮挡——窗口被别的应用盖住时
点击会落到别的窗口上，表现为「遮罩不出现」这类与产品无关的 FAIL。
