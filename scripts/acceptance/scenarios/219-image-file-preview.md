---
id: "219-image-file-preview"
item: 219
tier: full
title: 左栏点开图片文件 → 内容区图片标签（M629）：查看面 / 双击放大 / ⌘S 无写入 / 重启恢复 / PDF 仍是 D25
fixtures: [image-tab-note.md, image-tab-preview.png, binary-probe.pdf]
open: image-tab-note.md
marker: "IMG-TAB-219"
steps:
  - name: 反向对照先行：点开 PDF 仍给「暂不支持预览」（图片分流没有误伤二进制）
    do: click
    target: { role: AXButton, name: "^binary-probe\\.pdf$" }
    expect:
      - shot: 反向-PDF 提示
      - label: 覆盖层给出既有提示（M130 起的护栏，本 change 不动它）
        ax: { has: "暂不支持预览" }
      - label: 提示点名的是被点的 PDF（判据有区分度：不是别的提示恰好在场）
        ax: { has: "暂不支持预览：binary-probe.pdf" }
      - label: 二进制不成标签（PDF 不会被当成图片或文本打开）
        ax: { not: "关闭 binary-probe.pdf" }

  - name: 记录磁盘基线（⌘S 无写入的对照物：mtime + sha256）
    do: record
    file: image-tab-preview.png
    as: png
    expect:
      - label: 图片 fixture 在左栏文件树里
        ax: { has: "image-tab-preview.png" }

  - name: 点开合成图片：内容区出现图片标签与查看面
    do: click
    target: { role: AXButton, name: "^image-tab-preview\\.png$" }
    expect:
      - shot: 图片标签
      - label: 查看面里那张图带非零几何读数（不可见的图在 AX 里也有节点行，所以判几何不判文本）
        ax: { has: "/AXImage \\(image-tab-preview\\.png\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/" }
      - label: 标签出现且标题是文件名（「关闭 …」是标签关闭钮的读屏名）
        ax: { has: "关闭 image-tab-preview.png" }
      - label: 不再出现「暂不支持预览」（上一拍的 PDF 覆盖层已被撤下）
        ax: { not: "暂不支持预览" }
      - label: modeline 右段给出「图片 · 宽×高」读数（D5；文件大小随字节数，不写死）
        ax: { has: "图片 · 48×24" }
      - label: 没有未保存标记（图片标签结构性只读）
        ax: { not: "（未保存）" }

  - name: 双击图片打开既有放大遮罩
    do: doubleClick
    target: { role: AXImage, name: "image-tab-preview\\.png" }
    expect:
      - shot: 放大遮罩
      - label: 遮罩接管（`aria-modal` 的 dialog 让标签栏从 AX 树里消失——这条把判据钉在「遮罩打开」上）
        ax: { not: "关闭 image-tab-preview.png" }

  - name: Esc 关闭遮罩，回到图片标签
    do: key
    key: "escape"
    expect:
      - label: 遮罩已退场（标签栏回到 AX 树里）
        ax: { has: "关闭 image-tab-preview.png" }
      - label: 图片仍在查看面里
        ax: { has: "/AXImage \\(image-tab-preview\\.png\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/" }
      - shot: 关闭遮罩后

  - name: 在图片标签上按 ⌘S（连按两次，换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]

  - name: 等写盘窗口过去后核对磁盘事实
    do: sleep
    ms: 800
    expect:
      - label: 图片文件 mtime 与基线相同（⌘S 在图片标签上没有落点）
        file: { path: image-tab-preview.png, mtimeUnchangedSince: png }
      - label: 图片文件 sha256 与基线相同（逐字节未变）
        file: { path: image-tab-preview.png, unchangedSince: png }
      - label: 图片标签仍在（⌘S 没有把标签关掉或改判成文档）
        ax: { has: "关闭 image-tab-preview.png" }
      - label: 没有出现未保存标记
        ax: { not: "（未保存）" }

  - name: 切回文档标签再切回图片（会话并存与切换）
    do: click
    target: { role: AXButton, name: "^image-tab-note\\.md$" }
    expect:
      - label: 文档标签的内容原样（切换不重建文档）
        editor: { has: "IMG-TAB-219" }
  - name: 再点图片标签条（点已打开的图片标签，不新开标签）
    do: click
    target: { role: AXButton, name: "^image-tab-preview\\.png$" }
    expect:
      - label: 回到图片标签（查看面重新装载后仍有非零几何读数）
        ax: { has: "/AXImage \\(image-tab-preview\\.png\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/" }
      - label: 标签数没有增长成两条同名标签（点已打开的图 = 切换到既有标签）
        ax: { count: { pattern: "关闭 image-tab-preview.png", exact: 1 } }

  - name: 等会话落盘（标签会话按防抖写盘）
    do: sleep
    ms: 1200

  - name: 重启 app（会话已落盘）
    do: restart
    expect:
      - shot: 重启后
      - label: 图片标签恢复（回到原 pane 的原位置）
        ax: { has: "关闭 image-tab-preview.png" }
      - label: 恢复后成为前台时自动装载并显示图片（MUST NOT 恢复成空标签）
        ax: { has: "/AXImage \\(image-tab-preview\\.png\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/" }
      - label: 同一会话里的文档标签也回到标签栏
        ax: { has: "关闭 image-tab-note.md" }

teardown:
  - label: 收尾：图片文件逐字节未动（全程没有任何写盘路径碰过它）
    file: { path: image-tab-preview.png, unchangedSince: png }
  - label: 收尾：PDF 探针仍在（反向判据点过的文件没有被删 / 改）
    file: { path: binary-probe.pdf, exists: true }
---

# 219 左栏点开图片文件 → 内容区图片标签（M629）

真机（WKWebView）层的行为验收，对应 `openspec/changes/add-image-file-preview/tasks.md` 的 6.1 / 6.2：

| 任务 | 本场景的承接 |
|---|---|
| 6.1 新增场景 + 合成 fixture | 本文件；`image-tab-preview.png` 是 **48×24 的纯合成位图**（单色，脚本生成，零真实内容），`image-tab-note.md` / `binary-probe.pdf` 同为合成探针 |
| 6.2 点开 png → 图片可见 | 第 2 步：AXImage 的**非零几何读数** + 标签在场 + 无「暂不支持预览」+ modeline 宽高读数 |
| 6.2 双击 → 放大遮罩 | 第 3 / 4 步：`doubleClick`（KimiCU 造不出 DOM 的 dblclick，走套件的显式 clickState 投递，见 README「已知边界」），遮罩以「标签栏从 AX 树消失」（`aria-modal`）判定 |
| 6.2 ⌘S 无写入（mtime 不变） | 第 5 / 6 步：`record` 基线 + `mtimeUnchangedSince` 与 `unchangedSince` 双判 |
| 6.2 重启后图片标签恢复并显示 | 第 9 步：`restart` 后标签在、图片仍带非零几何读数 |
| 反向：PDF 仍是 D25 | 第 0 步（反向对照**先行**：否则后面「图片能打开」无法排除「分类被放宽到全都能开」） |

## 判据口径（为什么这么写）

- **几何读数而不是文本存在性**：不可见的图在 AX 文本里照样有节点行（M178 的 finding），
  所以「图已显示」判的是节点行里的 `@x,y w×h` 非零。图片的 AX 名取 `alt`，而查看面的 `alt`
  就是 vault 相对路径（与内联图取引用原文同一条口径）——因此正则锚在 `AXImage (文件名)` 上。
- **遮罩打开判「标签栏消失」**：遮罩是 `aria-modal` 的 dialog，打开时 AX 作用域收到模态子树；
  比「放大图几何读数」更稳（后者要写死窗口尺寸推导出的坐标，窗口尺寸一变就假红）。
- **⌘S 判磁盘事实**：图片会话没有落盘基准（结构保证），但真机上唯一可信的判据是「文件没变」——
  `mtimeUnchangedSince`（不写盘）与 `unchangedSince`（sha256，逐字节）一起判。
- **重启判据前置一次落盘窗口**：标签会话按防抖写盘（`switcher.sessionChanged`），重启前
  `sleep 1200ms` 让这次写入落地；否则「重启后没有图片标签」是场景时序问题，不是产品缺陷。
- **坐标口径**：`do: click` 的 `target` 取 AX 节点（KimiCU 的 AX 索引点击）；
  `do: doubleClick` 的 `target` 取节点 bbox（AX dump 的窗口局部坐标，动作内部换成屏幕坐标）。

## 覆盖边界（如实登记，不包装成覆盖）

- **图片观感**（适配后的大小、留白、居中在真实窗口里的观感）属手感 / 审美面，按 AGENTS.md
  「真机验收套件」节「手感/审美不下沉」的口径不进机器判据——截图证据在第 2 / 3 / 9 步的 shots 里，
  由 Alex 过目。
- **切回重读一次（D3）** 的判据落在视觉套件（`fs_read_attachment` 的调用计数），本场景不重复判
  ——真机侧没有可信的「读了几次」读数通道（诊断日志不含该事件，也不该为一次读数新增事件）。
- **heic / avif 等格式能否解码**取决于系统渲染引擎（design §8 已知边界 1），本场景只用 png。
- 本场景首次真机执行由 tower 协调窗口安排（与既有套件同一跑批锁）。
