# Tasks: non-md-readonly-open

## 1. 单一扩展名注册表

- [x] 1.1 `src/preview/attachments.ts` 收敛为唯一事实源：扩展名 → 打开/展示分类（md/image/binary/code/text）、code 语言名、附件 MIME，导出 `extensionOf` / `fileClass` / `codeLanguage` / `mimeTypeOf` 与 `CodeLanguage` 类型
- [x] 1.2 差集逐项裁决落表：hpp → cpp、bash/zsh → shell、svelte → html、cc → cpp、scss → css(sCSS)、php → null（无语言包）；heic 归入 image 并补 MIME
- [x] 1.3 `src/tree.ts` 删除自持的 IMAGE_EXTS / CODE_EXTS / BINARY_EXTS 与私有 ext 解析，改为消费注册表（displayKind / openKind 行为对既有条目零变化）
- [x] 1.4 `src/editor.ts` 删除 CODE_EXTENSIONS / CODE_LANGUAGES 的扩展名映射，改由注册表解析语言名；`Record<CodeLanguage, Language>` 编译期锁定两边一致
- [x] 1.5 `src/main.ts` 删除自持 IMAGE_MIME，改用注册表的 `mimeTypeOf`

## 2. 方向 A 落地（非 md 即只读）

- [x] 2.1 `modeForPath`：`.md`/`.markdown` → md；其余一切已打开的文件（含未收录扩展、dotfile、basename 无点）→ 只读 code；只有 path 缺失（无文件上下文）才回落配置默认基线
- [x] 2.2 复核 openFile / 保存入口 / wikilink 的 currentPath 语义与方向 A 一致（非 md 不进保存链路、不作 resolve 基准）
- [x] 2.3 评审裁决收口（tower round 1）：无扩展名线索文件也收归只读 code——D4「非 md 即只读」优先于任务书「ext 缺失保持 fallback」的字面；`editor.mode` 自此只对无文件上下文的文档生效，proposal / spec delta / 注释同步改措辞

## 3. 兜底防再犯（不可保存态的可见反馈）

- [x] 3.1 `src/save-controller.ts` 抽出落盘基准判定（md 模式 + 已登记 revision）；手动 Cmd+S 在该判定失败且 dirty 时给出可见提示（说明不支持保存 + 撤销动作），MUST NOT 静默 return；切换文件 / 切换 vault 的 dirty 守卫提示在该状态下同样指向撤销，不出现「请先保存（Cmd+S）」
- [x] 3.2 `reconcile` / `backupDirty` 对无落盘基准的 dirty 内容显式跳过并在注释与 spec 里记录裁决（不写无法闭环的备份）

## 4. 回归场景

- [x] 4.1 视觉 stub 为既有非 md 条目补最小内容能力（`docs/notes.txt`、`LICENSE`），条目集合不变以免动既有截图基线
- [x] 4.2 新增 `tests/visual/scenes/m130-text-open-trap.spec.ts`：只读矩阵（txt/log/csv/xyz/dotfile/php/svelte/hpp/bash/zsh/cc/scss/License/Makefile）断言不可编辑、无 dirty、code 模式 gutter；md 对照仍可编辑
- [x] 4.3 差集语言归属断言：hpp/cc 关键字着色（cpp）、zsh 关键字着色（shell）、php 纯文本不着色
- [x] 4.4 无落盘基准时的可见反馈断言：无打开文件（空文档）Cmd+S 提示 + 切换守卫指向撤销、不含「请先保存」；无扩展名文件（`LICENSE`/`Makefile`）断言只读 code（评审裁决后的断言形态）
- [x] 4.5 探测性回退证据：把 `modeForPath` 还原成回落配置默认 → 4.2/4.3 红；把 Cmd+S 反馈改回静默 return → 4.4 红（均已实测）

## 5. 验证

- [x] 5.1 `pnpm build` 通过（含 `tsc --noEmit`；注册表语言名的编译期合同另经改名探测验证）
- [x] 5.2 `LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh` 视觉全绿，既有场景零变化、无基线更新
- [x] 5.3 `cargo test`（src-tauri）与 `cargo fmt --check` 通过（本 change 未改 Rust，作回归确认）
- [x] 5.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.5 评审 round 1 裁决（无扩展名文件收归只读）修订后：全量门禁重跑全绿（build / cargo test / cargo fmt --check / openspec validate / 视觉全量），tip 更新并重发评审
