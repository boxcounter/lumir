# Design: harness 三档权限模式闸门

proposal 的技术面：判定管线、cli_run 分类算法、重定向协议、两个新工具、批准缓存、UI 与配置。无原型、无新视觉面（chip 与浮层复用 M373 合并选择器的既有形态），不需要「视觉保真」节。

## 1. 判定管线（总序）

一次工具调用的判定按以下顺序短路，**前四层模式无关**：

```
1. deny 规则命中 → Deny（回送模型，不进批准闸）          [既有语义不变]
2. cli_run ∧ 分类为写 ∧ 写目标解析进 vault 内
   → Deny(redirect)（固定标记 + 建议 vault 工具）        [新增，见 §4]
3. 危险黑名单命中 → Ask（任何档都问，含 full_access）     [新增，见 §3.3]
4. allow 规则命中 → Allow                                [既有语义不变]
5. 模式默认分层（见 §2 语义表）                           [新增]
```

- 第 2 层在 allow 规则之前：用户 allow 规则也绕不过重定向（裁决点 6 倾向 A 的落法）。deny 规则永远第一——用户显式拒绝的优先于一切。
- 第 3 层在 allow 规则之前：黑名单是「任何档都问」的绝对层，用户 allow 规则不能静默解除它；想放行黑名单成员，须先从 config deny/黑名单口径外另行裁决（探针期不做）。
- 既有 `permissions.rs` 的 `decide(permissions, tool, subject)` 三态签名保留，内部改为跑上面五层；`subject`（cli = 拼接 argv，vault 工具 = 路径参数）的取法不变，分类器以 argv 数组为输入（比 subject 拼接串信息全）。

## 2. 三档语义表与模式默认分层

| 调用面 | Read Only `read_only` | Vault Write `vault_write`（默认） | Full Access `full_access` |
|---|---|---|---|
| 读类工具（vault_read / vault_search / skill_load） | 放行 | 放行 | 放行 |
| vault_patch / vault_create / vault_move | **逐个问**（Always Ask） | **自动放行** | 自动放行 |
| vault_delete | 逐个问（Always Ask） | **逐个问**（裁决点 1 落 B） | 放行（裁决点 1 落 B） |
| cli_run 只读白名单（§3.1） | 放行 | 放行 | 放行 |
| cli_run 写命令（白名单与黑名单之外） | 逐个问 | **逐个问**（Alex 已确认） | 自动放行（vault 内目标除外，见 §1 第 2 层） |
| 危险黑名单（§3.3） | 逐个问 | 逐个问 | 逐个问（Alex 已确认：任何档都问） |

- 模式只替换旧「默认分层」（读 allow / 写与 CLI ask 的那一层），deny > allow 的既有优先序不变（裁决点 5 倾向 A）。
- 默认档 `vault_write` 的行为差分 = 相对现状只多两处：vault 写工具免闸、cli_run 经分类（现状是 cli_run 一律 ask，分类后白名单只读命令免闸）。读类工具与「写逐个问」的既有体验不变。
- **Read Only = Always Ask**（Alex 2026-10-09 裁决，本节修订）：该档的承诺是「读自动放行、一切写逐个问」，语义对应 Kimi Code 的 Always Ask（「Auto-read only; everything else needs your approval first」）。**模式层不产出「拒绝」**——三档只在 Allow / Ask 两种默认之间切换，Deny 只来自用户 deny 规则（第 1 层）、重定向只来自 vault 内写（第 2 层）、黑名单在任何档都问（第 3 层）。
  - 作废的原口径（保留为历史，防回归）：曾定为「只读档 vault 写工具 Deny 而非 Ask——只读档的承诺是不产生写，批准闸的存在会稀释这个承诺」。作废理由（Alex 原话）：「我的预期是：Read Only 档位大致类似于 Kimi Code 的 Always Ask。如果 Read Only 拒绝所有写操作，那这个档没有实用价值。」
  - 一个档位全拒的副作用是模型拿到不可恢复的失败、用户也没有放行的机会；Always Ask 让「只读」成为「默认不自动写」而不是「不允许写」。

## 3. cli_run 命令分类算法

输入：argv（command + args，argv 直传、无 shell 展开——`tools.rs` 现行形态不变）。输出三态：**ReadOnly / Write / Dangerous**。分类表是代码内的唯一真源（REVIEW.md 第 8 条：不允许 config 层另长一份语义副本；config 规则表管的是「用户加减项」，不管分类）。

### 3.1 只读白名单（首版，裁决点 2）

按 (命令名, 参数形态) 判定：

| 命令 | 只读形态 | 说明 |
|---|---|---|
| `ls` `cat` `head` `tail` `wc` `file` `stat` `pwd` `which` `whereis` `echo` `printf` `date` `uname` `du` `df` | 任意参数 | 纯读 |
| `rg` `grep` `egrep` `fgrep` | 任意参数 | 纯读 |
| `find` | 不含 `-delete` / `-exec` | `-exec` 可执行任意命令，保守降级为写 |
| `tree` `less` `more` | 任意参数 | 纯读 |
| `git` | 子命令 ∈ {`status` `diff` `log` `show` `branch`（仅列表形态）`tag`（仅列表形态）`ls-files` `rev-parse` `blame` `describe` `shortlog` `stash list` `remote -v`} | 其余子命令（`add` `commit` `push` `checkout` `reset` `clean` …）→ 写 |
| `sed` | **不含 `-i` / `--in-place`** | 带 `-i` → 写 |
| `jq` | 任意参数 | 纯读（输出走 stdout） |
| `xxd` `od` `base64`（解码形态）`hexdump` | 任意参数 | 纯读 |

### 3.2 保守降级规则（白名单否决项）

以下任一命中，即使命令名在白名单内也**不按只读**（整 argv 落入写分类，走模式默认分层）：

- **解释器 eval 形态**：`python` / `python3` / `node` / `ruby` / `perl` 带 `-c` / `-e` 或脚本文件参数——可做任何事，一律写（语义单一，可经 allow / deny 规则精确加减）。
- **shell 元字符出现在任一参数中**：`|` `;` `&&` `||` `>` `>>` `<` `` ` `` `$(` `${`——argv 直传下这些 token 是无害的**字面参数**，但保守按写处理：一是防止未来若出现 shell 化执行路径时分类表变成隐患；二是模型把复合命令塞进单参数本身说明意图是复合写。
- **已知写动词**：`cp` `mv` `ln` `touch` `mkdir` `rmdir` `tee` `truncate` `install` `chmod` `chown` `curl` `wget` `scp` `rsync` `npm` `pnpm` `yarn` `cargo`（`build`/`install` 等，纯 `cargo --version` 归白名单形态另列）`make` `tar`（含 `-c` 形态）`ssh` `kill` `launchctl` 等——整表见实现，原则：**拿不准就写**。
- **未知命令**（三表皆未命中）：**写**（保守默认）。错误方向是「多问一次」，不是「误放行」。

### 3.3 危险黑名单（首版，裁决点 3）

命中即 Ask（批准闸），任何档都不自动放行，也**不静默 Deny**——用户在批准卡里看得到完整命令：

| 形态 | 成员 |
|---|---|
| 包装器类（tower 已裁决：内容不可知即视同潜在危险） | `sh` `bash` `zsh` `dash` `fish` `csh` `ksh` `cmd` `powershell` `pwsh` `osascript` `eval` `exec`——shell 包装器的全部用途是组合任意命令，黑名单对其内部完全不可见（`bash -c "rm -rf …"` 的命令名是 `bash`）；归写则 full_access 档免闸，是唯一绕开黑名单的口径洞 |
| 删除类 | `rm`（任何形态——`rm -rf` 是 Alex 点名的那类，保守收到全命令名） |
| 关机/重启类 | `shutdown` `reboot` `halt` `poweroff` |
| 磁盘类 | `mkfs` 系（`mkfs.ext4` 等前缀）`fdisk` `diskutil`（带 erase/Partition 形态）`parted` |
| 裸写类 | `dd` |
| git 破坏类 | `git reset --hard`、`git clean`（任何形态） |

黑名单与白名单的交集（理论上不应存在）按黑名单处理（更保守侧赢）。**包装器类不走进 §4 的 vault 写重定向**——它停在危险层（Ask，任何档都问），不会以「写」身份被 full_access 自动放行；这是「危险命令黑名单任何档都问」对不可验证内容的直接推论（Alex 分界已确认的推论，tower 2026-10-09 裁决，不新增裁决点）。

**间接调用包装器递归（M413 增补，2026-10-10 Alex 裁决「堵」）**：`sudo` / `xargs` / `find` 的 `-exec` / `-execdir` / `-ok` / `-okdir` 是第二类包装形态——命令名字面匹配会让 `sudo rm` 落「未知 ⇒ 写」被 full_access 免闸，绕过整张黑名单。裁决修法：递归提取被包装命令（sudo/xargs 跳过自身 flag，`find -exec` 取 flag 后一 token 到 `;` / `\;` / `+` 终止符）再进本管线分类——`sudo rm` 视同 `rm`（危险）、`sudo ls` 视同 `ls`（只读，不得误伤）、`sudo make` 视同 `make`（写）。取不出确定形态（裸 `sudo` / 无命令 `xargs` / 子句无终止符）保守归危险（任何档都问，宁多问勿漏拦）。递归只在名单内展开、不做通用 shell 语义解析，且先于 shell 元字符保守规则判定（`sudo bash -c "a;b"` 按被包装命令判危险，不因外层参数带元字符落「写」）。

### 3.4 批准卡命令用途说明（purpose 字段）

Alex 原话需求（2026-10-09，节点 1 前并入）：「让询问我的时候，除了命令本身，还请告诉我它是干什么的。因为 AI 写的命令经常会组合 cmd1; cmd2 && cmd3 ...，人工检查非常困难，特别是 python 这样的 eval 代码。」

- **首选机制 = 工具 schema 必填 `purpose`**：cli_run 工具定义增加必填字符串字段 `purpose`——模型发起调用时用一句人话自述这条命令是干什么的。这是 Claude Code 的 Bash description 同款手法：描述是**调用的一部分**，随工具调用一起生成，不是事后补注。schema 层 `required: ["command", "purpose"]`。
- **批准卡呈现**：ask 档批准卡在 CLI 命令上方显眼位置展示 purpose 句；命令原文完整可见，MUST NOT 被 purpose 替代或截断。purpose 的存在把「读命令猜意图」变成「先看用途句再核对命令」，直接降低复合命令与 eval 代码的人工检查成本。
- **信任边界（写明，防误读）**：purpose 是**模型自述**，是阅读辅助，**不是安全判据**——§1 判定管线的每一层（分类、重定向、黑名单、allow、模式）都只看 argv 本身；模型可能写错甚至写粉饰性的 purpose，审批人仍以命令原文为准。批准卡的「采纳」决策指向命令，不指向 purpose。
- **vault 类写工具倾向不加 purpose**：`vault_create` 有目标路径 + 全文 diff、`vault_patch` 有路径 + 唯一命中 diff、`vault_move` 有源 → 目标、`vault_delete` 有路径 + 废纸篓说明——参数面与预览已自解释，人工检查成本本来就低；加 purpose 是冗余字段，还会稀释 cli_run 上 purpose 的显眼度。dogfood 若证明 vault 写也需要说明，届时再议（本期不加）。
- **兜底：空 purpose 拒绝补填**：purpose 缺省或 trim 后为空白串时，调用 MUST NOT 执行——校验点在工具调用入口（判定管线之前，ask 档批准卡必须已有 purpose 可展示），按既有统一错误信封结构化回送（人话 message 指明「需补填 purpose 用途说明」），模型补填后重发。trim 后空白与缺省同等拒绝（防空格绕过必填）。复用既有错误回送机制，不新造通道。

## 4. vault 写硬引导（重定向协议）

### 4.1 识别口径

第 2 层只对**分类为写**的 cli_run 生效，判定其写目标是否解析进 vault 内：

- **写目标提取**（按命令族的参数形态，取「被写的一侧」）：`cp` / `mv` / `ln` 的全部路径参数（源与目标都提取——源在 vault 内同样是 vault 资产）；`sed -i` 的非 flag 文件参数；`tee` / `truncate` / `touch` / `mkdir` 的路径参数；`dd` 的 `of=` 值；`curl -o/--output`、`wget -O` 的值；字面重定向 token（`>` `>>`）后的参数。
- **vault 内判定**：目标经词法规范化（去 `./`、拒绝/检出 `..` 逃逸）后满足任一条即算「进 vault」：① 绝对路径且落在 vault 根之下；② vault 相对路径形态（不以 `/` 开头且不以 `..` 起首）且该路径在 vault 内**已存在**或父目录在 vault 内存在。② 的存在性检查防止把 `build.sh` 这类显然指向 vault 外 cwd 的相对路径误伤；判定不确定时**不重定向**（落回正常写分类），重定向只在我们有把握时出手——宁漏勿错。
- cli_run 进程 cwd 是 app 进程工作目录（`tools.rs` 现行 spawn 不设 `current_dir`），不是 vault 根——这是 ② 需要存在性佐证的原因，design 如实写明。

### 4.2 回送形态（DeepSeek 式固定标记）

拒绝结果 = 特定错误码 + 人话前缀 + 固定标记包裹的结构化载荷：

```
错误码: cli_redirected_to_vault_tool
回送文本:
写目标在 vault 内（notes/a.md），已被闸门改道：请改用 vault 工具完成 vault 内写操作，
不要经 cli_run 写 vault。可用工具：vault_patch（局部替换）/ vault_create（新建）/
vault_move（移动/重命名）/ vault_delete（删除）。
<<<LUMIR_REDIRECT_VAULT_TOOL>>>
{"reason":"write_target_in_vault","targets":["notes/a.md"],"suggested_tool":"vault_move"}
<<<END_LUMIR_REDIRECT_VAULT_TOOL>>>
```

- 标记串与错误码是常量，载荷 JSON 字段固定（`reason` / `targets` / `suggested_tool`），实现单测逐字节钉死（含反向验证：改一个字符断言必红——REVIEW.md 第 1 条纪律）。
- `suggested_tool` 按写目标形态给建议：`mv`/`cp`→`vault_move`，`rm`→`vault_delete`，`sed -i`/重定向→`vault_patch`，`touch`/新文件→`vault_create`，`mkdir`→`vault_create`（建目录由 `vault_create` 自动建父目录的 `mkdir -p` 语义吸收，不另立目录工具）；给不出明确对应时缺省，只回原因与 targets。

### 4.3 模型换工具后的重试路径

闸门**不做自动翻译**（不把 cli argv 改写为 vault 工具调用——那是第二事实源，REVIEW.md 第 8 条）。重试全靠模型自己：读到带固定标记的 tool result → 下一轮发起对应 vault 工具调用 → 按 §2 语义表放行（Vault Write / Full Access 档直接执行）→ 循环继续。验收用 mock provider 脚本钉这条链：fixture 先调 `cli_run("mv", …)`，收到重定向结果后改调 `vault_move`，断言两者都发生且 vault 内最终态正确。

## 5. vault_move 与 vault_delete

### 5.1 工具定义草案

`vault_move`：

```json
{
  "name": "vault_move",
  "description": "移动/重命名 vault 内条目（可跨目录；不会覆盖既有条目；目标父目录必须已存在）。",
  "parameters": {
    "type": "object",
    "properties": {
      "path":       {"type": "string", "description": "vault 相对路径（源）"},
      "new_path":   {"type": "string", "description": "vault 相对路径（目标，含新末段名）"}
    },
    "required": ["path", "new_path"]
  }
}
```

`vault_delete`：

```json
{
  "name": "vault_delete",
  "description": "删除 vault 内条目：移入系统废纸篓（可经 Finder 恢复），不提供永久删除。",
  "parameters": {
    "type": "object",
    "properties": { "path": {"type": "string", "description": "vault 相对路径"} },
    "required": ["path"]
  }
}
```

- 权限主体串：两工具都取 `path` 参数原文——既有前缀规则语法（`vault_move(drafts/*)` 等）零改动可用。
- 批准预览（ask 档）：vault_move 显示 `源 → 目标` 路径对；vault_delete 显示路径 + 一句「将移入系统废纸篓，可恢复」。
- 结果信封沿用统一口径：成功 `{"ok": true, "path": …}`；失败带错误码回送模型重试（`fs_not_found` / `fs_already_exists` / `fs_path_escape` 等，全部复用 fs-io 既有错误码，不新造）。

### 5.2 fs_move_entry（fs-io 原语）

```rust
pub fn fs_move_entry(root: &Path, from_rel: &str, to_rel: &str) -> Result<String, CommandError>
```

- 源走 `resolve_in_vault`（全部逃逸防护），目标端：父目录走 `resolve_in_vault`、末段名走 `validate_new_name`（与 `rename_entry` / `create_*` 同一套）。
- MUST NOT 覆盖：写路径复查目标存在（`symlink_metadata`），与 rename 同口径——「撞名不覆盖」是「复查 + 极窄窗口」，不是原子保证（既有注释的同一句话搬过来，不读成更强的东西）。
- 跨卷：`std::fs::rename` 跨卷直接失败 → 如实报 `fs_move_failed`，**不做**静默 copy+delete（半失败状态不可接受）。
- **目标父目录不隐式创建**（`fs_move_entry` 保持「父目录必须已存在」）；**建目录不另立工具**——`vault_create` 自动创建缺失的父目录（`mkdir -p` 语义）：模型要建目录时经 `vault_create` 在目标目录下落一个文件即连带建出父目录，`cli_run mkdir`（写目标在 vault 内）由 §4 重定向层改道 `vault_create`（映射见 §4.2）。M404 survey 提出的 mkdir 缺口据此裁掉（Alex 2026-10-09 裁决）。
- **tab 联动**：app 内移动命中打开中的文档时，前端按 watch 增量事件流既有口径就地 remap 打开 session 路径（与 rename 同路，不新造通道）。

### 5.3 vault_delete 的档行为

按裁决点 1 落表（落 B：Vault Write 档仍逐个问、Full Access 档放行）；`read_only` 档同为**逐个问**（§2 的 Always Ask 口径，2026-10-09 Alex 裁决后不再拒绝）。无论哪档：**永久删除路径不存在**——工具底层只有 `trash_entry`，`rm -rf` 式的不可恢复删除在本工具集里物理上做不到。

## 6. 会话内批准缓存（同类不再问）

- **键**：`(工具名, 主体串)`——cli_run 主体串 = 规范化后拼接 argv（多空格折叠、首尾 trim）；vault 工具 = `path` 原文。精确串匹配，不做前缀泛化（前缀泛化等于悄悄放大授权面，探针期不取）。
- **生命周期**：会话内存态（Rust core 的 Session 上加字段），「新会话」/ 切 vault 切会话 / app 重启即清；不落盘、不进 JSONL 留存（JSONL 照常记 approval sidecar，缓存只是运行时的免问索引）。
- **UI（裁决点 4 倾向 A）**：批准卡在既有「采纳 / 拒绝」外提供一个次级动作「采纳且本会话不再问」。点采纳 ≠ 记缓存；免问是用户逐次显式给的。
- **与模式分层的关系**：缓存命中在判定管线第 5 层（模式默认分层）内短路——deny 规则、重定向、黑名单三层永远先于缓存（缓存不解锁这三层；黑名单成员问多少次也不会因缓存放行）。
- **边界**：turn 停止 / 批准被覆盖等既有中断语义不变，缓存不因此失效（已批准的合法决定不因中断回收）。

## 7. 模式切换：UI 与配置

- **配置键**：`[harness].permission_mode`，闭集合 `read_only` / `vault_write` / `full_access`，默认 `vault_write`。校验沿用既有模板：闭集合外取值回落默认 + 人话 warning；类型不符整文件回落。运行期写回经 `config_set_value(section, key, value)`（与模型 chip / 思考 chip 同路）。
- **UI 入口**：composer 控制行新增权限 chip，位于模型 / 思考合并选择器 chip 之后、ctx 读数之前（M373 起模型与思考合并为一个 chip，「思考 chip 之后」的旧表述随之改准）。**文案分两级**（Alex 2026-10-09 裁决，原「chip 显示全名」口径作废）：
  - **chip = 短名**（zh：只读 / 可写 / 完全；en：Read / Write / Full，走文案表）——控制行被合并选择器 chip 与权限 chip 共同挤占，短名才保证三档都能完整显示。zh 短名「写入」于 2026-10-10 批复改为「可写」（M417）。
  - **浮层列表项 = 全名**（zh：只读 / 保险库写入 / 完全访问；en：Read Only / Vault Write / Full Access）——全名只在浮层里出现一次，那里宽度不受控制行约束。
  - Alex 原话：「三档在 chip 里能完整显示名称吗？如果不能，可以减省成 Read / Write / Full，然后在点击出现的选择列表里写全名」。
- **浮层结构**：三档单选、当前档勾选、**每档一行释义**（Kimi 风格：档名短、语义易混，一行释义消歧档名与实际行为的偏差；原「无释义文案」口径作废）。释义口径（措辞可在实现批次微调，语义方向以此为准）：
  - `read_only`：「读自动放行；写操作都先问你」/ "Auto-approve reads; asks before every write"
  - `vault_write`：「库内写自动放行；库外命令先问你」/ "Auto-approves vault writes; asks before shell commands"
  - `full_access`：「全自动；仅危险命令仍问你」/ "Fully automatic; only dangerous commands still ask"
- **浮层形态**：与思考 chip 浮层同一形态（M373 合并选择器的视觉语言）。
- **生效时点**：切换对**下一个判定**生效，不打断进行中的轮次（与模型 chip「切换对下一轮生效」同口径）；进行中的轮次按开轮时的模式判完。
- **浮层可访问性**：复用既有浮层口径（`role="menu"` / `menuitemradio` / `aria-checked`，M373 纪律），不新造交互形态。
- 会话名 / 标题栏不动；权限 chip 是控制行的第三个 chip（模型 / 思考 / 权限），控制行排布在窄面板下的截断口径沿用 chip 的既有 ellipsis 规则。

## 8. 验证方法

- **分类器单测（Rust，核心判据）**：三表成员逐一正反例（`ls -la`→只读、`sed -i`→写、`sh -c cat x`→危险、参数含 `&&`→写、未知命令→写、`git status`→只读 / `git push`→写）；反向验证：把任一白名单成员的期望改坏断言必红。包装器钉死用例：`bash -c "rm -rf …"` 在 `full_access` 档仍进批准闸（r1 P2-2 的口径洞回归）。
- **判定管线集成测试（mock provider）**：三档 × 五类调用面的全矩阵（§2 语义表逐格一个用例，`read_only` 档的写操作按 Always Ask 断言「进批准闸 + 拒绝后磁盘不变」）；deny 规则在只读档仍第一、黑名单在 full_access 档仍问、allow 规则在只读档仍生效（裁决点 5 的落法钉死）。**只读档的批准窗 CAS 用例**（2026-10-09 修订后该路径重新可达）：`vault_patch` 批准卡挂起期间文件被外部改 ⇒ 采纳执行以预览基准走 CAS、`document_conflict` 回送模型、磁盘不与已批准 diff 分叉。
- **重定向链测试（mock provider 脚本，§4.3）**：`cli_run("mv", …)` 收重定向 → 改调 `vault_move` → 断言标记文本逐字节、建议工具正确、vault 终态正确；另测「判定不确定时不重定向」反例（vault 外相对路径写命令落正常写分类）。
- **新工具测试**：`fs_move_entry` 逃逸 / 撞名 / 跨目录 / 跨卷失败四例；`vault_delete` 进废纸篓与失败不留半态；工具定义经 mock provider 一轮断言 `execute` 路径。
- **缓存测试**：同主体串二次调用免闸、新会话清空、黑名单成员不受缓存放行。
- **purpose 链测试**：mock provider 断言带 purpose 的 cli_run 调用在批准卡载荷中 purpose 与命令同达；空 purpose（缺省 / 空白串）不执行且回送补填错误、模型补填后重发成功；同一命令带粉饰性 purpose 与否判定结果相同（信任边界的负向用例）。
- **配置测试**：`permission_mode` 缺省 / 非法回落 / `config_set_value` 写回。
- **验收场景（scripts/acceptance，fixture 合成）**：模式切换 chip 与浮层（真机 AX 口径；chip 断言短名、浮层断言三档全名与每档一行释义）、批准卡「采纳且本会话不再问」、批准卡 purpose 用途句展示（命令上方显眼位置、原文完整可见）、重定向场景一轮（mock 驱动 §4.3 链）、vault_move / vault_delete 面板呈现。视觉效果不动者免视觉门禁。

## 9. 明确不实现（防 scope 蔓延）

OS 沙箱、批准卡写永久规则、vault_append、cli_run shell 化、按 vault / 按工具细分模式、网络管控、批准闸呈现改造。详见 proposal Non-goals。
