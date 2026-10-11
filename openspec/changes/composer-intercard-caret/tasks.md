# Tasks: composer-intercard-caret

> 提案阶段起草，实现期可细化。探针任务（§1）的结论决定 §3 是否包含方案 C 的落地面。
>
> **实现期对账（M450，2026-10-11）**：本文件由 mission M450 逐项执行；每节末尾的「M450 对账」
> 行是执行结果与偏差记录（含探针那一次的**环境无效**读数）。逐条结论见文末 §7。

## 1. 实测闸（先跑，结论决定 §3 的范围）

- [x] 1.1 探针场景已落地：`scripts/acceptance/scenarios/134-harness-composer-intercard-caret.md`
      （两张相邻合成图片卡片 → ⌃B → 键入探针串 → 一次撤销）。**本次会话未能取得有效读数**：
      跑批期间前台是 Google Chrome（其窗口 0,5 1152×950 完全覆盖验收窗口 8,40 1152×864），
      真实鼠标事件被前台窗口吃掉、键盘注入被 KimiCU 判为 `occluded: true` 且 3 次注入 0 落地。
      有效的那半截读数：⌘⇧A 开面板成立、第一次贴图成立（卡片元信息行读到 `· 360×200`）；
      第二次右键在**我们窗口**里没开出菜单（被前台窗口吃掉），缺前台 ⇒ 打字未落地。
      **本轮读数作废**（套件 README「运行环境是隔离的」与退出码 2 的口径同族：前台是硬前提）。
      复跑条件：让前台空出来（Chrome 不覆盖验收窗口）后 `node scripts/acceptance/run.mjs 134`。
      结论（可达 / 不可达）**待复跑填入**；在结论出来之前本 change 只落方案 A，**不预先启用 C**
      ——C 是键盘接管，在同样缺前台的窗口里无法取得任何验证，未验证地启用比不启用更差。
- [ ] 1.2 把 1.1 的结论（读数 + 截图 + 是否启用方案 C）登记进本 change 的 notes 与 `docs/backlog.md`。
      未完成：**等 1.1 复跑**。另登记：`docs/backlog.md` 不在 M450 的写入面，复跑后由带该面
      scope 的 mission 落笔（或由 tower 代录）。

**§1 的替代读数（M450 补，真机探针被前台挡住时的降档量法）**：写了一个一次性 DOM 探针
（`tests/visual/runtime/m450-probe/`，落在 `tests/visual/.gitignore` 的 `runtime/` 下、**不入库**；
`pnpm --dir tests/visual exec playwright test --config runtime/m450-probe/probe.config.ts`），
在 chromium 与 **Playwright 的真 WebKit 引擎**（与 `tests/visual` 的 webkit-realua 同一取向）两档下
驱动 composer 的真实 DOM：

| 读数（两档一致，除标 * 者） | chromium | 真 WebKit |
|---|---|---|
| 两次贴图后块序 = `[卡片, 卡片, 段落]`（相邻两卡） | ✔ | ✔ |
| 选区写到 `Range(composer, 1)` → 键入 `x` 后块序 = `[卡片, 段落"x", 卡片, 段落]`，光标在新段落内 offset 1 | ✔ | ✔ |
| 一次 ⌘Z → 块序回到 `[卡片, 卡片, 段落]`，光标回到边界位 | 块序 ✔ / 选区读作 `none`* | ✔ `container:1` |
| 另一种 DOM 形态（锚在卡片元素内部）键入 → 同样物化到两卡之间 | ✔ | ✔ |
| 负向对照：光标在**段落**里键入 → 不走物化路径、块序不变 | ✔ | ✔ |

\* chromium 在 keydown 处理器内程序化设置**容器边界**选区时会把整条选区丢掉（`anchorNode` 为
null）；真机是 WKWebView（真 WebKit 这一档）——那里读回的是 `container:1`，边界光标跨撤销存活。
这条差异是 chromium 的选择集行为，不是产品缺陷，**如实登记在此**（若将来要在 chromium 上跑
composer 的边界光标，需另想写法）。

**它替代不了什么**：design §6 的未知数「**原生 ⌃B** 在真机上落不落到边界」——键位绑定走系统层
（AppKit key binding → 编辑命令），协议级合成键到不了那一层。那一条仍归验收场景 134。

## 2. 模型层：边界光标位（方案 A 的骨干）

- [x] 2.1 `caretFromDom` 增一档（`src/harness-panel.ts`）：选区锚在 composer 元素自身时归一为
      `boundaryCaretAt(anchorOffset, 子块数)` = `{block: anchorOffset, offset: 0}`；锚在卡片
      元素内部 / 卡片本身的归一（`{block: 卡片下标, offset: 0}`）保持不变。
- [x] 2.2 修 `insertPlainTextAtCaret` 的卡片档吞卡缺陷：`blocks.slice(at + 1)` → 卡片档保留
      `blocks[at]`（`slice(isCard ? at : at + 1)`），产出 `[..., 段落(前缀+文本+后缀), ...原 at 起的块]`。
      单测里原来的「在卡片前缘 → 视该处为空段落」用例原本断言的是**缺陷形态**（卡片被删掉），
      已按缺陷修复后的期望改写（这正是 REVIEW.md 第 2 条那句「旧断言被当作正确行为」的现场）。
- [x] 2.3 `beforeinput` 的 `insertText` / `insertReplacementText` 在「光标是卡片前缘」时拦下并走
      模型（`withModel(insertPlainTextAtCaret, force=true)`）；`compositionstart` 在光标是卡片前缘时
      先物化一个空段落。**偏差（已在合同登记）**：`compositionstart` 的物化不走整面重渲
      （`withModel` 的 `replaceChildren` 会销毁正要开始组合的目标节点、打断 IME 会话），改为
      「先压前态 + 就地插入一个空段落块」——撤销口径与模型读法不变，实现路径偏离常规的
      「结构性修改一律整面重渲」，这一条写进了 `docs/specs/harness-composer.md` 的已知边界。
- [x] 2.4 撤销口径：物化与该次输入合为一个撤销步（`force=true` 的压栈 + 后续键入走聚簇）；
      导航到边界位不压栈、不改块序列（`caretFromDom` / `normalize` 的调用点已逐处核过——
      `normalize` 的收尾只 `setDomCaret`，无 `push`）。
- [x] 2.5 往返对称核实：把读回 / 写回规则抽成两个可单测的纯函数 `boundaryCaretAt` 与
      `domCaretTarget`（`setDomCaret` / `caretFromDom` 共用），单测按块序 × 全部边界位（含
      「末尾之后」）全枚举钉住「写回落点恒为同一个块级边界、读回恒为同一模型值、段落位不被
      边界档吃掉」；并新增 `removeBlockAt` 兜底光标指向卡片前缘的用例（design §1 第 11 条）。
      说明：`tests/unit` 是零 DOM 层（`tests/unit/README.md`），DOM 侧的真往返由验收场景 134 判。

## 3. 条件落地：composer 作用域的水平移动（**仅当 1.1 判为不可达时**）

- [ ] 3.1 / 3.2 / 3.3 / 3.4 **未执行，且不预先执行**：1.1 尚未取得有效读数（见 §1.1）。
      复跑若判「不可达」，本组按 design §3 的落法实现（模型级 `moveCaretBackward/Forward` 纯函数 +
      composer keydown 里拦 `ctrl+b` / `ctrl+f` 并 `preventDefault`——`src/keys.ts` 不在 M450 的
      写入面，键位接管就落在 composer 自己的 keydown 处理器里，语义与作用域不变）。
      复跑若判「可达」，本组按 3.4 就地标注「未触发」。

## 4. 合同与测试面

- [x] 4.1 `docs/specs/harness-composer.md` 新增 **HC3**（边界光标位 + 内容输入物化段落 + 导航不成
      撤销步 + 一个撤销步），§适用范围把「相邻两张卡之间」写成显式一档，§证伪方式补 HC3 的
      判据层 / 行为层两条，§与实现的关系补三个纯函数与 IME 那条偏差；配模型层用例（HC3 一组）。
- [x] 4.2 HC1 属性生成器纳入相邻卡片序列：`[card, card]`、`[card, card, card]`、
      `[para, card, card, para]`、`[card, para, card]`（含图片卡与引用卡的组合），HC1 两条
      属性用例全绿（可见行数 +1 / 光标在可见行上 / 断行不吞内容）。
- [x] 4.3 单测：`isCardFrontCaret` 形态矩阵、`insertPlainTextAtCaret` 卡片档（不丢卡、内容落在
      新段落、块序守恒、多行拆段、块 0 / 末尾）、边界位的删除语义（退格删前 / 前删删后 / 块首
      无操作）、边界位往返对称全枚举。
- [x] 4.4 HC2 的边界档核实：`scrollCaretIntoView` 的零高回落（design §4）——边界档的 Range 零高时
      回落**后一张卡片**的块矩形（`setDomCaret` 传入的 `blockEl` 即该块），判据已写进
      `docs/specs/harness-composer.md` 的 HC2 条下（「后一张卡片在视口内 = 边界可见」）。
      未在真机复验（与 §1.1 同一个前台阻塞）。

## 5. 真机验收与视觉

- [x] 5.1 新增真机验收场景 `scripts/acceptance/scenarios/134-harness-composer-intercard-caret.md`
      （⌃B 落位 + 两卡之间键入 + 一次撤销；`--check` 通过）。**真机读数待复跑**（§1.1）。
- [x] 5.2 视觉门禁：`LUMIR_VISUAL_PORT=4273 bash scripts/visual/run.sh` **655 passed / 1 skipped /
      0 failed（8.9m）**，含 composer 场景（m347 / m361 / m440 / m345 等）与 webkit-realua
      分支；**未跑 `--update`、既有基线零漂移**（design §7 的预期成立：方案 A 不改样式面）。
      另注明：`gate.sh quick` 的 `tsc-visual` 一档为此 worktree 未装 `tests/visual` 依赖而 SKIP
      （我在跑视觉前用 `pnpm --dir tests/visual install --ignore-workspace` 现装），不是改动引入。

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（gate quick 的一档）。
- [x] 6.2 `bash scripts/gate.sh quick` 全绿（读数见文末 §7）。
- [x] 6.3 信息卫生：改动面 text 级 grep 清扫——新增制品里无真实 vault 内容（两张验收图是
      `clipboardImage` 合成的 png、分辨率即参数，二进制不入库；fixture 与断言串全合成）。
- [x] 6.4 归档前逐条对账：tasks / spec 增量 / 实现三者一致（§7）；`harness-composer-image-paste`
      是否已先归档**留到归档节点**核（本 mission 不含归档；其 MODIFIED 文本的落准规则见 proposal
      的归档对账注记）。

## 7. M450 执行结论（对账）

**改动面**：`src/harness-panel.ts`（模型层两个纯函数 + `insertPlainTextAtCaret` 缺陷修复 +
`caretFromDom` / `setDomCaret` 归一 + `beforeinput` / `compositionstart` 的边界位分派）、
`tests/unit/harness-composer.test.ts`、`docs/specs/harness-composer.md`、
`openspec/changes/composer-intercard-caret/{proposal,tasks}.md`、
`scripts/acceptance/scenarios/{127-*,134-*}`。零改动：`src/keys.ts`、`src/style.css`、
`tests/visual/**`、投递序列化面。

**机器验证**：`node tests/unit/run.mjs` 全绿（815 用例）；`tsc-root` / `tsc-unit` 通过；
`gate.sh quick` **9/9 PASS（SKIP 1 = tsc-visual，依赖未装）**；`run.mjs --check` 137 个场景静态校验
通过；视觉门禁 **655 passed / 1 skipped / 0 failed**（§5.2，零基线漂移）；一次性 DOM 探针
（§1 的替代读数）在 chromium 与真 WebKit 两档全过。

**空段落进 wire 的复核（proposal Non-goals 要求「若发现真问题就地登记」）**：无问题——
`projectDelivery`（`src/quote-card.ts:242`）对 `text.trim() === ""` 的段落直接跳过，空段落既不进
panelText 也不进 parts，物化出来的段落只在其非空时进投递面。

**tower 追加项（2026-10-11 下达，已落地）**：delta 的「混排对话输入区」MODIFIED 块补了
「粘贴按剪贴板内容分派」场景（逐字拷自在途 change `harness-composer-image-paste` 的同名场景）——
那条 change 归档后该场景进入 living spec，MODIFIED 整块替换下不带它即 `validate --strict` 报红。
验收：`validate composer-intercard-caret --strict` 通过、`validate --all --strict` 31/31 通过。
requirement 正文那句的落准仍留给归档节点（proposal 的归档对账注记）。

**未完成的一项**：§1.1 的真机探针有效读数（→ 决定 §3 方案 C 做不做）。根因是环境：
跑批期间前台是 Google Chrome 且其窗口完全覆盖验收窗口，真实鼠标与键盘事件到不了被测 app
（KimiCU 自报 `occluded: true`）。DOM 层的替代读数（§1 的表格）已经证明**读回 / 物化 / 撤销这三段
实现在真 WebKit 里成立**；剩下的未知数只有「原生 ⌃B 落不落到边界」这一条。
在取得干净前台的第一时间复跑 `node scripts/acceptance/run.mjs 134`（场景已就绪、`--check` 通过）
即可收口；若判「不可达」，方案 C 的落点在 `src/harness-panel.ts` 的 composer keydown
（`src/keys.ts` 不在本 mission 写入面）。
