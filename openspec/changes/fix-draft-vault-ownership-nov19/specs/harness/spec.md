# harness 增量规格

> 起草注记（非规格正文）：本 change 只改「composer 草稿 v2 与一次性 v1 转换」一条——补归属绑定
> 合同（读写在出发时绑定 vault 稳定 id，后端只按 id 解析落点）与三条交错场景。根因链、备选方案
> 与不变量见 [design.md](../../design.md)。MODIFIED 条基于当前 living spec
> （`openspec/specs/harness/spec.md`）的原文**整条复制后改**，未改动的段落逐字保留。

## MODIFIED Requirements

### Requirement: composer 草稿 v2 与一次性 v1 转换

composer 内容 SHALL 作为当前 vault 的一份草稿自动保存与恢复；落点、tmp+rename、无 vault 不落盘、防抖、离散 flush、无变更不写、写失败 warning、串行写清、per-vault 隔离及发送成功 / 失败语义不变。草稿 MUST NOT 写入 vault。每次写入链 SHALL 捕获当前编辑世代；写失败时只有 epoch 未变且期间无新编辑才允许恢复原 pending。新编辑写已入链时，旧写 MUST NOT 借失败回填取得待写所有权；无新编辑时仍 SHALL 保留失败内容供后续 flush 重试。

草稿的归属 SHALL 在出发时绑定：前端在装载 vault 时记下该 vault 的稳定 id，读、写、清除命令 MUST 携带它；后端 SHALL 只按携带的 id 解析落点，MUST NOT 读取当前打开的 vault。切 vault 之前发出的在途写无论何时执行 MUST 只落它出发时的 vault 的文件，MUST NOT 写进之后打开的 vault；在途读的结果 MUST 按装载世代作废，不得覆盖新 vault 的输入区或「已落盘」基准。写失败重试 SHALL 仍打出发时的归属 id。切换 vault 时旧 vault 的待写按既有纪律丢弃（由切换前的 flush 写走），其迟到失败 MUST NOT 回填新 vault 的待写、MUST NOT 改变新 vault 的「已落盘」基准。

新草稿 SHALL 是 `{version:2,text,caret,cards}`：text 是完整问题，caret 是 `[0,text.length]` 内 UTF-16 offset 或 null，cards 按 tray 顺序逐字段保存。图片只存内容寻址名、源 mime 与可选宽高，MUST NOT 内联 base64；v2 合法往返必须逐字段还原。

现存 v1 是迁移的具体消费者。读到合法 v1 时 SHALL 一次性转换：段落按原顺序以 `\n` 连接，未知块以可见 JSON 文本加入，卡片按相对顺序全部抽入 cards；段落 caret 精确映射，卡片 / 末尾边界映射到最近后续文本块起点，无后续则全文末尾。成功转换后 SHALL 立即经既有串行 store 写回 v2，此后只读 / 只写 v2；MUST NOT 双写、保留旧编辑路径或建立通用迁移平台。load 起始 SHALL 捕获编辑世代；读盘期间发生新编辑时 MUST 跳过旧迁移写回及 written 基准覆盖，保留当前 pending / written。迁移写一旦入串行链，后续编辑写 SHALL 排在其后，最终落盘必须是最新输入。损坏 v1 / v2 安静回空；迁移写失败不谎报已保存。

#### Scenario: v2 往返与合法 caret

- **WHEN** 草稿包含多行文本、三类附件和文本中部 caret，保存后重开同一 vault
- **THEN** text / caret / cards 逐字段恢复，图片引用不变且无 base64；撤销史不跨进程恢复

#### Scenario: v1 一次性转换不丢内容

- **WHEN** 现存 v1 含交错段落、未知块、三类卡片与段落 / 卡片 / 末尾 caret
- **THEN** 所有段落和未知块可见文本各出现一次，卡片相对顺序不变，caret 按合同映射且合法；成功后盘上只写一份 v2，无双写

#### Scenario: 发送与写失败保留语义

- **WHEN** 发送成功、发送被能力闸拒绝，或草稿写盘失败
- **THEN** 成功清空草稿；拒绝恢复发送前 text / caret / cards 且草稿不变；写失败给 warning、不阻断输入、不谎报已保存

#### Scenario: 旧写失败不夺回新编辑的待写所有权

- **WHEN** v1 迁移写或普通 v2 旧写在途，新输入 flush 已入串行链，随后旧写失败、新写成功并再次 flush；对照组旧写失败期间无新编辑
- **THEN** 前者再次 flush 不得写出旧内容，盘上逐字节保持新输入；对照组保留原待写并可在下一次 flush 成功重试

#### Scenario: 迟到的旧写不串台

- **WHEN** vault-a 的草稿写已发出但在途，随后切到 vault-b 完成装载，旧的写才执行
- **THEN** 它只落 vault-a 的草稿文件、逐字节不改 vault-b 的草稿；vault-b 的后续编辑只写 vault-b

#### Scenario: 迟到的旧读不污染新现场

- **WHEN** vault-a 的草稿读已发出但在途，装载 vault-b 的读先完成，旧的读才返回
- **THEN** 旧读结果整体作废（不返回内容、不铺进输入区），vault-b 的「已落盘」基准与盘上草稿不变

#### Scenario: 写失败重试仍落出发时的 vault

- **WHEN** vault-a 的草稿写失败（人话 warning），随后用户在 vault-a 里再次 flush
- **THEN** 重试携带的归属仍是 vault-a，成功后才更新 vault-a 的草稿；期间切换到的其他 vault 的草稿与待写不受影响
