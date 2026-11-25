## ADDED Requirements

### Requirement: vault 外目录的一层只读列举

系统 SHALL 提供独立的 `fs_list_external_dir` command：仅在 Quick Open 用户显式输入以 `/` 结尾的绝对目录时，只读列出该目录的**直接子文件和直接子目录**。本命令 MUST NOT 复用或放宽 `fs_read_external`，后者仍只读取单个常规文件且不得读取目录项。

入参校验 SHALL 全部在 Rust 侧完成：路径 MUST 为绝对路径且不得含 `..` 段；目标 SHALL 经 `canonicalize`（跟随符号链接）后为目录；不存在与不可读 SHALL 返回可区分的人话 `CommandError`。返回的每项 SHALL 只含规范化绝对 `path` 与 `kind: file|dir`，不得携带无消费者的 size、mtime、lazy 或 revision；结果 SHALL 按 path 确定排序，payload 类型 SHALL 经 ts-rs 导出。

该 command MUST 只枚举一层，MUST NOT 递归、通配、watch、建立或补写任何索引、创建/改写/删除任何文件，也不得依赖或改变 vault 状态。目录扫描结果 SHALL 只服务当前显式目录语境，不得进入普通搜索索引。

#### Scenario: 外部目录只列直接子项

- **WHEN** 对一个包含直接文件、直接子目录及更深层后代的 vault 外绝对目录调用 `fs_list_external_dir`
- **THEN** 只返回直接文件与直接子目录的 `path + kind`，顺序确定，不含更深层后代，不产生任何写操作

#### Scenario: 非绝对、穿越与非目录拒绝

- **WHEN** 分别以相对路径、含 `..` 段的绝对路径、不存在的路径或常规文件调用 `fs_list_external_dir`
- **THEN** 均返回人话 `CommandError`；不读取目录项、不打开文件、不产生任何写操作

#### Scenario: 文件读取接口不放宽

- **WHEN** 对目录调用既有 `fs_read_external`
- **THEN** 仍按「不是常规文件」拒绝；目录列举只经新增的独立 command

## MODIFIED Requirements

### Requirement: 按需枚举目录

系统 SHALL 提供 `fs_scan_dir` command：给定 vault 相对目录路径，返回该目录的**一层**条目（相对路径、类型、大小、mtime、惰性标记），分类口径与「全类型递归枚举」完全同源（不显示档命中即丢弃、惰性档或用户规则命中出一行且惰性标记为 true、其余出一行且惰性标记为 false）。它 SHALL 只枚举这一层，MUST NOT 递归下钻；被惰性档或用户规则命中的子目录同样只出一行（祖先命中 ⇒ 子孙同样惰性，故其惰性标记恒为 true）。空相对路径 SHALL 表示 vault 根，只在本命令内特判解析到 canonical vault 根，不得放宽其它 vault 相对路径接口。

该命令是文件树展开**惰性目录**时的唯一取数通道：惰性条目的子孙不在装载时的枚举结果里（见「全类型递归枚举」），树 MUST NOT 把它们当作空目录渲染。对非惰性目录调用它同样合法（结果是该目录的一层枚举），但正常路径下树不需要这么做。Quick Open 的显式目录语境 SHALL 复用同一命令读取普通目录、lazy 目录与 vault 根；扫描结果 SHALL 只留在当前目录语境，不得补进普通搜索索引。

- **边界**：目标路径 SHALL 经与所有读取路径同源的 vault 内校验，MUST NOT 为按需枚举放松边界（绝对路径 / `..` / 符号链接逃逸一律拒绝）；目标不存在或不是目录 SHALL 返回人话 `CommandError`。
- **线程**：该 command 的 body SHALL NOT 占 IPC 主线程——展开一个条目数很大的目录时界面 MUST NOT 整段冻结（口径与 vault-workspace「vault 打开」的打开段一致）。
- **物化登记**：成功返回后 SHALL 把该目录登记进当前 vault 的「已按需展开集合」。该集合是「watch 增量事件流」判定惰性子树事件的唯一依据，SHALL 随 vault 装载重建、MUST NOT 跨 vault 串用。惰性档与用户规则的惰性目录共用同一个集合。vault 根本身不作额外的物化登记。
- **不改索引**：本次枚举出的条目 MUST NOT 被补进链接索引、附件索引或 Quick Open 普通搜索索引（见「全类型递归枚举」的确定性条款）。

#### Scenario: 展开惰性目录得到一层

- **WHEN** 默认配置下对 `node_modules` 调用 `fs_scan_dir`
- **THEN** 返回 `node_modules` 的直接子条目（如 `express`，惰性标记为 true），不含 `express` 的子孙

#### Scenario: 对可见目录调用同样合法

- **WHEN** 对一个未被任何档或用户规则命中的目录调用 `fs_scan_dir`
- **THEN** 返回它的一层条目，与装载时枚举里该目录的子条目集合一致（口径同源）

#### Scenario: 空相对路径读取 vault 根

- **WHEN** 以空相对路径调用 `fs_scan_dir`
- **THEN** 返回 vault 根的一层条目，与装载时枚举里的根直接子项一致，不递归、不作额外物化登记

#### Scenario: 越界路径拒绝

- **WHEN** 以 `../outside` 或绝对路径调用 `fs_scan_dir`
- **THEN** 返回 `CommandError`，不读取 vault 之外的任何内容

#### Scenario: 按需枚举不改索引

- **WHEN** 用户展开一个惰性目录，其中有 `tutorial.md`；随后别处文档里的 `[[tutorial]]` 重新解析，或在 Quick Open 普通搜索中输入 `tutorial`
- **THEN** wikilink 仍为 `unresolved`，普通搜索也不新增该 lazy 文件（展开与显式目录读取都是 UI 动作，MUST NOT 改变索引）
