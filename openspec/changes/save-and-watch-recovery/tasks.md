# Tasks: save-and-watch-recovery

## 1. 保存冲突恢复

- [x] 1.1 `document_conflict` 提示升级为 sticky + 两个动作：「重新载入（放弃我的修改）」「强制覆盖保存」
- [x] 1.2 强制覆盖前拉取磁盘当前 revision 刷新 CAS 基准；覆盖前二次确认，文案明示「将覆盖磁盘上较新的内容」
- [x] 1.3 `fs_not_found` 加入 SAVE_ERROR_HINTS 并给出「另存为新文件」动作（create_note O_EXCL 语义，撞名加序号重试）

## 2. watch 外部修改处置

- [x] 2.1 watch 增量比对打开中文件：未 dirty 自动重载并提示；dirty 弹 sticky 提示选「重载」/「保留我的版本」
- [x] 2.2 外部删除打开中文件：提示内容未丢失
- [x] 2.3 自身保存产生的 watch 事件经 revision 比对丢弃（不重载、不闪烁）

## 3. ghost 临时文件治理

- [x] 3.1 `is_ignored` 支持 `.` 开头且含 `.lumir-` 的名字（枚举 + watch 共用忽略集）
- [x] 3.2 `document_save` 的 `create_new` 撞陈旧 ghost 时删除重试一次

## 4. 顺带死代码清除

- [x] 4.1 删 `shell.ts` panel 创建与 `AppShell.panel`（Thread 删除后无消费者）
- [x] 4.2 删 `main.ts` Cmd+\ 绑定与 panel 隐藏逻辑；删 `style.css` 三栏 `:has` 与 `.pane-panel` 规则

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.2 `pnpm build` 通过
- [x] 5.3 `cargo test`（src-tauri）通过，含新增 ghost 治理用例
- [x] 5.4 `LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh` 视觉全绿（142 passed = 既有 133 + 新增 save-recovery 9：failures 注入 document_conflict / fs_not_found、两个恢复动作、外部修改重载 UI）
