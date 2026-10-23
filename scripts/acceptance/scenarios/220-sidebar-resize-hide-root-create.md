---
id: "220-sidebar-resize-hide-root-create"
item: 220
title: 左栏拖宽 / ⌘B 收起 / vault 根右键新建（M631）：拖宽重启保持、收起不跨启动且焦点回到文档、根右键建文件自动打开与建目录不展开
fixtures: [sidebar-probe.md]
open: sidebar-probe.md
marker: "SIDEBAR-MARK"
steps:
  - name: 启动就绪：树与文档都在场（正向锚点——这次 AX 读取是活的）
    do: settle
    expect:
      - label: 树头部入口在场（已装载 vault）
        ax: { has: "点击查看全部 vault" }
      - label: 树里有 fixture 行
        ax: { has: "sidebar-probe.md" }
      - label: 文档已打开（marker 在场）
        editor: { has: "SIDEBAR-MARK" }

  - name: 记录文档基线（宽度拖拽 / 收起 / 右键新建 MUST NOT 改这篇文档）
    do: record
    as: 场景文件
    file: sidebar-probe.md
    expect:
      - label: 基线文件存在且可读（读不到一律 FAIL）
        file: { path: sidebar-probe.md, exists: true }
      - label: 出厂口径下 config.json 没有 sidebar_width 键（拖拽前）
        file: { path: "env:config.json", not: "sidebar_width" }

  - name: 拖左栏分隔条向右 80pt：侧栏变宽并写回 config.json
    do: drag
    # 窗口宽度被套件钉在 tauri.conf 的 1200×800（README「窗口几何的确定性」），侧栏默认
    # 236 ⇒ 分隔条命中带的中线在窗口局部 x=236；y=400 落在主行（标题栏 42 / modeline 25）。
    # dx=80 ⇒ 意图宽度 316（通道抖动 ±4px，断言写成区间——见「已知边界」）。
    target: { x: 236, y: 400 }
    dx: 80
    expect:
      - label: config.json 出现 ui.sidebar_width ≈ 316（松手写一次，合并写通道）
        file: { path: "env:config.json", has: '/"sidebar_width": 3(1[2-9]|2[0-8])/' }
      - label: 合并写不抹其他键：version 仍在
        file: { path: "env:config.json", has: '"version": 1' }
      - label: editor.mode 仍在（合并写的相邻键存活证据）
        file: { path: "env:config.json", has: '"mode": "md"' }
      - label: 拖拽 MUST NOT 写 vault（sha256 与 mtime 都未动）
        file: { path: sidebar-probe.md, unchangedSince: 场景文件, mtimeUnchangedSince: 场景文件 }
      - shot: 拖宽之后

  - name: 重启：宽度从配置读回（启动真源）
    do: restart
    expect:
      - label: 重启后 sidebar_width 仍是 ≈ 316（持久化不是运行期假象）
        file: { path: "env:config.json", has: '/"sidebar_width": 3(1[2-9]|2[0-8])/' }
      - label: 树头部入口回来（vault 照常装载）
        ax: { has: "点击查看全部 vault" }
      - label: 侧栏实际宽度是拖出来的值，不是默认 236：vault 名入口的包围盒宽 > 240
        # 入口按钮是 `.ft-vault`（flex:1），宽度 = 侧栏宽 − 44（.filetree 内边距 8×2 +
        # .ft-header 内边距 16+12）。236 → ≈192、316 → ≈272：240 这条下限有区分度。
        # painted 段另证「这块区域真的有字形」（不是被祖先裁掉的空盒子）。
        geom:
          target: { role: AXButton, any: "点击查看全部 vault" }
          minWidth: 240
          minHeight: 12
          painted: { min: 60 }
      - shot: 重启之后

  - name: 打开根菜单后按 ⌘B：侧栏收起、菜单关闭、焦点回到文档
    do: click
    target: { role: AXButton, any: "点击查看全部 vault", button: right }
    expect:
      - label: 根菜单在场（本 change 新增的入口）
        ax: { has: "新建文件…" }
  - name: ⌘B 收起（焦点在左栏的菜单里）
    do: key
    key: "cmd+b"
    expect:
      - label: 侧栏内容从 AX 树里消失（display:none，不是透明度）
        ax: { not: "点击查看全部 vault" }
      - label: 开着的根菜单一并关闭（不可见元素上不留焦点）
        ax: { not: "新建文件…" }
      - label: 文档仍可读（收起只改骨架，不碰文档）
        editor: { has: "SIDEBAR-MARK" }
      - shot: 收起之后

  - name: 收起后直接在文档里键入（焦点已交还活跃文档 pane）
    do: keys
    keys: ["p", "r", "o", "b", "e"]
    expect:
      - label: 键入落进文档正文（不是不可见元素）
        editor: { has: "SIDEBAR-MARK" }
      - label: 注入的串到位（判据有区分度：出现次数口径由 runner 把关）
        editor: { has: "probe" }
  - name: 撤销这次键入（把文档退回基线，后续步骤与 teardown 仍在干净状态上判）
    do: keys
    keys: ["cmd+z"]
    expect:
      - label: 文档退回基线
        editor: { not: "probe" }

  - name: 再按 ⌘B：侧栏展开，宽度回到收起前的值
    do: key
    key: "cmd+b"
    expect:
      - label: 树头部入口回来
        ax: { has: "点击查看全部 vault" }
      - label: 树里的 fixture 行仍在（收起没重建树模型，展开后照旧在场）
        ax: { has: "sidebar-probe.md" }
      - label: 宽度仍是拖出来的值（token 未被收起改写）：入口包围盒宽 > 240
        geom:
          target: { role: AXButton, any: "点击查看全部 vault" }
          minWidth: 240
          minHeight: 12
          painted: { min: 60 }

  - name: 收起后重启：收起状态不跨启动（D2），宽度仍生效
    do: key
    key: "cmd+b"
    expect:
      - label: 先收起（重启前的在场态）
        ax: { not: "点击查看全部 vault" }
  - name: 重启 app
    do: restart
    expect:
      - label: 重启后侧栏可见（收起不持久化——每次启动都显示左栏）
        ax: { has: "点击查看全部 vault" }
      - label: 宽度仍是 ≈ 316（宽度持久化与收起不持久化是两条独立口径）
        geom:
          target: { role: AXButton, any: "点击查看全部 vault" }
          minWidth: 240
          minHeight: 12

  - name: vault 根右键：树头部弹出根级菜单（只有两条新建项）
    do: click
    target: { role: AXButton, any: "点击查看全部 vault", button: right }
    expect:
      - label: 菜单里有「新建文件…」
        ax: { has: "新建文件…" }
      - label: 菜单里有「新建子目录…」
        ax: { has: "新建子目录…" }
      - label: 根菜单不含条目项（重命名以条目为对象）
        ax: { not: "重命名…" }
      - label: 根菜单不含复制路径
        ax: { not: "复制完整路径" }
      - label: 根菜单不含在 Finder 中显示
        ax: { not: "在 Finder 中显示" }
      - label: 根菜单不含破坏性项
        ax: { not: "移到废纸篓…" }
      - label: 右键不改上下文：文档仍打开着
        editor: { has: "SIDEBAR-MARK" }
      - shot: 根级菜单

  - name: 根下新建文件：输入 root-new.md 并回车
    do: click
    target: { any: "新建文件…" }
    expect:
      - label: 行内输入框出现（新建文件的读屏名）
        ax: { has: "新建文件的名称" }
  - name: 输入文件名
    do: typeInNode
    target: { role: AXTextField, name: "新建文件的名称|root-new.md" }
    text: "root-new.md"
    expect:
      - label: 输入落地
        ax: { has: "root-new.md" }
  - name: 回车提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现根下的 root-new.md（路径 = vault 根 + 名字）
        file: { path: root-new.md, exists: true }
      - label: 新建的是空文件
        file: { path: root-new.md, has: "" }
      - label: 新文件已自动打开（标签的关闭钮读屏名 = 文件名）
        ax: { has: "关闭 root-new.md" }
      - shot: 根下新建文件并自动打开

  - name: 根下新建子目录：输入 new-folder-probe 并回车
    do: click
    target: { role: AXButton, any: "点击查看全部 vault", button: right }
    expect:
      - label: 根菜单再次在场
        ax: { has: "新建子目录…" }
  - name: 点「新建子目录…」
    do: click
    target: { any: "新建子目录…" }
    expect:
      - label: 行内输入框出现（新建子目录的读屏名）
        ax: { has: "新建子目录的名称" }
  - name: 输入目录名
    do: typeInNode
    target: { role: AXTextField, name: "新建子目录的名称|new-folder-probe" }
    text: "new-folder-probe"
    expect:
      - label: 输入落地
        ax: { has: "new-folder-probe" }
  - name: 回车提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现根下的目录
        file: { path: new-folder-probe, exists: true }
      - label: 树里出现该目录行（watcher 回响收敛）
        ax: { has: "new-folder-probe" }
      - label: 新建目录不自动打开（前台标签仍是上一步新建的文件）
        ax: { has: "关闭 root-new.md" }
      - label: 文档不被根下新建的副作用改写（前台文件仍是空的新文件）
        ax: { not: "SIDEBAR-MARK" }
      - shot: 根下新建目录

teardown:
  - label: 场景结束 fixture 文档仍是基线（宽度 / 收起 / 根新建全程对这篇文档零副作用）
    file: { path: sidebar-probe.md, unchangedSince: 场景文件, mtimeUnchangedSince: 场景文件 }
---

## 已知边界（如实登记，不包装成覆盖）

- **拖拽通道精度**：dx 是窗口局部点，CGEvent 通道有 ±1–2px 抖动；侧栏宽度是 1× 位移（不是栏宽
  的 2×），因此抖动不被放大，断言仍留 ±4px 的区间（`3(1[2-9]|2[0-8])` = 312–328）。精确值
  （+80 → 316、钳制端点 180 / 480）在 chromium 层用合成鼠标事件逐值钉死
  （`tests/visual/scenes/m631-sidebar.spec.ts`）。
- **列表尾部空白的根右键不在真机验**：`click` 的 `{x,y}` 是截图像素（1200×800 窗口 → 1152×768，
  0.96 缩放），按换算写字面量会把判据绑死在显示器缩放上。两处命中面在实现上共用**同一个**
  判据（`rootDropBandHit`，与拖拽落点同源），chromium 层对两处逐点断言；真机这层由树头部
  代表同一条判据。
- **分隔条拖拽手感 / 视觉线难度**归 Alex 手感裁决，不进机器判据（截图只作证据）。
- **新建空目录「不展开」在真机不可观测**：空目录展开与否没有可见差异。该条由「不自动打开、
  前台标签不变」这一侧证伪（新建目录若走了打开链路，标签就会变）。
- **收起时焦点交接的第二条路径**（焦点在树行的裸行上、而非菜单 / 输入框里）由 chromium 场景
  覆盖（`m631-sidebar.spec.ts` 的 ⌘B 收起测试把焦点放进 `.ft-row` 再断言焦点落回 `.cm-content`）；
  真机这层用「根菜单开着时 ⌘B」验同一条代码路径（`focusWasInSidebar`）。
