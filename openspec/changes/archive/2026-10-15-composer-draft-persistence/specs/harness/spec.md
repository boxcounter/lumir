# harness 增量规格

> 起草注记（非规格正文）：本 change 给 harness composer 加**草稿自动保存与恢复**——输入区内容按 vault 落盘，
> 切 vault / 重开 app 后还在原位。存储位置、粒度、保存与恢复时机、数据形态、与会话生命周期的交互的机制与差异
> 理由见 [design.md](../../design.md)。本 change 只 ADDED 一个自足的 requirement，不 MODIFIED 既有 requirement
> （避免与仍在途的 `harness-composer-image-paste` 的增量撞车，理由见 design §2）。

## ADDED Requirements

### Requirement: composer 草稿自动保存与恢复

混排对话输入区（composer）的内容 SHALL 作为**当前 vault 的草稿**自动保存并在装载该 vault 时自动恢复；粒度 SHALL 为
**一个 vault 一份草稿**（草稿绑定 vault 稳定 id，不绑定会话）。草稿 SHALL 落配置目录
（`<config_dir>/harness/drafts/<vault 稳定 id>.json`，tmp + rename 原子替换），MUST NOT 写入 vault、MUST NOT 新增或
改写 vault 内任何文件；目录名 SHALL 是 vault 注册表稳定 id（与会话留存 `sessions/<vault 稳定 id>/`、附件
`attachments/<vault 稳定 id>/` 同一份身份），MUST NOT 用 vault 路径派生的消毒名。无 vault 打开时系统 SHALL 只在内存
中工作——MUST NOT 落盘、MUST NOT 报错、MUST NOT 落任何兜底目录。

草稿 SHALL 存混排块模型（`ComposerBlock` 序列），MUST NOT 存有损的面板文本投影：图片卡片 SHALL 以内容寻址名
（`pasted-<内容哈希前 16 位>.<扩展名>`）+ 源 mime（+ 可选像素宽高）的**引用形态**入草稿，MUST NOT 内联 base64；
解析到未知块类 SHALL 保守保留、MUST NOT 静默丢弃内容。

保存 SHALL 为**防抖**（编辑停顿后落盘，窗口沿用同族 sidecar 的既有量级）+ **离散时点显式 flush**（切 vault 之前、
面板关闭、窗口失焦 / 退出）；系统 MUST NOT 只依赖防抖（切走之后不再有「当前 vault」这一上下文）。内容未变化时
SHALL 跳过写盘。写失败 SHALL 降级为人话 warning、MUST NOT 阻断输入、MUST NOT 谎报已保存。

恢复 SHALL 发生在装载 vault 时（app 启动装载后、切 vault 装载后）：读回该 vault 草稿并还原到输入区——块序、块类、
光标落位与图片卡片引用 SHALL 与保存前一致。无草稿 / 文件损坏 / 解析失败时 SHALL 安静回落到空的单段落输入区，
MUST NOT 报错、MUST NOT 伪造内容。恢复出的草稿是新编辑史——撤销 / 重做栈 MUST NOT 跨进程恢复。

**与其他时刻的交互**：发送**成功**后草稿 SHALL 清除（含落盘）；发送**被拒 / 失败**时草稿 SHALL 与输入区内容一并
原样保留，MUST NOT 出现「解析失败吞字」或「发送被拒即丢字」的空草稿窗口。切 vault 时 SHALL 先 flush 当前 vault 草稿、
再装载目标 vault 草稿。切换会话、新建会话、自动压缩 SHALL NOT 改变草稿（草稿属 vault 不属会话）；删除会话 MUST NOT
牵动草稿。

#### Scenario: 编辑后重开 app 恢复

- **WHEN** 在 composer 输入一段文本与一张引用卡片、停顿至防抖落盘，随后重启 app 并装载同一 vault
- **THEN** 输入区按相同块序还原该文本与引用卡片（引用卡片的 file / heading / lines 与保存前一致）；
  `<config_dir>/harness/drafts/<vault 稳定 id>.json` 是这次恢复的数据来源

#### Scenario: 切 vault 各留各的

- **WHEN** 在 vault A 的 composer 留有草稿，切到 vault B（其输入区为空），再切回 A
- **THEN** 切到 B 时 A 的草稿已 flush 落盘、B 的输入区呈现 B 自己的草稿（无则空）；切回 A 时 A 的草稿原样还原；
  `drafts/<A 的稳定 id>.json` 与 `drafts/<B 的稳定 id>.json` 互不影响；vault 目录零新增或修改

#### Scenario: 发送成功后清除

- **WHEN** 一条携带输入内容的用户消息发送被接受
- **THEN** 输入区清空，且该 vault 的草稿被清除（文件被删除或内容为空）——内容已进会话，不再作为未发送草稿留存

#### Scenario: 发送被拒时保留

- **WHEN** 当前模型不支持图片、一条携带图片卡片的草稿被发送闸挡下（未建会话、未入队）
- **THEN** 输入区原内容（含图片卡片）原样保留、图片卡片被标出错误态；该 vault 的草稿文件内容不变；
  MUST NOT 出现草稿先被清空再回滚的丢字窗口

#### Scenario: 图片卡片引用 round-trip 且草稿无 base64

- **WHEN** 草稿含图片卡片，重启后恢复该 vault
- **THEN** 还原出的图片卡片引用名与保存前一致、缩略图可经读回命令取回；草稿文件内不含 `data:image` 或长 base64 串
  （图片以内容寻址引用在场）

#### Scenario: 会话生命周期不动草稿

- **WHEN** 在留有草稿时切换历史会话、点击「新会话」、或发生自动压缩、或删除一份历史会话留存
- **THEN** composer 的草稿与 `<config_dir>/harness/drafts/<vault 稳定 id>.json` 均不受影响（切回该 vault 时草稿仍在）

#### Scenario: 无 vault 不落盘、不报错

- **WHEN** 尚未打开任何 vault 时在 composer 输入内容
- **THEN** 输入区照常可编辑，不产生任何 `drafts/` 文件、不弹错误、不落兜底目录

#### Scenario: 草稿损坏时安静回落

- **WHEN** 该 vault 的草稿文件缺失、为空或内容无法解析为草稿结构
- **THEN** 输入区回落到空的单段落形态，不报错、不伪造内容；随后编辑照常触发保存

#### Scenario: 写失败降级不阻断

- **WHEN** 草稿落盘失败（如磁盘不可写）
- **THEN** 产生一条人话 warning；输入区照常可用、内容不丢（仍留在内存），MUST NOT 阻断输入、MUST NOT 谎报已保存
