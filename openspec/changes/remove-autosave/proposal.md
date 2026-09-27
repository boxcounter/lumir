# Proposal: 去掉自动保存，保留 dirty 守卫与崩溃备份

- Change ID: remove-autosave
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

### 一、裁决与前置结论

Alex 裁决原话（2026-09-27）：**「去掉自动保存，保留守卫+备份。」** 前置讨论结论（Alex 认可）：「不静默丢失未保存内容」由**退出 / 切文件守卫 + 崩溃备份**两条机制覆盖，自动保存不是必要条件。

本 change 只出提案，不实现；实现待 Alex 节点 1 评审通过后另立 mission。

### 二、事实核查：Emacs 本家模型的落点是「独立文件」，不是「原地写」

前置讨论把 Emacs 说成「手动保存 + 备份」。这句话在**落点**上成立，但需要说准——核查过 Emacs 手册后，它的形态比原表述更贴合本 change：

- Emacs 的 `auto-save-mode` **默认开着**（`auto-save-default` 默认 `t`），但「在**另一个文件**里自动保存每个被访问的文件，不改动你实际使用的那个文件」，产物是 `#foo#` 一类的 auto-save 文件（[GNU Emacs Manual, 20.6 Auto-Saving](https://www.gnu.org/software/emacs/manual/html_node/emacs/Auto-Save.html)）。
- 把内容写回**被访问文件本身**的自动保存是 `auto-save-visited-mode`，**非默认**（同上页：「When `auto-save-visited-mode` is enabled, Emacs will auto-save file-visiting buffers after five seconds of idle time」——它是一个需要显式打开的 mode）。写被访问文件这件事，在 Emacs 默认配置里只由 `C-x C-s`（`save-buffer`）触发。
- Emacs 自动保存的触发是两个：键入字符数（`auto-save-interval` 默认 300）与空闲时长（`auto-save-timeout` 默认 30 秒）（[20.6.2 Controlling Auto-Saving](https://www.gnu.org/software/emacs/manual/html_node/emacs/Auto-Save-Control.html)）。

**结论**：本 change 要删的是 `auto-save-visited-mode` 那一种（原地写用户文件），要保留并扶正的是 `auto-save-mode` 那一种（定时把 dirty 内容写进一个**独立于文档的保险副本**）——本仓的对应物就是崩溃备份目录。校准后的理由比原表述强：不是「Emacs 没有自动保存，所以 Lumir 也不要」，而是「Emacs 默认就不让后台定时器写你的文件；Lumir 现在这一层恰恰是 Emacs 默认关掉的那一层」。

### 三、现状的三条代价（为什么是现在）

1. **自动保存是本仓唯一的「无人值守写用户文件」路径，M266 定案的产品缺陷长在它的失败分支上**。真因读数（`docs/backlog.md:802-813`）：应用自己那次自动保存产生的 FSEvents 回声，在缓冲区已重新 dirty 时走 `isDirty(path)` 分支（该分支不做 revision 比对，干净的兄弟分支才有 `reloadDocument(onlyIfChanged)`），于是被当成「检测到外部修改」→ 暂停自动保存 + 弹处置浮条 → **这次改动永不落盘，只留一份崩溃备份**。两条诊断日志相隔 177ms 即为此现场。
2. **它为「无人值守写盘」配套了一整套状态机，且这套状态机随动作一起失去存在理由**：按路径的暂停原因集合（`paused`，`src/save-controller.ts:191`）、跃迁诊断埋点（`autosave_paused` / `autosave_resumed`）、`saveDocument` 的 `auto` 标志与两条专属文案（`文案-Copy.md` D55 / D56）。动作移除后它们没有消费者——正是 [REVIEW.md](../../../REVIEW.md) 第 9 条（「值或开关声明了却没有消费者」）点名要收的形态。
3. **定位对齐**（ADR 0006：当前阶段为 Emacs keybinding PKM）：Emacs 里「文件何时被改写」始终由作者按下 `C-x C-s` 决定；Lumir 的 `⌘S` 已经是同一件事。「停止输入 2 秒就替你写文件」既不与 Emacs 默认形态对齐，也让写盘时机脱离作者的手感。

### 四、「不静默丢失未保存内容」逐条核对（自动保存不在任何一条的必要条件里）

| 场景 | 覆盖机制 | 自动保存的角色 |
|---|---|---|
| 退出 / 关窗 | 后端 `DirtyState` 镜像（取任一标签有未保存修改）+ 拦下提示 | 无 |
| 切换 vault / 关标签 | dirty 守卫拦下并给三条出口（保存并关闭 / 放弃修改并关闭 / 取消） | 无 |
| 切换文件 | 有路径的标签 dirty **不拦**（改动留在原标签，`multi-tabs` 的「未命名文档的 dirty 守卫」） | 无 |
| 崩溃 / 强杀 | 崩溃备份目录 + 启动恢复入口（M127） | 备份的触发时机目前**借道**自动保存的失败分支——本 change 把它改成自有触发 |

### 五、代价如实记账

- **崩溃窗口的定义变了**：从「停止输入 2 秒后内容已进 vault」变成「停止输入 2 秒后内容已进备份目录，vault 内文件只在你按 `⌘S` 时更新」。备份与保存是两种东西：备份只保证**内容不丢**，不保证**磁盘文件是最新的**——用户在别处（如 Obsidian）打开同一份文件时看到的是上次保存的版本。这是本 change 最主要的行为变化，也是它换来「写盘时机由作者掌握」的代价。
- **可能忘记保存**：缓解面是现状已有的常驻信号（modeline 路径段旁的「（未保存）」+ 标签栏 dirty 点），本 change 不改它们（见决策点 D3）。
- **崩溃窗口的最坏情形**：用户在持续键入期间崩溃（中间没有任何 2 秒停顿）时，丢失自上次停顿以来的全部内容。Emacs 用 `auto-save-interval`（300 字符）封住这个洞；本 change 是否引入同类机制见决策点 D1。

## What Changes

1. **移除 fs-io 的「自动保存与暂停边界」整条 requirement**（含停止输入 debounce 自动保存、三条暂停边界、成功后与手动保存一致的 dirty 清除语义）。被移除条款的承接面逐条写在 delta 的 REMOVED 块里，不做静默删除。

2. **崩溃备份改为自有触发**：dirty 后独立的 debounce 窗口到期即写备份（每次内容变化重置窗口，连续输入期间不写），不再依附自动保存的保存动作或失败分支。崩溃备份 debounce SHALL 按标签的文档路径键控（承接 `multi-tabs`「保存粒度按标签隔离」的同一不变量：定时器不跨标签共享）。

3. **备份的生命周期与 dirty 对齐（新增条款）**：内存内容回到「与磁盘基准逐字节相同」的任一路径（保存成功、强制覆盖、另存为新文件、撤销 / 重做回到基线、重新载入放弃我的修改、关闭标签放弃、切换 vault 放弃）SHALL 清除该路径的备份。理由：备份从「冲突待决时的罕见避险」变成「每次停止输入都会写的常规状态」之后，不清除会退化成系统性的假提示——用户明明撤销了修改，下次启动却被追问要不要恢复（见 [design.md](design.md) §5）。

4. **`⌘S` 手动保存语义零改动**：CAS 并发边界、`document_conflict` 的两个逃生口、`fs_not_found` 的另存链路、`document_write_unknown`、原子替换与 ghost 治理全部保持既有 requirement 原样（delta 中的 MODIFIED 只删掉 scenario 里「或自动保存 debounce 到期」这个已经不存在的前提）。

5. **自身写盘回声的识别改为与 dirty 无关的 revision 判据**（决策点 D2）：命中打开中文件的 `modified` 事件到达时先比对磁盘 revision 与会话已知基准，一致即判为自身写入的回声，不产生任何用户可见处置——**不论编辑器当前是否 dirty**。这是把 M266 定案的缺陷一并收口；不选它时的残留风险见 D2 的取舍栏。

6. **交叉引用逐条改准**：`multi-tabs`（保存粒度按标签隔离）、`keymap-commands`（撤销与重做）、`editor-live-preview`（dotfile 与 JSONC 文件的可编辑性）、`file-tree`（点击打开文件与可编辑性裁决）四处提到自动保存的 requirement 同步改写，避免归档后 living spec 与实现互相矛盾。

7. **诊断事件集收窄**：删 `autosave_paused` / `autosave_resumed`（Rust 侧 `LogEventName` 枚举、ts-rs 导出、`diagnostics` spec 的 Purpose 一句）。`save_conflict` / `save_external_change` / `recovery_written` / `recovery_restored` 保留。

8. **零改动的面**：dirty 守卫三条（退出 / 切 vault / 关标签）、「无落盘基准」的保存反馈（M130）、后端 `DirtyState` 镜像、`.lumir-` 临时文件 ghost 治理、恢复目录的位置编码与恢复提示形态、Emacs 键位表。

## 决策点（待 Alex 节点 1 裁决）

| # | 裁决点 | 落槌形态（已写进 delta） | 备选（代价可读） | 取舍与建议 |
|---|---|---|---|---|
| **D1** | 无自动保存后，崩溃备份的触发时机与频率 | **单一 idle debounce，初始值 2000ms**（数值沿用 `AUTOSAVE_DEBOUNCE_MS`，常量改名 `RECOVERY_DEBOUNCE_MS`）：每次内容变化重置窗口，窗口到期且仍 dirty 即写一份备份；实现期按实测复核绝对值（⚠ 裁决点） | (a) 对齐 Emacs 的**双触发**：idle 30 秒（`auto-save-timeout` 默认值）+ 键入 300 字符（`auto-save-interval` 默认值）各触发一次；(b) idle 2 秒 + 时间节流（每 N 秒至多写一次，防大文档高频写） | **建议取 2000ms**。理由：崩溃窗口与今天等价（今天也是「停止输入 2 秒后内容才离开内存」，只是目的地从 vault 换成恢复目录），验收场景的等待时长不必重定；备份落点不在 vault、不进 watch、覆盖式写入，单次代价是「每次停顿一次小文件写」。取 30 秒把窗口放大 15 倍以省写盘，在本仓文档只有几十 KB 的量级上不值得。备选 (a) 的**字符数触发**封住的是「连续输入从不空闲 ⇒ 永不备份」这个极端洞（本 change 不引入，如实记账为已知边界：完全不停顿的长时键入期间崩溃会丢掉自上次停顿以来的内容）；引入它的代价是写入可能落在键入路径上，与 ADR 0002 §6 的 keypress-to-paint 预算冲突——要做就该配异步队列 + 时间节流，属另一个 change |
| **D2** | 手动 `⌘S` 的自写回声是否仍需抑制（场景 43 那类竞态） | **收口，纳入本 change**：把「自身写入回声」的判据从「保存进行中」（`saving.has(path)`，保存一结束抑制即撤）改成「磁盘 revision == 会话已知基准」，并**去掉它只作用于 clean 分支的限制**——dirty 时同样先比对再决定是否报「外部修改」 | (a) 不修，只依赖「自动保存移除后触发面消失」；(b) 修但另立 change | **建议收口**。worker 评估（口径与读数见 [design.md](design.md) §4）：自动保存移除后，写盘只剩用户显式动作，误报窗口从「每次停顿 2 秒后都可能」收窄到「按下 `⌘S` 之后的一二百毫秒内又继续键入」——E2E 实测那对日志相隔 **177ms**，而人手一次按键间隔通常 ≥100ms，窗口极小但不为零。代价一侧：误报的后果不只是噪音，它给出的动作之一「重载（放弃我的修改）」会让用户丢掉刚敲进去的内容；修法是复用 clean 分支**已经做过**的那次 revision 读取，不新增通道。结论：窗口小 ≠ 归零，而修它的成本低于它造成一次静默丢内容的成本 |
| **D3** | masthead dirty 标记与 modeline 的呈现是否变化 | **不变**：modeline 路径段旁的「（未保存）」与标签栏 dirty 点原样保留，本 change 不新增常驻指示、不改措辞 | (a) 备份落盘时给一条瞬时提示（Emacs 在 echo area 打 `Auto-saving...`，见上文手册；本仓的同位物是 toast）；(b) modeline 增加一段「已备份 · HH:MM」常驻段 | **建议不变**。(a) 的代价与 D1 的取值直接耦合：备份每 2 秒停顿就写一次，配一条 toast 就是把界面刷成噪音（Emacs 能这么打是因为它的节奏是 30 秒 / 300 字符）；(b) 违反 modeline「只读派生、零新状态」的既有口径（`src/main.ts:994-1007`），且「未保存」标记本身已经答了用户要问的那件事。注意有一条**文案净减少**：自动保存移除后 `已自动保存`（D55）与「已自动保存当前快照，仍有未保存修改」（D56）两条文案退场，属删除而非新增 |

## Non-goals

- **不做任何替代形态的自动写盘**：`onblur` / 关窗 / 定时器改写被访问文件一律不做——那只是把同一个动作换个触发点，本 change 的意图正是收回这个动作。
- **不做可配置的备份间隔**：v1 是固定常量，配置化留待有实测依据时再提（沿用 save-hardening 的非目标口径）。
- **不做多版本历史 / 快照列表**：恢复目录仍只保留每个 (vault, 相对路径) 的最新一份。
- **不改 CAS、原子替换、恢复目录位置编码、恢复提示形态与两个动作**：这些是 M124/M127 已定稿的口径，本 change 不动。
- **不改 dirty 守卫与「无落盘基准」的反馈文案**（M101 / M130）：守卫是本 change 的前提，不是变更对象。
- **不改 Emacs 键位面**：`⌘S` 已是既有绑定，不新增键位、不动 `[keys]` 配置层。
- **不引入「备份即保存」**：备份 MUST NOT 被当作落盘成功（不推脏基准、不清 dirty、不发「已保存」反馈）。
- **不动 `docs/process/real-machine-acceptance.md` 的场景编号体系**：本 change 只改场景内容与「08 家族」的组成（见 [tasks.md](tasks.md) §5），不重排编号。

## Impact

- **影响的 specs**（delta 逐条）：`fs-io`（**REMOVED ×1**：自动保存与暂停边界；**MODIFIED ×5**：watch 增量事件流、文档保存与冲突恢复、崩溃备份与恢复入口、不可保存文档的保存反馈、app 内文件操作的 tab 联动）、`multi-tabs`（MODIFIED ×1：保存粒度按标签隔离）、`keymap-commands`（MODIFIED ×1：撤销与重做）、`editor-live-preview`（MODIFIED ×1：dotfile 与 JSONC 文件的可编辑性）、`file-tree`（MODIFIED ×1：点击打开文件与可编辑性裁决）。`diagnostics` **无 requirement 增量**，但它的 Purpose 一句列举了「autosave 暂停/恢复」，归档时须一并改准（见 tasks）。**不新建 capability**，**不新增 requirement 名**；`崩溃备份与恢复入口` 内新增两条 scenario（「连续输入期间不写备份」承接被移除 requirement 的同名不变量、「放弃修改与撤销回到基线清除备份」承载新生命周期条款），scenario 名保留的约束与理由见 delta 内注释。
- **影响的代码/系统**（实现期；本 mission 零产品代码改动）：`src/save-controller.ts`（删 `paused` / `pauseAutosave` / `resumeAutosave` 与两个诊断埋点；`reconcile` 拆成「备份到期」一条路径；`saveDocument` 去掉 `auto` 标志与部分快照文案；`handleExternalChange` 的 dirty 分支加 revision 判定；备份定时器改为 `RECOVERY_DEBOUNCE_MS`；新增「dirty 转 clean ⇒ 清备份」的单一落点）、`src/editor.ts`（注释口径：`onDocChanged` 的订阅语义由「自动保存排期」改为「备份排期」；dirty 转 clean 的钩子）、`src/tabs.ts`（放弃修改并关闭 ⇒ 清备份）、`src/main.ts`（dirty 镜像与守卫零改动；注释同步）、`src/vault-switcher.ts`（放弃修改并切换 ⇒ 清备份）、`src-tauri/src/logging.rs` 与 `src/bindings/LogEventName.ts`（收窄事件集）、`文案-Copy.md`（D55 / D56 退场）、`docs/process/real-machine-acceptance.md` 第 8 行与第 80 行（场景家族组成）。**`src-tauri/src/recovery.rs` 零改动**（备份接口与位置编码不变）。
- **影响的验收/测试**：真机 `scripts/acceptance/scenarios/08-autosave.md`、`08b-autosave-pause.md`（两条断言的是被移除的行为）、`08c` / `08d`（前提从「冲突待决使自动保存停手」改为「dirty 后 debounce 到期即备份」）、`43-list-tab-indent.md`（正文与等待步）、以及 9 条把「自动保存 2 秒防抖」当判据窗口或把「外部改写暂停自动保存」当脏态保持手段的场景（清单见 [tasks.md](tasks.md) §5）；视觉 `tests/visual/scenes/save-hardening-autosave.spec.ts`（前两组用例断的是自动保存本身）、`m149-tabs.spec.ts`、`m131-keymap-behavior.spec.ts`、`m132-keymap-config.spec.ts`、`m130-text-open-trap.spec.ts`（注释与判据前提）；单元 `tests/unit/save-controller.test.ts` 与 `tests/unit/harness.ts`。**视觉基线**：本 change 不动 UI 结构，预期零基线变化（`已自动保存` 的 toast 只出现在有自动保存的场景里）；实现期须用一次全量视觉跑验证「零基线变化」这个预期，不静默 `--update`。
- **关联约束**：ADR 0006（Emacs keybinding PKM，写盘动作归作者）、ADR 0002 §6（性能合同——备份写入 MUST NOT 落在键入到绘制路径上）、ADR 0003 §3（铁律——备份写恢复目录，MUST NOT 改写 vault 内源文件；恢复仍经保存链路）、ADR 0002 §5（配置即数据——本 change 不新增配置项）、ADR 0004 §5（功能变更走 OpenSpec）、[REVIEW.md](../../../REVIEW.md) 第 9 条（声明必须有消费者）。
