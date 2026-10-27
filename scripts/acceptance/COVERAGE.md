# 验收场景覆盖表（自动生成，勿手改）

<!-- 生成：node scripts/acceptance/coverage.mjs　　校验：同一命令加 --check
     （挂在 scripts/docs-check.sh 与 node scripts/acceptance/run.mjs --check 上）
     唯一真源 = scripts/acceptance/scenarios/*.md 的 front-matter（id / item / title / tier）。 -->

- 场景：230
- 验收项（不同 item 编号）：209
- 分档：core 29 / full 194 / bundle 3 / evidence 4（full 批 = 全部 230 个，含其余各档）

`item` 是验收项号，也是 `node scripts/acceptance/run.mjs <item>` 的筛选键。一个验收项拆成多个场景
文件是既有设计（如 item 7 = `07` / `07c` 两条恢复路径，`07b` 于 M750 下沉退役），故表里一项一行、行内列出全部场景；
同一 item 出现在两行才会判红。`tier` 是场景所属批次（闭集合 core / full / bundle / evidence），
`node scripts/acceptance/run.mjs --batch <档>` 按它筛；`full` 是语义上的**全量**（含其余各档），
故 `--batch full` 与不带 `--batch` 跑的是同一批场景。本表是**场景清单**，不是验收结论——每个场景的真实 PASS
证据在 `.local/acceptance/<批次>/`（git 外），未收口的行为限制与待 dogfood 项在 `docs/backlog.md`
「待真机验收」节。

| item | 场景 | 标题 | tier |
| ---: | --- | --- | --- |
| 1 | `01-mermaid-click` | Mermaid 图表点击进源码编辑 | full |
| 2 | `02-math-click` | 公式渲染态与进编辑路径（⌃B 次数仍待判定） | full |
| 3 | `03-table-ctrl-np` | Ctrl+N/P 表格行为（M118 裁决） | full |
| 6 | `06-callout-and-width` | Callout 光标行源码显露 / cell 内 $$y$$ / 表格宽度证据 | full |
| 7 | `07-recovery-paths`<br>`07c-external-reload` | M124 三条恢复路径（冲突双动作 / 另存为 / 外部修改重载）<br>M124 恢复路径之三——外部修改且缓冲干净时自动重载 | core<br>full |
| 8 | `08c-crash-recovery`<br>`08d-crash-discard` | 崩溃恢复——启动提示双动作与「恢复内容」<br>崩溃恢复——「丢弃备份」动作 | core<br>full |
| 8.1 | `180-subagent-delegate-discovery` | 子代理 8.1 定义发现与自动委派（mock provider） | core |
| 8.2 | `181-subagent-default-tools`<br>`182-subagent-explicit-write-tool` | 子代理 8.2 默认只读三件（未声明 tools）<br>子代理 8.2 显式写工具（声明 vault_patch） | full<br>full |
| 8.3 | `183-subagent-approval-approve`<br>`184-subagent-approval-reject` | 子代理 8.3 批准透传（采纳 ⇒ 文件删除）<br>子代理 8.3 批准透传（拒绝 ⇒ denied_calls=1、文件未删、子运行继续） | full<br>full |
| 8.4 | `185-subagent-definition-validation` | 子代理 8.4 定义校验与优先级（坏定义告警、vault 覆盖用户级、同层字典序） | full |
| 8.5 | `186-subagent-hot-reload` | 子代理 8.5 热加载：回合间改定义的模型与工具，下一回合生效 | full |
| 8.6 | `187-subagent-catalog-large` | 子代理 8.6 描述超阈值：catalog_large + warning，清单不截断 | full |
| 8.7 | `188-subagent-gates-and-quota` | 子代理 8.7 三重闸触顶 + 配额（partial + stopped_by + 无追加调用） | full |
| 8.8 | `189-subagent-resume`<br>`190-subagent-run-busy` | 子代理 8.8 resume 续跑：同 run、segment=2、审计追加、用量继续归桶<br>子代理 8.8 运行中的后台 run resume ⇒ run_busy | full<br>full |
| 8.9 | `191-subagent-resume-boundary` | 子代理 8.9 resume 边界：agent 不匹配、重启后不可续跑 | full |
| 8.10 | `192-subagent-usage-buckets` | 子代理 8.10 用量按模型分桶 + 恢复后相等 | full |
| 8.11 | `193-subagent-model-resolution` | 子代理 8.11 模型解析：调用覆盖生效 | full |
| 8.12 | `194-subagent-disabled`<br>`195-subagent-subrun-limit`<br>`196-subagent-concurrency-limit` | 子代理 8.12 关停：task 不注册、任务区不出现、定义保留<br>子代理 8.12 次数闸：max_subruns_per_turn=1 时第二个委派被拒<br>子代理 8.12 并发闸：max_concurrent=1 时第二个后台委派被拒 | full<br>full<br>full |
| 8.13 | `197-subagent-api-partial` | 子代理 8.13 API 中断 partial：已有文本 + stopped_by=error | full |
| 8.16 | `198-subagent-parallel` | 子代理 8.16 同回合并行 + 按序回填（慢段先启动、快段先完成） | full |
| 8.17 | `199-subagent-background-wake` | 子代理 8.17 后台运行 + 完成通知 + 自动唤醒 | full |
| 8.18 | `200-subagent-explore` | 子代理 8.18 内建 explore 与其被同名定义覆盖 | full |
| 8.19 | `201-subagent-panel-and-stop` | 子代理 8.19 任务面板可见（WKWebView AX）+ 停止单个 run | full |
| 8.20 | `202-subagent-busy-merge` | 子代理 8.20 忙时合并：两个后台结果只起一个自动回合 | full |
| 8.21 | `203-subagent-chain-limit`<br>`204-subagent-stopped` | 子代理 8.21 链上限（5）：第 6 条结果不起回合、通知上屏、提示行 +「继续」<br>子代理 8.21 停止自动回合 ⇒ blocked_stopped（后续通知不再唤醒） | full<br>full |
| 8.22 | `205-subagent-auto-turn-loopmax` | 子代理 8.22 自动回合内触顶 loop_max：按既有提示结束、链计数不变 | full |
| 8.23 | `206-subagent-notice-restore` | 子代理 8.23 已投递未消费的通知：合并窗口内退出 ⇒ 重启重建上屏、不补唤醒；消费后不重复 | full |
| 9 | `09-emacs-keys`<br>`09b-keys-config` | Emacs 键位行为 + ⌘Z 真机路径 + ⌘/ 键位面板<br>「keys」配置实操——重绑与解绑 | core<br>full |
| 10 | `render-markdown`<br>`search-01-find`<br>`search-02-binding` | Markdown 渲染三件套：分隔线 / 代码块着色 / 引用内列表（M138）<br>文件内搜索（⌘F）：panel 出现、匹配计数、上一个/下一个导航、Esc 还原焦点<br>搜索键位可重绑（config.json 的 keys 表） | core<br>full<br>full |
| 11 | `render-table-degrade` | 表格降级文案带上出错行号与原因（M138）/ 短行补空列不再降级（M142） | core |
| 12 | `12-links` | 链接渲染与激活（外链 / 相对 md / 资产 / 锚点 / 不可用） | full |
| 13 | `13-toc` | 轻量大纲：位置指示 / 浮层条目 / 键盘（↑↓ / ⌃N⌃P）与鼠标跳转 / 关闭 / 空标题与 frontmatter 边界 | full |
| 14 | `14-tabs` | 多标签——单击即开标签 / 序号直达 / 循环切换 / 关闭确认 / 外部变更点名后台标签 | full |
| 16 | `16-startup-restore` | 启动自动恢复 last_vault（终态与失效路径） | full |
| 17 | `17-multi-vault-switch` | 多 vault——树头部入口的列表浮层、切到未打开过的 vault 的空态引导、切回后按会话恢复标签 | full |
| 18 | `18-vault-session-restore` | 启动按 last_vault 恢复 vault，并一并恢复它的标签列表与激活项 | full |
| 19 | `19-vault-switch-guard` | 切换 vault 的 dirty 前置门——「取消 / 保存并切换 / 放弃修改并切换」三条出口各自闭环 | full |
| 20 | `20-image-fallback` | 图片引用的可见回退（svg 正常显示 / 固有宽度不定者按栏宽填充 / 不可见即占位 / 脚本不执行） | full |
| 21 | `21-wrap-default` | 折行口径默认值（文件折行、代码块不折行）与代码块横滚容器 | full |
| 22 | `22-wrap-toggle` | 折行开关运行期翻转（[keys] 绑定后生效、两轴独立、不落盘） | full |
| 23 | `23-image-first-open-width` | 图片显示宽度不依赖加载时序（首开 vs 切走切回两态收敛到栏宽） | full |
| 26 | `26-svg-scroll-stability` | 倒序滚动经过大尺寸 svg 图：图渲染完整、终态无自发位移（替换区尺寸的会话内一致性，M187） | full |
| 27 | `27-document-end-marker` | 正文末尾的结束标记（文档超过一屏时显示、装得下时不显示） | full |
| 28 | `28-remember-reading-position` | 记住文档阅读位置：重启后再次打开同一文件从上次位置继续 | full |
| 29 | `29-typography-and-zoom` | 排版与字号步进：配置字号端到端生效、⌘= / ⌘− / ⌘0 / ⌘⇧= 的可见结果、config.json 与源文件逐字节不变 | full |
| 30 | `30-code-outline` | 代码文件的符号大纲：⌘⇧O 展开符号条目、跳转到声明、惰性解析（没按过 ⌘⇧O 就不解析、不出指示段）、两条新空态提示 | full |
| 31 | `31-code-variable-highlight` | 双击标识符高亮同一变量：选区成立即判定（底纹在场留截图）、装饰不改文档、T3 与 md 静默 | full |
| 32 | `32-list-filter` | 两处列表浮层的输入筛选（大纲 / vault 切换器）：打字即筛、结果集里的游标与跳转落点、无命中保留浮层、Esc 一步丢弃查询 | full |
| 34 | `34-restyle-theme-skeleton` | restyle 收尾：ui.theme=eink 经配置通道生效、骨架几何与信息落位在场、masthead 指纹不在场、验收 vault 文件哈希不变 | core |
| 35 | `35-restyle-three-themes` | 三主题真机呈现（light / dark / eink 各一张截图，重启生效）与 overlay 标题栏的窗口级读数 | evidence |
| 36 | `36-restyle-content` | restyle 内容面真机呈现：doc-title 块（fm 后正文前 + meta 三要素）、callout 双段标签、文件树目录 chevron 与选中行 | full |
| 37 | `37-heading-hierarchy` | 标题六级阶梯（稿 A）真机呈现：H1–H6 全部渲染、编辑器源码不动、文档零写盘 | full |
| 38 | `38-content-width-drag` | 栏宽双侧拖拽手柄：拖拽写回 config.json（合并写、不抹其他键）、文档零写盘、重启保持 | full |
| 39 | `39-titlebar-identity` | 标题栏产品标识块：版本号与 tauri.conf.json 逐字节一致、窄窗 ≈520px 退让 modeline、标识块上拖拽窗口成立、三主题截图 | core |
| 40 | `40-table-fullscreen-view` | 表格放大全屏查看：命令打开遮罩、快照在场、Esc 关闭焦点回编辑器、降级表无入口、不改写源文件 | full |
| 41 | `41-editable-non-md-files` | 非 md 文本文件可编辑——键入 / dirty / ⌘S 落盘 / 撤销收窄，外部修改走同一组冲突双逃生口 | full |
| 42 | `42-non-md-edit-guardrails` | 非 md 可编辑的护栏矩阵——二进制仍「暂不支持预览」、非 UTF-8 打开即拒、文本类不受牵连 | core |
| 43 | `43-list-tab-indent` | 列表项缩进命令的真机链路——经 [keys] 绑到通道可达的 ⌘J / ⌘⇧J：缩进的源码写回（有序列表按新归属重排序号）、到顶 / 非列表 / 非 md 会话无操作、一次撤销还原 | full |
| 44 | `44-theme-live-switch` | 主题运行期切换：⌘⇧T 与 modeline 钮三档循环、逐档写回 config.json、重启后首帧持久 | full |
| 45 | `45-tab-cycle-keys` | 标签循环键——⌃⇥ / ⌃⇧⇥ 的真机循环语义（末端 / 首端回卷、单标签无操作）＋ ⌘} / ⌘{ 的通道限制登记 | full |
| 46 | `46-dotfile-jsonc-highlight` | dotfile 与 JSONC 高亮——.gitignore / .gitattributes / x.jsonc 逐字节回读与语言登记，.secret 对照组仍纯文本；三类可编辑（编辑 → 回读 → ⌘S 落盘） | full |
| 47 | `47a-menu-basics`<br>`47b-rename-validation`<br>`47c-create-and-delete`<br>`47d-dirty-tab-linkage` | 文件树右键菜单：文件行 / 目录行项集分流、行空白区命中、Esc 收起、复制完整路径（绝对路径）、在 Finder 中显示（只读弱断言）<br>树内联重命名与校验：预填 + 获焦、改名落盘与 watcher 收敛、撞名拒绝、忽略集名拒绝、Esc 退出编辑态<br>文件删除与新建：移到废纸篓（文件 / 目录两档确认文案）、目录下新建文件（自动打开）与子目录<br>打开中 dirty 文件的改名联动与删除处置：标签就地换名、未保存内容不丢、两种误报都不出现 | full<br>full<br>full<br>full |
| 48 | `48-vault-registry-migration` | 注册表目录更名迁移——预置旧目录 workspaces/ 与注册项，启动后整个目录被原子搬进 vault-registry/、身份不丢、vault 照常恢复打开、迁移记一条诊断事件 | core |
| 50 | `50-tab-context-menu` | 标签右键菜单——Close / Close Other Tabs / Close Tabs to the Right 三条关闭路径，脏标签走既有确认流（取消即停手） | full |
| 52 | `52-dir-rename-expand` | 目录经树内右键重命名后仍可展开（子孙条目与展开态随目录搬到新路径，改回原名亦然） | full |
| 53 | `53-bold-click-selection` | 点击粗体不产生幻影选区（M259）——指针按压期间的落点判定不跨布局 | core |
| 54 | `54-bare-url-cmd-click` | 裸 URL / 链接定义行 / 角括号自动链接的装饰与 ⌘⏎ 打开（M272） | full |
| 55 | `55-ui-language-switch` | 界面语言运行期切换：⌘⇧L 切到 en、chrome 文案上屏英文、写回 config.json、重启后首帧即配置语言 | full |
| 56 | `56-goto-line` | 跳转到行命令的真机链路——⌥G 打开输入条（预填当前行号 + `共 M 行`）、行号列随输入条出现并在收起后隐藏（`on-demand` 默认档）、Enter 落到目标行（落点由 modeline 指示段与预填值双证）、越界静默钳到末行、取消不动光标与文档、[keys] 重绑通道 | full |
| 59 | `59-enter-auto-indent` | Enter 换行自动缩进的真机链路——code 模式继承语法缩进、无缩进规则的语言沿用当前行、md 围栏内沿用当前行且不续列表标记、md 列表续行不变、auto_indent=false 回退 | full |
| 60 | `60-vault-switch-restore` | vault 切换的写盘段反馈与「标签栏当帧齐、正文按需装载」 | full |
| 61 | `61-block-copy` | 块级复制：表格复制含表头分隔行的源码、代码块复制纯内容（围栏行与语法缩进都不在结果里）、降级表与 code 模式不命中不消费、不改写源文件 | full |
| 62 | `62-code-block-fullscreen` | 代码块放大全屏：命令打开遮罩、整块源码在场（含文档视口之外的行）、三条关闭路径关闭后阅读位置不变量成立、缩进块可放大、code 模式无入口、不改写源文件 | full |
| 64 | `64-bold-selection-drawselection` | 选中跨粗体：选区底色由编辑器自绘（drawSelection），粗体段不漏画、行尾空白也涂满 | core |
| 65 | `65-external-reload-reading-position` | 外部改写当前文档：重载后视口不回篇首（阅读位置恢复）+ 表格全屏遮罩退出 | full |
| 66 | `66-code-block-selection` | 代码块内选区底色可见（块底色 MUST NOT 盖住 drawSelection 自绘的选区） | full |
| 67 | `67-vault-open-ignore-set` | 大 vault 打开：hidden 档隐藏 / 其余名字惰性可见，且打开段不冻结界面 | core |
| 68 | `68-selection-contrast` | 三主题编辑器选区带可辨（含 eink 选中区文字可读） | full |
| 69 | `69-tab-reveal-in-tree` | TAB 右键菜单定位项（需求原话「在左栏中定位到此文件」，上屏 Reveal in File Tree）——展开祖先、目标行现身（真实 WKWebView + 真实右键通道） | full |
| 71 | `71-harness-tool-loop-read` | Harness ② 工具循环：vault_read 读文件并回答（change add-harness-probe，mock provider） | core |
| 72 | `72-harness-patch-approve` | Harness ③ patch 批准闸：采纳落盘、未触及部分逐字节不变、打开中会话同步（change add-harness-probe，mock provider） | core |
| 73 | `73-harness-patch-reject` | Harness ④ patch 批准闸：拒绝不落盘（change add-harness-probe，mock provider） | full |
| 74 | `74-harness-create-oexcl` | Harness ⑤ vault_create O_EXCL：撞名不覆盖、新名落盘（change add-harness-probe，mock provider） | full |
| 75 | `75-harness-permissions` | Harness ⑥ 权限规则：deny 命中直接拒绝（deny > allow）、allow 命中免闸（change add-harness-probe，mock provider） | full |
| 76 | `76-harness-usage` | Harness ⑦ 上下文读数：usage → 控制行「ctx% · cache%」双读数（M370 起，分隔符小圆点与 modeline 同款） | full |
| 77 | `77-harness-skill-load` | Harness ⑧ Skill：索引发现 + skill_load 按需加载 + 根外名拒绝（change add-harness-probe，mock provider） | full |
| 78 | `78-harness-vault-scope` | 切 vault 后 harness 显示当前 vault 的会话（另一 vault 的对话不串台） | full |
| 79 | `79-pane-split` | 双栏 pane——⌥S 分栏（新 pane 空态）/ ⌥O 往返切活跃 / ⌥S 上限二无操作 / ⌥W 收起并入 / 跨 pane 打开已开文件是移动 | full |
| 80 | `80-pane-session-restore` | 分栏会话恢复——双 pane 各一标签，启动恢复后归位原 pane（不挤到右栏） | full |
| 81 | `81-quote-card-create` | 摘录卡片 ① 选区 → 浮动钮 → 卡片入 composer（harness pane 未开先开） | full |
| 83 | `83-quote-card-serialization` | 摘录卡片 ③ 引用消息序列化结构（file/heading/lines 三属性、转义、协议无编号） | full |
| 84 | `84-quote-card-anchor-loss` | 摘录卡片 ④ 失锚降级三层（行号命中 / 漂移后全文搜索 / 失锚 toast） | full |
| 85 | `85-quote-card-transcript` | 摘录卡片 ⑤ transcript 同构沉淀（卡片与问题段落平铺、卡片变跳回按钮、无 ×） | full |
| 86 | `86-harness-pane-toggle` | ⌘⇧A 开合 harness pane：自动分栏默认 1:1、再按收起不丢标签、pane.close 于 harness pane 同义 | full |
| 87 | `87-harness-ctx-warn` | ctx% 越警示阈值：读数高亮 + hover 读数浮出警示说明（ⓘ 钮已随 M370 移除） | full |
| 88 | `88-harness-turn-abort` | 发送/停止两态：mock 长流在途时点停止 → 本轮中断、已产出保留并标「已停止」、composer 立即可用 | full |
| 89 | `89-harness-copy-message` | 复制消息：消息 hover 钮复制该消息 Markdown 源文本（剪贴板逐字断言） | full |
| 90 | `90-harness-model-chip` | 合并选择器：读数 = model · effort、浮层三维分段（mock 隐藏）、provider 选择写回（M373 适配 chip 合并） | full |
| 91 | `91-harness-pane-restore` | harness_pane 随 vault 往返恢复：启动装配出面板（空会话）、切走不泄漏、切回按存储重建 | full |
| 93 | `93-harness-thinking-blocks` | 思考块三态（live：折叠默认 / 展开见原文 / 时长读数）+ 会话恢复重建的思考块默认收起、折叠行取无时长变体、点开见原文 | full |
| 94 | `94-harness-thinking-absent` | 无 reasoning 的响应整条 agent 消息零思考块（块数为零的反向验证） | full |
| 95 | `95-harness-thinking-effort` | 思考程度会话态（M373 并入合并 chip）：默认 High → 浮层三档 → 选 Max 读数翻转 → 新会话回 High | full |
| 96 | `96-harness-transcript-restore` | harness transcript 快照恢复保真：切 vault 回来后工具行带人话化参数、工具清单按消息分块、无光秃 Agent 头 | core |
| 97 | `97-harness-stream-visible` | 真流式与在途停止：分段到达时可见部分正文、片间隔内点停止能中断在途流并保留已产出正文 | full |
| 99 | `99-harness-k3-thinking-chip` | k3-256k 思考程度可用（M373 合并 chip）：订阅模型配置下 chip 可点、浮层三档、选择写会话 | full |
| 100 | `100-empty-line-editing` | 空行编辑三连（M399）——有内容行行首 Enter 换行且新空行可见、空列表项 Enter 去标记留空行（不新增行）、删空项 marker 后行保留可见 | full |
| 101 | `101-harness-k2-chip-disabled` | kimi-k2.6 思考程度置灰（M373 合并 chip）：同一条配置链配 k2 系模型，能力按 schema 声明现算 | full |
| 102 | `102-harness-model-dimension` | 合并选择器 model 维度（M373/M381 config-only）：schema models 清单进浮层、选择写回 providers.kimi.model、effort 能力随声明翻转 | full |
| 103 | `103-harness-tool-order` | 工具行时序：先调工具后作答的轮次，定稿后工具行保持在最终回答之前（M374） | full |
| 104 | `104-harness-stop-immediacy`<br>`104-harness-thinking-tool-order` | 停止即时性与轮次封闭：片间隔内点停止亚秒级收口（时长上界断言），停止后继续提问不复活被取消轮的回复<br>思考块与工具行的到达序：think→tool→think 交错按真实时序呈现（M383） | full<br>full |
| 105 | `105-harness-wire-retention` | wire 留存：一轮含工具循环的对话后，sessions/<vault 稳定 id>/<id>.jsonl 首行装配记录（含来源存在与否）+ 每轮完整 llm_request / llm_response（思考文本 + usage） | full |
| 106 | `106-harness-session-restore` | 会话恢复：会话浮层选择器列出历史会话 → 选中恢复续聊 → 新会话 JSONL 的 system/input 与原会话衔接 | core |
| 107 | `107-harness-send-no-doc` | 无文件打开时 harness 发送成功：无上下文纯对话不发 error（context_json 恒为 string） | full |
| 108 | `108-harness-session-delete` | 会话删除（M406）：活跃会话拒删（harness_session_active 错误行）→ 历史会话行内两步确认删除（取消还原 / 确认删文件） | full |
| 109 | `109-harness-permission-chip` | 权限 chip（M414）：短名读数 / 三档浮层（全名 + 每档一行释义）/ 档位写回 config（change add-harness-permission-modes） | full |
| 110 | `110-harness-approval-purpose-remember` | 批准卡（M414）：purpose 用途句 + 组合命令拆段 + 「采纳且本会话不再问」免闸（change add-harness-permission-modes，mock provider） | core |
| 111 | `111-harness-vault-move-delete` | vault 写重定向链 + vault_move / vault_delete 的面板呈现与批准卡（M414 验收面，mock provider） | full |
| 112 | `112-paste-image-to-vault` | 贴剪贴板图片入 vault（落盘笔记同目录 + 转码 + 内容寻址命名 + 引用 + 渲染） | core |
| 113 | `113-paste-image-dedupe-across-notes` | 同图跨笔记再贴不产生副本（全 vault 内容寻址去重，首贴位置赢） | full |
| 114 | `114-paste-text-regression` | 文本粘贴回归（剪贴板无图片时拦截层 MUST NOT 消费事件） | core |
| 116 | `116-paste-image-transcode-size` | 转码体积实证（2560×1920 类截图：剪贴板字节 vs 落盘字节，证据型） | evidence |
| 117 | `117-harness-composer-soft-break` | composer 一次 ⇧Enter 即换行：第二行落在下一行的行位（M419，HC1） | core |
| 118 | `118-harness-composer-autoscroll` | composer 断行后视口自动滚到光标行：最下一行带 = 新断出的空行（M419，HC2） | full |
| 119 | `119-toast-anchor-pane` | toast 锚定发起 pane 右下角（分栏态不跨 pane） | full |
| 120 | `120-list-lazy-continuation-indent` | 列表末尾退出后的行键入字符落在行首（M421）——Enter 造空项 → 再 Enter 删标记 → 键入字符，源码落在第 1 列、渲染在行首（lazy continuation 不按列表项缩进） | full |
| 123 | `123-harness-agents-local-md` | vault 根 AGENTS.local.md 自动装配为第三层（本地覆盖层排在 vault 根 AGENTS.md 之后） | full |
| 124 | `124-harness-sessions-per-vault` | 会话留存按 vault 分目录：两 vault 各落各目录（目录名 = 注册表 id），浮层只见当前 vault 的会话，根下零平铺 | full |
| 125 | `125-harness-sessions-migrate-script` | 一次性归位脚本：平铺留存按首行 vault_root 归入 vault 目录，不可归属进 _orphaned，根下零 *.jsonl，可重跑幂等 | full |
| 126 | `126-window-geometry` | 主窗口尺寸：首启 = 工作区 90% / 二次启动按存档恢复 / 越界存档钳到工作区 / 存档损坏回落且自愈 | core |
| 127 | `127-harness-composer-image-paste` | composer 贴图：落 harness 侧 attachments/<vault id>/（vault 零新增）+ 图片卡片 + wire 交错引用 + JSONL 无 base64 + 重启恢复 round-trip | core |
| 128 | `128-harness-image-gate` | 图片能力闸：模型未声明 vision 时含图消息发送被挡（toast + 卡片标出 + 输入区保留 + 会话不推进） | full |
| 129 | `129-harness-image-per-vault` | 贴图附件按 vault 分置：两 vault 各贴各落（attachments/<各自稳定 id>/），互不可见、留存互不污染 | full |
| 131 | `131-harness-cache-session` | Harness 缓存读数①：控制行显示会话累计命中率、气泡命中率行同源（单回合值 / 成因句 / 写入行不上屏）、切 vault 回来读数仍在 | full |
| 132 | `132-harness-cache-dilution` | Harness 缓存读数②：大块摊薄回合——控制行仍显示会话累计、气泡只剩用量行与命中率行（本回合 / 成因 / 写入行不上屏） | full |
| 133 | `133-harness-cache-write` | Harness 缓存读数③：缓存写入只进留存（本回合 + 按 0 记）、气泡不渲染写入行 | full |
| 134 | `134-harness-composer-intercard-caret` | composer 两张相邻卡片之间：⌃B 落位 → 键入落在两卡之间 → 一次撤销回到前态（M450，HC3） | full |
| 135 | `135-harness-draft-restore` | composer 草稿：编辑 + 贴图后重启，输入区按块序还原（图片卡片引用 round-trip、草稿无 base64） | core |
| 136 | `136-harness-draft-vault-scope` | composer 草稿按 vault 各留各的（含切走前 flush 最后一次编辑）+ vault 零写入 | full |
| 137 | `137-harness-draft-send-clear` | composer 草稿：发送成功后清除（草稿文件被删除、输入区清空） | full |
| 138 | `138-harness-draft-send-reject` | composer 草稿：发送被拒（模型不支持图片）时草稿原样保留（无丢字窗口） | full |
| 139 | `139-harness-draft-no-vault` | composer 草稿：无 vault 打开时只在内存工作（不落盘、不报错、不落兜底目录） | full |
| 140 | `140-harness-composer-nav-move` | composer 内 Emacs 移动族落点：⌃B/⌃F/⌃A/⌃E/⌃N/⌃P（M447） | full |
| 141 | `141-harness-composer-nav-intercard` | composer 相邻卡片：⌃B 一步跨过 → 探针落在两卡之前（M447） | full |
| 142 | `142-harness-composer-nav-no-rerender` | composer 导航不是编辑：文本不变、不成撤销步（M447） | full |
| 143 | `143-harness-composer-nav-delete-family` | composer 删除族按整卡：⌃H / ⌃D 删掉整张卡片（M447） | full |
| 144 | `144-harness-composer-alt-backspace` | composer ⌥⌫ 是词级删除（面板让位生效）、裸 Backspace 不变（M447） | full |
| 145 | `145-harness-composer-kill-yank` | kill 槽跨面共用：编辑器 ⌃K → composer ⌃Y（M447） | full |
| 146 | `146-harness-composer-extend` | composer 扩选族：⌃⇧B 扩选后 ⌃H 删整段选区（anchor 不动，M447） | full |
| 147 | `147-harness-composer-family-outside` | composer 族外键（⌥G / ⌃V / Tab）不回退（M447） | full |
| 148 | `148-harness-image-mention` | composer 图片编号与 @ 引用：卡片编号 = 投递标签同源 + 留存文本面无标签 + 恢复后编号一致 + 移除位序重编 | full |
| 150 | `150-harness-composer-line-start-and-caret-geometry` | composer 卡片后空行：⌃B 落前一行行末 + ⌃A 回行首（M457） | full |
| 151 | `151-harness-approval-reason` | 批准卡判定依据行（M459）：危险黑名单 / 模式默认分层 / deny 规则原文三类拦截各说得出理由（mock provider） | full |
| 152 | `152-harness-transcript-link-and-time` | harness transcript：裸 URL 在段落与表格里上屏为链接、恢复重放的消息带时间读数 | full |
| 153 | `153-ordered-list-auto-mode` | 列表自动模式三态（M461）——「1. + 空格」进入列表编辑、Enter 续行、空项 Enter 退出；IME 组合期不重复的英文路径对照 | full |
| 154 | `154-harness-composer-prev-line-end` | composer 末段空行行首 ⌃B 落上一行行末（M465，HC4 第 1 条） | full |
| 155 | `155-harness-ctxpop-tokens` | Harness 气泡读数：上下文已用/上限 tokens（k/m 单位）+ 会话命中率（只百分比）；本回合 / 写入行不渲染；空会话无假读数 | full |
| 156 | `156-harness-composer-ime-composition-freeze` | composer IME 组合期结构冻结（M527，HC5）：第二行中文组合不折回第一行——手动复验 | evidence |
| 158 | `158-ordered-list-enter-no-duplicate-marker` | 有序列表行末 Enter 单 marker（M529）——真实列表项续行只出一个新序号、无「2. 3.」重复形态 | full |
| 159 | `159-filetree-drag-move` | 文件树拖拽移动——拖文件入目录、拖目录入目录、撞名拒绝三态（人话提示 / 源不变 / 目标不变）、拖入自身子树与文件行均不可落、拖到 vault 名行 / 列表尾部空白落根 | core |
| 163 | `163-harness-auto-title-first-turn`<br>`163b-harness-quote-first-title` | 会话自动命名①：首轮完成后生成标题（标题栏 + 历史浮层行名 + JSONL decision=initial）<br>会话自动命名②：quote 首条消息 → 命名事件 → 标题栏与已开历史浮层行同步改名 | full<br>full |
| 164 | `164-harness-auto-title-keep` | 会话自动命名②：周期重估输出 keep 时标题不变（5 轮周期 + decision=keep 记录） | full |
| 165 | `165-harness-auto-title-legacy-fallback` | 会话自动命名③：无标题记录的旧会话文件安静回落首条用户消息（不告警、不改写） | full |
| 166 | `166-harness-auto-title-off` | 会话自动命名④：sessionNaming.enabled=false 时不发起调用、不写标题记录（会话名走回落口径） | full |
| 167 | `167-harness-auto-title-provider-fallback` | 会话自动命名⑤：sessionNaming.provider 非法值回落会话 provider（启动不失败，命名调用仍走 mock） | full |
| 169 | `169-cron-notify-trigger` | cron 到点通知：notify-then-run 只投通知、不写 vault、未点击不花 token（change add-cron-runtime-daemon §7.1） | full |
| 170 | `170-cron-click-run` | 点击通知发起运行：click = intent（通知中心 AXPress 点横幅；§7.2） | bundle |
| 171 | `171-cron-run-then-notify` | run-then-notify：到点静默运行、终态后投递结果通知、点击结果通知恢复会话（§7.3） | bundle |
| 172 | `172-cron-silent-run` | silent-run：静默运行、全程零通知、会话留存可查（§7.4） | full |
| 173 | `173-cron-invalid-task` | 配置非法项只丢弃该项：at=25:00 落 cron_task_invalid、合法任务照常触发（§7.5） | full |
| 174 | `174-cron-daily-dedup` | 当日去重：通知一次后重启 + 多次切前台不再投递（§7.6） | full |
| 175 | `175-cron-approval-abort` | 无人值守运行遇批准闸即中止（approval_required），不挂起、不放行（§3.5 / §6.4） | full |
| 207 | `207-cron-conversational-register` | 对话注册定时任务：批准卡（任务要素）→ 采纳落盘 → 注册即生效 → 过点通知、未点击零运行（tasks §8.1） | full |
| 208 | `208-cron-register-skip-today` | 注册日不补触发：已过点注册写当日种子，切前台 / 重启都不投递（tasks §8.2） | full |
| 209 | `209-cron-register-reject` | 拒绝注册不落盘：同一轮里另一条已采纳的任务必须在文件里（正观测）（tasks §8.3） | full |
| 210 | `210-cron-register-remove` | 对话删除任务：配置退场、cron_task_removed、到点不再通知（对照组照常响）（tasks §8.4） | full |
| 211 | `211-cron-register-duplicate` | 重名拒绝：cron_task_exists、配置逐字节不变、面板工具行显示错误摘要（tasks §8.5） | full |
| 212 | `212-cron-prompt-section` | 提示词段在场：新会话的 system 含「定时任务」段、session_open.assembly 有 cron_reference 条目（tasks §8.6） | full |
| 213 | `213-cron-startup-notification` | 冷启动即到点的「到点」通知必须真实出现在通知中心（M620） | bundle |
| 214 | `214-zoom-shared-two-panes` | 一套字号两个 pane：焦点在 composer 内按 ⌘= / ⌘0，编辑器内容字号同步放大 / 复位（M627） | full |
| 215 | `215-composer-select-all-and-tab-keys` | composer 全选（经同命令可达键）与 tab.prev / tab.next 的真机命令链路（M627） | full |
| 218 | `218-harness-bubble-and-scrollbar` | harness 用户气泡与代码块滚动条（M628）：三主题下消息与代码块同屏上屏、切主题不丢内容、截图证据 | full |
| 219 | `219-image-file-preview` | 左栏点开图片文件 → 内容区图片标签（M629）：查看面 / 双击放大 / ⌘S 无写入 / 重启恢复 / PDF 仍是 D25 | full |
| 220 | `220-sidebar-resize-hide-root-create` | 左栏拖宽 / ⌘B 收起 / vault 根右键新建（M631）：拖宽重启保持、收起不跨启动且焦点回到文档、根右键建文件自动打开与建目录不展开 | full |
| 222 | `222-image-quote-to-chat` | 图片摘录到对话：悬停引用钮 / 跨图选区 / 一次 ⌘Z / svg 栅格化引用 | full |
| 223 | `223-harness-block-fullscreen` | harness 面板里的代码块与表格全屏：hover 钮打开遮罩、内容只含该块、Esc 退出、焦点回到面板 | full |
| 224 | `224-harness-scroll-lock` | harness 流式输出期间的跟随滚动与回到底部（M644）：上滚后视口不被拽回、浮钮浮现/保持/退场 | core |
| 225 | `225-app-splash-screen` | 启动态：大 vault 冷启的首帧 / 撤下读数，与未打开终态的撤下原因 | full |
| 226 | `226-vault-remove` | vault 列表移除（M646）：当前项无移除入口 / 行内两步确认 / 只删注册表项 / 8s 撤销 | full |
| 227 | `227-fullscreen-select-esc` | 全屏遮罩内的选中动作不改变退出路径：遮罩内尝试 ⌘A 之后 Esc 仍关闭、焦点回编辑器、文档与磁盘零写入 | full |
| 228 | `228-caret-visibility` | 光标可见性——属性盒按下即进 YAML 源码（不再出现贯穿整块的竖线）、doc-title / 正文按下不改文档、光标 2px 且以约 1.2s 周期闪烁（light + eink 截图证据） | evidence |
| 229 | `229-harness-permission-rules` | 权限规则入口与包装器解包（change harness-permission-rules-oct23）：持久放行 / 删规则后重新问 / bash -lc 全只读免问 / 危险包装卡无次级动作（mock provider） | full |
| 231 | `231-harness-readonly-write-forms`<br>`231b-harness-hidden-write-refusal` | 只读白名单收紧：写形态进闸、执行形态在完全访问档仍问（change readonly-allowlist-tightening-oct23，mock provider）<br>hidden 档写入口拒绝（M656 前提）：vault_patch 指名 .git/config 被 fs_name_invalid 拒绝且文件逐字节不变（mock provider） | full<br>full |
| 232 | `232-quote-decode-error-copy` | 引用坏图：解码失败读 D588（不含「剪贴板」）+ 持久状态行、零卡片 | full |
| 233 | `233-semantic-selection-release-snap` | 双击粗体词松开后外扩到 `**…**` → 摘录卡片原文含定界符；文档逐字节不变 | core |
| 235 | `235-keybindings-lookup-query` | 键位速查——每命令一行的内容模型、文本查询（标签 / 别名 / id）、来由零命中与查询空态 | full |
| 236 | `236-keybindings-capture` | 键位速查——按键捕获（Home → 真实 when 绑定、被捕获的键不执行命令、⌃G 例外、无绑定空态） | full |
| 238 | `238-escape-overlay-close` | Escape 只收最上层浮层且永不退出应用（change fix-escape-overlay-close-oct24）：权限浮层重建失焦后按 Esc、修饰键准入、焦点回还 | full |
| 239 | `239-escape-quit-guard` | Escape 不削弱退出守卫（change fix-escape-overlay-close-oct24）：dirty 文档按 Esc 不退出且不弹提示、⌘Q 仍被拦下、保存后 ⌘Q 正常放行 | core |
| 250 | `250-settings-panel-provider-crud` | 设置面板：⌘, 打开、增删 provider、重复 id 被拒且文件不变、删除保护与空清单 | core |
| 251 | `251-settings-panel-legacy-preset-migration` | 设置面板：旧格式 provider（无 preset）首次启动补齐迁移，二次启动不再写盘（mtime 不变） | full |
| 252 | `49-vault-switch-feedback` | vault 切换的即时反馈（浮层收起 / 装载指示起止）与切换器浮层的完整可读 | full |
| 423 | `121-harness-message-excerpt` | harness 消息摘录 ① transcript 选区 → 浮动钮 → 卡片入 composer（+ 序列化结构 / 视口 skip / transcript 同构） | full |
| 531 | `160-quote-button-viewport-clamp` | 摘录浮动钮落点钳制：选区并集盒越出挂载容器（长行）时钮仍在视口内 | full |
| 552 | `161-harness-path-link`<br>`221-harness-path-line-range` | harness 输出里的 vault 路径可点击（新标签 + 行号锚定 + 卡片路径）<br>harness 输出里的行范围路径可点击（:起-止 落到起始行，畸形形态不吞半截） | full<br>full |
| 553 | `162-harness-dir-link` | harness 输出里的 vault 目录引用可点击（左栏定位） | full |
| 554 | `168-paste-image-semantic-name` | 贴图后异步语义改名 + 正文引用同步 + toast 撤销（change add-semantic-image-naming） | full |
| 655 | `230a-path-forms`<br>`230b-lazy-and-external-readonly`<br>`230c-restart-and-focus-scopes` | 按路径快速打开（⌘P）之一：深层路径一次 Enter 落文件 / 冒号文件名整串优先 / path:line 落点不重开 / vault 内零命中<br>按路径快速打开（⌘P）之二：索引外惰性文件按精确路径打开 / vault 外只读打开（⌘S 不写盘、键入不生效）/ 外部路径不存在按找不到处置<br>按路径快速打开（⌘P）之三：重启后 vault 外标签不回来、vault 内标签照常恢复、文件树与 harness composer 焦点下同样命中 | full<br>full<br>full |
| 702 | `231-quick-open-long-path-width`<br>`232-harness-ctxpop-width` | 快速打开浮层宽度：长路径下输入面按 26em 展开、路径全文仍在 AX 里<br>Context 气泡：长读数 hover 翻出、三段内容齐全且确实绘制（P 档 34em 上限；宽度数字归 chromium 矩阵） | full<br>full |
| 703 | `234-harness-table-horizontal-scroll` | harness 对话宽表：固有宽铺开、横向滚轮在表格区域执行、滚动前后截图（几何归 chromium 矩阵） | full |
