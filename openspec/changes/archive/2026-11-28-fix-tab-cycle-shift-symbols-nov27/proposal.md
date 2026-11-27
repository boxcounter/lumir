# Proposal: 标签循环键的 Shift 符号归一（⌘⇧] / ⌘⇧[ 在 WKWebView 上真正可达）

- Change ID: `fix-tab-cycle-shift-symbols-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（缺陷报告与验收），AI agent（诊断与实现）

> 评审记录
> 节点 1：Alex 2026-11-27 报告「Shift+Command+左右方括号（US 实体键盘）切标签完全无反应，同一问题
> 反馈多次」；本提案依据独立 WKWebView 探针与 WebKit 源码给出根因与修复口径。首轮独立审查
> findings（P1=0 / P2=1 / P3=2，报告 `.local/reviews/tab-navigation-keys-nov27/final-judgment.md`）
> 已按「措辞与证据归属」修准（P2-1 / P3-1 / P3-2），无行为改动；复核待下一轮。真机场景 45 已 PASS
> （证据 `.local/acceptance/2026-11-27-tab-navigation-keys/`），物理键盘 dogfood 仍是待验项。
>
> 复核 R2：**clean/merge** 绑 `f10d9ffd`（P1/P2/P3=0，`final-judgment-r2.md`）；rebase 到
> `f458ace7` 后 `git range-diff` 两条提交均为 `=`（补丁逐字相同），当前 tip `450646e5`。
>
> **节点 2 历史状态（保留）**：rebase 后完整 visual 跑了四次，均 `14/15`（第 1 次 `unit-tests`
> 被并发他树单测打红；第 2 次 `docs-check` 缺 backlog 队列条目；第 3/4 次 `editing-oracle` 既有
> flaky oracle），当时按「仍有红不归档」停住。该 oracle 随后由 change `fix-ime-settle-oracle-nov27`
> 修掉，最终集成 tip 取得全绿（见下节）。逐次分类与原始日志：`tasks.md` §5、
> `evidence/gate-visual-rebased-{1,2,3,4}-*.log`。

## 节点 2：归档记录

**放行方式**：机器 + 独立评审放行（`docs/process/openspec-workflow.md`「节点 2」五要件）。

### 五要件（归档前）

1. **节点 1**：Alex 2026-11-27 报告「Shift+Command+左右方括号（US 实体键盘）切标签完全无反应，
   同一问题反馈多次」。本 change 属缺陷修复（事件形态与表内 token 不一致），无 scope 扩张。
2. **独立评审**：K3 终审 **clean/merge** 绑 `c21e5fbccf8224bf2d2d51a9385e510c9f8e54c1`，
   P1 / P2 / P3 = 0（`.local/reviews/tab-navigation-keys-nov27/independent-review-final.md`）；
   前一环 R2 clean/merge 绑 `f10d9ffd`（`final-judgment-r2.md`）。rebase 后产品补丁与原评审版本
   逐字相同（range-diff）。
3. **tasks**：全部勾选（物理键盘 dogfood 作为已知边界登记，留 Alex；merge / push 按本批禁令留主会话）。
4. **门禁与真机证据**：
   - **machine PASS（最终 tip `c21e5fbc`）**：完整 `scripts/gate.sh visual`
     **`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0**；visual-regression 1410s / 1993 passed /
     13 skipped / 0 failed（`evidence/gate-visual-integrated-2026-11-28.log`）。`scripts/gate.sh quick`
     **`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0**；前端单测 `tests 2196 / pass 2196 / fail 0`
     （`evidence/gate-quick-final-tip-2026-11-28.log`）。目标单测 84/84
     （`evidence/unit-target-integrated.log`）。
   - **native PASS**：场景 45（注入通道）PASS，27.4s / 52 断言 / 0 失败
     （`.local/acceptance/2026-11-28-tab-navigation-keys-final/`；`status.txt` 与 `steps.md` 在
     `evidence/45-tab-cycle-keys/`）。**不冒称物理键盘**：dogfood 仍是独立人工边界。
   - **历史红保留**：四次 `14/15` 的逐次分类见 `tasks.md` §5 与
     `evidence/gate-visual-rebased-{1,2,3,4}-*.log`，不删、不掩盖。
5. **规格对账无丢段**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS；
   `openspec validate --all --strict` PASS；归档跟踪队列有且仅有一条条目（`docs/backlog.md`）。

### 五态

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 是 | `5e3b001c`（修复）+ `08ca2973`（审查修准）+ 文档提交至 `c21e5fbc`；基 `fceb3282`；未 merge / 未 push |
| released | 否 | 本批不打包（无发布动作） |
| machine PASS | 是 | 完整 visual `GATE RESULT: 15/15 PASS（SKIP 0）` exit 0（1993 passed / 13 skipped / 0 failed，1410s）；quick `13/13 PASS` exit 0（单测 2196/2196）；目标单测 84/84 |
| native PASS | 是（注入通道） | 场景 45 PASS 27.4s / 52 断言（`.local/acceptance/2026-11-28-tab-navigation-keys-final/`）；物理键盘 dogfood 待 Alex（已知边界） |
| archived | 是 | 归档提交 `3d2bf0cc`；`--archived` PASS（1 条 MODIFIED / 13 段 / 人工恢复 0 / 声明认领 0） |

### 归档后记录

- 归档目录：`openspec/changes/archive/2026-11-28-fix-tab-cycle-shift-symbols-nov27/`。
- 包装器 `node scripts/openspec-archive.mjs fix-tab-cycle-shift-symbols-nov27`：`keymap-commands: ~ 1 modified`
  （Totals `+ 0, ~ 1, - 0`）；归档后修链 **0 处**（4 篇 Markdown / 0 条相对链接）；
  `openspec-links` PASS（716 条相对链接全部可达）。
- `node scripts/openspec-archive-check.mjs --archived fix-tab-cycle-shift-symbols-nov27`：**PASS**
  （1 条 MODIFIED，对比 13 段；人工恢复 0 段，声明认领 0 段）。

## Why

`⌘⇧]` / `⌘⇧[` 在 WKWebView 的未 Shift 字符形态下从来没有命中过表内的 `Cmd-}` / `Cmd-{`
（合成注入通道实测；物理键盘形态未验）。旧口径假设「事件给 `key="}"`（Shift 隐含在字符里）」，
这条假设**没有硬件证据**，2026-11-27 的独立 WKWebView 探针（合成注入通道）实测为：

| 层 | `⌘⇧]` 的实测值 |
|---|---|
| NSEvent | `characters="]"`、`charactersIgnoringModifiers="}"` |
| DOM `KeyboardEvent` | `key="]"`、`code="BracketRight"`、`shiftKey=true`、`metaKey=true` |
| 旧 token | `Cmd-Shift-]`（表内只有 `Cmd-}` ⇒ 永不命中） |

来源核对：WebKit `keyForKeyEvent`（`Source/WebCore/platform/mac/PlatformEventFactoryMac.mm`）在
**无 Control** 时取 `[event characters]`；Command+Shift 下该字符是未 Shift 的形态。同一机制使
M627 的 `⌘⇧,` / `⌘⇧.`（表内 `Cmd-<` / `Cmd->`）和 M195 的 `⌘⇧=`（`Cmd-+`）在同一未 Shift
字符形态下同样不命中
——这解释了「同一问题反复反馈」：每次修的是不同的键，坏的是同一层归一化。

证据：`.local/probes/tab-navigation-keys-nov27/`（探针工程 + 两条独立注入通道的原始日志）。

## What Changes

- `src/keys.ts` 新增 `SHIFTED_SYMBOLS`（US 布局「物理键字符 → Shift 后字符」的**单一来源**），
  `SHIFT_IMPLIED_KEYS` 由它派生；`normalizeKey` 把「Shift + 未 Shift 字符」与 Shift 后的字符归一成
  同一 token。事件侧与 `[keys]` 配置文本侧同门，表内仍只写 `Cmd-}` / `Cmd-{` / `Cmd-<` / `Cmd->` /
  `Cmd-+` 等 Shift 后形态各一条绑定。
- `src/key-glyphs.ts` 的 Shift 反解表改为从 `SHIFTED_SYMBOLS` 派生（去掉同一映射的第二份抄写）。
- 键位来由文案（D315 / D316 / D544 / D545、D973 的占用清单）与 `src/keys.ts` 注释同步改准：
  旧句「写 `Cmd-Shift-]` 永不命中」不再成立。
- 测试合同翻转：`tests/unit/keys.test.ts` 与 `tests/visual/scenes/m242-tab-cycle-key-tokens.spec.ts`
  原本把「未 Shift 字符 + shiftKey 不命中」写成固化断言；现在断言两种形态**同 token、同命令**。
- 验收场景 45 新增 `⌘⇧]` / `⌘⇧[` 两步真机步骤（该通道此前登记为「不可达」，现已可达）。

## 旧假设为什么失效

1. **假设来源**：M242 的依据是「US 布局上 ⇧] 打出 `}`」——这是**字符输入**的事实，被错误外推到
   `KeyboardEvent.key`。WebKit 的 `key` 取的是 `[event characters]`，而 Command 组合下 TSM 给的是
   未 Shift 的字符（探针 NSEvent 层直接可见）。
2. **通道差异掩盖了它**：既有真机注入通道给的是同一种未 Shift 形态，但当时被归因为「通道的限制」，
   反而用「表只收硬件形态」的断言把它钉死（`m242-tab-cycle-key-tokens.spec.ts` 的两条「边界固化」）。
3. **从未有真机证据**：`⌘}` / `⌘{` 的按键链路在场景 45 里一直登记为「未验」，单元 / chromium 测试
   只证明了**假设**的形态能命中。

## 兼容性与消费者（AGENTS.md「变更默认直接切断」）

- **消费者只有一人**：作者本人。没有外部用户、已发布契约或不可逆数据。
- `[keys]` 配置若写过 `Cmd-Shift-]` 这类**旧口径下永不命中**的键位，现在会绑定到同一物理键
  （即 `Cmd-}`），语义从「死键」变为「生效」——这是修复本身，不做迁移、不双写、不留过渡层。
- 反向：原本把 `Cmd-Shift-<digit>` 当独立键位写的配置，现在归一到 `Cmd-<Shift 后字符>`；仓内
  `KEY_BINDINGS` 无此形态的绑定（`rg` 已核），零行为变化。

## Non-goals

- 不改 `⌘⇧]` / `⌘⇧[` 的方向映射，不动 `tab.next` / `tab.prev` 的命令实现与 `cycleTab` 语义。
- 不为物理键盘形态另开一条 `event.code` 判定通道：`[keys]` 配置文本没有 `code`，两条侧路会让
  表与配置口径分叉（design 里的备选方案与取舍）。
- 不做标签编号显示（`⌘1–9` 可见化）——那是独立的可选改进，只出设计与成本评估，未经 Alex 确认
  不实施。
- 不更新任何视觉基线。

## Impact

- specs：`keymap-commands`（标签命令族的 token 形态 requirement 与 scenario）。
- 代码：`src/keys.ts`、`src/key-glyphs.ts`、`src/copy-data.ts`、`文案-Copy.md`。
- 测试：`tests/unit/keys.test.ts`、`tests/visual/scenes/m242-tab-cycle-key-tokens.spec.ts`。
- 验收：`scripts/acceptance/scenarios/45-tab-cycle-keys.md`、`scripts/acceptance/README.md`
  的「键盘注入通道的两类不可达」第 2 条。
