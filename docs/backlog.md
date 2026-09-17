# Backlog — findings 与待裁决队列

唯一的积压载体（2026-09-16 起自 HANDOFF.md 迁入并入 git）。

维护规则：

- 新 findings 由发现者（worker / reviewer / tower）落成条目，注明**来源 mission/批次**与**日期**；HANDOFF.md 只记 session 状态，不再积压。
- 条目状态：`待裁决` / `待修` / `待验收` / `记录在案`；核销后移入文末「已核销」并定期清理。
- 每条尽量附复现/证据指针；裁决类条目给出选项与推荐。

## 待 Alex 裁决

1. **历史敏感信息是否 filter-repo**：M111/M115 历史提交中的真实文件名；`docs/design-parity-contract/evidence/*.log` 约 20 行本机路径。tower 建议不必（仓库 M3 前不公开）。遗留自批次一。
2. **demo 右侧探针栏去留**：版面/文案决策，建议随 theme 重做一并处理。遗留自批次二。
3. **「保留我的版本」后自动保存暂停但用户无感知**：无回归；提示文案留 UX 重做阶段。遗留自批次二。
4. **宽表横向溢出裁切是否预期**：实测溢出 1549pt vs 栏宽 766pt，AX 层完整。待 Alex 对照设计规格确认。遗留自桌面复验（M116 期）。
5. **Emacs 档 3 与全产品键位**：isearch / mark / region / ⌃X 前缀，及左栏 tree/shell 零键盘支持——待 UX 重做会话与 dogfood 反馈后立项。批次三遗留。
6. ~~**openspec 归档 `add-diagnostics-logging`**（M134 已合并，2026-09-16）：实现与文档已入库，归档评审待 Alex 点头。~~ **2026-09-17 M150 已按批次授权执行**（Alex 对整体 review 的裁决「好，采纳。你动手吧」含归档节点 2 批量授权）：归档为 `openspec/changes/archive/2026-09-17-add-diagnostics-logging`，living spec 落 `openspec/specs/diagnostics/spec.md`；其未勾任务 4.2（`gate.sh all` 全绿）就地标注改由 CI perf.yml 承担（本地 `all` 因既有内存合同超标不可能全绿，见本条下方第 7 项），核销记录见「已核销」。
7. **内存合同存量超标**：2026-09-06 evidence 218–222MB 已超 <200MB 合同（2026-09-16 未复测）——放宽合同还是专项治理，随 dogfood 性能专项拍板。
8. **共享 `CARGO_TARGET_DIR` 与 dev-only 脚本化驱动入口**（工具链节 2/3 的长期候选）：是否立项待裁决。
9. **链接形态矩阵的两处 tower 裁决**（M145，2026-09-17，Alex 未逐条点头）：① 相对路径**非 md**（`[x](./doc.pdf)`）带 `↗︎`（语义「会离开本应用」）而不是 `→`；② **纯锚点** `[x](#sec)` 带 `→` 但激活只给「暂不支持锚点跳转」toast（不做文档内滚动）。附一处同批未单独确认的口径：`[x](note.md#sec)` 按「应用内跳转 + 锚点部分忽略」处理。三处若要翻转，落点是 `src/preview/links.ts` 的 `classifyLinkTarget`（标记）与 `src/main.ts` 的 `followLink`（激活）。
10. **多标签会话恢复**（M149，2026-09-17）：重启后按「路径列表 + 激活项」重开上次的标签。v1 明确不做（当时口径「留 backlog」），做成什么形状与何时做待裁决。建议形状：存 vault 维度（registry 旁 `last_session`）、只存有序路径 + 激活下标（可选滚动 offset），**不存**未保存内容与撤销史；打开必须走 `openFile` 既有链路；文件已删/不在 vault 内时跳过并记诊断；启动日志记一条 `session_restored{count}`（`log_event` 通道已有）。时机建议：等 dogfood 反馈「常态开几个标签」后再定，避免为 2 个标签的场景过度设计。finding `20260917-worker-tabs-idea-m149-backlog.md`。

## 待修 findings（不阻塞）

### 编辑器 / 键位

- **Alt+Shift token 口径**（M132，medium）：`keyToken` 对含 Alt 组合忽略 Shift，`Alt-KeyF` 同时命中 ⌥F 与 ⌥⇧F。修法已录 spec 已知限制：Alt 分支纳入 shiftKey + 别名拆两条绑定。
- **`ConfigSnapshot.warnings` 无 UI 出口**（M132，medium）：`config.json` 中 `keys` 表的未知命令 warning 只进 console。提示文案/UI 留 UX 重做阶段。
- **toast z-index 10 衬在 ⌘/ 面板遮罩（20）下**（M133）：面板打开时非 sticky toast 自动消失可能未被看见。dogfood v0 可接受，留 UX 重做会话。
- **mermaid/frontmatter 无键盘进入路径**（M118 findings）。
- **caret 停靠隐藏边界时短暂不可见**（M118 已知外观残留）。
- **`\$` 转义误判**（M106，低优先级）。
- **mathSpanCrossed ±4KB 窗口对超大公式块的切割**（M111 review 观察）。
- **代码围栏行尾恰为 `$...$` 时跨行 Ctrl+B 一次移两字符**（M113，罕见且良性）。
- **相邻 grid 表连排时 Ctrl+N/P 每按一次过一张表**（M113，与裁决不冲突）。
- **「已被外部删除」浮条无动作**（2026-09-16 夜间批次，Alex 需求 3 复核时发现）：dirty 时
  「检测到外部修改」浮条**已有**「重载（放弃我的修改）」动作（`src/save-controller.ts:435`），
  但「当前文件已被外部删除」浮条（`src/save-controller.ts:426`）没有任何动作，只能切文件再切回。
  需求 3 据此撤销（主诉场景已被既有动作覆盖），此缺口留作顺手修。
- **`TableModel.reason` 的 `"incomplete"` 是死值**（M137 finding、M142 评审复核）：类型联合里有，
  生产只产 `"non-rectangular"` / `"oversize"`。清扫类。
- **语言注册表两处漂移**（M138 旁注）：`src/editor.ts` 的 LANGUAGES 未导出，`src/preview/code.ts`
  另建一份着色语言表。建议收口为单一来源（小 mission）。
- **文案-Copy.md D40 后空行断表 + 编号未升序**（M141 评审旁证）：既有缺陷，清扫类。
- **rust 字符字面量在围栏代码块里不着色（与 code 模式的 parity 缺口）**（M147 finding，medium）：
  `src/preview/code.ts` 的 `tagsForStyle` 遇「modifier 开头的复合 token 名」整条丢 tag（CM6 的
  `createTokenType` 只警告并保留其余 part）；rust simpleMode 的 `string.special` 触发——`'a'` 在
  code 模式取字符串色、在 ` ```rust ` 围栏里取正文色，M138 的「围栏与整文件打开 tag/颜色完全一致」
  声明对这类 token 不成立。影响面已枚举：收录语言里只有 rust（字符/字节字符字面量两种构造）。
  修法（finding 附建议 diff）：与 CM6 同语义逐名字段独立结算、跳 part 不丢整条；须配不变量测试
  （「simpleMode 复合 token 在围栏与 code 模式 tag 集合一致」）并走渲染缺陷合同先行流程核对
  rust 场景基线。finding `20260917-worker-jsonhl-bug-tag-token-rust-code.md`。
### shell / 系统

- **退出守卫菜单结构假设**（M101 review）；Dock/系统关机路径不覆盖。
- **注册表目录 `{id}.json.tmp` 无扩展名过滤会被当注册项解析**（M126 finding；修复时顺带清掉 sweep_registry 对非 .json 文件的写面）。

### 未复现

- **编辑区全空白偶发**：M114 一次、M116 0/3，复现条件未锁定。运行时诊断日志已落地（M134，
  2026-09-16），下次复现后查 `<config_dir>/lumir/logs/<UTC日期>.jsonl` 的事件序列定位。
- **视觉套件 `markdown-parser` 的 `large-mixed` 偶发失败**（M144 一次，低）：整轮视觉回归里它 `page.evaluate: TypeError: Cannot read properties of undefined (reading 'metrics')` 失败一次（该用例把 `mixed` 文档重复 2000 次喂给解析实验，并挂 CDP profiler 采样），单独重跑与随后整轮重跑都 10/10 PASS。现场没有留下可归因的线索（不是本批次的改动路径——该 fixture 是独立的 vite 子应用，不加载 `src/`）。**给后续跑 `gate.sh visual` 的人**：它若偶发报红，先单独重跑该 spec 再判断，别当成自己的回归。
- **`paragraph.spec.ts`「普通段首对齐 640」全量轮瞬态失败一次**（reviewer-toc finding，2026-09-17）：程序设 DOM 选区后下一拍 `getSelection()` 读到 `""`（预期 `普通段落不再缩进`）；隔离复跑 2/2 PASS、第二轮全量 8/8 PASS，与 M148 diff 无因果（toc 不产生装载后的编辑器 dispatch）。疑似全量负载下 CM 装饰重建把文本节点替换、Range 脱离导致选区坍缩——既有测试的时序敏感面；若发生在 CI 会红掉无关 mission 的门禁。修法：选区断言改为「同一 evaluate 内设选区并立即回读」，或读取端加 `expect.poll` 重试（`tests/visual/scenes/paragraph.spec.ts:38-39`）。finding `20260917-reviewer-toc-bug-paragraph-spec-ts-640-flake.md`。

### 验收套件（M144 实测出的表达力缺口）

- **`click` 动作不支持修饰键**（M144，medium）：`lib/execute.mjs` 的 click 只有 `target` / `count`，没有
  modifier 参数，因此「⌘-Click 跟随链接」这条路径**在真机套件里无法触发**（⌘⏎ 可以，键位动作支持 chord）。
  M144 改用视觉场景覆盖该路径（`tests/visual/scenes/render-link.spec.ts`：stub 记录
  `open_external_url` 的调用目标，断言开的是哪个 URL 且不真开浏览器）。修法：给 click 动作加
  `modifiers: ["meta"]`（KimiCU 的 `click` 底层已支持 mouse_button，修饰键需在 `cu.mjs` 侧按住 meta 再点）。
  **M144 裁决：套件能力改造另开 mission，本批不做。**
- **`type` 动作 `clear:true` 的残余假绿形态**（reviewer-typefix finding，low，pre-existing）：
  clear:true + 旧内容恰好已含一次目标串 + 注入整体 no-op 时，classify 会误判 landed。无任何场景使用
  clear，未被 M143 的 diff 触及。finding `20260916-reviewer-typefix-bug-type-clear-true-no-op`。
- **`checkScenario` 不校验 `do: type` 的 `text` 非空**（worker-typefix finding）：漏写 `text:` 会在
  真机跑成注入 `undefined` 后连报 3 次未落地，而非在 `--check` 阶段就报。
  finding `20260916-worker-typefix-improve-checkscenario-do-type-text-undefined`。
- **`click` 的 `target.name` 与断言的匹配口径不一致**（M148 finding，low）：`findNode`
  （`lib/ax.mjs`）是裸 `new RegExp(name)` 语义（无 `m` flag），断言侧 `matcher()`（`lib/execute.mjs`）
  才是「`/.../`=正则、其余=子串」——`target: { name: "/第一部分/" }` 会去找字面量「/第一部分/」
  而报「找不到可点节点」，与「控件真的不存在」无法区分（M148 为此多跑一整轮真机）；`m` flag 之差
  还决定 `^…$` 是整串锚定还是行锚定（`AXTextArea.value` 是整篇文档文本，行锚定会误命中编辑器节点）。
  根治法：寻址与断言共用 `matcher()`（提到 `lib/` 公共位置，裸串=子串、RegExp 对象保持原行为）；
  这是全部场景共用的寻址入口，改完需一次全量真机复验，单独立项，不塞进功能 mission。临时口径
  （用 `help` 寻址 / 锚定裸正则）已写进 `scripts/acceptance/README.md` 已知边界。
  finding `20260917-worker-toc-improve-click-target-name.md`。

## 工具链与环境（待 Alex 裁决）

1. **1420 端口串行**：vite dev server 固定 `127.0.0.1:1420` 且 strictPort，全机同一时刻只能有一个
   `pnpm tauri dev` 实例。并行批次起实例前先 `lsof -nP -iTCP:1420 -sTCP:LISTEN`，被占则与对方错峰。
   验收套件自身走 1430（`LUMIR_ACCEPTANCE_PORT`），不受此限。来源：批次四 M134/M135 并行实证，2026-09-16。
2. **tower 并行批次的磁盘预算**：每个 worktree 的 cargo debug target 占 1.5–3G（2026-09-16 实测：
   main 4.5G / wt-134 3.8G / wt-135 2.2G / wt-136 2.1G）；磁盘 <1G 时 ENOSPC 硬阻塞所有真机批次
   （实测 219MiB 时 `pnpm tauri dev` 因 vite 临时文件写失败而中止）。验收套件已把「<2G 不起实例」
   写进预检。长期方案候选：worktree 共享 `CARGO_TARGET_DIR`（代价：并发构建互斥）。
   **M142 补充（2026-09-16 晚）**：全机可用空间一度只剩 2.7G（其余被既有 target 占满），按上表预算
   判断装不下一次全新的 worktree debug 构建——建到一半 ENOSPC 会留下半截 target 且不回血，比不构建
   更糟，于是当时先把顺序定为「先跑 chromium 视觉门禁，真机待空间腾出」；随后空间回到 6.8G，同一晚
   完成首次 debug 构建与真机全量验收（19 场景 / 197 断言全 PASS，证据 `test-results/acceptance/2026-09-16/`），
   本轮交付**不是**「只跑视觉」的状态。
   建议把预检口径从「可用 ≥2G」细分出「worktree 首次构建须 ≥3G，target 已热才可用 2G 档」。
3. **KimiCU 键盘注入对 WKWebView 在窗口遮挡时不可靠**（批次四 M134 实证）：返回 `occluded:true`，
   activate 后也未必恢复；AX 写入（`set_value`）可靠。故键盘场景须前台焦点纪律，且**不得用
   set_value 伪造键盘语义**（不经键位分发链路，验不到 `keys.ts`）。长期候选：dev-only 脚本化驱动入口
   （`LUMIR_DEV_SCRIPT` 或 debug-only invoke）。
4. **KimiCU AX 服务会中途全局退化**（2026-09-16 M135 期间出现两次）：`get_app_state` 只剩菜单栏
   （`element_count` 1–18、`truncated: [closed_menu, cycle]`、`window_bounds x=0 y=0 w=1 h=1`），
   Finder / Reminders / Lumir 一起坏，`xpc-ping` 仍报 `accessibility=true screenRecording=true`。
   恢复手段 = 重注册服务（`/Applications/KimiCU.app/Contents/MacOS/kimi-cu install`，tower 两次复验有效）。
   对套件的影响：整套一起报「前端未就绪」，不是场景缺陷。
   **诊断线索**：退化期间 `log show --predicate 'process CONTAINS "kimi-cu"'` 显示服务每秒一次
   `TCCAccessRequest() IPC`（重试循环），而 `xpc-ping` 仍报已授权；两次退化都发生在磁盘 <1G 时，
   疑与服务写不出缓存后进入重试态相关。
5. **`scripts/perf/memory.mjs` 的 WebKit pid 差集归因在非独占主机不可靠**（外来 helper 被误算，
   实测一次 409.7MB 虚高读数）；常驻内存存量超合同（2026-09-06 evidence 已 218–222MB）——
   合同口径裁决随 dogfood 性能专项。
6. **KimiCU `press_key` 逐键注入会整批丢键**（2026-09-16 M138/M139/M140 三方实证）：原生 input 与
   contenteditable 都会发生，丢在 DOM 之前（app 侧 keydown 只收到部分键，如注入 `needle` 只到 `ndl`）；
   间歇性、成因未定位。套件侧已由 M140/M143 的「回读 + 字节未变才重试」口径兜住，工具层缺陷仍在。
   findings：`20260916-worker-search-bug-kimicu-press-key-wkwebview-input-acceptance-keys.md`、
   `20260916-worker-keys-bug-kimicu-press-key-type-text.md`（正文实为 press_key）。
7. **同机第二个 Lumir 实例显著加剧 press_key 丢键**（M140/M142 对照实证）：跑真机验收前的预检
   须同时确认 1420（dev）与 1430（验收）都没有 Lumir 实例在跑。
8. **孤儿进程巡检**（M148 finding，low）：wt-62 遗留两组存活 10 天的 headful Chromium 孤儿
   （ppid=1，带完整子进程树）与历史 `vite preview` 常驻，会干扰真机验收里「谁是前台」的判断
   （M148 全量轮撞到过窗口被挤位）。批次收尾统一回收：`ps -o pid,ppid,etime,command | grep -E
   'playwright|chromium|vite preview'`，找 ppid=1 且 elapsed > 1 天的孤儿、确认不属于在跑 mission
   后 kill；**注意别碰 Alex 的 dogfood 实例（1420 端口的 vite / target/debug/lumir）**。
   finding `20260917-worker-toc-improve-wt-62-headful-chromium-10-vite-preview.md`。

## 待真机验收

行为判定已下沉为 agent 可执行场景（入口 [scripts/acceptance/](../scripts/acceptance/README.md)，
设计见 [docs/process/real-machine-acceptance.md](process/real-machine-acceptance.md)）；手感/审美项仍归 Alex。

分类依据 = **证据目录里真实 PASS 的场景**，不是「场景写了就算覆盖」。最近一次全量实跑：
**M148+M149 批次（2026-09-17）——22 场景 / 22 PASS 0 FAIL**：全量 22/22 @ `fab134c`（M149 r1 交付态，
含 M148 的 13-toc），r1→r2 唯一行为改动（`closeTab` 守卫）后单场景复跑 14-tabs PASS @ `52bb912`
（43 断言 / 40.5s）；合并提交 `ac51328`。证据 `test-results/acceptance/2026-09-17/`（两次 run 的
合成布局见该目录 summary.md）。上一次全量：master@`6e4d19a`（2026-09-16，20 场景 / 223 断言，
证据 `test-results/acceptance/2026-09-16/`）。08b 的旧 FAIL（冲突期盲发按键未落地）已由 M140 核销
（keys 动作回读+有限重试 + 08b 落点改走 type 通道 + 探测串移文末 + `ax.focused` 断言形态）；
同族 type 侧假绿由 M143 核销（重试口径对齐 keys：只在字节完全未变时重试，partial landing 直接报错）。

**已机验（行为判定落定，有 PASS 证据）**

1. **Mermaid 点击进源码编辑** —— `01-mermaid-click`：渲染态（成功块为 `help=围栏原文` 的 widget、
   失败块给「图表解析失败」+ 原文）→ 点击 widget → 源码显露、widget 让位。渲染中(pending)态窗口极短，
   只留截图。
7. **M124 三条恢复路径全部覆盖** ——
   `07-recovery-paths`（冲突双动作：外部改写后保存给「重新载入 / 强制覆盖」、内存改动未丢、磁盘未被静默覆盖）；
   `07b-recovery-saveas`（**真删除**触发 `fs_not_found`，不是清空——清空走冲突分支：⌘S 给「保存失败：文件
   已被外部删除或移动」+「另存为新文件」，点击后 `plain-恢复.md` 真实落盘且内容 = 内存缓冲）；
   `07c-external-reload`（干净缓冲 + 外部改写 → 编辑器文本自动换成磁盘内容，不打扰用户）。
8. **M127 自动保存链路四条子行为全部覆盖** ——
   `08-autosave`（2s 落盘：磁盘 sha256 变化且内容含输入）；
   `08b-autosave-pause`（**冲突待决期间自动保存暂停**：记录磁盘 sha256，跨 2s 去抖再等 7s，磁盘逐字节不变、
   仍是外部版本、冲突提示未消解；前置断言「探测串落在文档末尾 + AX 焦点在编辑器」M140 重做后稳定 PASS）；
   `08c-crash-recovery`（app 自己在隔离目录写的崩溃备份 →  重启后提示「恢复内容 / 丢弃备份」，
   点「恢复内容」后崩溃前内容回到编辑器）；
   `08d-crash-discard`（同现场点「丢弃备份」：给丢弃反馈且内容**不**进编辑器）；
   `08e-force-overwrite`（强制覆盖的不可撤销二次确认「覆盖保存」；覆盖后磁盘确是内存版本；
   再次冲突仍给同一组动作且磁盘未被静默覆盖）。
9. **Emacs 键位 / ⌘Z / ⌘/ 面板 / `config.json` keys 表** —— `09-emacs-keys`、`09b-keys-config`：
   **⌘Z 未被 macOS 视图层级吃掉**（插入 → ⌘Z → 内容消失，menu swap 真机成立，回退方案不必启用）；
   ⌘/ 面板打开/关闭、打开期间文档逐字节不变（作用域键与可打印字符都不穿透）；
   keys 表解绑 ⌘S / 重绑 ⌃S 生效。
10. **Markdown 渲染三件套**（M138）—— `render-markdown`：`---` 渲染为横线且 frontmatter 定界符
    不误渲（AX 面读到读屏名「分隔线」、`editor.not "---"`）；围栏代码块源码逐字保留、未收录语言
    保持纯文本；引用内有序/无序/嵌套列表按常规列表渲染（`- ` 与 `>` 都不再显露）。
    **配色与几何不进真机**：横线宽度=栏宽且本体 0 高、标记走等宽字体且同级正文列对齐、token 色值
    全部取自既有 editorial token——由视觉门禁 `tests/visual/scenes/render-{hr,codeblock,quote-list}.spec.ts`
    的计算色/几何断言守（chromium），真机只验文本层与 AX 结构。
11. **表格降级文案归因**（M138）—— `render-table-degrade`：表头声明 3 列、第 10 行有 4 格（**多列**，M142 起降级只由多列/槽位不可映射触发）时，
    AX 面读到「第 10 行单元格数与表头不符（应为 3 列）」与「保留原始 Markdown」，同时整块保持
    源码态（不丢列、不截断）；同 fixture 的短行表（末行少一格）自 M142 起按矩形渲染，AX 面读到
    `Markdown 表格`、该行源码不再显露。
12. **文件内搜索 v0**（M139）—— `search-01-find`（⌘F panel 出现、匹配计数、上一个/下一个导航、
    Esc 还原焦点）、`search-02-binding`（`config.json` keys 表重绑搜索命令生效）。
13. **链接渲染与激活（全形态）**（M144 起，M145 补齐）—— `12-links`（53 断言）：外链 / 相对
    路径 md / vault 内非 md 资产 / 纯锚点 / 白名单外 scheme 五类的装饰与激活分流；外链与资产的
    目标源码隐藏、光标触及整条显露、文档逐字节不变；⌘⏎ 开外链（日志 `link_open` 落盘且不含
    URL 原文）/ wikilink 跳转与未创建不建文件 / 相对路径 md 跳进目标笔记 / 解析不到只 toast /
    锚点只提示 / 不可用形态不装饰也不激活；`link_open` 的 `category`（external / internal-md /
    asset / anchor / blocked-scheme）逐类断言。
14. **TOC 大纲 popover**（M148）—— `13-toc`（17 步 / 32 断言）：masthead 当前位置指示段、
    ⌘⇧O 浮层开合、↑↓ 导航不穿透到编辑器、Enter 跳转后光标恰在标题行尾、空 heading 文档给 toast。
    配色与几何由视觉门禁元素级基线 `toc-popover-chromium-darwin.png` 守。
15. **多标签**（M149）—— `14-tabs`（43 断言）：单击预览替换 / 首次输入或双击固定 / ⌘1–9 直达 /
    ⌃⇥ 循环 / ⌘W 关当前标签（未命名 dirty 才确认）/ 后台标签外部删除被浮条点名。
    **语义变化（Alex 使用习惯）**：⌘W 从关窗变为关当前标签（菜单「关闭」项保留但无加速键，
    退出走 ⌘Q / 红灯）；有路径的标签间切换不再有 dirty 守卫；切换 vault 升级为任一标签 dirty 即拦。

**已机验到渲染/结构层，行为细节仍缺可观测面**

2. 公式进编辑 —— `02-math-click`：行内/块级公式均渲染为 KaTeX、源码不显露。
   **「公式后 ⌃B 是否 1–2 次」仍待判定**（需光标停在公式 span 之后；AX 输出不暴露光标/选区，
   纯键盘落位无法回读校验；代码口径 1 次，`mathSpanCrossed` 落点 = span.to−1）。
3. Ctrl+N/P 表格行为 —— `03-table-ctrl-np`：grid 表确实渲染成 `AXTable (Markdown 表格 N)` + `AXRow`
   单元格文本；⌃N/⌃P 序列后表格与文档内容完好。**逐 cell 落点不可回读**；实测按坐标点进 AXTable 的
   bbox 内也不会让渲染态表格让位给源码行，故不做该断言。
5. cell 内公式 —— `05-cell-math`：`$y$`/`$$y$$` 在 cell 内按行内样式渲染（AX 行文本 `行内 / y / 块级 / y`）。
   **「点击渲染态公式进编辑」不可机验**（KaTeX span 既不进 AX 树也不带 bbox，与项 2 同因）。
6. Callout —— `06-callout-and-width`：渲染态下 `[!note]` 标记与 `>` 前缀都不显露、内容按块渲染。
   **「光标进该行后源码显露」不可机验**（需光标落在 callout 首行）；表格宽度只留截图证据。

**仍归 Alex 手感（不下沉）**

4. 表头 cell 双击 padding 的选中手感。
5. 表格 cell 内公式点击手感；6. 表格宽度观感（欠宽不拉伸、超宽横滚是否合意，与「待 Alex 裁决」4 同源）；
7. WKWebView 下三条恢复路径的手感；9. Emacs 翻屏/扩选真机手感。截图在证据目录，判定归 Alex。
10. 分隔线的粗细与上下留白、围栏代码块配色的观感（M138）——机器断言只钉「渲成横线（发丝线、
    宽度=栏宽）」与「色值取自既有 editorial token」，合不合意归 Alex；前后对比见
    `tests/visual/baselines/render-*.spec.ts-snapshots/` 与真机截图。

## 记录在案（无需动作）

- **KimiCU AX 服务全局退化**（2026-09-16，M135 期间实测）：`get_app_state` 只剩菜单栏（`element_count`
  1–16、`truncated: [closed_menu, cycle]`、`window_bounds x=0 y=0 w=1 h=1`），Finder / Reminders / Lumir
  **一起坏**；`xpc-ping` 仍报 `accessibility=true screenRecording=true`。判定为 KimiCU 后台服务进了坏状态，
  恢复手段是重启服务（`/Applications/KimiCU.app/Contents/MacOS/kimi-cu install`）。这是机器级动作，
  已上报 tower 待 Alex 处理；套件本身无问题，恢复后重跑即可。
- **r1 格式崩溃备份**（无 base_revision）恢复后首次保存必报一次冲突——安全方向，仅限跑过 r1 build 的人。
- **kimi-cu `type_text` 走 AX 注入**，编辑器失焦时文本落陈旧原生选区——工具观测，非 app 缺陷。
- **`config.json` 解绑 ≠ 关闭能力**（已录 spec）：解绑后 macOS 原生选择器可能接手（如 ⌃K → `deleteToEndOfLine:`）——dogfood 改配置时预期内行为。
- **js/ts 对象字面量键的复合 `property` token 有意不修**（M147 finding，low）：`{1: "x"}` 的数字键取数字色、字符串键取字符串色（后者是 GitHub/VS Code 同款通行呈现），每次渲染伴一条 `Unknown highlighting tag property` console 噪声（CM6 按 part 名去重，不刷屏）；code 模式与围栏两侧一致，不构成 parity 缺口。若将来裁决「对象键一律属性色」，做法与 M147 相同——javascript/typescript 的 parser 挂 `{ property: tags.propertyName }` tokenTable（两处 LANGUAGES 同源）并核对 js/ts 基线；数字键要属性色还需处理 objprop 复合名（HighlightStyle 条目序裁决）。finding `20260917-worker-jsonhl-improve-javascript-typescript-property-token-console-json-js-ts.md`。

## 已核销（留痕，定期清理）

- 2026-09-16：**文件内搜索 v0**（M139，merge `647f519`）：`@codemirror/search` 6.7.2 能力底座 +
  editorial panel 重制（`src/search.ts`，createPanel），⌘F 走 keys.ts global 可重绑；匹配计数 /
  上一个/下一个 / 大小写切换。文案 D68–D72（M141 补录）。
- 2026-09-16：**验收套件注入假绿同族核销**（M140 merge `098918d` + M143 merge `d460535`）：
  keys 动作补回读 + 有限重试（≤3，只在目标字节完全未变时重试，partial landing 直接报错）；
  type 动作对齐同一口径（删除「次数校验能抓住前缀型 partial landing」的错误辩护注释）；
  08b 落点重做（探测串移文末 + 改走 type 通道 + `ax.focused` 新断言形态，走解析结果而非正则）；
  checkScenario 守卫（ax 断言必须带 has/not/count/focused 之一）。
  口径级验证 8 判定（假 CU 驱动真实代码路径）在 `_type-retry-unit/`。

- 2026-09-16：**验收套件 `file` 断言支持 glob 路径**（M144 落地，finding `20260916-worker-links-improve-file-glob-dated.md` + tower clarify-reply 裁决）：`file.path` 含 `*` 时按 glob 在父目录里取**匹配文件里 mtime 最新的那一份**再断言内容。动因是诊断日志按 UTC 日期命名、而验收环境的 `env/` 目录跨天复用（`envHome()` 不带日期）——写死日期的断言会在之后每天读到上次 run 留下的旧文件而**永久空过**（假绿），换机又直接 FAIL。落点：`scripts/acceptance/lib/execute.mjs` 的 `resolveSpecFile`（约 20 行）+ `scripts/acceptance/README.md` 断言表一句 + `scenarios/12-links.md` 用 `env:logs/*.jsonl` 断言 `link_open` 落盘并顺带断言日志里没有 URL 原文。**反向验证过**：在日志目录植入一个 mtime 更晚、不含 `link_open` 的文件后场景如实 FAIL（证明确实取最新那份、断言不空转），移除后 PASS。已知残余风险（同日重复跑时最新文件里可能有上一次的事件）写在场景正文，该断言与三条负断言联合构成判定。

- 2026-09-16：**外链渲染与打开快捷键**（M144）→ Alex 裁决采纳（原话「链接（[title](link)）渲染成 title↗︎，并增加打开它的快捷键」「wikilink 内部跳转体系不动」）：`[title](url)` 在 md 模式渲染为 `title` + 尾部 `↗︎`（U+2197 + U+FE0E），括号与 `(url)` 走 replace 装饰隐藏、文档逐字节不变（ADR 0003 §3）；光标/选区触及链接时整条显露源码——编辑态与改动前一致（改动前没有链接装饰，编辑 URL 看到的就是原文），同时避免长 URL 被隐藏后中间出现「按键而光标不动」的死区。`⌘⏎` 与 `⌘-Click` 走同一条命令（`wikilink.follow` → `link.follow`）：外链经 Rust 的 `open_external_url` 交给系统默认应用，wikilink 走既有 link_graph 跳转链路（未解析只提示、不建文件），都不在链接上则无操作。非外链形态（相对路径 / 纯锚点 / 白名单外 scheme / 自动链接 / 引用式链接）当时保持原文不装饰——「能开的才看起来能开」。**这一条口径已被 M145 推翻**（相对路径、锚点改为装饰，见下条核销）：M144 当时的非目标表述不再有效，此处保留原文仅为留痕。落点：`src/preview/links.ts` 新增（判定取自 lezer 语法树，不手写词法；`ensureSyntaxTree` 同步推进避免大文档刚打开时 ⌘⏎ 静默无反应）、`src/preview/livePreview.ts` + `theme.ts`（`Link` 节点装饰、`↗︎` widget、`.cm-lp-link` 样式）、`src/main.ts`（`link.follow` 命令与鼠标路径；⌘-Click 不再以 `currentPath` 提前返回——外链不需要 vault 上下文）、`src/keys.ts`（命令更名）、`src/ipc.ts` + `src-tauri/src/commands.rs`（`open_external_url`：scheme 白名单 **http/https/mailto** + 目标可信性校验，拒绝 → `open_url_rejected`，系统调用失败 → `open_url_failed`）、`src-tauri/src/lib.rs`（注册 `tauri-plugin-opener`，并以 `open_js_links_on_click(false)` 关掉插件注入的「点击 `<a target=_blank>` 直接开浏览器」脚本——那是绕开校验的第二条打开路径）、`src-tauri/src/logging.rs`（`link_open` 事件，字段 `scheme`/`outcome`，**不记 URL 原文**——URL 是文档内容，隐私边界优先于排查便利）。**权限最小化**：capabilities 不新增任何 `opener:*`，webview 对插件 IPC 保持默认拒绝，唯一入口是本仓 command（与 rfd 不引 tauri-plugin-dialog 同一取舍，见 `src-tauri/Cargo.toml` 注释）。提案 `add-external-link-open`。证据：视觉场景 `tests/visual/scenes/render-link.spec.ts` + 基线 `render-link-chromium-darwin.png`（渲染态 / 源码显露 / 文档逐字节不变 / 桩记录 `open_external_url` 的调用目标，零浏览器启动）；真机场景 `scripts/acceptance/scenarios/12-links.md` + fixture `links.md` / `links-wiki.md` / `links-missing.md`。文案 D77–D79。

- 2026-09-16：**表格合同收窄——短行尾部补空列对齐 GFM**（M137 finding `20260916-worker-table-survey-idea-gfm.md`，M142 落地）→ Alex 裁决采纳（原话「好，采纳。」）：数据行 cell 数少于表头时**尾部补空 cell 正常渲染**（GFM spec §4.10，GitHub/Obsidian 同款）；**多列仍整块回退**（GFM 对多列是 excess ignored，静默丢列与「不猜测修复」冲突）。落点：`src/preview/table.ts` 补零宽空 slot（`padShortRow`，一个槽位都没恢复出来的行不补——那是映射失败，必须降级）；`src/preview/livePreview.ts` 零宽空 cell 的空槽装饰改走 point widget（CM6 对零宽 replace 装饰抛 `RangeError: Invalid range for replacement decoration`，两侧默认非 inclusive）。降级文案措辞未变（收窄后只由多列/槽位不可映射触发，D73–D75 仍然准确）。合同 `docs/specs/table-reading.md` §2/§9 收窄；OpenSpec 提案 `narrow-table-short-row-gfm-padding`（含 `complete-markdown-reading` / `foundation-table-reading` 两份未归档 delta 的同主题口径对账）。证据：视觉场景 `tests/visual/scenes/table-foundation-v2.spec.ts`（短行 fixture 翻转为渲染断言 + outline.md 同款 6 列表头/5 cell 行专门断言 + 多列降级断言）；真机场景 `render-table-degrade` 改多列形态并补短行表渲染断言。

- 2026-09-16：**表格降级文案不暴露原因**（M137 finding `20260916-worker-table-survey-improve-reason.md`）→ M138 落地：降级文案带上出错**文档行号**与应为列数（`第 N 行单元格数与表头不符（应为 M 列）`），oversize 走体积/上限文案，无法识别结构走兜底文案；文案单一来源 `src/preview/table.ts` 的 `degradationNotice`，上屏（`::after` 经 data 属性）与 aria-label 同一份。同步断言在视觉场景 `table-foundation-v2` 与真机场景 `render-table-degrade`。
- 2026-09-16：**视觉门禁容差假绿** → Alex 裁决收紧 `maxDiffPixelRatio` 0.005→0.001 + 删 UI 后核对相关基线时间戳（卫生步骤入 tests/visual/README.md 与 AGENTS.md）。
- 2026-09-16：**lists 100k 性能预算** → Alex 裁决放宽 p95 40→60ms（间歇超属环境噪声；随 dogfood 性能专项复核是否回调）。
- 2026-09-16：**run.sh 端口占用检查只查 4173** → 已修，检查 `${LUMIR_VISUAL_PORT:-4173}` 实际端口。

- 2026-09-17：**链接装饰全形态覆盖**（M145）→ Alex dogfood 反馈（第 4 条，原话「我启动后看到的链接并没有渲染成 title↗︎」）驱动的口径补齐。M144 只装饰 http/https/mailto，把「相对路径不装饰」写进 Non-goals 时**未向 Alex 显式确认**（tower 已认领为裁决疏漏）。M145 补齐后的形态矩阵：外链（含 `mailto`）→ `title↗︎` 交系统默认应用；相对路径 md / 无扩展名 → `title→` 应用内跳转（Alex 裁决原话「内部跳转的带→，也就是 title→」）；相对路径非 md 与目录 → `title↗︎` 交系统默认应用；纯锚点 → `title→` 但激活只 toast；白名单外 scheme → 原文不装饰。装饰与激活解耦：分类只看目标原文（`src/preview/links.ts` 的 `classifyLinkTarget`），文件存不存在是激活时才问的问题，因此「目标不存在」的链接照常装饰、代价由 toast 承担。落点：`src/preview/links.ts`（`classifyLinkTarget` 五类 + `standardLinkAt`）、`src/preview/livePreview.ts`（`LinkMarkWidget` 按类别出 `↗︎`/`→`）、`src/main.ts`（`linkTargetAt` 五态 + `followLink` 分流 + 相对路径未解析只 toast 不创建）、`src/ipc.ts`（`linkResolveNote` / `linkOpenPath`）、`src-tauri/src/link_graph.rs`（`relative_vault_path` + `resolve_relative`：相对当前文件目录的路径语义，`./` `..` 归一、`/` 开头按 vault 根相对、`#fragment` 忽略、**不退化到 wikilink 的名称匹配**）、`src-tauri/src/commands.rs`（`link_resolve_note` + `link_open_path`，后者经 `fs_io::resolve_in_vault` 做 vault 内约束与存在性校验）、`src-tauri/src/logging.rs`（`link_open` 增 `category` 字段：external / internal-md / asset / anchor / blocked-scheme）。**权限面未变**：capabilities 仍零 `opener:*`，新增的资产打开走同一条 Rust 侧最小权限路径（`app.opener().open_path`，不经 webview IPC）。规格：修订 `openspec/changes/add-external-link-open` 的两份 spec delta（就地扩为形态矩阵，避免归档后 living spec 出现两条自相矛盾 requirement）；文案 D80–D83。证据：视觉场景 `tests/visual/scenes/render-link.spec.ts`（12 条用例，含分类纯函数与四类激活分流；桩记录 `open_external_url` / `link_open_path` / `link_resolve_note`）+ 更新后的整页基线；真机场景 `scripts/acceptance/scenarios/12-links.md`（25 步，含相对 md 跳转成功 / 未解析 toast、锚点 toast、非 md 打开、不可用不装饰；`link_open` 各类别断言带 `^…$` 行锚）。**两处待 Alex 复核的裁决已录入「待 Alex 裁决」第 9 条**（非 md 带 ↗︎、锚点带 → 仅 toast），另有 `note.md#sec` 锚点忽略口径同批披露。
- 2026-09-17：**归档积压清理——7 个已合并未归档的 change 批量归档**（M150，Alex 对整体 review 的裁决「好，采纳。你动手吧」，含归档节点 2 的批量授权）。归档清单（`openspec/changes/archive/2026-09-17-*`）：`add-wikilink`（积压 12 天）、`add-diagnostics-logging`、`add-external-link-open`、`fix-json-key-highlight`、`add-toc-outline`、`add-multi-tabs`、`narrow-table-short-row-gfm-padding`；对账结果——7 个的 spec 增量与实现逐条一致，其中 `add-wikilink` 的 `specs/backlinks-panel/` 增量**不随归档**（该 capability 已按 ADR 0004 §2 挤压预案推迟且实现已移除，照旧归档会凭空生成一份描述「面板存在」的 living spec），其推迟记录移入 proposal 的「归档对账」节；未勾任务就地标注放弃原因（`add-wikilink` 5.3、`add-diagnostics-logging` 4.2）。**教训（本批次的核心发现）**：7 个 change 里**只有 1 个**（`add-diagnostics-logging`）在 `docs/backlog.md` 里被记为待归档，其余 6 个合并后无人跟踪——living spec 因此长期落后，`editor-live-preview` 甚至与实现直接矛盾（自称「M1 只读口径」而 md 模式早已可编辑）。**防线**：`docs/process/openspec-workflow.md` 新增「批次收尾 checklist（归档跟踪）」三条（每个 merge 的 change 即记待归档并跟踪到归档 / 归档前逐条对账 / 归档后手写新建 capability 的 Purpose）；同文件新增「撤回（withdrawn）」口径（僵尸提案的处置三步）。归档后 `openspec list` 活跃列表为空，`validate --all --strict` 14 项全绿（含 5 处新建 living spec 的手写 Purpose）。
- 2026-09-17：**僵尸提案撤回 4 个**（M150）：`foundation-vault-recovery`（0/9）/ `foundation-markdown-quality`（0/14）/ `foundation-table-reading`（0/17）/ `complete-markdown-reading`（2/17）。处置：整体移到 `openspec/changes/archive/2026-09-17-withdrawn-<id>/`，各自 proposal 头部写入「撤回记录」（理由 / 承接者 / 遗留面）。逐个的对账结论：① `foundation-vault-recovery` 的核心机制**在仓内不存在**（全仓 `grep operation_id` 零命中，`intent` / `ledger` 同样零命中），其要解决的问题已由 `archive/2026-09-12-save-hardening`（崩溃备份 + 启动恢复）与 `archive/2026-09-12-save-and-watch-recovery`（冲突 / 外部修改处置）承接，`docs/specs/vault-recovery.md` 状态头改为「已撤回（留档作重启输入）」；② `foundation-markdown-quality` 是「只立合同」的提案，合同本体 `docs/specs/foundation-markdown.md` 仍在被实现注释引用（`src/preview/table.ts`、`callout.ts`、`math.ts`、`mermaid.ts`），状态头改为「生效中的质量合同」；③ `foundation-table-reading` 同理，合同本体 `docs/specs/table-reading.md` 已被 M142 按 Alex 裁决收窄，状态头同步；④ `complete-markdown-reading` 的四项 requirement 均已实现（列表布局 `src/preview/lists.ts`、表格 `src/preview/table.ts`），但其出口验证从未按其形态执行、节点 2 未过，故撤回而非归档。**遗留缺口（需另立 change，本批不做）**：列表对齐与基础表格阅读的 requirement 文本至今未进 living spec——只有实现、门禁与 `docs/specs/table-reading.md` 合同，没有 requirement 级规格。另：`scripts/visual/table-probe72/matrix.mjs` 的产出路径指向 `openspec/changes/complete-markdown-reading/`（随本次移动失效），已投 finding 待处置。
- 2026-09-17：**补记两处规格缺口（M150）**：① **文件内搜索 v0**（M139 实现先于规格落地，merge `647f519`）→ 补 retro change `add-in-file-search` 并归档，新建 living spec `openspec/specs/in-file-search/spec.md`（入口与键位归属 / 能力集与匹配口径 / 关闭与焦点归还三条 requirement，含「不做替换」「高亮只看视口」等如实边界）；② **`editor-live-preview` 规格对齐 + M138 渲染三件套补记** → retro change `align-editor-live-preview-spec`：删掉 living spec 里与实现矛盾的「M1 只读口径，不含编辑态行为」与「MUST NOT 实现光标所在行 reveal 源码」（现状是 md 模式可编辑、选区触及即显露源码），补入 `Markdown 渲染保真（分隔线 / 围栏代码着色 / 引用内列表）` requirement，并重写 Purpose（`## Purpose` 的增量只在 capability 创建时被读取）。两份 retro change 的 tasks 全部按「已存在实现与证据」核对勾选。
- 2026-09-17：**`tests/visual/README.md` 卫生节 missing**（M146 finding `20260917-worker-reviewmd-bug-ui-readme.md`）→ 已由 M147 `c81b3ed` 闭合：`tests/visual/README.md` 补入「删除 / 移动 UI 元素后的核对（卫生步骤，强制）」一节（现 67–85 行），`playwright.config.ts:11` 与 AGENTS.md 的指针恢复可达。**未做**：finding 里顺带建议的「`scripts/visual/run.sh --update` 输出回显该提醒」未落地（建议项，非必需）。
- 2026-09-17：**`src/preview/livePreview.ts:427` 注释引用已删除的 `openDocument`**（M149 r1 nit `20260917-worker-tabs-improve-m149-nit-livepreview-ts-opendocument-scope.md`）→ M150 改「装载（`editor.reloadSession`）」，与 M149 同批另两处（`mermaid.spec.ts:296` / `toc-outline.spec.ts:84`）同形。同时顺手改掉同文件第 4 行的同族陈述——文件头「只读口径：不做光标行 reveal 源码的编辑态逻辑」同样与实现矛盾（该文件里有完整的选区显露实现），一并改为现行编辑态口径。
- 2026-09-17：**`docs/process/real-machine-acceptance.md` 证据落点指针悬空**（M150 顺手修）：裁决点 1 的备选「摘要表入 `docs/design-parity-contract/evidence/`」指向的契约已随 ADR 0006 失效（`docs/design-parity-contract/README.md` 自述「状态：失效（2026-09-12）」），改为「证据统一落 `test-results/acceptance/`（已 gitignore），摘要表入 `docs/backlog.md` 的待真机验收节」。
- 批次三：键位分发三轨并行 + 扩展名注册表漂移（M130/M131/M132）；save-ipc.ts 折回 ipc.ts（M132）；Ctrl-K/D/T 原生路径风险（M132）。
- 批次二：DeepSeek Flash 试用结论——可做 build，review 环节（k3-256k）不能省。
