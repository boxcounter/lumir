## ADDED Requirements

### Requirement: 保存全部（document.save-all）

系统 SHALL 提供统一的「保存全部」命令 `document.save-all`，它保存**全部 pane 的全部**脏标签，
并在保存之后完成一组**可判定的落盘屏障**：

1. 全部脏标签逐条保存（一条失败不打断其余；任一未闭环即整体失败）；
2. 标签会话 SHALL 真实落盘（不只是排期防抖写）；写失败 SHALL 使整体失败；
3. 阅读位置 SHALL 真实落盘（无待写内容视为成功）；写失败 SHALL 使整体失败；
4. 屏障期间出现新的未保存修改 SHALL 使整体失败（不得对一个已经又变脏的界面报成功）；
5. 后端退出守卫的 dirty 镜像 SHALL 以一次 awaited 往返同步为「无脏标签」；同步失败 SHALL 使整体
   失败。

只有上述五步全部成功，系统 SHALL 写入**带操作代次的完成标记**（`save-all#<代次> ok`，视觉隐藏、
AX 可达）并给出正向终态（D1035）；任一步失败 SHALL 写入 `failed` 并给出失败终态（D1036），MUST NOT
清除任何标签的 dirty、MUST NOT 以「没有错误提示」「界面上的 dirty 点消失」或任何缺失读数冒充成功。

标签会话与阅读位置的真实落盘结果 SHALL 由后端可判定地报告（磁盘写失败 MUST NOT 以成功回包，
普通调用方的降级与 warning 语义保持不变）。屏障在后端 dirty 镜像同步的 await 返回后 SHALL 再查一次
dirty；出现新 dirty 时 SHALL 先把镜像恢复为 true 再走失败终态，MUST NOT 用 false 覆盖新 dirty。
并发 / 重复触发 SHALL 采用单飞：第二次触发 MUST NOT 开启新代次或复用前一次的成功信号。

该命令 SHALL 经统一命令层执行并**默认不绑键**（登记在无默认键位清单）；原生 File → Save All
菜单项 SHALL 指向同一命令实现，MUST NOT 自带 accelerator（菜单键等价会截走 webview 的键位分发），
MUST NOT 另开第二条保存链路。图片标签与 vault 外只读标签没有保存落点，SHALL 被视作空操作。

既有 `⌘S` 的粒度不变：它 SHALL 只保存活跃 pane 的前台标签。

#### Scenario: 多标签一次保存全部

- **WHEN** 两个标签都带未保存修改，用户执行 `document.save-all`（命令或 File → Save All）
- **THEN** 两个标签都落盘并清除 dirty，出现正向完成终态；磁盘上两份文件都含各自的修改

#### Scenario: 屏障任一步失败不报成功

- **WHEN** 保存全部时任一标签写盘失败，或标签会话 / 阅读位置 flush 写失败，或屏障期间又产生新的
  未保存修改
- **THEN** 出现失败终态且不出现完成终态；仍然脏的标签保持 dirty，MUST NOT 被当作已保存

#### Scenario: 旧的完成信号不放行

- **WHEN** 上一次保存全部的成功提示仍在场，用户产生新的未保存修改后再次执行保存全部
- **THEN** 只有代次更大的 `ok` 标记才算本次成功；同一代次的旧标记 / 旧 toast、并发 `busy`、
  缺标记 / 空树 / 超时一律判失败

#### Scenario: 正向完成终态是唯一成功判据

- **WHEN** 自动化通道（验收的安装版暂停）需要在退出前确认「保存全部真的完成」
- **THEN** 它等待完成终态的**节点级精确出现**；AX 空树、AX 读失败、超时、或同一句话只出现在文档
  正文里，一律判失败，不得据此退出应用
