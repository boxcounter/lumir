# M72 前置实验记录（2026-09-06）

## 结论

**Blocked，不是 BlockWrapper 可行性通过，也不是路线失败。** 不进入完整表格实现，不勾 tasks 1.3 或节点 2。当前无法通过 GUI 观察真实隔离 WK 的文档区域，不能执行真实选择复制/横滚验收。无需以此改写产品 spec；环境恢复后继续原设计前置门槛。

## 实验与复现

- `scripts/visual/table-probe72/` 为独立最小 Tauri runner，identifier `com.lumir.tableprobe72`，两个 incognito 窗口，无生产命令、无 vault/config 读写入口。XDG_CONFIG_HOME 指向自身 runtime。无用户剪贴板读写。
- `bash scripts/visual/table-probe72/run.sh` 构建固定锁文件对应依赖后运行；构建产物/运行日志均在该目录 ignored target/dist/runtime。需要先 `pnpm install --frozen-lockfile`。
- `fixture.ts` 固定 430 字符小文档（对齐、空格空槽、转义 pipe、引用/列表内表格、无首尾 pipe、非矩形、只读任务源码）和 1,058,760 字符单表（14,001 表头/数据行）。`model.test.ts` 另覆盖相邻 pipe 零宽槽和反引号内未转义 pipe。
- `probe.ts` 只使用公开 BlockWrapper/line/mark/非跨行 replace/inline widget/visibleRanges。没有直接改 CM 管理 DOM，没有整表 widget、依赖 patch 或生产接线。
- 固定 240px 共享列尺寸仅用于布局压力实验，不是生产列宽策略。模型同步解析全量自有 fixture，不能用于生产；Node 本轮大表元数据约 96.7ms，未声称满足性能门禁。生产仍需设计中 parser 增量/缓存边界。
- Small/Large/Middle/Top/Narrow/Measure 提供人工布局检查；Partial/Table/Cross/All 仅设置原文选区，真实 Cmd+C 后应粘贴自有纯文本 receiver 再 Check paste。按钮设置选区不是鼠标/键盘选择验收。Focus table/editor 用于焦点检查。目前这些 GUI 操作未验收。
- `public/static.html` 为同进程无 CodeMirror、无 JS module、无样式文件的静态对照。

## 真实 WK 观察

运行 `custom-protocol` debug 二进制，观察 PID 14344（临时进程号，复现时不同）。两个 URL 均触发 on_page_load Started/Finished：`tauri://localhost` 与 `tauri://localhost/static.html`。

公开 `webview.eval` 只读回传显示：

- 静态对照正文包含 `Static control sentinel72`，尺寸 604 × 169.15625 CSS px，innerWidth/Height 620 × 328。
- 实验正文包含所有按钮、CM 源文与装饰单元格，尺寸 896 × 633 CSS px，innerWidth/Height 920 × 748。
- 两者 `document.visibilityState` 均为 `hidden`，`document.hasFocus()` 为 false。
- kimi-cu `get_app_state(pid=14344)` 截图为原生标题栏下全白；AX 仅 16 项应用菜单，无 WebArea/正文。返回的双窗口目录均为 window_id=0、尺寸0。此前单窗口多次同结果；后台 Tab 与点击未恢复可见正文。

原始自有文档诊断保存在 [table-probe72-native.log](table-probe72-native.log)。截图只在当次 kimi-cu 工具回执中，未通过其他截图工具另抓。此记录不把 DOM 内容存在当作可见渲染、可访问语义或真实输入成功的证据。

这排除了「CM 模块完全没有执行」的解释。**尚未证实原生窗口/AX/合成绘制的根因**，不能把 visibility hidden 当作唯一原因。未改系统安全设置、未重启用户服务、未用前台激活绕过工具约束。M70 独立报告相同白屏现象，但本结论仅依赖本实验自有证据。

## 验证边界

已完成：节点1三项实际裁决记录；现有 parser 范围测试 4/4；fixture Vite 构建；独立 Tauri `--features custom-protocol --offline` 构建；实验严格 TypeScript 检查；`pnpm build`；原有 visual 44/44；OpenSpec strict 10/10。视觉子项目需 `pnpm --dir tests/visual install --ignore-workspace --frozen-lockfile` 安装其现有锁文件。没有修改锁定生产依赖或原有 tests。

未验证：真实可见列边界/空槽/行高、虚拟滚动中部、宽/窄与resize、最右列键盘/触控板可达、焦点进出、AX 表语义、鼠标/键盘局部/整表/跨表选择、Cmd+A/C 与纯文本粘贴、输入/剪切/粘贴/Delete/任务点击只读防护、真实 Markdown 文件打开及磁盘前后比对、三主题、1MB 多表和既有四项性能测量。没有用编译或 Node parser 成功替代这些验收。

## r1 后只读复核（准确观测时间）

针对 reviewer-tableprobe72 对 `8a326a9` 的 r1 `p2-1items / hold`，补充当前会话事实：

- 2026-09-06T23:16:35.960449+08:00（UTC 15:16:35.960449），`ioreg -a -r -d 1 -c IOResources` 的 IOConsoleUsers 经 plist 解析并仅输出三个状态字段：`CGSSessionScreenIsLocked=True`、`kCGSSessionOnConsoleKey=True`、`kCGSessionLoginDoneKey=True`。**该时刻锁屏已证实。** 未保存用户名、会话标识等无关字段。
- 2026-09-06T23:16:24.121742+08:00，`ps -axo pid=,comm=` 按命令路径末尾 `/table-probe72` 过滤结果为空；当前 probe 进程已退出，包括此前 PID14344。没有为本轮文档修订重新启动 GUI。
- 同时只读确认现有 `scripts/visual/table-probe72/target/debug/table-probe72` 存在，SHA-256 为 `cc20abeddfa85c9de57b836016e757a7a78b9ee8d0b016fc3573e9f0aee3366a`。自有 runtime/native.log 和已提交诊断日志保留，未删除现有 binary/runtime。

这些是后续时刻的当前状态证据，**不能追溯证明 PID14344 或此前所有白屏唯一由锁屏引起**。历史 native.log 没有精确墙钟时间，不补造时间戳。静态对照仍只排除 CM-only 假设；原生窗口历史白屏的唯一根因未证实。

## 恢复与后续

等待用户正常解锁会话。不执行解锁、唤醒用户、修改安全策略或重启服务，不重复构建或启动 GUI 排障。已通过 TowerSend 通知 worker-lists73 与 worker-paragraph70 当前锁屏事实，要求避免重复诊断。

正常会话恢复后先复用现有 custom-protocol 二进制，无须运行会重建的 `run.sh`。以下命令仅为恢复步骤，本轮未执行；从 wt-72 根目录启动，创建新的自有 runtime/XDG_CONFIG_HOME/native.log，保留此前记录：

```bash
root="$PWD"
binary="$root/scripts/visual/table-probe72/target/debug/table-probe72"
test -x "$binary"
run="$(mktemp -d "$root/scripts/visual/table-probe72/runtime/run-XXXXXX")"
mkdir -p "$run/config"
date -Iseconds > "$run/started-at.txt"
XDG_CONFIG_HOME="$run/config" "$binary" > "$run/native.log" 2>&1
```

1. 先用静态对照核实正文可见、窗口身份和尺寸、document visibility 与 AX WebArea/控件及操作回读。现有 binary 同时创建静态与 CM 窗口，但验收顺序先静态；若静态仍不可见，保持 blocked，不反复重建。
2. 静态通过后再做 CM 小表列宽/空槽、宽窄/resize、宽表键盘及触控板横滚与焦点进出，再验证大表滚入中部虚拟化和列规则稳定。
3. 接着完成真实鼠标/键盘局部/整表/跨表选择、Cmd+A/C 到自有纯文本接收端、只读内存与自有 Markdown 磁盘前后比对等既有门槛。不用 headless、DOM 内容或编译通过顶替真实 WK 验收；不勾未测项。

若发现公开路线结构性失败，按 design34 停止扩展并另送设计修订。全部前置门槛通过前不实施生产表格；通过后才提出 `src/preview/tables.ts` 纯模型/公开扩展、`livePreview.ts` 排除表内重复消费、`theme.ts` 局部样式、tests/visual 行为几何的生产拆分。该拆分当前仅为候选，不是完成证据。

## 2026-09-07 用户解锁后恢复尝试

用户明确告知已解锁后，于 07:16:53+08:00 校验既有 binary，SHA-256 仍为上述 `cc20abed…3366a`。未重建，使用新自有 `runtime/run-vyauyW` 与 XDG_CONFIG_HOME 启动 PID26790。启动时间及原始页面诊断见 [table-probe72-resumed.log](table-probe72-resumed.log)。

- 07:18:06.134030+08:00 只读 `ioreg` 复核返回 `kCGSSessionOnConsoleKey=True`、`kCGSessionLoginDoneKey=True`，本次 IOConsoleUsers 没有 `CGSSessionScreenIsLocked` 字段。不把字段缺失捏造为显式 false。
- kimi-cu 已能识别真实 AXStandardWindow：static window_id24851、620×360；CM window_id24850、920×780。与此前锁定时 window_id0 不同。
- 静态对照及 CM 截图的正文仍全白，AX 只含原生窗口按钮/标题与菜单，没有 WebArea。静态页面连无 CM 的标题/按钮正文也不可见。原始日志显示两页均 Finished、DOM 内容与非零尺寸存在，仍为 `visibility=hidden`、`focus=false`。
- 因静态对照未通过，不执行后续几何、横滚、焦点、选择复制或磁盘只读验收。与 M73 协调的 clipboard 占用已释放，整个恢复尝试未读写任何 clipboard。

**恢复结果仍为 blocked。** 当前反例进一步说明不能只凭先前锁屏事实断言全部白屏的唯一原因，也不能据此宣告 BlockWrapper 路线失败。未修改生产、未采用全表 widget 或永久源码回退，没有把 r2 clean checkpoint 当作实验通过。

已向 tower 提议一个最小追加诊断条件：由用户自行展示自有 `TableProbe72 static control` 窗口，检查静态正文是否恢复。该操作尚未验证，agent 不通过激活/切换前台代做，不改系统安全配置或反复构建。若展示后仍失败，应先诊断原生静态窗口绘制；若恢复，应从静态可见/AX gate 开始，再按原顺序完成真实表格前置门槛。此为验收恢复步骤的补充，不是产品表格方案修订。

## 后续真实可见窗口与列布局定位

用户随后提供两张图片。本 worker 的工具实际没有 ReadMediaFile，委派的只读 agent 也确认不可用，故未声称已读附件；已请 tower 提供实际图片观察。以下证据来自其后重新调用 kimi-cu 的 live 窗口观察，不是对附件或用户操作过程的推测。

重新核实 ps 中 PID26790 存在后，static window24851 已真实显示黄色背景、`Static control sentinel72`、说明文字、按钮和 sentinel72 输入框，AX 有 WebArea/Heading/Button/TextField。同 PID 的 CM window24850 也有完整正文和 AX 表语义。未修改生命周期代码即恢复，尚不能从这些结果证明此前的唯一原因。

此时首次实际发现实验布局 bug：Measure 回读首表每行四个 cell 的 x 均为762、width240，截图四列竖叠在最右槽。为此仅修改 `probe.ts` 中 cell mark 的公开 style 属性，显式设置 `grid-column: i+1; grid-row:1`，不直接修改 CM DOM。为验证这个已观察到的具体 bug 执行一次 fixture Vite 与增量 Tauri locked/offline 构建，然后用新自有 runtime 启动 PID27418；不是为白屏反复重建。

修正后真实 WK Measure 结果：

- 小表表头与两数据行 x 均为42/282/522/762，四列各240 CSS px；中间空格槽仍占第二列。引用表前两列 x42/282。内存 doc unchanged=true。
- Large→Middle 按钮后屏幕显示 row7100 等中部行；文档1,058,760字符，viewport528870..529844，renderedRows/renderedLines均13，totalRows14001，未全量生成表DOM。中部四列 x42/282/522/762，各240px，高56px；metadata93ms，仍只是同步探针，不是生产性能通过。
- 切窄布局后普通正文栏保持窄宽度。但 Focus table 后 Right/End、一次水平 wheel 尚未观察到可信位移，未标通过。小表首 wrapper 高285px，行间仍有明显多余空隙；显式列定位没有解决所有隐藏替换的布局影响。
- Partial 按钮确实设置源码选区87..90，截图可见 `alp` 选中；这是公开API设置选区，不是人工鼠标选择或复制通过。

尚须继续诊断行内替换所产生的额外布局项、wrapper 的实际焦点/scroll事件及复制保护。零宽空槽 widget 尚未随本次非空 cell style 修正验证，不能将空格槽通过推广到零宽槽。M73 释放 clipboard 后进行一次受控复制：先写自有 `M72_SENTINEL_OWN_20260907`，对已显示87..90的选区发送后台 Cmd+C，随后仅布尔比较是否为预期 `alp` 或自有 sentinel，两者均 false。未输出实际内容，立即停止后续未知 clipboard 读取/粘贴并通过 TowerSend 释放占用；不能宣称复制成功，也不能确定是CM映射失败还是后台事件/其他clipboard写入因素。静态显示阻塞已解除，但前置验收仍未完整通过，不做生产实施或全表 widget 替代。
