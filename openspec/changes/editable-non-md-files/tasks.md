# Tasks: editable-non-md-files

实现前提：提案节点 1 裁决通过（D1 可编辑范围 / D2 编辑形态 / D3 保存链路 / D4 护栏——
若裁决改备选，先按备选改写本清单与 specs delta 再动工）。行号锚点基于基线 master
`5841002`（design.md 各部）。本清单只列实现 mission 的工作；本 proposal mission 零产品
代码改动。

## 1. 编辑器可编辑性按文件类拆分

- [ ] 1.1 `src/editor.ts`：会话级「可编辑」标志（`EditorSession.editable` 或等价承载），
  取值 = 无文件上下文（现状可编辑）或 `fileClass(extensionOf(path)) ∈ {md, code, text}`
  （design §2.2）；`modeExtensions` 的 `editability` 数组（:1350-1354）改按该标志取
  `editable`/`readOnly`/`aria-readonly`，不再硬绑 `mode === "md"`
- [ ] 1.2 `modeForPath`（:1056-1059）保持两模式裁决不变；M101/M130 的视图层只读合同
  注释（:1345-1349）与「非 md 只读」相关注释（:1391-1393、:1049-1055）改写为
  「按文件类」口径；mode 热切换 / 装载路径（:1367-1372、:1723）接线新标志
- [ ] 1.3 逐条核对 code 模式既有能力在可编辑后不变：高亮（`LANGUAGES` + `codeHighlight`）、
  行号 / activeLine、`codeBindingTheme`、搜索面板、折行（`wrapExtensions` code 分支）——
  零改动目标，发现被迫改动即停下上报（design §2.3 的「不获得」清单逐字保留）

## 2. 保存链路接线（前端）

- [ ] 2.1 `src/main.ts:418-420`：revision 登记门从 `kind === "md"` 放宽为可编辑文本类
  （与 1.1 同一判据，MUST 同源消费注册表，MUST NOT 各写一份集合——REVIEW.md 第 8 条）
- [ ] 2.2 `src/save-controller.ts`：M130 兜底反馈文案（:312-322「只保存 Markdown 文件」）
  与触发面收窄同步更新（「未打开文件 / 未登记 revision」）；逐环节复核
  design §3.2–§3.6 的「无 md 假设」结论（代码通读，不是抽查）
- [ ] 2.3 「另存为新文件」泛化（design §3.8）：恢复副本保留原扩展名；新增窄接口
  `create_file`（O_EXCL + 补齐中间目录 + vault 内路径校验，与 `create_new_vault_file`
  同语义），`saveAsNewFile` 对非 md 走它；逐级重试（-2..-5）与提示文案不变；
  `wikilink_create` 保持 md 语义不动

## 3. 后端守卫放宽

- [ ] 3.1 `src-tauri/src/fs_io.rs`：`save_markdown` → `save_document`，守卫从
  `.md`/`.markdown` 白名单改为「image/binary 类扩展名拒绝清单」（:342-353），
  `fs_read_only` 文案同步改为「不支持保存该文件类型」；command 名 `document_save` 不变
- [ ] 3.2 双表防漂移对账（design §3.7 + REVIEW.md 第 8 条）：Rust 拒绝清单与
  `src/preview/attachments.ts` 注册表之间建机器对账（实现期选定载体：生成核对文件或
  双单测互锁），两侧任一漂移即红；Rust 常量表注释指向 attachments.ts 为事实源
- [ ] 3.3 单测更新：:924-933 的 `main.rs` 被拒断言翻转为「文本类放行 + image/binary
  被拒」矩阵；原子替换 / CAS / ghost 重试的既有断言零改动全绿

## 4. 验证面（M130 当年的「全链路重验证」义务，逐条兑现）

- [ ] 4.1 单元测试（tests/unit）：可编辑标志裁决矩阵（md / 代码扩展 / 未收录扩展 /
  dotfile / 无扩展名 / image / binary）；revision 登记门放宽；另存副本扩展名保留
- [ ] 4.2 视觉场景：`tests/visual/scenes/m130-text-open-trap.spec.ts` 的只读断言矩阵
  改写为可编辑矩阵（编辑生效、dirty、Cmd+S 进保存链路、无语言包纯文本）；image/binary
  分流与「暂不支持预览」断言保留；断言按 REVIEW.md 第 1 条先造必须 FAIL 的反向输入实测
- [ ] 4.3 结构解析缓存复核（design §4.4）：读 `src/code-structure.ts` 确认内容键缓存在
  高频编辑下的淘汰口径，结论记入实现 PR（不达标即提出收窄，不静默放过）
- [ ] 4.4 保存链路全环节非 md 实跑：Cmd+S / 自动保存 / CAS 冲突双逃生口 / 强制覆盖再
  冲突 / 崩溃备份与恢复 / 外部修改重载（dirty 与未 dirty 两态）/ 外部删除另存 / 退出
  守卫——逐条证据落 `test-results/`（git 外）
- [ ] 4.5 perf 复测（D4 义务）：真机产品端点复测 1MB 文本文件（md 与非 md 各一）的打开
  与编辑态输入延迟，口径照 perf-measurement spec；不达标则回来加超大文件只读阈值并
  补记 design §5，MUST NOT 用 headless 探针读数充当达标证据

## 5. 真机验收场景（编号已协调：41/42，见 TowerSend 2026-09-25 广播）

- [ ] 5.1 新增 `scripts/acceptance/scenarios/41-editable-non-md-files.md`：合成 vault 内
  编辑 `.txt` / `.yaml` / 无扩展名 `LICENSE` 各一——键入生效、dirty 出现、Cmd+S 落盘
  （回读磁盘字节比对）、撤销回到原文 dirty 收窄；制造一次外部修改触发 `document_conflict`
  sticky 提示与「强制覆盖保存」逃生口；断言按 REVIEW.md 第 1/2 条先造反向输入
- [ ] 5.2 新增 `scripts/acceptance/scenarios/42-non-md-edit-guardrails.md`：护栏矩阵——
  二进制点击仍「暂不支持预览」、非 UTF-8 文件打开即拒（`fs_invalid_utf8` 提示）、
  超 50MB 文件拒读（`fs_too_large`）；41/42 的端口与 `XDG_CONFIG_HOME` 隔离口径照旧
  （1420/1430 不碰以外的纪律见套件 README）
- [ ] 5.3 `node scripts/acceptance/run.mjs --check 41 42` 静态校验绿；真机跑通后证据落
  `test-results/acceptance/`（git 外）；合并后、Alex 验收前由 agent 先跑一遍
  （AGENTS.md 执行时机）

## 6. 门禁与收尾

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `bash scripts/gate.sh quick` 全绿；动过 `src/style.css` / `src/preview/**` /
  `tests/visual/scenes/**` 则另跑 `bash scripts/gate.sh visual`（本 change 预期动 scenes，
  视觉门禁必跑；整页基线若受影响，截图 Alex 过目再 `--update`——AGENTS.md 硬规则）
- [ ] 6.3 归档前核对：`openspec list` 确认无阻塞中的同 spec delta；`m130-text-open-trap`
  等场景改名/改写后，视觉门禁卫生按 AGENTS.md 硬规则逐张核对受影响基线时间戳
- [ ] 6.4 归档时的引用清扫（scenario 不可更名的工具链约束产物，见两 delta 首节说明）：
  living spec 他处对旧名「单内核双模式落地」的引用（`editor-live-preview` spec 的
  「代码文件的结构解析」「双击标识符高亮同一变量」等处）改指「单内核双模式与可编辑性
  落地」；顺带清扫各 requirement 前提注记与 scenario 措辞里残留的「只读 code 模式」
  描述（配色一致性等行为断言本身不变）——清扫面若超出本 change delta 已覆盖的
  requirement，按既有 archive recon 流程另立收口，不在归档动作里夹带
