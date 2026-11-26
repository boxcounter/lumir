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
  - name: 等启动恢复把两个标签建出来，并确认保存全部代次处于初始态
    do: waitFor
    waitFor:
      has: ["/AXRadioButton \\(tabs-a\\.md\\)/", "/AXRadioButton \\(tabs-b\\.md\\)/"]
    expect:
      - shot: 恢复后的标签条
      - label: 前台是 tabs-a
        editor: { has: "标签场景 A" }
      - label: 保存全部代次初始态（save-all#0 idle；本场景之前的操作没有触发过保存全部）
        node: { role: AXStaticText, name: "^save-all#0 idle$", present: true }

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

  - name: 等**本次代次**的保存全部完成标记（K3 P1-3：只认 save-all#1 ok，不认旧 toast 文本）
    do: waitFor
    waitFor:
      has: ["save-all#1 ok"]
    timeoutMs: 15000
    expect:
      - shot: 保存全部之后
      - label: 本次操作的完成标记是节点级精确形态（不是全树子串）
        node: { role: AXStaticText, name: "^save-all#1 ok$", present: true }
      - label: 旧代次 / 并发 busy / 失败态 MUST NOT 作为本次成功判据
        node: { role: AXStaticText, name: "^save-all#1 busy$", present: false }
      - label: 失败标记 MUST NOT 出现
        node: { role: AXStaticText, name: "^save-all#1 failed$", present: false }

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
- **正向完成信号是判据本体**（K3 P1-3）：产品在视觉隐藏、AX 可达的节点里维护
  `save-all#<代次> <running|ok|failed|busy>`；只有屏障全绿才写 `ok`。验收通道（`--pause-installed`）
  读取触发前的代次，只接受「代次更大且 ok」的标记，旧 toast 文本 / 同一代次的旧信号 / 并发
  busy 都不可能让它放行。场景里因此用 `node` 精确断言 `save-all#1 ok`，不再用 `ax.has` 子串。
- **磁盘判据不可省**：完成信号可能被将来的改动改成「无错误即成功」，两个 fixture 的
  `file.has` 把「内容真的落盘」钉死。
- 会话 / 阅读位置 / 后端镜像写失败与竞态由机器测试覆盖：`tests/unit/save-all.test.ts`
  （三种失败、同步等待期间新 dirty、并发单飞）与 Rust `put_reports_false_when_disk_write_fails`；
  其中**会话写失败**另有真机场景 `880b`（`envChmod` 造真实权限失败）。镜像同步失败与竞态无法从
  界面外部合成，保留在单测层。
- 安装版暂停通道本身（`--pause-installed`、暂停锁、⌘Q 等原 pid 消失）不在本场景的面内：
  它需要同机常驻的 `/Applications/Lumir.app`，归 `scripts/acceptance/README.md`
  「安装版显式暂停」节与 `lib/installed-app.test.mjs` 的机器判据；真实安装版的整链路验收
  登记为待真机项（本轮不执行真机）。
