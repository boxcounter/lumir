# Proposal: 粘贴剪贴板图片（落盘 vault + 插入引用）

- Change ID: paste-clipboard-image
- 日期: 2026-10-09
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：**2026-10-10 Alex 裁决**：① 落盘位置**选 B = 当前笔记同目录**
> （原话「B. 当前笔记同目录」；A 作废留档）；② 插入语法 `![[文件名]]`、③ 内容哈希命名、
> ④ 图文同板图优先——三点**按起草倾向 A 定案**；另推翻「不转码」非目标（原话：「格式
> 需要转码，我依稀记得 macOS 下通过系统自带截图工具截取到剪贴板里的图片会很大，经常
> 十几兆二十几兆」，附剪贴板工具截图实证 Image 1280x960 **18.8MB** / 786x667 8.0MB）——
> 修订版新增转码设计（design §4：WebP 无损为默认），哈希改以**转码后字节**计算。
> r1 评审两处 P2（虚构 mkdir-p 先例、「全文无」字面不实）已于 8bc0407..a4fcfdb 修正。
> 节点 2（归档评审）：**2026-10-10 Alex 点头归档**（原话见同批 `add-harness-permission-modes` 的节点 2 记录）。归档对账（M418）：
> tasks 14/14 已勾（实现 M415 探针 / M416 后端写原语与前端链路）；delta 一处措辞改准——
> 「转码目标扩展名映射表收进 `src/preview/attachments.ts` 的既有 MIME 注册表」与实现不符：
> 映射的唯一真源在后端 `fs_io::attachment_target`，`attachments.ts` 的注册表只承担渲染侧
> 「扩展名 → MIME」方向，已按实现改准；实现侧零改动。

## Why

Alex 原话（2026-10-09）：**「支持黏贴剪贴板里的图片」**。真实场景：在编辑器里写笔记时把截图
（报错现场、界面参考、设计稿片段）直接 ⌘V 进文档——当前做不到，图片数据被静默丢弃。

### 现状盘点（只读结论，均已对着代码坐实）

1. **编辑器链路没有任何粘贴/剪贴板/拖入处理**：编辑器侧无 clipboard/paste/drop 处理器
   （`src/editor.ts` 唯一的 paste 提及是 readOnly 拒收注释，`src/editor.ts:1734`；
   拖入零命中）。`src/harness-panel.ts:3874,3888` 的 paste/drop 监听属 harness 测试面板
   composer 的输入框净化，与编辑器链路无关，不在本能力射程。
   今天往编辑器 ⌘V 一张截图：CodeMirror 默认粘贴只取文本，图片数据被丢弃，用户无感知。
2. **渲染侧两种语法都已完整支持**：标准 `![alt](path)` 与 Obsidian 方言 `![[name.png]]` 都经
   `ImageWidget` 内联渲染（`src/preview/attachments.ts:427`；living spec `attachment-display`），
   含可见回退不变量、lightbox、尺寸预留。方言的解析口径已落 spec：不带目录前缀的 `![[...]]`
   按 **vault 内文件名唯一匹配**解析（`resolveByName`，`src/preview/attachments.ts:248`；
   `resolveByNameUnique` 同名歧义按路径字典序确定性取第一个）——**与笔记所在目录深度无关**。
3. **fs-io 只有二进制读、没有二进制写**：`fs_io.rs` 的公开函数里写路径只有文本类
   （`save_document` / `fs_patch_file` / `vault_create_file`），命令面只有 `fs_read_attachment`
   一件二进制件（`src-tauri/src/lib.rs:83`）。落盘需要新增一件对称的原语。
4. **命名所需的件已在后端侧**：内容哈希用 `sha2` crate（已在 Cargo 依赖内，
   `src-tauri/Cargo.toml`）；解码/重编码用 `image` crate（新增依赖，纯 Rust，自带无损
   WebP 编码器）。去重探测（全 vault 同名）在 `fs_write_attachment` 内一并完成。
5. **既有可沿用的口径**：50MB 附件上限（读侧，fs-io「二进制附件读取」）、`resolve_in_vault`
   路径约束、原子写（`.lumir-{pid}` 临时文件 + rename，`fs_io.rs:1201`）、文件内容 SHA-256
   先例（`fs_file_revision`，`fs_io.rs:1145`）。
6. **vault 内没有「附件目录」约定**：`src/` 对 `attachments/` 零命中，附件就是散在 vault 各处的
   图片文件、靠文件名匹配找到。落盘位置原无约定，节点 1 已裁定为**当前笔记同目录**
   （裁决点 ① B）。
7. **WKWebView 粘贴通道形态**（经验判断，**未在本仓真机实测**）：macOS WKWebView 的 DOM
   `paste` 事件经标准 `ClipboardEvent.clipboardData` 暴露剪贴板数据，截图类内容以
   `kind: "file"`、`type: "image/png"`（或 tiff/heic）的 item 出现——Safari 即 WKWebView、
   向 web 编辑器贴图是多年稳定行为。design §2 把「真机探针坐实 MIME 集合」列为实现期
   第一项任务；若形态不符，按升级线上报，不猜。

### 结论

渲染侧零新增（`attachment-display` 全包），缺的是「编辑器粘贴拦截 → 字节落盘 → 插入引用」
这条编辑通道，以及 fs-io 一件二进制写原语。范围可控，单 change 可交付。

## What Changes

每条对应 `specs/` 增量中的一个 requirement（delta 见 `specs/fs-io/spec.md` 与
`specs/clipboard-image-paste/spec.md`）：

1. **fs-io 二进制附件写入**（fs-io，ADDED「二进制附件写入」）：新增命令
   `fs_write_attachment(dir_rel, data_base64, source_mime)`——**命名与转码收进后端**：
   按 `source_mime` 解码剪贴板字节（50MB 输入上限，沿用读侧口径）、转码为目标格式
   （默认 WebP 无损，design §4）、以**转码后字节**计算内容哈希生成
   `pasted-<hash16>.<目标扩展名>`、`resolve_in_vault` 路径约束、同目录临时文件 + rename
   原子写、目标已存在 MUST NOT 覆盖（同名即同内容，撞名按去重命中收敛）。返回最终
   vault 相对路径与文件名。落盘目录由前端传入（当前笔记同目录；无路径文档传 vault 根），
   目录必然已存在，**不涉及隐式建目录**（原「自动建父目录」分叉随裁决 ① B 整体消失）。
2. **粘贴触发与引用插入**（clipboard-image-paste，ADDED「粘贴触发与引用插入」）：md 模式且
   可编辑时，⌘V 到达且剪贴板含 `image/*` 数据 → 阻止默认粘贴、异步落盘、在光标处插入
   `![[文件名]]` 引用（裁决点 ② 已定 A）。插入是正常编辑事务（用户发起的
   文档修改），经 CM dispatch 走文档保存链路，与键入同权。
3. **落盘位置与命名去重**（clipboard-image-paste，ADDED「落盘与命名去重」）：落盘到
   **当前笔记所在目录**（裁决点 ① 已定 B；无路径的新建文档落 vault 根）；内容哈希命名
   （裁决点 ③ 已定 A），哈希以**转码后字节**计；去重口径：全 vault 已有同名文件即跳过
   写盘只插引用（内容寻址保证同名同内容）。
4. **非图片剪贴板降级**（clipboard-image-paste，ADDED「非图片剪贴板降级」）：剪贴板无
   `image/*` 数据时粘贴行为与现状逐字节一致（CodeMirror 默认文本粘贴），本能力 MUST NOT
   改变任何现有粘贴行为。
5. **失败反馈**（clipboard-image-paste，ADDED「失败反馈」）：落盘失败（写错误、超限、
   转码失败、非受支持格式）SHALL 给人话 toast（文案走 `文案-Copy.md` deck 新键），
   MUST NOT 静默失败、MUST NOT 插入引用后留破图。
6. **转码**（clipboard-image-paste，ADDED「转码压缩」；**Alex 节点 1 新增需求，推翻原
   「不转码」非目标**）：剪贴板图片字节原样可能巨大（Alex 实证：1280×960 逻辑尺寸的
   Retina 截图在剪贴板达 18.8MB——物理像素 2560×1920 的无损 RGBA），系统 SHALL 转码
   压缩后落盘。默认 **WebP 无损**（截图含文字，有损 JPEG 不适合；WebP 无损体积约为
   PNG 的三至六成、文字逐像素保真；依赖 `image` crate 纯 Rust 无损 WebP 编码器，
   零 C 依赖；WKWebView 自 Safari 14/macOS 11 起原生解码）。目标格式与压缩策略的
   完整权衡见 design §4；质量档位/有损选项首版不开放配置。

## Alex 裁决点

**节点 1 已于 2026-10-10 裁决落定**（见文首评审记录）：① 选 B；②③④ 按倾向 A 定案。
下表保留全部选项作留档（含被否方案的理由），供节点 2 对账与将来重启参考；**无需再裁**。

| # | 裁决点 | 选项 | 结果 |
|---|---|---|---|
| 1 | **落盘位置** | A. vault 根下固定 `attachments/` 目录（不存在自动创建）；B. 当前笔记同目录；C. vault 根平铺 | **裁定 B**（Alex 原话「B. 当前笔记同目录」）。A 作废留档：其核心理由「`![[...]]` 组合后与笔记目录深度无关」在 B 下换形仍然成立——`![[...]]` 是 vault 全局文件名唯一匹配，插入文本本身不含任何目录（Obsidian 即此形态），笔记搬家/目录重组时引用不断；内容哈希命名使「同名 ⇒ 同内容」，vault 全局匹配下的同名歧义实际被消除（不同内容的图片永不重名）。未保存新文档（尚无目录）落 vault 根（design §5）。C 未采纳：污染根目录 |
| 2 | **插入语法** | A. Obsidian 方言 `![[name.png]]`；B. 标准 `![alt](../attachments/name.png)` 相对路径 | **已定 A**：渲染与 vault 内文件名唯一匹配解析**今天已存在且是 living spec**（盘点第 2 条），零新增渲染面；B 需要算相对路径（深度相关），无谓引入 |
| 3 | **命名规则** | A. 内容哈希：`pasted-<sha256 前 16 位>.<ext>`；B. 时间戳：`Pasted image 20261009143022.png`（Obsidian 默认形态）；C. 剪贴板原始文件名 | **已定 A**，哈希以**转码后字节**计算（转码为 Alex 节点 1 新增需求）：同名即同内容，去重天然、不依赖时钟；仓内已有文件内容 SHA-256 的消费先例（`fs_file_revision`）。B 直观但同图堆副本；C 在 macOS 截图场景通常没有原始文件名 |
| 4 | **图文同板优先级**（剪贴板同时含文本与图片，如浏览器里复制图片） | A. 图片优先（Obsidian 同款）；B. 文本优先 | **已定 A**：进笔记工具贴图的动作意图就是图；Alex 的场景（贴截图）剪贴板只有图片数据，此项主要给「浏览器复制图片」形态定调 |

> **节点 1 追加需求：转码。** Alex 推翻原「不转码」非目标（原话见评审记录），理由是
> macOS 系统截图进剪贴板的字节巨大（18.8MB 实证）。落法见 What Changes 6 与 design §4：
> 默认 WebP 无损，哈希以转码后字节计。原「自动建父目录是对既有口径的刻意分叉」注随
> 裁决 ① B 整体消失（落盘目录恒为已存在的笔记目录或 vault 根）——不留死注。

### 沿用既有约定，无需裁决（明示清单）

- **字节通道**：invoke + base64（`fs_read_attachment` 同款形态，写侧对称新增）——ADR 0002 §3
  （webview 不直接访问文件系统）。
- **路径安全**：`resolve_in_vault` 全量逃逸防护，MUST NOT 由前端自觉保证。
- **大小上限**：50MB，沿用读侧口径（超限人话错误，护住常驻内存合同 ADR 0002 §6）。
- **原子写**：同目录 `.lumir-{pid}` 临时文件 + rename；写结果不可确认时报错，不报成功。
- **渲染、占位、lightbox、尺寸预留**：`attachment-display` living spec 全包，本 change 零改动。
- **落盘后的文件树/watch 联动**：走既有 watch 增量事件流（与 app 内新建文件同路），无新口径。
- **非图片剪贴板行为**：CodeMirror 默认粘贴，逐字节不变（写入 spec 条款）。
- **失败文案**：toast + `文案-Copy.md` deck 新键（不另起文案体系）。
- **code/text 模式编辑器不触发**：图片语法只属 md 模式，非 md 模式维持现状（无文件上下文
  的纯编辑态同理可贴——落盘目录无当前文件时退 vault 根，见 design §5）。

## Non-goals

- **远程图片 URL**：粘贴含图片 URL 的文本照旧粘贴文本；不做「识别 URL 并下载落盘」。
- **拖拽文件入编辑器**：不做。文件树已有打开/展示通道，编辑器拖入是另一条交互面；若将来要做，
  建议单独立项并与本 change 的落盘/命名约定复用。
- **转码的进一步档位**（节点 1 已把「转码本身」拉进范围，以下仍不做）：有损压缩档
  （WebP q90 等）与质量参数**首版不开放配置**——固定 WebP 无损一档，dogfood 后嫌大再评
  有损档（不留假开关，REVIEW.md 第 9 条）；分辨率降采样不做（Retina 物理像素原样保留，
  体积问题由无损压缩解决）；`image/heic` 等系统私有格式的解码转码不承诺（WKWebView
  paste 事件按 W3C 规范暴露 `image/png`，剪贴板原始 TIFF 由 WebKit 归一化，见 design §4）。
- **多图剪贴板**：只取第一张 `image/*`（截图场景天然单图；多图队列无真实需求）。
- **粘贴附件（pdf 等非图片文件）**：不做；MIME 非 `image/*` 的剪贴板 file 项不拦截
  （维持默认行为）。
- **「另存为 / 插入已有图片」对话框**：不做——插入引用现有路径是后续增强，不在本包。
- **Windows/Linux 剪贴板形态差异**：macOS（WKWebView）为准；跨平台适配将来按实测补。

## Impact

- 影响的 specs：`fs-io`（ADDED ×1：二进制附件写入——签名与命名/转码职责按修订版）；**新
  capability** `clipboard-image-paste`（ADDED ×5：粘贴触发与引用插入 / 落盘与命名去重 /
  非图片剪贴板降级 / 失败反馈 / **转码压缩**——最后一条为节点 1 追加）。
  `attachment-display` 零改动（渲染侧已全覆盖，`webp` 已在 image 分类注册表内）。
- 影响的代码/系统：src-tauri（`fs_io.rs` `fs_write_attachment` 原语——解码、转码
  （新增 `image` crate 依赖，纯 Rust）、内容寻址命名（`sha2` 已在依赖内）、原子写 +
  命令注册 + `src/bindings/` ts-rs 重导出）；src（`editor.ts` 粘贴拦截与插入事务、
  toast 接线、`ipc.ts`——hash 与去重探测移后端，前端不再调 `fs_paths_exist`）；
  `文案-Copy.md`（deck 新键）。
- 影响的验收：`scripts/acceptance/` 新增真机场景（草案见 design §7，合成 fixture、
  剪贴板置图走 AppleScript 标准通道；S2 去重断言按全 vault 同名口径改写）；视觉场景
  零新增（两种引用语法的渲染断言既有场景已覆盖，新增 webp fixture 的合成图渲染可走
  既有 markdown-combo 场景扩样）。
- 关联约束：ADR 0002 §3（invoke+base64，webview 不触盘）、ADR 0002 §6（50MB 上限护内存
  合同；粘贴落盘不在键入路径上做同步 IO）、ADR 0003 §3（装饰层不改写源文件——本能力的
  文档修改是用户发起的编辑事务，不经装饰层）、REVIEW.md 第 8 条（目标格式↔扩展名映射
  只收进 `attachments.ts` 既有注册表，不另立表）、REVIEW.md 第 9 条（质量档位不留假开关）、
  REVIEW.md 第 21 条（零读者场景直接切断，不留兼容/过渡层）、仓库信息卫生（验收 fixture
  合成，剪贴板置图用合成 png）。
