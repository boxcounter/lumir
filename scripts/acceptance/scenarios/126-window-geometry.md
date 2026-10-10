---
# M437（收尾 M434 顺延的验收空白，change startup-window-pane-defaults tasks 3.1）：主窗口的
# 启动尺寸是一条第 1 次可裁决的行为——首启 = 工作区 90%、其后按存档恢复、越界存档逐维钳制、
# 存档损坏回落首启规则。本场景是该行为的真机判据（spec: app-window）。
#
# 判据一律取**相对值**（工作区 × 比例），不写绝对像素：工作区随机器 / 分辨率 / 外接屏而变，
# 把某台机器的像素写进场景就是把一次读数当成产品口径（REVIEW.md 第 8 条）。工作区由套件的
# `lib/ax-screen.swift` 现场读 `NSScreen.visibleFrame`（与产品侧 `Monitor::work_area()` 同源），
# 经 `window: { width|height: { ofWork: 比例 } }` 折算成期望值——`window_bounds` 与它同一空间
# （逻辑点）。
#
# 「启动时的窗口尺寸存档」这个现场由 `do: restart` 的 `windowState:` 参数构造（写在停止与
# 启动之间的空窗里，见 execute.mjs 的说明）——测试在「工作区 90% / 存档尺寸 / 越界钳制 /
# 损坏回落」四态之间切换，靠的就是它。
id: "126-window-geometry"
item: 126
title: 主窗口尺寸：首启 = 工作区 90% / 二次启动按存档恢复 / 越界存档钳到工作区 / 存档损坏回落且自愈
steps:
  - name: 首启（无存档 = 首启规则）——窗口按工作区 90% 出现
    do: settle
    expect:
      # 容差 16pt：产品按**物理像素**算 90% 再折回逻辑点（四舍五入），与非 Retina 机器上的
      # 直接取整最多差 1pt；16 是给窗口管理器的摆放钳制与读数取整留的裕量（90% 与 100% 之间
      # 在本机是 128pt 的差，16 的容差不会把两档混起来）。
      - label: 窗口尺寸 ≈ 工作区 × 0.9（宽与高同一判据）
        window: { width: { ofWork: 0.9 }, height: { ofWork: 0.9 }, tol: 16 }
      - shot: 01-首启

  - name: 等尺寸防抖落盘（500ms）后核对存档形状——只含 version/width/height、无位置字段
    do: sleep
    ms: 1500
    expect:
      # 整文件正则（三键、正序、正整数）钉「存档只含这三个键」——spec 的「窗口位置不入存档」
      # 条款；`^`/`$` 在套件里带 m flag 是行边界，`\s*` 因此可跨行匹配 pretty JSON。
      - label: 存档恰含 version/width/height 三个键（键集合即形状，无位置字段）
        file: { path: "env:window-state.json", has: '/^\{\s*"version": 1,\s*"width": [1-9]\d+,\s*"height": [1-9]\d+\s*\}$/' }
      - label: 存档没有 x 键（位置不落盘）
        file: { path: "env:window-state.json", not: '/"x"\s*:/' }
      - label: 存档没有 y 键
        file: { path: "env:window-state.json", not: '/"y"\s*:/' }

  - name: 把窗口调到 1000×700（确定值通道）——等防抖落盘
    do: resizeWindow
    width: 1000
    height: 700
    settleMs: 1200
    expect:
      - label: 窗口生效尺寸 = 请求值（1000×700 在主屏工作区内，窗口管理器未再钳）
        window: { width: 1000, height: 700 }
      - shot: 02-调到-1000x700

  - name: 存档记下退出前的尺寸
    do: settle
    expect:
      - label: 存档宽度 = 1000（盘上事实与窗口读数一致）
        file: { path: "env:window-state.json", has: '"width": 1000' }
      - label: 存档高度 = 700
        file: { path: "env:window-state.json", has: '"height": 700' }

  - name: 二次启动——存档尺寸被恢复（首帧即该尺寸）
    do: restart
    expect:
      - label: 重启后窗口尺寸 = 上次退出前的 1000×700（不是首启的 90%）
        window: { width: 1000, height: 700 }
      - label: 启动未被阻断（vault 入口钮在场 = shell 装载完成的正观测）
        ax: { has: "（点击查看全部 vault）" }
      - shot: 03-二次启动恢复

  - name: 存档尺寸大于工作区（3000×2000）——重启后逐维钳到工作区
    do: restart
    windowState: { width: 3000, height: 2000 }
    expect:
      # 期望 ≈ 工作区（而非存档的 3000×2000，也不是首启的 0.9×工作区）：本机工作区宽与
      # 0.9×工作区宽差 10%（≈128pt），远大于容差 24——两档因此判得开。24 的裕量覆盖窗口
      # 摆在 x=8 时窗口管理器可能按屏宽做的收边。
      - label: 越界存档被钳到工作区尺寸以内（≈ 工作区，远小于存档的 3000×2000）
        window: { width: { ofWork: 1 }, height: { ofWork: 1 }, tol: 24 }
      - shot: 04-越界钳制

  - name: 存档损坏（截断 JSON）——重启回落首启规则、启动不被阻断
    do: restart
    windowState: { raw: '{"version":1,"width":1000' }
    expect:
      - label: 损坏存档不被采用，按首启规则（工作区 90%）出现
        window: { width: { ofWork: 0.9 }, height: { ofWork: 0.9 }, tol: 16 }
      - label: 启动未被阻断（vault 入口钮在场）
        ax: { has: "（点击查看全部 vault）" }
      - shot: 05-损坏回落

  - name: 等防抖落盘后确认存档已自愈（坏档被本次生效尺寸的合法档替换）
    do: sleep
    ms: 1500
    expect:
      - label: 存档又回到合法形状（三键、正整数）——损坏只是被跳过，不是被写坏
        file: { path: "env:window-state.json", has: '/^\{\s*"version": 1,\s*"width": [1-9]\d+,\s*"height": [1-9]\d+\s*\}$/' }
      - shot: 06-损坏后自愈
---

# 126-window-geometry —— 主窗口的启动尺寸（change startup-window-pane-defaults，spec: app-window）

## 本场景在验什么

M434 把主窗口的启动尺寸从「构建配置里的固定数字」升成一条行为：**首启 = 工作区 90%**、其后
**按存档恢复用户调过的尺寸**、存档**越界逐维钳到工作区**、存档**损坏回落首启规则且不阻断启动**。
本场景逐条在真实 WKWebView / 真实窗口管理器下判它：

1. **首启 90%**：无存档时窗口 ≈ 工作区 × 0.9（宽高同判）。
2. **存档形状**：`env:window-state.json` 恰含 `version` / `width` / `height` 三个键——**位置
   不落盘**是裁决点 1 的落盘形状。
3. **二次启动恢复**：调到 1000×700 → 存档记下 → 重启 → 窗口仍是 1000×700（既不是首启 90%，
   也不是构建配置的占位尺寸）。
4. **越界钳制**：存档 3000×2000（大于任何常见工作区）→ 重启后逐维取小钳到工作区。
5. **损坏回落 + 自愈**：存档写成截断 JSON → 重启按 90% 出现、启动不被阻断，随后防抖写回一份
   合法存档（坏档被跳过，不是被写坏）。

## 判据为什么这样写

- **相对值，不写绝对像素**：`window: { width|height: { ofWork: 比例 } }` 把工作区（现场读
  `NSScreen.visibleFrame`，与产品侧 `Monitor::work_area()` 同源）乘上比例再对 `window_bounds`
  判——换机器 / 换分辨率场景跟着走。绝对像素只在「二次启动恢复」那一步用（1000×700 是**场景
  自己请求并读回**的值，不是产品口径的副本）。
- **90% 与钳制的容差不同**（16 / 24）：前者覆盖物理↔逻辑的四舍五入与读数取整；后者还要覆盖
  窗口摆在 x=8 时窗口管理器可能按屏宽做的收边。两档之间本机差 ≈128pt，容差不会把它们混起来
  （REVIEW.md 第 1 条：判据要有区分度）。
- **存档形状用整文件正则**：spec 的条款是「只含 version / width / height，不含位置字段」——
  逐键 `has` 挡不住「多出一个 `x` 键」，整文件正则（三键、正序）才钉住键集合。顺序是 serde
  struct 字段序，稳定。
- **「启动不被阻断」用正观测**（vault 入口钮在场），不用负向断言——读不到界面与界面没报错
  是两回事（REVIEW.md 第 2 条）；就绪门本身也会在 app 起不来 / 前端未就绪时把整场判 INVALID。

## 覆盖边界（如实记录）

- **warning 行不入本场景的机器判据**：spec 说损坏存档 / 版本不符「记一条 warning」，那条走
  产品的 `eprintln` 落到 `test-results/acceptance/<日期>/app.log`——该路径不在场景可寻址面内
  （只有 `env:` 与 vault 相对路径），且 app.log 跨 run 追加，断言「含 warning」会命中上一轮的
  行而永久假绿。**本场景判的是 warning 的**行为后果**（回落 90%、启动照常、存档自愈）**；
  warning 原文由 Alex 抽审 app.log（或后续给套件加一个 `$results` 记号再补这条）。
- **不判「首帧无跳变」**：spec 要求恢复时「不以占位尺寸出现再跳变」。窗口出现后套件才开始读，
  观察不到那一拍——本场景只判稳定后的尺寸。要真判它需要从启动起的窗口尺寸轨迹，套件没有这个
  通道（`window_bounds` 是逐次读数，不是事件流）。
- **不判窗口位置**：位置不入本 capability（裁决点 1）——不施加、不持久化、不作判据，本场景
  也不断 `moved`。
- **「工作区不可得」的降级路径不判**：那要求构造「取不到任何显示器」，真机上做不到（无显示器
  就没有窗口）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；窗口尺寸存档落在隔离配置
  目录根下（`env:window-state.json`），真实 vault 只读。
- 每场景开始前套件清掉 `window-state.json`（`resetWindowState`）——否则上一场景的窗口尺寸会
  让本场景的「首启」读成非首启（跨场景串场，与 recovery / vault-sessions 同因）。
- 会 `AXRaise` 抢前台（键盘 / 就绪门纪律），跑完由套件交还；1420 全程不碰，套件走自带 1430。
- 重启三次（恢复 / 越界 / 损坏），是本场景的主要耗时。
