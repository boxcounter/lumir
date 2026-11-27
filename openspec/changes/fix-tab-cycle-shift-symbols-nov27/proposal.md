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
> **节点 2 状态：未放行（未归档）。** 完整 `scripts/gate.sh visual` 在 rebase 后跑了四次，均为
> `GATE RESULT: 14/15 PASS（SKIP 0）`：第 1 次红在 `unit-tests`（`link-suggest` 微基准被并发他树
> 单测打红）；第 2 次红在 `docs-check`（tasks 全勾后缺 backlog 队列条目，已补）；第 3、4 次红在
> `editing-oracle.spec.ts:1143`（master 侧既有 flaky oracle：隔离 4/4 PASS、第 1/2 次完整 visual
> 通过，全量串行下约半数失败；END 归档条有 A/B 候选 40/40 vs master 37/40）。四次红均不在本
> change 的键位代码 / 场景面；按「仍有红不归档」纪律停在此处，是否再跑或按既有 flake 判定由
> 主会话决定。证据：
> `.local/reviews/tab-navigation-keys-nov27/evidence/gate-visual-rebased-{1,2,3,4}-*.log`。

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
