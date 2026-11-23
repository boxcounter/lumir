---
# change global-line-numbers-toggle-nov23：行号全局开关的真机链路。
#
# 为什么这条判据只能在真机层：on / off 的唯一观测面是**行号 gutter 是否在场**，而 CM 给
# `.cm-gutters` 带 `aria-hidden="true"` —— WKWebView 的 AX 树里没有它（场景 56 的已登记边界）。
# 因此 oracle 取**行号 gutter 的右键复制**（change gutter-copy-path-line-nov21 的既有手势）：
# 剪贴板拿到 `{path}:{line}` ⇒ gutter 在场；拿不到 ⇒ 不在场。它是本场景里唯一的在场判据，
# MUST NOT 用截图人工目测代替（截图只作形态证据）。
#
# 坐标口径与场景 707 相同（md：AXTextArea bbox 的 dx:-0.015 / dy:0.01；code：dx:-0.112 /
# dy:0.058），不在此重复解释——两处必须同步，改一处前先读 707 的文件头。
#
# 覆盖边界（如实登记）：
#   - 双 pane 的同步在 chromium 层判（tests/visual/scenes/m281-goto-line.spec.ts）；本场景用
#     **后台标签**（⌘2 / ⌘1）验「切走再切回已是新态」，不花一次分栏的坐标成本。
#   - 指示钮的点击用 AXButton 定位（它的可见文本是 `on` / `off` 读数）；按钮本身在 AX 里可读，
#     与 gutter 不同——因此「点它」这条路能在真机走通。
#   - 剪贴板哨兵：负向断言前先写一个哨兵串，右键后断言剪贴板**仍含哨兵**（`clipboard.not` 判
#     不含 `{path}:1`，`has` 判哨兵仍在）——只判「不含路径」会在剪贴板不可读时假绿。
#   - **⌥G 的焦点前置**：它是 `editor` 作用域命令；`do: open` 打开已存在的标签时焦点留在 chrome
#     上（spec 已知边界①），每次 `⌥G` 前先 `clickEditor` 并断言 `focused: AXTextArea`。
#   - **负向右键 → 原生菜单**：开关为 off 且输入条关闭时没有 gutter，右键落在正文上由产品交回
#     默认行为，WKWebView 弹出原生菜单（Look Up / Translate / Reload…）。原生菜单会吞掉后续
#     键盘与第一次鼠标动作（README 的 post-menu 边界）——这是手势副作用，不是产品缺陷。每个
#     负向右键之后 MUST 用 `Escape` 关菜单并以 `ax: not /AXMenuItem/` 证明它已消失，再继续。
#   - **成功 toast 的存续窗**：`已复制` toast 在屏上数秒；「没有成功提示」这类负向断言 MUST 先
#     `waitFor: not 已复制` 等到上一条消退，否则被陈旧 toast 污染（M135 的「读不到当空」同族）。
id: "722-line-numbers-toggle"
item: 722
tier: full
title: 行号全局开关真机链路——默认 off 两模式都无 gutter（右键 oracle 拿不到）、⌘⇧N 与 modeline 指示钮同源切换、on 档两模式可复制、off + ⌥G 的临时 gutter 可复制、切换持久化与重启、后台标签切回已是新态、on → ⌥G → 切 off 的交叉态
fixtures: ["gutter 空格 中文.md", "block-copy.txt"]
open: "gutter 空格 中文.md"
marker: "GUTTER-707-MARKER"
config:
  lineNumbers: off
steps:
  - name: 起点：md 文档已打开、默认 off、gutter 不在场
    do: settle
    expect:
      - label: 正向锚点——文档可读（fixture 首行 marker）
        editor: { has: "GUTTER-707-MARKER" }
      - label: 配置是 off（显式写出厂档，避免依赖「键缺席」的默认推断）
        file: { path: env:config.json, has: "\"line_numbers\": \"off\"" }
      - shot: off-md-起点

  - name: 建立编辑器焦点（右键 / 快捷键的前置）
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 写入剪贴板哨兵（负向断言的可读基线；读不到一律 FAIL）
    do: clipboardText
    text: "LINENUMS-SENTINEL-OFF"

  - name: off 档在 md 的原 gutter 位置右键：没有 gutter ⇒ 没有复制、没有反馈
    do: click
    target: { role: AXTextArea, button: right, dx: -0.015, dy: 0.01 }
    expect:
      - label: 剪贴板仍是哨兵（没有写入 `{path}:1`）
        clipboard: { has: "LINENUMS-SENTINEL-OFF" }
      - label: 剪贴板不含复制结果
        clipboard: { not: "gutter 空格 中文.md:1" }
      - label: 没有成功提示
        ax: { not: "已复制" }

  # 负向右键落在**没有** gutter 的正文上，产品不接管 contextmenu（预期行为）⇒ WKWebView 弹出
  # 原生菜单。原生菜单会吞掉后续键盘（README 的 post-menu 边界，M498/M456）——这是本场景的
  # 手势副作用，不是产品缺陷。先关菜单并以 AX 判据证明它真的关了，再重建编辑器焦点。
  - name: 关闭负向右键弹出的原生菜单（Escape）
    do: key
    key: escape
  - name: 等原生菜单从 AX 里消失（收起有动画延迟，必须轮询而不是读一拍）
    do: waitFor
    waitFor:
      not: ["/AXMenuItem/"]
    timeoutMs: 3000

  - name: 重建编辑器焦点（⌥G 是 editor 作用域；负向右键不保证焦点仍在正文里）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: ⌥G 打开跳转输入条：off 档的临时 gutter 由它带出
    do: key
    key: "alt+g"
    expect:
      - label: 输入条在场（临时 gutter 同拍装上）
        ax: { has: '/AXTextField = "1"/' }
      - shot: off-md-临时-gutter

  - name: 右键临时 gutter 首行：临时档与常驻档同一手势
    do: click
    target: { role: AXTextArea, button: right, dx: -0.015, dy: 0.01 }
    expect:
      - label: 剪贴板 = 路径 + 第 1 行（oracle 成立 ⇒ 临时 gutter 在场）
        clipboard: { exact: "gutter 空格 中文.md:1" }
      - label: 成功提示逐字回显
        ax: { has: "已复制 gutter 空格 中文.md:1" }

  - name: Escape 收起输入条（临时 gutter 随之卸除）
    do: key
    key: escape
    expect:
      - label: 输入条已收起
        ax: { not: "AXTextField" }

  - name: ⌘⇧N 切到 on（焦点在编辑器内）
    do: key
    key: "cmd+shift+n"
    expect:
      - label: modeline 行号指示钮读数为 on（读数不译文的可见文本）
        ax: { has: "on" }
      - label: 切换已即时回写配置
        file: { path: env:config.json, has: "\"line_numbers\": \"on\"" }
      - shot: on-md-常驻

  - name: 写入剪贴板哨兵（on 档的正向 oracle 基线）
    do: clipboardText
    text: "LINENUMS-SENTINEL-ON"
  - name: 右键 md gutter 首行（此时常驻）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.015, dy: 0.01 }
    expect:
      - label: 剪贴板 = 路径 + 第 1 行（oracle 成立 ⇒ on 档 gutter 常驻）
        clipboard: { exact: "gutter 空格 中文.md:1" }
      - shot: on-md-右键后

  - name: 打开 code 文件（同一开关对 code 生效）
    do: open
    file: block-copy.txt
    marker: "纯文本文件"
    expect:
      - label: code 文件已装载到前台
        ax: { has: "纯文本文件" }
  - name: 右键 code gutter 首行（code 系数）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.112, dy: 0.058 }
    expect:
      - label: 剪贴板 = 路径 + 第 1 行（on 档 code gutter 常驻）
        clipboard: { exact: "block-copy.txt:1" }
      - shot: on-code-右键后

  - name: 再按一次 ⌘⇧N 切回 off
    do: key
    key: "cmd+shift+n"
    expect:
      - label: 配置已回写 off
        file: { path: env:config.json, has: "\"line_numbers\": \"off\"" }
  - name: 等上一条「已复制」toast 自行消退（负向断言的前置；toast 存续约数秒）
    do: waitFor
    waitFor:
      not: ["已复制"]
    timeoutMs: 6000
  - name: 写入哨兵并右键 code 的原 gutter 位置（off ⇒ 没有 gutter）
    do: clipboardText
    text: "LINENUMS-SENTINEL-OFF2"
  - name: off 档在 code 的原 gutter 位置右键
    do: click
    target: { role: AXTextArea, button: right, dx: -0.112, dy: 0.058 }
    expect:
      - label: 剪贴板仍是哨兵（没有复制动作）
        clipboard: { has: "LINENUMS-SENTINEL-OFF2" }
      - label: 剪贴板不含复制结果
        clipboard: { not: "block-copy.txt:1" }
      - label: 没有成功提示
        ax: { not: "已复制" }

  - name: 关闭负向右键弹出的原生菜单（Escape）
    do: key
    key: escape
  - name: 等原生菜单从 AX 里消失（收起有动画延迟，必须轮询而不是读一拍）
    do: waitFor
    waitFor:
      not: ["/AXMenuItem/"]
    timeoutMs: 3000

  - name: 点击 modeline 行号指示钮（另一条同源入口）
    do: click
    target: { role: AXButton, name: "行号：off（点击切换）" }
    expect:
      - label: 钮的可见读数变为 on
        ax: { has: "行号：on（点击切换）" }
      - label: 配置同步回写 on
        file: { path: env:config.json, has: "\"line_numbers\": \"on\"" }
  - name: 右键 code gutter 首行（钮点击的 oracle 复核）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.112, dy: 0.058 }
    expect:
      - label: 剪贴板 = 路径 + 第 1 行（钮与命令同源 ⇒ gutter 已常驻）
        clipboard: { exact: "block-copy.txt:1" }

  - name: 再点一次钮切回 off
    do: click
    target: { role: AXButton, name: "行号：on（点击切换）" }
    expect:
      - label: 钮的可见读数回到 off
        ax: { has: "行号：off（点击切换）" }

  - name: 交叉态：on → ⌥G（临时 / 常驻都在场）→ ⌘⇧N 切 off → 收起输入条
    do: key
    key: "cmd+shift+n"
    expect:
      - label: 回到 on（交叉态的起点）
        file: { path: env:config.json, has: "\"line_numbers\": \"on\"" }
  - name: 打开 md 文档（交叉态在 md 上跑）
    do: open
    file: gutter 空格 中文.md
    marker: "GUTTER-707-MARKER"
  - name: 重建编辑器焦点（打开已存在的标签时焦点留在 chrome 上，⌥G 是 editor 作用域）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: ⌥G 打开输入条
    do: key
    key: "alt+g"
    expect:
      - label: 输入条在场
        ax: { has: '/AXTextField = "1"/' }
  - name: 输入条打开期间按 ⌘⇧N 切到 off
    do: key
    key: "cmd+shift+n"
    expect:
      - label: 已切到 off
        file: { path: env:config.json, has: "\"line_numbers\": \"off\"" }
  - name: 切到 off 的瞬间右键 gutter（输入条还开着 ⇒ 临时 gutter 仍在场）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.015, dy: 0.01 }
    expect:
      - label: 剪贴板 = 路径 + 第 1 行（交叉态没有错误卸除临时 gutter）
        clipboard: { exact: "gutter 空格 中文.md:1" }
      - shot: 交叉态-切-off-临时-gutter 仍在
  - name: Escape 收起输入条后，原 gutter 位置不再能复制
    do: key
    key: escape
    expect:
      - label: 输入条已收起
        ax: { not: "AXTextField" }
  - name: 写入哨兵
    do: clipboardText
    text: "LINENUMS-SENTINEL-X"
  - name: 收起后在原 gutter 位置右键
    do: click
    target: { role: AXTextArea, button: right, dx: -0.015, dy: 0.01 }
    expect:
      - label: 剪贴板仍是哨兵（gutter 已随输入条收起）
        clipboard: { has: "LINENUMS-SENTINEL-X" }
      - label: 剪贴板不含复制结果
        clipboard: { not: "gutter 空格 中文.md:1" }

  - name: 关闭负向右键弹出的原生菜单（Escape）
    do: key
    key: escape
  - name: 等原生菜单从 AX 里消失（收起有动画延迟，必须轮询而不是读一拍）
    do: waitFor
    waitFor:
      not: ["/AXMenuItem/"]
    timeoutMs: 3000

  # 后台标签的覆盖口径（评审 P2-1）：**先创建后台标签、再在它处于后台时切换开关**。
  # 若先切 on 再开 code，code 会话创建时就读到 on——即使 `reconfigureGutter()` 漏掉后台会话，
  # 这段也会 PASS（假覆盖，REVIEW.md「覆盖声明超出真实验证」条）。
  - name: 先打开 code 文件作为第二个标签（此时开关仍是 off）
    do: open
    file: block-copy.txt
    marker: "纯文本文件"
  - name: ⌘1 切回 md 标签（code 留在后台）
    do: key
    key: "cmd+1"
    expect:
      - label: 回到 md 文档
        editor: { has: "GUTTER-707-MARKER" }
  - name: 在 code 处于后台时按 ⌘⇧N 切到 on（覆盖后台会话的 state 重配）
    do: key
    key: "cmd+shift+n"
    expect:
      - label: 已切到 on
        file: { path: env:config.json, has: "\"line_numbers\": \"on\"" }
  - name: 右键 md gutter 首行（前台 md 即时生效）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.015, dy: 0.01 }
    expect:
      - label: 剪贴板 = 路径 + 第 1 行
        clipboard: { exact: "gutter 空格 中文.md:1" }
  - name: ⌘2 切到 code 标签（后台期间已切 on ⇒ 切回即新态，不是切回时才补）
    do: key
    key: "cmd+2"
    expect:
      - label: code 文件在前台
        ax: { has: "纯文本文件" }
  - name: 右键 code gutter 首行（后台标签切回已是新态）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.112, dy: 0.058 }
    expect:
      - label: 剪贴板 = 路径 + 第 1 行（后台会话经 state 重配，不是切回时才补）
        clipboard: { exact: "block-copy.txt:1" }

  - name: 重启（持久化：启动真源 = config.json）
    do: restart
    expect:
      - label: 重启后仍是 on（配置值）
        file: { path: env:config.json, has: "\"line_numbers\": \"on\"" }
  - name: 重启后打开 md 文档
    do: open
    file: gutter 空格 中文.md
    marker: "GUTTER-707-MARKER"
  - name: 右键 md gutter 首行（重启后首帧即有 gutter 的 oracle）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.015, dy: 0.01 }
    expect:
      - label: 剪贴板 = 路径 + 第 1 行（重启后 gutter 仍在，on 是启动真源）
        clipboard: { exact: "gutter 空格 中文.md:1" }
      - shot: 重启后-on-md
---

# 场景 722：行号全局开关（change `global-line-numbers-toggle-nov23`）

Alex 2026-11-23 裁决：行号不再区分 md / code，合并为一个全局二元开关，`⌘⇧N` + modeline 指示钮
两个入口、切换即持久化。节点 1 的七项取舍见 change 的 `proposal.md`；本场景判**真机 WKWebView
上的行为链路**，chromium 层（`tests/visual/scenes/m281-goto-line.spec.ts`）判几何与像素。

## 判据为什么这样写

- **在场 oracle = 行号 gutter 的右键复制**：CM 的 gutter 带 `aria-hidden`，AX 读不到；剪贴板是系统级
  副作用、可逐字断言。拿到 `{path}:{line}` ⇒ gutter 在场，拿不到 ⇒ 不在场（与场景 707 同一手势，
  不新增第二套判据）。
- **负向断言先写哨兵**：只判「剪贴板不含路径」会在剪贴板不可读时假绿（REVIEW.md「读不到当成空」条）。
  每轮负向断言前用 `clipboardText` 写一个哨兵串，同时判「哨兵仍在」与「不含复制结果」。
- **指示钮按读屏名定位**：它的可见文本是 `on` / `off` 读数，`aria-label` 是 D974 的模板
  （`行号：{state}（点击切换）`）——按钮在 AX 树里可读，按名字点它比按坐标稳。
- **持久化**：每次切换后读 `env:config.json` 的 `"line_numbers"`；重启后再用右键 oracle 复核
  首帧即生效（启动真源，不是运行期补丁）。
- **交叉态**：`on` 下 `⌥G` 后切 `off`，输入条还开着 ⇒ 临时 gutter 必须仍可复制；Escape 收起后
  恢复不可复制。它锁住 `setGotoLineGutterVisible` 的赋值顺序（design §4.2：标志先写、再按常驻
  开关提前 return）。

## 覆盖边界（如实记账，别读成「全验过」）

- **双 pane 的同步不在本场景**：分栏后右 pane 的 AX 坐标不稳定（两个 AXTextArea），本场景只验
  **后台标签**切换（⌘1 / ⌘2）。双 pane 的「两个 pane 同时变化」由 chromium 场景
  `m281-goto-line.spec.ts` 断言。
- **写回失败（磁盘只读）不在真机场景**：真实只读盘不是可复现的构造；降级路径（toast + 不回滚）
  由 chromium 场景以 `failures.config_set_ui_value` 注入覆盖。
- **行号的视觉形态**（三主题、等宽、窄窗不溢出、几何逐值不变）归 chromium 视觉层，本场景只看
  剪贴板 oracle 与配置文件。
- **⌘⇧N 的系统级占用**已在实现期实机复核（`defaults export com.apple.symbolichotkeys`：key code 45
  只有条目 19、修饰键 = ⌘⌥ 且 disabled），结论写进表条目 D973；本场景不是这条核实的重复判据。
