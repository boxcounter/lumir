# Tasks: tab-cycle-keys

实现顺序：键位层登记 → spec 对账 → 门禁 → 真机验收 → 收口。每条完成后就地勾选；
跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

**口径基线（节点 1 裁决，待落槌）**：D1 首 / 尾环绕（推荐 a，复用 `cycleTab`）、
D2 不绑 Emacs 备选键（推荐 a）、D3 复用 `tab.next` / `tab.prev` 零新命令 id
（推荐 a）。本文件凡涉及键位与行为的条目均以裁决为准；`proposal.md` 的
「待 Alex 裁决」节是索引。

## 1. 键位层登记（src/keys.ts）

- [x] 1.1 `KEY_BINDINGS` 的「全局：标签」区段（`src/keys.ts:387-391`）增两条绑定：
      `Cmd-}` → `tab.next`、`Cmd-{` → `tab.prev`（scope global）。token MUST 写
      `Cmd-}` / `Cmd-{`（`{` / `}` ∈ SHIFT_IMPLIED_KEYS，Shift 隐含在字符里），
      MUST NOT 写 `Cmd-Shift-]` / `Cmd-Shift-[`（归一化后永不命中——design §1.1）
- [x] 1.2 两条 doc 各写清：方向映射依据（macOS 惯例，`}` = next、`{` = prev）、
      token 形态依据、冲突核对结论（design §1.2 三条独立来源零冲突）；文件头
      追加一段本 mission 的来由注释（沿袭 M139/M148/M149 的表头留痕格式）
- [x] 1.3 `tests/unit/keys.test.ts` 既有不变量（无重复绑定 / 无孤儿命令 /
      KEYLESS 对账）对新条目自动生效；确认绿。可选：比照 `:118` 的 `Ctrl-Tab`
      定点断言加 `Cmd-}` → `tab.next` / `Cmd-{` → `tab.prev` 两条（防 token
      形态写错成 `Cmd-Shift-[` 的静默失配——这条是既有断言覆盖不到的定点风险，
      建议加）
- [x] 1.4 文件头「零冲突核对」段补 `⌘}` / `⌘{` 的核对结论（三条来源，逐键留痕，
      沿袭 ⌘W 段的写法）

## 2. spec 增量归档准备

- [x] 2.1 `specs/keymap-commands/spec.md` 的 MODIFIED requirement 与最终实现逐句
      对账（实现期发现口径偏差时先改 spec 再写代码，不反向漂移）

## 3. 门禁

- [x] 3.1 `bash scripts/gate.sh quick` 全绿，输出留档 `test-results/m232/`
- [x] 3.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过

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

- [x] 4.1 新增场景 `scripts/acceptance/scenarios/45-tab-cycle-keys.md`：合成 vault
      开三个标签，KimiCU `press_key` 真实注入（先试 xdotool 风格键名
      `cmd+shift+bracketright` / `cmd+shift+bracketleft`，注入通道见
      `scripts/acceptance/lib/cu.mjs:143-145`），断言以**回读到的实际激活标签**
      （AX 读屏名 / `editor` 内容回读）为准，不以注入自报为准（REVIEW.md 第 5 / 11 条）
- [x] 4.2 场景覆盖：⌘} 逐次后移并在末端回卷到第一个；⌘{ 前移并在首端回卷到最后
      一个；只剩 1 个标签时两键均无操作（前台标签与文档内容不变）；截图留档
- [x] 4.3 `node scripts/acceptance/run.mjs --check 45` 静态校验绿；真机跑通后证据落
      `test-results/acceptance/`（git 外）；跑前确认 1420 / 1430 无其他 Lumir 实例
      （REVIEW.md 第 11 条）

## 5. 收口

- [x] 5.1 归档评审时核对：delta 的 MODIFIED requirement 与 living spec 的合入结果逐句
      一致；14-tabs 既有场景未因本 change 改变（⌃⇥ 系绑定与行为不动）
      **节点 2 已核（M253，2026-09-27）**：① 逐句一致——脚本比对归档件
      `specs/keymap-commands/spec.md` 与 living `openspec/specs/keymap-commands/spec.md` 的
      「标签命令族——关闭 / 循环切换 / 序号直达」正文，whitespace-normalized 后**完全相同**；
      归档后 `validate --all --strict` 22/22 绿。② 14-tabs 未受影响——`git show --stat c672be7`
      （M242 的 merge）只动 `45-tab-cycle-keys.md` / `src/keys.ts` / `tests/unit/keys.test.ts`，
      `scripts/acceptance/scenarios/14-tabs.md` 的最近改动是 M238（`f995237`）；M250 记录的真机
      `run.mjs 14 45` = 2/2 PASS（14-tabs 51 断言 / 0 失败）同向印证。

## 核实记录（M250 逐条对照 master 已合并实现，2026-09-27）

**核实对象**：master 的 `c672be7`（Merge `feat/implement-tab-cycle-keys-cmd-braces-m232`）与 `78eff22`
（`feat(keys): ⌘} / ⌘{ 循环切换标签`）；本批复跑 `node scripts/acceptance/run.mjs --check 45`（55 个场景
静态校验全通过）与 `bash scripts/gate.sh quick`（9/9 PASS，SKIP 1 = `tsc-visual` 依赖未装）。M242 的原始
证据留在主 checkout 的 `test-results/m232/`（git 外）。

| 项 | 核实结论 | 证据指针 |
|---|---|---|
| 1.1 | 属实 | `src/keys.ts:479` 区段注释 + `:483`（`{ key: "Cmd-}", command: "tab.next", scope: "global" }`）+ `:484`（`Cmd-{` → `tab.prev`） |
| 1.2 | 属实 | 两条绑定的 `doc` 各含方向映射依据（WebKit 文档 Show next/previous tab）/ token 形态依据（`{` `}` ∈ SHIFT_IMPLIED_KEYS）/ 三条来源零冲突；文件头 `src/keys.ts:90-96` 的 M242 来由段 |
| 1.3 | 属实 | `tests/unit/keys.test.ts:161-162` 定点断言 + `:149-150` 的 token 形态反向断言（`Cmd-Shift-]` / `Cmd-Shift-[` 不在表内）；`node tests/unit/run.mjs` → 375/375 PASS |
| 1.4 | 属实 | `src/keys.ts:113-114` 的「M242 追加核对」（同三条来源、逐键留痕） |
| 2.1 | 属实 | delta（`openspec/changes/tab-cycle-keys/specs/keymap-commands/spec.md`）六条与实现逐句一致，无偏差、未改 spec（对账表见 `test-results/m232/evidence.md` §3；本批复核两条绑定的 `key` / `command` / `scope` 与 delta 文字一致） |
| 3.1 | 属实 | `test-results/m232/gate-quick.log`（9/9 PASS，SKIP 1 = `tsc-visual`）；本批复跑一次同结果 |
| 3.2 | 属实 | `test-results/m232/openspec-validate.log`（M242 时点 26/26）；本批复跑 `validate --all --strict` → 28/28 |
| 4.1 | 属实 | `scripts/acceptance/scenarios/45-tab-cycle-keys.md` 已落库，`--check 45` 静态校验通过（本批实测） |
| 4.2 | 属实（含如实登记的未验面） | 场景 45：`⌃⇥` 逐次后移并在末端回卷、`⌃⇧⇥` 首端回卷、单标签两键逐字节无操作、8 张截图；`⌘}` / `⌘{` **自身的按键链路未验**（KimiCU 通道产不出该 token），原因与三份探针日志写在场景正文「⌘} / ⌘{ 在真机通道上验不了」节 |
| 4.3 | 属实 | 真机 `caffeinate -dimsu node scripts/acceptance/run.mjs 14 45` → **2/2 PASS**（45：44 断言 / 0 失败 / 29.6s；14-tabs：51 / 0 / 48.1s）；证据目录 `test-results/acceptance/2026-09-26/45-tab-cycle-keys/`、日志 `test-results/m232/acceptance-14-45-final.log` |
| 5.1 | 属实（节点 2 已核，M253） | 归档件 delta 与 living `openspec/specs/keymap-commands/spec.md` 的「标签命令族——关闭 / 循环切换 / 序号直达」正文 whitespace-normalized 后**相同**；14-tabs 场景未出现在 M242 的 merge `c672be7` 的改动清单里（`git show --stat`），其最近改动是 M238；详见 §5.1 的节点 2 记录 |
