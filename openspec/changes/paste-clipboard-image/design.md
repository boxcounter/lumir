# Design: paste-clipboard-image

> 提案见 [proposal.md](proposal.md)。本文是技术方案与裁决点的论证细节；spec 增量见
> `specs/`。所有「经验判断、未实测」处均已显式标注，并在 tasks 里挂了真机探针任务。
> 节点 1 已裁决（2026-10-10）：落盘位置 B（当前笔记同目录）、`![[文件名]]`、内容哈希
> 命名、图文同板图优先、**转码**（新增需求）。本文按裁决后形态书写。

## 1. 总体链路

```
⌘V（编辑器聚焦、md 模式、可编辑）
  → DOM paste 事件（ClipboardEvent）
  → clipboardData 含 image/* 数据？
    ├─ 否 → 不拦截，CodeMirror 默认文本粘贴（现状逐字节不变）
    └─ 是 → preventDefault
        → 取第一个 image/* item 的 Blob → base64
        → 落盘目录 = dirname(当前文件路径)；无路径 → vault 根
        → fs_write_attachment(dir_rel, base64, source_mime)   ← 仅此一次 invoke
              后端：解码（50MB 输入上限）→ 转码（默认 WebP 无损，§4）
                   → 内容哈希（转码后字节）→ 全 vault 同名探测
                   → 命中：跳过写盘，返回既有路径（去重）
                   → 未命中：原子写 pasted-<hash16>.webp，返回最终路径
        → 光标处插入 ![[<返回的文件名>]]（CM dispatch，正常编辑事务）
  ← 任一步失败 → toast 人话文案，不插引用、不留半截
```

整条链路是异步的；插入引用前若用户继续键入，插入点用 dispatch 时的最新选区（CM 事务自带
选区语义，天然安全）。并发连贴：每次粘贴独立跑链路，内容哈希保证两次写同图最多一胜
（后到者在后端同名探测命中即跳过写盘；即使竞态同时写，目标已存在 MUST NOT 覆盖，
后到者按「已存在」收敛——两路插入同一文件名，渲染同一内容）。

命名与去重收进后端后，前端不再算 hash、不再调 `fs_paths_exist`：一次粘贴恰好一次
invoke（往返数从 ≤2 降为 1），内容寻址的唯一事实源落在 Rust 侧（`sha2` 已在依赖内）。

## 2. 粘贴通道形态（⚠ 实现期真机探针，经验判断未实测）

- 拦截挂法：`EditorView.domEventHandlers({ paste })`（`src/editor.ts` 装配处），在 CM
  默认粘贴之前拿到 `ClipboardEvent`；判定无 `image/*` 时返回不消费，默认行为不变。
  不用 keymap 绑 `Mod-v`——`⌘V` 还有菜单路径（M131 菜单命令事件），DOM 事件层拦截
  两条路径都罩得住。
- 数据形态（部分有据、部分经验判断）：W3C Clipboard API 规范要求 paste 事件在原生
  类型存在时暴露 `image/png`（[Clipboard API and events](https://www.w3.org/TR/clipboard-apis/)）；
  macOS 系统截图进剪贴板的真实形态是 `public.tiff` + `public.png`（无损，Apple 支持
  社区与剪贴板查看器实测：[discussions.apple.com](https://discussions.apple.com/thread/253100004)、
  [latenightsw.com](https://forum.latenightsw.com/t/how-do-i-copy-image-file-to-clipboard-and-retain-format/590/13)）——
  即 WebKit 会把 NSPasteboard 的 TIFF/PNG 归一化为 paste 事件的 `image/png` item。
  **但本仓 WKWebView 未实测**。
- **探针任务（tasks 1.1，实现期第一项）**：真机起 app，探针打印 `paste` 事件
  `clipboardData.types` / items 全集——分别置入 ①系统截图（合成替代）②Finder 复制
  png 文件 ③浏览器复制图片。坐实：MIME 集合、item 是否可直接 `getAsFile()`、
  单张 Retina 截图经 WebKit 归一化后的实际字节量。形态与本文假设不符 →
  停手走升级线（TowerSend tower），不猜退路。

## 3. fs-io 新原语：`fs_write_attachment`

不对称于 `fs_read_attachment` 的「纯搬运」——命名与转码都收进后端（理由见 §1、§4）：

| 面 | 口径 | 沿用来源 |
|---|---|---|
| 签名 | `fs_write_attachment(dir_rel, data_base64, source_mime) → { path, name }`（内容寻址命名由后端产出） | 形态对称 `fs_read_attachment` |
| 路径 | `dir_rel` 全量 `resolve_in_vault` 逃逸防护；目录必须已存在（落盘目录恒为笔记所在目录或 vault 根），**不隐式建目录** | fs-io「vault 内路径约束」 |
| 上限 | 解码后 > 50MB → 人话错误（超限判定在转码前，按剪贴板原始字节计） | 读侧 50MB 口径 |
| 转码 | 按 §4 策略转码为目标格式；转码失败 → 人话错误 | 本 change 新增（image crate） |
| 命名 | `pasted-<转码后字节 sha256 前 16 位>.<目标扩展名>`；**先全 vault 同名探测**，命中即跳过写盘按去重返回既有路径 | `fs_file_revision` 的 SHA-256 口径（`fs_io.rs:1145`） |
| 原子写 | 同目录 `.{名}.lumir-{pid}` 临时文件 + rename；结果不可确认 → 报错不报成功 | `write_document_atomic`（`fs_io.rs:1201`） |
| 撞名 | 探测后的写仍撞名（竞态）→ MUST NOT 覆盖，按去重命中收敛返回既有路径 | vault_create 的 O_EXCL 口径 |
| 绑定 | ts-rs 导出至 `src/bindings/`（bindings-drift 纪律：先 git add 重导出再跑 gate） | M249 |

写入产生的 watch 增量事件走既有事件流——文件树刷新、磁盘 revision 登记都是既有消费方，
本 change 零接线（与 app 内新建文件同路）。

## 4. 转码（节点 1 新增需求，推翻原「不转码」非目标）

### 4.1 问题坐实

Alex 实证（剪贴板工具截图，2026-10-10）：**Image 1280x960 → 18.8MB**、786x667 → 8.0MB。
数字自洽且可解释：macOS 系统截图进剪贴板的是 **Retina 物理像素的无损 RGBA**
（1280×960 逻辑尺寸 ×2 = 2560×1920 像素 ×4 字节 ≈ 19.7MB，与 18.8MB 吻合；786×667 同理
≈ 8.4MB）——即 `public.tiff`/`public.png` 上的无损大图（§2 信源）。不经压缩落盘，
vault 会被截图迅速撑大，且 50MB 上限命中的概率随 Retina 截屏区增大而上升。

### 4.2 目标格式权衡（截图 = 文字/界面为主）

| 候选 | 体积（相对无损 PNG，经验值**未实测**，实现期 fixture 填实测） | 保真 | 实现成本 | 结论 |
|---|---|---|---|---|
| 有损 JPEG | 最小（~10–20%） | **不适合**：文字边缘振铃、色块化，截图阅读场景不可接受 | — | 否（Alex 明示不适合） |
| **WebP 无损** | ~30–60% | 逐像素无损，文字完美 | `image` crate 自带**纯 Rust 无损 WebP 编码器**（0.25 起；有损编码器已移除，[CHANGES.md](https://github.com/image-rs/image/blob/main/CHANGES.md)、[r/rust 发布帖](https://www.reddit.com/r/rust/comments/1cj94va/image_v025_performance_improvements/)）——**零 C 依赖** | **默认** |
| WebP 有损 q90 | ~10–25% | 文字轻微软化，远好于 JPEG | 需 `webp` crate（libwebp C 绑定），新增 C 依赖与构建面 | 首版不做（dogfood 后嫌大再评） |
| 优化 PNG（oxipng 式无损重整） | ~70–90% | 无损 | 纯 Rust，但收益有限 | 否（收益不解决 18.8MB 级问题） |
| 调色板量化（pngquant 式 256 色） | ~20–40% | 渐变/照片明显失真，UI 截图尚可 | `imagequant`（libimagequant 绑定） | 否（有损却不及 WebP 无损通用） |
| 分辨率降采样（Retina 2x → 1x） | ~25%（线性尺寸减半 → 像素 ×1/4） | 丢失物理分辨率 | 简单 | 否（保留原分辨率，体积交给无损压缩） |

WKWebView 解码侧无虞：WebP 自 Safari 14 / macOS 11 起原生支持（[caniuse webp](https://caniuse.com/webp)、
[WebKit WWDC24](https://webkit.org/blog/15443/news-from-wwdc24-webkit-in-safari-18-beta/)），
且 `webp` 已在 `src/preview/attachments.ts` 的 image 分类注册表内（`IMAGE_MIME`，渲染零新增）。

### 4.3 转码策略（默认档，首版唯一档）

- `source_mime` 为 `image/png`（WKWebView 对剪贴板 TIFF/PNG 的归一化产物，§2）→
  解码 → **WebP 无损**重编码 → 落盘 `pasted-<hash16>.webp`。
- `image/jpeg` / `image/webp`（浏览器复制图片可能给出）→ 已是压缩格式，**原样落盘**
  （再编码只损画质不省体积），扩展名按原 MIME。
- 其余 `image/*` 子类型 → 不猜，人话 toast「不支持的剪贴板图片格式」。
- 目标格式↔扩展名映射只收进 `attachments.ts` 既有 MIME 注册表（REVIEW.md 第 8 条，
  `webp` 已收录，零新增）。
- 质量参数 / 有损档**不开放配置**（REVIEW.md 第 9 条：不留假开关）；dogfood 后有真实
  体积数据再评是否加档（届时走配置即数据 ADR 0002 §5 的正常通道）。
- **内容哈希以转码后字节计算**——去重口径不变（同名 ⇒ 同转码结果 ⇒ 同内容），
  与裁决点 ③ A 的批准语义一致，只是哈希对象从「剪贴板字节」改为「落盘字节」。

## 5. 插入语义与落盘位置（裁决点 ① B + ② A）

- **落盘位置（裁定 B）**：当前笔记所在目录（`dirname(当前文件 vault 相对路径)`）。
  **`![[name]]` 与之兼容且自洽**：`![[...]]` 是 vault 全局文件名唯一匹配，引用文本不含
  任何目录——笔记搬家、目录重组时引用不断（原 A 方案「与目录深度无关」的性质在 B 下
  换形保留）；内容哈希命名使「同名 ⇒ 同内容」，不同内容的图片永不重名，vault 全局
  匹配下的同名歧义实际被消除（残余场景：用户手工放入同名文件，按既有字典序确定性
  口径兜底）。
- **未保存新文档（无路径）**：落 **vault 根**。口径理由：新文档保存时用户自选目录，
  图片先落根是「暂无归属」的最诚实形态；Obsidian 同设置下亦回落 vault 根。保存文档
  时**不搬动**已落盘图片（移动是另一决策面，本 change 不做）。
- 去重的探测范围是**全 vault 同名**（不止当前目录）：同一张图在不同笔记下再贴，
  命中既有文件即跳过写盘、只插引用——「同图不堆副本」在 B 下以「首贴位置赢」成立。
- 插入点：当前光标/选区处；有选区时先替换选区（与键入同权）。
- 块级形态：光标在行内中间时，前后补换行使引用独占一行（Obsidian 同款块级行为）；
  光标已在空行则直接插入。图片引用独占一行后与 `attachment-display` 的块级渲染
  假设一致（`.cm-lp-image` 是行内 replace widget 包块级内容，行形态不影响渲染）。
- 插入即普通 CM 事务：进 dirty 标记、保存链路、undo 栈（⌘Z 撤掉的是引用文本；已落盘的
  图片文件不随 undo 删除——与 Obsidian 同口径，孤儿文件按 M309 先例不主动清理，
  理由：删图可能删到仍被其他笔记引用的文件，引用计数超出本 change 范围）。

## 6. 失败矩阵

| 现场 | 处置 | 用户可见 |
|---|---|---|
| 剪贴板无 image/* | 不拦截 | 默认文本粘贴（现状） |
| source_mime 非 png/jpeg/webp | 拦截，终止 | toast「不支持的剪贴板图片格式：{type}」 |
| 解码后 > 50MB（转码前） | 拦截，终止 | toast「图片过大：{大小}，上限 50MB」（deck 化口径） |
| 转码失败（解码错误/编码错误） | 终止，MUST NOT 插引用 | toast 按 CommandError code 渲染（D200 系口径） |
| 写盘失败（IO 错误/结果不可确认） | 终止，MUST NOT 插引用 | 同上 |
| 全 vault 同名已存在 | **视为去重命中**，跳过写盘继续插入 | 无（这是正常路径） |
| 竞态撞名（写时才发现已存在） | MUST NOT 覆盖，按去重收敛 | 无 |
| 渲染失败（字节坏/格式不可渲染） | 不归本 change | `attachment-display` 可见回退占位（既有） |

全部 toast 文案走 `文案-Copy.md` deck 新键（沿用 D 系登记惯例），实现期补登。

## 7. 验收场景草案（实现期落成 scripts/acceptance 场景文件）

合成 fixture 纪律（仓库信息卫生）：剪贴板置图走 AppleScript 标准通道
（`osascript` 把合成 png 读入 clipboard 为 «class PNGf»），不用真实截图。

- **S1 贴图入 vault（转码链路）**：笔记 `notes/s1.md` 聚焦，剪贴板置合成 png → 注入 ⌘V
  → 断言：①磁盘 `notes/pasted-<hash16>.webp` 出现，**字节为 WebP**（魔数断言），
  且解码后像素与源图逐像素一致（无损断言）；②hash 以落盘字节计（对落盘文件算
  sha256 前 16 位与文件名一致）；③文档插入 `![[pasted-<hash16>.webp]]`；④live preview
  渲染出可见 `<img>`（几何非零）。
- **S2 同图去重（跨笔记）**：在 `notes/a.md` 与 `notes/b.md` 各贴同一张图 → 断言全
  vault 该哈希名文件数 = 1（落在首贴的 a.md 目录），第二次仅插引用；两处引用都渲染。
- **S3 文本粘贴回归**：剪贴板置纯文本 → ⌘V → 文档插入该文本（行为与现状一致，
  反向保证「降级条款」不是恒真——它挡住「拦截器误吞文本粘贴」这类回归）。
- **S4 未保存新文档贴图**：新建无路径文档 → 贴图 → 落盘 vault 根、插入照常成立
  （专验「无目录退 vault 根」口径）。
- **S5 转码体积实证（证据型场景，非行为断言）**：合成一张 Retina 尺寸（2560×1920）
  的类截图 fixture 置剪贴板 → 贴入 → 记录 剪贴板字节量 vs 落盘字节量，落进证据目录，
  为 §4.2 的经验值填实测（体积数字进 design 修订，不卡 PASS/FAIL）。
- **S6 失败面（实现期定可注入性）**：超限/坏数据路径若真机不可注入，降为
  Rust 侧单测覆盖 + 前端单测 mock invoke 覆盖；验收套件只留 S1–S5。

真机纪律：跑批前确认 1420/1430 无 Lumir 实例（跑批锁与端口由套件自理）；本 change
不碰 1420/1430 端口配置。

## 8. 性能与边界

- 粘贴链路全异步：一次 invoke（含后端解码 + WebP 无损编码 + 哈希 + 探测 + 原子写）。
  编码耗时随像素数线性增长，Retina 全屏截图（~5M 像素）为最坏档，**键入路径零新增**
  （粘贴不阻塞输入，加载态由 attachment-display 既有占位语义呈现）；50MB 输入上限在
  解码后立即判定，护住内存合同（ADR 0002 §6）。
- WebP 无损编码器为纯 Rust（`image` crate），零 C 依赖、零外部进程，不引入构建面。
- 不改变打开文档路径的任何测量/解析行为：`attachment-display` 零改动。
- undo 不删已落盘文件（见 §5，与 Obsidian 同口径）。

## 9. 文档与制品联动

- `文案-Copy.md`：新增 deck 键（不支持的剪贴板格式 / 图片过大 / 转码失败 / 落盘失败
  渲染）——末位键号实现期查表追加，不预先占号。
- `src/bindings/`：ts-rs 重导出随 fs_write_attachment 新增（bindings-drift 纪律）。
- `attachment-display` / `editor-live-preview` living spec 零改动；本 change 的全部
  规格增量在 `fs-io`（+1）与新 capability `clipboard-image-paste`（+5，含转码压缩）。
- 新增 Rust 依赖：`image` crate（纯 Rust；解码 png/jpeg/webp + 无损 WebP 编码）。
