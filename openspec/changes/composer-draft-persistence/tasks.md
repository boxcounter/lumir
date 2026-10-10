# Tasks: composer-draft-persistence

## 1. 草稿存储（后端）

- [ ] 1.1 草稿 sidecar `<config_dir>/harness/drafts/<vault 稳定 id>.json` 的读写：目录名纪律复用
      `jsonl::vault_dir_name`（id 不合格 → 静默不落盘，MUST NOT 落兜底目录），写入纪律 tmp + rename 原子替换
      （照 `vault_session.rs` / `reading_position.rs` 既有函数，不复制第二份）；MUST NOT 触碰 vault
- [ ] 1.2 新命令 `harness_draft_get` / `harness_draft_put`：按当前 `VaultScope.vault_id` 解析落点（前端不传 vault，
      照 `harness_write_image` 形态）；无 vault → get 返回空、put 静默不落盘；路径逃逸防护
- [ ] 1.3 ts-rs bindings 重导出（`src/bindings/**`）；`src/ipc.ts` 加对应包装
- [ ] 1.4 Rust 单测：写出与读回、tmp+rename 无残留、非法目录名拒绝、路径逃逸拒绝、无 vault 不落盘

## 2. 草稿数据形态（块模型 JSON）

- [ ] 2.1 块模型 ⟺ 草稿 JSON 的 (反)序列化，**唯一实现点**（`src/quote-card.ts` 同层）：`ComposerBlock[]` 无损往返，
      含引用卡片（file/heading/lines/text）与图片卡片（内容寻址名 + 源 mime + 可选宽高）；`version` 字段
- [ ] 2.2 图片卡片只存引用名与 mime，**MUST NOT 内联 base64**；未知块类保守保留、MUST NOT 静默丢弃
      （同时是 M440 `image` 块的向前兼容面）
- [ ] 2.3 单测：round-trip（含图片卡片、未知块类、零编号）、坏文件 / 空文件解析回落不报错

## 3. 前端保存与恢复

- [ ] 3.1 草稿 store（照 `src/reading-position.ts` 的 store 形态，零 DOM 可单测）：防抖
      `DRAFT_WRITE_DEBOUNCE_MS = 1000`、无变更不写、flush、切换时丢弃上一 vault 的待写
- [ ] 3.2 `vaultChanged`（`src/harness-panel.ts`）改造：**装载新 vault 前 flush 旧 vault 草稿、装载后恢复新 vault
      草稿**——替换现有的「切 vault 即清空草稿」（`:4879-4880`）；无草稿 / 坏文件安静回落到空输入区
- [ ] 3.3 恢复钩子：把读回的块序列铺进 composer（块序 / 块类 / 光标落位 / 图片引用一致），撤销史从零开始
- [ ] 3.4 离散 flush 挂点：面板关闭、窗口失焦 / 退出（照 `main.ts:2744-2745` 的切换前 flush 先例）
- [ ] 3.5 单测：防抖窗口与 flush 时机、无变更不写、切走丢弃待写、恢复与非图片粘贴面互不串台

## 4. 发送语义（清除与回滚）

- [ ] 4.1 发送**成功**后清除草稿（含落盘）；清空触发的自动保存对发送窗口挂起，成功即删草稿文件
- [ ] 4.2 发送**被拒 / 失败**时草稿与输入区一并保留：与 `harness_image_unsupported` 的回滚重渲
      （`src/harness-panel.ts:4938-4954`）同步，回滚后按内容重新落盘；MUST NOT 留下「崩溃即丢字」的空草稿窗口
- [ ] 4.3 单测：发送成功清草稿、发送被拒保留草稿、回滚后草稿内容与输入区一致

## 5. 文案与文档

- [ ] 5.1 文案新增（`文案-Copy.md` + `src/copy-data.ts`）：草稿保存失败的人话 warning（D-code 取当前空闲段）；
      同步 copy drift 测试
- [ ] 5.2 若实现期发现 proposal / design 的意图需变更：停下，更新 proposal 重走节点 1，不静默扩 scope

## 6. 验收与门禁

- [ ] 6.1 新增真机验收场景（scripts/acceptance，mock provider，fixture 全合成）并全绿：编辑→重启→恢复 /
      切 vault 各留各的 / vault 零写入（负向）/ 发送成功后清除 / 发送被拒保留 / 图片卡片 round-trip 且草稿无 base64
      （负向）/ 无 vault 不落盘（design §9 的 ①–⑦）
- [ ] 6.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
- [ ] 6.4 未新增视觉元素（design §8），默认不跑 `gate.sh visual`；若实现期动了 `src/harness-panel.css` → 按纪律
      补跑 `gate.sh visual` 并核对既有基线时间戳
- [ ] 6.5 信息卫生：改动面一次 text 级 grep 清扫（无真实 vault 内容；验收 fixture 全合成）
- [ ] 6.6 归档前逐条对账：tasks / spec 增量 / 实现三者一致
