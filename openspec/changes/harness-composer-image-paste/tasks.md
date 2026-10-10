# Tasks: harness-composer-image-paste

## 1. 数据模型与投递投影

- [ ] 1.1 `ImageCard` 数据模型（内容寻址名 `pasted-<hash16>.<ext>` + 原始 mime + 尺寸）；`ComposerBlock` 新增
      `{kind:"image"}` 第三类变体，`isCardBlock` 纳入（原子块语义与既有卡片一致）
- [ ] 1.2 投递投影纯函数 `serializeDelivery(blocks) -> DeliveryPart[]`（文本 part 合并规则、图片 part 按块序交错、
      纯文本/卡片消息仍退化为单 text part、XML 转义、零编号）；与既有 `serializeQuoteMessage` 的文本面**同源**
- [ ] 1.3 面板文本投影（图片 part 的占位元素形态）与 `parseQuoteMessage` 解析还原——面板文本 ⟺ 投递 parts
      由**同一个函数**产出（REVIEW.md 第 8 条），round-trip 单测钉住
- [ ] 1.4 投递投影与解析不变量测试（tests/unit，零 DOM）：交错顺序、纯文本单 part 与今天逐字节一致、转义
      round-trip、未知元素保守不丢文、零编号

## 2. harness 侧存储与读写命令

- [ ] 2.1 `<config_dir>/harness/attachments/<vault 稳定 id>/` 落点（与会话 `sessions/<vault 稳定 id>/` 同族、
      与 `sessions/` 根互为兄弟，首次写时建；目录名 = 注册表稳定 id，纪律复用 `vault_dir_name`；id 不合格 →
      **拒绝落盘** + 人话错误，MUST NOT 落 `_orphaned/` 一类兜底目录）；命名与转码复用
      `fs_io` 原语（`attachment_target` / `transcode_png_to_webp` / `short_hash` / `write_attachment_atomic` /
      `base64_decode` / `ATTACHMENT_MAX_BYTES`），**提为共用函数**，MUST NOT 复制第二份
- [ ] 2.2 新命令 `harness_write_image(data_base64, source_mime) -> {name, width, height}`：50MB 判定在转码前、
      同名（内容寻址）即同内容 → 跳过写盘、MUST NOT 触碰 vault
- [ ] 2.3 新命令 `harness_read_image(name) -> base64`：落点 = `attachments/<当前 scope 的 vault id>/`（引用名只在
      本 vault 目录内唯一，MUST NOT 跨 vault 查找）、限 `pasted-<hash16>.<ext>` 形态、限尺寸、路径逃逸防护、
      非此形态拒绝
- [ ] 2.4 引用展开纯函数 `expand_image_refs(input) -> Vec<Value>`（`lumir-attachment://<name>` → base64 data URL，
      子类型由扩展名映射；读文件失败 → 人话错误）；真 client 与 mock 走同一条
- [ ] 2.5 Rust 单测：写/读命令（成功 / 超限 / 未支持格式 / 读回缺失）、展开纯函数（正常 / 缺失 / 非法 scheme）、
      落点逃逸拒绝

## 3. 能力声明与发送闸

- [ ] 3.1 `HarnessModelSpec` 增 **`vision: bool`**（键名 2026-10-10 由 `image` 改名，见 proposal 评审记录）；
      `validate_harness_model_specs` 缺键 → false + warning、类型不符 → 丢该项 + warning（逐字照抄 `effort`
      分支形态）；`HarnessConfig::vision_supported(provider, model)` 照 `effort_supported`（未列出 = false、
      mock 恒 true）
- [ ] 3.2 ts-rs bindings 重导出（`src/bindings/**`）；config 单测补 `vision` 的缺键 / 类型错 / 未列出 / 声明值四档
- [ ] 3.3 `harness_send` 发送闸：投递投影含 image part 且 `!vision_supported` → 错误码 `harness_image_unsupported`
      （人话 message + `param` 模型名），不建会话、不入队；`harness_send` 入参形态随投递 parts 调整（§design 4.2）
- [ ] 3.4 会话侧 input 项用引用形态（`image_url = lumir-attachment://<name>`）；`record_llm_request` 落的
      `llm_request.messages` 断言无 base64；wire 展开点落在 `llm.rs` 的发送前（非 send 点之后的二次序列化）
- [ ] 3.5 Rust 单测：`harness_send` 闸的拒绝路径与放行路径；`user_item` 产出的 content 数组形状

## 4. 手势、渲染与恢复

- [ ] 4.1 composer paste 处理器（`src/harness-panel.ts`）按剪贴板内容分派：含 `image/*` → 读 Blob → base64 →
      `harness_write_image` → `insertBlockAtCaret` 插图片卡片（图优先）；否则走既有纯文本净化（逐字节不变）；
      失败 → 人话 toast、不插卡片、无半截
- [ ] 4.2 图片卡片渲染：复用 `.lumir-hp-qcard` 整族样式（几何零改动，不画引号竖条）、可见缩略图（经
      `harness_read_image` 取字节）、加载中/失败占位、移除钮；元信息行**从文件名开始、无 `image ·` 类型前缀**
      （2026-10-10 裁决）；composer 态与 transcript 态两态
- [ ] 4.3 能力闸拒绝的界面出口：toast（新 D-code，zh/en 双档）+ 该消息图片卡片错误态标出（前端不另立能力判定）
- [ ] 4.4 快照恢复 round-trip：`parseQuoteMessage` 识别图片占位元素；历史会话恢复路径
      （`restored_panel_messages`）从 wire 引用还原图片卡片
- [ ] 4.5 文案新增（`文案-Copy.md` + `src/copy-data.ts`）：落盘失败、能力不支持、缩略图读回失败、图片卡片 a11y
      名（D-code 取当前空闲段）；同步 copy drift 测试
- [ ] 4.6 动过 `src/harness-panel.css` → 图片卡片视觉场景基线新增（Alex 过目后 `--update`）；既有 harness 相关
      基线按纪律核对时间戳；`docs/specs/harness-composer.md` 的 HC1/HC2 生成器纳入图片块（卡片不占文本行）

## 5. 真机实测（实现期执行）

- [ ] 5.1 **真机实测当前配置的 Kimi 模型是否接受图片输入**：按 `src-tauri/tests/harness_real_deepseek.rs` 的先例
      写一条真 provider 冒烟用例（`#[ignore]`、从 `~/.config/lumir/config.json` 原地读 key、无 key 自动 SKIP、
      key 绝不打印/落日志、模型 id 可用环境变量临时覆盖），发一条含合成小图的 `input_image`（data URL）消息，
      断言不报 400 且模型回复体现读到了图；把实测结论（哪些模型接受）写进 `docs/backlog.md` 与本 change 的
      design/notes，作为 Alex 配置里各模型 `vision` 值的依据
- [ ] 5.2 若 5.1 结论为 Kimi 端不接受 data URL / `input_image`：在 design 里补后备路径（Files API / file_id 或
      有损降级方案）并上报 tower 升级给 Alex，不自行改归宿
- [ ] 5.3 新增真机验收场景（scripts/acceptance，mock provider，fixture 全合成）并全绿：粘贴落 harness 侧并按 vault
      稳定 id 分置 + vault 零新增 / 图文同板图优先 / 非图片回归 / wire content parts 交错 / JSONL 无 base64 /
      能力闸拒绝 + 卡片标出 / 快照恢复 round-trip / 两 vault 各贴各落、互不可见（§design 9 的 ①–⑦）

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
- [ ] 6.3 动过视觉面 → `bash scripts/gate.sh visual` 全绿；图片卡片基线经 Alex 过目后 `--update`，既有基线零漂移
- [ ] 6.4 信息卫生：改动面一次 text 级 grep 清扫（无真实 vault 内容；验收 fixture 截图全部合成）
- [ ] 6.5 归档前逐条对账：tasks / spec 增量 / 实现三者一致；本 change 归档时 living spec 增量并入核对（ADDED ×3 +
      MODIFIED ×1）
