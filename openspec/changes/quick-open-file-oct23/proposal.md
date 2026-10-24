# Proposal: 按路径快速打开文件（C-x C-f 形态，支持 `{path}:{line}` 与 vault 外只读）

- Change ID: quick-open-file-oct23
- 日期: 2026-10-23
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**Alex 2026-10-23 通过**——五个起草期取值均按提案倾向（D1 ⌘P / D2 vault 外
> 路径放行但只读 / D3 路径优先 + 子串候选 / D4 新标签打开 / D5 存在性优先后缀解析）。D2 另有
> 追加裁决（原话）：「我希望能在 TAB 上区分——modeline 平常我很少看，而且它的字是灰色、不容易
> 看清楚。」→ vault 外只读文件的呈现口径：① 标签页标题带可见的只读区分标记（tooltip 显示完整
> 绝对路径）；② modeline 显示完整绝对路径作辅助；③ 尝试编辑不生效并给一次性提示。
> 节点 2（归档评审）：**待 Alex 评审**（2026-10-24 登记材料）：`tasks.md` 53/53 全勾（3.4 / 7.2 凭场景
> 230 的 60 断言真机 PASS 勾选；7.2 的「vault 外 绝对路径:行」一组只在 chromium / 单测层，边界写在
> 条内）；delta 五份 spec（12 条 requirement）过 `validate --strict` 与 `openspec-archive-check`；
> 归档跟踪条目在 `docs/backlog.md` 的归档跟踪队列。

## Why

Alex 2026-10-23 原话（逐字）：

> 「快速便捷地查找、打开文件（类似 Emacs C-x C-f）。这样方便我打开指定路径的文件，比如你经常
> 会让我打开文件……增加这个功能后，我就可以复制文件路径（不包含开头的 open 命令），然后在
> Lumir 里打开了，可以 dogfoot。这个功能最好也可以支持打开 `{path}{:line}` 路径，如
> `apps/api/package.json:71`，其中 `{:line}` 是可选的」

**现状：应用内没有任何「按路径打开文件」的入口。** 唯一的路径输入面是 ⌘O 的 vault 切换器，
它选的是 **vault**（目录），不是文件；⌘F 是**文件内**搜索（`src/keys.ts:701` 的 `app.search-open`）。
按路径打开的每一种今天只能这样绕：

| 你今天要打开的 | 在 Lumir 里今天要几步 | 卡在哪 |
|---|---|---|
| vault 内深层路径（`notes/projects/2026/plan.md`） | 树里逐层展开 → 点文件 | 知道完整路径反而帮不上忙：树按目录组织，不认路径 |
| 我刚给你的仓内路径（`openspec/changes/…/proposal.md`） | **打不开** | 该路径不在当前 vault 内；`fs_io::resolve_in_vault` 拒绝绝对路径与 `..`（`src-tauri/src/fs_io.rs:803`，spec `fs-io`「vault 内路径约束」） |
| 带行号的路径（`apps/api/package.json:71`） | 先找到并打开文件 → ⌥G → 输 71 → Enter | 两个动作、两次输入；且 `:71` 得自己从路径里剥掉 |
| 只记得文件名、记不全目录 | 逐层展开猜目录 | 没有跨目录的文件名检索 |

**为什么值得做，而不是「已经有文件树了」**：文件树优化的是「我知道它在哪个目录」，快速打开优化
的是「我手上有一条路径」。这两种知识在 dogfood 里同时存在，而后者的来源恰恰是协作对话——我每
次说「你看一下 `xxx.md:42`」，路径就已经在剪贴板里了。让这条路径一步可开，是把这个协作动作从
「终端 `open` + 找窗口」降到「粘贴 + Enter」。

**与既有两件相邻能力的分工**（mission 要求写清，避免实现期混线）：

- **M632 行区间链接**（change `add-path-line-range-links`）解决的是「**输出里**的 `{path}:{起}-{止}`
  可点」，入口是**读**；本 change 解决的是「**我输入**一条路径去打开」，入口是**写**。两者共用
  行号后缀的语义与落点编排，但不共用触发面。
- **M639（裸 path 链接）已裁取消**（以 mission 派发的上下文为准，仓内无该 change 的制品）：那条是把
  正文里的裸路径**渲染成可点链接**；本 change 不改任何渲染规则，harness 输出里的路径是否可点仍由
  既有索引判定（`src/harness-path-link.ts`）。

## What Changes

逐条对应 `specs/` 增量里的 requirement：

1. **唤起与输入面**（新 capability `quick-open` 的 ADDED #1；`keymap-commands` 的 ADDED #1）。
   一条全局命令 `app.quick-open`（默认 `⌘P`，D1）拉开一个挂在 modeline 上沿的输入浮层：一个单行
   输入框 + 一份候选列表 + 一行提示。形态与挂点沿用 `.lumir-toc` / `.lumir-goto`（`src/toc.ts:329`、
   `src/goto-line.ts:80`）——Emacs minibuffer 在不占常驻布局约束下的既有对应物。关闭交还焦点
   MUST NOT 改变阅读位置（`docs/design-parity-contract/overlay-close-reading-position.md` 的 CL-1）。
2. **输入解析：路径优先，`{path}:{line}` 可选**（`quick-open` #2）。输入串先按**整串**解释为路径
   （命中即打开，文件名里的冒号因此不会被误拆）；不成立才剥尾部行号后缀。后缀语义**复用**既有
   `LINE_SUFFIX`（`src/harness-path-link.ts:20`：`:行` / `:行:列` / `:起-止`，列与止不参与落点），
   MUST NOT 另写一份解析器。以 vault 根开头的绝对路径收敛为相对路径（与「复制完整路径」的
   `vaultAbsolutePath`，`src/tree.ts:33`，构成往返）。
3. **候选列表**（`quick-open` #3）。查询非空时按**完整相对路径**做大小写折叠**子串**匹配，唯一
   匹配实现是 `src/list-filter.ts`（TOC 与 vault 切换器已在用）——MUST NOT 引入模糊 / 子序列 /
   打分。空查询不列全量（避免打开就渲染上万行），候选渲染上限 100 条并显示总量。
4. **打开落点与行跳转**（`quick-open` #4；`multi-tabs` 的 MODIFIED「打开语义」）。复用唯一打开
   链路 `openFile`（`src/main.ts:2475`）与**新标签**意图（与文件树点击同落点，
   `src/main.ts:3612`）；已打开的文件仍走既有的「移动并激活」。带行号时复用
   `openPathAtLine` 的「打开 → 转场窗口内落点 → 下一帧复核」编排（`src/harness-path-link.ts:321`，
   现由 `src/main.ts:2833` 装配）与 `revealLine` 的唯一落点算式（`src/editor.ts:2455`）。
5. **vault 外路径：只读放行**（`quick-open` #5；`fs-io` 的 ADDED「vault 外只读读取通道」；
   `vault-workspace` 的 MODIFIED ×2「按 vault 持久化标签列表」/「按 vault 持久化 pane 布局」）。
   这是 D2 的倾向侧：外部文本文件以 **结构性只读** 标签打开——不写盘、不产生 dirty、不参与 watch、
   不记阅读位置、不进按 vault 持久化的标签与 pane 布局、不参与链接解析；读取走一条**显式路径**专用
   的后端命令（形状校验 + 常规文件 + 50MB 上限），MUST NOT 放宽任何既有 vault 内接口的约束。
   外部绝对路径带行号（`/abs/file.md:71`）与 vault 内文件走**同一条**解析次序与落点编排，区别只在
   打开后的只读语义。

## 起草期取值（请评审时一并裁）

| # | 取值 | 倾向与理由 | 若你选另一侧 |
|---|---|---|---|
| D1 | 默认键位 **`⌘P`** | 三条来源逐条核对过：① 表内无 `Cmd-p`（`src/keys.ts` 即真源：67 条显式绑定 + 9 条程序化生成的 `⌘1–⌘9`，grep `Cmd-p` 零命中）；② 原生菜单无占用——tauri 2.12.4 的 `Menu::default()` 在 macOS 上 File 子菜单只有 CloseWindow（`~/.cargo/registry/src/*/tauri-2.12.4/src/menu/menu.rs:202`），muda 0.20.0 的预置加速键表里没有 `KeyP`（`.../muda-0.20.0/src/items/predefined.rs:617`）；③ 系统级无 ⌘P（打印是应用级菜单项，本应用没有打印能力）。单段无空白 ⇒ 可经 `[keys]` 重绑 / 解绑；代码编辑器里 ⌘P 就是「按路径 / 名字快速打开」的通行惯例（VS Code / Sublime / Zed 同款）。**`⌘O` 已占**（`vault.switcher`，`src/keys.ts:703`），不能给它 | **`⌃X ⌃F`**（Emacs 原键）：键位层的 trie 支持空格分段的多段 chord，但 `[keys]` 覆盖明确拒绝多段 chord，living spec 也已写死「MUST NOT 采用含空白的多段 chord 作默认键位，那会让用户无法重绑」（`keymap-commands`「界面语言切换命令」）——选它必须同批改 `[keys]` 的 chord 支持与那条口径，scope 变大，且 `⌃X` 从此变成一个会被吞掉的前缀键 |
| D2 | **放行 vault 外路径，但只读** | 原话场景是「打开我给你看的文件」——我给的路径大多在代码仓（vault 外）。只认 vault 内路径，这个功能对你最想用的场景**不成立**。只读边界把风险钉死：不写盘、不 watch、不持久化标签与 pane 布局、不记阅读位置 | **只认 vault 内路径**：零后端新能力、零 `fs-io` / `vault-workspace` 改动，实现面小一半；代价是要打开仓内文件得先把仓加为 vault 并 ⌘O 切过去（整窗上下文被换掉）。**判据**：你日常那个 vault 是否已经覆盖了你希望用这个功能打开的文件——是，选这一侧更省；不是，倾向侧才成立 |
| D3 | **路径优先 + 子串候选**（一个输入框承担两种语义） | 粘贴的完整路径必须逐字可靠；子串匹配语义已有唯一实现（`src/list-filter.ts`）且两处浮层在用，复用不增加第二份匹配口径。空查询不列全量 + 渲染上限 100 条，把大 vault 的 DOM 成本钉死 | **纯路径**（无候选列表）：最贴 C-x C-f 的字面，但手打路径零反馈，「快速查找」落空；**纯模糊搜索**：就是 VS Code 的 ⌘P，但粘贴的长路径在子序列匹配下可能零命中或命中错的那个 |
| D4 | 打开落点 = **新标签**（与文件树点击同落点） | quick open 是「我要打开这个文件」的显式动作，与树点击同类；「就地替换前台」是链接跟随的语义（看完就走）。已打开的文件仍走既有「移动并激活」，不产生第二个标签 | **就地替换前台标签**（Emacs C-x C-f 的换 buffer）：少一个标签，但会顶掉你正在看的东西；dogfood 后想改判，改动只在装配层一处 |
| D5 | 后缀判定 = **存在性优先** + 复用既有后缀语义 | 先把整串当路径试，不成立才剥 `:行`——文件名里带冒号（`v1:2.md`）因此不会被误拆。后缀语义直接复用 `LINE_SUFFIX`，`:行:列` 与 `:起-止` 免费获得，且与 M632 的落点口径逐字一致（列与止不参与落点） | **正则优先**（先剥后缀再试路径）：实现更简单，但一个叫 `v1:2.md` 的文件永远打不开；且第二种后缀实现会与 M632 漂移（REVIEW.md「同一语义两处真源」条） |

D1 与 [ADR 0006](../../../docs/adr/0006-agent-positioning-deferred.md) 的关系：ADR 把本阶段的键盘方向定为
「Emacs 式前缀键体系」，`⌃X ⌃F` 正是那条方向上最贴原键的取值。但本仓现状是**表内零 chord、`[keys]`
拒绝多段 chord**——选 `⌃X ⌃F` 不只是换一个键，而是同批把「前缀键体系」的第一块真正落地（含配置层
支持与那条 living spec 判词的改写）；选 `⌘P` 则是先在既有单段键位面上把动作做出来。这是取向
取舍，请在 D1 一并定。

## Non-goals

- **不做新建文件**：路径不存在就给一行提示，MUST NOT 落盘（C-x C-f 的新建语义不在本版；新建
  已有文件树右键入口）。
- **不做目录打开**（dired）：输入解析到目录时给一行提示，不展开、不改树。
- **不做模糊 / 子序列匹配、不做打分、不做命中高亮**（D3）。
- **不做最近打开列表、不做输入历史**（Emacs 的 `M-n`）；候选不排序。
- **不做扩展名补全**（`notes/plan` → `notes/plan.md`）：候选列表已能按名字找到；补全规则与
  wikilink 的短名解析是另一套语义，混进来会让「路径」这个概念失真。
- **不改任何渲染规则**：harness 输出里的路径是否可点仍由既有索引与 M632 判定；M639（裸 path
  链接）已裁取消，本 change 不复活它。
- **不做 vault 外文件的写入 / 保存 / watch**（D2 倾向侧）：外部标签恒为只读。
- **不做 vault 外图片 / 二进制的查看**：外部只读只覆盖文本类（`md` / `code` / `text`）。
- **不做跨 vault 检索**：候选只来自当前 vault 的文件索引。
- **不新增第二条键位分发通路**：仍经唯一键位表与分发器（`keymap-commands`「统一键位分发表」）。

## Impact

- **影响的 specs**：
  - `quick-open`（**新建 capability**，5 条 ADDED）
  - `keymap-commands`（ADDED ×1：快速打开命令与默认键位）
  - `multi-tabs`（MODIFIED ×2：打开语义——新增「快速打开」意图与外部只读标签的口径；打开文档时
    恢复上次阅读位置——把快速打开列入装载路径、显式认定外部只读会话没有阅读位置）
  - `fs-io`（ADDED ×1：vault 外只读读取通道；既有「vault 内路径约束」逐字不动）
  - `vault-workspace`（MODIFIED ×2：按 vault 持久化标签列表 / 按 vault 持久化 pane 布局——两条
    都写有「每一个有路径的标签 SHALL 被持久化、MUST NOT 存在例外」的硬句，外部只读标签这同一个
    例外在两处同时认领，避免归档后同 capability 自相矛盾）
- **影响的代码 / 系统**：
  - 前端新增 `src/quick-open.ts`（解析纯函数 + 浮层 DOM 与就地键）；装配在 `src/main.ts`。
  - `src/keys.ts`：新增命令 id 与默认绑定（有绑定，MUST NOT 进 `KEYLESS_COMMAND_IDS`）。
  - `src/harness-path-link.ts`：把行号后缀的解析抽成可复用的纯函数（导出同一份 `LINE_SUFFIX`
    语义，MUST NOT 复制一份）。
  - `src/editor.ts` / `src/vault-switcher.ts`：外部只读会话的标记与「不入标签持久化」的唯一
    过滤点（`paneSnapshot`，`src/vault-switcher.ts:131`）。
  - 后端：`src-tauri/src/commands.rs` 新增一条显式路径读取命令 + `fs_io` 侧的形状校验；ts-rs
    重导出 `src/bindings/`。
  - 文案：新增若干可见串（输入框读屏名 / 占位 / 提示行 / 外部只读标记 / 失败原因句），按 batch
    惯例在**实现期**取号（提案不占号）。
- **关联约束**：
  - **影响面升级线**：D2 触到 `fs-io` 的 vault 路径约束（一条 spec 明写的安全边界）与
    `vault-workspace` 的「每一个有路径的标签 SHALL 被持久化」。这是本提案唯一需要你明确表态的
    结构性问题；其余四条只动新增面。
  - ADR 0002 §3：webview MUST NOT 直接触文件系统——外部读取同样走后端命令。
  - ADR 0002 §6 性能合同：过滤是每键一次的同步 O(N) 子串扫描（N = vault 文件数），列表渲染
    上限 100 条；实现期按既有 perf 方法学量一次 keypress→列表可见的读数，**不预称达标**。
  - ADR 0003 §3：本能力 MUST NOT 写入任何源文件（外部只读把这条钉在能力层面）。
  - 阅读位置合同 CL-1（浮层关闭交还焦点不得改变阅读位置）。
  - `ui-language`：新增可见文案全部进文案表（`src/copy-data.ts` + `文案-Copy.md`）。

## 观测闸三问

- **怎么知道用户用了它**：命令触发是显式动作；诊断留一条事件（开 / 命中路径 / 命中候选 / 失败
  类别），事件名与字段须按 `src-tauri/src/logging.rs` 的白名单新增（实现期一条 Rust 改动）。
- **怎么知道它有效**：粘贴 `path:line` → 一次 Enter 落在目标行；不再出现「先开文件再 ⌥G」的两步。
  dogfood 可感知：我下一次说「看 `xxx.md:42`」时，这条路径能被原样粘进去打开。
- **出问题怎么发现**：解析纯函数单测（存在性优先、冒号文件名、后缀畸形、绝对路径收敛）、视觉
  场景（浮层形态 / 键盘 / 空态 / 上限）、真机场景（粘贴 vault 外路径只读打开且 ⌘S 无落点、重启后
  外部标签不回来）、外部读取命令的 Rust 侧单测（目录 / 超限 / 非法 UTF-8 / `..`）。
