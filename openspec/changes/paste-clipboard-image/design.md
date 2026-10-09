# Design: paste-clipboard-image

> 提案见 [proposal.md](proposal.md)。本文是技术方案与裁决点的论证细节；spec 增量见
> `specs/`。所有「经验判断、未实测」处均已显式标注，并在 tasks 里挂了真机探针任务。

## 1. 总体链路

```
⌘V（编辑器聚焦、md 模式、可编辑）
  → DOM paste 事件（ClipboardEvent）
  → clipboardData 含 image/* 数据？
    ├─ 否 → 不拦截，CodeMirror 默认文本粘贴（现状逐字节不变）
    └─ 是 → preventDefault
        → 取第一个 image/* item 的 Blob → ArrayBuffer
        → SHA-256（crypto.subtle）→ 文件名 pasted-<hash16>.<ext>
        → fs_paths_exist(["attachments/<name>"])
            ├─ 存在 → 跳过写盘（内容寻址：同名即同内容）
            └─ 不存在 → fs_write_attachment("attachments/<name>", base64)
        → 光标处插入 ![[<name>]]（CM dispatch，正常编辑事务）
  ← 任一步失败 → toast 人话文案，不插引用、不留半截
```

整条链路是异步的；插入引用前若用户继续键入，插入点用 dispatch 时的最新选区（CM 事务自带
选区语义，天然安全）。并发连贴：每次粘贴独立跑链路，内容哈希保证两次写同图最多一胜
（后到的 `fs_paths_exist` 命中即跳过；即使竞态同时写，`fs_write_attachment` 撞名
MUST NOT 覆盖，后到者收到 `fs_already_exists` 后按「已存在」继续插入——两路收敛到同一
结果）。

## 2. 粘贴通道形态（⚠ 实现期真机探针，经验判断未实测）

- 拦截挂法：`EditorView.domEventHandlers({ paste })`（`src/editor.ts` 装配处），在 CM
  默认粘贴之前拿到 `ClipboardEvent`；判定无 `image/*` 时返回不消费，默认行为不变。
  不用 keymap 绑 `Mod-v`——`⌘V` 还有菜单路径（M131 菜单命令事件），DOM 事件层拦截
  两条路径都罩得住。
- 数据形态（经验判断）：WKWebView 的 paste 事件经标准
  `event.clipboardData.items` / `.files` 暴露，`item.kind === "file"`、
  `item.type` 为 `image/png`（截图默认）或 `image/tiff` 等。**Safari 即 WKWebView、
  向 contenteditable 贴图是多年稳定行为**，但本仓未实测。
- **探针任务（tasks 1.1，实现期第一项）**：真机起 app，探针打印 `paste` 事件
  `clipboardData.types` / items 全集——分别置入 ①截图（⇧⌘4 合成替代）②Finder 复制
  png 文件 ③浏览器复制图片。坐实：MIME 集合、item 是否可直接 `getAsFile()`、
  是否同时携带 text/html。形态与本文假设不符（如 WKWebView 不暴露 file item）→
  停手走升级线（TowerSend tower），不猜退路。
- **WebCrypto 可用性（tasks 1.2）**：hash 走 `crypto.subtle.digest`（secure context，
  dev 为 `http://localhost`、成品为 `tauri://`，均属 secure context——实现期首个构建
  确认，不行则回报改 Rust 侧 hash，契约不变）。

## 3. fs-io 新原语：`fs_write_attachment`

对称于既有 `fs_read_attachment`（invoke + base64 形态不变量，ADR 0002 §3）：

| 面 | 口径 | 沿用来源 |
|---|---|---|
| 签名 | `fs_write_attachment(path: string, data_base64: string) → string`（返回 vault 相对路径，与读侧同形） | `fs_read_attachment` |
| 路径 | 全量 `resolve_in_vault` 逃逸防护 | fs-io「vault 内路径约束」 |
| 上限 | 解码后 > 50MB → 人话错误（`attachment_too_large` 同级 code 族） | 读侧 50MB 口径 |
| 原子写 | 同目录 `.{名}.lumir-{pid}` 临时文件 + rename；结果不可确认 → 报错不报成功 | `write_document_atomic`（`fs_io.rs:1201`） |
| 父目录 | 缺失自动创建（mkdir -p 语义） | M404 vault_create 裁决先例 |
| 撞名 | 目标已存在 → `fs_already_exists`，MUST NOT 覆盖 | vault_create 的 O_EXCL 口径 |
| 绑定 | ts-rs 导出至 `src/bindings/`（bindings-drift 纪律：先 git add 重导出再跑 gate） | M249 |

写入产生的 watch 增量事件走既有事件流——文件树刷新、磁盘 revision 登记都是既有消费方，
本 change 零接线（与 app 内新建文件同路）。

## 4. 命名与去重（裁决点 ③，起草倾向 A：内容哈希）

- 文件名：`pasted-<sha256 前 16 位十六进制>.<ext>`；`<ext>` 按剪贴板 MIME 子类型映射
  （`image/png` → `png` 等），**MIME↔扩展名映射只收进 `src/preview/attachments.ts`
  的既有 MIME 注册表**（REVIEW.md 第 8 条：不另立第二份表；未收录的 MIME 子类型
  → 人话 toast「不支持的剪贴板图片格式」，不猜扩展名）。
- 去重：插入前 `fs_paths_exist(["attachments/<name>"])` 探测；命中即跳过写盘。
  内容寻址保证「同名 ⇒ 同内容」（16 位十六进制 = 64 位，偶然碰撞概率可忽略；即便
  碰撞，后果是同图引用指向同文件，无损）。
- 若 Alex 裁决点 ③ 选 B（时间戳）：去重条款降级为「撞名时顺延秒数或加后缀」，
  spec 的「重复内容去重」requirement 按裁决改写——delta 在节点 1 后随裁决同步。

## 5. 插入语义（裁决点 ②，起草倾向 A：`![[name]]`）

- 插入点：当前光标/选区处；有选区时先替换选区（与键入同权）。
- 块级形态：光标在行内中间时，前后补换行使引用独占一行（Obsidian 同款块级行为）；
  光标已在空行则直接插入。图片引用独占一行后与 `attachment-display` 的块级渲染
  假设一致（`.cm-lp-image` 是行内 replace widget 包块级内容，行形态不影响渲染）。
- 插入即普通 CM 事务：进 dirty 标记、保存链路、undo 栈（⌘Z 撤掉的是引用文本；已落盘的
  图片文件不随 undo 删除——与 Obsidian 同口径，孤儿文件按 M309 先例不主动清理，
  理由：删图可能删到仍被其他笔记引用的文件，引用计数超出本 change 范围）。
- 新文档（无路径、未保存）可贴：落盘路径是 vault 根相对 `attachments/`，不依赖当前
  文件路径——这是裁决点 ①A + ②A 组合的关键性质。

## 6. 失败矩阵

| 现场 | 处置 | 用户可见 |
|---|---|---|
| 剪贴板无 image/* | 不拦截 | 默认文本粘贴（现状） |
| MIME 子类型未收录进注册表 | 拦截，终止 | toast「不支持的剪贴板图片格式：{type}」 |
| 解码后 > 50MB | 拦截，终止 | toast「图片过大：{大小}，上限 50MB」（deck 化口径） |
| 写盘失败（IO 错误/结果不可确认） | 终止，MUST NOT 插引用 | toast 按 CommandError code 渲染（D200 系口径） |
| 撞名（fs_already_exists） | **视为去重命中**，继续插入 | 无（这是正常路径） |
| 渲染失败（字节坏/格式不可渲染） | 不归本 change | `attachment-display` 可见回退占位（既有） |

全部 toast 文案走 `文案-Copy.md` deck 新键（沿用 D 系登记惯例），实现期补登。

## 7. 验收场景草案（实现期落成 scripts/acceptance 场景文件）

合成 fixture 纪律（仓库信息卫生）：剪贴板置图走 AppleScript 标准通道
（`osascript` 把合成 png 读入 clipboard 为 «class PNGf»），不用真实截图。

- **S1 贴图入 vault**：md 文档聚焦，剪贴板置合成 png → 注入 ⌘V → 断言：
  ①磁盘 `attachments/pasted-<hash>.png` 出现且 sha256 与源图一致；②文档插入
  `![[pasted-<hash>.png]]`；③live preview 渲染出可见 `<img>`（几何非零）。
- **S2 同图去重**：连续贴同一张图两次 → 断言 `attachments/` 下匹配文件数 = 1，
  第二次 mtime 不变；文档里两条引用都渲染。
- **S3 文本粘贴回归**：剪贴板置纯文本 → ⌘V → 文档插入该文本（行为与现状一致，
  反向保证「降级条款」不是恒真——它挡住「拦截器误吞文本粘贴」这类回归）。
- **S4 未保存新文档贴图**：新建无路径文档 → 贴图 → 落盘与插入照常成立
  （专验「不依赖当前文件路径」）。
- **S5 失败反馈（实现期定可注入性）**：超限/坏数据路径若真机不可注入，降为
  Rust 侧单测覆盖 + 前端单测 mock invoke 覆盖；验收套件只留 S1–S4。

真机纪律：跑批前确认 1420/1430 无 Lumir 实例（跑批锁与端口由套件自理）；本 change
不碰 1420/1430 端口配置。

## 8. 性能与边界

- 粘贴链路全异步：hash（WebCrypto，~ms 级）+ 一次存在探测 + 一次写盘，均不在键入
  路径上；50MB 上限护住内存合同（ADR 0002 §6）。一次粘贴的 invoke 往返数 ≤ 2
  （paths_exist + write；命中去重时 = 1）。
- 不改变打开文档路径的任何测量/解析行为：`attachment-display` 零改动。
- undo 不删已落盘文件（见 §5，与 Obsidian 同口径）。

## 9. 文档与制品联动

- `文案-Copy.md`：新增 deck 键（不支持的剪贴板格式 / 图片过大 / 落盘失败渲染）——
  末位键号实现期查表追加，不预先占号。
- `src/bindings/`：ts-rs 重导出随 fs_write_attachment 新增（bindings-drift 纪律）。
- `attachment-display` / `editor-live-preview` living spec 零改动；本 change 的全部
  规格增量在 `fs-io`（+1）与新 capability `clipboard-image-paste`（+4）。
