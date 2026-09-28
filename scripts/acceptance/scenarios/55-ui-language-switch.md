---
id: "55-ui-language-switch"
item: 55
title: 界面语言运行期切换：⌘⇧L 切到 en、chrome 文案上屏英文、写回 config.json、重启后首帧即配置语言
fixtures: [ui-language.md]
open: ui-language.md
marker: "界面语言场景"
# 起点把界面语言设成 zh（产品的出厂默认已裁为 en，切换动作必须有起点），
# 顺带验「zh 界面下的文案」这条面（M282 的迁移是纯搬运，zh 侧要逐字不变）。
config: { language: "zh" }
steps:
  - name: 起点：zh 界面（配置文件里 language = zh，modeline 语言钮显示 zh）
    do: settle
    expect:
      - label: 隔离 config.json 里是 zh（切换前的起点，后面写回 en 才是「动作生效」）
        file: { path: "env:config.json", has: '"language": "zh"' }
      - label: modeline 语言钮显示当前语言 zh（常驻归因出口——真机侧唯一可读的语言读数）
        ax: { has: "/AXButton \\(语言：zh（点击切换）\\)/" }
      - label: 树头部入口的悬停提示是中文（长驻 chrome 的 zh 取值）
        ax: { has: "/vault：.+（点击查看全部 vault）/" }
      - shot: 起点-zh

  - name: 建立编辑器焦点（键盘注入的前置；⌘⇧L 是 global 绑定，但注入要落在前台窗口里）
    do: clickEditor
    expect:
      - label: 文档已装载（编辑器里能读到正文）
        editor: { has: "切换语言后这一段必须仍是同一份内容。" }
  - name: 记下磁盘基线
    do: record
    as: 磁盘基线
    file: ui-language.md
    expect: []

  - name: 注入前确保窗口在前台（被遮挡时 KimiCU 自报 occluded，注入可能整批丢键）
    do: focusWindow

  - name: ⌘⇧L 切到 en（键盘入口，D1/D3 裁决）
    do: key
    key: "cmd+shift+l"
    expect:
      - label: 语言钮文案变成 en（切换已生效——键被丢掉的话就是这条先红）
        ax: { has: "/AXButton \\(Language: en \\(click to switch\\)\\)/" }
      - label: 反向：中文的语言提示不再是钮的文案（判据不是「两份同时在 AX 里」）
        ax: { not: "/AXButton \\(语言：zh（点击切换）\\)/" }
      - label: 正向观测（paired positive，REVIEW.md 第 2 条）：树头部入口的提示已上屏英文
        ax: { has: "/Vaults: .+\\(click to see all vaults\\)/" }
      - label: 负向断言（en 下不残留中文）：树头部入口不再有中文提示
        ax: { not: "/点击查看全部 vault/" }
      - label: chrome 的 modeline 两段也换了语言（左段的「无当前文件」类文案）
        ax: { not: "无当前文件" }
      - shot: 切换-en

  - name: 写回延时（前端不等写回结果，写是异步的）
    do: sleep
    ms: 600
    expect:
      - label: config.json 的 [ui] language 已写回 en（切换即写回）
        file: { path: "env:config.json", has: '"language": "en"' }
      - label: 反向：zh 已被覆盖（不是追加了一份）
        file: { path: "env:config.json", not: '"language": "zh"' }

  - name: 预览装饰随切换换语言（键盘路径：切换后 chrome 与装饰同步）
    do: focusWindow
    expect:
      - label: 编辑器内容未被切换动过（不改写源文件，结尾两条 unchangedSince 的前置）
        editor: { has: "切换语言后这一段必须仍是同一份内容。" }
      - label: 附件未找到的装饰句已是英文（widget 文本在 toDOM 里生成，必须随切换重建）
        ax: { has: "/Attachment not found/" }
      - shot: 装饰-en

  - name: 第二入口：点 modeline 语言钮 = 与命令同一条实现路径（切回 zh）
    do: click
    target: { role: AXButton, any: "Language: en" }
    expect:
      - label: 点击后切回 zh（钮不是只读指示，它同时是入口）
        ax: { has: "/AXButton \\(语言：zh（点击切换）\\)/" }
      - label: 反向：英文提示不再在场
        ax: { not: "/Vaults: .+\\(click to see all vaults\\)/" }
      - shot: 点击-zh

  - name: 写回延时
    do: sleep
    ms: 600
    expect:
      - label: 点击入口同样写回 config.json
        file: { path: "env:config.json", has: '"language": "zh"' }
      - label: 反向：en 已被覆盖
        file: { path: "env:config.json", not: '"language": "en"' }

  - name: 再切一次到 en（给重启闭环留一个非默认的起点）
    do: key
    key: "cmd+shift+l"
    expect:
      - label: 切到 en
        ax: { has: "/AXButton \\(Language: en \\(click to switch\\)\\)/" }

  - name: 收尾：重启实例，断言首帧就是配置语言（持久性闭环）
    do: restart
    expect:
      - label: 重启后语言钮显示 en（配置真源 → 首帧语言）
        ax: { has: "/AXButton \\(Language: en \\(click to switch\\)\\)/" }
      - label: 反向：首帧不是 zh（不是「重启回落配置之前的档」）
        ax: { not: "/AXButton \\(语言：zh（点击切换）\\)/" }
      - label: config.json 里仍是 en
        file: { path: "env:config.json", has: '"language": "en"' }
      - shot: 重启-首帧

  - name: 不改写源文件（内存与磁盘逐字节一致）
    do: settle
    expect:
      - label: 磁盘上的文件未变（基线在起点记录）——「不改写源文件」的判据就是它
        file: { path: ui-language.md, unchangedSince: 磁盘基线 }
      - label: 编辑器仍显示同一份内容（正文行在场）
        editor: { has: "切换语言后这一段必须仍是同一份内容。" }

  - name: 回到起点（给后续场景留一个 zh 界面的干净 config）
    do: configWrite
    language: zh
    expect:
      - label: 配置回到 zh
        file: { path: "env:config.json", has: '"language": "zh"' }
---

# 界面语言运行期切换（change ui-language-i18n / M282）

## 这个场景验什么

`[ui] language` 从「只写不改」升级为**运行期可切换**（D1/D2/D3 裁决），入口有两个：
命令 `view.language-cycle`（默认 ⌘⇧L）与 modeline 右段的**语言指示钮**（与主题钮同族，
两处走同一条实现路径）。本场景在真机上走一遍：

1. **起点 zh**：产品默认语言已裁为 `en`，因此切换动作必须有起点——场景的 front-matter
   把 `ui.language` 设成 `zh`（走真实的配置消费点，不是桩）。这一半同时验「zh 侧逐字不变」
   （迁移是纯搬运）。
2. **切换即生效**：⌘⇧L 切到 `en` 后，语言钮、树头部入口的 `title`/`aria-label`、
   modeline 两段、以及**预览装饰**（附件未找到的 widget 文本）都要换成英文；
   同时用 `ax: { not: ... }` 断言 en 下**不残留中文**（负向断言配一条正观测，REVIEW.md 第 2 条）。
3. **切换即写回**：读隔离 `config.json` 断言 `[ui] language` 就是新档，且上一档已被覆盖。
4. **第二入口**：点 modeline 语言钮切回 `zh`，行为与命令逐项一致（同一条实现路径）。
5. **持久性闭环**：重启实例，首帧（语言钮）就是配置里的那一档。
6. **不改写源文件**：结尾一条 `unchangedSince`（磁盘上的文件逐字节不变）。**编辑器侧的
   `unchangedSince` 在本场景不适用**：本场景的文档带一个「附件未找到」的预览 widget，而
   `editor` 通道读的是 AX 文本——widget 的文本随语言合法地变化（实测拿到
   `附件未找到：…` → `Attachment not found: …`），用它判「内容没变」会把产品做对的事判成红。

## 判据为什么这样选（如实登记）

- **语言「生效」怎么判**：真机侧读不到 `documentElement.lang`（属性不进 AX），因此判据是
  **可见文案本身**——语言钮的 AX 文本（`Language: en (click to switch)`）、树头部入口的提示、
  modeline 两段、以及预览装饰的文本。指示钮的可见文本就是语言档本身（读数不译文）。
- **负向断言必须配对**：`ax: { not: "/点击查看全部 vault/" }` 这类「不残留中文」的断言，
  在同一步里有正向观测（`Vaults: … (click to see all vaults)` 确实上屏）——否则一次
  「AX 读不到」会与「文案没换」表现相同（REVIEW.md 第 2 条）。
- **⌘⇧L 是含修饰的注入**，套件口径下不回读重试（见 README「已知边界」）：单次注入可能整批
  丢键（REVIEW.md 第 11 条）。**红了先按丢键复跑一次再判产品缺陷**——丢键的表现就是语言钮
  文案没变，与本条的第一个断言直接对上。
- **装饰的判据走 AX 而不是编辑器文本**：附件未找到的提示是 CM widget（源码已被替换），
  `data-degraded` 一类属性上屏的路径在 chromium 侧由
  `tests/visual/scenes/m282-ui-language.spec.ts` 断言；真机侧只判「AX 里读到英文提示」。
- **不新增像素基线**：`shot` 是给人看的证据（Alex 抽审），不做逐像素比较，与 44 场景同口径。
- **日志面不进语言面**（终裁）：本场景不构造配置告警，日志文本随语言不变这一条由
  `docs/backlog.md` 的边界条目与 `src/copy-data.ts` 的说明记账（构造一条非法配置再断言
  日志原文不变会与「启动配置回落」路径耦合，收益不成立）。
- **手感项不下沉**：语言钮的观感（chip 形态、与主题钮/版本号段的间距、窄窗退让）归 Alex，
  本场景只留截图。
