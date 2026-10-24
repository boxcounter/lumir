---
id: "229-harness-permission-rules"
item: 229
title: 权限规则入口与包装器解包（change harness-permission-rules-oct23）：持久放行 / 删规则后重新问 / bash -lc 全只读免问 / 危险包装卡无次级动作（mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-permission-rules.json"
    permissions:
      allow: []
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（后台注入键盘整批丢键/错键会显著加剧——REVIEW.md 「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 输入第一条提问并发送（本场景共两条用户消息——见「已知边界」的键盘注入口径）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|rules" }
    text: "rules"
  - name: 发送
    do: key
    key: enter

  - name: 等第一张批准卡（tvly = 未知命令 ⇒ 写类 ⇒ vault_write 档逐个问）
    do: waitFor
    waitFor:
      has: ["要运行这条命令吗？"]
    timeoutMs: 30000
    expect:
      - label: 卡上是这条查询（命令原文完整可见；参数带引号，与执行器的格式化一致）
        ax: { has: 'tvly search "prompt caching"' }
      - label: 两枚次级动作并列——会话记忆带粒度（D565：第二词是参数 ⇒ 两词前缀）
        ax: { has: "采纳且本会话不再问（记住 tvly search）" }
      - label: 两枚次级动作并列——持久规则逐字显示将要写入的规则（D564，后端现算）
        ax: { has: "以后都允许 cli(tvly search *)" }
      - shot: 01-批准卡-两枚次级动作

  - name: 点「以后都允许 cli(tvly search *)」（一次点击 = 采纳 + 写回全局规则）
    do: click
    target: { name: "^以后都允许 cli\\(tvly search \\*\\)$" }

  - name: 等规则落进全局配置（后端单写者写回；前端不拼装文本）
    do: waitForFile
    waitForFile:
      path: "env:config.json"
      has: "\"cli(tvly search *)\""
    timeoutMs: 15000
    expect:
      - label: JSONL 的批准 sidecar 记下 persist_rule=true（写回依据）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "/\"persist_rule\":true/" }

  - name: 等混合脚本那张危险卡（第二、三条调用都没出卡才会走到这里）
    do: waitFor
    waitFor:
      has: ["shell 包装器命令（bash）"]
    timeoutMs: 40000
    expect:
      - label: 混合脚本维持危险（解包失败 ⇒ 逐子命令判定不成立，不得降为写）
        ax: { has: "ls; rm -rf /tmp/lumir-h229-nothing" }
      - label: 危险卡上没有「采纳且本会话不再问」（D3：死按钮不显示）
        ax: { not: "采纳且本会话不再问" }
      - label: 危险卡上没有「以后都允许」（同上）
        ax: { not: "以后都允许" }
      - shot: 02-危险卡-无次级动作

  - name: 拒绝那条混合脚本（真机不造真副作用）
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等本轮收尾
    do: waitFor
    waitFor:
      has: ["第一次的规则生效了。"]
    timeoutMs: 30000
    expect:
      - label: 第二轮同类查询确实跑了（wire 留存里有它的 call_id）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "/\"call_id\":\"call_rule2\"/" }
      - label: 解包段的调用确实跑了（wire 留存里有它的 call_id）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "/\"call_id\":\"call_unpack1\"/" }
      - label: 危险卡收敛为「已拒绝」终态 ⇒ 界面没有残留待决卡（终态记录不带待决问句）
        ax: { has: "已拒绝" }
      - label: 收尾时没有待决卡在场（第二、三条调用确实没进闸，负向断言）
        ax: { not: "要运行这条命令吗？" }
      - shot: 03-收尾

  - name: 点权限 chip 展开浮层（chip 带 aria-haspopup → WKWebView 映射 AXPopUpButton）
    do: click
    target: { name: "^权限模式：" }
    expect:
      - label: 三档单选照旧在场
        ax: { has: "保险库写入" }
      - label: 「已记住的规则」段在场（D566；列表非空才渲染这一段）
        ax: { has: "已记住的规则" }
      - label: 规则原文逐字可见（后端现读的配置值，不是前端旧缓存）
        ax: { has: "cli(tvly search *)" }
      - label: 删除钮的可访问名带规则原文（D567）
        ax: { has: "删除规则 cli(tvly search *)" }
      - shot: 04-浮层-已记住的规则

  - name: 删除这条规则（后端单写者写回，幂等）
    do: click
    target: { name: "^删除规则 cli\\(tvly search \\*\\)$" }

  - name: 等列表重建（删除成功后才重取配置 ⇒ 段退场即证明写回已完成）
    do: waitFor
    waitFor:
      not: ["已记住的规则"]
    timeoutMs: 15000
    expect:
      - label: 配置里的规则被移除
        file: { path: "env:config.json", not: "\"cli(tvly search *)\"" }
      - label: 规则原文不再出现在浮层里
        ax: { not: "删除规则 cli(tvly search *)" }
      - shot: 05-删除后-段退场

  - name: 关掉浮层（再点权限 chip 收起——不用 Esc：删除钮重建后焦点落 body，Esc 收不到浮层、会落到 pane 层）
    do: click
    target: { name: "^权限模式：" }
    expect:
      - label: 浮层已收起（三档单选退场；chip 自己还在——它的读屏名不含「完全访问」）
        ax: { not: "完全访问" }
      - label: composer 仍在位（pane 没有被误收；正观测，后续键入有落点）
        ax: { has: "问点什么" }

  - name: 第二条提问（验证规则确实删掉了）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|again" }
    text: "again"
  - name: 发送
    do: key
    key: enter

  - name: 等第三张批准卡（规则已删 ⇒ 同类查询重新逐个问）
    do: waitFor
    waitFor:
      has: ["要运行这条命令吗？"]
    timeoutMs: 30000
    expect:
      - label: 卡上是第三次查询（规则删除后同族调用重新进闸）
        ax: { has: "tvly search 第三次问题" }
      - label: 次级动作照旧在场（可再次沉淀规则）
        ax: { has: "以后都允许 cli(tvly search *)" }
      - shot: 06-删规则后重新问

  - name: 拒绝这一条（不造真副作用）
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等本轮收尾
    do: waitFor
    waitFor:
      has: ["又被问了，规则确实删掉了。"]
    timeoutMs: 30000
    expect:
      - label: 第三张卡收敛为「已拒绝」终态
        ax: { has: "已拒绝" }
      - shot: 07-收尾
---

# 229-harness-permission-rules —— 权限规则入口、删规则后重新问、包装器受限解包与死按钮隐藏

## 本场景在验什么

change `harness-permission-rules-oct23` 的三条用户可见行为（proposal §What Changes 的 A1 / A2 /
死按钮隐藏），每段一条判据：

| 段 | 行为 | 期望 |
|---|---|---|
| 1 | `tvly search "prompt caching"` 在 `vault_write` 档逐个问；卡上「以后都允许 `cli(tvly search *)`」 | 点它 ⇒ 规则写进全局配置，调用执行 |
| 2 | 同类查询 `tvly search "另一个问题"` | **不再出卡**（allow 规则命中） |
| 3 | `bash -lc "ls -la 2>/dev/null; echo HNA-UNPACK; ls . \| tail -5"` | 全只读 ⇒ A2 受限解包 ⇒ **直接执行、不出卡** |
| 4 | `bash -lc "ls; rm -rf /tmp/lumir-h229-nothing"` | 混合脚本 ⇒ 解包失败 ⇒ 维持**危险**；卡上**没有**两枚次级动作（D3） |
| 5 | 权限浮层 | 「已记住的规则」段列出规则；删除后段退场、配置同步移除 |
| 6 | 删规则后的同类查询 | **重新逐个问**（规则确实失效） |

## 断言口径与已知边界

- **卡上的命令原文带引号**（M669 修正）：执行器的格式化把参数逐字加上引号——卡上实际是
  `tvly search "prompt caching"`，不是 `tvly search prompt caching`。首跑（M667）的断言串漏了
  引号，与产品行为无关地判红；断言照 ax dump 原文写。
- **关浮层不用 Esc**（M669 修正）：删除一条规则会重建浮层（`permPop.replaceChildren()`），
  被点的删除钮随之摘出 DOM、焦点落回 body；此时 `panel` 上的 Escape 处理器收不到事件
  （它的收起判据是「焦点在面板内」），M667 首跑因此把整块 pane 拖进级联红。改为再点一次
  权限 chip（代码注释里的三条关闭路径之一：chip 再点 / 浮层外点击 / Esc），并断言浮层的
  三档单选退场（`not: "完全访问"`）+ composer 仍在位——两条都是正/负可判读数，不是「点完
  就算」。
- **危险卡「没有」两枚次级动作的判据是负向 AX 断言**：`ax: { not: "采纳且本会话不再问" }` 与
  `ax: { not: "以后都允许" }`。同一条不变量还有两层机器防线：Rust 侧判定级单测
  （`permissions.rs` 的 `reason_mapping_covers_every_gated_layer` 邻域与 `turn.rs` 的派生点）与
  前端纯模型层单测（`tests/unit/harness-permission-rules.test.ts` 的缺键语义）——真机这条只证
  「最终渲染面没有」。
- **`tvly` 是虚构命令**：批准后执行会拿到「命令不存在」类错误，这是刻意的——本场景判的是
  **权限面**（是否进闸 / 是否写规则），不是命令本身的成败。第二段「不再出卡」的判据是三条
  合成，且**分散在两个步骤里**：① 能等到混合脚本那张危险卡（`r2` / `r3` 若出卡，mock 序列会
  停在批准闸上，这一步必超时）；② `call_rule2` / `call_unpack1` 的 call_id 在 wire 留存里
  （证明确实执行了）；③ 第一轮收尾步的 `ax: { not: "要运行这条命令吗？" }`（收尾时界面没有
  残留待决卡）。三条缺一不可，不依赖任何内部状态。
- **`bash -lc` 全只读段不判 stdout**：解包后走既有 cli_run 执行路径，`ls .` 在应用工作目录下
  可能非零退出（目录内容无关），本场景只判「没进闸」（call_id 在 wire 留存里）。
- **两条用户消息**：第一段到「第一次的规则生效了。」收尾；浮层交互不消耗消息；第二条只发一个
  短 ASCII 串（`again`，与已稳定的 109/110 同一键盘形态）。**第二段是本场景的主覆盖**：
  「删规则后重新问」——规则删掉后同族调用必须重新进闸（第三张卡 + 两枚次级动作照旧），
  M667 首跑被「关浮层用 Esc 收掉整个 pane」的级联挡掉，M669 修好关闭路径后才真正跑到。
  首跑若在第二条消息上遇到键盘注入丢键（REVIEW.md 「键盘注入丢键」条），按该条的重试口径
  处理，不要判成产品缺陷。
- **`rm -rf /tmp/lumir-h229-nothing` 从不执行**：两条危险 / 混合卡都被拒绝；`mkdir` 类幂等命令
  本场景不使用，因此真机零副作用。
- **配置写回的判据是 `env:config.json` 的字符串**：`config_set_value` / 规则写回都走同一份原子写，
  pretty JSON 里规则长这样：`"cli(tvly search *)"`。删除后同一文件里 `not` 该串（同时列表段
  退场，两条互证）。
- **规则段的滚动条不在本场景判**（M660 #1 追加）：本场景只落一条规则、列表不溢出；规则段已归
  隐藏档（右缘有 16px 删除钮），溢出态判据（10 条规则）在
  `tests/visual/scenes/m347-harness-composer.spec.ts` 的 M660 #1 追加用例。

## 环境与副作用

- vault 文件不被改动（fixture 只跑 cli_run 与文本答复）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`（wire 留存落
  `env:harness/sessions/<vault 稳定 id>/`，每场景重置）；真实 vault 与 `~/.config/lumir` 全程
  不读写；1420 不碰。
