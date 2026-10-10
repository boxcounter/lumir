---
id: "106-harness-session-restore"
item: 106
title: 会话恢复：会话浮层选择器列出历史会话 → 选中恢复续聊 → 新会话 JSONL 的 system/input 与原会话衔接
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位（发送钮在场是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入第一条提问并发送（产生一个会话）
    do: keys
    keys: ["z", "q", "x", "a", "l", "p", "h", "a"]
  - name: 发送
    do: key
    key: enter

  - name: 等第一轮回答到达（源会话产生完成）
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: 首轮回答渲染（源会话产生的正观测）
        ax: { has: "验收回答：上下文已收到。" }
      - label: 源会话落盘（session_open 在场）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"kind":"session_open"' }

  - name: 等回合收口（无在途轮次——「＋新会话」与恢复都要求非 busy）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000

  - name: 点「＋新会话」把源会话切成历史会话（＋钮是唯一叫「新会话」的 AXButton；
      会话名钮带 aria-haspopup → AXPopUpButton，role 分流，场景 92 同口径）
    do: click
    target: { role: AXButton, name: "^新会话$" }

  - name: 等新会话重置完成（transcript 回到空态——resetView 的正观测）
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000

  - name: 打开会话浮层（会话名钮带 aria-haspopup → AXPopUpButton）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等历史会话行出现（清单现拉现建——harness_list_sessions 往返）
    do: waitFor
    waitFor:
      has: ["zqxalpha"]
    timeoutMs: 15000
    expect:
      - label: 选择器列出源会话（会话名以首条用户消息 zqxalpha 开头；此处已清 transcript，该串只在选择器行里）
        ax: { has: "zqxalpha" }
      - label: 浮层真实渲染——包围盒完整、落在视口内，且区域内确有已绘制的字形（M397：几何 + 绘制两段，前者钉 O2、后者钉 O1 不被祖先裁切）
        geom:
          target: { name: "zqxalpha" }
          minWidth: 120
          minHeight: 16
          painted: { min: 60 }
      - shot: 01-选择器

  - name: 点历史会话行——恢复续聊（恢复命令读末条 llm_request、折叠末尾响应、开新留存文件；
      M406 起行走 clickInNode 坐标通道——menuitem 嵌进行壳（div + 删除钮兄弟）后，KimiCU 的
      菜单快照守卫对索引点击一律报 stale「menu item is no longer on-screen」，两跑两复现）
    do: clickInNode
    target: { name: "zqxalpha" }

  - name: 等恢复完成（会话名落回源会话首条用户消息）
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(zqxalpha/"]
    timeoutMs: 15000
    expect:
      - label: 恢复后标题栏会话名以源会话首条用户消息开头
        ax: { has: "/AXPopUpButton \\(zqxalpha/" }

  - name: 恢复后面板 transcript 重建（M398：从灌回的 wire 记录重放历史，不再是空面板）
    do: settle
    expect:
      - label: transcript 重建出源会话的**用户消息**——注入节「当前编辑器上下文：」只在 user 气泡里，会话名按后端剥离过 ⇒ 该串是「面板有这条用户消息」的可区分正观测
        ax: { has: "当前编辑器上下文：" }
      - label: 源会话的提问原文也在 transcript 里
        ax: { has: "zqxalpha" }
      - label: transcript 重建出源会话的**助手回复**（该文案只可能来自恢复出来的历史）
        ax: { has: "验收回答：上下文已收到。" }
      - label: 空态提示已摘掉（transcript 非空的构造性正观测，与场景 96 同口径）
        ax: { not: "与当前文档对话" }
      - shot: 02-恢复-transcript

  - name: 点 composer 建立输入焦点（选择器/恢复的点击把 DOM 焦点移走，续打字前须重新聚焦——场景 100 同法）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 输入恢复后的新提问并发送
    do: keys
    keys: ["v", "w", "b", "m", "o", "r", "e"]
  - name: 发送
    do: key
    key: enter

  - name: 等恢复后新一轮回答到达（mock 每轮从脚本头重放同一文案）
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: 恢复后新一轮回答渲染（回合真实发生）
        ax: { has: "验收回答：上下文已收到。" }
      - label: 新会话文件首行标 opened_from=restore（恢复谱系）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"opened_from":"restore"' }
      - label: 新会话文件记 restored_from = 源会话 id（s<millis>-<base36>）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"restored_from":"s[0-9a-z-]+".*$/' }
      - label: 恢复充分性——新一轮 llm_request 的历史里同时带源会话的 user 消息（zqxalpha）与恢复后的新消息（vwbmore）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"kind":"llm_request".*zqxalpha.*vwbmore.*$/' }
      - label: 恢复沿用源 system（不重新装配）——请求体带 system 全文
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"kind":"llm_request".*"provider":"mock".*"system":".+".*$/' }
      - shot: 03-恢复续聊
---

# 106-harness-session-restore —— 最小恢复（change reshape-harness-session-recording 3.7）

## 本场景在验什么

恢复是留存的**真实消费者与验证器**（proposal 裁决点 5）：只做留存不做读取，漏记 / 错记未必暴露。
本场景走**真机 UI 驱动**跑完整条链路（design §6.1 / §6.2）：

1. 发一条提问产生一个会话（源会话落盘）；
2. 「＋新会话」把源会话切成历史会话；
3. 打开标题栏 harness 段的**会话浮层**，历史会话选择器列出源会话（会话名 = 首条用户消息）；
4. 点该行**恢复**——后端读源文件最后一条会话轮次 `llm_request` 的完整请求体，system + messages
   原样灌回内存态并**开新留存文件**（`opened_from=restore`、`restored_from`=源会话 id）；
5. **恢复后 transcript 重建**（M398，design §6.2「面板（transcript）从灌回的 input 重建」）：
   后端把灌回的 wire 记录映射成面板消息随恢复返回，面板重放历史——源会话的**用户消息**与
   **助手回复**都上屏，`resetView` 之后不再是空面板；
6. 发新提问，断言**新会话 JSONL 的 input 与原会话衔接**：新一轮 `llm_request` 的历史里同时带
   源会话的 user 消息（`zqxalpha`）与恢复后的新消息（`vwbmore`）。

断言基准是 change 的 specs delta「会话边界」的 scenario「历史会话列举」「从历史会话恢复续聊」与
design §6。

## 断言口径

- **恢复的 UI 驱动**：会话名钮带 `aria-haspopup="menu"` → WKWebView 映射 `AXPopUpButton`（与合并
  选择器 chip 同一映射，README「已知边界」的 M351 条）；历史会话行 `role="menuitem"`。**行与恢复
  后的会话名钮都按裸正则源名 `zqxalpha` 定位**，不锁 role——`menuitem` 在 WKWebView 里的映射 role
  未经真机实证，裸名匹配只要求 title/label/value 任一含该串（`lib/ax.mjs` 的 `findNode`）。
  **点击走 `clickInNode`（坐标注入）而不是 `click`（AX 索引）**（M406 起）：行内加删除钮后
  menuitem 外面套了 div 行壳，KimiCU 对菜单项的索引点击会过一道「菜单快照未变」守卫，该形态下
  一律报 stale（「menu item is no longer on-screen」，2026-10-09 两跑两复现）——坐标点击不经该守卫。
- **浮层真实可见是两段断言（M397，合同 docs/specs/overlay-visibility.md 的 O1/O2）**：`geom` 断言
  对历史行取几何包围盒，一段钉 O2（包围盒完整、非退化、落在视口内），一段钉 O1（在包围盒区域内
  扫描亮度跨度，要求确有已绘制的字形）。**两段缺一不可**：WKWebView 的 AX 对被祖先 `overflow`
  裁掉的内容照样暴露节点与**未裁的**包围盒（M397 现场实证：整段被裁的浮层项仍报完整包围盒），
  只判几何会对着「几何上存在、实际没画出来」的现场判绿——绘制段才是「被裁」的唯一可判读数。
  反向验证：把浮层改回被裁形态，绘制段必红（M397 已实测，见 mission 记录）。
- **为什么按前缀而非整名匹配**：会话名取「首条用户消息截断约 20 字」，而 wire 里的首条用户消息是
  **序列化后的完整消息**（提问 + `[当前编辑器上下文：…]` 注入节）——截断后的名因此含换行与注入节
  开头。因此判据只锚**提问串 `zqxalpha`**（本场景独有、位于名首）：整名匹配会踩上换行/截断形态。
- **恢复完成的正观测**：点行后 `resetView` 清 transcript、再按返回的 `messages` 重放历史、最后
  会话名落选中项首条用户消息——等 `AXPopUpButton` 名出现 `zqxalpha` 即恢复回路闭环（不是凭空时长等）。
- **面板重建的可区分判据（M398）**：断言 `当前编辑器上下文：`——它是序列化用户消息里自动注入的
  「当前编辑器上下文」节的**节头**，只可能出现在 transcript 的 user 气泡里（会话名走
  `strip_context_section` 剥离过该节 ⇒ 会话名钮不含它）。若恢复仍旧不重建面板，这条必红；
  助手回复断言另证 assistant 气泡也重建了（文案只可能来自恢复出来的历史）。空态提示「与当前文档
  对话」的缺席是「transcript 非空」的构造性正观测（与场景 96 同口径）。
- **衔接判据落盘**：`/^.*"kind":"llm_request".*zqxalpha.*vwbmore.*$/`——`zqxalpha`（源会话 user
  消息原文）与 `vwbmore`（恢复后新消息）同处一条 `llm_request` 的 messages 里，只可能由「灌回源
  input + 追加新消息」产生（新会话若是空会话，历史里不会有 `zqxalpha`）。两个标记都是**合成、只
  本场景独有**的串（不取 `more` 这类常见英文词，避免被 system 里的普通英文命中）。
- **`restored_from` 不写死源 id**：源 session id 是运行期生成的 `s<millis>-<base36>`，断言用形态
  正则（`"restored_from":"s[0-9a-z-]+"`），不硬编码一份副本（真源唯一，REVIEW.md 第 8 条）。
- **system 沿用源（不重新装配）**：design §6.2 第 2 步——恢复旧会话沿用旧会话当时的 system。本场景
  断言新一轮请求带 `system` 全文；「逐字节等于源」的严格比较由 Rust 单测（3.3 恢复路径测试）钉住
  （本套件 DSL 无跨文件逐字节比较）。
- **键序**：`serde_json` 未启用 `preserve_order`，对象键按字典序——`opened_from` 与 `provider`
  相邻（字典序 o < p），`restored_from` 在 `provider` 之后，故两条分开断言。

## 已知边界（如实登记）

- **选择器会话名带注入节**：wire 的「首条用户消息」含自动注入的编辑器上下文节，而标题栏会话名
  取的是用户原始提问段——两者截断后**不同源**（design §6.1 说「同口径」，实现里选择器走 wire 全文）。
  本场景按提问前缀匹配规避该形态，并把这条不一致留作 finding，不在本 mission 面内修。
- **恢复重建的消息无相对时间读数**：wire 项不带时间戳，重建的面板消息 `ts` 为 0 ⇒ who 行只显示
  角色、不显示 when（不伪造读数，与快照路径「无戳不显示」同口径）。本场景不判恢复消息的时间显示。
- **恢复的思考块只在能取到明文时出现**：reasoning 回放项里 kimi 是不透明 `encrypted_content`
  （取不到明文 → 不建块），deepseek 的 `reasoning_text` parts 才带明文；且恢复消息的思考块无「思考
  时长」读数（wire 不带），按展开态呈现、不渲染含时长的折叠头。mock 不产思考，故本场景不判这两面。
- **恢复期间其余面板行为不在本场景**：跨 provider 方言重写不做（Non-goals）；末尾响应带悬空工具
  调用的边界由 Rust 单测覆盖（3.3）。
- **绘制段的边界**：它证明「包围盒区域内确实有字形」，前提是该区域在**浮层被裁时是纯底色**（本
  场景成立：历史行包围盒落在 harness pane 的上部空白，pane 的空态提示居中在更下方）。若将来浮层
  的落点恰好压着别处的正文/控件文字，被裁时也会读到字形而假过——那时判据要换成「浮层壳底色」
  的同/异色对（`pixel.differ`）。这条边界是「绘制段不能单独承担 O1」的补充，与几何段联合使用。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；mock 只回文案、不写 vault。
  1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
