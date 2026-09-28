# remove-autosave 增量规格

## MODIFIED Requirements

### Requirement: dotfile 与 JSONC 文件的可编辑性

`.gitignore`、`.gitattributes`、`.jsonc` 文件 SHALL 随注册表文件类（code 类）经
非 md 文本文件可编辑通道（change `editable-non-md-files`，M231）可编辑：编辑产生
dirty、Cmd+S、CAS 冲突恢复、崩溃备份、外部修改重载与 md 走同一保存链路。
可编辑性 SHALL 只由注册表文件类推导——本 capability MUST NOT 为这三类文件单设
可编辑开关或第二份白名单（REVIEW.md 第 8 条双表漂移防线）。若可编辑通道按白名单
形态落地，这三类 SHALL 在白名单内。可编辑通道落地前，三类文件维持只读 code 模式
（着色不受影响）。

（本 change 只把「自动保存」从保存链路的列举中删掉：自动保存整条移除后，这三类文件
与 md 的共同保存链路是 Cmd+S / CAS 冲突恢复 / 崩溃备份 / 外部修改重载。）

#### Scenario: 三类文件随可编辑通道可编辑

- **WHEN** 非 md 可编辑通道已落地，用户打开 `.gitignore`（或 `.gitattributes` /
  `.jsonc`）并编辑、保存
- **THEN** 编辑落盘成功，保存链路（Cmd+S / 冲突恢复 / 崩溃备份）与 md 同口径；
  可编辑性的来源是注册表文件类，不存在仅作用于这三类文件的独立开关
