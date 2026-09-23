# Proposal: 记住文档阅读位置（下次打开从上次位置继续）

- Change ID: remember-reading-position
- 日期: 2026-09-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

用户需求原话（2026-09-24）：**「新需求：记住文档阅读位置，下次点从上次位置继续阅读」**。

### 一、诉求面在哪：位置今天只在应用运行期内存在，关掉 app 就回篇首

| # | 现状事实 | 锚点（可复核） |
|---|---|---|
| 1 | 「阅读位置」的既有通道是 CM 的滚动快照：**逐标签存在内存里**，离开标签时取快照、切回来时写回 | `src/editor.ts:859-867`（`EditorSession.scroll` 的类型说明）、`:1461`（离开时 `view.scrollSnapshot()`）、`:1473`（切回时 `view.dispatch({ effects: session.scroll })`） |
| 2 | 快照记的是「某个文档位置锚 + 相对视口的偏移」，**不是裸像素**——直接写 `scrollDOM.scrollTop` 会被 CM 的滚动锚点维护逻辑改掉（M149 实测差 **242px**） | `src/editor.ts:863-865`、`src/main.ts:269` 的同款注释 |
| 3 | 每次**装载**都把位置作废并复位到篇首：`reloadSession` 先 `session.scroll = undefined`，再直接赋值 `scrollTop = 0` / `scrollLeft = 0`（M110 现场：用 `scrollIntoView` 复位会把页首 44px 内边距顶出画） | `src/editor.ts:1541-1542`、`:1563-1567` |
| 4 | 因而今天打开任何**尚未打开**的文档（单击 / 双击 / ⌘-点击文件树、文档内链接跟随、启动后的标签恢复）都从篇首开始；只有「已打开标签之间切换」才保住位置 | `src/main.ts:344-350`（同一文件已打开时短路切标签）、`:369`（否则 `reloadSession`） |
| 5 | 跨会话的持久化通道**已经存在且形状已定**：按 vault 键控、落在配置目录、tmp+rename 原子替换、版本不符或解析失败按「无历史」、越界条目丢弃、写失败只降级 | `src-tauri/src/vault_session.rs:1-14`（模块头：为什么与注册项分开、写入/读取纪律）、`:42-44`（`config_dir()/vault-sessions`）、`:82-120`（sanitize / save_to）；前端侧的防抖、flush、按 vault 换键在 `src/vault-switcher.ts:394-493` |
| 6 | 「位置」这件事在别处已经有口径：vault 浮层收起时先取快照、聚焦后写回，为的就是**不改变阅读位置**（M186），并已写进 living spec | `src/vault-switcher.ts:514-520`、`:659-670`；`src/main.ts:264-271`；`openspec/specs/vault-workspace/spec.md:151-179` |

结论：诉求面真实（第 3、4 条是可复核的现状：关掉 app 再打开，任何文档都在篇首），且**通道齐备**——本 change 是把既有的「位置锚 + 相对偏移」通道从内存延伸到配置目录，不是新造一套滚动机制。

### 二、与相邻问题的边界（本 change 只解第 1 条）

1. **跨会话记住阅读位置** —— 本 change 的诉求面。
2. **多标签会话恢复（重启后按路径列表重开标签）** —— **已由 M162/M163 落地并归档**（`openspec/changes/archive/2026-09-18-multi-vault-workspaces/`），落在 `vault-sessions/<id>.json`；它的**未落地边界如实写着「光标位置、滚动位置与撤销史都不恢复」**（`docs/backlog.md` 第 10 项的状态更新段、`openspec/specs/vault-workspace/spec.md:257` 与 `:288`）。本 change 只补这条边界里的**滚动位置**一格，**不重开** #10 的其余面（见「须提请 Alex 节点 1 裁决」第 4 条）。
3. **「交还焦点 MUST NOT 改阅读位置」的其余四条路径** —— **不承揽**：`docs/backlog.md:244-254`（M186 finding）已记「大纲 Esc / ⌘F 关闭 / 图片遮罩 / ⌘/ 面板」四条没有这层保护，建议下沉编辑器层。那是另一件事（收敛建议，且四条路径真机未复现跳动），本 change 不顺手改它们。
4. **未保存内容的跨会话恢复** —— **不承揽**，归既有崩溃备份能力（`src-tauri/src/recovery.rs`）。本 change 只记位置，不记内容。
5. **图片异步加载引起的文档高度变化** —— **不修**（归 `docs/specs/image-reading.md`）。本 change 与它的唯一关系是**判据设计约束**：恢复的是位置锚而不是像素，且恢复发生在图片字节到达之前；这条交互 MUST 实测（见 design §7）。

## What Changes

1. **打开一份尚未打开的文档时，视口回到上次离开的位置**：装载完成后按「该文档在**当前 vault** 的已存阅读位置」恢复；没有历史（从未读过 / 条目已被清理 / 存储不可读）时从篇首开始，**不给任何提示**。（delta：ADDED `multi-tabs / 打开文档时恢复上次阅读位置`）

2. **阅读位置按 vault 持久化在配置目录**：新增 `<config>/lumir/reading-positions/<vault-id>.json`，键为 **vault 相对路径**（与标签列表同口径：vault 重定位后仍然有效，MUST NOT 存绝对路径），值为「文档位置锚 + 视口偏移（纵向、横向各一个）+ 更新时间」。写盘用 tmp+rename 原子替换；版本不符 / 解析失败 / 越界条目按「无历史」处理；写失败只记 warning，MUST NOT 拦停打开、切换或退出。（delta：ADDED `vault-workspace / 按 vault 持久化阅读位置`）

3. **恢复只施加于「新装载」，绝不用盘上的位置拽走正在阅读的读者**：同一个文件已经在某个标签里打开时（`openFile` 的既有短路），只切标签、保留该标签运行期内的位置——这是本 change 最容易做错的一条（做错的表现是「点一下已打开的标签，正文跳走」）。（delta：ADDED `multi-tabs / 打开文档时恢复上次阅读位置` 的第二个 Scenario）

4. **两条既有禁令收口到「标签文件」的范围内**：living spec 今天写的是「持久化内容 MUST NOT 包含……光标位置与滚动位置」（标签列表那条）与「MUST NOT 恢复光标位置、滚动位置与撤销史」（装载后恢复标签那条）。本 change 不推翻它们的**原意**（不往标签文件里塞位置、不恢复光标与撤销史），但要把「滚动位置」这一格指向新的存储与新的 requirement，否则 living spec 会与实现直接矛盾。（delta：MODIFIED `vault-workspace / 按 vault 持久化标签列表`、`/ 装载后恢复标签列表`）

5. **零新增 UI、零新增键位、零新增配置项**：不出现「继续阅读」按钮、不出现位置气泡、不加开关（REVIEW.md 第 9 条：声明了却没有消费者的假开关）。

### 语义变化（如实登记，给 Alex 一个拒绝面）

今天这三条路径都是「回到篇首」，改动后都变成「回到上次位置」：

| 路径 | 今天 | 本 change 之后 |
|---|---|---|
| 关掉 app 再打开（手工点开文件） | 篇首 | 上次位置 |
| 关掉标签再打开同一文件 | 篇首 | 上次位置 |
| 切走 vault 再切回来（标签列表重建，`openspec/specs/vault-workspace/spec.md:290-293`） | 篇首 | 各标签各自的位置 |
| **同一会话内切标签**（前后台标签之间） | 上次位置（内存快照） | **不变**（仍是内存快照，语义与键控都不换） |

最后一行是有意不动：运行期内的位置属于「标签会话」，已有实现与断言（`openspec/specs/multi-tabs/spec.md:24-32`），本 change 不去把两份通道合并——合并会把「切标签」这条已经稳定的路径卷进来（见 design §1 的取舍）。

## 须提请 Alex 节点 1 裁决的选项

四项都给了推荐项，**推荐项的形态已经按默认写进 delta 与 tasks**；若裁决改成备选，delta 与 tasks 按「备选」列改写，不静默扩 scope。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| 1 | 记什么 | **只记滚动位置**（纵向锚 + 偏移，外加横向 `scrollLeft`） | ① 滚动 + 光标（把插入点也跨会话恢复） | 推荐项就是用户原话的「阅读位置」。①的代价有两层：插入点是**编辑**位、不是阅读位，恢复到用户没选过的地方等于替他做决定；而恢复光标会触发浏览器「把光标滚进视区」——正好与刚恢复的滚动位置争抢（同族现场就是 M186 的焦点交还，`src/vault-switcher.ts:514-517`），两者顺序要单独设计 |
| 2 | 适用面 | **md 与 code 模式都记**（机制与模式无关：锚是文档位置，偏移是像素） | ① 只记 md（v1 最小面） | 推荐项避免一处**可见的不一致**：同一会话内切标签时 code 会话的位置今天就保住了（内存快照与模式无关），重启后却唯独它丢失，看起来像随机行为。①的代价仅此一条，好处是词面更贴「阅读」——若 Alex 认为 code 是「查看」不是「阅读」，取①只需把 delta 的作用面收窄一句 |
| 3 | 条目保留与失效策略 | **每 vault 上限 200 条，超出按更新时间最旧丢弃；vault 装载后按本次枚举清理不在 vault 内的条目；打不开的条目只跳过不删；改名 / 移动视为位置丢失；版本不符或解析失败等价于无历史** | ① 不设上限、不清理（文件随浏览无界增长）；② 只保留最近 30 天（时间维度会误伤「几个月前读一半的书」）；③ 上限收紧到 50（更省，但大 vault 里翻几次就互相淘汰） | 推荐项把「清理」钉在**已有的一次枚举**上（`src/vault-switcher.ts:391` 的 `onVaultLoaded(vaultId, entries)` 已经拿到全量条目表），零新增 IO、零新增读取；上限只防无界增长，200 条约十几 KB。①的代价是 1 万个文件的 vault 逛一遍就留几千条僵尸；②的代价是「上次读到哪」这件事按时效失效，与用户的直觉不符 |
| 4 | 与 backlog 待裁决 #10（标签会话恢复）的关系 | **只补 #10 已明确留下的那格（滚动位置），不重开 #10**：不往 `vault-sessions/<id>.json` 里塞位置、不做光标 / 撤销史恢复、不动 #10 的其余设计 | ① 把位置塞进标签文件（复用现成文件）；② 与 #10 的剩余面合并立项 | 推荐项的理由是**写放大与语义**：滚一下就要重写标签文件（标签文件的写入触发点是标签集合变化，防抖 1000ms），且那条禁令写的就是「不含滚动位置」，要么改它的禁止语义、要么绕开——两份状态各自落盘更省事也更安全。①的代价是每次滚动都牵动「打开哪些标签」这个关键状态；②的代价是 scope 明显变大，且 #10 的建议时机本就是「等 dogfood 反馈常态开几个标签」（`docs/backlog.md:22`），不该被本条拖着一起做 |

**未列入裁决面的硬约束**（写进 delta，不由节点 1 逐条选）：位置 MUST NOT 写进文档或 vault 目录（ADR 0003 §3 铁律）；同一文件已打开时 MUST NOT 用盘上的位置拽走读者；恢复失败静默退化到篇首、不弹提示；不新增键位 / 命令 / 可见 UI / 配置项；恢复 MUST NOT 阻塞首帧，MUST NOT 在打开 1MB Markdown < 100ms 与键入路径上新增解析或测量（ADR 0002 §6）。

## capability 归属：宿主 `multi-tabs`，配套 delta 落 `vault-workspace`

**结论**：**宿主 capability = `multi-tabs`**（用户可见行为与「打开文档时发生什么」这条语义在那里），**配套 delta = `vault-workspace`**（持久化通道与两条既有禁令的收口在那里）。不新建 capability。

| 本 change 的条款 | 为什么落在这里 |
|---|---|
| 「打开文档时恢复上次阅读位置」的触发点与「已打开时不拽走」的边界 | 这正是 `multi-tabs` 的「打开与固定语义」那一族：单击复用预览标签、双击 / ⌘-点击新开固定标签、链接跟随就地替换、同一文件不重复开——恢复位置必须挂在这些既有落点上才说得清，写成别处都要回头引用它们 |
| 「位置锚 + 相对偏移」这个值语义 | `multi-tabs` 的 living spec 已经定义过同一件事（「每个标签 SHALL 逐标签持有……离开时的滚动位置」「滚动位置 MUST 单独逐标签存取——它不在 `EditorState` 里」，`openspec/specs/multi-tabs/spec.md:18-22`）。本 change 是同一语义从「运行期」延伸到「跨会话」，不是新语义 |
| 存哪、按什么键控、什么时候清理、写失败怎么办 | `vault-workspace` 已有同族 requirement（「按 vault 持久化标签列表」）与同族的落盘纪律（tmp+rename、降级 warning、损坏等价于无历史），新存储与它并列最省解释成本；跨会话的落盘面本来也不属于「标签」 |
| 两条既有禁令的收口 | 两条都在 `vault-workspace`（`spec.md:257`、`:288`），不改它们就会出现「living spec 说不恢复滚动位置、实现却恢复」的直接矛盾 |

**反方（如实记录）**：若把宿主定成 `vault-workspace`（理由是持久化面占了三格、且两条要改的条款都在那里），代价是「打开文档时发生什么」这条**最容易做错、也最需要被读到**的行为语义会落在一份讲 vault 装载的 spec 里，读者要从 vault 装载一路读到标签装载才读到「点开文件从上次位置继续」。本 change 取前者（行为面为宿主）并把持久化面留在 `vault-workspace`；若 Alex 认为宿主应在持久化侧，翻转的落点只是两个 delta 文件的归属，条款文字不动。

**为什么不是 `editor-live-preview`**：阅读位置与 md 渲染正交（值形态里没有任何 md 专有的量），本 change 不改任何渲染口径。**为什么不是新建 `reading-position` capability**：新建 living spec 的成本与目的不匹配——本 change 的行为只有「装载时恢复」这一条，值语义已由 `multi-tabs` 定义过、落盘语义已由 `vault-workspace` 定义过；等它长出「进度读数 / 最近阅读 / 跨设备」这类形态时再拆（同 `document-end-marker` proposal 对「阅读进度读数」的处置口径）。

## 观测：怎么知道它有效

- **真机场景**（新增 `scripts/acceptance/scenarios/28-remember-reading-position.md`）：读一半 → 重启 → 手工点开同一文件 → 视口回到原处（AX 可见行判据）。这是本能力的**唯一**端到端判据。
- **chromium 场景**（新增 `tests/visual/scenes/reading-position.spec.ts`）：桩提供「上次已经存了一条位置」的初值 → 打开该文件后读 `scrollDOM.scrollTop` 与顶部可见行；另一半断言写入侧（滚动后 `reading_position_put` 的载荷）。
- **dogfood 手感**：偏多少像素算「回到了原处」是观感问题，归 Alex（门禁只判「同一文档位置锚的顶部可见行相同」，不判像素级手感）。
- **不新增埋点**：本 change 不新增诊断事件（要新增须同时扩 Rust 事件白名单，属另一件小事——`docs/backlog.md` 第 10 项已记同族的一处观测缺口）。观测靠上面两条场景 + dogfood。

## Non-goals

- **不做光标 / 选区 / 撤销史的跨会话恢复**（裁决点 1 的备选①；撤销史另属 `multi-tabs` 已声明不持久化的面）。
- **不做未保存内容的跨会话恢复**：归既有崩溃备份能力（`src-tauri/src/recovery.rs`），本 change 只记位置。
- **不做任何「阅读进度」的可见读数**：百分比 / 进度条 / 剩余行数 / 状态栏读数一律不做（`document-end-marker` 的 proposal 已把这类形态列为另一个方向，本 change 沿用同一口径），也不做「回顶 / 继续上次位置」这类按钮或提示。
- **不做最近阅读列表 / 阅读历史 / 跨 vault 的全局位置**：键控是「当前 vault + vault 相对路径」，一个文件在另一个 vault 里没有位置。
- **不做位置的手工编辑入口、不做导入导出、不做同步**：文件本身是可读可改的 JSON（配置即数据），但不为它加 UI。
- **不重开 backlog #10**：不扩 `vault-sessions/<id>.json` 的内容，不做标签会话恢复的其余面，不动它的时机结论。
- **不修 M186 遗留的四条焦点路径**（`docs/backlog.md:244-254`）：那是另一件事，本 change 只在恢复时**不施加**盘上的位置，不去统一运行期内的焦点交还。
- **不修图片异步加载引起的文档高度变化**，也不修任何滚动缺陷：本 change 不碰滚动行为本身（不做回弹抑制、吸附、`overscroll-behavior`）。
- **不新增键位、命令、可见 UI 与配置项**：不加「记住阅读位置」开关（默认口径即唯一口径）。
- **不做跟随文档语言的本地化**：本 change 零可见文案（恢复失败也不提示）。

## Impact

- 影响的 specs：`multi-tabs`（ADDED ×1）；`vault-workspace`（ADDED ×1、MODIFIED ×2）。**不改** `editor-live-preview`（渲染口径零改动）、**不改** `toc-outline`（那是「当前标题」读数，与本能力不共享状态，见 design §1 的对照）、**不改** `keymap-commands`（零键位）。
- 影响的代码/系统（概述，不写实现细节）：
  - Rust 侧新增一个与 `vault_session` 同族的模块 + 一对 command（读 / 写），落 `<config>/lumir/reading-positions/<vault-id>.json`；`config.rs` 的 `config_dir()` 复用。TS 类型经 ts-rs 导出（`src/bindings/`）。
  - 前端新增一个与 `createVaultSessionStore` 同族的 store（无 DOM、可单测：换键、防抖、flush、按本次枚举清理），装配点在 `src/main.ts` 的 vault 装载与退出路径旁。
  - 编辑器侧新增「读位置 / 施加位置」的最小接口（取锚 + 偏移、按公开 API 施加），挂到**装载完成后**这一时点；`src/editor.ts` 的装载复位（`:1563-1567`）顺序不能变。
  - `src-tauri/**` 之外的既有链路零改动：不碰 `vault-sessions` 的读写、不碰 CM 的滚动快照通道（运行期内的切标签行为一字不改）。
- 影响的文档：`docs/backlog.md` —— 实现完成后在 #10 的边界段补一句「滚动位置已由 `remember-reading-position` 承接」（**实现期**动作，本提案不改）。
- 影响的测试/验收：`tests/unit/`（位置值形态与清理策略的纯逻辑：往返分解、上限淘汰、越界条目丢弃、按枚举清理）；`tests/visual/scenes/reading-position.spec.ts` + `tests/visual/scenes/tauri-stub.ts`（新增该 command 的桩与调用记录，仿 `__sessionPuts` 的既有做法，`tauri-stub.ts:117-160`）；`scripts/acceptance/scenarios/28-remember-reading-position.md`（**编号 28**，现有最大为 27；场景 fixture 落 `scripts/acceptance/fixtures/`）。真机判据 MUST NOT 只查「AX 里有某段文字」：可见性判据落在「哪两行在 AX 渲染行里」这一对——负向断言（篇首两行不在）必须与同一位置的正观测（尾部两行在场）配对，并且优先用带 bbox 的节点几何（M178 finding 的口径与实测，`docs/backlog.md:339-350`）。
- 基线影响：**预期零像素基线更新**——本 change 不加可见元素、不改任何渲染口径；但恢复位置会让「打开后」的**视口内容**与今天不同，因此**逐个核对**开长文档的场景是否踩到（`tests/visual/README.md` 的基线纪律 + AGENTS.md「基线更新是人肉裁决点」）：场景 fixture 若本身短于视口或位置为篇首，不受影响；确有整页变化的须先请 Alex 过目再重拍。
- 关联约束：ADR 0003 §3（不改写源文件——位置只落配置目录）、ADR 0002 §5（配置即数据：JSON、逐字段校验、非法值落回并给人话 warning）、ADR 0002 §6（性能合同——恢复是常量级读取，不阻塞首帧）、ADR 0006（Emacs keybinding PKM 定位——零键位、零命令）、ADR 0004 第 5 条（功能变更走 OpenSpec）。
- 性能：恢复路径上是「一次配置目录读取 + 一次常量级位置换算」；打开 1MB Markdown < 100ms 与 keypress-to-paint < 16ms 两条绝对阈值不因本能力放宽（design §6 给出具体的读取点与不新增测量的依据）。
