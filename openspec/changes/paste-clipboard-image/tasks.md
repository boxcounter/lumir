# Tasks: paste-clipboard-image

> 节点 1 已裁决（2026-10-10，见 proposal 评审记录）：落盘当前笔记同目录、`![[文件名]]`、
> 内容哈希命名（哈希以转码后字节计）、图文同板图优先、转码入范围（WebP 无损默认）。
> 以下任务按裁决后形态书写。

## 1. 通道探针（实现期第一项，design §2）

- [ ] 1.1 真机探针：起 `pnpm tauri dev`，探针打印 paste 事件 `clipboardData` 的 types/items
  全集（合成 png 经 AppleScript 置剪贴板）；坐实 MIME 集合、`getAsFile()` 可用性、
  单张 Retina 截图经 WebKit 归一化后的实际字节量。形态与 design §2 假设不符 →
  停手 TowerSend 上报 tower，不猜退路

## 2. fs-io 二进制附件写入

- [ ] 2.1 `fs_io.rs` 实现 `fs_write_attachment(dir_rel, data_base64, source_mime)`：
  `resolve_in_vault` 约束、目录不存在返回 `fs_not_found`（**不隐式建目录**）、base64
  解码、50MB 输入上限（转码前判定）、**转码**（png → WebP 无损；jpeg/webp 原样；
  其余拒绝；新增 `image` crate 依赖——纯 Rust，零 C 依赖）、**转码后字节** sha256
  内容寻址命名（`sha2` 已在依赖内）、全 vault 同名探测（命中跳过写盘按去重返回）、
  `.lumir-{pid}` 临时文件 + rename 原子写、撞名 MUST NOT 覆盖（竞态按去重收敛）
- [ ] 2.2 命令注册 + ts-rs 绑定导出至 `src/bindings/`（bindings-drift 纪律：
  先 `git add` 重导出产物再跑 gate）
- [ ] 2.3 Rust 单测：路径逃逸拒绝 / 目录不存在拒绝且不建目录 / 超限拒绝 /
  png→webp 无损往返（解码像素逐像素一致）/ 同名去重（第二次无写盘）/ 撞名不覆盖 /
  原子写半态不留 / 结果不可确认报错不报成功 / 不支持 MIME 拒绝
- [ ] 2.4 转码体积基准：合成 2560×1920 类截图 fixture，记录 剪贴板字节 vs 落盘字节，
  把实测比值回填 design §4.2 的经验值表（对应验收 S5）

## 3. 前端粘贴链路

- [ ] 3.1 `src/editor.ts` 装配处挂 `EditorView.domEventHandlers({ paste })`：md 模式且
  可编辑才拦截；无 `image/*` 一律不消费（默认文本粘贴不变）；图文同板取图（已定 A）
- [ ] 3.2 贴图链路：取首个 image/* Blob → base64 → 落盘目录 =
  `dirname(当前文件 vault 相对路径)`（无路径 → 空串 = vault 根）→ 一次
  `fs_write_attachment` 调用 → 用返回的 `name` 在光标处插入 `![[<name>]]`
  （块级独占一行，见 design §5）。**前端不算 hash、不调 `fs_paths_exist`**（已移后端）
- [ ] 3.3 失败矩阵接线（design §6）：不支持的 MIME / 超限 / 转码失败 / 写盘失败 →
  deck 化 toast；MUST NOT 静默失败、MUST NOT 插引用留破图
- [ ] 3.4 `文案-Copy.md` 新键补登（查末位键号追加，不预先占号）

## 4. 验证

- [ ] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 4.2 前端单测：拦截判定（image/非 image/非 md 模式/只读）、插入事务形态、
  落盘目录推导（有路径/无路径）、mock invoke 失败路径
- [ ] 4.3 真机验收场景 S1–S5 落地并全 PASS（草案见 design §7：贴图入 vault 含转码
  断言 / 跨笔记同图去重 / 文本粘贴回归 / 未保存新文档退 vault 根 / 体积实证证据型；
  S6 失败面按 design §7 分流 Rust 单测 + 前端 mock）
- [ ] 4.4 `scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行上报）
- [ ] 4.5 视觉门禁：引用语法渲染既有场景已覆盖，若动了 `src/style.css` /
  `src/preview/**` 则补跑 `scripts/gate.sh visual` 并在报告声明
