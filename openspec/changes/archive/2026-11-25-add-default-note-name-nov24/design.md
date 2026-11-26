# Design: add-default-note-name-nov24

## 1. 形态（无配置面）

Alex 2026-11-25 决定：新建文件默认名是产品默认行为，不设设置项。因此本设计**没有配置数据流**：

```
src/tree.ts beginCreate(create-file)
  └─ t("D988")（唯一文案真源，按 <html lang> 取 zh / en）
       └─ uniqueNewNoteName(base, siblings)（对最终落盘名判撞、递增）
            └─ input.value + setSelectionRange(0, len)
```

- 不新增 `ConfigSnapshot` / `SettingsSnapshot` / `SettingsPatch` 字段，不改 revision，不加
  `config.json` 键，也不加设置面板行。
- 不保留旧的 `editor.prefill_note_name` 消费路径、迁移或告警；旧键按既有「未知 editor 键
  忽略」口径不再被读取（AGENTS.md「变更默认直接切断」）。
- 默认名的语言取 `t()` 的唯一真源 `<html lang>`；切换语言后下一次新建自然取新语言，不另立
  语言判定。

## 2. 树侧（src/tree.ts）

- `FileTreeCallbacks` 不新增回调；`beginCreate` 在 `kind === "file"` 分支直接取 `t("D988")`。
- `uniqueNewNoteName(base, siblings)` 对 `withDefaultFileExtension(candidate)` 之后的最终名判
  撞，按 `名字 2` / `名字 3` 递增。空集合、连续撞号、缺口、CJK / Unicode、目录同名不误判都有
  单测。
- `beginCreate` 先算同级集合，写入 `input.value`，`focus()` 后
  `setSelectionRange(0, input.value.length)` 全选。输入框本身只含主文件名（不含 `.md`），
  「只选主文件名」是结构性的。
- `Enter` / `Escape` / 失焦沿用既有 `wireEdit` 处理；`Tab` 不接管。
- 自动递增只在打开编辑行时发生一次；提交路径（`submitEdit`）只 trim 与补扩展名，不再改名。

## 3. 设置面板

设置面板回到本 change 之前的四开关形态：`AutomationKey` / `AUTOMATION_KEYS` / `FLAG_KEYS` /
文案表都不含第五项；D789 与自动化节元数据恢复「四个开关」的准确表述。D985–D987 与初稿的
`onApplied` 回调一并删除，因此设置页 DOM / 文案 / 高度与基线完全一致，**不需要更新任何视觉
基线**。

## 4. 边界

- **惰性目录**：`siblingNames` 只有已加载的子条目；不可见的既有文件不参与自动编号。撞上时
  后端 `fs_already_exists` 拒绝、行内回显，用户改名；不为这个边界引入异步目录枚举。
- **语言**：默认名用既有 `t()`（真源 `<html lang>`），切语言后下一次新建自然取新语言。
- **其它创建链路**：wikilink 一键创建不经过 `beginCreate`；未命名内存文档没有 `create-file`
  编辑；重命名有既有的「原名预填」口径，均不受本 change 影响。
- **不新增** provider / AI 调用 / 模板设置；默认名不写进文档正文。
