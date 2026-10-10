---
id: "119-toast-anchor-pane"
item: 119
title: toast 锚定发起 pane 右下角（分栏态不跨 pane）
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: ⌥S 分栏——右侧出现空 pane（分栏成立、右 pane 为纯底色区域）
    do: key
    key: "alt+s"
    expect:
      - label: 分隔条出现（分栏成立）
        ax: { has: "分隔条" }
      - label: 空 pane 引导水印上屏（右 pane 是空 pane——它的右下角因此是纯底色，负向取样的前提）
        ax: { has: "它就会在这里打开" }

  - name: 点左 pane 的编辑器建立焦点（clickEditor 取 AX 里第一个 AXTextArea = 左 pane）
    do: clickEditor
    expect:
      - label: 左 pane 成为活跃 pane（modeline 恢复当前文件；右 pane 空态时是 D207「无当前文件」）
        ax: { not: "无当前文件" }

  - name: 在左 pane 里写一字（dirty —— 只有脏文档 ⌘S 才真写盘并出「已保存」浮条）
    do: type
    text: "TOASTANCHOR"
    expect:
      - label: 输入落进左 pane 的文档
        editor: { has: "TOASTANCHOR" }

  - name: ⌘S 保存左 pane 的文档
    do: key
    key: "cmd+s"

  - name: 等「已保存」浮条出现（保存成功后 transient 浮条只停 3.5s，出现即断言）
    do: waitFor
    waitFor:
      has: ["已保存"]
    timeoutMs: 10000
    expect:
      - label: 保存成功浮条上屏
        ax: { has: "已保存" }
      - shot: 01-浮条锚定左pane
      - label: 浮条落在**左 pane（发起 pane）**右下角——该处与右 pane 空白底色异色（M420 的 O4；若浮条被裁 / 没画，此处就是纯底色，「异色」随之失败）
        pixel:
          differ:
            - [ { x: 694, y: 755, as: "左 pane 右下角" }, { x: 1100, y: 200, as: "右 pane 空白" } ]
      - label: 浮条**不在右 pane**（未跨 pane）——右 pane 右下角与空白底色同色
        pixel:
          same:
            - [ { x: 1177, y: 755, as: "右 pane 右下角" }, { x: 1100, y: 200, as: "右 pane 空白" } ]
          tol: 12
---

# 119-toast-anchor-pane —— toast 锚定发起它的 pane 右下角（M420）

## 本场景在验什么

Alex 2026-10-10 原话：「提示信息，比如（Saved!），改为在 pane 右下角显示，而不是在 app 整个
窗口的右下角。因为后者可能是另一个 pane 或者 harness，UX 逻辑不准确。」

改前 toast 挂在**整个编辑器列**（`.pane-editor`）上：单 pane 时它就是文档 pane 的右下角，看不出
问题；一旦分栏，编辑器列的右下角就是**右 pane**（可能是 harness），于是「左 pane 里保存」的
提示被画到右 pane 上——「提示属于谁」与「它画在哪」错位。修法是把 toast 挂到发起 pane 的挂载
元素 `.editor-pane`（`src/main.ts` 的 `toastOwnerMount()`），单 pane 时与旧包含块几何等价
（零基线漂移），分栏时才把提示收进各自的 pane。

本场景在**分栏态**下触发左 pane 的保存浮条，断言它落在左 pane 的右下角、且不在右 pane。
断言基准是合同 `docs/specs/overlay-visibility.md` 的 **O4**（锚定到发起它的区域，不跨 pane）
与 O1/O2（打开即完整可见、落在视口内）。

## 断言口径

- **触发面**：`open: plain.md`（短文档，正文只占顶部）→ ⌥S 分栏（右 pane 空态、纯底色）→
  `clickEditor` 把焦点放回左 pane（`clickEditor` 取 AX 里第一个 `AXTextArea` = DOM 序在前
  的左 pane）→ `type` 写一字（dirty）→ ⌘S。只有脏文档 ⌘S 才真写盘并出「已保存」（
  `src/save-controller.ts` 的 `saveDocument`：`!isDirty` 直接 return）。
- **浮条只停 3.5s**（无动作钮的 transient toast，`src/main.ts`）：所以触发后紧跟 `waitFor`
  出现即断言，MUST NOT 先 `settle` 再断言（settle 的 ~1.4s 会吃掉停留窗口）。
- **`pixel` 判位置与「画出来了」（两步合一的相对判据）**：
  - 左 pane 右下角样本（窗口局部点 694,755）落在浮条壳的**右内边距**上（浮条 right:16、
    右 padding 14 ⇒ 该点总在壳的纯底色带里，与文案长短无关）。它与右 pane 空白底色
    **异色** ⇒ 浮条确在左 pane 且确被绘制（被祖先裁掉 / 没画则此处是纯底色，异色失败）。
  - 右 pane 右下角样本（1177,755）与同一块空白底色**同色** ⇒ 浮条没跨到右 pane。
  - 两个判据都相对（与「右 pane 空白」比），不写绝对色值——色值真源在 token 层
    （REVIEW.md 第 8 条）。**反向性**：把归属改回「挂整个编辑器列」（缺陷形态），浮条落到
    (1200−16) 处 ⇒ 右 pane 样本变壳底色、与空白异色 ⇒ `same` 判红；左 pane 样本变纯底色
    ⇒ `differ` 判红。两条都有区分度。
- **O1（被裁）的读数落在 `pixel` 上，不是 `geom`**：M397 的 `geom` 断言（几何 + 绘制两段）
  需要有 **bbox 的可定位节点**（它据此取包围盒再扫亮度跨度）。浮条在 WKWebView 的 AX 里只有
  一个 **无 bbox** 的 `AXStaticText`（实测：`119-toast-anchor-pane/ax/01-*.txt` 的
  `[239] AXStaticText = "已保存"`，同层没有带 bbox 的容器节点；加 `role="status"` 也不产出
  容器节点，已如实回退），因此 `geom` 对浮条**无从取值**（真机实测报「没有 bbox」，M420）。
  等价的 O1 读数是上面那条 `differ`：浮条若被祖先裁掉 / 没画，左 pane 右下角就是纯底色，
  与空白**同色** ⇒ 判红——这正是 `geom` 绘制段要抓的形态，且同样有反向区分度。合同
  `overlay-visibility.md` 的 ④ 已把「真机层用窗口截图的相对取色承担」写进证伪口径。
- **坐标口径**：`pixel` 采样点是**窗口局部点**（1200×800，与 click/drag 的 `{x,y}` 同空间；
  套件把窗口钉在 x=8 y=40、尺寸取 `src-tauri/tauri.conf.json` 的 1200×800）。左栏 236、
  编辑器列 964、doc/doc 分栏比例 0.5、分隔条净占 1px ⇒ 左 pane 右缘 ≈ 716.5–717.5。样本按
  这些**布局 token 与分栏比例**算得，token 变了本场景要跟着重标。

## 已知边界（如实登记）

- **`geom` 对浮条不适用（如实登记，非本场景的遗漏）**：`geom` 断言要先定位到一个**有 bbox 的
  节点**（与视口比边界）。浮条在 WKWebView 的 AX 里没有这样的节点——它只有一个无 bbox 的
  `AXStaticText`（同层无容器）；加 `role="status"` 也不产出容器节点（M420 实测，已回退该属性）。
  因此 O1 的读数改由 `pixel` 的相对取色承担（见上），这是通道边界不是覆盖缺口。
- **绘制读数的前提**：它证明「该采样点不是纯底色」，前提是该区域在浮条不在时是**纯底色**（本
  场景成立：左 pane 的文档短、右下角是空白纸面）。若浮条压着别处的正文，「不是纯底色」会恒真
  ——那时判据要换成壳底色的同/异色对（与 `geom` 绘制段的边界同宗，见合同 O1 节）。
- **样本点按布局 token 算得**：左栏 236、编辑器列 964、doc/doc 比例 0.5、分隔条净占 1px、
  浮条 `right:16` / 右 padding 14。任一 token 或分栏默认比例变了，本场景要按实测重标（坐标
  写死是它的已知脆点；换机分辨率不同也会偏——套件把窗口钉在 1200×800，故本场景依赖该尺寸）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；写入 `plain.md` 的
  `TOASTANCHOR` 落在验收 vault（非用户真实 vault）。1420 全程不碰（实例走
  `LUMIR_ACCEPTANCE_PORT=1430`）。
