## ADDED Requirements

### Requirement: 保存临时文件 ghost 的磁盘治理

保存临时文件（`.{文件名}.lumir-{pid}`）在进程崩溃后残留的 ghost 会被忽略集挡在文件树与 watch 事件流之外，但仍占用 vault 磁盘空间并随崩溃次数累积。系统 SHALL 在 vault 枚举路径上惰性清除 mtime 早于年龄阈值（初始值 24 小时，可随实测调整）的该模式临时文件。系统 MUST NOT 清除未超龄的临时文件（同进程保存的 tmp 生命周期为毫秒级，阈值即保护在途写入），MUST NOT 清除名字不匹配该模式的合法点文件或符号链接。清除操作 SHALL 为 best-effort：任一清除失败 MUST NOT 使枚举失败或产生用户可见错误。

#### Scenario: 超龄 ghost 被惰性清除

- **WHEN** vault 内（含子目录）存在 mtime 早于年龄阈值的 `.lumir-` 临时文件，用户触发枚举或打开 vault
- **THEN** 该文件被删除，且不出现在枚举结果中

#### Scenario: 在途保存与合法点文件不受影响

- **WHEN** 枚举时同一目录下存在 mtime 在阈值内的 `.lumir-` 临时文件，以及 `.hidden.conf` 这类合法点文件
- **THEN** 二者均被保留，合法点文件正常出现在枚举结果中
