# Design: vault 列表移除

- Change ID: `vault-and-session-removal`
- 日期: 2026-10-23

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在本分支（基于
master `18c21ef2`）逐一读过原文的位置；行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 注册项结构（id / path / 治理标记 / 上次打开） | `src-tauri/src/vault_registry.rs:60` `VaultWorkspace`（`missing_since` / `archived_at` / `last_opened_at` 三个 `#[ts(skip)]` 字段不进 webview 契约） | 移除命令的返回载荷要带全这三个字段，撤销才能逐字写回；因此另立导出类型（见 §2.2） |
| 注册表目录与读写纪律 | `vault_registry.rs` 的 `registry_dir()`（`<config_dir>/vault-registry/`）、`write_entry`（tmp + rename）、`read_entry_file`（读失败 / 解析失败一律 `None`） | 移除 = 删一个 `<id>.json`；撤销 = 复用 `write_entry` 的原子写 |
| 自动治理 | `vault_registry.rs:201` `sweep_registry`（路径失效先记 `missing_since`，超 24h 打 `archived_at`；路径恢复即复位） | 移除**不碰**治理逻辑；被移除的项文件已不在目录里，sweep 自然看不到它 |
| remap 候选 | `vault_registry.rs:245` `remap_candidates`（`archived_at.is_none() && !exists && path != target`） | 移除即从候选中消失——文件没了，无需额外过滤 |
| 按路径查找 / 是否已注册 | `vault_registry.rs:270` `find_by_path`、`:291` `is_registered`、`:298` `remap_gate`、`:310` `reconcile_vault` | 移除后同一目录再被打开 → `find_by_path` 找不到 → `reconcile_vault` 铸新 id（现状行为，本 change 不改它，但要在 spec 里写明） |
| 列表命令 | `vault_registry.rs:423` `list_vaults`、`:481` `vault_list`（`spawn_blocking`，只读、无缓存） | 删除后自然不再返回该行，`vault_list` 零改动 |
| 命令注册面 | `src-tauri/src/lib.rs:138-141`（`vault_register` / `vault_remap` / `vault_list`） | 新命令的注册位置 |
| 当前 vault 的身份 | `commands::prepare_vault_open`（`src-tauri/src/commands.rs:437`）→ `reconcile_vault`；`VaultState::root_policy_and_id()` 的第三元是当前 vault 的稳定 id（`src-tauri/src/commands.rs:296`）；前端经 `onVaultLoaded(vaultId)` 记住 `currentId`（`src/vault-switcher.ts:974`） | 「不能移除当前 vault」的两侧判据：前端按 `currentId` 隐藏入口，后端按**稳定 id** 比对拒绝 |
| 浮层行的 DOM 形态 | `src/vault-switcher.ts:1094` `renderRow`：`<button class="vault-row" role="option" aria-selected …>`，可用行进 `this.rows`（键盘游标空间），失效行不进 | 加移除钮必须把行改成「包装 div + 两个兄弟按钮」（§3.1）；失效行也要能移除，因此不能把移除做成只作用于键盘游标页脚的动作用 |
| 键盘游标与筛选 | `src/vault-switcher.ts:1062` `render` / `:1161` `setActive` / `:1210` `move` | 移除后重渲染要保持游标语义（§3.3） |
| 列表每次打开重新拉取 | `src/vault-switcher.ts:1000`（`toggle` 内 `deps.list()`） | 移除后同一份口径刷新，不维护被改过的镜像 |
| 装配层接线 | `src/main.ts:1764` `createVaultSwitcher({ list, requestSwitch, requestAdd, requestRelocate, … })` | 新增 `requestRemove` 的注入点；撤销提示落在装配层（toast 归它） |
| IPC 薄封装 | `src/ipc.ts:311` `vaultRemap`、`:319` `vaultList` | 两个新封装 |
| toast 的两种形态 | `src/main.ts:1483` `toast(text, actions, sticky, tone)`；`:1551` 非 sticky 且带动作 → 8000ms 后自消；sticky 才按文案去重 | 撤销提示取非 sticky（8s 窗口），多次移除各自的撤销互不顶掉 |
| 会话删除的既有形态（本 change 不改，只对照） | `src/harness-panel.ts:9120` `buildSessList`：行 = `div` 壳 + 恢复钮 + `×` 钮两个**兄弟**；点击后行内两步确认（`D418` / `D419` / 取消复用 `D136`）；`:9191` 调 `harnessDeleteSession`；样式 `src/harness-panel.css:241` / `:252` | 交互语汇与 DOM 纪律的直接先例：MUST NOT 钮套钮（WKWebView 把嵌套 button 当叶子，M351 finding），确认态复用 D136 |
| 嵌套按钮的机器约束 | 同上；视觉场景断言 `.vault-list[role=listbox]` 与 `.vault-row` 的类名 / 文本（`tests/visual/scenes/mv-vault-switcher.spec.ts:102` / `:107` / `:139`）、单测的假 DOM（`tests/unit/vault-switcher.test.ts:1631`） | 行的外层元素类型变化会牵动这三处；实现时先跑它们 |
| 验收套件 | `scripts/acceptance/scenarios/108-harness-session-delete.md`（会话删除的真机场景，含直读盘断言）；scenario 编号已用到 222 | 新场景编号 223 |

## 1. 语义与数据

### 1.1 「移除」是什么

移除 = **用户主动要求这一项不再出现在列表里**。它的唯一写操作是删掉
`<config>/vault-registry/<id>.json`；vault 目录、vault 内的任何文件、按 id 键控的其余数据
（`vault-sessions/<id>.json`、`reading-positions/<id>.json`、`harness/sessions/<id>/`、
`harness/attachments/<id>/`）一律不碰。

为什么不做「连数据一起删」（proposal D2 的 B）：那会把一个列表整理动作变成数据销毁动作，而
harness 会话留存是 agent 对话的审计面（`docs/specs/config-reference.md` §4 把它记为「审计与恢复」），
不该被「列表里少一行」顺手带走。

为什么不做 `removed_at` 标记（D2 的 C）：它把注册表从两态（有效 / 归档）变成三态，四条读路径
都要学过滤，还要处理「sweep 会不会把已移除项复活」这类隐蔽分支；换来的只有「重加时旧标签还在」
一条便利。直接切断更符合 AGENTS.md 硬规则「变更默认直接切断」。

### 1.2 被移除项的孤儿数据（已知边界，写进文档不进界面）

- 移除后该 id 在注册表里不再存在，因此 `vault-sessions` / `reading-positions` / `harness/sessions`
  下同名文件成为**不可达孤儿**（现有纪律里孤儿本就是「无害残留」，见 `src-tauri/src/vault_session.rs`
  模块头）。
- 之后经「新增 vault…」重新加入同一目录 → `reconcile_vault` 铸新 id（`vault_id()` 按 pid + 序号）→
  旧数据不复活。这是删除语义的直接后果，spec 里写明（ADDED 条的最后一句），design 里记边界，
  **不进界面文案**：确认文案只说「磁盘上的目录与文件不受影响」，不承诺也不解释孤儿。
- 反向选择（若 Alex 在 D2 改判 C）：`VaultWorkspace` 加 `removed_at`，`list_vaults` 过滤、
  `remap_candidates` 过滤、`sweep_registry` 跳过、`find_by_path` 仍能找到（以便重加时复活同一 id）——
  四处改动 + 对应单测。本设计不实现，留作改判时的落点说明。

### 1.3 当前 vault 不可移除（D1 = A）

- 前端：`renderRow` 对 `row.id === this.currentId` 的行不渲染移除钮。
- 后端：`vault_remove` 在读注册项之后、删文件之前比对**稳定 id**——`VaultState::root_policy_and_id()`
  的第三元就是当前 vault 的 id（`src-tauri/src/commands.rs:296`，锁内取快照、不做 IO）；未打开
  vault 时该调用返回 `vault_not_open`，按「没有当前 vault」处理（任何注册项都可移除）。相等即
  `vault_remove_current`。用 id 而不是路径字符串比对：id 是注册表的身份键，路径比较要担心尾部斜杠
  与 canonicalize 口径（`src/vault-switcher.ts` 的 `samePath` 就为这两个坑留了注释）。
  前端隐藏只是呈现，后端判据才是防线（IPC 可被任意调用）。
- 因此 `last_vault` 不可能指向被移除的 vault，本 change 不新增 `last_vault` 的清理通道。

## 2. 后端

### 2.1 `vault_remove`

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn vault_remove(
    state: tauri::State<'_, crate::commands::VaultState>,
    id: String,
) -> Result<Option<RemovedVault>, CommandError>
```

顺序与判据：

1. `valid_id(&id)`（复用注册表既有判据；id 同时是文件名，这是路径逃逸防护）。
2. 读 `<id>.json`：读不到 → **幂等成功**，返回 `None`（重复删除 / 竞态删除不是错误；与
   `harness_delete_session` 的幂等口径一致）。注意这里**不能**把「读不到」当成「删掉了」去返回
   假载荷——撤销需要原值，没有原值就没有撤销提示。
3. 当前 vault 守卫（§1.3，按稳定 id）→ `vault_remove_current`。
4. `fs::remove_file` → 失败 `vault_remove_failed`（带 `path` 与 `reason` 两个 param，与
   `harness_session_delete_failed` 同形）。
5. 返回 `Some(RemovedVault { … })`，载荷即第 2 步读到的完整注册项。

**不做**的事：不 `canonicalize` vault 路径、不 `exists()` 探测、不碰 vault 目录（移除一个失效项
时那个路径根本不存在，任何探测都只会引入等待）。

### 2.2 `RemovedVault`（撤销载荷）

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RemovedVault {
    pub id: String,
    pub path: String,
    #[ts(type = "number | null")] pub last_opened_at: Option<i64>,
    #[ts(type = "number | null")] pub missing_since: Option<i64>,
    #[ts(type = "number | null")] pub archived_at: Option<i64>,
}
```

为什么不复用 `VaultWorkspace`：它有三个字段是 `#[ts(skip)]`（落盘字段不进 webview 契约）。为了撤销
把它们解禁，等于让「注册项的内部治理字段」突然成为前端可见契约面，收益不成比例；另立一个只服务
「移除 → 撤销」往返的小类型，契约面增量就是它自己。

### 2.3 `vault_restore`

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn vault_restore(entry: RemovedVault) -> Result<(), CommandError>
```

1. `valid_id(&entry.id)`；`path` 只做字符串落盘，**不** canonicalize——撤销要逐字还原。
2. 目标文件已存在 → **不覆盖**：返回成功（幂等；说明该项已被别的路径恢复，或用户已重加过同一 id）。
   覆盖会让「撤销」变成能改写现存注册项的写通道，本 change 不需要这个能力。
3. 走 `write_entry`（tmp + rename）落盘。失败 → `workspace_write`（复用既有码，不新造）。
4. 不刷新 `last_opened_at`、不动 `last_vault`、不触发打开。

### 2.4 单测（Rust，注册表目录可注入）

现有 `list_vaults(registry, sessions)` 的测试模式（临时目录注入）可直接复用。用例：

- 移除只删目标项文件：同目录其它项、`vault-sessions` / `reading-positions` 下的同名文件逐字节不变；
  vault 目录内的文件全部还在。
- 当前 vault 拒绝：守卫只需一次 id 比较，抽成可测内核
  `remove_entry_at(registry_dir, current_id: Option<&str>, id)`（与 `list_vaults` 同一测试模式）——
  单测直接传 `Some("vault-a")` / `None`，不必起 Tauri state。
- 幂等：删两次，第二次返回 `None`。
- 撤销逐字还原：`last_opened_at` / `missing_since` / `archived_at` 三个字段在往返后相等；已存在的项
  不被覆盖。

## 3. 前端

### 3.1 行的 DOM 形态（唯一有结构性风险的一处）

现在一行是一个 `<button class="vault-row" role="option">`（`src/vault-switcher.ts:1096`）。移除钮必须
是**兄弟**而不是子元素——WKWebView 把嵌套 button 当叶子（M351 finding，会话浮层因此用「div 壳 +
两个兄弟按钮」）。因此：

```
div.vault-row-wrap                （纯布局壳，无 role）
├── button.vault-row[role=option] （切换 / 重新定位；保留 id、aria-selected、dataset.vault）
└── button.vault-row-del          （移除；aria-label = 「从列表移除 {name}」）
```

- `.vault-row-wrap` 承载现在的行距与 hover 底（`is-current` / `is-missing` / `is-active` 三个状态类
  仍挂在 `.vault-row` 上，样式选择器不改语义）。
- `.vault-list[role=listbox]` 的直接子元素从 option 变成 `div` 壳。**已知偏离**：列表内容的 ARIA
  content model 只允许 option / group，多一个按钮是越界的；会话浮层（M406）是同一形态、同一偏离，
  且那里的读屏路径已被真机场景 108 覆盖过。本 change 沿用同一手法、不另造第三种结构，把「listbox
  里出现兄弟按钮」记为已知边界（真机场景 223 会以 AX 断言钉住实际暴露形态，若 WKWebView 让按钮
  在读屏树里消失，就在场景里登记为已知边界并改走「行内 × 但读屏名挂在 option 上」的备选）。
- 备选方案（已评估不采纳）：把移除做成浮层页脚的动作项（「移除「{name}」…」）。它保住了 listbox
  的纯正结构，但**页脚动作只能作用于键盘游标行**，而失效行不在键盘游标空间里
  （`src/vault-switcher.ts:1102` 的 `if (row.available)` 分支）——「清理失效项」这个主用例因此不可达，
  除非同时改键盘游标的定义（那会牵动既有断言与交互口径）。
- **视觉口径**（无原型，取既有先例的规格）：`.vault-row-del` 逐项复用 `.lumir-hp-sesspop-del`
  （`src/harness-panel.css:252-270`）——20×20、圆角 `--r4`、常驻 `--text-3`、hover 底 `--danger-tint`
  + 字色 `--danger`、过渡 `--dur-ui var(--ease-standard)`；与 `.vault-row` 之间用 `--sp-1` 间距
  （同 `src/harness-panel.css:241` 的 flex gap），在行内垂直居中。MUST NOT 新增色值 / 字号 / 圆角。
  行距与 hover 底随 `.vault-row-wrap` 迁移，`.vault-row` 自身的内边距与文字排版不变——浮层里除
  行尾多一枚按钮外，其余像素应逐像素不变（基线重截后逐张核对）。

### 3.2 确认态（复用会话删除的语汇）

点 `×` 后把该行的两个子元素换成三个兄弟：确认句（点名显示名）+ 「移除」+ 「取消」。

- 文案：确认句「从列表移除「{name}」？磁盘上的目录与文件不受影响。」；破坏侧「移除」；取消侧复用
  `D136`（与 M406 会话删除同一选择，破坏性动作的默认落点必须是安全项）。
- 取消 → 逐字还原该行（重建 `renderRow` 的两个子元素，不重拉列表）。
- 确认 → 调 `deps.requestRemove(row)`；成功由调用方（§3.4）负责提示与撤销，失败恢复该行并给提示
  （失败提示由装配层给，浮层只恢复行）。
- 确认态期间该行不可切换（`.vault-row` 置 `disabled`）。确认态**不参与**键盘游标：任何 `render()`
  （↑↓ 移动、输入筛选、列表刷新）都重建行，确认态随之丢弃、还原为普通行——它只存在于当前这份 DOM，
  不引入「确认中的行」这个需要跨渲染维护的状态。

### 3.3 移除成功后的列表刷新

`requestRemove(row)` 返回 Promise；resolve 后浮层**重新调用 `deps.list()`**（MUST NOT 就地改
`rowEntries`）。刷新后：

- 保持查询串与筛选状态不变（`this.filter` 不 reset）。
- 游标落在「原下标位置那一行」（被移除行下方的行上移到该位置）——`min(prevActiveIndex, rows.length-1)`；
  不回到当前项（连续清理多个失效项时游标乱跳）。`prevActiveIndex` 是刷新前 `.vault-row.is-active`
  在 `this.rows` 里的下标；确认态的行可能不是游标行（鼠标点击）时，仍按游标行算。
- 被移除的是最后一行时游标钳到新的最后一行。
- 列表里当前 vault 一定还在（D1 = A），因此刷新后不会是空列表。

`VaultSwitcherHandle` 增加 `refresh()`：浮层开着就按上面的口径重拉，关着是 no-op。撤销成功后由装配层
调它（见 §3.4），保证「撤销」在浮层仍开着时就地生效。

### 3.4 装配层：调用、提示与撤销

`src/main.ts` 的 `createVaultSwitcher({ … })` 增加：

```ts
requestRemove: async (row) => {
  const removed = await vaultRemove(row.id);       // Rust 返回 null = 已经被删掉（幂等）
  if (removed === null) return;
  toast(
    t("D5xx", { name: row.name }),                 // 已从列表移除：{name}（deck 编号，实现期落）
    [{ label: t("D5yy"), run: () => void undoVaultRemove(removed) }],   // 撤销
    false,                                         // 非 sticky：8s 窗口，多次移除各自可撤销
  );
},
```

（代码里 MUST NOT 出现中文串字面量——`tests/unit/copy.test.ts` 的迁移门禁；上面的 `D5xx` / `D5yy`
只是占位，实际编号按 §5 在实现期落。）

`undoVaultRemove(entry)`：`await vaultRestore(entry)` → `switcher.refresh()`；失败走 `toast(errorText(e))`。

- 移除不切换 vault、不改 `last_vault`、不碰编辑器与会话（`currentId` 不变）。
- 撤销不打开该 vault、不切换，只让列表里那一行回来（用户刚移除的东西回来了，不该顺手把他带走）。

### 3.5 错误码与文案

`src/copy-data.ts` 的 `ERROR_COPY` 新增两条（编号以实现期 deck 的当前末号顺延，见 §5）：

| code | 人话 |
|---|---|
| `vault_remove_current` | 当前打开的 vault 不能从列表移除，请先切换到其他 vault |
| `vault_remove_failed` | 移除失败：{reason} |

`workspace_write`（撤销写回失败）复用既有码。

## 4. 测试面

| 层 | 内容 |
|---|---|
| Rust 单测 | §2.4 四组 |
| 前端单测（`tests/unit/vault-switcher.test.ts`，假 DOM rig） | ① 当前行无移除钮、非当前行有；② 失效行也有；③ 点 × 进确认态、取消还原、确认调 `requestRemove` 且只调一次；④ 确认后刷新重拉 `list()`、查询串保持、游标落在原下标；⑤ `refresh()` 在关闭时是 no-op |
| 视觉（`tests/visual/scenes/mv-vault-switcher.spec.ts`） | 现有断言要跟着改：`renderRow` 外层从 `.vault-row` 变 `.vault-row-wrap`；新增断言「当前行没有 `.vault-row-del`」「非当前行有」。浮层元素级截图基线**必须重截**（新增一列按钮 = 真实像素变化，`maxDiffPixelRatio: 0.001` 容差在该尺寸下可能吞掉一枚 20×20 的钮——按 REVIEW.md「容差吞掉真实变化」条，元素级基线重截后逐张核对） |
| 真机（新场景 `scripts/acceptance/scenarios/223-vault-remove.md`） | ① 打开浮层：当前行无移除钮、另一行有；② 点 × → 确认态（AX 断言确认句与两个按钮）；③ 取消 → 行还原（断言原文本）；④ 再确认 → 行消失、浮层仍在；⑤ 直读盘断言 vault 目录内文件仍在（`file` 断言的 mtime / 内容不变）；⑥ 撤销 → 行回到列表；⑦ 重开浮层 → 该行仍不在（持久化） |

验收套件的自清理：场景动的是套件自己的合成配置目录（`XDG_CONFIG_HOME` 隔离）与合成 vault，符合
「绝不读写用户配置」纪律；场景结束要把注册表恢复（套件的 `seed` / `resetVault` 机制，按 108 的写法）。

## 5. 文案条目（编号实现期落，deck 是单一真源）

新增五条（行内移除钮 aria 名 / 确认句 / 移除 / 已移除提示 / 撤销）——取消复用 `D136`。

**不在本提案里预占编号**：`文案-Copy.md` 的编号是全局单调追加，并行批次（M633 / M634 / M635 等）
可能已占用当前末号之后的号段；实现期以合并后的 deck 末号为准顺延，避免撞号。落号时同批更新
`文案-Copy.md` 的编号来源表（末尾那张「Dxxx–Dyyy 消费点」映射）。

## 6. 已知边界与未采纳方案

1. **孤儿数据**（§1.2）：移除后 per-id 数据留在盘上、不再可达；重新加入同一目录铸新 id。
2. **listbox 内容模型偏离**（§3.1）：一行里出现兄弟按钮；沿用 M406 会话浮层的同一形态。
3. **只有一个 vault 时移除入口不可达**（D1 = A 的直接代价）：要移除唯一 vault 得先「新增 vault…」
   开另一个目录。若 Alex 改判 D1 = B，需要另补 dirty 守卫、空态、`last_vault` 清理三块。
4. **不采纳**：`removed_at` 标记态（D2 C，理由见 §1.1）；页脚动作形态（§3.1 备选）；批量移除；
   撤销超时后从界面恢复（已移除项只能靠重新加入目录得到新身份）；确认态点名「该 vault 还有 N 个
   定时任务」（见第 6 条，属可加项，本 change 不做）。
5. **撤销窗口**：非 sticky 提示 8s 后自消（`src/main.ts:1551` 既有口径）。超时后无法从界面撤销。
   为可接受：移除不销毁任何用户数据，重新加入目录即可恢复访问（身份是新的）。
6. **cron 会把它带回来**：被移除的 vault 若仍是某 cron 任务的目标，任务下次触发经
   `ensureCronVault`（`src/main.ts:2798`）→ `switchToVault` → `vaultOpenPath` 打开它，
   `reconcile_vault` 随即铸新 id——列表里以新身份重新出现，且**会切换用户当前 vault**（cron 的既有
   行为）。移除是列表操作、不是禁令，本 change 不阻断也不加检查。若日后要提示，成本最低的落点是
   确认态由**后端**数一次（`config.cron.tasks[].vault` 需 canonicalize 后才能与注册项路径比较，
   前端拿原串比较会漏），即给 `vault_remove` 加一个「预览计数」查询或让 `VaultListEntry` 带
   `cron_task_count`——两者都要动契约面，故本 change 不做。
