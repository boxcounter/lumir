# in-file-search Specification

## Purpose

定义文件内搜索（v0）的落地口径：`⌘F` 经统一键位层的 `app.search-open` 打开编辑器顶部的搜索面板，提供查找、全匹配高亮、上一个/下一个、区分大小写与匹配计数；替换不在能力集内（v1 有意留白）。能力底座取 `@codemirror/search` 的官方扩展，面板 UI 按 editorial 语言重制（`src/search.ts` + `src/search-panel.css`）。本 capability 的制品为补记（实现 M139 先于规格落地，merge `647f519`），由 change `add-in-file-search` 归档并入（2026-09-17）。

## Requirements

### Requirement: 搜索入口与键位归属

系统 SHALL 提供命令 `app.search-open` 承担「打开 / 唤起文件内搜索面板」，作用域 SHALL 为 `global`（mac 惯例是「⌘F 在哪儿都能开查找」：焦点在文件树或已打开的搜索框里时同样要能开），默认绑定 SHALL 为 `⌘F`，实现 SHALL 落在装配层（`src/main.ts`），能力与面板本体 SHALL 在 `src/search.ts`。

该命令 SHALL 进 `KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它重绑或解绑，`app.describe-bindings` 面板 SHALL 自动列出它；其 `doc` 字段 SHALL 写明取 `⌘F` 的来由（`⌃F` 已被 Emacs `C-f`（前移字符）占用，故沿用 `⌘` 系）。面板已打开时再次触发该命令 SHALL 把焦点与选区移回输入框，MUST NOT 开出第二个面板。

#### Scenario: ⌘F 打开面板

- **WHEN** 编辑器中有文档，按 `⌘F`
- **THEN** 搜索面板出现在编辑器顶部，输入框获得焦点，文档内容逐字节不变

#### Scenario: 面板打开态再按 ⌘F 回到输入框

- **WHEN** 面板已打开、焦点已被移到文档正文，再次按 `⌘F`
- **THEN** 焦点与选区回到面板输入框，面板不被重建、文档内容不变

#### Scenario: 命令可由配置重绑

- **WHEN** `config.json` 的 `[keys]` 表把 `⌘F` 重绑到另一组合，按该组合
- **THEN** 搜索面板照常打开（重绑生效），原 `⌘F` 不再打开面板

### Requirement: 搜索能力集与匹配口径

面板 SHALL 提供下列能力，且**仅**提供这些能力（v1 有意留白）：查找、全匹配高亮、上一个、下一个、区分大小写切换、匹配计数。

查找查询 SHALL 在输入事件时即生效（MUST NOT 等待回车）；匹配计数 SHALL 显示「当前匹配序号 / 总匹配数」，未选中任何匹配时序号显示 0；匹配数达上限（1000）时 SHALL 报下界（形如 `1000+`）而不是为超大文档逐次按键做精确全量扫描。上一个 / 下一个 SHALL 复用 `@codemirror/search` 的 `findPrevious` / `findNext` 语义，无匹配时两个动作 SHALL 为禁用态。大小写切换 SHALL 是开关态（读屏可播报），切换后匹配集合与计数随之重算。

面板 MUST NOT 提供替换入口（不放替换字段、不暴露 `replace*` 命令）：v1 的能力集不含替换。

高亮 SHALL 由官方的匹配高亮器按**视口**构建（视口外的匹配不画高亮），计数 SHALL 覆盖全文档而非仅视口。搜索全程 MUST NOT 改写文档或触发保存链路（`EditorState.doc` 与磁盘文件逐字节不变，ADR 0003 §3 铁律）。

#### Scenario: 匹配计数与高亮

- **WHEN** 在一份含 3 处 `note` 的文档里打开面板并输入 `note`
- **THEN** 计数显示「0/3」，三处匹配在视口内高亮，文档内容逐字节不变

#### Scenario: 上一个 / 下一个导航

- **WHEN** 匹配存在时依次触发「下一个」与「上一个」
- **THEN** 选区移到下一个 / 上一个匹配并把它滚入视口，计数里的当前序号随之更新；到文档末尾再按「下一个」SHALL 环绕到首个匹配（到文档开头再按「上一个」对称环绕），两个动作期间焦点始终留在面板输入框内

#### Scenario: 大小写切换重算匹配

- **WHEN** 文档里同时含 `Note` 与 `note`，先以 `note` 查询、再打开区分大小写
- **THEN** 计数从 2 变为 1，高亮范围同步收窄，开关呈按下态

#### Scenario: 无匹配时导航按钮禁用

- **WHEN** 输入的查询在文档里没有匹配
- **THEN** 计数显示「0/0」，上一个 / 下一个按钮为禁用态，文档内容不变；清空查询后计数同样归零

#### Scenario: 没有替换入口

- **WHEN** 面板打开
- **THEN** 面板里没有替换输入框与替换按钮（能力集不含替换），按任何键都不会改写文档

### Requirement: 面板关闭与焦点归还

面板 SHALL 由三条路径关闭：`Escape`、`⌃G`、面板内的关闭按钮。关闭 SHALL 把焦点交还编辑器（不依赖官方面板对焦点时序的隐式判断），保证「关掉后手不离键盘继续编辑」。

面板自己的键位 SHALL 就地消费（`Escape` / `⌃G` 关闭，输入框内 `Enter` = 下一个、`⇧Enter` = 上一个，按钮聚焦时让原生激活生效），MUST NOT 在统一键位表里为同一物理组合注册第二条绑定——`Escape` 与 `⌃G` 已被 `editor` 作用域的既有绑定占用，面板持有焦点时那两条不命中，就地消费与表内分发互斥。键位匹配 SHALL 复用键位层的 token 归一化（`keyToken`），MUST NOT 另写一套匹配口径。

#### Scenario: 三条关闭路径都归还焦点

- **WHEN** 面板打开时依次触发 `Escape`、重新打开后 `⌃G`、重新打开后点关闭按钮
- **THEN** 三条路径都关闭面板并把焦点交还编辑器；随后直接输入字符会进入文档

#### Scenario: 面板内 Enter 导航

- **WHEN** 焦点在面板输入框内、匹配存在，按 `Enter` 与 `⇧Enter`
- **THEN** 分别移动到下一个与上一个匹配；焦点仍在输入框内（不跳走）

#### Scenario: 关闭键不产生第二条分发映射

- **WHEN** 查阅 `KEY_BINDINGS`
- **THEN** 表内没有为 `Escape` / `⌃G` 新增指向搜索的绑定（面板的关闭键是就地消费，不构成同一物理组合的第二条分发映射）
