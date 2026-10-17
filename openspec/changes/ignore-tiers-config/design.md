# Design: ignore-tiers-config

技术方案与权衡。proposal 写「做什么」，本文写「怎么落、哪些地方会咬人、哪些结论还没有读数撑」。

## 1. 判定模型：四层，前两层由配置给出名字

今天的判定链是三层（change `vault-open-ignore-set` §2.2）：

```text
内置规则（16 名 + 2 条临时文件模式，硬编码） → 用户规则 → 可见
```

本 change 把第一层拆成两层，第二层由配置给出名字：

```text
hidden 档（配置名字 + 恒定临时文件模式） → lazy 档（配置名字） → 用户规则 → 可见
```

- 三档的去向与今日的三种 `EntryClass` 一一对应，不新增枚举值：
  - `hidden` 命中 ⇒ `EntryClass::Hidden`（无行、不递归、不进 watch、不进索引）；
  - `lazy` 命中 ⇒ `EntryClass::Lazy`（一行、`lazy: true`、不递归、不进索引、可经 `fs_scan_dir` 展开）；
  - 用户规则命中 ⇒ `EntryClass::Lazy`（同今日）；
  - 其余 ⇒ `EntryClass::Visible`。
- 两档匹配器都用 `matched_path_or_any_parents`（与用户规则同形）：**祖先命中 ⇒ 子孙同样命中**。这保证
  `node_modules/express/index.js` 在用户展开 `node_modules` 后取回的每一层仍是惰性（与用户规则的既有
  口径一致：`.local` 展开后 `tutorial.md` 仍是惰性行）。
- 名字匹配仍是**无尾斜杠的名字字面量**（`target`，不是 `target/`）：任意深度、同名文件与目录一视同仁，
  与既有语义逐条一致。名字不含通配元字符（见 §2 的校验），所以匹配器的语义就是「名字等值 + 祖先传递」。

**为什么前两档先判且命中即定格**：用户规则的取反只能在自己那一层生效。若允许 `!target/` 把 `lazy` 档
的名字翻成「完全可见」，就等于把「这个目录会不会进全量枚举与链接索引」交给一行 `.gitignore`——
性能护栏与索引确定性同时失守，且失败是静默的（见 change `vault-open-ignore-set` design §2.6 的三条理由，
本 change 逐条沿用）。

## 2. 配置面

### 2.1 键与默认值

```json
{
  "vault": {
    "rule_files": [".gitignore", ".git/info/exclude"],
    "hidden": [".git", ".DS_Store"],
    "lazy": ["node_modules", ".venv", "venv", "__pycache__", ".next", ".nuxt",
             ".cache", ".pnpm-store", ".tox", ".gradle",
             "test-results", "perf-results", "target", "dist"]
  }
}
```

| 键 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `vault.hidden` | string 数组 | `[".git", ".DS_Store"]` | 命中 ⇒ 不可见（无行、不递归、无事件、不进索引） |
| `vault.lazy` | string 数组 | 上表 14 名 | 命中 ⇒ 惰性可见（一行、不递归、不进索引、按需展开） |

- **缺省即默认**：缺键 / 缺节 / 配置文件不存在 ⇒ 用代码内置默认；键存在（含 `[]`）⇒ 该档整体按用户
  给的名字解释。两个键**各自独立**：只写 `hidden` 时 `lazy` 仍是默认 14 名。
- **两个键都不含 ⇒ 走用户规则 / 完全可见**：这是「第三档」的表达方式，不新增键、不新增枚举值。
- 默认常量落在 `config.rs`（`DEFAULT_HIDDEN` / `DEFAULT_LAZY`），与 `DEFAULT_RULE_FILES` 并列：
  默认值是**配置面的属性**，不是 `fs_io` 的属性；`fs_io` 只编译「给它的两份名单」，不持有默认值。
  这同时避免「默认名单又一处分叉」（REVIEW.md「同一语义两处真源」条）。

### 2.2 名字的合法性（逐项校验）

服务端校验在 `validate_vault`（[config.rs:1255](../../../src-tauri/src/config.rs#L1255)），与 `rule_files`
逐项校验同形——**非法项丢弃 + 各自一条人话 warning，其余项照常生效**（ADR 0002 第 5 条）：

| 输入 | 判定 | warning 口径（人话） |
|---|---|---|
| 非字符串 | 非法 | `配置项 vault.hidden 的第 N 项不是字符串，已忽略` |
| `""` / 纯空白 | 非法 | `配置项 vault.hidden 的第 N 项为空，已忽略` |
| 含 `/`（含首尾） | 非法 | `... 的 "a/b" 含斜杠（只接受单个名字），已忽略` |
| `.` / `..` | 非法 | `... 的 ".." 不是有效名字，已忽略` |
| 含 `* ? [ ] ! # \`（gitignore 元字符） | 非法 | `... 的 "*.log" 含通配符（本配置只接受名字，不支持模式），已忽略` |
| 首尾有空白 | 非法 | `... 的 " x " 首尾有空白，已忽略` |
| 同一档内重复 | 合法，静默去重 | — |
| 同时出现在两档 | 按 `hidden` 生效 | `... 的 "x" 同时出现在 hidden 与 lazy，按 hidden 生效` |

- **为什么拒绝元字符而不是转义它们**：这两个键的产品语义是「名字」，不是「模式」。允许模式会让一份
  配置实际写着 gitignore 语法，而用户以为自己写的是名字；转义方案（`\*`）则要求用户学一套本产品不
  公开的编码。逐项拒绝 + 明确 warning 是最不会静默出错的形态。
- **为什么允许内部空格**：`new dir` 这类名字合法（既有 `validateEntryName` 的 `DEFAULT: "new dir"` 用例）。
  只拒绝首尾空白——gitignore 对行尾空白有裁剪语义，用户写 `"foo "` 时无法用直觉预测结果。
- 整个字段给错类型（`"hidden": ".git"`）在 serde 解析期失败 ⇒ **整文件回落** + 一条 warning。这是
  既有解析模型的既有性质（与 `editor.line_wrap` 给 `"yes"`、`editor.font_size` 给 `"15"` 同族），本 change
  如实登记并用单测钉住，不发明逐字段类型容忍。

### 2.3 生效时点与读取点

- 读取点只有一个：`commands::prepare_vault_open`（[commands.rs:456-459](../../../src-tauri/src/commands.rs#L456)）
  在构造 `IgnorePolicy` 时现场读一次 `config::load()`，把三个字段一起传下去。`config::load()` 本身就是
  「按需读盘」，不引入启动期缓存。
- 生效时点与 `rule_files` 一致：**本次会话不变，下次装载该 vault 生效**。不新增「重扫 / 重编」通道。
- 配置读取失败（配置目录不可确定）⇒ 三个字段都回落到 `VaultConfig::default()`（打开 vault 是主结果，
  不该被一次配置读取失败拦停——既有口径，不变）。

### 2.4 配置写通道

`hidden` / `lazy` 与 `rule_files` 一样**没有运行期写回**：应用只读，用户手编 `config.json`。既有单键
合并写（`write_last_vault`、`config_set_ui_value`）会原样保留这两个未知键（配置写回纪律见
`docs/specs/config-reference.md` §3）。

## 3. 默认分档：由来、代价与行为变化

### 3.1 名单

| 档 | 名字 | 计 |
|---|---|---|
| `hidden` | `.git`、`.DS_Store` | 2 |
| `lazy` | `node_modules`、`.venv`、`venv`、`__pycache__`、`.next`、`.nuxt`、`.cache`、`.pnpm-store`、`.tox`、`.gradle`、`test-results`、`perf-results`、`target`、`dist` | 14 |
| 合计 |  | 16（= 今日 `BUILTIN_NAMES`） |

- 并集 MUST 等于今日的 16 名，交集为空——这是「名单从硬编码变默认」的不变量，由单测钉住（见 §10）。
  不新增名字、不删名字：本 change 只改**去向**与**来源**，不改名单内容。A3 档（`build` / `out` /
  `vendor`）仍不纳入（Alex 2026-09-28 裁决，不变）。
- `hidden` 只留两名：`.git`（数据破坏面）与 `.DS_Store`（纯噪声）。其余 14 名是「用户可能真想读一眼」
  的构建产物 / 依赖副本，给惰性档（可见、点开才付费）比直接隐藏更符合「体验和调整」的诉求。

### 3.2 行为变化（升级后第一天会看到的差异）

| 名字 | 今天 | 本 change 之后（默认配置） |
|---|---|---|
| `.git` / `.DS_Store` | 无行 | 无行（不变） |
| `target` / `dist` / `node_modules` / `test-results` / 其余 10 名 | 无行 | **一行惰性条目**：树里可见、可展开、可打开；不进索引；展开前其内部变更不进事件流 |

代价与不变量：

- **枚举代价不变**：惰性条目只出一行、不递归。change `vault-open-ignore-set` 的主动枚举量收窄
  （1,658 文件 / 2,395 条目 ⇒ scan 14.0ms + graph 51.7ms）继续成立。
- **索引代价不变**：惰性条目仍不进链接索引与附件索引（`build_graph` 按 `lazy` 跳过，
  [commands.rs:326](../../../src-tauri/src/commands.rs#L326)）。
- **可见条目数增加**：每个出现这些名字的目录多一行，量级是一行 / 目录，与既有条目总数相比可忽略。
- **前端不需要新逻辑**：树的惰性行、按需展开、`lazy` 事件标记全部是既有能力（`src/tree.ts` 的
  `lazyFetched` / `onExpandLazyDir`），本 change 只是让后端把更多条目标成 `lazy`。

### 3.3 为什么不把 14 名也留在 `hidden`

Alex 的原话是「我可以体验和调整」——默认分档本身就是第一份可体验的配置：想看 `target` 里的内容，
不需要改配置，点开即可（惰性行今天已经支持按需展开）；真想让某个名字完全不进树，把它挪到 `hidden`。
反过来，如果 14 名默认仍隐藏，用户必须先改配置才能看到「被藏了什么」，调整的起点不可见。

## 4. `.git` 护栏：已裁决**拒绝**（裁决点 1 的结论）

节点 1 的结论：**不加任何名字级写操作护栏**。理由（Alex 裁决口径）：

- 删除已有确认提醒，且删除只进系统回收站（可恢复）；
- 重命名 / 移动是**可撤销动作**（再改回来即可）；
- 产品立场是**不过度保护用户**——`.git` 与普通条目同规则。

落点与后果：

- `trash_entry` / `rename_entry` / `fs_move_entry` / `create_file_entry` / `create_dir_entry` **MUST NOT**
  对 `.git` 或任何名字做特判；是否可操作只取决于它是否在可见集里。
- `.git` 默认在 `hidden` 档：没有行、watch 不投递、写命令的末段名校验会拒绝它（与其他 `hidden` 名同等）。
- 用户把 `.git` 挪进 `lazy` 或从两个键里都删掉后，它就是普通可见条目：可删（进回收站）、可改名、可移动，
  也可在树里展开与打开其中的文件。
- 因此本 change 的代码里**没有** `GIT_DIR_NAME` 之类的常量或分支；审查时若见到即为越界。

已知边界（不变）：删除一个内部含 `.git` 的子仓库根目录（如 `project/`）本来就不被拦——那是「删除一个
目录」的正常操作。

## 5. 代码落点：一份策略，多个使用点

### 5.1 `IgnorePolicy`（`src-tauri/src/fs_io.rs`）

```rust
struct IgnorePolicyInner {
    root: PathBuf,
    hidden: Gitignore,   // 配置名字 + 恒定临时文件模式
    lazy: Gitignore,         // 配置名字
    sources: Mutex<Vec<UserSource>>,
    nested_gitignore: bool,
    nested_seen: Mutex<HashSet<String>>,
    materialized: Mutex<HashSet<String>>,
}

impl IgnorePolicy {
    pub fn load(root: &Path, rule_files: &[String], hidden: &[String], lazy: &[String]) -> Self;
    pub fn hidden_hit(&self, rel: &str, is_dir: bool) -> bool;
    pub fn lazy_hit(&self, rel: &str, is_dir: bool) -> bool;
    pub fn classify(&self, rel: &str, is_dir: bool) -> EntryClass;
    pub fn validate_new_name(&self, name: &str) -> Result<(), CommandError>;
}
```

- `builtin_matcher()` / `is_builtin_hidden()` / `is_builtin_name()` / `BUILTIN_NAMES` 退役；临时文件模式
  `LUMIR_TMP_PATTERNS` 保留，编入 `hidden` 匹配器（用户不可覆盖）。
- `lumir_tmp_matcher()`（ghost 惰性清除用）不变。
- 两档匹配器在 `load` 时用既有 `build_matcher` 各编译一次；配置名字已通过 §2.2 校验，不含元字符，
  因此 `add_line` 的语义就是字面量。

### 5.2 使用点（MUST 全部走同一份策略，不允许下游重算）

| 使用点 | 位置 | 变化 |
|---|---|---|
| 全量枚举 | `scan_workspace_at`（[fs_io.rs:629](../../../src-tauri/src/fs_io.rs#L629)） | `classify` 的四层判定；`ignored` 计数只数 `Hidden` |
| 按需枚举 | `scan_dir`（[fs_io.rs:675](../../../src-tauri/src/fs_io.rs#L675)） | 同一份 `classify`；`lazy = policy.classify == Lazy` |
| watch 判定 | `watch_verdict`（[fs_io.rs:527](../../../src-tauri/src/fs_io.rs#L527)） | 见 §6 |
| 新建目录的子树补全 | `expand_new_dir_subtrees`（[fs_io.rs:2282](../../../src-tauri/src/fs_io.rs#L2282)） | 已消费 `classify`，无需改判定；`Lazy` 目录不入队（既有行为） |
| 名字校验 | `validate_new_name`（[fs_io.rs:886](../../../src-tauri/src/fs_io.rs#L886)） | 改为 `&IgnorePolicy` 上的方法：`hidden_hit(name)` 才拒；`lazy` / 用户规则不拒 |
| 父目录补建 | `ensure_parent_dirs`（[fs_io.rs:1634](../../../src-tauri/src/fs_io.rs#L1634)） | 逐段只拒 `hidden_hit(segment)`；惰性档名字允许建在其内（建出来的文件随该目录惰性） |
| 同名文件查找（`wikilink_create` 查重） | `find_vault_entry_by_name`（[fs_io.rs:1992](../../../src-tauri/src/fs_io.rs#L1992)） | 只跳过 `EntryClass::Hidden` 的目录（与今日「只跳过内置隐藏目录」同形）；惰性档目录照旧参与查重（今日用户规则惰性目录也参与），行为不变 |

### 5.3 埋点口径（`vault_scan_ignored`）

- 计数点是 `scan_workspace_at` 的收口：`EntryClass::Hidden` 每命中一次 +1。
- 新语义下它回答的问题从「被内置规则剪掉多少」变成「被 `hidden` 档（含临时文件模式）剪掉多少」。
  惰性条目有行、看得见，不属于「我的文件不见了」的诊断对象，因此**不计数**。
- 事件名、字段（只有 `count`）、隐私口径都不变；只改 [logging.rs:483-490](../../../src-tauri/src/logging.rs#L483)
  的文档注释。**不新增事件名**。
- 读数会变小（14 名不再计入）——这是口径随语义移动的必然结果，不是缺陷；对照时以「0 之外仍有计数」
  为正向见证（确有大目录被挡下）。

## 6. watch 事件的核实结论（起草期核实的耦合点）

核实范围：事件从 `fs_io::watch` 的回调投递前，判定只发生在 `watch_verdict` 一处
（[fs_io.rs:527](../../../src-tauri/src/fs_io.rs#L527)）；投递之后，`commands.rs` 的 `apply_fs_changes`
（[commands.rs:344-395](../../../src-tauri/src/commands.rs#L344)）只消费 payload 的 `lazy` 决定索引增量，
**不重算规则**。结论：

1. **事件路径的判定结构不变，只是层数从二变三**：
   - `hidden`：任一组件（含最后一段）命中 ⇒ 丢弃（今天的「内置规则」分支原样保留，名单换成配置 +
     恒定模式）。
   - `lazy`：与用户规则**完全同形**——任一祖先命中且该祖先未物化 ⇒ 丢弃；最后一段一律投递；payload 的
     `lazy` 由 `classify(rel)` 给出（惰性档或用户规则命中 ⇒ true）。
2. **新增的唯一可观察差异**：外部在可见目录里 `mkdir target`（或 `npm install` 产出 `node_modules`）时，
   以前一个事件都不投递；现在会投递**这一行**的 created（`lazy: true`），树里出现一行惰性条目——与同一
   时刻的全量枚举结果一致（枚举同样会给出这一行）。幻影行判据（「枚举永远不会产生的行」）仍成立：行
   确实会产生，子孙事件仍被祖先判定挡下，直到用户展开。
   - 对应地，`expand_new_dir_subtrees` 对新出现的惰性目录**不入队**（§5.2），所以不会补出子孙，不会
     出现「孤零零的半棵子树」。
3. **物化集合的语义不变**：它仍是「该惰性目录已按需展开」的唯一开关，按路径键控、随 vault 装载重建、
   不跨 vault 串用。惰性档目录与用户规则惰性目录共用同一个集合，不需要第二份状态。
4. **索引增量不受影响**：`apply_fs_changes` 对 `lazy` 的既有处置（created / modified 跳过、deleted 无条件
   移除）原样适用于新增的惰性条目。
5. **`vault_scan_ignored` 口径**：见 §5.3。

## 7. 前端内联编辑预检：三个方案与选择

| 方案 | 形态 | 优点 | 缺点 |
|---|---|---|---|
| A. 动态注入 | `config_get` 把生效的 `hidden` 名单交给 `validateEntryName` | 保持「按下 Enter 立刻红」 | 前端多一份「生效名单」的副本与刷新时机；配置读取失败 / 桩环境缺字段时要定义回落；判定仍是两处 |
| B. 静态默认 | 前端只抄默认两名（`.git` / `.DS_Store`） | 改动最小 | 用户把 `.DS_Store` 移出 `hidden` 后前端**假拒**（后端会允许）——比不预检更糟 |
| C. 预检退役（选用） | 前端只做形状校验（非空 / 无 `/` / 非 `.` `..` / 不撞名）；忽略集判定只留后端，拒绝原因经 `tree.endInlineEdit(false, errorMessage(e))` 回显 | 单一真源；名单可配置后无第二份可漂移；对账测试自然退役 | 提示从「即时」变成「一次本地 IPC 往返后」（毫秒级）；`IGNORED_NAMES` 与对账测试删除 |

选 C：本 change 的动机之一就是「名单不再硬编码」，而前端那份副本是硬编码的直接产物。保留 A 会把
「配置的生效时点（下次装载）」复制到前端（用户改了配置、重启前前端拿的是旧名单，或前端另有一次读取
时机），引入第三条时序；B 已证明会假拒。C 的代价只有一次本地往返，且失败路径（后端拒绝 → 行内标红）
今天已经存在。

- 措辞：后端 `fs_name_invalid` 的人话原因直接显示在编辑行（既有通道），前端不再维护 D146 的名单分支
  （文案条目不删除，`validateEntryName` 不再触发它；是否回收文案编号不在本 change 范围）。

## 8. 写类命令的签名传播与 harness 耦合

`validate_new_name` 需要策略，因此下列签名加一个 `policy: &IgnorePolicy` 参数：

`validate_new_name` → `resolve_new_in_vault` → `rename_entry` / `fs_move_entry` / `create_file_entry` /
`create_dir_entry` / `vault_create_file` → `ensure_parent_dirs`。

调用点：

- `commands.rs`：`fs_rename_entry` / `fs_move_entry` / `fs_create_file` / `fs_create_dir` 改用既有
  `state.root_and_policy()`（[commands.rs:288](../../../src-tauri/src/commands.rs#L288)）；`fs_trash_entry`
  不涉及名字校验，签名不变。
- `src-tauri/src/harness/tools.rs`：`vault_create` / `vault_move` 两个调用点要传策略。`ToolContext` 目前只有
  `root`，因此需要把策略带进 `ToolContext`（构造点在 `harness.rs`）。这两个文件**已按裁决扩入实现范围**（预计 3 处签名 / 构造改动）。
- 被否掉的替代形态：
  - *进程级全局生效名单*（`static RwLock<...>`）：vault 切换与启动恢复的世代判定要再复制一份到全局，
    等于第二个状态真源；且 harness 的写路径会读到「上一个 vault」的名单。
  - *保留旧签名 + 默认档包装*（harness 走 default、commands 走配置）：同一语义两处真源，用户在配置里
    新增的 `hidden` 名字会从 harness 的缝隙里静默建出不可见文件。REVIEW.md「同一语义两处真源」条
    明确反对。

## 9. 已知边界

- **模式不支持**：两个键只收名字（§2.2）。`*.log` 这类需求靠逐项列名，或写进 `.gitignore`（落进用户规则，
  惰性可见）。
- **无名字级写操作特判**（裁决点 1）：`.git` 被配置成可见后即可删 / 改名 / 移动；本 change 不提供任何名字级保护（§4）。
- **`wikilink_create` 对惰性目标的重复文件风险不变**：本 change 对查重面只做「从旧的恒定名字表换成策略」的等价替换（仍只跳过 `EntryClass::Hidden` 的目录），
  不为惰性区域做「已存在但不可见」的合并逻辑（与 change `vault-open-ignore-set` 的既有边界一致）。
- **默认行为变化是显式的**：升级后 14 个名字从不可见变惰性可见。不做兼容开关、不做首启提示
  （AGENTS.md「变更默认直接切断」）。
- **配置文档缺口**：`docs/specs/config-reference.md` 今天没有 `[vault]` 节（`rule_files` 也未记载）。本 change
  需要补 `[vault]` 三键，否则用户无从发现键名；该文件不在现有 scope 内（见 tasks 的标注）。
- **验收场景 67 的期望过期**：它把 `target` / `dist` / `test-results` / `node_modules` / `.venv` 断成
  「不进树」，并把「外部新建内置规则目录不产生事件」当作判据。新语义下这些名字是惰性行、且 created
  事件会投递一行。该场景不在现有 scope 内，必须随实现改准，否则会产生「看起来像缺陷」的假红
  （同族教训见 `docs/process/openspec-workflow.md`「改权限 / 闸语义的 change」一节）。
- **配置键没有运行期写回**：与 `rule_files` 一致，只读手编；`describe-config` 面板（ backlog 的承接残项）
  尚未存在，不依赖它。
- **多 vault 并发打开**：策略按 vault 构造、随 vault 存活，不跨 vault 串用（既有不变量，本 change 不改）。

## 10. 验证策略与回扫面

### 10.1 单测（`src-tauri/src/config.rs` / `fs_io.rs`）

- 默认分档不变量：`DEFAULT_HIDDEN` 2 名 + `DEFAULT_LAZY` 14 名，并集 = 今日 16 名、交集为空。
- 配置解析：缺键 ⇒ 默认；`[]` ⇒ 空档；只写一个键 ⇒ 另一个仍默认；逐项非法（七种）各一条 warning、
  其余项照常；跨档重复 ⇒ `hidden` 生效 + warning；整字段类型错 ⇒ 整文件回落。
- 判定矩阵：四层顺序（含「用户规则取反翻不动两档」）；祖先传递（`node_modules/express/index.js` 惰性）；
  临时文件模式在 `hidden: []` 下仍隐藏。
- watch：`hidden` 全组件丢弃；`lazy` 祖先 + 未物化丢弃、末段投递、物化后投递；payload `lazy` 正确；
  created 的惰性目录不补子树。
- 名字校验：`hidden` 名拒绝、`lazy` 名允许、用户规则名允许；`.git` 不特判（删 / 改名 / 移动按可见集规则）。
- 计数：`ignored` 只数 `Hidden`（惰性档名不计）。

### 10.2 回扫既有期望（必做，不只加新覆盖）

- `src-tauri/src/fs_io.rs` 内既有单测：`builtin_table_matches_exactly_the_declared_names_and_tmp_patterns`、
  对拍测试、`classify_has_three_branches_and_builtin_wins_over_user_negation`、
  `watch_verdict_covers_the_six_branches`、`validate_new_name_*`——按新语义逐条改准。
- `src-tauri/tests/vault_open_readings.rs`：`node_modules` 的期望从「不进枚举」改为「一行惰性条目」。
- `tests/unit/tree-paths.test.ts`：删除 16 名对账测试与名单用例；`target` / `node_modules` 等改为「可提交」；
  保留形状校验与撞名的正反用例。
- `scripts/acceptance/scenarios/67-vault-open-ignore-set.md`：需按新期望改写（见 §9；scope 待扩）。

### 10.3 门禁

- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`。
- `scripts/gate.sh quick`（含 `bindings-drift`：`VaultConfig` 改了导出面，先 `git add` 重导出产物）。
- 真机验收：场景 67 改准后跑一次（属于实现阶段的验收动作）。

## 11. 回退

- 纯配置面 + 判定层改动，无数据迁移：回退 = revert 提交，默认名单与三档判定回到今天。
- 用户已写的两个键在旧版本里是**未知键**，解析时忽略、写回时原样保留（配置纪律），不会让旧版本启动失败。
- 唯一不可回退的是**用户已经体验过的可见性变化**（惰性行在回退后消失）——这是版本回退的预期，不另做
  兼容层。
