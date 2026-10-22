# Tasks: add-image-file-preview

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [ ] 0.1 起草 `proposal.md` / `design.md` / `specs/{file-tree,attachment-display}/spec.md` / 本文件
- [ ] 0.2 Alex 节点 1 评审通过（硬门禁；五个起草期取值 D1–D5 一并裁决，其中 D1 决定实现规模）

## 1. 分类与打开分流

- [ ] 1.1 `src/tree.ts`：`openKind` 增加 `"image"` 档（判据取 `src/preview/attachments.ts` 的
      `fileClassOfPath(...) === "image"`，不新增扩展名集合）；`OpenKind` 类型同步
- [ ] 1.2 `src/main.ts`：`loadSessionContent` 的打开分流——`kind === "image"` 走图片会话（不进 binary 的
      D25 分支），`kind === "binary"` 分支逐字不变
- [ ] 1.3 全仓核对 `openKind` 消费点（design §3.3 的表逐行对账），**至少**显式排除这两处：
      `linkableVaultPaths`（保持「harness 输出里图片路径不可点」）与 `createShell`（放行图片建壳）；
      把核对结果写进实现说明（这是 REVIEW.md『同一语义两处真源』条要求的动作）
- [ ] 1.4 单测：`openKind` 的 image 档（png / svg / heic / 无扩展名 / 目录）；`linkableVaultPaths` 的
      反向用例（图片路径**不**进可点集——先造一个必须红的输入再实现）

## 2. 图片会话与会话模型

- [ ] 2.1 `src/editor.ts`：`EditorSession` 增加 `kind: "doc" | "image"`（默认 `"doc"`）与导出判据
      `isDocSession()`；`EditorMode` 增加 `"image"` 档（纯运行期投影，不落盘、不进配置）
- [ ] 2.2 图片会话的取值：`state` = 共享哨兵空状态（只读、无路径语义）、`editable=false`、
      `dirty=false`、`cleanDoc=""`、`scroll=undefined`、`loaded=false`；构造 / 关闭 / 跨 pane 移动走既有
      会话 API（不新开第二条标签账本）
- [ ] 2.3 前台化：图片会话成为前台时把 pane 视图切到哨兵空状态（MUST NOT 留上一份文档的状态），
      并显示该 pane 的查看面；切回文档会话走既有 `activateSession` 换 state + 滚动快照恢复
- [ ] 2.4 三个写盘入口加 `isDocSession` 判据：⌘S、保存全部脏标签、关标签前保存；同时核搜索面板 /
      大纲 / 阅读位置 / dirty 镜像的空动作（各一条判据，不各写一份 mode 判断）
- [ ] 2.5 单测：图片会话零 `document_write`（三个入口各一条，删掉判据必红）；阅读位置不写；搜索面板
      空态；dirty 镜像不上报

## 3. 查看面

- [ ] 3.1 新增 `src/image-viewer.ts`：pane 局部查看面（惰性建立、`hidden` 切换、`tabindex=0`）、
      装载态 / 终态 `<img>` / 失败占位的三态、双击进既有 lightbox（`open(src, rawRef)`，同一 `src` 串）
- [ ] 3.2 字节装载复用既有 provider（`readDataUrl` → `fs_read_attachment` + `mimeTypeOf`），
      **零新后端命令、零新 IPC 面**
- [ ] 3.3 内存策略：只保留激活图片的 `src`，切走释放、切回重读一次（D3）；同一 `src` 串供 lightbox
      复用，不重读字节
- [ ] 3.4 `src/style.css`：查看面几何（居中、`object-fit: contain`、`max-width/height: 100%`、底色
      `--content-bg`、留白吃既有 `--sp-*`）；MUST NOT 新增色值 / 圆角 / 阴影
- [ ] 3.5 modeline 右段分支（D5）：图片会话显示「图片 · 宽×高 · 文件大小」，文档会话的既有读数不变
- [ ] 3.6 单测：查看面状态机（装载 → 终态 / 失败）、失败文案来源与文档内图片同一份、双击目标的 `src`
      与 `<img>` 逐字相同

## 4. 会话恢复

- [ ] 4.1 `src/main.ts`：`createShell` 放行图片（建 `loaded=false` 的图片会话，不建文本壳）；前台化时
      触发一次字节装载（与文档会话的 `ensureActiveSessionLoaded` 同一挂点）
- [ ] 4.2 恢复失败（文件已删 / 超限）保留标签 + 失败占位，MUST NOT 静默丢标签
- [ ] 4.3 单测：含图片路径的会话恢复 → 标签回到原 pane、前台化触发一次装载；删除后的路径恢复 → 标签
      在场且为占位态

## 5. 视觉门禁（chromium + `tauri-stub`）

- [ ] 5.1 `tests/visual/scenes/tauri-stub.ts`：新增 `fs_read_attachment` 路由（按 fixture 返回合成
      1×1 PNG 的 base64；可注入失败码）
- [ ] 5.2 新增场景：点树里的图片 → 查看面在场、`<img>` 已解码（`naturalWidth > 0`）、标签标题 = 文件名、
      **无 D25 文案**（`ax: not` 反向断言）；双击 → 遮罩打开且 `src` 与 `<img>` 相同
- [ ] 5.3 同场景：坏图 / 超限注入 → 占位与人话在场、无破图、无对话框；切到文档标签再切回 → 按 D3 重读
      一次（桩的 invoke 计数可断言）
- [ ] 5.4 同场景反向验证：点开一个 PDF → 仍是 D25 提示（图片分流没有误伤二进制）
- [ ] 5.5 既有整页基线：默认打开文档的场景**零更新**；若实现导致任何基线变化，停下报 Alex 过目

## 6. 真机验收场景

- [ ] 6.1 新增 `scripts/acceptance/scenarios/<编号>-image-file-preview.md` + 合成图片 fixture（小尺寸
      PNG；**不许**用真实截图，信息卫生）
- [ ] 6.2 断言：点开 png → 内容区可见图片、标签在场、无「暂不支持预览」；双击 → 放大遮罩；⌘S 无写入
      （文件 mtime 不变）；重启 app → 图片标签恢复并显示
- [ ] 6.3 回扫既有验收场景：grep 所有对「图片文件点击 / D25」有期望的场景与 fixture，逐条改准；
      `node scripts/acceptance/run.mjs --check` 通过
- [ ] 6.4 如实登记覆盖边界（图片观感、缩放节奏等手感项归 Alex，不进机器判据）

## 7. 验证

- [ ] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 7.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）
- [ ] 7.3 `bash scripts/gate.sh visual` 全绿（动过 `src/style.css` 与视觉场景，必须本地跑）
- [ ] 7.4 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做一次 text 级 grep，真实 vault 内容、
      真实路径、真实人名零命中（图片 fixture 用合成像素）
