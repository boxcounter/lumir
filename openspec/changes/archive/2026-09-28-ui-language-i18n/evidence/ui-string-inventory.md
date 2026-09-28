# UI 上屏文案盘点（现状读数）

生成方式：`node openspec/changes/ui-language-i18n/evidence/count-ui-strings.mjs`（可复跑）。
仓根：`/Users/boxcounter/Code/Boxcounter/lumir/.tower/worktrees/wt-267`。

口径与近似见脚本头部注释。以下数字是**量级读数**，不是逐条清单。

## 前端（`src/**/*.ts`，已排除 `src/bindings/**` 生成物）

- 字符串字面量总数（含 ASCII）：**3890**
- 含 CJK 的串：**284**，分布在 **29** 个文件
- 其中含 `${}` 插值的（动态拼接）：**84**
- `src/style.css` 的 `content:` 里含 CJK 的：**0**

| 文件 | 串总数 | 含 CJK | 其中动态 |
|---|---|---|---|
| `src/keys.ts` | 356 | 65 | 9 |
| `src/save-controller.ts` | 99 | 41 | 15 |
| `src/vault-switcher.ts` | 136 | 24 | 9 |
| `src/bindings-panel.ts` | 83 | 15 | 0 |
| `src/preview/livePreview.ts` | 201 | 15 | 4 |
| `src/tree-menu.ts` | 110 | 14 | 3 |
| `src/main.ts` | 166 | 13 | 7 |
| `src/preview/callout.ts` | 74 | 13 | 0 |
| `src/tree.ts` | 200 | 12 | 6 |
| `src/tabs.ts` | 87 | 11 | 4 |
| `src/link-follow.ts` | 63 | 7 | 5 |
| `src/preview/mermaid.ts` | 82 | 7 | 5 |
| `src/preview/links.ts` | 44 | 6 | 0 |
| `src/search.ts` | 49 | 6 | 0 |
| `src/toc.ts` | 84 | 6 | 0 |
| `src/preview/attachments.ts` | 148 | 4 | 4 |
| `src/list-filter.ts` | 7 | 3 | 0 |
| `src/preview/frontmatter.ts` | 40 | 3 | 1 |
| `src/preview/table.ts` | 33 | 3 | 2 |
| `src/content-width.ts` | 19 | 2 | 1 |
| `src/preview/doc-meta.ts` | 8 | 2 | 2 |
| `src/preview/doc-title.ts` | 29 | 2 | 2 |
| `src/preview/lists.ts` | 52 | 2 | 0 |
| `src/preview/math.ts` | 69 | 2 | 2 |
| `src/theme.ts` | 7 | 2 | 2 |
| `src/editor.ts` | 222 | 1 | 0 |
| `src/preview/table-trigger.ts` | 11 | 1 | 0 |
| `src/shell.ts` | 62 | 1 | 0 |
| `src/typography.ts` | 19 | 1 | 1 |

## 后端（`src-tauri/src/**/*.rs`，经 `CommandError` / notice 上屏的部分）

- 含 CJK 的串：**120**，分布在 **10** 个文件

| 文件 | 含 CJK |
|---|---|
| `src-tauri/src/fs_io.rs` | 44 |
| `src-tauri/src/commands.rs` | 19 |
| `src-tauri/src/config.rs` | 18 |
| `src-tauri/src/link_graph.rs` | 14 |
| `src-tauri/src/recovery.rs` | 10 |
| `src-tauri/src/logging.rs` | 6 |
| `src-tauri/src/reading_position.rs` | 3 |
| `src-tauri/src/vault_session.rs` | 3 |
| `src-tauri/src/vault_registry.rs` | 2 |
| `src-tauri/src/lib.rs` | 1 |

## 文案 deck 现状

- 表行数（活跃编号）：**133**
- 最大编号：**D151**（差额 18 为停用编号，deck 明文「不复用」）
- 两列同形（语言无关候选）：**3** → D77、D80、D114

## 后端错误信封（`CommandError::new` + 中文 message，非测试代码）

- 构造点（带中文 message）：**99**
- 不同 code：**46**；不同 message 模板：**82**
- 单 code 多模板的 code（说明「按 code 映射」不足以直接出文案）：
  - `config_write_failed`：4 种
  - `fs_name_invalid`：4 种
  - `config_write`：4 种
  - `fs_path_invalid`：3 种
  - `fs_path_escape`：3 种
  - `fs_read_failed`：3 种
  - `document_write_unknown`：3 种
  - `fs_watch_failed`：3 种
  - `wikilink_invalid_path`：3 种
  - `recovery_write_failed`：3 种
  - `link_path_rejected`：2 种
  - `fs_reveal_failed`：2 种
  - `fs_scan_failed`：2 种
  - `fs_already_exists`：2 种
  - `fs_trash_failed`：2 种
  - `document_write_failed`：2 种
  - `wikilink_target_exists`：2 种
  - `wikilink_invalid`：2 种
  - `wikilink_create_failed`：2 种
  - `create_file_invalid_path`：2 种
  - `create_file_failed`：2 种
  - `workspace_read`：2 种
  - `workspace_write`：2 种

## 差异读数（本 change 要补的口子）

- 前端含 CJK 串 **284** 条（其中 84 条含插值）。
- 后端带中文 message 的信封构造点 **99** 个（46 个 code / 82 个模板）。
- 扣除口径（哪几条不进双语面）写在 [design.md](../design.md) §1.4，不在本器里机械猜测：
  本器的输出是**上界**，不是最终覆盖清单。
