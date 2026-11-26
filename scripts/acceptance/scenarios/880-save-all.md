---
id: "880-save-all"
item: 880
tier: full
title: 保存全部（File → Save All）：多标签脏内容一次落盘，完成终态是正向信号
fixtures: [tabs-a.md, tabs-b.md]
seed:
  registry:
    - { id: acc-save-all, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-save-all: { tabs: [tabs-a.md, tabs-b.md], active: tabs-a.md }
steps:
  - name: 等启动恢复把两个标签建出来
    do: waitFor
    waitFor:
      has: ["/AXRadioButton \\(tabs-a\\.md\\)/", "/AXRadioButton \\(tabs-b\\.md\\)/"]
    expect:
      - shot: 恢复后的标签条
      - label: 前台是 tabs-a
        editor: { has: "标签场景 A" }

  - name: 在第一个标签里键入（制造脏标签 A）
    do: type
    text: "SAVEALL-A"
    expect:
      - label: 输入落进 tabs-a
        editor: { has: "SAVEALL-A" }
      - label: 标签 A 进入未保存态（正向读数，不是靠「没有错误」推）
        ax: { has: "/AXRadioButton \\(tabs-a\\.md（未保存）/" }

  - name: 切到第二个标签并键入（制造脏标签 B；此时两个标签都脏）
    do: keys
    keys: ["ctrl+tab"]
    expect:
      - label: 前台已切到 tabs-b
        editor: { has: "标签场景 B" }
    # 切标签后立即键入：键盘注入需要前台与 key window，套件在场景开始前已抢前台。
  - name: 在 tabs-b 键入
    do: type
    text: "SAVEALL-B"
    expect:
      - label: 输入落进 tabs-b
        editor: { has: "SAVEALL-B" }
      - label: 标签 B 也进入未保存态
        ax: { has: "/AXRadioButton \\(tabs-b\\.md（未保存）/" }

  - name: 打开原生 File 菜单（保存全部的鼠标入口，菜单项不带 accelerator）
    do: click
    target: { role: AXMenuBarItem, name: "^File$" }
    expect:
      - shot: File 菜单展开
      - label: 菜单里有 Save All 一项（命令入口真的挂上了）
        node: { role: AXMenuItem, name: "^Save All$", present: true }

  - name: 点击 Save All
    do: click
    target: { role: AXMenuItem, name: "^Save All$" }

  - name: 等保存屏障的**正向完成信号**（D1035）
    do: waitFor
    waitFor:
      has: ["已保存全部更改"]
    timeoutMs: 15000
    expect:
      - shot: 保存全部之后
      - label: 完成终态上屏（缺它即判失败，不用「没有错误提示」冒充成功）
        ax: { has: "已保存全部更改" }
      - label: 失败终态 MUST NOT 出现
        ax: { not: "未能保存全部更改" }

  - name: 两个标签的内容都真的落进了 vault（磁盘判据，不是「dirty 点消失」）
    do: settle
    expect:
      - label: tabs-a 的修改已写盘
        file: { path: tabs-a.md, has: "SAVEALL-A" }
      - label: tabs-b 的修改已写盘
        file: { path: tabs-b.md, has: "SAVEALL-B" }
      - label: 原正文仍在（保存没有截断 / 覆盖错文件）
        file: { path: tabs-a.md, has: "这一段属于 tabs-a" }
      - label: tabs-b 的原正文仍在
        file: { path: tabs-b.md, has: "这一段属于 tabs-b" }
---

**判据说明（change add-acceptance-installed-app-pause）**

- 这条场景守的是产品侧「保存全部」能力的真机链路：原生 **File → Save All** 菜单项（不带
  accelerator，默认不占键位）经 `MENU_COMMAND_EVENT` 回到命令层的 `document.save-all`，
  由保存屏障依次完成「保存全部脏标签 → 标签会话 flush → 阅读位置 flush → 后端 dirty 镜像同步」。
- **正向完成信号是判据本体**：屏障全绿才发 D1035「已保存全部更改」；任一步失败发 D1036
  并保留现场。验收通道（`--pause-installed`）正是等这条信号才允许 ⌘Q，所以这里必须证明
  「信号真的会出现」，而不是只证明「文件写进去了」。
- **磁盘判据不可省**：完成信号可能被将来的改动改成「无错误即成功」，两个 fixture 的
  `file.has` 把「内容真的落盘」钉死。
- 安装版暂停通道本身（`--pause-installed`、暂停锁、⌘Q 等原 pid 消失）不在本场景的面内：
  它需要同机常驻的 `/Applications/Lumir.app`，归 `scripts/acceptance/README.md`
  「安装版显式暂停」节与 `lib/installed-app.test.mjs` 的机器判据；真实安装版的整链路验收
  登记为待真机项（本轮不执行真机）。
