# harness 增量规格（M666）

> 起草注记（非规格正文）：一条 ADDED，基线是 living spec
> [openspec/specs/harness/spec.md](../../../../specs/harness/spec.md)。本规格**依附于**两个活跃
> change 的增量（都未归档，故本 change 不能 MODIFIED 它们）：
> `add-image-quote-to-chat` 的「图片摘录到对话」与 `quote-pipeline-consistency-oct24` 的
> 「引用失败的留痕与引用语境反馈」。后者的 **`Scenario: svg 引用失败`** 与本规格**相反**——
> svg 在本规格里走成功路径。**归档顺序 MUST 是 `add-image-quote-to-chat` →
> `quote-pipeline-consistency-oct24` → 本 change**；三者同时在场时以本规格为准（svg 引用成功，
> D585 / D586 只留给真正不支持的类型）。顺序由 tower 在批次收尾的归档待办里跟踪
> （[design.md](../../design.md) D8）。

## ADDED Requirements

### Requirement: SVG 引用的栅格化成功路径

引用一张 `svg` 图片 SHALL 与引用位图走**同一条**链路、无分支差异：格式预检放行、读 vault 字节
与写 harness 存储两条命令照常发出、写入口把 SVG 栅格化成位图后落盘。引用结果里的图片卡片 SHALL
引用**位图**内容寻址名（`pasted-<hash16>.webp`），MUST NOT 引用 SVG 文件名或 SVG 字节；卡片
元信息（宽高）SHALL 取自栅格化产物的像素尺寸。卡片的数据模型、序列化、投递 parts、留存形状
MUST NOT 为 svg 新增字段或第二种形态（图片块只有一种形态）。

引用 svg **成功**时 MUST NOT 产生失败留痕（无「N 张图片未能引用」状态行）与格式不支持提示；
D585 / D586 的失败面 SHALL 保留给**真正不支持**的格式（可引用格式表之外的扩展名，如 gif）。
栅格化自身失败（畸形 SVG / 画布尺寸非法）SHALL 按写入口既有错误码族回落，只报该张、不产卡片、
不回滚同批次已成功的引用。

#### Scenario: 引用文档里的 svg

- **WHEN** 在文档里点一张 `svg` 图片的「引用」钮
- **THEN** composer 出现图片卡片，卡片引用名是 `pasted-<hash16>.webp`（位图）、带 `@` 插入引用
  钮；输入区没有「N 张图片未能引用」状态行，也没有「暂不支持引用该格式」提示；读 vault 与写
  harness 两条命令各发一次

#### Scenario: 真不支持的格式仍走失败面

- **WHEN** 点一张可引用格式表之外的图片（如 `gif`）的「引用」钮
- **THEN** 格式预检在 IPC 之前失败：toast 是引用语境的人话（D585，含该 MIME、不含「剪贴板」
  字样），输入区留下持久的「1 张图片未能引用」（D586），composer 不出现图片卡片，读 vault 与
  写 harness 两条命令都没有发出

#### Scenario: svg 栅格化失败

- **WHEN** 引用的 svg 是畸形 XML（或画布尺寸非法）
- **THEN** 该张只报一条失败读数（走既有错误码族的人话），不产图片卡片；同批次里其它可引用的
  图片照常插入，一次撤销仍撤掉整次引用
