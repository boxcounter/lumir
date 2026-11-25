# Design: Quick Open 一层目录候选与稳定浮层

## 1. 目录语境与同源判决

`explicitDirectoryPath` 只在输入以恰好一个尾 `/` 断言目录时产生 `{path, external}`；`/v/` 特判为 vault 根空相对路径，`/` 是合法外部根。普通 `normalizeQuickOpenInput` 与 `quickOpenAttempts` 不改，故普通文件、外部文件和 `path:line` 次序不变。

`QuickOpenResolution.directory` 携带 `{path, external, status, entries}`，状态为 `pending/ready/empty/missing/unreadable`。裸目录保持 `dir` verdict；尾斜杠保持 `invalid` verdict。两者都消费同一 directory 状态，结果区和 Enter 不另判存在性。`resolveQuickOpen` 对 pending 调用注入的 `scanDirectory`：`fs_not_found/fs_path_invalid` 归 missing，其它读取失败归 unreadable；空结果归 empty，其余 ready。`renderSeq` 与输入原文共同丢弃迟到补帧。

普通候选仍由 `filterIndices(files, query)` 产生。目录候选只由一层扫描结果产生，条目是 `{path, kind, external}`；根路径用空前缀拼接，外部路径用绝对路径拼接，目录展示时加尾 `/`。不再从普通索引合成目录候选，因此 lazy 直接子项只在显式目录语境出现。

## 2. 接受、游标与上限

`QuickOpenRow` 的 candidate 增加 `entryKind: file/dir` 与 `external`。文件候选走既有 vault/外部打开链；目录候选将输入改为该目录路径加 `/`、清空 settled、递增请求与渲染序号、重画、保持浮层和输入焦点，游标复位到首行。目录身份路径不重复尾 `/`，展示拆分时把尾 `/` 放 suffix，避免目录名成为空 name。

`QuickOpenRow` 只包含真实文件与目录候选，direct action 不创建 DOM、ARIA option、鼠标入口或游标位置。`confirm` 仍消费同一 `open` verdict：未主动移动游标时由 `openDirect` 打开精确路径与行号落点；主动移到其他候选后由 `openRow` 接受该候选。↑↓/⌃N/⌃P 只在真实候选间钳制。裸 vault 目录第一段 Enter 只揭示，第二段接受当前行；尾斜杠目录一次接受当前行。目录无候选时 Enter 给目录状态原因，不打开目录或文件。候选总数超过 100 时只渲染前 100，提示显示总数和截断。

## 3. Rust 外部只读目录命令

`fs_list_external_dir(path)` 独立于 `fs_read_external`：

1. 拒绝空路径、非绝对路径与任何 `ParentDir` 段；
2. `canonicalize` 跟随符号链接，NotFound 归 `fs_not_found`，其它 canonicalize/read_dir 错误归读取失败；目标非目录归 `fs_path_invalid`；
3. 只遍历一次 `read_dir`，逐项 `file_type`，非 UTF-8 名字跳过；文件/目录分别映射 `file/dir`，其它类型跳过；
4. 返回规范绝对路径与 kind，按 path 排序；payload 经 ts-rs 导出，只有 `path + kind`。

函数没有 vault state、watch、索引、写入或递归调用。既有 `fs_read_external` 和 vault 相对路径约束零改动。vault 根在 `scan_dir` 内作为空相对路径的特例解析到 canonical vault 根，其它 `resolve_in_vault` 消费者不变。

## 4. 稳定视觉合同（O7）

DOM 与视觉顺序一致为 `结果区（list/empty 同 grid area）→ hint → input`。浮层继续 `bottom:100%`，因此 input 底边相对 modeline 固定；内容和异步补帧只向上改变高度。

```css
.lumir-qo {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto;
  width: clamp(26em, 50vw, 56em);
  max-width: calc(100vw - 28px);
  max-height: min(80vh, calc(100vh - 67px));
}
.lumir-qo {
  min-height: min(calc(6 * 26px + 2 * var(--sp-2) + 5.68em), 80vh, calc(100vh - 67px));
}
.lumir-qo-list,
.lumir-qo-empty { grid-area: 1 / 1; min-height: 0; }
.lumir-qo-list { overflow: auto; }
```

空查询也保留同一结果区高度。短窗口通过 grid 的 `minmax(0,1fr)` 压缩结果区，输入与提示不压缩；整框最小高与最大高同受 80vh 和 modeline 上方可用高度约束，不再按 479px 媒体查询整体豁免六行。可用高度小于固定内容时以 O2 视口包含为准，不把输入推出视口。列表是唯一滚动容器并登记细条档；空态不是额外高度块。无候选目录的状态句只出现在结果区，提示行保留通用帮助；有候选时提示行才显示直接子项数量。eink 聚焦线宽通过相同的 border-box 尺寸不移动 input。

不变量：在 `viewport × theme × font-size × {empty query,0/1/many/100+,pending,exact-path candidate,directory,long hint}` 矩阵中，同一视口/主题/字号的 input `x/y/width/height` 逐值相等；resize 后只按新视口/字号重算。浮层与 input 均不越视口，宽度不随内容变。长路径仍目录先收缩、文件/目录名后收缩，title 保全路径。

## 5. 验收 DSL 与证据

`geom` 增加 `record: <name>` 与 `unchangedSince: <name>`：记录 `{x,y,w,h}`；比较前缺基线、目标节点或 bbox 都 FAIL，逐值不等也 FAIL。基线存于场景执行状态，不能跨场景复用。`vaultWrite` 增加受限 `vault:"second"`，只写第二合成 vault。

874 使用 `/tmp/lumir-m102-acceptance-b` 作为外部目录，验一层候选、子目录进入、外部文件只读、深层不出现、输入保留、零写入与 bbox 稳定；本 worker 只跑 `--check`/套件自测。Chromium 用独立端口跑目标场景，不更新任何基线。完整 `gate.sh visual` 由主会话串行。
