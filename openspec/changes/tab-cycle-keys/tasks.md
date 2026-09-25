# Tasks: tab-cycle-keys

实现顺序：键位层登记 → spec 对账 → 门禁 → 真机验收 → 收口。每条完成后就地勾选；
跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

**口径基线（节点 1 裁决，待落槌）**：D1 首 / 尾环绕（推荐 a，复用 `cycleTab`）、
D2 不绑 Emacs 备选键（推荐 a）、D3 复用 `tab.next` / `tab.prev` 零新命令 id
（推荐 a）。本文件凡涉及键位与行为的条目均以裁决为准；`proposal.md` 的
「待 Alex 裁决」节是索引。

## 1. 键位层登记（src/keys.ts）

- [ ] 1.1 `KEY_BINDINGS` 的「全局：标签」区段（`src/keys.ts:387-391`）增两条绑定：
      `Cmd-}` → `tab.next`、`Cmd-{` → `tab.prev`（scope global）。token MUST 写
      `Cmd-}` / `Cmd-{`（`{` / `}` ∈ SHIFT_IMPLIED_KEYS，Shift 隐含在字符里），
      MUST NOT 写 `Cmd-Shift-]` / `Cmd-Shift-[`（归一化后永不命中——design §1.1）
- [ ] 1.2 两条 doc 各写清：方向映射依据（macOS 惯例，`}` = next、`{` = prev）、
      token 形态依据、冲突核对结论（design §1.2 三条独立来源零冲突）；文件头
      追加一段本 mission 的来由注释（沿袭 M139/M148/M149 的表头留痕格式）
- [ ] 1.3 `tests/unit/keys.test.ts` 既有不变量（无重复绑定 / 无孤儿命令 /
      KEYLESS 对账）对新条目自动生效；确认绿。可选：比照 `:118` 的 `Ctrl-Tab`
      定点断言加 `Cmd-}` → `tab.next` / `Cmd-{` → `tab.prev` 两条（防 token
      形态写错成 `Cmd-Shift-[` 的静默失配——这条是既有断言覆盖不到的定点风险，
      建议加）
- [ ] 1.4 文件头「零冲突核对」段补 `⌘}` / `⌘{` 的核对结论（三条来源，逐键留痕，
      沿袭 ⌘W 段的写法）

## 2. spec 增量归档准备

- [ ] 2.1 `specs/keymap-commands/spec.md` 的 MODIFIED requirement 与最终实现逐句
      对账（实现期发现口径偏差时先改 spec 再写代码，不反向漂移）

## 3. 门禁

- [ ] 3.1 `bash scripts/gate.sh quick` 全绿，输出留档 `test-results/m232/`
- [ ] 3.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过

## 4. 真机验收（agent 执行，不进 CI；随实现同 PR）

本节场景序号按 registry 对账分配（content-width-drag r1 撞号后建立的口径），逐条出处：
36 = restyle-content（master 仓内 `scripts/acceptance/scenarios/36-restyle-content.md`
已落库；`openspec/changes/live-theme-switch/tasks.md:50` 的「36」是陈旧声明，见 finding
`.tower/comms/findings/20260926-worker-proposal-table-fs-bug-live-theme-switch-36.md`）、
37 = heading-hierarchy-ramp（`openspec/changes/heading-hierarchy-ramp/tasks.md:32`）、
38 = content-width-drag（`openspec/changes/content-width-drag/tasks.md:83`）、
39 = product-version-display（`openspec/changes/product-version-display/tasks.md:41`）、
40 = table-fullscreen-view（M229，`openspec/changes/table-fullscreen-view/tasks.md:120`）、
41 / 42 = nonmd-edit（M231，其 review-request 自述已于 2026-09-25 TowerSend 广播）、
43 = list-tab-indent（M230，`openspec/changes/list-tab-indent/tasks.md:68`）、
44 在仓内未查到声明，按 tower 口径 36–45 视为已占（与 M233 的登记口径一致，
wt-233 的 `dotfile-jsonc-highlight/tasks.md` §7 文首）、
**45 = tab-cycle-keys（本 change）**；46 = dotfile-jsonc-highlight（M233，同一份对账
互认 45 归本 change）。对账经过：本稿动工前核对 `scripts/acceptance/scenarios/` 既有
编号（仓内最大 36）与上列在途声明，取 45 无撞号。实现期新增场景前先核对
`scripts/acceptance/scenarios/` 的既有编号与本表，不再「续现有序列」盲取。

- [ ] 4.1 新增场景 `scripts/acceptance/scenarios/45-tab-cycle-keys.md`：合成 vault
      开三个标签，KimiCU `press_key` 真实注入（先试 xdotool 风格键名
      `cmd+shift+bracketright` / `cmd+shift+bracketleft`，注入通道见
      `scripts/acceptance/lib/cu.mjs:143-145`），断言以**回读到的实际激活标签**
      （AX 读屏名 / `editor` 内容回读）为准，不以注入自报为准（REVIEW.md 第 5 / 11 条）
- [ ] 4.2 场景覆盖：⌘} 逐次后移并在末端回卷到第一个；⌘{ 前移并在首端回卷到最后
      一个；只剩 1 个标签时两键均无操作（前台标签与文档内容不变）；截图留档
- [ ] 4.3 `node scripts/acceptance/run.mjs --check 45` 静态校验绿；真机跑通后证据落
      `test-results/acceptance/`（git 外）；跑前确认 1420 / 1430 无其他 Lumir 实例
      （REVIEW.md 第 11 条）

## 5. 收口

- [ ] 5.1 归档评审时核对：delta 的 MODIFIED requirement 与 living spec 的合入结果逐句
      一致；14-tabs 既有场景未因本 change 改变（⌃⇥ 系绑定与行为不动）
