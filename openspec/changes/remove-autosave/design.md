# Design: remove-autosave

本文是 [proposal.md](proposal.md) 的技术方案与证据。两类读者：Alex（不看代码即可裁决——决策点与代价在 proposal，本文只补机制与读数）、实现 agent（按本文施工）。每条断言带 file:line 或实测读数。

## 1. 现状：自动保存与崩溃备份是一个两段式耦合

崩溃备份今天**没有自己的触发口**，它挂在自动保存的失败分支上：

```
内容变化 → onDocChanged（src/save-controller.ts:652）重置 2s 定时器
        → 到期 reconcile（:665）
            ├─ 该路径有暂停原因（paused 非空）或在途保存 → backupDirty（:683）
            └─ 否则 saveDocument(true)（:372）→ 失败再 backupDirty
```

- `paused` 集合与两个写入点：`pauseAutosave`（`:216`）/ `resumeAutosave`（`:227`）。
- 暂停原因的产生点四处：`handleExternalChange` 的 `deleted`（`:616`，`not-found`）与 `modified` + dirty（`:622`，`external`）、`saveDocument` 的 `document_conflict`（`:406`）与 `fs_not_found`（`:409`）、`forceSaveCurrentFile` 的 `document_conflict`（`:487`）与 `fs_not_found`（`:491`，`not-found`）。
- 备份目录与恢复入口本身与自动保存无关：`src-tauri/src/recovery.rs` 的接口、位置编码（`<config_dir>/recovery/<vault-key>/<path-key>`）、CAS 基准记录、启动枚举与两个动作（`src/save-controller.ts:694-760`）。

**结论**：移除自动保存不能只是「删掉排期与落盘」——备份的触发条件（「自动保存该写而没写成」）随之失效。所以本 change 的第一件实现工作是**把备份从 `reconcile` 的失败分支里摘出来，给它自己的定时器**；`recovery.rs` 与恢复入口零改动。

## 2. 目标形态：三条机制的职责表

| 机制 | 触发 | 覆盖的失败模式 | 本 change |
|---|---|---|---|
| **dirty 守卫**（M101） | 用户主动离开（退出 / 关窗 / 切 vault / 关标签） | 主动放弃前忘记保存 | **零改动**（本 change 的前提） |
| **崩溃备份**（M127，改触发） | **自有 debounce**：dirty 后停止输入满窗口 | 进程非正常结束（崩溃 / 强杀 / 断电） | 触发改为自有；生命周期补「与 dirty 对齐」 |
| **手动 `⌘S`** | 用户按下 | —（这是写回 vault 的唯一入口） | 语义零改动；删除面见 §7 |
| ~~自动保存~~ | ~~停止输入 2s~~ | （移除） | **整条移除** |

三者的并集覆盖「不静默丢失未保存内容」的全部可达路径：主动离开由守卫接、被动中断由备份接、写回磁盘由 `⌘S` 接。自动保存在这张表里是**唯一**没有独立职责的一格——它的效果（`⌘S` 的自动化）在「作者自己按」这条口径下不需要。

## 3. 备份触发设计（决策点 D1）

### 3.1 形态

- 常量 `RECOVERY_DEBOUNCE_MS`，初始值 `2000`（沿用 `AUTOSAVE_DEBOUNCE_MS` 的数值，`src/save-controller.ts:43`）。备份目的地从 vault 内文档换成恢复目录，**窗口值保持与今天等价**：今天也是「停止输入 2 秒后内容才离开内存」，只是那时它进的是 vault。
- 定时器按**文档路径**键控（现状 `timers` 已如此，`:193`），承接 `multi-tabs` 的「保存粒度按标签隔离」——切标签不把待写定时器带到新文档。
- 每次内容变化重置窗口；到期时仍 dirty 才写。含 dirty 但**无落盘基准**的路径照旧显式跳过（M130 的裁决，`backupDirty` 已有该判断，`:683-688`）。

### 3.2 为什么不用 Emacs 的 30 秒 / 300 字符

Emacs 的 `auto-save-timeout` 默认 30 秒、`auto-save-interval` 默认 300 字符（[20.6.2 Controlling Auto-Saving](https://www.gnu.org/software/emacs/manual/html_node/emacs/Auto-Save-Control.html)）。照搬的代价：

- 30 秒空闲窗口把崩溃窗口从今天的 2 秒放大 15 倍，而省下的是「每次停顿一次小文件写」——本仓文档量级是几十 KB 到 1MB 上限（ADR 0002 §6 的常驻内存合同量级），写恢复目录的成本远低于丢 30 秒工作。
- 300 字符触发是**写入落在键入路径上**的机制：Emacs 可以这么干（它的写入是 in-process `write-region` + 由 `auto-save-no-message` 抑制消息），Lumir 的写入是一次跨进程 IPC（webview → Rust）。要引入它，必须先做异步队列 + 时间节流并实测键击延迟，属另一个 change。本 change 如实记账为已知边界（§8 第 1 条）。

### 3.3 IO 代价与键入路径

- 备份是**覆盖式单文件写**（`recovery.rs`：每个 (vault, 相对路径) 只保留最新一份），不追加、不留历史。
- 写入 MUST NOT 落在 keypress-to-paint 路径上（ADR 0002 §6）：窗口到期才写，且走异步 IPC（现状 `backupDirty` 已是 `await` 的异步调用，失败只作罢、不打断编辑，`:688`）。实现期须取一次大文档实测读数落档（tasks §3.2）。
- 备份写入**不影响 dirty**：它不推脏基准、不清 dirty、不发「已保存」反馈。备份 ≠ 保存（Non-goals）。

## 4. 自写回声的判据（决策点 D2）

### 4.1 现场

`docs/backlog.md:802-813` 的读数（M266 定案）：同一秒内诊断日志记下 `save_external_change(path=…)` + `autosave_paused(reason=external)`，而该文件 mtime 正是应用自己那次自动保存的时刻，两条相隔 **177ms**——「外部修改」是自己写盘的回声。

机制在代码里是两行：`handleExternalChange`（`src/save-controller.ts:612`）首行 `if (saving.has(path) || …) return;`（`:613`）只在**保存进行中**抑制自身事件；保存一结束抑制即撤，回声随后才到。此时若缓冲区已重新 dirty，走的是 `isDirty(path)` 分支（`:620-637`）——**该分支不做任何 revision 比对**（干净的兄弟分支有 `reloadDocument(path, {onlyIfChanged: true})`，`:632`），于是直接弹「检测到外部修改」并停掉自动保存。

### 4.2 移除自动保存后的残余窗口（worker 评估）

自动保存移除后写盘只剩显式动作，误报窗口从「每次停顿 2 秒后都可能」收窄为：

**按下 `⌘S`（或其回声源动作：强制覆盖保存）之后的约 100–200ms 内又继续键入。**

- 窗口下界由 FSEvents 的投递延迟给（实测读数 177ms，上引）。
- 窗口上界由人手按键间隔给（连续打字通常 ≥100ms/键）。
- 因此窗口极小，但**不归零**：用户完全可能按完 `⌘S` 立刻接着敲。
- 后果不是纯噪音：该提示给的两个动作之一是「重载（放弃我的修改）」，用户若信了这条假警报并点它，会丢掉刚敲进去的内容。**误报的期望代价 = 假警报频率 × 用户照做的概率 × 丢掉的内容**；修法的成本则是复用一次已经存在的 revision 读取。

### 4.3 判据与降级

- 判据：事件命中打开中文件时，读一次磁盘 revision（`fsReadSnapshot`，`src/ipc.ts:71`）与该会话已知基准（`revisions`，`src/save-controller.ts:187`）比对——**一致即回声**，直接返回，不产生任何用户可见处置；不一致才进入 dirty / clean 分流。判据 MUST NOT 依赖 `isDirty(path)`。
- 降级：读取失败（无 Tauri 后端 / IO 错）时按「不是回声」处理——宁可多提示一次，也不静默忽略一次真实的外部修改。
- 不做：不引入「保存在 N 毫秒内到达的事件一律忽略」这类时间窗抑制——时间窗是猜，revision 是事实；同一份代码里 clean 分支已经在用事实判据。

## 5. 备份生命周期与 dirty 对齐（新增条款的由来）

### 5.1 为什么本 change 必须处理它

今天备份**只在冲突 / 外部修改待决 / 目标被删**时落盘——这些都是低频事件，所以「用户明确放弃修改后备份仍在磁盘上」这条路径少见（但已存在）。本 change 把触发改成「每次停止输入都会写」之后，残留备份会变成**系统性**的：编辑 → 停顿 2 秒（备份落盘）→ 撤销回到基线 / 关标签放弃 / 重载放弃 → 下次启动仍被追问「发现未保存的崩溃备份：x.md，要恢复吗」。这是把保险机制变成噪音源，而且追问的是用户已经明确放弃过的内容。

### 5.2 现有清除面与缺口

`recoveryDiscard` 今天的调用点只有四处（`rg recoveryDiscard src/`）：

| 位置 | 时机 |
|---|---|
| `src/save-controller.ts:391` | 手动保存成功 |
| `src/save-controller.ts:480` | 强制覆盖保存成功 |
| `src/save-controller.ts:537` | 另存为新文件成功 |
| `src/save-controller.ts:758` | 恢复提示的「丢弃备份」动作 |

**缺口（内存内容回到磁盘基准但备份留下的路径）**：

| 路径 | 现状 | 落点候选 |
|---|---|---|
| 撤销 / 重做回到已保存基线 | `markCleanOf`（`src/editor.ts:1967`）只服务保存面；撤销走 docChanged 的 `setSessionDirty`（`:1255`）判定，不清备份 | 按路径的 dirty 转 clean 订阅 |
| 重新载入（放弃我的修改） | `discardAndReload`（`src/save-controller.ts:593`）只重载 + 提示 | 同上 |
| 关闭标签时放弃修改 | `src/tabs.ts` 的三出口之一 | 同上（或显式调用） |
| 切换 vault 时放弃修改 | `save-controller` 的 `vaultSwitchBlock` 出口 | 同上（批量：被放弃的每个路径） |

### 5.3 建议的单落点

`save-controller` 已经订阅了逐标签的 dirty 变化（后端 `document_set_dirty` 镜像用同一通道，`src/main.ts:1026` 起）。在**同一处**补一句「该路径 dirty 由 true 转 false ⇒ `recoveryDiscard(path)`」，即可用一个落点覆盖上面四条 + 已有的三条保存路径（保存成功时 dirty 也会转 false，重复清除是幂等的空操作，但实现上仍保留现有三处显式清除以免依赖时序）。**防假绿**：实现期把其中一条路径临时注释掉，确认对应用例变红（REVIEW.md 第 1 条，tasks §3.4）。

### 5.4 语义

备份存在的意义是「内存内容与磁盘基准不一致且尚未落盘」；为 false 时备份无意义。这条对齐之后，「下次启动出现恢复提示」才重新等价于「确实有一份没落盘的内容」。

## 6. dirty 呈现（决策点 D3）

现状与处置：

| 呈现面 | 现状 | 本 change |
|---|---|---|
| modeline 路径段后缀 | `session.dirty` 时拼「（未保存）」（`src/main.ts:991`） | **不变** |
| 标签栏 dirty 点与读屏名 | 逐标签（`src/tabs.ts:222`） | **不变** |
| 后端 `DirtyState` 镜像 | 取任一标签 dirty | **不变** |
| 自动保存成功的 toast | `已自动保存`（D55）、`已自动保存当前快照，仍有未保存修改`（D56），`文案-Copy.md:46-47` | **退场**（净减少两条文案） |

不加备份指示的理由：备份是保险而不是状态，它的成功与否不影响用户要做的任何决定（用户唯一要做的事是「按 `⌘S`」）；而 modeline 右段的口径是「只读派生、零新状态」（`src/main.ts:994-1007`），加一段备份时间是往派生面上塞可变状态。对照：Emacs 自动保存时会在 echo area 打 `Auto-saving...`（[20.6 Auto-Saving](https://www.gnu.org/software/emacs/manual/html_node/emacs/Auto-Save.html)）——它能这么打是因为节奏是 30 秒 / 300 字符；本 change 取 2 秒窗口（§3.1），配一条 toast 会把界面刷成噪音，两者不可拆开看。

## 7. 删除面清单（逐处）

| 位置 | 内容 | 处置 |
|---|---|---|
| `src/save-controller.ts:43` | `AUTOSAVE_DEBOUNCE_MS` | 改名 `RECOVERY_DEBOUNCE_MS`（§3.1） |
| `:187-195` | `paused` 集合、`timers` 注释 | 删 paused；timers 归备份 |
| `:216-236` | `pauseAutosave` / `resumeAutosave` + 两处诊断埋点 | 删 |
| `:246-252` | `cancelScheduledState` 的 paused 清理 | 随 paused 删 |
| `:612-643` | `handleExternalChange` 的两处 `pauseAutosave` | 删；补 §4.3 的 revision 判定 |
| `:372-400` | `saveDocument(auto, …)` 的 `auto` 参数与「已自动保存当前快照」分支 | 删参数与分支 |
| `:593-600` | `discardAndReload` 的 `resumeAutosave` | 删；补清备份（§5） |
| `:652-671` | `onDocChanged` / `reconcile` 的两段式 | 拆成单一「备份到期」路径 |
| `src/editor.ts:1054-1056`、`:1197` | 注释「自动保存排期挂这里」 | 改述为「备份排期」 |
| `src/main.ts:563`、`:734` | 注释列举自动保存 | 改述 |
| `src/vault-switcher.ts:46` | 注释以自动保存 2s 作对照 | 改述（对照物改为备份窗口） |
| `src-tauri/src/logging.rs:79-81`、`:111-112`、`:423` | `AutosavePaused` / `AutosaveResumed` 与注释 | 删枚举项与注释；重导出 `src/bindings/LogEventName.ts`（先 `git add`，M249 纪律） |
| `文案-Copy.md:46-47` | D55 / D56 | 退场（标注原因与日期，不重编号） |
| `openspec/specs/diagnostics/spec.md:5` | Purpose 列举「autosave 暂停/恢复」 | 归档时手工改准 |

`src-tauri/src/recovery.rs` **零改动**；`src-tauri/src/commands.rs` 零改动。

## 8. 已知边界与不做的事

1. **连续键入期间崩溃**：本 change 只有空闲窗口一个触发（§3.2），若用户从不停顿满一个窗口，崩溃会丢掉自上次停顿以来的内容。封住它的是 Emacs 的字符数触发，本 change 不引入（理由见 §3.2）。如实记账，不写成「零丢失」。
2. **备份不是保存**：磁盘文件只在用户按 `⌘S`（或走冲突处置）时更新。用户在别的程序打开同一份文件时看到的是上次保存的版本——这是本 change 最主要的行为代价（proposal §五）。
3. **恢复提示不再出现的前提是 §5 的清除面全部落地**：只删自动保存、不补生命周期，会把「保险」变成「每次启动都追问要不要恢复你已放弃的内容」。
4. **D2 不做时的残余风险（条件项，未触发）**：若 D2 被判为不做，假「检测到外部修改」提示与它那条破坏性动作仍在（窗口与后果见 §4.2），须在 `docs/backlog.md` 登记该风险（tasks §4.4）。**D2 于 2026-09-27 裁决采纳推荐 ⇒ 本条不适用**，保留作备选路径的记账。
5. **不做替代性自动写盘**（`onblur` / 关窗 / 定时写被访问文件）：那只是把同一个动作换个触发点。
6. **不做备份间隔的配置项**：v1 固定常量，配置化留待有实测依据（沿用 save-hardening 的非目标口径）。
7. **不做多版本历史 / 快照列表**：恢复目录仍只留每个 (vault, 相对路径) 的最新一份。
