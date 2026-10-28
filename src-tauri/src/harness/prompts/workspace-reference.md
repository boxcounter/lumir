Vault 绝对根路径：{{VAULT_ROOT}}

路径边界：
- vault_* 工具只接受与返回 vault 相对路径——相对上面这个根；不要传绝对路径，也不要用 ../ 越出它。
- cli_run 的每次子进程都从这个目录启动，它的相对路径因此就是 vault 内路径；vault 之外的目标在
  argv 里写绝对路径。
- 要了解 vault 里有什么，用 vault 工具看；不要用 pwd、ls /、ls ~、find $HOME 这类方式反问「vault
  在哪里」——根路径已经在上面给出。
