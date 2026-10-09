# Proposal: 粘贴剪贴板图片（落盘 vault + 插入引用）

- Change ID: paste-clipboard-image
- 日期: 2026-10-09
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

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
4. **去重探测的件已存在**：批量存在探测命令 `fs_paths_exist`（`src-tauri/src/lib.rs:81`）。
5. **既有可沿用的口径**：50MB 附件上限（读侧，fs-io「二进制附件读取」）、`resolve_in_vault`
   路径约束、原子写（`.lumir-{pid}` 临时文件 + rename，`fs_io.rs:1201`）、文件内容 SHA-256
   先例（`fs_file_revision`，`fs_io.rs:1145`）。
6. **「自动建父目录」不是既有口径，是刻意分叉**：fs-io living spec「新建文档」现行条款写明
   「父目录 MUST NOT 被隐式创建，不存在时返回 `fs_not_found`」；生产代码 `vault_create_file`
   路径上亦无父目录创建。本提案的附件写自动建缺失父目录**是对该口径的刻意分叉**（理由与
   去向见「Alex 裁决点」节下注）——同在未合并 change `add-harness-permission-modes` 里
   Alex 已批准的「vault_create 自动建缺失父目录」修订同向，但那个 change 尚未合并/归档，
   **不构成既有先例**。
7. **vault 内没有「附件目录」约定**：`src/` 对 `attachments/` 零命中，附件就是散在 vault 各处的
   图片文件、靠文件名匹配找到。落盘位置是真空，需要新约定。
8. **WKWebView 粘贴通道形态**（经验判断，**未在本仓真机实测**）：macOS WKWebView 的 DOM
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
   `fs_write_attachment(path, data_base64)`——`resolve_in_vault` 路径约束、base64 解码后
   50MB 上限（沿用读侧口径）、同目录临时文件 + rename 原子写、**自动创建缺失父目录**
   （**刻意分叉** vault_create 现行「父目录 MUST NOT 隐式创建」口径，见盘点第 6 条与
   裁决点节下注）、目标已存在 MUST NOT 覆盖（返回 `fs_already_exists`）。
2. **粘贴触发与引用插入**（clipboard-image-paste，ADDED「粘贴触发与引用插入」）：md 模式且
   可编辑时，⌘V 到达且剪贴板含 `image/*` 数据 → 阻止默认粘贴、异步落盘、在光标处插入
   `![[文件名]]` 引用（语法形态以节点 1 裁决点 ② 为准）。插入是正常编辑事务（用户发起的
   文档修改），经 CM dispatch 走文档保存链路，与键入同权。
3. **落盘位置与命名去重**（clipboard-image-paste，ADDED「落盘与命名去重」）：落盘到
   vault 内 `attachments/` 目录（位置与命名规则以裁决点 ①③ 为准；起草倾向：固定目录 +
   内容哈希命名 + 已存在即复用不重复写盘）。
4. **非图片剪贴板降级**（clipboard-image-paste，ADDED「非图片剪贴板降级」）：剪贴板无
   `image/*` 数据时粘贴行为与现状逐字节一致（CodeMirror 默认文本粘贴），本能力 MUST NOT
   改变任何现有粘贴行为。
5. **失败反馈**（clipboard-image-paste，ADDED「失败反馈」）：落盘失败（写错误、超限、
   非受支持格式）SHALL 给人话 toast（文案走 `文案-Copy.md` deck 新键），MUST NOT 静默失败、
   MUST NOT 插入引用后留破图。

## Alex 裁决点

以下四点需 Alex 逐条点头（可整批「按倾向」）；**其余全部沿用既有约定，无需裁决**
（清单见下节）。

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | **落盘位置** | A. vault 根下固定 `attachments/` 目录（不存在自动创建）；B. 当前笔记同目录；C. vault 根平铺 | **倾向 A**。vault 无既有附件目录约定（盘点第 7 条），建单点约定成本最低；集中一处便于同步/排除策略；与裁决点 ② 的 `![[...]]` 组合后**与笔记目录深度无关**——未保存的新文档里也能贴图；B 让图片散落各笔记目录、C 污染根目录 |
| 2 | **插入语法** | A. Obsidian 方言 `![[name.png]]`；B. 标准 `![alt](../attachments/name.png)` 相对路径 | **倾向 A**。渲染与 vault 内文件名唯一匹配解析**今天已存在且是 living spec**（盘点第 2 条），零新增渲染面；与落盘位置组合后插入文本不含路径深度，行为不随笔记搬家而变；B 需要算相对路径（深度相关），且 `..` 解析虽已有口径但无谓引入 |
| 3 | **命名规则** | A. 内容哈希：`pasted-<sha256 前 16 位>.<ext>`（扩展名按剪贴板 MIME）；B. 时间戳：`Pasted image 20261009143022.png`（Obsidian 默认形态）；C. 剪贴板原始文件名 | **倾向 A**。同名即同内容，去重天然：同一张图再贴一次，`fs_paths_exist` 探测到即跳过写盘、只插引用（不堆副本）；不依赖时钟；仓内已有文件内容 SHA-256 的消费先例（`fs_file_revision`）。B 直观但同图堆副本；C 在 macOS 截图场景通常没有原始文件名 |
| 4 | **图文同板优先级**（剪贴板同时含文本与图片，如浏览器里复制图片） | A. 图片优先（Obsidian 同款）；B. 文本优先 | **倾向 A**——进笔记工具贴图的动作意图就是图；Alex 的场景（贴截图）剪贴板只有图片数据，两种选项无差别，此项主要给「浏览器复制图片」形态定调 |

> **注：自动建父目录是刻意分叉，不是沿用既有约定。** fs-io living spec「新建文档」现行条款
> 要求「父目录 MUST NOT 被隐式创建」（`fs_not_found`）；本提案的附件写自动建缺失父目录
> 与之相反，理由：贴图是瞬间动作，用户没有「先建 `attachments/` 目录」的触点，失败只能
> 退成 toast 重试，体验不可接受。此分叉与未合并 change `add-harness-permission-modes` 中
> Alex 已批准的「vault_create 自动建缺失父目录」修订**同向**——该 change 合并/归档后，
> fs-io living spec 的两处条款（vault_create 与本条）将一致，同步登记已落 tasks 5.1。
> 此处明示告知 Alex，不另立裁决点（方向已被上述批准背书；若 Alex 认为附件写也应维持
> 「不隐式创建」，请在节点 1 一并指出）。

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
  的纯编辑态同理可贴——落盘路径是 vault 根相对，不依赖当前文件路径）。

## Non-goals

- **远程图片 URL**：粘贴含图片 URL 的文本照旧粘贴文本；不做「识别 URL 并下载落盘」。
- **拖拽文件入编辑器**：不做。文件树已有打开/展示通道，编辑器拖入是另一条交互面；若将来要做，
  建议单独立项并与本 change 的落盘/命名约定复用（届时本 change 的 `attachments/` 约定
  已是既成事实）。
- **格式转换**：剪贴板给 `image/tiff` / `image/heic` 就原样落盘（扩展名按 MIME），不转码
  png；渲染不出交给 `attachment-display` 既有可见回退不变量。MIME 非 `image/*` 的剪贴板
  file 项不拦截（维持默认行为）。
- **多图剪贴板**：只取第一张 `image/*`（截图场景天然单图；多图队列无真实需求）。
- **图片压缩/缩放/重编码**：不做，字节原样落盘。
- **粘贴附件（pdf 等非图片文件）**：不做。
- **「另存为 / 插入已有图片」对话框**：不做——插入引用现有路径是后续增强，不在本包。
- **Windows/Linux 剪贴板形态差异**：macOS（WKWebView）为准；跨平台适配将来按实测补。

## Impact

- 影响的 specs：`fs-io`（ADDED ×1：二进制附件写入）；**新 capability** `clipboard-image-paste`
  （ADDED ×4：粘贴触发与引用插入 / 落盘与命名去重 / 非图片剪贴板降级 / 失败反馈）。
  `attachment-display` 零改动（渲染侧已全覆盖）。
- 影响的代码/系统：src-tauri（`fs_io.rs` `fs_write_attachment` 原语 + 命令注册 +
  `src/bindings/` ts-rs 重导出）；src（`editor.ts` 粘贴拦截与插入事务、hash 计算、
  `fs_paths_exist` 探测、toast 接线、`ipc.ts`）；`文案-Copy.md`（deck 新键）。
- 影响的验收：`scripts/acceptance/` 新增真机场景（草案见 design §7，合成 fixture、
  剪贴板置图走 AppleScript 标准通道）；视觉场景零新增（两种引用语法的渲染断言既有场景
  已覆盖）。
- 关联约束：ADR 0002 §3（invoke+base64，webview 不触盘）、ADR 0002 §6（50MB 上限护内存
  合同；粘贴落盘不在键入路径上做同步 IO）、ADR 0003 §3（装饰层不改写源文件——本能力的
  文档修改是用户发起的编辑事务，不经装饰层）、REVIEW.md 第 8 条（MIME↔扩展名映射只收
  进 `attachments.ts` 既有注册表，不另立表）、REVIEW.md 第 21 条（零读者场景直接切断，
  不留兼容/过渡层）、仓库信息卫生（验收 fixture 合成，剪贴板置图用合成 png）。
