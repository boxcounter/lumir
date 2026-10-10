# Tasks: paste-clipboard-image

> 节点 1 已裁决（2026-10-10，见 proposal 评审记录）：落盘当前笔记同目录、`![[文件名]]`、
> 内容哈希命名（哈希以转码后字节计）、图文同板图优先、转码入范围（WebP 无损默认）。
> 以下任务按裁决后形态书写。**实现期实测与裁决见文末「实现记录」节**。

## 1. 通道探针（实现期第一项，design §2）

- [x] 1.1 真机探针：起 `pnpm tauri dev`，探针打印 paste 事件 `clipboardData` 的 types/items
  全集（合成 png 经 AppleScript 置剪贴板）；坐实 MIME 集合、`getAsFile()` 可用性、
  单张 Retina 截图经 WebKit 归一化后的实际字节量。（M415 完成：`types` 面**从不**出现
  `image/*`，检测面移到 `items`；Retina 类截图经 WebKit 归一化为约 0.6MB PNG。）

## 2. fs-io 二进制附件写入

- [x] 2.1 `fs_io.rs` 实现 `write_attachment(dir_rel, data_base64, source_mime)`：
  `resolve_in_vault` 约束、目录不存在返回 `fs_not_found`（**不隐式建目录**）、base64
  解码、50MB 输入上限（转码前判定）、**转码**（png → WebP 无损；jpeg/webp 原样；
  其余拒绝；新增 `image` crate 依赖——纯 Rust，零 C 依赖）、**转码后字节** sha256
  内容寻址命名、全 vault 同名探测（命中跳过写盘按去重返回）、
  `.lumir-{pid}` 临时文件 + rename 原子写、撞名 MUST NOT 覆盖。
- [x] 2.2 命令注册 + ts-rs 绑定导出至 `src/bindings/`（`commands.rs` 的 `fs_write_attachment`
  + `lib.rs` 的 `generate_handler` 注册；`WrittenAttachment.ts` 已导出并进索引）。
- [x] 2.3 Rust 单测：路径逃逸拒绝 / 目录不存在拒绝且不建目录 / 超限拒绝 /
  png→webp 无损往返（解码像素逐像素一致，带 alpha 与不带 alpha 两条）/ 同名去重 /
  撞名不覆盖 / 原子写半态不留 / 结果不可确认报错不报成功 / 不支持 MIME 拒绝
  —— 共 **14** 条，全绿（`cargo test` lib 389 passed / 0 failed）。
- [x] 2.4 转码体积基准：合成 2560×1920 类截图 fixture，记录剪贴板字节 vs 落盘字节，
  实测比值回填 design §4.2（S5 场景产出：35055 → 6030 bytes，见 design §4.2 的实测列）。

## 3. 前端粘贴链路

- [x] 3.1 `src/editor.ts` 装配处挂 `EditorView.domEventHandlers({ paste })`：md 模式且
  可编辑才拦截；无 `image/*` 一律不消费（默认文本粘贴不变）；图文同板取图。
  （纯判据落在 `src/paste-image.ts`——`tests/unit` 跑不动 `editor.ts` 的 import 链，
  见文末「实现记录」。）
- [x] 3.2 贴图链路：取首个 image/* Blob → base64 → 落盘目录 =
  `dirname(当前文件 vault 相对路径)`（无路径 → 空串 = vault 根）→ 一次
  `fs_write_attachment` 调用 → 用返回的 `name` 在光标处插入 `![[<name>]]`
  （块级独占一行）。**前端不算 hash、不调 `fs_paths_exist`**。
- [x] 3.3 失败矩阵接线：不支持的 MIME / 超限 / 转码失败 / 写盘失败 → deck 化 toast
  （`main.ts` 的 `toast(errorText(e))` 复用既有实现；MUST NOT 静默失败、
  MUST NOT 插引用留破图）。
- [x] 3.4 `文案-Copy.md` 新键补登：D436–D441（六个错误码各一条），与
  `src/copy-data.ts` 的 `ERROR_COPY` / `COPY_TABLE` 同批更新（漂移门禁绿）。

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 4.2 前端单测（`tests/unit/paste-image.test.ts`，5 条）：拦截判定（image / 非 image /
  非 md 模式 / 只读）、插入事务形态、落盘目录推导（有路径 / 无路径）、mock 端口失败路径。
- [x] 4.3 真机验收场景落地并全 PASS：**S1（112）/ S2（113）/ S3（114）/ S5（116）**
  四场景真机 4/4 PASS，证据 `test-results/acceptance/2026-10-10/`。
  **S4 不写场景**（裁决见文末）：真机上没有可达入口。
- [x] 4.4 `scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行上报）。
- [x] 4.5 视觉门禁：本批**未动** `src/style.css` / `src/preview/**`（零像素面改动），
  故不跑 `gate.sh visual`。

## 实现记录（实测与裁决，2026-10-10）

- **检测面 types → items**（M415 探针）：本仓 WKWebView 的 `clipboardData.types` 从不出现
  `image/*`（文件项一律叫 `"Files"`），精确 MIME 只在 `items[i].type` 上。design §2 与
  spec 的「含 image/*」判据按 items 口径落地（`src/paste-image.ts` 的 `firstImageFileIndex`）。
- **纯判据独立成模块**（tower 批准）：`tests/unit` 直接跑 `.ts` 源码（Node strip-only），而
  `editor.ts` 的 import 链带 `src/preview/livePreview.ts` 的参数属性 ⇒ 任何 import editor.ts
  的单测都抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。因此拦截判定 / 目录推导 / 插入事务形态 /
  落盘段落在 `src/paste-image.ts`，`editor.ts` 只留 DOM 接线。
- **真机粘贴通道**：⌘V 注入在真机不落地（M345），改用 **WebKit 原生右键菜单的 Paste 项**
  （M415 实证，场景用 `click {role: AXTextArea, button: right}` + 点 `AXMenuItem /Paste|粘贴/`）。
- **S4 不可达（tower 裁决 A）**：装载完成而一个标签都没有时 `showNotice()` 把编辑器整块隐藏
  （`src/main.ts:1231-1236`），分栏空 pane 又是结构性只读（M329），未打开 vault 时粘贴走
  `vault_not_open`——「未保存新文档」状态**没有 UI 入口**。硬写真机场景只会产出恒假红或恒真绿，
  因此不写场景；该行为由两条单测钉住：`fs_io::tests::write_attachment_targets_vault_root_for_empty_dir`
  与前端 `attachmentDirOf(undefined) === ""`。**覆盖形态如实登记：单测覆盖、真机不覆盖。**
  缺口已落 finding（idea 类），将来若加「新建未保存文档」入口，再补 S4 场景。
- **转码体积实测**（合成 fixture，两组）：2560×1920 合成类截图 PNG 35055 bytes → 落盘 WebP
  6030 bytes（**17.2%**，场景 116）；480×320 合成图（场景 112，seed=7）2792 → 1324 bytes
  （47.4%）。合成图是高可压的渐变 + 文字条，真实截图的比值会更高（更差）——数字进 design §4.2
  作**上界/下界参考**，不当作产品承诺。
- **粘贴后文档保持「未保存」**：落盘走 `fs_write_attachment`，文档 dirty 由插入的编辑事务置位，
  保存仍只由 ⌘S 触发——与 M101 的既有合同一致，非缺陷。
