---
id: "35-restyle-three-themes"
item: 35
title: 三主题真机呈现（light / dark / eink 各一张截图，重启生效）与 overlay 标题栏的窗口级读数
fixtures: [keys.md]
open: keys.md
marker: "键位场景"
steps:
  - name: 出厂默认回归 light：写配置并重启（配置读一次、重启生效的既有口径）
    do: configWrite
    theme: light
    expect:
      - label: 隔离 config.json 里 ui.theme = light（对照组的起点）
        file: { path: "env:config.json", has: '"theme": "light"' }

  - name: 重启后重新打开文件（**不靠会话恢复**：套件每场景重置 vault-sessions，重启后标签列表为空；
        与 `29-typography-and-zoom` 同款口径——每个「重启 → 判定」的循环都重新走一次 open）
    do: open
    file: keys.md
    marker: "键位场景"
    expect:
      - label: 文档已装载（换主题不打断启动与打开链路）
        editor: { has: "键位场景" }
      - label: 文件树与 modeline 骨架在场（三主题共享同一套结构与排版基因）
        ax: { has: "/AXPopUpButton \\(vault：lumir-m102-acceptance（点击查看全部 vault）\\)/" }
      - shot: 主题-light

  - name: 切到 dark（configWrite + 重启）
    do: configWrite
    theme: dark
    expect:
      - label: 隔离 config.json 里 ui.theme = dark（覆盖写，不是追加）
        file: { path: "env:config.json", has: '"theme": "dark"' }
      - label: 反向：light 已被覆盖掉（判据不是「两份主题同时在」）
        file: { path: "env:config.json", not: '"theme": "light"' }

  - name: 重启后重新打开文件并取第二张
    do: open
    file: keys.md
    marker: "键位场景"
    expect:
      - label: 文档已装载
        editor: { has: "键位场景" }
      - shot: 主题-dark

  - name: 切到 eink
    do: configWrite
    theme: eink
    expect:
      - label: 隔离 config.json 里 ui.theme = eink
        file: { path: "env:config.json", has: '"theme": "eink"' }
      - label: 反向：dark 已被覆盖掉
        file: { path: "env:config.json", not: '"theme": "dark"' }

  - name: 重启后重新打开文件并取第三张
    do: open
    file: keys.md
    marker: "键位场景"
    expect:
      - label: 文档已装载
        editor: { has: "键位场景" }
      - shot: 主题-eink

  - name: 标题栏的窗口级读数（AX dump 里含各节点的 bbox，供标题栏/灯位核对）
    do: settle
    expect:
      - label: 标签在标题栏内（AXTabGroup 在场；其 bbox 与侧栏头同处顶部一带——读数见本步的 ax dump）
        ax: { has: "/AXTabGroup \\(打开的文档\\)/" }
      - label: 侧栏仍在（tabstrip 与文件树互不遮挡）
        ax: { has: "/AXButton \\(keys\\.md\\)/" }
      - shot: 标题栏-读数

  - name: 回到出厂默认（给后续场景留一个干净起点）
    do: configWrite
    theme: light
    expect:
      - label: 配置回到 light
        file: { path: "env:config.json", has: '"theme": "light"' }
---

# 三主题真机呈现（change restyle-ui-tokens-v1，tasks §9.3）

## 这个场景验什么

1. **三主题在真机上各截一张**（light / dark / eink），落
   `test-results/acceptance/<日期>/35-restyle-three-themes/shots/`，供 Alex 抽审——
   WKWebView 的真实渲染与 chromium 门禁不等价，这一层证据只能真机出（AGENTS.md 的
   「视觉门禁分层」口径）。
2. **主题切换的粒度 = 重启**（restyle 节点 1 裁决 D3：`[ui] theme` 启动读一次）：每一步都用
   `configWrite`（默认重启）而不是任何运行期命令——本场景顺带证明「改配置 → 重启 → 新主题」这条
   真实链路走通。
   **M237 修订了这一条的前提**（change `live-theme-switch`）：运行期切换通道**已经存在**了
   （`view.theme-cycle` / ⌘⇧T / modeline 主题钮，切换即写回配置）——那正是 M237 从 D3 手里
   重新启用的备选 B。本场景的断言**不受影响**（它验的是「配置 → 重启 → 首帧主题」这条链，
   与有没有运行期通道无关），但正文里「不存在运行期切换通道」的旧口径已不成立，故在此更正：
   运行期切换的专用场景是 `44-theme-live-switch`（本场景不覆盖它）。
   历史口径留着不改写正文断言：`restyle` 批交付时确实没有那条通道，本场景当时的判据成立。
3. **overlay 标题栏的窗口级读数**：`shot` 同时落 AX dump，dump 头部有 `window_bounds`，
   正文有各节点的 bbox（`@x,y w×h`）——标题栏行高、标签行与侧栏头是否同处顶部一带、
   traffic 灯区（236px 空白）与侧栏是否对齐，都可以从这份读数逐条核。

## 三主题的「生效」怎么判（如实登记）

本套件没有计算属性通道（见 34 场景的同一节说明），色值不进 AX。因此本场景对三主题的机器判据是：

- **配置层**：三步各自断言 `config.json` 里的 `ui.theme` 就是该主题，且上一步的主题已被覆盖
  （「读到 dark」不等于「读到任意一份 config」）；
- **启动层**：每次重启后文档照常装载、骨架在场（换主题不打断裂路）；
- **人眼层**：三张截图。

主题的取值正确性（三套色值、eink 的九条降级）由 chromium 场景
`tests/visual/scenes/restyle-theme.spec.ts` / `restyle-eink.spec.ts` 的计算属性断言守。

## 已知边界

- 同一份 fixture 在三主题下的截图是**同一布局、不同取值**的对照；它不是像素回归基线
  （真机截图不入 git，也不做逐像素比较）。
- KaTeX / mermaid / 图片附件未按三主题调校（proposal 的 Non-goals）：本场景的 fixture 不含这三类
  内容，因此**不覆盖**它们在 dark / eink 下的呈现——那是 R4 基线重建批次的逐张核对项
  （tasks §8.2）。
- 标题栏的可拖拽与「标题文字不显示」是窗口级、非 AX 项：证据落在本批的
  `test-results/m213/titlebar/`（截图 + 拖拽前后的窗口 bounds 读数），不在本场景的断言里。
