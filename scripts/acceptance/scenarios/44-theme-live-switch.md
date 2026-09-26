---
id: "44-theme-live-switch"
item: 44
title: 主题运行期切换：⌘⇧T 与 modeline 钮三档循环、逐档写回 config.json、重启后首帧持久
fixtures: [theme-mermaid.md]
open: theme-mermaid.md
marker: "主题切换图表场景"
steps:
  - name: 起点：未配置 ui.theme（出厂 light），配置文件里此刻没有 theme 键
    do: settle
    expect:
      - label: 隔离 config.json 里此刻没有 theme（后面出现的 theme 只能是切换写回写的）
        file: { path: "env:config.json", not: '"theme"' }
      - label: modeline 主题钮显示当前主题 light（常驻归因出口——真机侧唯一可读的主题读数）
        ax: { has: "主题：light（点击切换）" }
      - label: 指示钮就在 modeline 右段（它是 chrome 的常驻状态位，不是浮层）
        ax: { has: "/AXButton \\(主题：light（点击切换）\\)/" }
      - shot: 起点-light

  - name: 建立编辑器焦点（键盘注入的前置；⌘⇧T 是 global 绑定，但注入要落在前台窗口里）
    do: clickEditor
    expect:
      - label: 文档已装载（编辑器里能读到正文）
        editor: { has: "切换主题后这个块要按新主题重渲。" }

  - name: 注入前确保窗口在前台（被遮挡时 KimiCU 自报 occluded，注入可能整批丢键）
    do: focusWindow

  - name: ⌘⇧T 一档：light → dark（键盘入口，循环序 D1）
    do: key
    key: "cmd+shift+t"
    expect:
      - label: 指示钮文案变成 dark（切换已生效——键被丢掉的话就是这条先红）
        ax: { has: "主题：dark（点击切换）" }
      - label: 反向：light 不再是指示钮的文案（判据不是「两份主题同时在 AX 里」）
        ax: { not: "主题：light（点击切换）" }
      - shot: 切换-dark

  - name: 写回延时（前端不等写回结果，写是异步的）
    do: sleep
    ms: 600
    expect:
      - label: config.json 的 [ui] theme 已写回 dark（切换即写回，D3）
        file: { path: "env:config.json", has: '"theme": "dark"' }

  - name: ⌘⇧T 二档：dark → eink（eink 是系统性降级档，最容易被漏掉的一档）
    do: focusWindow
    expect:
      - label: 编辑器仍在场（切换不打断编辑焦点）
        editor: { has: "切换主题后这个块要按新主题重渲。" }

  - name: 注入 ⌘⇧T
    do: key
    key: "cmd+shift+t"
    expect:
      - label: 指示钮文案变成 eink
        ax: { has: "主题：eink（点击切换）" }
      - shot: 切换-eink

  - name: 写回延时
    do: sleep
    ms: 600
    expect:
      - label: config.json 的 [ui] theme 已写回 eink（覆盖写，不是追加）
        file: { path: "env:config.json", has: '"theme": "eink"' }
      - label: 反向：dark 已被覆盖掉
        file: { path: "env:config.json", not: '"theme": "dark"' }

  - name: ⌘⇧T 三档：eink → light（回卷，循环一周闭环）
    do: key
    key: "cmd+shift+t"
    expect:
      - label: 指示钮文案回到 light
        ax: { has: "主题：light（点击切换）" }

  - name: 写回延时
    do: sleep
    ms: 600
    expect:
      - label: config.json 的 [ui] theme 回到 light
        file: { path: "env:config.json", has: '"theme": "light"' }
      - label: 反向：eink 已被覆盖掉（循环第三档真的落地了，不是没切）
        file: { path: "env:config.json", not: '"theme": "eink"' }

  - name: 第二入口：点 modeline 主题钮 = 与命令同一条路径（再推进一档）
    do: click
    target: { role: AXButton, any: "主题：light" }
    expect:
      - label: 点击后切到 dark（钮不是只读指示，它同时是入口）
        ax: { has: "主题：dark（点击切换）" }
      - shot: 点击-dark

  - name: 写回延时
    do: sleep
    ms: 600
    expect:
      - label: 点击入口同样写回 config.json
        file: { path: "env:config.json", has: '"theme": "dark"' }

  - name: mermaid 前置：块已渲染（源码不在编辑器文本里，三态里落在 ok）
    do: open
    file: theme-mermaid.md
    marker: "主题切换图表场景"
    expect:
      - label: 正文可读（正向锚点：这次 AX 读取是活的，后面的负向断言才不是空转）
        editor: { has: "切换主题后这个块要按新主题重渲。" }
      - label: mermaid 块已渲染：源码不在编辑器文本里（widget 整块替换）
        editor: { not: "A[入口] --> B[出口]" }
      - label: 此刻不是 pending 占位
        ax: { not: "Mermaid 图表渲染中" }
      - shot: mermaid-渲染态

  - name: 建立编辑器焦点并确保前台（切换前的就位）
    do: clickEditor
    expect:
      - label: 块仍是渲染态（焦点动作不改变渲染态）
        editor: { not: "A[入口] --> B[出口]" }

  - name: 切换主题（dark → eink）：mermaid 按新主题重渲
    do: key
    key: "cmd+shift+t"
    expect:
      - label: 指示钮文案变成 eink（切换已生效）
        ax: { has: "主题：eink（点击切换）" }
      - shot: mermaid-切换瞬间

  - name: 重渲是异步的（先回落 pending 占位、经串行队列 settle），给它落地时间
    do: sleep
    ms: 2000
    expect:
      - label: 正文仍可读（正向锚点：本次 AX 读取是活的）
        editor: { has: "切换主题后这个块要按新主题重渲。" }
      - label: 重渲后仍是渲染态：源码不在编辑器文本里（旧色 SVG 不残留、也没退回源码）
        editor: { not: "A[入口] --> B[出口]" }
      - label: 没有停在 pending 占位上
        ax: { not: "Mermaid 图表渲染中" }
      - label: 也没有降级成「图表解析失败」（块本身是合法图表）
        ax: { not: "图表解析失败" }
      - shot: mermaid-切换后

  - name: 收尾：重启实例，断言首帧就是最后切换的主题（持久性闭环）
    do: restart
    expect:
      - label: 重启后 modeline 主题钮显示 eink（配置真源 → 首帧主题）
        ax: { has: "主题：eink（点击切换）" }
      - label: 反向：首帧不是 light / dark（不是「重启回落默认」）
        ax: { not: "主题：light（点击切换）" }
      - label: 反向：也不是 dark
        ax: { not: "主题：dark（点击切换）" }
      - label: config.json 里仍是 eink
        file: { path: "env:config.json", has: '"theme": "eink"' }
      - shot: 重启-首帧

  - name: 回到出厂起点（给后续场景留一个干净 config）
    do: configWrite
    theme: light
    expect:
      - label: 配置回到 light
        file: { path: "env:config.json", has: '"theme": "light"' }
---

# 主题运行期切换（change live-theme-switch / M237）

## 这个场景验什么

`[ui] theme` 从「启动读一次」升级为「运行期可切换」（本 change 修订了 restyle 节点 1 裁决 D3
的「重启生效」部分），入口有三个：命令 `view.theme-cycle`、默认键位 ⌘⇧T、modeline 右段的
主题指示钮。本场景在真机上逐档走一遍：

1. **三个入口**：⌘⇧T 连按三次走完 light → dark → eink → light 的循环；再点一次 modeline 钮
   推进一档（钮与命令是同一条实现路径）。每档断言它真的换了。
2. **切换即写回**：每次切换后读隔离 `config.json`，断言 `[ui] theme` 就是新主题，且上一档
   已被覆盖（「读到某一档」不等于「读到任意一份 config」）。
3. **mermaid 重渲**：含 mermaid 块的文档切换主题后，块必须按新主题重渲并 settle——断言它
   既没停在 pending 占位、也没降级成解析失败，且源码不再出现在编辑器文本里（仍是 widget）。
4. **持久性闭环**：重启实例，首帧（modeline 指示钮）就是最后切换的那一档。

## 主题的「生效」怎么判（如实登记，口径沿用 34 / 35 场景）

本套件**没有计算属性通道**（色值不进 AX，见 `34-restyle-theme-skeleton` 的同一节说明），
因此真机侧拿不到 `data-theme` 与 `getComputedStyle`。本场景的判据全部走两条可读通道：

- **`[ui] theme` 配置文件**：写回是否发生、写的是哪一档；
- **modeline 主题指示钮的 AX 文本**：`AXButton (主题：{主题名}（点击切换）)`——当前运行期主题的
  常驻读数（文案 D122）。指示钮的可见文本就是主题名，读屏名与悬停提示是同一句，KimiCU 的
  AX 文本里读得到。

**这是代理判据，不是「已验证 data-theme 与计算样式」**：`data-theme` 属性本身、各表面的计算
样式、eink 的组件级覆盖（chip 描边化）与 mermaid SVG 的内联色变化由 chromium 侧
`tests/visual/scenes/theme-live-switch.spec.ts` 断言（含反向验证：把 `data-theme` 与 token
往反方向改，那些断言实测会红）。两侧分工与 restyle 批的口径一致：视觉门禁守色值，
本套件守真机上的**行为链**（入口命中 → 状态改变 → 落盘 → 跨重启保持）。

## 已知边界与实测注意

- **mermaid 的「重渲后是哪一档的色」在真机上判不了**：SVG 颜色烧在内联样式里，AX 不进色值。
  本场景只判「重渲完成了、没有停在占位或降级」，色是否跟着主题走由上面那条 chromium 场景断。
- **⌘⇧T 是 chord，注入不回读重试**（套件口径：整串都是可打印单字符才回读 + 有限重试，见
  README「已知边界」）。因此单次注入可能整批丢键（REVIEW.md 第 11 条：WKWebView 间歇丢键，
  同机第二个实例显著加剧）。**红了先按丢键复跑一次再判产品缺陷**——判据本身是对的：丢键的
  表现就是指示钮文案没变，与本条的第一个断言直接对上。
- **不新增像素基线**：三张 `shot` 是给人看的证据（Alex 抽审），不做逐像素比较，与
  `35-restyle-three-themes` 同口径。
- **手感项不下沉**：指示钮的观感（chip 形态、eink 描边、与 modeline 右段的间距）归 Alex，
  本场景只留截图。
