---
id: "156-harness-composer-ime-composition-freeze"
item: 156
title: "composer IME 组合期结构冻结（M527，HC5）：第二行中文组合不折回第一行——手动复验"
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
      - label: 两行态在 IME 之前可达：第二段接在第一段下一行（不是同行拼接）——手动复验的前置现场成立
        ax: { has: '/hnl-cjk-a[\r\n]+hnl-cjk-b/' }
      - label: 缺陷签名串不在场（同行拼接 = 拆行没落地，IME 手动复验无从谈起）
        ax: { not: "hnl-cjk-ahnl-cjk-b" }
      - shot: 01-IME前两行态

  - name: 记录自动化边界（证据型 note，不卡 PASS/FAIL）
    do: note
    text: "自动化到此为止：IME 组合段进不了 TSM（m461 定案），候选确认路径由场景正文「手动复验步骤」执行（Alex dogfood）；组合窗闸门的机器判据在 tests/unit/harness-ime-enter.test.ts 的 HC5 小节。"
    expect:
      - shot: 02-待手动复验现场
---

# 156-harness-composer-ime-composition-freeze —— composer IME 组合期结构冻结（M527，HC5）

## 本场景在验什么

Alex 原话：「harness composer 里，当我输入一行文字，然后 Enter 新起一行后，我使用中文输入法并
选中一个候选后，输入的内容会回到第一行，原本第二行就消失了」。合同条款：
docs/specs/harness-composer.md 的 **HC5 — IME 组合期结构冻结**（normalize 组合窗冻结 /
整面重渲组合期冻结 / compositionend 补账归一三条）。本场景是 HC5 的**行为层半自动**落点：
自动化段钉前置现场（两行态可达），候选确认段是手动复验。

## 断言口径与区分度

- 自动化段的两条 AX 断言只判「两行态在 IME 之前成立」：`/hnl-cjk-a[\r\n]+hnl-cjk-b/` 的正观测 +
  同行拼接签名串的负向断言（与场景 117 同口径）。它对 HC5 的闸门**没有区分度**（英文路径不经过
  组合窗），区分度全部在 DOM 替身单测（闸门改回直通 ⇒ HC5 小节全红的反向验证已跑，见
  tests/unit/harness-ime-enter.test.ts 小节头注释）。
- 自动化段的真实职责是**共改动守卫**：normalize 加了组合窗闸门后，正常拆行 / 键入路径
  （observer → normalize 的常态 no-op）不得被破坏——若闸门误伤常态路径，本场景第一条断言红。

## 手动复验步骤（Alex dogfood，HC5 可观测判据的真机执行）

前置：本场景自动化段跑完后的现场（两行探针串在位），或手动重建——composer 键入任意一行 →
⇧Enter 新起一行。

1. 切换到中文输入法，在**第二行**键入任意拼音（如 `ce shi`），出现候选窗。
2. **不要移动光标**，直接按数字键或空格选中一个候选。
3. 判定（全过 = PASS）：
   - 候选文本落在**第二行**（原组合位置），第一行文本逐字不变；
   - 第二行（段落）没有消失；
   - 光标跟在候选文本之后，仍在第二行；
   - 紧接着按 Enter 发送：消息文本 = 第一行 + 换行 + 第二行（含候选），无串行 / 丢行。
4. 变体（各做一次）：① 用鼠标点击候选窗选词（不经 Enter）；② 组合中途按 Esc 取消组合——
   取消后第二行应为空行、第一行不变，不跳行。

## 覆盖边界（如实登记）

- **候选确认路径无机器判据**：合成键进不了 TSM（m461 探针定案）、套件无 JS 求值通道合成不出
  composition 事件序列——这是 HC5 行为层的固有缺口，不是本场景漏写。闸门的回归判据落在
  `tests/unit/harness-ime-enter.test.ts` 的「HC5」小节（三块结构 / 组合文本落段 / 选区不改写 /
  补账归一，含反向验证）。
- 真机 WebKit 组合期的**瞬态 DOM 形态**（组合文本宿主、空块 `<br>` 的存续时机）以单测的
  模拟形态为判据代理；端到端的候选落字路径以本节手动复验为终判。
- 组合期右键粘贴 / 拖入的 withModel 冻结（HC5 第 2 条）无真机判据（合成不出组合态下的鼠标
  路径），由 DOM 替身单测的粘贴用例覆盖。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；mock 只回文案、不写 vault。
  1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
- 手动复验段在 Alex 自己的装版实例上执行即可（不经套件）。
