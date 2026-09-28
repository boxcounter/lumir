# Design: ui-language-i18n

形态总览（推荐项）：`文案-Copy.md` 保持**可见文案的规范文本与评审面**（它的头部已自述「本文是产品可见文案 source of truth」），运行时新增一份按 D 编号索引的**双列文案表**（zh / en 两列同在一处），全仓可见文案（含键位面板逐条来由）MUST 经它取值；`[ui] language`（`zh` / `en`，**默认 `en`**——节点 1 裁决 2026-09-27）是启动真源；运行期切换走 M237 主题切换的同一套机制（单一施加点 + 乐观施加 + 写回配置 + 失败降级不回滚），入口是 modeline 指示钮与 `view.language-cycle`（⌘⇧L）；Rust 侧的人话文案按 `code` 归前端渲染，Rust 只保证 `code` 与参数稳定；**只进诊断日志 / 配置告警的串不在语言面内**（终裁：诊断面向开发者、语言固定）。

所有锚点按当前 master `8dbbb89` 复核（评审在「overlay 到当前 master」的口径下逐条复算通过）。本提案初稿的基座 `af64bec` 已被 tower rebase 摘除——它误捕获了主 checkout 的 `.review-worktree` gitlink——锚点内容不因此变化。

## 1. 现状盘点：上屏文案在哪、有多少

### 1.1 读数（可复跑的底稿）

底稿：[evidence/count-ui-strings.mjs](evidence/count-ui-strings.mjs)（零依赖手写扫描器，注释/字符串分离），记录输出 [evidence/ui-string-inventory.md](evidence/ui-string-inventory.md)。跑法：

```
cd <仓根>
node openspec/changes/ui-language-i18n/evidence/count-ui-strings.mjs
```

读数（本分支基座，实现期须复跑并把数字改准）：

| 面 | 读数 | 说明 |
|---|---|---|
| 前端 `src/**/*.ts`（排除 `src/bindings/**` 生成物） | 含 CJK 的串 **284** 条 / 29 个文件，其中 **84** 条含 `${}` 插值 | 读数含只进日志 / 配置告警的串与键位表 `doc`——后者由节点 1 终裁纳入（§1.4） |
| 后端错误信封 | 带中文 message 的 `CommandError::new`（非测试代码）**99** 个构造点 / **46** 个 `code` / **82** 个 message 模板 | 99 个点经 `errorMessage()` 直接进 toast / notice |
| 后端其余 | `src-tauri/src/**/*.rs` 含 CJK 串 **120** 条 | 含只进 `ConfigSnapshot.warnings` 的配置告警与 `logging.rs` 的事件名 |
| `文案-Copy.md` | **133** 行活跃编号，最大 **D151**（停用 18 个，deck 明文「不复用」）；两列同形 **3** 行（D77 / D80 / D114） | 规范文本 + 评审面，**不是**运行时取值层。**两个时点要分开读**：本行是**读数时点**（M257 合并前）的值，评审已复跑确认 M257 合并后这两个读数（133 行 / 3 行同形）不变；M257（已合并 `cd9142d`）把 D149–D151 三行的两列**对调**（上屏文案进 English 列、原中文措辞留中文列备查），那是**第三类条目形态**（上屏列锁定，§4.5），不是本行的「两列同形」 |
| i18n 基础设施 | **零** | 全仓无 `i18n` / `locale` / `Intl.` / `navigator.language` 命中；`index.html:2` 写死 `lang="en"` 与全界面不符 |

### 1.2 分布（前端，按模块，前 12）

`keys.ts` 65、`save-controller.ts` 41、`vault-switcher.ts` 24、`bindings-panel.ts` 15、`preview/livePreview.ts` 15、`tree-menu.ts` 14、`main.ts` 13、`preview/callout.ts` 13、`tree.ts` 12、`tabs.ts` 11、`link-follow.ts` 7、`preview/mermaid.ts` 7。完整表见 [evidence/ui-string-inventory.md](evidence/ui-string-inventory.md)。

按承载面归并（同一份串可能同时是视觉与读屏名）：

| 承载面 | 代表模块 | 现状形态 |
|---|---|---|
| 应用内右键菜单 | `tree-menu.ts`（7 项 + 确认框 5 句）、`tabs.ts`（读屏名 + 3 项） | 模块顶部导出常量，`textContent` 写入 |
| toast | `save-controller.ts`（28+）、`link-follow.ts`、`theme.ts`、`content-width.ts` | 常量 + 模板函数（带 `{原因}`/`{路径}` 插值）与 Rust message 透传混合 |
| 确认与守卫提示 | `tree-menu.ts`、`tabs.ts`、`save-controller.ts`、`vault-switcher.ts` | sticky toast + 动作钮（非模态对话框，只有树菜单的删除确认是自建 DOM） |
| modeline | `main.ts`（`无当前文件`、`（未保存）`、`${language} · ${lines} 行 · UTF-8`）、`toc.ts`、`theme.ts`、`shell.ts` | 装配层写 `textContent` / `title` / `aria-label` |
| 文件树 | `tree.ts`（空态、内联编辑读屏名、5 条行内校验原因） | 常量 + 模板函数 |
| 浮层 / 面板 | `toc.ts`、`vault-switcher.ts`、`search.ts`、`list-filter.ts`（两处浮层共用一份常量） | 按需构建 DOM（打开时读常量） |
| 键位面板 | `bindings-panel.ts`（分组与骨架 16 条）+ `keys.ts`（逐条 `doc` 59 处） | 骨架是面板文案；逐条 `doc` 经节点 1 裁决**纳入语言面**（原「表即文档」的排除口径已改准，见 §8.1） |
| 预览 widget / 装饰 | `preview/livePreview.ts`、`attachments.ts`、`math.ts`、`mermaid.ts`、`table.ts`、`frontmatter.ts`、`callout.ts`、`doc-meta.ts`、`doc-title.ts`、`endMarker.ts` | CodeMirror `Decoration` 的 `toDOM()` 与 `mark/line({attributes})`；`table.ts` 的降级归因句经 `data-degraded` + CSS `attr()` 上屏 |
| 日期与相对时间 | `preview/doc-meta.ts`（`{月}月{日}日`）、`vault-switcher.ts`（`relativeTime()` 的「刚刚 / N 分钟前 / 昨天」） | **硬编码中文年月日与相对时间词**，需要 `Intl` 而非查表 |
| 后端 | `fs_io.rs` 44、`commands.rs` 19、`config.rs` 18、`link_graph.rs` 14、`recovery.rs` 10 | `CommandError` 信封的 `message`（人话）+ 用原生目录选择器标题 |

### 1.3 文案如何进 DOM（决定了施加面）

全部经安全通道，**没有「模板串拼 HTML」**：`textContent`（绝大多数）、属性（`aria-label` / `title` / `input.placeholder`）、`createElement` + append、CM widget 的 `toDOM()`、`Decoration` 的 `attributes`。`innerHTML` 只有三类非文案用途（SVG 图标、KaTeX / mermaid 渲染产物）。

CSS 侧有一条**经属性取文案**的通道：`src/preview/livePreview.ts:691` 把降级归因句（源在 `src/preview/table.ts` 的 `degradationNotice`）同时写进 `aria-label` 与 `data-degraded`，上屏文本由 `src/style.css:1149` 的 `.cm-lp-table-degraded::after { content: attr(data-degraded) }` 取用——属性不重建，这句话就不会变（§5.2 的重建纪律由此而来）。同族还有一处 `src/style.css:724` 的 `attr(data-empty-label)`（`src/shell.ts:57-60` 的 `pane()` 写入），但两个 pane 当前都传空串（`:105-106`），因而今天不可见——机制上仍属同一条纪律的覆盖范围。

对机制的含义：迁移是「把常量/模板换成查表取值」，不改 DOM 结构；但**长驻 chrome 是在挂载期把串写死的**，所以运行期切换必须有一条重写路径（§5）。

### 1.4 扣除口径（哪些读数不进双语面）

**节点 1 终裁（2026-09-27）改写了这一段**：原稿的两条扣除项里，**键位表逐条 `doc` 已纳入**（§8.1），而**只进诊断日志 / 配置告警的串保持在外**——Alex 先前的「日志也纳入」被他随后的修正撤回（「日志消息就固定用英文，无需 i18n」，见 proposal 的「节点 1 裁决」段与 §8.2）。

读数 284 / 120 是**上界**。按已声明的面扣掉：

| 扣除项 | 量 | 依据 |
|---|---|---|
| 只进 console / 诊断日志的配置告警与日志文本 | `src/keys.ts` 6 条、`src/typography.ts` 1 条、`src/main.ts:546` 1 条；Rust 侧 `config.rs` 的 18 条告警与 `logging.rs` 的事件名 | 不上屏；**诊断面向开发者、语言固定**（Alex 节点 1 终裁），因此不进语言面 |
| 机器可读标识符 | 事件名 / 等级 / 字段名 / 闭集合字段值 / `code` / 文案表键 | 本来就是英文标识符，不在 CJK 读数口径里，也 MUST NOT 翻译 |

**原先的第三条扣除项「键位表逐条 `doc`（`src/keys.ts` 59 处）」已被终裁取消**——那 59 条改为文案表键引用后进面（§8.1）。因此扣完前端约 **276** 条、后端信封与 notice 约 **100** 条，合计 **约 376 条候选上屏文案**（原稿的约 320 条加上 59 条键位来由，减去与后端读数的重叠口径）。这不是最终清单：逐条对齐是 tasks §1 的第一件事（实现期以扫描器 + 人工判定产出确切清单，并把 deck 补到全覆盖）。

## 2. 既有机制对照：M237 主题运行期切换

语言与主题是同一族的东西（设备/场景级的显示偏好），所以**先看 M237 已经解决过什么**，能照抄的照抄：

| 机制件 | 主题的现状（锚点） | 语言照抄 / 为什么 |
|---|---|---|
| 单一施加点 | `applyTheme(theme)`（`src/main.ts` 约 `:805-816`）是唯一写 `data-theme` 的地方，模块头明文「MUST NOT 出现第二处 `data-theme` 写入者」（`src/theme.ts:10-11`） | **照抄**。语言同样需要唯一施加点，理由更强：文案的取值点遍布 30 个模块，唯一施加点是「切换是否即时生效」可验证的前提 |
| 双入口同源 | `view.theme-cycle`（`Cmd-Shift-T`，`src/keys.ts:477`）与 modeline 主题钮（`src/main.ts:842-843` 直连同一实现） | **照抄**（D3 推荐项） |
| 乐观施加 + 异步写回 | `cycleTheme()`（`src/main.ts:818-840`）：先 `applyTheme`，再 `configSetUiValue("theme", next)`；失败只 toast + `logEvent("config_warning", …)`，**不回滚** | **照抄**（D2 推荐项）。失败语义写成「切换已生效、未写入配置、重启后回落」 |
| 启动施加 | `configGet().then(...)` 块的最后一条（`src/main.ts:1432`，块内最后是**有意**的：桩环境缺 `ui` 表时只让主题不施加） | **照抄**：`applyLanguage` 与 `applyTheme` 相邻摆放，同为块内末尾一族 |
| 无 config-changed 事件 | 全仓无该事件（`commands.rs:24` 只是文档举例）；运行期真源就是刚施加的值，MUST NOT 回读（`openspec/specs/content-width/spec.md` 的写入纪律） | **照抄**：语言也不新增事件通道，真源是运行态 |
| 需要重建的派生物 | `invalidateMermaidTheme()` + `editor.refreshPreview()`（`src/main.ts:831-832`）——颜色烧进 SVG 的块必须重渲 | **照抄形状**：语言的派生物是**已挂载 chrome 的文本**与**CM 装饰里的 widget 文本**，切换时要一并重写（§5） |
| 持久化通道 | `configSetUiValue`（`src/ipc.ts:50-52`）是**通用键值盲写**：只校验 key 非空，值原样落盘 | **照抄并如实记账**：非法值只在下次启动的 `validate()` 被兜（§3.3） |

不照抄的一处：主题的施加面是**一个属性**（`data-theme`，CSS 变量级联跟随，零重测量）；语言的施加面是**全部可见字符串**。这是量级差别，也是本 change 的主要成本来源——机制是现成的，迁移不是。

## 3. 配置面：`[ui] language`

### 3.1 落点与类型

- Rust：`src-tauri/src/config.rs` 的 `UiConfig`（`:199-239`）新增 `pub language: UiLanguage`，`UiLanguage` 是 `{ Zh, En }` 的闭集合枚举（`#[serde(rename_all = "lowercase")]`，与 `UiTheme` 同款）。
- TS：`src/bindings/UiConfig.ts` 由 ts-rs 重导出（`Theme` 旁边的第三个字段）。
- **`Copy` 约束**：`UiConfig` 现在 derive `Copy`（`:203`），依赖「全字段 `Copy`」。`UiLanguage` 是 unit-only 枚举因此天然 `Copy`——**MUST NOT** 用 `Option<String>` 之类的形态，那会连带打破 `Clone`/`Copy` 派生链。
- `AppConfig`（`:65-95`）只 derive `Serialize`（读盘走 `RawConfig`、写盘走 `serde_json::Value`），所以新增字段不影响写路径。

### 3.2 校验三层（照 `theme` 模板，逐字同构）

1. **宽容解析镜像**：`RawUiConfig`（`:319-330`）加 `language: Option<String>`（`#[serde(default)]` 已在结构体上）。
2. **逐字段判定**：`validate()`（`:485-511`）加一段 —— 缺字段回落默认**不告警**；取值不在 `zh` / `en` 内回落默认 + 一条人话 warning（照 `ui.theme` 的 `other => warnings.push(...)` 形状，句子里列出可选值）。
3. **类型不容忍**：`"language": 2` 在 serde 解析期失败 → **整份配置回落默认** + 一条「不是合法 JSON」warning。这是既有模型的明文边界（`wrong_type_ui_theme_falls_back_entire_file` 钉住），本 change **MUST NOT** 发明逐字段类型容忍。

### 3.3 写通道的已知边界

`config_set_ui_value`（`src-tauri/src/commands.rs:454-474`）不做取值校验：前端只可能传闭集合值（施加点的入参类型就是 `UiLanguage`），非法值只可能来自手写 config.json，由下次启动的 `validate()` 兜。**如实记账，MUST NOT 给 `[ui]` 加第二处「写时校验」**（同语义两处真源，REVIEW.md 第 8 条）。

## 4. 文案层形态（裁决点 D4）

### 4.1 结论

`文案-Copy.md` 保持**规范文本 + 评审面**（Alex 读的那一份，含「设计意图」列），运行时新增 `src/copy.ts` 一族：**一份双列表**（每个键一眼看到 zh 与 en 两列）+ 一个全量漂移测试把表钉回 deck。表是运行时唯一取值入口，deck 是人的唯一评审入口，两者由测试强制逐条一致。

```ts
// 形状（示意，键方案见 §4.3）
export const COPY: Record<CopyKey, { zh: string; en: string }> = {
  D44: { zh: "将覆盖磁盘上较新的内容，此操作不可撤销。确认强制覆盖保存「{path}」？",
         en: "This will overwrite newer content on disk and cannot be undone. Force save \"{path}\"?" },
  …
};
```

### 4.2 为什么不是「deck 当机器真源 + 生成 TS」

deck 的**单元格是编辑性 bundle，不是「一格一条串」**。实证（本分支 `文案-Copy.md`）：

| 行 | 中文列 | 性质 |
|---|---|---|
| D64 | `移动与选择 / 扩选 / 删除 / kill-yank / 翻屏 / 撤销 / widget / 全局 / 其他` | 一格 **9 条**串，与英文列按位置平行 |
| D66 | `「默认不占键位（有意如此）——可在 `[keys]` 里绑定」/「已被配置解绑——可在 `[keys]` 里重新绑定」` | 一格 2 条；且是 M180 **扩写**出来的（原 1 条）——格内条数会变 |
| D69 | `上一个 / 下一个` | 一格 2 条 |
| **D67** | `Esc / ⌃G 或点击遮罩关闭`（英文列 `Close with Esc / ⌃G or by clicking outside`） | **一条**串，本身就含 ` / ` |

D67 否掉了「按 ` / ` 机械切分」的便宜规则，D64 与 D66 否掉了「一格一条」的假设。生成器的解析规则因此只能是「按行号 + 格内位置的人工映射表」——那与「人在 deck 里改文案，代码跟着变」相比并没有省下审查成本，却把失败模式从「测试报红」换成「生成物静默错串」（错串直接上屏）。

结论：**表是运行时真源、deck 是规范文本与评审面，两边由测试钉住**。这不是新发明的两端，但现状的保护力度**比 deck 文本自述的弱**，这一点要如实读：真正在**运行期解析 deck 行**的只有 **2 个**单测（`end-marker.test.ts` / `image-widget.test.ts`，各带 `deckRow()` helper + `readFileSync`）；另外 **7 个**把措辞写死成字面量、只在注释里引用 D 编号（`theme` / `list-filter` / `content-width` / `tab-menu` / `table-fullscreen` 五个有 D 编号引用；`tree-paths` 断的是 Rust 侧 `fs_io.rs` 里的同源措辞；`tree-menu` 无引用）——**单独改 deck 不会让这 7 个变红**（deck 的「文案实现备注」段反复写的「两边漂移即红」对这 7 个同样不成立；这是**既有的 deck 文本夸张**，不是本 change 引入的）。本 change 把这种分散在 9 个单测里的做法收敛成**一张表 + 一条全量测试**：覆盖力度是**净增强**（今天只有 2 个单测能对 deck 的改动产生反应）。

### 4.3 键方案

键 = **D 编号**（`D44`）。理由：D 编号是全仓唯一已经在代码与 deck 之间共享的标识（模块注释与 deck 的「文案实现备注」段大量互引 D 编号），沿用它与「新增条目只追加、不复用已删除编号」的既有纪律天然兼容，且漂移测试的映射是平凡的。

多串格：`D64` 的 9 条串取 `D64.1` … `D64.9`（**格内顺序**，1 基）。漂移测试里对这类行显式声明键序列（D64 / D66 / D69 三处，写死在测试里并附「为什么不能机械切分」的注释——D67 就是反例）。**扩写一行的格内条数时，MUST 同一次改动里同步键序列**（D66 的 M180 扩写即先例），测试会以「声明与 deck 不一致」报红。

### 4.4 零新增依赖与门禁

MUST NOT 引入 i18n 依赖库（仓库取向：`tests/unit/run.mjs` 头部明文「零新增依赖」；`package.json` 现有 dependencies 里没有任何格式化/国际化库）。两条门禁：

1. **漂移门禁**：`tests/unit/copy.test.ts` 解析 deck 的全部活跃行，对每个键断言 `COPY[key].zh` / `.en` 与格内内容逐字相等；反向断言键集合与 deck 行集合一一对应（多一个键或少一个键都报红）。
2. **取值门禁**：`src/**` 除文案表自身外 MUST NOT 出现含 CJK 的串字面量。做法是用 `typescript`（已在 devDependencies）的 AST 走一遍 `src/**/*.ts`（排除 `src/bindings/**`），按注释感知地取字符串字面量——比 `rg` 精确（本仓注释全是中文，`rg` 会淹掉）。允许清单**只有一处**：文案表自身（`src/copy*.ts`）。`src/keys.ts` 的 `doc` 字段原先是第二处豁免，节点 1 裁决把它纳入语言面后改为**引用文案表键**（§8.1），豁免随之取消——门禁的允许清单从此不需要任何「业务文件」条目，这也是把它收敛成一条铁律的机会：允许清单里每多一个文件，就得配一条永远可能过期的理由。

### 4.5 上屏列锁定：M257 逼出的第三类条目

M257（已合并 `cd9142d`）的形态逼出一个本提案原先没有的一等概念。它把 D149–D151 的两列**对调**（上屏文案 `Close` 进 English 列，原中文措辞「关闭」移到中文列备查），`src/tabs.ts` 的三个常量改成英文串。**这与「两列同形」不是同一种**：D114 的两列都写 `END`（本来就不分语言），而 M257 的两列是**两个不同的串**，只是上屏固定取其中一列。

若把 M257 的条目当普通条目按语言选列，`zh` 界面下就会上屏中文列的**备查措辞**——悄悄回退 M257 的裁决。因此文案表需要一个一等的属性：

| 条目形态 | 数据表达 | 上屏规则 | 现状用例 |
|---|---|---|---|
| 普通条目 | 两列各是本语言的措辞 | 按当前界面语言选列 | 绝大多数 |
| **上屏列锁定** | 两列都保留（一列上屏、一列备查措辞），条目声明锁定的列 | **无论界面语言都取锁定列** | M257 的 D149–D151（标签菜单三项） |
| 两列同形 | 两列写同一串 | 取哪列都一样 | D77 / D80 / D114（`END`） |

三者的差别只落在**数据**上（条目自身携带的属性），所以「哪些文案不跟界面语言走」仍然只有一处真源，代码里仍然不需要例外清单。漂移门禁要断言锁列方向在表与 deck 之间一致——deck 侧写在「设计意图」列里，M257 已经这么做了（D149 的格内写着「**M257（2026-09-27 Alex 裁决「上屏」）：English 原文上屏，本行两列对调**」）。

反方如实记录：也可以把 M257 的行改写成「两列同形」（两列都写英文串），第三类就塌回第二类、机制少一个属性。不推荐的理由是丢掉的是 deck 的沿革价值（原中文措辞是「谁在什么时候把它改成英文」的证据），而多出来的属性只是一个从条目里读得出的字段。这一处取舍由裁决点 D9 定。

## 5. 施加面与重绘面（裁决点 D2 / D3）

### 5.1 运行期真源与唯一施加点

- 运行期真源 = `<html lang>` 属性（标准位，且顺手修掉 `index.html:2` 现存的 `lang="en"` 与界面不符）。取值 `zh-Hans` / `en`（BCP-47；`ui.language` 的 `zh` / `en` 映射到这对 tag 供 `Intl` 与 `lang` 属性用）。
- `applyLanguage(lang)`（`src/main.ts`，与 `applyTheme` 相邻）是**唯一**写 `<html lang>` 与唯一改文案层当前语言的地方；模块头写明「MUST NOT 出现第二处语言写入者」（照 `src/theme.ts:10-11` 的措辞）。文案层内部按 `document.documentElement.lang` 取值，**MUST NOT** 另存一份模块级当前语言（同语义两处真源）。
- 启动：`configGet().then(...)` 块内调用一次 `applyLanguage(snapshot.config.ui.language)`，位置与 `applyTheme` 相邻（同为块内末尾一族，理由见 §2）。

### 5.2 重绘面：哪些要重写、哪些天然免费

| 面 | 切换时的处理 | 为什么 |
|---|---|---|
| 按需构建的浮层 / 面板 / 菜单（`toc.ts` 浮层、`vault-switcher.ts` 浮层、`search.ts`、`tree-menu.ts`、`tabs.ts` 菜单、`bindings-panel.ts`） | **免费**：它们在打开时读文案层，切换后新开的自然是新语言 | 这些模块的文案是「打开时取值」，没有长驻文本 |
| 长驻 chrome（`tree.ts` 的 vault 头部 `title`/`aria-label` 与空态、`shell.ts` 的静态 `aria-label`、`main.ts` 的 modeline 段与恢复提示、`tabs.ts` 的标签 `aria-label`/`title`、`toc.ts` 的指示钮 `title`、`theme.ts` 的主题钮文案、`content-width.ts` 的两个手柄读屏名） | **必须重写**：模块导出一个 `relabel()`（或等价的重渲染函数），由 `applyLanguage` 按注册顺序调用 | 挂载期写死的串不会自己变（这正是「运行期即时」的真实成本） |
| 编辑器的预览装饰（附件提示、表格降级、公式/mermaid 失败、frontmatter、callout 标签、列表标记） | **走既有 `editor.refreshPreview()`**（照 `cycleTheme` 的 `invalidateMermaidTheme()` + `refreshPreview()` 形状） | widget 的文本在 `toDOM()` 里生成；`table.ts` 的降级句还经 `data-degraded` 属性被 CSS `attr()` 取用，属性不重建就不会变 |
| 正在飞的 toast | **不追改**：已弹出的 toast 保持弹出时的语言，直到消隐 | 重写一条正在消隐的浮条会跳字；如实写进 spec 的边界 |
| 日志与 `console` 输出 | **不在面内**：诊断面向开发者、语言固定（§8.2），切换语言不改它们 | 若把它们纳入，语言切换要连带重写日志输出路径——终裁判定不值当 |
| modeline 的主题钮文案、`refreshVaultStatus()` 的状态行 | 由各自的既有写入者重跑一次即可（它们是纯函数式写入） | 与 `applyTheme` 里重写主题钮同一手法 |

**不变量（写进 spec）**：任何承载语言相关文案的元素，MUST 有一条能在运行期重跑它的写入路径；挂载后无法重写的语言相关文本 MUST NOT 存在。这条不变量的判据与 §4.4 的取值门禁合起来构成「en 模式下不残留中文」的机械保证。

### 5.3 入口形态（裁决点 D3）

照 M237：modeline 右段一个指示钮（可见文本 = 当前语言标识，`hidden` 初始态、施加后才显示）+ 命令 `view.language-cycle`（`Cmd-Shift-L`，进 `NON_TAB_GLOBAL_COMMAND_IDS`、作用域机械派生为 `global`、单段无空白、可经 `[keys]` 重绑/解绑）。键位冲突按 M237 的**三条独立来源**复核并写进实现说明：① 表内（`src/keys.ts` 即真源，⌘⇧ 系现有 `Cmd-Shift-z` / `Cmd-Shift-o` / `Cmd-Shift-T`，无 `Cmd-Shift-L`）；② 原生菜单 accelerator 集合（muda 预置 = ⌘C/⌘X/⌘V/⌘Z/⇧⌘Z/⌘A/⌘M/⌃⌘F/⌘H/⌥⌘H/⌘W/⌘Q，不含 ⌘⇧L）；③ 系统级（⌘⇧L 不是 macOS 预置菜单键）。**实现期须再核一次**，不得只凭本提案的读数。

两个值的「循环」就是切换；不新增第二套交互。

## 6. 动态文案的参数化（裁决点 D5）

### 6.1 占位约定沿用 deck 现状（不发明新约定）

deck 已经在用 `{原因}` / `{标题}` / `{路径}` / `{数量}` / `{名称}` 形态（D19 / D20 / D25 / D40 / D140-D147），模板函数今天也确实是「常量 + 插值」（如 `tree-menu.ts` 的 `TRASH_CONFIRM_DIR_BODY(name)`）。所以：文案表里存**带 `{占位名}` 的模板**，`t(key, params)` 做插值。占位名 MUST 用 ASCII 标识符（`{path}` / `{count}` / `{name}`），中文占位名只在 deck 的中文列保留作可读性——**表里两列的占位名 MUST 同名**，测试断言两列占位名集合相等（否则 en 列漏一个参数就是静默的空格）。

### 6.2 数字、日期、相对时间、复数走 `Intl`（不是查表）

现状的硬编码点：

- `src/preview/doc-meta.ts` 的 `${d.getMonth() + 1}月${d.getDate()}日` / `${d.getFullYear()}年…` → `Intl.DateTimeFormat(lang, …)`；
- `src/vault-switcher.ts:163-171` 的 `relativeTime()`（「刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前」）→ `Intl.RelativeTimeFormat`；
- `main.ts` 的 `${lines} 行`、`vault-switcher.ts` 的 `${tabCount} 个标签`、`table.ts` 的 `${kib} KiB` 等计数串 → `Intl.NumberFormat` + 复数形态；
- 复数：英文 `1 tab` / `2 tabs` 无法靠中文量词裸拼覆盖，MUST 用 `Intl.PluralRules` 选形态，**MUST NOT** 用 `count === 1 ? a : b` 手拼（那是把语言的复数规则写死在代码里）。

`Intl` 在 WKWebView 与 chromium 都可用（Tauri 2 的 macOS 最低版本远高于 ICU 内置所需），因此零依赖、零 polyfill。**MUST NOT** 引入 ICU MessageFormat 全套（多语言语法变形不在本 change 的面内，见 Non-goals）。

### 6.3 例外：**文件名**不走语言面

`src/save-controller.ts:168/176` 用「恢复」拼派生文件名（崩溃备份另存）；`recovery` 目录名同理。它们**进磁盘**，是数据不是文案：**MUST NOT** 随语言变化（否则同一次崩溃在不同语言下的备份名不同，恢复链路与测试判据全乱）。这条要写进 spec 的不变量段。

## 7. Rust 侧人话文案的归属（裁决点 D6）

### 7.1 现状：99 个构造点 / 46 个 code / 82 个模板

`errorMessage()`（`src/ipc.ts:35`）直接把 `CommandError.message`（Rust 侧格式化的中文）交给 toast / notice。前端已有一处**同款做法的雏形**：`SAVE_ERROR_HINTS`（`src/save-controller.ts:147-152`）是 `Record<code, string>`，把 4 个 code 映射成人话兜底。本 change 把这条既有线路从 4 个 code 推广到 46 个。

### 7.2 为什么不能只按 `code` 出文案

46 个 code 里有 23 个「一个 code 多种 message」（`fs_read_failed` 3 种、`fs_name_invalid` 4 种、`config_write_failed` 4 种……）。三种可选做法：

| 做法 | 代价 | 取舍 |
|---|---|---|
| **(a) 按 code 出文案（推荐）** | 需要前端对多模板 code 各写一条**覆盖式**句子（如 `fs_read_failed` 收敛为「无法读取 {rel}：{reason}」），细节措辞有损失 | 与既有设计一致：D143-D147 已经立了「前后端同一句话的两种粒度」的口径；且**参数仍需从 Rust 来**（`rel` / `name` / `e`），因此 Rust 侧 `CommandError` 增一个 `params` 字段（`Map<String, String>`，缺失可省），`message` 保留 |
| (b) Rust 侧自带双语文案表 | 同一批文案在 Rust 与 TS 各一份，跨语言漂移（REVIEW.md 第 8 条）；Rust 还要知道当前语言（新增状态与通道） | 拒绝 |
| (c) 前端渲染 + Rust 只留 code、删掉 message | 日志失去人话（`message` 是日志与未知 code 的兜底） | 部分采纳：见 (a) 的括号 |

推荐 (a)：**前端按 `code` 渲染、参数由 Rust 的 `params` 提供、`message` 退回「日志 + 未知 code 兜底」**（`message` 作为日志内容保持原样，不随语言变，见 §7.4 / §8.2）。落地要点：

- 前端 `t` 层新增 `errorText(e)`：`isCommandError(e)` → 有 copy 条目则渲染 copy（插 `params`）；无条目 → 回落 `e.message`（兜底存在但**不可达**，由完整性门禁保证）；
- 完整性门禁：从 Rust 侧枚举全部 code（源码扫描或一份共享清单）与文案表的 code 条目对账，缺一即红；
- 日志与诊断不受语言影响（`logEvent` 的事件名与 `level` 是集合值，与文案无关）；Rust 的 `message` 也不再是「一等人话」，它在日志里保持原样（§8.2）。

### 7.3 其余两处 Rust 上屏文案

- **原生目录选择器标题**（`src-tauri/src/commands.rs:537` 的 `.set_title("选择 vault 目录")`）：由 OS 渲染、无法运行期切换。做法：Rust 在弹选择器时读一次 `ui.language`（config 在 Rust 侧，`config::load()` 是既有函数）决定标题；**运行期切换对已经弹出的选择器无影响**（如实写进边界）。默认语言改判为 `en` 后，未配置用户的标题由中文变英文——这是默认值的直接后果，实现期在 PR 写明。
- **启动恢复 notice**（`src-tauri/src/lib.rs` 的启动路径）：走 `params` + code 的同一路径（它是 notice 不是信封时，按其形态归入同一张 code 表）。

### 7.4 日志与配置告警：**不进语言面**（Alex 节点 1 终裁 2026-09-27）

终裁原话：「日志消息就固定用英文，无需 i18n。」——他先前的「日志也纳入」被这一句撤回，原 Non-goals 第 3 条按其本意保留（诊断面向开发者、语言固定）。因此：

- `console.warn` 的句子、`logEvent` 的 `message` 字段、`ConfigSnapshot.warnings` 的文本与形态**本 change 都不动**（`warnings` 继续是 `Vec<String>`，Rust 侧照今天的样子拼句）；日志**事件名 / 等级 / 字段名 / 集合值字段 / `CommandError.code`** 也一律不翻——它们是稳定契约，`scripts/acceptance/` 的断言与 `docs/backlog.md` 的排查口径都按字面量 grep。
- **一处口径待确认**（本 change 不自行决定）：终裁说的是「固定用**英文**」，而现状里日志的 `message` 文本是**中文**（只有事件名 / 字段名是英文标识符，见 §1.1）。本 change 按「文本保持现状、不进语言面」执行；若要把日志文本本身改写为英文，那是一次与语言设置无关的一次性改写（改动面：`config.rs` 18 条 + `keys.ts` 6 条 + `typography.ts` 1 条 + `main.ts:546` 1 条 + 各处 `logEvent` 调用点），需另立条目。已向 tower 报备（见 proposal 的「节点 1 裁决」段）。
- 代价如实记账：日志面因此与界面语言**不同语言**（例如 en 界面下日志仍中文）——这是终裁选定的取舍，不是漏做。

## 8. 覆盖面的取舍（明写，防实现期漂移）

### 8.1 键位面板的逐条 `doc`（59 处）：**纳入双语面**（节点 1 裁决 2026-09-27）

原稿把 59 条 `doc` 排除在外，依据是 deck 的明文：面板里逐条显示的**键位来由**「不是本 deck 的条目——它来自 `src/keys.ts` 键位表的 `doc` 字段（表即文档，随绑定一起维护）」。**Alex 2026-09-27 否决了这个排除**（原话见 proposal 的「节点 1 裁决」；随后他对同一条裁决里的「日志」部分做了修正，**键位面板这半不变**）。纳入的落法要把 deck 的这条明文一并改准，否则真源分裂成两份：

1. `src/keys.ts` 的每条绑定保留 `docKey`（替代 `doc` 的文本），只表达「这条绑定为什么存在」的**引用**；文本移入文案表，按 D 编号索引，两列在 deck 里并排（同一条目在中文列写今天的中文说明、在英文列写英文说明）。
2. 这 59 条是面向贡献者的出处说明（含 M 编号、Emacs 术语、`⌘`/`⌃` 符号、裁决点编号），英文列要处理这些术语的写法：**`M149` / `Emacs` / `⌘⇧L` 一律保留原形**，只翻译句子结构。这条约定写进 deck 的「设计意图」列与实现说明，防「照音译 M 编号」这类噪声。
3. 面板骨架 / 分组标题 / 未绑定标注等 16 条本就在面内、随语言切；纳入后整个键位面板在 `en` 下不再有中文残留——取值门禁（§4.4）因此不再需要 `keys.ts` 这条豁免。

### 8.2 只进日志/诊断的串：**不进语言面**（Alex 节点 1 终裁 2026-09-27）

**不翻、也不进语言面的部分**（Alex 节点 1 终裁）：`logging.rs` 的**事件名**（`LogEventName` 的 snake_case 字面量，如 `autosave_paused` / `save_external_change`）、等级（`info` / `warn` / `error`）、字段名、取闭集合值的字段值（`outcome` / `category` / `change` / `scheme` 等）、`CommandError.code`，以及**日志与配置告警的文本本身**（`console.warn` 句子、`logEvent` 的 `message`、`ConfigSnapshot.warnings`）。判据：标识符是**机器可读的稳定契约**——`scripts/acceptance/` 的场景断言、`docs/backlog.md` 的排查口径与 agent 的日志取证都按字面量 grep，翻译或改写它们会让历史日志与新日志对不上号，直接打断诊断链；文本则因为**诊断面向开发者、语言固定**（终裁：「日志消息就固定用英文，无需 i18n」——「固定」即不随界面语言变，见 §7.4 的口径待确认项）。

**用户可见文案仍不受影响**：日志不进面，但同一条错误**上屏**的部分照 D6 走 `code` + `params` 的前端渲染（§7.1–7.2），两者是不同的出口。

这张边界有个可复核的判据：**「机器读的还是人读的」**。日志行里人读的部分（`message`）与机器读的部分（事件名 / 等级 / 字段名 / 集合值）**都不进语言面**——区别只在于人读的部分是「可以翻译但不做」，机器读的部分是「不能翻译」。这条区分在当前 change 里没有实现后果（两者都保持原样），但它解释了为什么将来若要改日志语言，只有 `message` 是可以动的。

### 8.3 macOS 原生菜单：**不切（半覆盖，如实记账）**

应用菜单（File / Edit / Window / Close / Undo / Redo / Quit / Minimize…）来自 tauri/muda 的预置英文项，全仓 Rust 侧**没有中文菜单项**。而且 Rust 用**字符串相等**做结构校验（`is_close_item_text`、`is_quit_item_text`、`edit_items_are_predefined_undo_redo`、子菜单名判 `"File"`/`"Window"`/`"Edit"`），这些判定**本身就是 locale 敏感的**——今天系统语言或 muda 版本一变，菜单改造整段早退（有 stderr 警告兜底但功能静默退化）。改菜单文案要连带重做这套判定，属另一个 change。

结论：en/zh 两种模式下应用菜单都是英文。这不是漏做，是**如实登记的半覆盖**（也是「英文已是常态」的一处既有事实）。

### 8.4 文档内容与其派生物：**不切**

正文、frontmatter 值、文件名、路径、wikilink 文本、`END` 这类语言无关标记：进文档或磁盘的东西 MUST NOT 随界面语言变（ADR 0003 §3 铁律的下游）。`callout` 的**类型标签**（`笔记` / `摘要`…）是界面文案（渲染时生成、不写入文档）因此在面内——它是全仓唯一已经是双语形态的地方（`preview/callout.ts:78-90` 的 `register(canonical, zh, …)` 同时持中英两列），可作本 change 的局部先例。

## 9. 风险与未决点

| 项 | 状态 | 处置 |
|---|---|---|
| **启动首帧闪烁**：`ui.language` 经异步 `config_get` 到来，而 shell 与树空态在配置到达前就已挂载 ⇒ **默认 `en` 下风险落在配置为 `zh` 的用户**（可能先闪一帧英文；默认态因 `index.html` 写死的 `lang="en"` 与默认一致而风险最低） | **未验**（机制清楚：`createShell` 在 `configGet()` 之前调用） | 真机逐帧实测（tasks §1，按 `ui.language=zh` 配置测）：若可测出，两种候选缓解——① 把承载文案的 chrome 延迟到配置到达后写入（modeline / 树状态行本就由后续步骤写）；② 配置到达前不显示文案承载元素。**MUST NOT** 静默接受闪烁 |
| 在飞的 toast 不追改 | 设计口径 | 写进 spec 的边界 scenario |
| 写通道不校验（§3.3） | 既有模型的明文边界 | 只由启动 `validate()` 兜，如实记账 |
| `data-degraded` 走 CSS `attr()` 的降级句 | 机制清楚（属性不重建就不变） | `applyLanguage` 必须调 `refreshPreview()`；tasks §4 有独立断言 |
| 键位来由 59 条纳入后工作量上修（§8.1，节点 1 裁决） | 已裁决，真源不再分裂 | +59 条长句的英文列（M 编号 / Emacs 术语保留原形）；面板在 `en` 下无中文残留；英文列质量是 Alex 的文案评审点 |
| **默认语言改判为 `en`**（D1 已裁决） | 已裁决，代价明确 | **既有整页基线（中文态）全量重拍 + 逐张请 Alex 过目**（基线更新是人肉裁决点）；「迁移逐像素中性」改为一次性 zh 对照（tasks 8.1） |
| 日志 / 配置告警与界面语言不同语言（en 界面下日志仍中文） | 终裁选定的取舍（诊断面向开发者、语言固定，§8.2） | 如实写进 spec 与 PR；另有一处待确认口径（终裁说「固定英文」而现状文本是中文）已在 §7.4 与 proposal 报备 |
| 原生目录选择器标题与 macOS 菜单（§8.3） | 半覆盖 | 写进 spec 的已知边界；默认 `en` 后未配置用户的选择器标题由中文变英文，PR 写明 |
| deck 扩容、英文列要新写（原估约 180–200 行 / 约 190 条，终裁纳入键位来由后上修） | **本 change 的关键路径**（Alex 的文案评审节点） | tasks §3 单列一组；数字在 tasks §1 的读数任务里改准 |
| 三条标签菜单项与 M257 的关系（M257 已裁恒定英文上屏并**已合并 `cd9142d`**；默认语言已裁为 `en`，这三项在 `zh` 界面下是否随语言显示中文） | **待 Alex 裁决**（裁决点 D9；推荐项＝与 M257 一致，登记为**上屏列锁定**条目） | 推荐项下只把这三条登记为锁列条目（§4.5），不动 M257 的形态与串；备选（随语言走）下要**回退 M257 的裁决**——`src/tabs.ts` 三常量、deck 双列与 `tab-menu` 的两处文案断言，且 `zh` 界面上屏中文 |

## 10. 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| **仅配置 + 重启生效**（D2 备选） | 便宜（零重绘面、零重写路径），但切换语言的代价是重启整个应用；且 M237 已经把「运行期即时 + 写回」做成了本仓的既有范式，同一族偏好两种语义是给用户制造两套心智。**若 Alex 取此项，§5.2 的重绘面整段删除，tasks 相应减半——这是本 change 体量最大的一处开关** |
| **切换时整窗 reload / 整壳重挂** | `location.reload()` 会丢掉 dirty 缓冲（会话语义明确不存未保存内容）；整壳重挂同样丢未保存内容、撤销史与会话内滚动位置，还要新增一条「有脏标签先拦下」的守卫。以「不弄丢作者的工作」为第一约束，这两条都不成立 |
| **引入 i18n 库**（i18next / FormatJS 等） | 仓库取向是零新增依赖（`tests/unit/run.mjs` 头部明文），且本 change 需要的三件事（双列表查找、`{slot}` 插值、`Intl` 格式化）都在标准库里 |
| **deck 直接当机器真源 + 生成 TS** | §4.2：格是编辑性 bundle（D64 九条、D66 两条且会扩写、D67 一条本身含 ` / `），生成器要么需要人工映射表、要么静默错串 |
| **符号键（`tree.menu.trash.title`）而不是 D 编号** | D 编号是全仓唯一已共享的标识，符号键要在 deck 新增一列并让「新增条目只追加」的纪律多一条维护面；D 编号作为键的弱点（数字不表意）由 deck 的「位置」列覆盖 |
| **跟随系统语言**（D1 备选） | 同一族的主题**明文拒绝**跟随系统（`ui-design-system` 的「三主题与主题选择」：MUST NOT 引入 `prefers-color-scheme`），配置即数据（ADR 0002 §5）；跟随系统等于给显示偏好开第二处真源。若 Alex 要，需同时回答「系统语言变化时是否运行期跟随」 |
| **Rust 侧自带双语文案表** | §7.2 表：跨语言漂移 + Rust 需要知道当前语言 |
| **只做前端、Rust 文案仍中文** | en 模式下每一条后端错误都是中文，是用户最先撞见的那一类（保存冲突、文件不存在），半覆盖的观感最差 |
| **日志与配置告警纳入语言面**（2026-09-27 Alex 的初版裁决） | **随后由他本人修正撤回**（「日志消息就固定用英文，无需 i18n」）：诊断面向开发者，纳入语言面会让语言切换连带重写日志输出路径，收益不成立。原 Non-goals 第 3 条按其本意保留，见 §7.4 / §8.2 |

## 11. capability 归属

**结论**：新建 capability `ui-language`（ADDED ×7）+ `keymap-commands` 新增一条命令 requirement（ADDED ×1）。**`ui-design-system` 零增量**。

理由：

1. 语言面**不是视觉设计决策**。`ui-design-system` 的 Purpose 是「token 层承载全部视觉决策 + 三主题 + eink 降级 + 骨架几何 + 基线纪律」；「文案用哪种语言说」与「底色取哪个 token」不是同一族问题，塞进去会让那份 spec 的 Purpose 失真。
2. 语言面**横跨全部 capability 的可见文案**（树 / 标签 / 搜索 / 大纲 / 预览 / 保存链路 / 键位面板），按「影响多个 capability 的可见行为」的口径，它需要一个自己的居所而不是寄居在某一份 spec 里。
3. 它确实**只有一份真源**（deck + 运行时表），有独立的规范文本与独立的门禁——新建 capability 让这些条款有一个不再被别处复制的居所。
4. `keymap-commands` 要有 delta：新增命令 id 与默认绑定是该 capability 的本体（`view.theme-cycle` 的先例就是一条独立的 requirement）。
5. `ui-design-system` 零增量的**反方记录**：语言指示钮是 modeline 右段的新 chrome 元素。但该 spec 的 chrome 条款是**通用**的（浮层壳 / 阴影两档 / token 取值），既有的主题钮（M237）也没有被逐元素枚举；新钮复用同族样式即可，**没有一句话变假**。若 Alex 认为「modeline 右段指示钮」需要在 `ui-design-system` 留痕，节点 1 可要求补一条 MODIFIED（内容是枚举右段两个指示钮），那是一次文本复制，不引入新行为。

**既有 living spec 的中文引文怎么读**（这一条要写进新 capability 的条款，不改那 7 份 spec）：`multi-tabs` / `fs-io` / `vault-workspace` / `content-width` / `file-tree` / `ui-design-system` / `keymap-commands` 里有 7 处直接写出中文可见文案（如 `multi-tabs` 的「保存并关闭 / 放弃修改并关闭 / 取消」）。本 change 的口径：**这些引文一律读作该串在 `zh` 界面下的取值，不构成语言约束**；把它们改写为引用 D 编号是一次独立的收尾治理（体量与风险见 proposal 的 Non-goals），不在本 change 内做。

## 12. 验收面（与 tasks.md 对应）

- **合同层**：新 capability `ui-language` 的 7 条 ADDED requirement（文案真源与运行时表 / `[ui] language` 配置项 / 运行期切换与单一施加点 / 切换入口 / 动态文案参数化与本地化格式 / Rust 文案归属 / 不随语言变化的面）+ `keymap-commands` 的 1 条 ADDED（`view.language-cycle`）。
- **单测层**：deck↔表漂移全量（含多串格的键序列与 59 条键位来由）、取值门禁（`src/**` 除表自身外零 CJK 字面量）、`t()` 的插值两列占位名同名、`errorText()` 的 code 覆盖与兜底、复数与日期格式化的分支。
- **视觉层**：默认 `en` 下既有整页基线（中文态）**全量重拍并逐张请 Alex 过目**；迁移的「逐像素中性」改为一次性 zh 对照（`ui.language` 固定为 `zh` 跑一遍，与旧基线比——任何 diff 都说明某条串被改动了，见 tasks 8.1）；新增一条 `en` 面场景（chrome 文案 + 语言切换 + 切换后不残留中文），不为每个既有场景加 en 基线（成本与收益不成比例，如实登记为覆盖选择）。
- **真机层（WKWebView）**：场景 **55**（编号声明见 tasks §6）——切换入口触发、chrome 与预览装饰同步换语言、写回配置、重启后首帧即配置语言、`unchangedSince` 不改写源文件。
- **反向验证**：取值门禁与漂移门禁先红后绿（REVIEW.md 第 1 条）；把 `applyLanguage` 的重绘段注释掉后 en 面场景必须红（否则重绘面形同没有）；键位面板逐条来由的 en 断言在 doc 改为键引用前必须红（1.3④）。
