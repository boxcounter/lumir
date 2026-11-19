---
# CM6 独占组合文本、组合选区和组合中删除；产品只保留 Enter 候选确认门。
# Chromium CDP 真引擎回归在 tests/visual/scenes/m831-harness-composer-codemirror.spec.ts。
# 本场景保留真实 WKWebView 原始拼音动作的人工终判，不把合成事件当原生 IME。
id: "156-harness-composer-ime-composition-freeze"
item: 156
tier: evidence
title: "composer IME：CM 持有组合状态，原生 WKWebView 拼音与 Backspace 人工终判"
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  # M527（Alex 2026-10-16 dogfood）：「输入一行文字，然后 Enter 新起一行后，我使用中文输入法并
  # 选中一个候选后，输入的内容会回到第一行，原本第二行就消失了」。根因 = composerObserver 被
  # 组合期的 childList 变化触发 → normalize 跑在组合中途：组合块含元素子节点（组合文本宿主 /
  # 空块维持的 <br>）被判脏、折进前一段，组合锚点节点被销毁，候选落字跟着错位选区走（合同
  # docs/specs/harness-composer.md HC5，实测依据 M527 节）。修复 = 组合窗内 normalize 冻结
  # （composing ‖ 确认窗）+ withModel / undo / redo 组合期冻结 + compositionend 确认窗过期后
  # 补账归一。
  #
  # 覆盖边界（如实登记）：**IME 组合段不可自动化**——合成键进不了 TSM（m461 探针定案），套件
  # 无 JS 求值通道、合成不出 composition 事件序列；组合窗闸门的回归判据全部落在 DOM 替身单测
  # （tests/unit/harness-ime-enter.test.ts 的「HC5」小节，反向验证 = 闸门改回直通后该小节全红）。
  # 本场景的自动化段只钉「两行态在 IME 之前可达」（防修复顺带破坏正常拆行路径），候选确认路径
  # 由下方「手动复验步骤」节执行（Alex dogfood）。
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }
      - shot: 00-面板就位

  - name: 真实鼠标点 composer（contenteditable 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入第一行（合成探针串；typeInNode 粘贴通道原样落地）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|hnl-cjk-a" }
    text: "hnl-cjk-a"

  # M507 裁决（勿迁）：⇧Enter chord 的副作用在 AX 里逐次不可观测，不要加 verify（场景 117
  # 同名注释）。本步与 117 不同——它只承担「IME 手动复验的前置现场」，两行判据在键入第二行后。
  - name: 一次 ⇧Enter（新起第二行——手动复验的待验现场）
    do: key
    key: "shift+return"

  # M518：软断行之后走 keys 逐键注入（typeInNode 的 AX 注入不进 composer 模型）。键串不含 'e'
  #（press_key 确定性丢键史字符，M497/M509）。
  - name: 键入第二行（合成探针串）
    do: keys
    keys: ["h", "n", "l", "-", "c", "j", "k", "-", "b"]
    gapMs: 60
    expect:
      # 跨行判据走**解析值**（M765，与 117 同口径）：KimiCU 0.6.8 起 dump 原文里的换行是字面 `\n`，
      # `ax.has` 的 `[\r\n]+` 命中 0 次（假红）；`node` 匹配 `parseNodes` 还原后的 value。
      - label: 两行态在 IME 之前可达：第二段接在第一段下一行（不是同行拼接）——手动复验的前置现场成立
        node: { role: AXTextArea, name: 'hnl-cjk-a\n+hnl-cjk-b', present: true }
      - label: 缺陷签名串不在场（同行拼接 = 拆行没落地，IME 手动复验无从谈起）
        ax: { not: "hnl-cjk-ahnl-cjk-b" }
      - shot: 01-IME前两行态

  - name: 记录自动化边界（证据型 note，不卡 PASS/FAIL）
    do: note
    text: "自动化到此为止：IME 组合段进不了 TSM（m461 定案），候选确认路径由场景正文「手动复验步骤」执行（Alex dogfood）；组合窗闸门的机器判据在 tests/unit/harness-ime-enter.test.ts 的 HC5 小节。"
    expect:
      - shot: 02-待手动复验现场
---

# 156 —— 原生 WKWebView IME 人工终判

## 机器已覆盖

`m831-harness-composer-codemirror.spec.ts` 通过 Chromium CDP `Input.imeSetComposition` 驱动真实组合，
覆盖已提交「我」后的单字符与多字符组合、连续 Backspace、空组合取消、候选提交、Enter 确认门、
附件不变和附件 undo。`m361-harness-ime-enter.spec.ts` 另在 Chromium 与 WebKit 合成事件序上验证
确认门适配器；两者都不冒充 WKWebView 原生拼音。

## 手动复验步骤

前置：自动化段已建立两行文本，且 composer 中有一个区外附件。

1. 在第二行已提交「我」，切换中文输入法并组合 `s`。
2. 组合中按一次 Backspace：只删除组合内容，已提交「我」和第一行必须保留，附件不变。
3. 再组合多个字符并连续 Backspace：不得吃任何已提交文本；按 Esc 取消后文本回到组合前。
4. 重新组合并提交候选：候选落在原 caret 所在第二行，第一行和附件不变；确认候选的 Enter 不发送。
5. 确认窗外再按 Enter：才发送。投递为附件上下文在前、完整多行问题在后。
6. 用 ⌘Z 撤销一段组合：文本按 CM history 恢复，附件不丢、不复制。

任一失败都记录原始拼音、候选动作和 AX/截图，不用合成事件结果替代真机结论。

## 覆盖边界

- 真机原始 TSM / Input Method Kit 动作仍需人工执行，本场景自动化段只准备现场。
- 组合期不再有 normalize、DOM 块映射、自管快照或组合期重渲冻结；旧 HC5 补账断言已退役。
- 环境沿用隔离验收 vault 与配置目录，不读写真实 vault。
