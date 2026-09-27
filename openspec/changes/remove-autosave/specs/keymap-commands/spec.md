# remove-autosave 增量规格

## MODIFIED Requirements

### Requirement: 撤销与重做

编辑器 SHALL 提供撤销与重做能力，撤销栈由 CM 的 history 扩展持有（线性双栈 `done` / `undone`，暂不提供 Emacs 链式 undo）。绑定：`⌘Z` = 撤销、`⌘⇧Z` = 重做、`⌃/` = 撤销（Emacs 规范绑定）、`⌃_` = 撤销（Emacs 别名）、`⌃⌥_` = 重做（Emacs 系别名）。同一命令 SHALL 既是键盘路径也是菜单路径的落点。

文档装载事务（打开文件、外部重载、vault 复位产生的整篇替换）SHALL NOT 进入撤销史，且 SHALL 使被替换掉的旧撤销事件失效——撤销 MUST NOT 跨文档把上一个文档的内容搬进当前文档。撤销 / 重做产生的文档变化 SHALL 与保存链路保持一致：dirty SHALL 仍以「当前文本与已保存基线比较」判定，因此撤销回到已保存内容时 dirty SHALL 收窄为 false；撤销 / 重做 SHALL 照常参与 dirty 守卫与崩溃备份的 debounce——撤销回到已保存基线时，该路径的崩溃备份同时作废（备份随 dirty 生命周期，见 `fs-io` 的「崩溃备份与恢复入口」）。本 change 之前这里的约束对象还包含自动保存的 debounce 参与，该参与随自动保存整条移除。

#### Scenario: 撤销回到已保存内容

- **WHEN** 打开一个已保存文件，输入若干字符使文档 dirty，然后按下 ⌘Z
- **THEN** 文档回到打开时的内容，dirty 收窄为 false（masthead 未保存标记与后端 dirty 镜像一并复位）；若该路径此前已留下崩溃备份，该备份同时被清除（下次启动不再出现恢复提示）

#### Scenario: Emacs 别名与重做

- **WHEN** 输入后依次按下 ⌃/（撤销）、⌃⌥_（重做）
- **THEN** 文档先回到输入前，再恢复到输入后；⌃_ 与 ⌘⇧Z 同样分别产生撤销与重做

#### Scenario: 撤销不跨文档

- **WHEN** 在文件 A 中编辑并保存后切换到文件 B，然后按下 ⌘Z（或 ⌘⇧Z）
- **THEN** 文件 B 的内容保持不变，不出现文件 A 的内容被"撤"进 B 的情况

#### Scenario: 只读模式下撤销无事发生

- **WHEN** 当前文档以只读 code 模式打开（M130 方向 A）时按下 ⌘Z
- **THEN** 文档内容不变（只读保证不因撤销能力而放宽）
