# Design: 权限规则入口与 shell 包装器受限解包

- Change ID: `harness-permission-rules-oct23`
- 日期: 2026-10-23
- 分支基线：master `ba98587d`（文档里所有行号都是起草时在该基线上逐一读过原文的位置；行号会
  漂，实现前以符号名为准）

本文只写「怎么做到 proposal 已裁的行为」与「为什么这样做」。所有安全关键判据都按**输入分布**
表述（任意脚本 / 任意 argv），不按案例打补丁。

## 0. 事实清单（起草时核对过原文）

调研底稿（`.local/reports/2026-10-23-agent-permission-models-survey.md`）的 file:line 锚点在当前
master 上逐条核对，结论：**全部成立**，仅个别行号有 ±1 漂移（下表取实测值）。

| 事实 | 锚点（master `ba98587d`） | 与本 change 的关系 |
|---|---|---|
| 五层判定管线：deny > vault 内写重定向 > 危险黑名单 > allow > 模式默认 | `src-tauri/src/harness/permissions.rs:112-175` | 解包只改变分类结论，不改层序 |
| 危险黑名单层先于 allow 与缓存 | `permissions.rs:139-145`、`:147-150`、`:152-155` | 死按钮的根因；本 change 不改层序，只藏按钮 |
| 只读白名单 28 条 / 已知写 24 条 / 解释器 / shell 包装器 13 条 | `permissions.rs:250-254`、`:259-285`、`:289`、`:294-308` | 解包的子命令判定直接复用这套表 |
| shell 元字符保守归写（含 `|` `;` `&&` `>` 等） | `permissions.rs:320-325`、`:349-355` | 解包形态必须绕开这条（否则 `;` 先把整条判成写），见 §2.4 |
| `classify_cli` 判序：危险 → 间接包装器递归 → 解释器 → 元字符 → 写表 → 条件只读 | `permissions.rs:327-392` | 解包插在「危险」判定处，见 §2.4 |
| 间接包装器递归（sudo / xargs / find -exec） | `permissions.rs:467-598` | 与解包共用递归深度预算 |
| git 只读子命令判据跳过全局 flag | `permissions.rs:604-673` | 解包后仍是同一判定（不改具体子命令表） |
| 规则匹配 = tool 级等值 + `tool(模式)` 的**主体串前缀 + 结尾 `*`** | `permissions.rs:955-1010` | 前缀规则零新增语法；只补 Q2 的等值容差 |
| allow 规则绕不过黑名单（测试钉死） | `permissions.rs:1111-1126` | D3 的既有保证，本 change 保持 |
| 会话缓存的键 = `(工具, 规范化主体串)`，精确匹配 | `src-tauri/src/harness/permission_cache.rs:55-72` | A3 改前缀粒度；命名空间与生命周期不变 |
| 缓存只在第 5 层短路，切严档不回收 | `permission_cache.rs:11-15`；`permissions.rs:1937-1958` 的测试注释 | 现有语义，本 change 不改（design §3.4 明写） |
| 批准请求恒 `remember: true` | `src-tauri/src/harness/turn.rs:1325-1336` | 死按钮的直接成因；改为按判定依据派生 |
| 缓存的唯一写入点在 gated_execute | `turn.rs:1368-1370` | persist 写入点也在同一处语义邻近位置 |
| 快照镜像 `remember` 到前端 | `src-tauri/src/harness/session.rs:449-453`、`:460-471` | 需一并扩展为两枚次级动作 |
| `harness_approve(request_id, approved, reason, remember)` | `src-tauri/src/harness.rs:1607-1619` | 需扩展 persist 参数（Q5） |
| 配置写回是「读→合并→原子写」，支持点分路径，值为整值替换 | `src-tauri/src/commands.rs:606-617`、`:631-667`、`:672-706` | 数组键整表替换 → 前端做数组读改写会丢更新（Q5 的论据） |
| `HarnessPermissions { allow, deny }`（配置层只保形状） | `src-tauri/src/config.rs:1193-1196` | 规则持久化的落点，无 schema 变更 |
| `cli_run` 直传 argv、无 shell；登录 PATH 已注入 | `src-tauri/src/harness/tools.rs:1213-1222` | A4 提示词的事实基础 |
| 批准预览 / 主体串 / purpose 校验 | `tools.rs:364-414`、`:470-484`、`:486-560` | 前缀生成取 argv，不取拼接串 |
| identity.md 工具纪律段 | `src-tauri/src/harness/prompts/identity.md:8-9` | A4 的落点 |
| 前端批准卡两处渲染（事件 / 快照恢复）都有 remember 按钮 | `src/harness-panel.ts:7115-7124`、`:7690-7700` | 两处都要按新字段渲染 |
| 权限浮层三档单选 + 边界收编 | `src/harness-panel.ts:5676-5707`、`:5729-5748`；`src/harness-panel.css:1356-1428` | 规则列表挂在这里 |
| 按钮文案 D434 | `src/copy-data.ts:1319-1322` | 文案改为带前缀参数 |
| living spec 口径：Purpose 与「权限机制」都写「三层规则（allow / ask / deny）」 | `openspec/specs/harness/spec.md:10`、`:148` | 顺带项：requirement 在 delta 里改准，Purpose 归档时改 |
| living spec：包装器 SHALL 归危险 | `openspec/specs/harness/spec.md:837` | A2 要改的那句 |
| living spec：缓存精确匹配 | `openspec/specs/harness/spec.md:901` | A3 要改的那句 |
| acceptance 场景 151 用 `zsh -lc "echo HNA-WRAP"` 当包装器样本 | `scripts/acceptance/scenarios/151-harness-approval-reason.md:36-45`、`:101`、`:109` | A2 后它变成只读、不再出卡——必须换样本（tasks 4.1） |

## 1. 判定管线与改动落点

管线层序与结论语义**一律不变**（这是本 change 的安全底线）。四处落点：

```text
1. deny 规则命中              → Deny            [不变]
2. vault 内写 → Redirect      → Redirect        [不变]
3. 危险黑名单                → Ask             [解包：仅「整条脚本全只读」时分类提前变为 ReadOnly，压根到不了这层]
4. allow 规则命中            → Allow           [匹配语义补一处等值容差，见 §3.3]
5. 模式默认分层 + 会话缓存     → Allow / Ask     [缓存键从整条命令改前缀，见 §3.4]
```

- 分类器（`classify_cli`）仍是**唯一**的分类真源：解包只往它里面加一条判定分支，子命令逐个
  回到同一个函数（`REVIEW.md`「同一语义两处真源」条）。
- 判定依据（`DecisionReason`）不变：解包成功即自动放行（无依据可讲）；解包失败照旧是
  `DangerousWrapper`。

## 2. A2 · shell 包装器受限解包

### 2.1 形态判据（先决条件，全部满足才尝试解包）

输入是 `cli_run` 的 argv（`command` + `args`）。满足以下**全部**条件才进入脚本解析：

1. `argv[0]` 的 basename（去路径、小写）∈ `{sh, bash, zsh, dash}`。
   `fish` / `csh` / `ksh` / `cmd` / `powershell` / `pwsh` / `osascript` / `eval` / `exec` 不解包，
   维持危险（它们的 flag 语义与 `-c` 组合形态各异，收益小、判据难写死）。
2. `argv.len() == 3`（包装器 + flag + 唯一脚本参数）。`bash script.sh`（脚本文件）、
   `bash -lc a b`（多参数）、裸 `bash` 一律不解包。
3. `argv[1]` 是单个短 flag：以 `-` 开头、不以 `--` 开头、去掉 `-` 后的字符集 ⊆ `{l, c}` 且含 `c`。
   即接受 `-c` / `-lc` / `-cl`；`-x` / `-e` / `-o pipefail` / `--login -c` 等形态不解包。

不满足 → 维持现状（危险，任何档都问）。

### 2.2 脚本词法（保守子集）

脚本按字符扫描，产出「子命令 × argv」列表：

| 字符 / 形态 | 处理 |
|---|---|
| 空格 / 制表 | 词边界 |
| 换行 / `\r` | **失败**（多行脚本一律不解包——最容易藏东西的地方） |
| `'…'` | 单引号内的全部字符按字面并入当前词；未闭合失败 |
| `"…"` | 双引号内的普通字符与空格按字面并入当前词；内含 `$` / 反引号 / `\` 失败；未闭合失败 |
| `;` | 子命令分隔 |
| `&&` / `\|\|` / `\|` | 子命令分隔（管道与逻辑连接在分类上等价：每个子命令都要过只读判定） |
| `&`（非 `&&`） | **失败**（后台执行） |
| `2>/dev/null`、`>/dev/null`、`1>/dev/null`、`2>&1` | 在**词边界**处优先匹配这四个字面量（含前导 fd 数字），命中即整段丢弃、不参与子命令 argv；`> /dev/null` 这种空格分隔形态 v1 不接受（fail-closed，多问一次） |
| 其余 `>` / `>>` / `<` | **失败**（写文件 / 读任意文件） |
| `$` / 反引号 / `(` / `)` / `{` / `}` / `\` | **失败**（变量、命令替换、子 shell、分组、转义都超出保守子集） |
| 其余字符（含 `*` `?` `[` `]` `#` `=` `:` `,` `.` `/` `-`） | 按字面并入当前词 |

补充口径：

- 重定向识别必须先于其它字符判定：`2>&1` 里的 `&` 与 `2>` 里的 `>` 都不得触发「后台 / 非白名单
  重定向」的失败分支——实现上按「词边界 → 依次试四个字面量 → 再走通用词法」的顺序即可。
- `#` 按字面处理是**保守**的：shell 把它当注释时（`ls #; rm -rf /`），我们仍会在 `;` 处切出
  `rm -rf /` 并判危险——误的多问一次，不会误放行。
- glob 字符按字面处理也保守：解包只用于**分类**，真正执行仍是 `bash -lc <script>` 由 shell
  展开；展开只影响只读命令的实参，不会把只读变写（能把只读变写的形态——`find -delete`、
  `sed -i`、`git` 的写子命令——都按字面 token 进了既有的条件判定）。
- 空子命令（`;;` / 首尾分隔符 / 只有重定向没有命令）→ 失败。

### 2.3 失败清单（fail-closed，维持危险）

以下任一出现即放弃解包（整条按危险处理，任何档都问）：

1. §2.1 的形态判据不满足；
2. §2.2 表中任一「失败」项；
3. 子命令数 > 16 或脚本字节数 > 4096（解析成本上限，非安全语义）；
4. 任一子命令 `classify_cli` 的结果不是 `ReadOnly`（含未知命令、`cd`、解释器、写动词）；
5. 嵌套包装器深度 > 2（`bash -lc "bash -lc \"ls\""` 是 2 层；再套一层失败）。

### 2.4 分类归属与递归

```text
classify_cli(argv, depth):
    若 argv 命中「可解包包装器形态」：
        unpack_script(script) 成功 且 全部子命令 classify_cli(sub, depth+1) == ReadOnly
            → ReadOnly
        否则 → Dangerous          ← 注意：不是 Write
    其余路径与现状逐字节一致（危险 → sudo/xargs 递归 → 解释器 → 元字符 → 写表 → 条件只读）
```

三条硬约束：

1. **只降不升**：解包只把「危险」降为「只读」，**唯一**的放宽方向。任何失败都停在危险，
   MUST NOT 降为「写」——否则 `bash -lc "mkdir x"` 会在 `full_access` 档被静默放行（现状是问），
   等于夹带了一次权限放宽（Q4）。
2. **元字符规则的适用面**：对解包形态，`SHELL_META` 那条保守规则 MUST NOT 先行生效（否则脚本里
   的 `;` `|` 会先把整条判成写）；取而代之的是 §2.2 / §2.3 的逐子命令判定。对**非**解包形态，
   元字符规则一字不动。
3. **递归预算**：`classify_wrapped`（sudo / xargs / find -exec）与解包共用同一个 `depth` 参数，
   公共入口 `classify_cli` 传 0；超预算一律危险。既有的 `sudo sudo …` 递归行为不变
   （它们本来就逐层吃掉 argv 而终止，加预算是防御性上限）。

### 2.5 为什么这不扩大既有风险面

解包只把「包装器 + 全只读子命令」降到**与直接调用相同的分类**——同样的命令直接调用本来就已经
免问。它不新增任何白名单成员，也不改任何子命令的判定表。因此：

- 既有白名单成员自带的能力（`sed` 的 `w` 脚本命令、`rg --pre`、`git -c core.pager=…`）在解包
  前后是同一个面和同一个分类，本 change 既不扩大也不收窄；这类面另行登记 finding（见 §8）。
- 解包不跨越层：deny 规则仍按整条主体串先判；allow 规则仍绕不过危险层。

### 2.6 测试面（表驱动 + 反向验证）

正例（必须判 `ReadOnly`）：

| 输入 | 说明 |
|---|---|
| `bash -lc "ls -la 2>/dev/null; echo ---; ls docs \| tail -5"` | Alex 的原现场 |
| `sh -c "cat a.md >/dev/null"` | 白名单重定向 |
| `zsh -lc "rg foo notes \| head -20 2>&1"` | 管道 + 流合并 |
| `bash -c "git status"` / `bash -lc "git diff --stat"` | git 只读族 |
| `bash -lc "bash -c \"ls\""` | 嵌套恰好 2 层 |

反例（必须判 `Dangerous`，且 `decide` 在 `full_access` 档也产 Ask）：

| 输入 | 失败原因 |
|---|---|
| `bash -lc "ls; rm -rf /tmp/x"` | 子命令非只读 |
| `bash -lc "mkdir x"` | 非只读 → 危险（**不是**写） |
| `bash -lc "ls > notes/a.md"` | 非白名单重定向 |
| `bash -lc "cat < /etc/passwd"` | `<` |
| `bash -lc "ls $(rm -rf /)"` / `bash -lc 'echo $HOME'` | 变量 / 命令替换 |
| `bash -lc "ls & rm x"` | 后台 `&` |
| `bash -lc $'ls\nrm -rf /'` | 换行 |
| `bash script.sh` / `bash -x -c "ls"` / `bash -lc "ls" extra` / 裸 `bash` | 形态不满足 |
| `bash -lc "cd docs && ls"` | `cd` 不在只读白名单（已知边界，刻意保守） |
| `bash -lc "bash -c \"bash -c 'ls'\""` | 嵌套超深 |
| `bash -lc "ls \| xargs rm"` | 子命令 `xargs rm` 经间接包装器判危险 |

反向验证（`REVIEW.md`「断言等价于子串」条的纪律）：每条正例都要配一条只差一个字符的反例
（把 `;` 改 `&`、把 `>/dev/null` 改 `>/dev/null2`、把 `ls` 改 `ls2`），证明放宽不是靠子串巧合。

## 3. A1 / A3 · 前缀生成器（单一真源）

### 3.1 生成规则

一个函数产出两种产物，两处消费者：

```rust
/// 返回 (会话记忆的粒度标签, 持久规则文本)
fn permission_prefix(tool: &str, argv: Option<&[String]>, subject: &str) -> Option<(String, String)>
```

| 工具 | 前缀 | 规则文本 | 会话记忆 |
|---|---|---|---|
| `cli_run` | `argv[0]` + 第一个非 flag 参数（且该参数在下标 1）；下标 1 是 flag 或无参数时退化为 `argv[0]` | `cli(<前缀> *)` | 前缀（词边界） |
| `vault_patch` / `vault_create` / `vault_move` | 路径含 `/` 时取目录段（含尾斜杠），否则整段路径 | `tool(<目录>/*)` 或 `tool(<路径>)` | 精确路径 |
| `vault_delete` | —— | **不提供** | 精确路径（现状） |
| `cron_task_create` / `cron_task_remove` | —— | **不提供** | 精确主体串（现状） |
| 其余（读类，永不过闸） | —— | 不提供 | 不涉及 |

- `cli_run` 的前缀取 argv 原文（不取 basename、不小写）：规则匹配是**文本**前缀，与主体串同一份
  字面量；把 `/usr/bin/tvly` 生成成 `cli(tvly *)` 会匹配不上而制造假免问。
- 第二词是 flag 时退化为单词前缀（例：`npm --version` → `cli(npm *)`）。按钮上逐字显示实际规则
  文本，用户能在按下前看到授权面比两词前缀宽。
- 已知边界：第二词是「命名空间动词」的 CLI（`npm run …` / `pnpm run …`）会一次覆盖同命名空间的
  所有脚本——记住 `npm run test` 等于记住 `npm run`，`npm run deploy` 也在内。这是两词前缀的固有
  宽度，缓解是按钮文案显示前缀本身（用户看见的是 `npm run`）。若 Alex 认为这类工具需要第三个词
  （脚本名 / 远端名），是 Q1 的备选 C，实现成本 +一条「命令 → 取词数」表。
- 规则与记忆标签用同一份计算：会话记忆标签 = 前缀本身；持久规则 = 前缀 + 星号。两处不可能
  漂移（`REVIEW.md`「同一语义两处真源」条）。
- 规则文本 MUST 是 `parse_rule` 可解析、且能真实命中的字符串：生成器遇到**换行**或空路径时返回
  `None`（不给按钮）；路径 / 前缀里的 `*` 等字符按字面匹配，最坏结果是规则失效（多问一次），
  MUST NOT 产生误放行。
- 已存在的同文规则不重复写入（去重按字符串全等）。

### 3.2 为什么不给 `vault_delete` / `cron_task_*` 生成

- `vault_delete`：删除进废纸篓可恢复，但「一次点击 = 以后所有删除都免问」的台阶过高；删除的
  打断成本正是设计里刻意保留的（`permissions.rs:216-222` 的注释口径）。保留会话内精确记忆已足够
  覆盖「连续删一批」的场景。
- `cron_task_*`：批准那一刻是用户唯一能看到「它以后每天会自己跑」的时机；持久 allow 等于把这个
  时机永久取消。
- 用户仍可手写这两类规则（配置层不拦），但界面不提供一键台阶。备选（若 Alex 要求一致）是把
  这两类放进列表，标注「持久」，实现成本不变。

### 3.3 匹配语义（Q2 的等值容差）

现有：`pattern.strip_suffix('*')` → `subject.starts_with(prefix)`。问题：`cli(git push *)` 的
prefix 是 `"git push "`，而恰好无参数的 `git push` 主体串没有尾随空格 → 匹配不上（同一条命令
第二次又问，像是按钮没记住）。

改动（唯一一处语义扩宽，且只扩到「完全相等」）：

```text
若 pattern 以 " *" 结尾：
    prefix = pattern[..len-1]        // 保留尾随空格
    match = subject.starts_with(prefix) || subject == prefix.trim_end()
否则：语义不变（等值 或 ..结尾* 前缀）
```

- 只在「星号前是空格」时生效 → 词边界语义不变。用户手写的 `cli(tvly*)`（星号前无空格）仍是旧的
  裸前缀语义（`tvly` 会命中 `tvlyx`）——那是既有行为，本 change 不改；生成器从不产出这种形态。
- 生成的规则恒写 `前缀 + " *"`（带空格），所以按钮上的规则文本与匹配行为一致可读。

### 3.4 会话记忆前缀化（A3）

- 存储仍是 `(工具, 键)` 的集合；键的形态自描述：**前缀键**以尾随空格结尾（`"tvly search "`），
  精确键不带尾随空格（`"notes/a.md"`）。
- 命中判定：词边界前缀键用与 §3.3 相同的 `prefix_matches`；精确键用全等。
- 命名空间、内存态、切会话清空、不落盘、只在第 5 层短路——**全部不变**。
- `permissions.rs:1937-1958` 记录的「切到更严档不回收会话授权」是现行语义，本 change 不改；
  前缀化会让这条语义的覆盖面变大（一次授权覆盖同前缀的多条命令），因此按钮文案必须写出前缀
  （§5 / §6.3），不给静默放大留口子。
- 缓存里的前缀键与持久规则是两套生命周期（会话 vs 全局），互不写入对方。

## 4. 规则持久化：形状、写回、并发

- 落点：`config.json` 的 `[harness].permissions.allow`（字符串数组，全局、跨 vault）。
- 写回通道（Q5 的倾向）：**后端单写者**。
  - `harness_approve` 增加 `persist_rule: Option<bool>`：`approved && persist_rule == Some(true)`
    时，后端从**待决请求**的 argv / subject 现算规则文本（MUST NOT 采信前端传入的文本），追加去重
    后原子写回，**然后**才 resolve 批准。写失败 → 返回错误、批准保持待决（用户可重试或普通采纳），
    MUST NOT 出现「调用执行了、规则没写」或「规则写了、调用没批准」的半态。
  - `harness_permission_rule_remove(rule: String) -> Result<bool>`：删第一条全等匹配并写回；
    不存在即返回 false（幂等）。
  - 读：浮层打开时走既有 `config_get` 现读，MUST NOT 用前端旧缓存。
- 并发：`config.rs` 增加一把进程级写锁，`write_config_value_to` 与两个规则写入口共用——今天
  权限档写回与规则写回是同一张 `[harness]` 表的两次「读→改→写」，不加锁就有丢更新窗口。
  这是顺手收口，不新增语义。
- 切断口径（AGENTS.md「变更默认直接切断」条）：`ApprovalRequest.remember` 的线上形状从
  `bool` 改为 `Option<String>` 并新增 `persist_rule: Option<String>`。消费者全部在仓内前端
  （下表逐点列全），没有外部消费者、没有持久化载荷（待决批准不落盘）——**直接切断，不做兼容层**。

  | 消费点 | 现位置（本分支基线 `ba98587d` 实测） | 改法 |
  |---|---|---|
  | 批准卡渲染 · 事件路径 | `harness-panel.ts:7115-7124`（`request.remember !== false`） | 按字段 `!= null` 渲染；文案带粒度 |
  | 批准卡渲染 · 快照恢复路径 | `:7690-7700`（`request.remember`） | 同上 |
  | 事件载荷归一化 | `:8162`（`event.remember !== false`） | `typeof … === "string" ? … : null`；`persist_rule` 同款解析 |
  | 父会话待决快照归一化 | `:8655`（`pending.remember !== false`） | 同上 |
  | 子运行快照归一化 | `:8002`（`value.remember !== false`，`parseTaskApproval`） | 同上 |
  | 语言切换重上文案 | `:6862-6863`（`button[data-act=approve-remember]` 重取 D434） | 两枚按钮都重上，插值取当前请求的粒度 / 规则文本 |
  | 事件路径 decide 链 | `:7153-7166`（`harnessApprove(…, remember ? true : undefined)`） | 决策时透传两个布尔（`remember` / `persist_rule`） |
  | 快照恢复路径 decide 链 | `:7702-7713` | 同上 |
  | 子运行 decide 链 | `:7726-7745`（`decideTaskApproval`） | 同上（子运行卡同样按字段渲染） |
  | 载荷类型声明 | `:3248`（`TaskApprovalRequest.remember: boolean`）、`:6991`（`remember?: boolean`） | 字段类型改为 `string \| undefined`（新增 `persistRule`） |

  **归一化的缺键语义 MUST 翻转**：现行三处归一化都是「缺键按可见处理」（`X.remember !== false`，
  M413 契约），新形状下缺键 / null MUST 归一为「不渲染」。不翻转的后果不是多一个按钮——危险卡
  经快照恢复会**复活死按钮**，正是 D3 要杀掉的形态。三处按 `rg 'remember !== false'` 全改，并补
  前端单测（缺键 / null 不渲染；危险卡快照恢复后仍无两枚按钮）。行号以本分支基线实测为准；评审
  首轮给出的 `:8096` / `:8256` / `:8749` 与表中三处归一化是同一批点（行号随基线漂移，按符号
  `remember !== false` 检索即可定位）。

## 5. 次级动作字段契约（死按钮）

`ApprovalRequest` 与 `PendingApprovalSnapshot`（两条 UI 通道同源）：

| 字段 | 形态 | 含义 |
|---|---|---|
| `remember` | `Option<String>` | `Some(prefix_or_path)` = 显示「采纳且本会话不再问（记住 `X`）」；`None` = 不显示 |
| `persist_rule` | `Option<String>` | `Some("cli(tvly search *)")` = 显示「以后都允许 `cli(tvly search *)`」；`None` = 不显示 |

派生规则（`turn.rs` 的 `gated_execute` 一处产出，前端只渲染）：

```text
reason 是 DangerousWrapper / DangerousCommand （第 3 层）
    → remember = None, persist_rule = None        // D3：危险层两枚都不给（都是死按钮）
其余进闸（第 5 层模式默认分层）
    → remember = Some(§3.1 的粒度标签)
      persist_rule = §3.1 的规则文本（vault_delete / cron_* 为 None）
```

- 解包成功的调用根本不过闸，不产生卡片，也就谈不上按钮。
- `ApprovalDecision` 增加 `persist_rule: bool`；`harness_approve` 的入参同步增加
  `persist_rule: Option<bool>`。
- 前端渲染：字段缺省 / null 一律不渲染按钮（`REVIEW.md`「值或开关声明了却没有消费者」的镜像：
  这里反过来，字段是渲染的唯一开关，前端 MUST NOT 按 reason.kind 自行推断）。

## 6. 前端：批准卡按钮与浮层规则列表

### 6.1 批准卡

- 现有次级动作行（`.lumir-hp-approval-remember`）改为最多两枚按钮并列：
  「采纳且本会话不再问（记住 `X`）」与「以后都允许 `X`」。两枚都存在时同行、等宽、次级视觉
  （低于「采纳 / 拒绝」主决策）。
- 点击「以后都允许」= 采纳 + 写规则（一次点击两个效果，规则文本就在按钮上，无需二次确认）。
- 两处渲染点（事件 `:7115-7124` 与快照恢复 `:7690-7700`）共用同一段构建函数，禁止各写一份。

### 6.2 权限浮层

- 三档单选项下方加一条分隔线 + 段标题「已记住的规则」+ 规则条目列表：
  - 条目 = 规则原文（`--font-mono`）+ 右侧删除图标钮（`aria-label` 带规则原文）。
  - 列表为空 → 整段（分隔线 + 标题 + 列表）不渲染，浮层形态与现在逐像素一致。
  - 条目超过 6 条时列表区 `max-height` 滚动，浮层本体不超高（复用 `clampPermPop` 的收编）。
- 打开浮层时 `configGet()` 现读 `[harness].permissions.allow`；删除后重新取一次并重建列表。
- 删除即时生效：下一次判定就看不到该规则（后端每轮现读配置，无需重启）。

### 6.3 新增文案（zh / en 原文；D 编号在实现批次按当时最大号接续）

| 用途 | zh | en |
|---|---|---|
| 持久规则按钮 | 以后都允许 {rule} | Always allow {rule} |
| 带前缀的会话记忆按钮 | 采纳且本会话不再问（记住 {prefix}） | Approve and don't ask again this session (remember {prefix}) |
| 规则段标题 | 已记住的规则 | Remembered rules |
| 删除钮可访问名 | 删除规则 {rule} | Delete rule {rule} |

D434 保留原串作为「无前缀可显示」时的回退（理论上不会发生：过闸的 `cli_run` 恒有前缀、vault 工具
恒有路径；保留回退是为了字段缺省时不出现 `{}` 占位符）。

### 6.4 视觉口径（无原型，按既有 token）

- 规则条目沿用 `.lumir-hp-permpop-item` 的字号 / 内边距 / hover 底色；不加新色值。
- 分隔线 = 1px `var(--border)`，上下各 `var(--sp-2)`。
- 段标题用 `.lumir-hp-permpop-desc` 的字号档（`--fs-label-s`）与 `var(--text-3)`。
- 删除钮 = 图标钮，静息 `var(--text-3)`、hover `var(--text)`，尺寸 16px，右侧 `flex:none`；
  eink 主题下继承既有线宽规则（`.lumir-hp-permpop` 已有 1.4px 边框档）。
- 三主题（light / dark / eink）都只消费 token；动过 UI 后按纪律本地跑 `scripts/gate.sh visual`。

## 7. A4 · 提示词补充原文

在 `src-tauri/src/harness/prompts/identity.md` 的「工具使用纪律」段（现 `:8-9` 附近）追加三句，
措辞建议（实现批次可微调，语义方向固定）：

```text
- cli_run 直接传命令与参数、不经过 shell；登录 shell 的 PATH 已经解析好，裸命令名就能调用。
- 需要组合查询时，优先拆成多次 cli_run（每次一条命令），不要为了串联而包一层 bash -lc。
- 确需 shell 语义时才用 bash -lc；只放只读查询（ls / cat / rg / git 只读子命令等），
  不要在里面放写入或删除。
```

这不是安全边界（模型仍可能包一层），只降低自然使用频率；真正的放宽由 §2 的保守判据承担。
改 `identity.md` 会改变 `session_open.assembly` 里该段的 `bytes` 读数（验收场景 105 只断言
`path` / `exists`，不受影响）。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 解析器 bug 把写误判为只读 | 只读白名单是硬门（逐个 `classify_cli`）；任何未知 / 可疑形态 fail-closed；正反例成对表驱动 + 反向验证（§2.6）；安全关键路径在评审里单列一档 |
| 解包顺带放宽 `full_access` | 失败方向只到「危险」，不到「写」（§2.4 硬约束 1） |
| 前缀授权静默放大 | 规则文本与记忆前缀都写进按钮文案；持久规则可删；会话记忆按会话过期；两处都从同一个生成器取值 |
| 全局规则跨 vault 生效 | D2 已裁先全局；提案与浮层文案写明「对所有 vault 生效」；vault 级作用域列为后续候选 |
| 配置写回丢更新 | 后端单写者 + 进程级写锁（§4）；前端不做数组读改写 |
| 既有只读白名单成员自带写 / 执行能力（`sed` 的 `w` 脚本命令、`rg --pre`、`git -c core.pager=…`） | 改动前就存在的面，本 change 不扩大也不收窄；另行登记 finding，不在本 change 修 |
| 持久规则数量增长后难审计 | 浮层列表逐条可见、可删；超过 6 条滚动；不做优先级 / 作用域（本期） |

## 9. 测试与验收计划

- **单测（Rust）**：
  - 解包正例 / 反例表（§2.6），以及「反例在 `full_access` 档仍产 Ask」的判定级断言。
  - 前缀生成器：cli 两词 / 单词退化 / vault 路径前缀 / 根级精确 / 不提供的工具返回 None。
  - 规则匹配：Q2 等值容差（`git push` 命中 `cli(git push *)`；`git pushx` 不命中）。
  - 缓存：前缀键命中同前缀的不同实参；精确键（vault）仍全等；namespace 切换清空不变。
  - 次级动作派生：危险层两项皆 None；模式层两项皆 Some；快照与事件同源。
  - 配置写回：追加去重、删除幂等、写失败时批准保持待决（可测的路径拆分）。
- **前端单测**（`pnpm test`）：按钮按字段渲染 / 缺省不渲染；浮层列表空态不渲染、删除后刷新；
  文案插值（`{rule}` / `{prefix}`）不出现占位符残留。
- **验收场景**：回扫 72 / 73 / 74 / 75 / 109 / 110 / 111 / 151 / 183 / 184（逐条核对闸期望；
  已知 151 的包装器样本必须换，见 tasks 4.1）；新增「纯读 CLI 持久放行」「`bash -lc` 只读命令免问」
  「危险包装仍问且无次级动作」三个场景。
- **门禁**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、
  `scripts/gate.sh quick`、本地 `scripts/gate.sh visual`（UI 改动）、真机验收套件（合并前）。

## 10. 裁决点（与 proposal 的 Q1–Q7 对应）

| 编号 | 取舍 | 倾向 | 备选与代价 |
|---|---|---|---|
| Q1 | 两词前缀 vs 单词前缀 | 两词 | 单词前缀实现更简单，但把 `tvly` 的所有子命令（含未来的写子命令）一并放行 |
| Q2 | `cli(git push *)` 是否匹配无参的 `git push` | 是（仅「空格 + 星号」形态） | 不加容差则同一条命令可能第二次仍问，按钮可信度受损 |
| Q3 | 安全集是否含 `2>&1`、是否含 `>>` | 含 `2>&1`，不含 `>>` / `<` | 去掉 `2>&1` 更保守，代价是 `cmd 2>&1 \| grep` 这类常见查询仍每次问 |
| Q4 | 非全只读脚本归危险 vs 归写 | 危险 | 归写会顺带放宽 `full_access`（本 change 的隐藏权限变更） |
| Q5 | 写回通道：后端单写者 vs 前端 `config_set_value` | 后端 | 前端方案要在 TS 里复刻数组读改写，且与权限档写回并发丢更新 |
| Q6 | 规则列表入口：权限浮层 vs 独立设置页 | 浮层 | 独立页要多维护一处浮层 / 页面与一套导航 |
| Q7 | `vault_delete` / `cron_task_*` 是否给持久规则 | 不给 | 给的话与其它卡一致，但永久免问删除 / 永久取消定时任务的显眼时刻 |
