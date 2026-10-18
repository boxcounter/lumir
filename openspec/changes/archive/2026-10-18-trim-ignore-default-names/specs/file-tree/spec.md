# trim-ignore-default-names 增量规格（file-tree）

## MODIFIED Requirements

### Requirement: 全类型文件树展示

系统 SHALL 在 app-shell 的侧栏（宽 236px，见 ui-design-system「应用骨架布局」）挂载文件树，展示当前 vault 的全类型条目（目录可折叠，默认排序：目录在前、同缀按名称）。条目 SHALL 显示文件名与类型区分（至少区分目录 / Markdown / 图片等可预览附件 / 其他）。树的行形态 SHALL 取 design tokens：行高 25px、层级缩进 `8px + 14px × 层深`、选中态底色 `--sel`、hover 底色 `--hover`；eink 主题下选中态 SHALL 为黑底反白，行内次级元素（徽标 / ghost 项）SHALL 同步反白（eink 降级规则 ④）。树的数据来源 SHALL 为 fs-io 的枚举结果、按需枚举结果（`fs_scan_dir`，见 fs-io「按需枚举目录」）与 watch 增量事件，webview MUST NOT 直接访问文件系统（ADR 0002 §3）。

**可见集 SHALL 包含惰性条目**：被 vault 自己的 VCS 忽略声明（用户规则）命中的目录与文件、以及命中 fs-io **惰性档**（`vault.ignore` 里档位为 `"lazy"` 的名字，默认含 `node_modules` / `target` / `dist` 等 12 名）的目录与文件，SHALL 与普通条目一样出现在树里（同一行形态、可折叠 / 可点开、可右键），MUST NOT 因为「不在装载时的枚举结果里的深层」而被隐藏或渲染成不可用。惰性目录的子孙不在装载结果里，SHALL 在**用户展开时**经 `fs_scan_dir` 取回一层并合并进树模型；树 MUST NOT 把一个尚未取回子孙的惰性目录渲染成**空目录**（两种状态在模型里必须可区分——fs-io 的惰性标记即此用途），MUST NOT 因为取数在途而阻塞界面（ADR 0002 §6）。被 fs-io **不显示档**（`vault.ignore` 里档位为 `"hidden"` 的名字，默认 `.git` / `.DS_Store`，另含恒定临时文件模式）挡住的名字不出现在树里（口径见 fs-io「全类型递归枚举」），且这必须靠**单一真源**保证：这些名字的增量事件在 fs-io 侧就被挡下（fs-io「watch 增量事件流」的组件判定），树侧 MUST NOT 依赖自己的一份名单做二次过滤（前端没有、也不该有第二份忽略名单）。名单的具体内容 MUST NOT 在树侧硬编码：默认 lazy 档自 2026-10-18 起不再含 `test-results` / `perf-results`，这类名单变动只改 fs-io 的默认地图，树的行为随「惰性标记」自动跟随。

惰性条目的可见性 MUST NOT 被读成「它已进索引」：链接解析与附件索引只覆盖主动枚举的条目（见 fs-io 的确定性条款）。

#### Scenario: 全类型混合展示

- **WHEN** vault 含 md、代码、图片、嵌套目录
- **THEN** 文件树全部展示并正确区分类型，不只展示 Markdown

#### Scenario: 行形态与层级缩进

- **WHEN** 展开三层嵌套目录并选中其中一个文件
- **THEN** 各行高 25px，缩进按 `8px + 14px × 层深` 逐级递增；选中行取选中态底色（eink 下黑底反白）

#### Scenario: 被忽略规则挡住的目录与文件仍然可见

- **WHEN** vault 根的 `.gitignore` 声明 `.local/`（磁盘上有 `.local/tutorial.md`），用户打开该 vault
- **THEN** 树里出现 `.local` 行（与普通目录同一行形态），展开后出现 `tutorial.md`，点开可读到正文

#### Scenario: 惰性档名字出现在树里且可展开

- **WHEN** 默认配置下 vault 根有 `node_modules/` 与 `target/`
- **THEN** 树里出现 `node_modules` 与 `target` 两行（惰性行，与普通目录同一行形态）；展开其中一行后，其直接子条目出现在树里；未展开时 MUST NOT 渲染成空目录

#### Scenario: 惰性目录不被渲染成空目录

- **WHEN** 用户展开一个惰性目录而取数尚在途中
- **THEN** 该目录 MUST NOT 呈现为「没有子条目的空目录」（展开态与空态在树模型里由惰性标记区分），界面不被阻塞；取回后子条目按排序规则并入

#### Scenario: 内置规则名字不出现在树里

- **WHEN** vault 根含 `.git/`（即使 `.gitignore` 里写了 `!.git/` 把它取反）
- **THEN** 树里没有 `.git` 的行（与今日行为一致；不显示档不可被用户规则的取反推翻）
