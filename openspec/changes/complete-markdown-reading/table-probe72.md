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

## 恢复与后续

最小外部条件是：自有 TableProbe72 窗口正文可见，kimi-cu 能获取真实 WebArea/控件与操作回读。若需用户手动展示该自有窗口，应由 tower 协调；不操作真实 vault。

恢复后先完成最小表格几何与空槽，再验证大表中部虚拟化；若发现公开路线结构性失败，按 design34 停止扩展并另送设计修订。通过全部前置门槛后才提出 `src/preview/tables.ts` 纯模型/公开扩展、`livePreview.ts` 排除表内重复消费、`theme.ts` 局部样式、tests/visual 行为几何的生产拆分。该拆分当前仅为候选，不是实施授权或完成证据。
