---
# change harness-path-link 的真机判据：harness 面板里 agent 输出中的 vault 路径可点击，
# 点击以**新标签**打开（已打开时不重复开）、工具卡片的结构化路径可点、不存在的路径 / 目录 /
# 越界路径保持纯文本。正文里的 `:行号` 落点由截图人工判读（AXTextArea.value 是整个文档文本，
# 套件没有 scrollTop 读数——与 CL-1 / CL-2 的同一已知边界，见正文「覆盖边界」）。
id: "161-harness-path-link"
item: 552
title: harness 输出里的 vault 路径可点击（新标签 + 行号锚定 + 卡片路径）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-path-link.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板以旁侧 pane 出现（发送钮在场是 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 造一个嵌套目录里的目标文件（真实目录 + 文件；同时给「目录不链接化」造现场）
    do: vaultWrite
    file: "path-link-dir/keep.md"
    content: "# 嵌套目标\n\nPL-NESTED-KEEP\n"

  - name: 等 watch 增量把新文件送进索引（外部写入没有 UI 信号，留一拍再发问）
    do: sleep
    ms: 1200

  - name: 点 composer 聚焦并输入提问
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|plmark" }
    text: "plmark"
    expect:
      - label: 提问落进 composer（注入落地的正观测）
        ax: { has: "plmark" }
  - name: 发送
    do: key
    key: enter

  - name: 等 mock 回答与工具行渲染完
    do: waitFor
    waitFor:
      has: ["路径链接验收"]
    timeoutMs: 30000

  - name: 路径可点性：正文（含行号）/ 嵌套文件 / 工具卡片
    do: settle
    expect:
      - label: 正文里带行号的路径是可点元素（AXButton，名字 = 原文含 :12）
        ax: { has: '/AXButton \(path-link-target\.md:12\)/' }
      - label: 嵌套目录里的文件路径可点（watch 增量已进索引）
        ax: { has: '/AXButton \(path-link-dir/keep\.md\)/' }
      - label: 工具卡片上的结构化路径可点（Read 只显示 path，行号来自 offset，不在名字里）
        ax: { has: '/AXButton \(path-link-target\.md\)/' }
      - label: 不存在的路径不产出可点元素（反向判据：名字里没有可点形态）
        ax: { not: '/AXButton \(path-link-missing\.md\)/' }
      - label: 真实目录不产出可点元素
        ax: { not: '/AXButton \(path-link-dir\)/' }
      - label: ../ 越界路径不产出可点元素
        ax: { not: '/AXButton \(\.\./outside\.md\)/' }
      - shot: 01-路径可点性

  - name: 点工具卡片上的 Read 路径（结构化 path + offset 行）
    do: click
    target: { role: AXButton, name: "^path-link-target\\.md$" }

  - name: 等目标文件装载（编辑器出现目标行原文）
    do: waitFor
    waitFor:
      has: ["PL-LINE-12-TARGET"]
    timeoutMs: 15000

  - name: 新标签落点与行定位现场
    do: settle
    expect:
      - label: '目标文件在**新标签**里且成为前台（AXRadioButton 的 Value: true）'
        ax: { has: '/AXRadioButton \(path-link-target\.md\) Value: true/' }
      - label: 原标签仍在（新标签意图，不是替换当前标签）
        ax: { has: '/AXRadioButton \(harness-note\.md\)/' }
      - label: 目标文件正文已装载（编辑器文本里出现目标行原文）
        editor: { has: "PL-LINE-12-TARGET" }
      - shot: 02-新标签与行落点

  - name: 再点正文里带行号的同一条路径（已打开文件 → 切到既有标签、不重复开）
    do: click
    target: { role: AXButton, name: "^path-link-target\\.md:12$" }

  - name: 等落点稳定后判标签数
    do: settle
    expect:
      - label: 同一个文件只有一个标签（单标签不变量；跨 pane 时是移动而不是复制）
        ax:
          count: { pattern: 'AXRadioButton \(path-link-target\.md\)', exact: 1 }
      - label: 它仍是前台标签
        ax: { has: '/AXRadioButton \(path-link-target\.md\) Value: true/' }
      - shot: 03-已打开不重复开
---

# 161-harness-path-link —— 输出里的 vault 路径可点击（change harness-path-link）

## 本场景在验什么

Alex 2026-10-17 的需求（逐字）：「如果 agent 输出在 harness pane 里的 vault 内路径支持点击、
在 content pane 里打开」「我希望做行定位。另外，卡片路径也做。」「新标签。」本场景用 mock
provider 把四种形态一次铺开：

1. **正文 + 行号**：`path-link-target.md:12` → 可点，点击在新标签打开并落到第 12 行；
2. **嵌套文件**：`path-link-dir/keep.md` → 运行期经 `vaultWrite` 造出的真实文件（同时用
   `path-link-dir` 这个真实目录做「目录不链接化」的现场）；
3. **工具卡片**：Read 的结构化参数 `path` 可点，`offset: 12` 作落点行——卡片上只显示 path，
   行号不进入可见文本（点击时的落点行为靠单测钉：`openPathAtLine` 的编排测试）；
4. **反向形态**：不存在的文件、真实目录、`../` 越界路径都保持纯文本。

## 判据为什么这样写

- **可点性用 `AXButton \(…\)`**：路径链接元素是 `<button type="button">`（不是 `<a href>`——
  不引入 webview 默认导航），所以 AX 里是名字 = 原文的 AXButton；行号后缀逐字留在名字里。
- **新标签用 AXRadioButton 的 `Value: true`**：标签栏项在 AX 里是 AXRadioButton，激活项带
  `Value: true`（场景 28/38/45 同口径）。「原标签仍在」一条把「新标签」与「替换当前标签」分开。
- **单标签不变量用 `ax.count`**：同一文件点两次（先卡片、再正文）后 radio 必须恰好 1 个。
- **反向判据用 `ax: { not: … }`**：不存在的路径 / 目录 / `..` 在渲染里没有 AXButton 形态；
  只否定 `AXButton (名字)` 这种形态，避免把正文里作为普通文本出现的同一串误判成「可点」。
- **`vaultWrite` 之后留一拍**：外部写入没有 UI 信号，watch 增量到达前索引里没有新文件；
  本步只证明「新文件已可点」时的路径，等待 1.2s 是外部写入的既有口径（README「外部写入后先
  留一拍」），不是对产品时序的判据。

## 覆盖边界（如实登记）

- **行落点的位置没有机器判据**：`AXTextArea.value` 是整个文档文本（`lib/drive.mjs` 文件头），
  套件没有 `scrollTop` 读数（CL-1 / CL-2 的同一已知边界）。机器判据只覆盖「文件打开了」与
  「行号传给了 revealLine」（后者在 `tests/unit/harness-path-link.test.ts` 的跳转编排用例里），
  实际滚动位置由 `02-新标签与行落点` 截图人工判读。
- **未覆盖**：行内代码里的路径（单测覆盖）、围栏代码块不链接化（单测覆盖）、锚内文本不链接化
  （单测覆盖）、图片 / 二进制不链接化（分类判据在装配层，未在真机造现场）、惰性文件不链接化
  （与附件索引同源的已知边界）、`vault_create` 新建文件在索引增量前不可点（已登记为 known
  boundary）。
- **样例全合成**：文件名、目录名、正文标记都是为验收编的合成串，不含真实 vault 内容。
