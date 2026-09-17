# Tasks: 多标签页（MultiTabs）

> 勾选口径：每条给**可复核的证据指针**（命令 / 场景名 / 文件），拿不出证据的写「未验」。
> 证据落在 `test-results/`（本地留存、git 外）或门禁输出，不写「跑过了」而不给路径。

## 1. 架构：单 EditorView + 每标签留存 EditorState

- [x] 1.1 `src/editor.ts` 引入 `EditorSession`（state + 路径 + cleanDoc + dirty + preview + 滚动快照 + 模式），
      `openDocument` 拆成 `createSession` / `reloadSession` / `activateSession` / `closeSession`；
      切换走 `view.setState`，不重建 view、不重新解析文档
- [x] 1.2 撤销史 / 语法树 / 选区 / 搜索查询随 state 走（逐会话独立）：`sessionState()` 每次新建
      一份 state，而不是复用同一个 state 对象
- [x] 1.3 滚动位置逐会话存取：存 `view.scrollSnapshot()` 的产物（不是裸 `scrollTop`——直接写
      `scrollDOM.scrollTop` 会被 CM 的滚动锚点维护逻辑改掉，实测差 242px）
- [x] 1.4 运行时经 `StateEffect.appendConfig` 追加的扩展（当前是 `src/toc.ts` 的大纲监听）
      随新建会话带上：否则新标签上大纲指示段静默停更。收集点在 `collectAppendedExtensions`
- [x] 1.5 证据：`tests/visual/scenes/m149-tabs.spec.ts` 的「切标签保留滚动位置与撤销史」用例
      ——滚动判据是**视口顶行与离开时同一行**（用 `view.posAtCoords` 读，见该用例 `topVisibleLine`
      的注释）；撤销史判 ⌘Z 撤回的是切走之前那次输入。**不断言 scrollTop 像素值**：恢复走 CM 的
      scrollTarget、由它自己的测量周期落地，而本应用的 scroller 是 grid 布局（实测同一行仍置顶
      时该值可以读到 0）。反向验证：注释掉 `editor.ts` 的 `activate()` 里那句滚动恢复重跑，
      该用例如实变红（Expected `填充 44 行。` / Received `# 顶部 TOP-MARK`）。
      （reviewer r1 P2-2：原文写「scrollTop 差 ≤20px」，与用例实际断言不符，已改正。）

## 2. 标签栏 UI

- [x] 2.1 `src/shell.ts` 建标签栏容器（`role=tablist` + 读屏名「打开的文档」），空态 `hidden`
- [x] 2.2 `src/main.ts` 的 `renderTabs()` 全量重建标签：激活高亮、dirty 点、预览斜体标题、
      点击切换、逐标签关闭钮（读屏名「关闭 <文件名>」）、悬停给完整相对路径
- [x] 2.3 样式进 `src/style.css`，只用 M55 既有 token（`--bg-nav` / `--bd-*` / `--text` /
      `--dim` / `--accent` / `--font-body` / `--radius`），不动正文列宽（网格新增一行，
      标签栏隐藏时该行塌成 0）
- [x] 2.4 溢出用横向滚动（`overflow-x: auto`），不做拖拽排序 / split view / 下拉折叠
- [x] 2.5 证据：`scripts/gate.sh visual` 的 `m149-tabs` 场景，元素级基线
      `tests/visual/baselines/m149-tabs.spec.ts-snapshots/tab-bar-{preview,dirty,two-pinned}-chromium-darwin.png`

## 3. 打开 / 固定语义

- [x] 3.1 单击树文件 = 复用预览标签（就地替换，不新开、不换位置）
- [x] 3.2 双击或首次输入 = 固定（双击走「已打开 → 切过去 + 清预览标记」；首次输入由
      `editor.onDocChanged` 且 `dirty` 判定，装载不算编辑）
- [x] 3.3 ⌘-点击树文件 = 新固定标签（`src/tree.ts` 判定点击形态，装配层只消费意图）
- [x] 3.4 同一个文件已打开时切到既有标签，不重复开
- [x] 3.5 文档内链接 ⌘-点击行为不变（跟随链接走 `intent: "current"`，是 `openFile` 的默认值）
- [x] 3.6 未命名文档 dirty 时打开文件仍被拦下（M130 语义与文案保留）
- [x] 3.7 证据：`m149-tabs.spec.ts` 的「打开意图」用例（⌘-点击 / 双击 / 复用）+ `14-tabs` 的
      前四步（真机单击复用、首次输入固定、另开标签）

## 4. 键位全进 keys.ts 统一命令层

- [x] 4.1 `tab.close` / `tab.next` / `tab.prev` / `tab.goto-1`…`tab.goto-9` 进 `GLOBAL_COMMAND_IDS`，
      进 `KEY_BINDINGS`（`⌘W` / `⌃⇥` / `⌃⇧⇥` / `⌘1–9`），随 `COMMAND_IDS` 自动进
      `app.describe-bindings` 面板与 `[keys]` 配置覆盖
- [x] 4.2 零冲突核实（三条独立来源：表内 / 原生菜单 accelerator / 系统级）写进绑定的 `doc`
      字段与 proposal；`⌘W` 的冲突与处置一并留痕
- [x] 4.3 `⌘W` 关 dirty 标签先给三出口确认（文案 D92 / D93）
- [x] 4.4 面板分组单列「标签」组，且与「全局」组互斥（`TAB_COMMAND_IDS` /
      `NON_TAB_GLOBAL_COMMAND_IDS`），否则同一命令被两组合并渲染两行
- [x] 4.5 `src-tauri/src/lib.rs` 按 M131 先例把 File / Window 两个预置 Close 换成不带加速键的
      自定义项，菜单点击经 `app:menu_command`（载荷 `close`）回前端 `tab.close`
- [x] 4.6 lib.rs 内联测试覆盖：关闭项文案校验（正/反例）+ 两个菜单项 id 各自到载荷的映射
- [x] 4.7 证据：`cargo test` 全绿（见 §8）；`m149-tabs.spec.ts` 的「菜单关闭项 → tab.close」
      用例（`fireMenuCommand(page, "close")`，与 M131 测菜单事件的深度相同）；
      `14-tabs` 的 ⌘1 / ⌘2 / ⌃⇥ / ⌘W 真机步骤

## 5. 粒度升级：dirty / 外部变更 / revision / 保存按标签隔离

- [x] 5.1 `src/save-controller.ts` 的状态从「当前展示文档」升级为**按路径键控**：
      revision 表、在途保存集合、自动保存暂停原因、debounce 定时器
- [x] 5.2 自动保存逐标签独立（切标签不会把待写定时器带到新文档上）
- [x] 5.3 `⌘S` 只存前台标签；后台标签的保存同样走 `saveDocument(path)`
- [x] 5.4 外部变更对**全部**打开的文档处置（`main.ts` 遍历会话），浮条点名文档
- [x] 5.5 后端 dirty 镜像取「任一标签有未保存修改」；`beforeunload` 同判据
- [x] 5.6 切换 vault 的守卫升级为「任一标签 dirty 即拦下」（`guardVaultSwitch`）
- [x] 5.7 关闭 dirty 标签有确认，保存未闭环时不关闭
- [x] 5.8 save-controller 原先经 `appendConfig` 自装的 updateListener 收进内核的
      `editor.onDocChanged`（那条路径只作用于当时那一个 state，新标签会静默失效）
- [x] 5.9 证据：`14-tabs` 的「后台标签的文件被外部删除」一步——`vaultRm` 删掉**后台**标签的
      `tabs-a.md`，浮条点名 `「tabs-a.md」`、前台正文与标签数都不变；`gate.sh visual` 的 save-*
      系列场景全绿（见 §8）
      （reviewer r1 P2-2：原文写「后台标签被外部**改写** → 浮条点名 `tabs-long.md`」，事件类型
      与文件名都错，已按场景实际内容改正。）

## 6. 文件树联动

- [x] 6.1 树高亮跟随当前标签：`syncActiveDocument()` 在每次切换 / 关闭后 `tree.setCurrentPath`
- [x] 6.2 关掉最后一个标签回空态：标签栏隐藏、masthead「无当前文件」、树无高亮
- [x] 6.3 证据：`14-tabs` 的「选『放弃修改并关闭』」步骤（标签数 0 + masthead 回空当前文件）；
      `m149-tabs.spec.ts` 的 ⌘W 用例末段

## 7. openspec change add-multi-tabs

- [x] 7.1 `proposal.md`：Why / What Changes / 已裁决口径 / 键位冲突核实 / **语义变化**（⌘W 归标签、
      dirty 不再拦截有路径标签的打开、切换 vault 守卫取全体、搜索面板逐标签）/ 非目标 / 影响面
- [x] 7.2 `specs/multi-tabs/spec.md`：标签模型与切换、标签栏显示与形态、打开与固定语义、
      未命名文档守卫、保存粒度按标签隔离、文件树联动与空态（6 条 Requirement，含 Scenario）
- [x] 7.3 `specs/keymap-commands/spec.md`：标签命令族与 `⌘W` 归标签（含菜单让出加速键的
      结构性假设与转发路径）
- [x] 7.4 `tasks.md`（本文件）
- [x] 7.5 不改 `openspec/specs/**`；`npx @fission-ai/openspec validate --all --strict` 通过（见 §8）

## 8. 门禁

- [x] 8.1 `scripts/gate.sh quick`：7/7 PASS、无 SKIP（含 `cargo clippy` / `cargo test`——
      本 mission 动了 `src-tauri/src/lib.rs`，Rust 门禁是真约束）
      → 证据：`scripts/gate.sh visual` 的 quick 层逐项 `GATE PASS cargo-fmt / cargo-clippy /
      cargo-test / bindings-drift / tsc-root / tsc-visual / openspec-validate`，SKIP 0
- [x] 8.2 `scripts/gate.sh visual`：全绿
      → `GATE RESULT: 8/8 PASS（SKIP 0）`；`visual-regression` 157s、224 用例全过（含新增
      `m149-tabs` 场景）
- [x] 8.3 真机全量 `node scripts/acceptance/run.mjs`：**22/22 PASS**
      → 证据 `test-results/acceptance/2026-09-17/`（`summary.md` / `results.json` / 各场景
      `steps.md` + `shots/` + `ax/`）。新增 `14-tabs` **PASS，43 条断言 0 失败，37.4s**；
      复跑记录（2026-09-17）：首轮 0/1（两条口径问题，均已修——见下面 8.4 之后的「首轮 FAIL 归因」）
- [x] 8.4 视觉基线：逐张核对 + 前后对比说明
      - **12 张整页基线随标签栏更新**（都「有文件打开」→ 标签栏占掉编辑器列顶部一行，正文整体
        下移约 31px）：`app-main/filetree-open`、`callout/{rendering,theme}`、
        `math/{rendering,theme}`、`mermaid/{rendering,theme}`、`render-codeblock`、`render-hr`、
        `render-link`、`render-quote-list`、`wikilink-states`。
        核对方式：逐张看 `*-diff.png`（差异形态是「顶部新增标签栏 + 全篇文字下移一档」，与预期
        渲染一致）+ **reviewer r1 的独立像素审计**。以下读数以 reviewer 的审计为准——我这边只做了
        目视核对，不足以支撑「逐像素未动」这种断言（reviewer r1 P2-4 已指出原措辞失实）：
          - 左栏 `x < 244` 全部 **0 差异**；
          - 正文按 31px 位移对齐后 **10/12 张为 0.000%**；
          - **8/12 张吃进 M148 的 toc 指示段（`› Demo Vault`）、mermaid 两张吃进 M138 的 js 代码块
            着色（952px）**；其中 952px **小于容差 960px**（1200×800 × 0.001），属 REVIEW.md 第 3 条
            「容差宽到能吞掉一次真实变化」的同族现象（reviewer 已另发 TowerFinding，建议把这条补进
            第 3 条的证据）。
          基线本身对当前构建是真实的（门禁绿、残差全部归因）；失实的是原说明里「masthead /
          指示段 / 正文渲染本身逐像素未动」这句未经核对的断言，此处按实测改写。
      - **空态基线 `app-main.png` 逐字节零变化**（不在改动清单里）——这是「标签栏空态隐藏、
        不占行高」的直接证据。
      - **三张既有元素级基线零变化**：`toc-popover`、`describe-bindings-panel`、
        `render-codeblock-json-line`（面板那张不受影响的原因：新增的「标签」组排在分组列表
        末尾，落在面板可滚动区的折叠线以下，元素截图的可视区没有变化）。
      - **三张新增元素级基线**（新 UI，需 Alex 过目）：
        `tests/visual/baselines/m149-tabs.spec.ts-snapshots/tab-bar-{preview,dirty,two-pinned}-chromium-darwin.png`
        （956×31）——分别钉预览态斜体、dirty 点、两个固定标签 + 激活态。

### 首轮 FAIL 归因（真机 14-tabs 首轮 0/1，两条都不是产品缺陷）

1. `（未保存）` 计数断言与自动保存的 2s debounce 抢窗口：`do: type` 本身要几百毫秒到一秒，
   断言那一刻还带标记、下一步按 ⌘W 时它已被自动保存清掉，于是标签被**直接关掉**（ACK 里
   看到 `无当前文件` 与 0 个关闭钮）。处置：**不再在真机通道断言 dirty 标记**，改为先用
   `vaultRm` 让 save-controller 进入 `pauseAutosave(not-found)` 暂停态把 dirty 变成持久态，
   再验「⌘W 先给确认」。口径与理由写进了场景正文。
2. `editor: { not: "TOP-MARK" }` 当滚动判据不成立：本应用 scroller 是 grid 布局，CM 的视口
   范围远超可见区（实测可见约 24 行时 `.cm-content` 里能查到 70+ 行）。处置：滚动/光标恢复
   改由视觉通道判（`posAtCoords` 读视口顶行 + 反向验证），场景正文写清了这条分工。

## 9. 验收场景 14-tabs

- [x] 9.1 `scripts/acceptance/fixtures/`：`tabs-a.md` / `tabs-b.md` / `tabs-long.md`
      （短文档 + 一篇多屏长文，用于滚动恢复的派生证据）
- [x] 9.2 `scripts/acceptance/scenarios/14-tabs.md`：开 / 切 / 关 / 预览替换 / 首次输入固定 /
      ⌘1–9 直达 / ⌃⇥ 循环 / ⌘W 干净关 + dirty 确认 + 关掉后交给邻座 / 空态之后还能继续开 /
      后台标签被外部删除时浮条点名它
      （reviewer r1 P2-2：原文把「滚动恢复」也列入本场景覆盖，与场景正文明确排除它矛盾——
      那条覆盖在视觉通道，见 9.4 与 §8）
- [x] 9.3 `node scripts/acceptance/run.mjs --check`：22 个场景静态校验通过
- [x] 9.4 正文写清断言口径（标签计数用关闭钮读屏名；**不断言 dirty 标记**——自动保存的 2s
      debounce 与 `do: type` 抢窗口，改为先用 `vaultRm` 把自动保存停在暂停态、再验 ⌘W 确认）与
      **未进本场景的通道**：⌘-点击 / 双击（套件无法表达）、原生菜单点击（点不到菜单栏）→ 视觉
      场景；**滚动 / 光标恢复 → 视觉通道**（`AXTextArea.value` 不是视口代理）；标签栏视觉 →
      元素级基线

## 10. 已知边界 / 不做

- [x] 10.1 会话恢复（重启后重开标签）不做——留 `docs/backlog.md`
- [x] 10.2 拖拽排序 / split view / 标签预览浮层不做（proposal 的非目标）
- [x] 10.3 未命名文档 dirty 时打开文件仍拦截（沿用 M130），未做成「未命名标签」形态

## 11. 评审 r1（reviewer-tabs）修复

- [x] 11.1 **P2-1 零标签时 ⌘W 非无操作**：`closeTab()` 加 `session.path === undefined` 守卫
      （未命名文档不是标签，⌘W 与逐标签关闭钮对它一律无操作）。回归测试：
      `m149-tabs.spec.ts` 的「零标签时 ⌘W 无操作」——**反向验证**过：去掉守卫后该用例变红
      （Expected 演示文档原文 / Received `""`，即文档被静默清空）；同时断言 dirty 的未命名文档
      不再弹出主体为空的确认浮条。
- [x] 11.2 **P2-2 证据失实三处 + openDocument 残留注释**：§1.5（改为「断言视口顶行与离开时
      同一行，不断言像素值」并附反向验证）、§5.9（改为实际场景：`vaultRm` 删后台标签的
      `tabs-a.md`、浮条点名 `tabs-a.md`）、§9.2/§9.4（把「滚动恢复」从本场景覆盖里去掉，
      写明它在视觉通道）；注释三处里 `tests/visual/scenes/{mermaid,toc-outline}.spec.ts` 已改，
      `src/preview/livePreview.ts:427` 不在本 mission 改动面内 → 已发 finding 请 tower 路由。
- [x] 11.3 **P2-3 三条 spec 场景无回归防线**（tower 裁决：补测）：`m149-tabs.spec.ts` 新增
      「⌘S 只存前台标签」「自动保存的 debounce 逐标签独立」「后台标签的外部修改也自动重载」。
      定时器那条做过**反向验证**：把 reconcile 的落点改成「到点读前台」（朴素共享定时器的写法），
      该用例如实变红（Expected `"AAA"` / Received 原 alpha 内容 = alpha 永远等不到落盘）。
- [x] 11.4 **P2-4 基线对比说明漏报**：§8.4 按 reviewer 的独立像素审计改写——左栏 0 差异、
      正文位移对齐后 10/12 张为 0.000%、8/12 张吃进 M148 指示段、mermaid 两张吃进 M138 的
      js 代码块着色（952px，**小于** 960px 容差）；并明确「masthead / 指示段 / 正文渲染本身
      逐像素未动」那句是我**未经核对**的断言，不是事实。
- [x] 11.5 修完重跑：`scripts/gate.sh visual` **8/8 PASS（SKIP 0）**（visual-regression 227 用例）；
      真机 `node scripts/acceptance/run.mjs 14` 复跑 **PASS**（40.5s——closeTab 是本轮唯一的行为
      改动，其余为测试与文档）。
