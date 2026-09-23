# Design: 记住文档阅读位置

- Change ID: remember-reading-position
- 日期: 2026-09-24
- 读者：实现 mission（技术方案）、Alex（只看有用户可见后果的取舍；本文件的技术结论不进节点 1 裁决）

本文件只写**技术方案与权衡**：接哪条既有通道、值形态怎么分解、存哪、什么时候捕获与恢复、失效与容量、未验证项与反向验证配方。为什么做、做什么、不做什么在 [proposal.md](proposal.md)；任务在 [tasks.md](tasks.md)。

## 1. 既有通道盘点：接哪一条，不复用什么

| 既有通道 | 现状 | 本 change 的关系 |
|---|---|---|
| **逐标签内存快照**（运行期内） | `EditorSession.scroll` 存 CM 的 `ScrollSnapshot`（不可序列化的效果对象）；离开标签时 `view.scrollSnapshot()`，切回时 `view.dispatch({ effects: session.scroll })`。`src/editor.ts:859-867`、`:1461`、`:1473` | **复用它的语义，不复用它的对象**：本 change 落盘的是同一语义（文档位置锚 + 相对视口偏移）的**可序列化投影**，运行期内仍走 CM 的原对象。两份通道**不合并**（见本节末取舍） |
| **vault 浮层焦点交还**（运行期内） | `readingPosition()` / `restoreReadingPosition()` 同一份快照通道，`src/vault-switcher.ts:514-520`、`:659-670`；注入点 `src/main.ts:270-271` | **零改动**。它守的是「收起浮层不改阅读位置」（`openspec/specs/vault-workspace/spec.md:151-179`），与跨会话持久化不共享状态 |
| **按 vault 的界面状态落盘**（跨会话） | `vault-sessions/<id>.json`：为什么与注册项分开、tmp+rename、版本、sanitize、降级 warning，`src-tauri/src/vault_session.rs:1-14`、`:82-120`；前端 store 的换键 / 防抖 / flush，`src/vault-switcher.ts:394-493` | **照抄纪律，另立文件**（见 §3）。写放大与语义的理由：标签文件的写入触发点是**标签集合变化**，塞进位置会让「滚一下」牵动「打开哪些标签」这个关键状态 |
| **启动恢复的时序**（`startup-restore-off-main-thread`，已归档 2026-09-18） | 恢复移出主线程、`restore_pending` 与 `vault:restore_finished`；它的 spec 增量只落在 `vault-workspace` 的「启动恢复的时序与可见性」，**不含任何阅读位置持久化**（`openspec/changes/archive/2026-09-18-startup-restore-off-main-thread/`） | **零改动，且不搭车的边界**：本 change 的恢复挂在**逐标签装载**这条既有链路上（它已经排在「恢复完成 → vault 装载」之后），MUST NOT 往恢复线程或 `open_vault` 里加任何位置相关工作；恢复进行中不恢复标签，因此也不会恢复位置 |
| **装载复位** | `reloadSession` 先作废旧快照再直接赋值 `scrollTop = 0` / `scrollLeft = 0`（M110：用 `scrollIntoView` 复位会把页首内边距顶出画），`src/editor.ts:1541-1542`、`:1563-1567` | **顺序不动**，恢复挂在它**之后**（见 §5） |
| **toc 的「当前位置」读数** | 可见行 / 当前标题追踪，`src/toc.ts:151-175`、`:267` | **不共享**：toc 回答「当前是哪个标题」，本 change 回答「读者停在哪一行」。两者都读视口，但没有共同的表，也不互相驱动（REVIEW.md 第 8 条：同一语义不造两处真源——这里是两件事，不是一个量的两份） |

**为什么不把两份通道合并**（即：让逐标签切换也走落盘格式）：切标签是**热路径**（`view.setState` + dispatch 效果，无异步），今天它零 IO、零序列化、且已有断言钉住（`openspec/specs/multi-tabs/spec.md:24-32`）。把它改成「序列化 → 反序列化 → dispatch」会在最频繁的交互上引入一层无收益的转换，并把「切标签」这条稳定路径卷进本 change 的风险面。落盘形态只在**装载**（冷路径）上使用。

## 2. 值形态：CM 快照的可序列化分解

### 2.1 上游事实（`@codemirror/view@6.43.11` 源码实证）

- `view.scrollSnapshot()` 造的是 `scrollIntoView.of(new ScrollTarget(EditorSelection.cursor(ref.from), "start", "start", ref.top - scrollTop, scrollLeft, true))`（`dist/index.js:8676-8680`），其中 `ref = scrollAnchorAt(scrollTop)` 取视野顶部那一段的行块（`:6646-6649`）。
- 施加时走**快照分支**：`scrollTop = lineBlockAt(range.head).top - yMargin; scrollLeft = xMargin`（`:3430-3436`）。它**不**经过 `scrollHandler` / `scrollMargins` 那套。
- ⇒ 快照里只有三个可序列化的量：**文档位置**（`range.head`）、**纵向偏移**（`yMargin` = 参照行顶 − 当时 `scrollTop`）、**横向位置**（`xMargin` = 当时 `scrollLeft`）。这正是 `src/editor.ts:863-865` 那句「某个文档位置 + 相对视口的偏移」的出处。

### 2.2 公开 API 的等价路径

- `EditorView.scrollIntoView(pos, { y, x, yMargin, xMargin })` 造的是**非快照**目标（`dist/index.js:8660-8663`），施加时走 `coordsAt` + `scrollRectIntoView`；`y: "start"` 分支的落点是 **`scrollTop_new = 目标位置的字符盒顶 − yMargin`**（`dist/index.js:576-580`：`targetTop = rect.top - yMargin`、`moveY = targetTop - bounding.top`；目标 rect 与滚动容器的 bounding 在同一客户端坐标系里，编辑器自身的偏移在相减中消掉）。
- 本仓没有注册 `scrollHandler` / `scrollMargins`（全仓 `grep` 零命中），因此公开路径不会被别的扩展截走。
- `ScrollTarget` 类**未导出**（`dist/index.d.ts:405` 声明，`:2416` 的导出清单里没有它）。它的字段虽在 .d.ts 里声明为 `readonly`（`:405-416`），但「这几个数在快照模式下分别是行顶/scrollLeft」这层语义只写在上游源码注释里（`:1332-1340` 自述「这个数据结构被借用来存精确滚动快照」）——**不是文档化契约**。

### 2.3 两条候选与推荐

**候选 A（推荐）：自分解，只用文档化 API。**

- 捕获（两个公开读数）：`pos = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from`（公开方法，d.ts 的语义是「相对文档顶的高度」）；`y = view.coordsAtPos(pos).top - view.documentTop`（「该位置的字符盒顶相对文档顶的位置」）；`x = view.scrollDOM.scrollLeft`。
- 恢复：`view.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.cursor(pos), { y: "start", yMargin: y, x: "start", xMargin: x }) })`。
- **为什么 `y` 取「相对文档顶」这个口径**：公开恢复路径量的是**位置的字符盒顶**，快照路径量的是**行块顶**，两者相差一个行内偏移（行内 padding / half-leading，下称 δ）。若捕获用 `block.top − scrollTop`、恢复却走字符盒口径，会带一个**恒定的 δ 偏差**。取「字符盒顶 − 文档顶」后，恢复的落点 `scrollTop_new = (文档顶 + 行块顶' + δ') − y`；布局不变时 `y = 行块顶 + δ − scrollTop`，于是 `scrollTop_new = scrollTop`，δ 自动抵消、往返按构造成立。**捕获与恢复必须是同一个口径**，这条是本方案唯一容易被写错的地方。
- 兜底（实现期二选一，写进 tasks）：`coordsAtPos` 返回 `null` 时（位置上不可读）要么退化为 `block.top − scrollTop` 的口径，要么**放弃本次恢复**。按 delta 的硬约束「恢复失败静默退化到篇首」，后者更保守。
- 优点：不碰未导出的类（ADR 0002 第 2 条：不得把依赖未文档化内部当默认路线）；捕获与恢复同公式，无需单独处理 δ；只用两个公开读数 + 一次 dispatch。
- 未验证项（§7 第 1、2 条）：往返精度与 `documentTop` 的坐标系定义必须在实现期用**一次往返读数**钉住，不得凭本节推导宣称已验。

**候选 B（不采用）：直接读 `view.scrollSnapshot()` 的内部字段**（`.value.range.head` / `.yMargin` / `.xMargin`）。类型不导出、数值语义未文档化（§2.2），而恢复侧**仍然只能用公开 API**（无法构造快照目标），于是 δ 偏差照样要处理——收益只有省掉一次 `lineBlockAtHeight`，代价是踩 ADR 0002 第 2 条的线。除非上游把该结构导出或文档化，否则不采用。

**两案都排除「只存一个像素」**：裸 `scrollTop` 在 M149 实测会被 CM 的滚动锚点维护改掉（差 **242px**，`src/editor.ts:863-865`），且重启后两份内容高度未必相同（图片、字体、栏宽、折行口径）。像素没有锚。

### 2.4 落盘形态（新增类型，不在 `src/bindings/` 之外另立同义类型）

```
{
  "version": 1,
  "entries": {
    "<vault 相对路径>": { "pos": <number>, "y": <number>, "x": <number>, "at": <unix ms> }
  }
}
```

- 键 = **vault 相对路径**（与标签列表同口径：vault 重定位后仍有效，MUST NOT 存绝对路径——`openspec/specs/vault-workspace/spec.md:259` 的同一条纪律）。
- `pos` / `y` / `x` = §2.3 的三个量；`at` = 写入时刻（只用于上限淘汰，不参与恢复判定）。
- `version` 与 `vault-sessions` 同纪律：不符即按「无历史」处理，不做向后兼容解释。

## 3. 存储形态：四条候选与推荐

| # | 落点 | 写放大 | 与既有 spec 的关系 | 损坏面 | 清理粒度 | 手改安全 |
|---|---|---|---|---|---|---|
| **A（推荐）** | 新文件 `<config>/lumir/reading-positions/<vault-id>.json`（与 `vault-sessions/` 并列，`src-tauri/src/vault_session.rs:42-44` 的 `config_dir()` 复用） | 只重写这一个文件（≤200 条、十几 KB） | 无需改标签文件那条禁令的**语义**，只需把「滚动位置」这一格指向新 requirement | 只影响「从上次位置继续」，不牵动标签列表 | 按 vault 清理，与旧 vault 互不影响 | 是 |
| B | 塞进 `vault-sessions/<id>.json` | 每次滚动都要重写标签文件 | 与 `spec.md:259` 的「持久化内容 MUST NOT 包含……滚动位置」**直接冲突**，必须改它的禁止语义 | 一次写坏会同时丢掉标签列表与位置 | 无法分离 | 是，但风险面变大 |
| C | 单一全局 `reading-positions.json`（vault id → path → 位置） | 每次滚动重写全 vault 的位置 | 无冲突，但「按 vault 键控」这条既有口径要另写一遍 | 一坏全坏（所有 vault） | 无自然粒度 | 是 |
| D | 塞进 `config.json`（用户手改 `[keys]` 的文件） | 同上，且与配置写入抢同一个文件 | 与「配置即数据」的**读法**冲突：那是用户手改的配置面，不该混入高频动态状态 | 写坏配置文件会连带影响键位等设置 | 无 | **否**（高频重写一个用户会手改的文件） |

**推荐 A**：与 `vault-sessions` 的既有取舍同源（身份 / 关键状态与易变界面状态分开，`vault_session.rs:1-6` 记了完整理由），写入面最小、损坏后果最轻、清理粒度天然对齐 vault。

## 4. 捕获时机与写入纪律

- **信号源**：`view.scrollDOM` 的 `scroll` 事件（捕获只要一个 `scrollTop` 与一次 `coordsAtPos`，不需要等 CM 的测量周期）。备选是同源的 CM 信号（CM 自己在 `.cm-scroller` 上挂着原生 `scroll` 监听，`dist/index.js:7316-7318`，之后产生带 `viewportChanged` 的 update；`src/toc.ts:267` 就是这么接的）——两条都可，取前者是为了让捕获与 CM 的更新循环解耦。**无论取哪条，都 MUST NOT 新增第二套「当前阅读位置」的语义**（REVIEW.md 第 8 条）：捕获只产出 §2.4 的三个量。
- **写入节奏**：滚动停止后防抖（新常量，量级取既有 `SESSION_WRITE_DEBOUNCE_MS = 1000`，`src/vault-switcher.ts:38`），内容没变则不排期（同 `sameSnapshot` 的口径，`src/vault-switcher.ts:459-471`）。
- **强制 flush 的时点与标签会话同一批**：切文件 / 切标签（装配层的唯一同步点 `syncActiveDocument`，`src/main.ts:286-302`）、切 vault 前、`beforeunload`（`src/main.ts:379-388` 已有 `switcher.flush()`）。**不能只靠退出时写**：那条路径的既有注释已说明 invoke 是异步的、webview 拆除可能早于它完成（`src/main.ts:380-382`），所以防抖写入是主路径、退出 flush 是补漏。
- **只写当前前台文档那一条**（在内存镜像里合并后整份落盘），不整表重算；后台标签的滚动不发生（全应用只有一个 `EditorView`）。
- **写失败只记 warning**，不拦停任何用户动作（与 `last_vault`、标签会话同口径；`src-tauri/src/vault_session.rs:129-134`）。

## 5. 恢复时机：装载路径上的三条约束

装载的完整链路（现状）：`openFile` → `editor.reloadSession(session, content, path)`（先 `session.scroll = undefined`，再事务替换 + 复位 `scrollTop = 0`，`src/editor.ts:1541-1567`）→ `afterLoad()` → `syncActiveDocument()`（`src/main.ts:369-370`、`:286-302`）。

1. **必须在复位之后**：`reloadSession` 的 `scrollTop = 0` 是既有的、有现场依据的复位（M110），顺序与写法都不动；恢复排在它后面。
2. **必须在文档进入 view 之后**：后台会话分支（`session !== active`）只换代 state、不碰 view（`src/editor.ts:1543-1548`），因此**不在那里恢复**。启动后按标签列表恢复时，每个标签都是「逐标签打开 → 成为前台 → 装载」（`src/vault-switcher.ts:426-457` 的 `openPinned` 循环 + `src/main.ts:277-281` 的 `activate`），所以逐个标签各自在自己的装载路径上恢复；随后激活存储的激活项时走 `activate()`，用该会话的内存快照（`src/editor.ts:1455-1475`），链条自洽、不需要额外处理。
3. **恢复之后不许再有人写 `scrollTop`**：这条正是 M110 / M149 两处已知跳动的形状（直接赋值 vs 效果通道）。实现期 MUST 实测「装载结束后再读一次 `scrollTop`，与刚施加时的读数逐像素相同」，而不是只断言「施加的瞬间等于期望值」。

另两条边界：

- **同一个文件已经在某个标签里打开时不恢复**：`openFile` 的短路分支（`src/main.ts:344-350`）只切标签，读者的运行期位置必须在场（MUST）。把恢复挂到短路分支之前，就是「点一下已打开的标签，正文跳走」这个缺陷的实现方式——反向验证配方见 §8。
- **篇首不施加**：存储的位置是篇首（`pos === 0` 且 `y ≈ 0`）时按「不恢复」处理，直接沿用复位结果。理由是有现场的先例：`scrollIntoView` 带 margin 时会把 `pos 0` 对齐到视口顶、把页首 44px 内边距顶出画（`src/editor.ts:1556-1565` 的 M110 记录）。这条同时保证「篇首」一次往返不会因为恢复而变成非零。

## 6. 性能与「不新增测量」

- **读**：装载 vault 时读一次该 vault 的文件并留一份内存镜像（每次打开文件只做一次 `O(1)` 查表），不每次打开都读盘。写：防抖后整份落盘（≤200 条、十几 KB）。
- **恢复的读数只有两个**（`lineBlockAtHeight` + `coordsAtPos`）且**搭在装载路径上**（装载本身已经在测量与重绘）；**捕获只读 `scrollTop` 与 `coordsAtPos`**，且防抖后才落盘。两处都不遍历文档、不新增解析。
- ADR 0002 §6 的两条绝对阈值（打开 1MB Markdown < 100ms、keypress-to-paint < 16ms）**不因本能力放宽**；本 change 的键位路径零改动，键入路径上没有任何新增工作。
- **未实测项如实记录**：1MB 打开端点在 `scripts/perf/` 今天是占位口径（只量 `fs.readFile` + 解码，不加载前端），它量不到本 change——不宣称达标，只给上面的「新增读数 O(1) 且搭在既有测量周期上」这条机制依据（`document-end-marker` 的 tasks 1.3 记过同款限制）。

## 7. 未验证项与已知边界（如实记录，不许当成已验）

1. **往返精度**：同一文档、同一视口下「捕获 → 恢复」的 `scrollTop` 差必须在实现期实测，并给出容差与证据（`test-results/<mission>/` 的读数 + 场景断言）。§2.3 的推导只说清了公式为什么自洽，不等于已实测。
2. **`view.documentTop` 的坐标系定义**（相对编辑器还是相对窗口）：用一次往返读数核实；`y = coordsAtPos(pos).top - documentTop` 这条表达式的正确性由往返断言钉住，不由推导保证。
3. **含异步加载图片的文档**：恢复发生在图片字节到达之前。跨会话**没有**会话内的图片几何记忆（那份记忆的作用域是本会话，`src/preview/attachments.ts:243-300`），因此首次渲染的高度可能与终态不同；随后 CM 的滚动锚定会把参照行维持在视口顶（同族机制见 `src/preview/attachments.ts:255-266` 的 M187 记录）。这条 MUST 实测（含图文档的往返），MUST NOT 凭推断断言。
4. **栏宽变化后再打开**：阅读栏宽是百分比（`src/style.css:9` 的 `--measure: 80%`，经 `src/editor.ts:1191-1192` 参与网格列宽），宽度随窗口与侧栏变化；位置锚在行上、偏移是像素（偏移小于行高），换栏宽后的落点需实测。
5. **页面缩放（`scaleY != 1`）**：CM 有 `scaler` 换算（`dist/index.js:6266-6282`，`lineBlockAtHeight` 的读与 `scrollTop` 的量纲在该条件下才分叉）。`src/` 里零 `zoom` / `transform`（全仓 `grep` 零命中），实测确认 `scaleY = 1`、两条分支同值即闭环。
6. **code 模式的横向偏移**：折行关闭时正文可横向平移（`lineWrap = false`），`x` 必须一并还原——实测。
7. **文件在两次会话之间被外部改写**：`pos` 可能落在新文档之外。恢复走 CM 既有语义（位置超出时被夹到文档末尾，快照路径的 `clip`，`dist/index.js:1352-1356`），本 change 不做内容比对、不做 hash 门禁——**这是有意选择**：位置是读者的书签、不是编辑记录，任何外部改动都让它失效会把这条能力变成「偶尔才有效」。如实记为已知边界（是否要在实现期加「文件大小 / mtime 变化就放弃恢复」由 dogfood 反馈决定，不预先设计）。
8. **文件改名 / 移动**：位置丢失（键是路径）。本仓没有「同一文件跨路径的身份」这一层——watcher 把一次改名拆成旧路径 `Deleted` + 新路径 `Created`（`src-tauri/src/fs_io.rs:466-468`），因此改名在应用看来就是「旧文件消失、新文件出现」。要跟随它必须新建一套文件身份机制，与 ADR 0001 的非目标相抵，本 change 不做。
9. **多窗口**：本仓目前单窗口（`src-tauri/tauri.conf.json`），本 change 不为多实例并发写同一份文件做额外设计；写是 tmp+rename，最坏结果是「后写覆盖先写」。

## 8. 反向验证配方（每条判据都要能红，先红后绿）

| 判据 | 造红的动作（必须实测 FAIL） |
|---|---|
| 打开文档回到上次位置 | 把恢复整段关掉（等价于实现前）→ 断言必须红 |
| 已打开的标签不被拽走 | 把恢复挂在 `openFile` 的短路分支**之前** → 「切到既有标签后位置不变」必须红 |
| 篇首不因恢复而位移 | 去掉 §5 的篇首特例 → 「打开一份位置为篇首的文档后 `scrollTop` 为 0 且页首内边距可见」必须红 |
| 恢复之后无人再写 `scrollTop` | 在装载路径尾部补一次 `scrollTop = 0` → 「装载结束后两次读数相同」必须红 |
| 捕获侧真的写了 | 把捕获的防抖去掉/关掉 → 桩的 `reading_position_put` 记录为空，写入侧断言必须红 |
| 键是相对路径、越界条目被丢弃 | 桩返回一个带 `..` 或绝对路径的键 → 「不被打开 / 不进入内存镜像」必须红 |
| 上限淘汰 | 写入 201 条不同路径 → 「最旧那条不在落盘内容里」必须红 |
| 损坏 / 版本不符等价于无历史 | 桩返回 `version: 2` 或坏 JSON → 打开该文件后仍在篇首、且不出现任何提示 |
| 只记位置、不进文档（ADR 0003 §3） | 断言「磁盘文件字节逐字节不变」「`.cm-content` 里没有额外内容」——反向动作：临时把 `pos` 也写进文档 → 必须红 |

## 9. 不采用的机制（备记，防止实现期绕回去）

- **只存裸 `scrollTop`**：M149 实测差 242px（`src/editor.ts:863-865`），且跨会话内容高度未必相同。
- **存「阅读百分比」**：与窗口、栏宽、图片加载、字体都耦合，且文档一改就漂；用户诉求是「从上次位置继续」，不是「读到几成」。
- **存行号**：与位置锚等价但多一层转换（行号 → 位置），对「外部编辑」并不更稳，恢复侧最终还是要落到某一行。
- **把位置写进 vault 或文档**（侧车文件 / frontmatter）：违反 ADR 0003 §3 铁律（永不改写源文件格式）与「配置即数据」的落点约定。
- **扩 `vault-sessions/<id>.json`**：见 §3 候选 B 与 proposal 的裁决点 4。
- **读快照内部字段**：见 §2.3 候选 B。
- **把 `beforeunload` 当作唯一写入点**：异步 invoke 可能赶不上 webview 拆除（`src/main.ts:380-382`）；它只能是补漏。
