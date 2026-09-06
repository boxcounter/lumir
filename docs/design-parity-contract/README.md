# 原型—生产一致性验收契约（M62）

**结论：73af311 不通过最终验收。** 宽屏正文几何已接近原型，但阅读模式仍有明确视觉差异，窄窗几何和复制失败，真实新建 Thread 当前态不能重启恢复，内存门禁超阈。未更新任何既有视觉基线或容差。

## 依据与复跑

基线 `73af311`，`git merge-base --is-ancestor 73af311 HEAD` 成功。目标仅为冻结 `design/editorial/index.html` 与 `RATIONALE.md`，不从生产截图反推目标，不合并历史 `feat/editorial`。

- `scripts/visual/run.sh`：标准构建与全部 Chromium visual tests，包含本轮红色回归。
- `pnpm --dir tests/visual test scenes/parity.spec.ts scenes/parity-copy.spec.ts`：同 fixture 对照及真实键盘复制。
- `node scripts/visual/gallery.mjs`：将最近一次对照 PNG 复制到本目录。
- [打开成对截图](evidence/index.html)：15 组合、30 张图。左为冻结原型运行态，右为真实生产前端加 IPC stub。已用专用 Chrome for Testing 窗口实际观察三主题；并非只生成 PNG。

运行态只隐藏原型走查控制台；正文/报头/目录/Thread 内容由同一测试场景注入。原型正文仍是 `#doc` 内 `h1/p/h2`，首段必须保留 `p.dropcap`，导航保留 `tr-*`、Thread 保留 `thr-*` 类。示例文章的 kicker/byline 不在普通 Markdown fixture 中；本场景不验证这些不存在的内容。原型目录 kicker、footer 与生产切换/新建按钮是产品结构差异，未伪装一致。

几何断言用浏览器实测 rect，不以 CSS 声明值代替实际尺寸。软断言只允许收集多个差异，失败仍使 test 非零退出。默认视觉容差 `threshold=.2/maxDiffPixelRatio=.005` 不变。

## 差异矩阵

| 项目 | 源码依据 | Chromium | 真实 Tauri WKWebView |
|---|---|---|---|
| 1280×900 导航244、正文x522/w480、首行y101 | 原型110–115/236–237；生产style.css32–72/editor.ts146–155 | 三主题几何通过 | 实际观察居中阅读栏；未通过注入JS精确读取CSS坐标 |
| 1440×900、1200×700 | 同上 | 三主题几何通过 | 未逐视口测量 |
| 1000×600导航204 | 原型243–246；生产style.css73–76 | 失败：生产244，正文x382而非362 | 未测窄窗 |
| 640×480 | 同上 | 失败：生产nav243.1875/content x268w372；原型nav204/content x228w388 | 未测窄窗 |
| sheet 内报头、44px正文顶部间隔、panel无轨 | style.css41–72/editor.ts154 | 宽屏首行y101；panel hidden | 窗口实测看到报头与正文；系统titlebar未当作产品高度 |
| 目录27px、目录600、文件400/深层色 | 原型134–159；生产树CSS | 已加入27/600断言；长目录/逐深度颜色尚未全覆盖 | 单文件树打开成功；深层未测 |
| Thread 当前展开、其他紧凑、角色 | threads.ts60–105 | 成功：main/ref；切换后source；创建成功toast与失败保留输入 | 真创建成功，JSON落盘；显式切换后重启恢复当前成功 |
| 新建当前Thread恢复 | main.ts324；threads.rs226–255/264–283 | stub不宣称重启持久化 | **失败：新建UI为当前但未写current文件；重启列表有Thread，报头无当前Thread** |
| 阅读行号/activeLine | editor.ts158–182；preview/theme.ts8–10 | **存在，原型不存在** | **同样存在**，不是WK独有 |
| 段间距 | 原型p连续排印；生产源码空行仍占高度 | **空行造成明显段距，原型0段距** | 同样观察到 |
| Threads分区位置 | 原型nav-sec grow flex:0 1 auto；生产tree-pane flex:1 1 auto | **生产贴底，原型紧接目录** | 生产贴底 |
| 三主题 | 原型20–55；生产style.css1–16 | 15组合截图；色阶对照 | Cmd+T light→dark→eink，实际截图观察 |
| 长文与滚动 | editor/view单内核 | 当前未补完整1MB虚拟化场景 | 200段真实文件滚动到第159段，无白屏；未完成坐标往返断言 |
| 短段/code切换 | editor.ts94–102 | 打开short.md→source.ts→short.md通过；短段避让几何尚未断言 | 未测 |
| 复制与frontmatter | editor.ts185–187只读且不可编辑 | Cmd+A/C得到整个页面（含导航、行号、属性值）；不是源文 | 一次真实拖选后Cmd+C读clipboard为空，尚未排除工具焦点影响，不算通过 |

对短段 dropcap、多物理源码行、符号起首的限制不得用泛泛“渐进增强”豁免。本轮仅做短段打开与模式往返，未完成这些专项几何和复制断言。

## 平台隔离与真实后端证据

`src-tauri/src/config.rs:98–110` 在macOS读取 `XDG_CONFIG_HOME` 后追加 `/lumir`；threads/workspaces复用该路径。`tests/visual/tauri-isolated.json` 将 identifier 改成 `com.lumir.parity62`，窗口开启 `incognito:true`。现有 Tauri CLI schema 确认 incognito 可用；macOS dataDirectory 不受支持，因此不能靠它隔离。incognito不验证主题跨进程持久化。

```bash
node scripts/visual/prepare-isolated.mjs
TAURI_CONFIG="$(<tests/visual/tauri-isolated.json)" cargo build --manifest-path src-tauri/Cargo.toml --release --features custom-protocol
XDG_CONFIG_HOME="$PWD/tests/visual/runtime/config" src-tauri/target/release/lumir
```

专用进程71616创建“M62 持久化验收”，文件 `runtime/config/lumir/threads/1788689809-71616-452272000.json`。退出后71798恢复列表但丢失当前态。显式选择Thread后再次退出，71845恢复当前态成功。通过KimiCU实际打开正文、切主题、滚动与观察。所有专用Tauri窗口已退出，未操作用户vault/config。真实窗口总尺寸1280×900，含原生标题栏；不把它误称为1280×900 CSS viewport。

上述是实际Tauri使用系统WKWebView，不是Playwright WebKit。`tauri-stub.ts`仅模拟IPC JSON契约与错误信封，不实现磁盘持久化/文件选择器/真实watch。新增ThreadFile fixture包括vault_id，vault返回包括vault_id/remap_candidates；thread_create不会冒充后端保存current。

## 门禁结果

- `pnpm build`：通过；Vite既有 >500KB chunk警告保留。
- `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test`：通过；47单元+2索引+10Thread+4wikilink测试。
- `cargo build --release --features custom-protocol`：通过；另编译隔离配置成功。
- 初始标准visual：9 tests，6 pass/3截图fail。app-main19718、filetree15252、wikilink12939像素差；不重录成绿。
- 最终标准全量visual：29 tests，18 pass/11 fail（3既有截图、6窄窗、2复制）；目录27px/600新增断言通过。完整日志见 [standard-visual.log](evidence/standard-visual.log)。
- 现有perf脚本全部实跑：cold-start p95 180.64ms；open1MB纯IO p95 .45ms；keypress median10.00ms（Blink/CDP下界，不是系统输入延迟）；memory max218.50MB，**超过200MB门槛**。
- perf相对滚动基线缺失，脚本默认警告并跳过。不能把缺基线称为相对回归通过。内存归因仍是既有RSS合计法，本机非独占CI，报告不消除该口径限制。隔离incognito构建也不是默认用户数据存储配置，性能不能外推默认存储冷启动。

## 历史审计与未完成项

M58 correction summary 位于主仓协议目录，不在本worker允许读取范围。已请求tower通过协议转发，写本文时未收到。**未宣称继承并完成M58逐项纠正。** 源码报告仅是候选事实；本轮将曾误报的“WK独有gutter”纠正为Chromium与WK均有。

历史“frontmatter顺序加载只复制属性值”没有在本轮严格复现成同一结果。本轮真实Cmd+A/C得到整个页面；准确重现见 `parity-copy.spec.ts`。应继续做内容区域原生拖选与源码映射，不把两者混写。相关产品问题已通过TowerFinding转交：窄视口、阅读装饰/段距/Threads位置、新建当前态、复制。

剩余：完整长目录/深层颜色矩阵、长文虚拟化与真实坐标往返、短段dropcap/符号起首/多物理行专项、WK窄窗口及复制、M58审计继承。因为产品缺陷与门禁红，M62保持未完成；本制品是可复跑失败证据，不是批准交付。
