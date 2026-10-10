# Tasks: composer-intercard-caret

> 提案阶段起草，实现期可细化。探针任务（§1）的结论决定 §3 是否包含方案 C 的落地面。

## 1. 实测闸（先跑，结论决定 §3 的范围）

- [ ] 1.1 真机探针（验收套件，mock provider，fixture 全合成）：composer 放两张相邻合成图片卡片、光标在其后段落，
      注入 ⌃B，读三组读数——① 模型读回的光标（期望 `{block: 后一张卡下标, offset: 0}`）；② 该 Range 的包围盒
      + 截图（光标可见性）；③ 注入一个字符后 composer 的子元素次序与文本读数（期望字落进两卡之间的新段落）。
      判据与处置见 design §6
- [ ] 1.2 把 1.1 的结论（读数 + 截图 + 是否启用方案 C）登记进本 change 的 notes 与 `docs/backlog.md`

## 2. 模型层：边界光标位（方案 A 的骨干）

- [ ] 2.1 `src/harness-panel.ts` 的 `caretFromDom` 增一档：选区锚在 composer 元素自身时，把 `anchorOffset`
      归一到 `{block: anchorOffset, offset: 0}`（两种 DOM 形态——`Range(composer, N)` 与锚在卡片内部——归一
      到同一模型值；后者已可用，不得回归）
- [ ] 2.2 修 `insertPlainTextAtCaret` 的卡片档（`:340` 的 `blocks.slice(at + 1)` 跳过 `blocks[at]` ⇒ 吞卡）：
      改为保留该块（卡片前缘视作「此处有一个空段落」），产出 `[..., 段落(前缀+文本+后缀), ...原 at 起的块]`；
      与函数自身注释（`:321`）一致
- [ ] 2.3 边界光标位上的内容型输入改走模型路径：`beforeinput` 的 `insertText` 在「光标是卡片前缘」时拦下并
      经模型物化 + 写入（其余情形逐字节不变，仍是原生落字 + 聚簇压栈）；`compositionstart` 在光标是卡片前缘时
      先物化一个空段落（该处已有压前态），组合内容落进该段落
- [ ] 2.4 撤销口径落实：物化与该次输入合为一个撤销步（`withModel(..., force=true)` 的形状）；**导航到边界位
      MUST NOT 压栈、MUST NOT 改块序列**（在 `caretFromDom` 的调用点核一遍，尤其 `normalize` 的 `setDomCaret`
      收尾路径）
- [ ] 2.5 顺带核实：`removeBlockAt` 的卡片前缘兜底光标（`:315`）与撤销恢复出的卡片前缘光标，读回修好后写回
      DOM 再读回应当同一值（补一条单测钉住这条往返）

## 3. 条件落地：composer 作用域的水平移动（**仅当 1.1 判为不可达时**）

- [ ] 3.1 模型级移动纯函数（原子卡片一步跨过，语义与 `insertSoftBreakAtCaret` 的模型层风格一致）：
      `moveCaretBackward` / `moveCaretForward`，对「段内 → 卡片前缘 → 前一段落末尾」的相邻关系逐一断言
- [ ] 3.2 `src/keys.ts` 加 composer 作用域的 `Ctrl-b` / `Ctrl-f` 绑定（及必要的 ⌃⇧B / ⌃⇧F 扩选对称），
      命令实现走 3.1；作用域判定沿用「事件目标在 composer 内」，与 `editor` 作用域互不命中
- [ ] 3.3 单测：移动纯函数的跨块序列断言（含 composer 以卡片开头 / 结尾、相邻卡片、单段落）；扩选对称的
      端点语义
- [ ] 3.4 若 1.1 判为**可达**：本组整体跳过，在 tasks 与 design 里就地标注「未触发」（不留空勾）

## 4. 合同与测试面

- [ ] 4.1 `docs/specs/harness-composer.md` 新增一条不变量条款（边界光标位 + 内容输入物化 + 导航不成撤销步），
      并在 §适用范围里把「相邻两张卡之间」写成显式一档；配一条可证伪的模型层属性测试
      （合同先行，`docs/process/rendering-defect-contract-first.md`）
- [ ] 4.2 `tests/unit/harness-composer.test.ts` 的 HC1 属性生成器纳入相邻卡片序列（`[card, card]`、
      `[card, card, card]`、`[para, card, card, para]`、`[card, para, card]`），确认 HC1 全绿（这是 §1 第 9 条
      的覆盖缺口）
- [ ] 4.3 单测：边界光标位 × 输入动词的物化不变量（`insertPlainTextAtCaret` 卡片档不丢卡、内容落在新段落、
      块序守恒、offset 落点正确）
- [ ] 4.4 HC2 的边界档核实：边界光标位的 `Range` 零高时 `scrollCaretIntoView` 回落**后一张卡片**的矩形，
      实验确认「把卡片滚进视口」等价于「边界可见」；有偏差就补一句判据

## 5. 真机验收与视觉

- [ ] 5.1 新增真机验收场景（mock provider，fixture 全合成，编号按套件现状顺排）：⌃B 落到两卡之间（§1 的探针
      场景可作为这一条）、在两卡之间键入后文字落在两图之间（DOM 子元素次序 + 文本读数）、撤销一次回到
      「两卡相邻、无段落」前态（块序读数）
- [ ] 5.2 `bash scripts/gate.sh visual` 全绿且**既有基线零漂移**（预期零像素变化；有漂移即说明溢出样式面，
      回到 design §7 定位，不得直接 `--update`）

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
- [ ] 6.3 信息卫生：改动面一次 text 级 grep 清扫（无真实 vault 内容；验收 fixture 与截图全部合成）
- [ ] 6.4 归档前逐条对账：tasks / spec 增量 / 实现三者一致；**核对 `harness-composer-image-paste` 是否已先
      归档**——若已归档，本 change 的 MODIFIED 增量须在其文本上重新落准（保留其图片分派句）再归档
