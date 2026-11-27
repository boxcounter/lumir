# Design: 普通正文 / 空行纵向 padding 归零

- Change ID: `fix-empty-line-height-stability-nov27`
- 性质：实现设计（终态模型、被否方案、CM 机制、证伪矩阵、证据与边界）。
- 事实锚点以代码现状为准（基线 `a959986e`）；评审结论见任务
  `agent-27zzhdhu` 的最终输出（会话 `wd_lumir_97a6261b51e9`，2026-11-27）。

## 1. 现状与根因

`src/preview/block-geometry.ts` 的 `classifyLine` 是所有纵向 padding 的唯一写入者（`theme.ts:180` 的就地
注释同口径）。旧模型：

```ts
// 普通正文行（非 ListItem / Blockquote 内）
let bottom = 0;
if (line.number === doc.lines) bottom = 8;                                  // ① 文档末行
else if (classifyBoundary(doc, tree, doc.line(line.number + 1), fm)?.boundary) bottom = 8; // ② 下一行是块边界
return { kind: "text", top: 0, bottom, boundary: false };
```

空行恒 `{0,0}`，标题走 `HEADING_TOP/HEADING_BOTTOM`，列表项 `{top:2, bottom:0}`。① 与 ② 让本行几何读取
**邻居**与 **EOF**，直接违反「行几何只由本行 + 块自身形态决定」：

| 迁移 | 旧模型 | 终态 |
|---|---|---|
| `p\n\n` → `p\n\nx`（末行空行落字） | 该行 0→8 | 0→0 |
| `a\n` → `a\nx` | 前行 8→0、编辑行 0→8 | 均 0 |
| `a\n## h\nz` → `a\nh\nz` | **未编辑的前行** 8→0 | 前行 0；仅标题行自身变 |
| `p\n\n\n\nq` → `p\n\nx\n\nq`（57 行同族） | 编辑行 +8、其后行整体下移 8 | 全篇不动 |

## 2. 被否方案（评审实测）

- **C：只删 ①（末行特例）**。`alpha\n## next` → `alpha\nnext` 时，第一行仍因「下一行由 heading 变成普通
  文本」从 8 → 0（违反非语义迁移稳定与行局部性）。缺陷只是换一处复发。
- **B：空行也带 8px**。`a\n` → `a\nx` 的前行仍因「下一行由空行变成文本」从 8 → 0；只覆盖连续空行这一类。
- **bottom→top 搬家（当前块首行 8px）**：严格行局部性与旧有成对间距的完全静态保持不能同时得到——判据仍要
  知道前一块是否普通正文；且它改变点击落点归属（旧 bottom 区域吸附上一行末尾，新 top 区域吸附当前行起点），
  并把「结构块→结构块」新增间距带进来。列表 / Setext 的块首还得另立同步判定（`alpha\n-` 在 parser 里先是
  `SetextHeading2`，只靠语法树会重新引入首帧翻转）。

终态选**普通正文与空行纵向 padding 恒 0**：最小、能一次闭合同类迁移，标题 / 列表等块自身间距不读邻居因而
天然稳定。

## 3. 终态模型

`classifyLine` 只保留三个分支：

1. `heading` → `HEADING_TOP` / `HEADING_BOTTOM`（首内容块 top 0，`firstContentLine` 既有规则不变）；
2. `list-item` → `{top:2, bottom:0}`；
3. 其余（`text` / `blank` / `quote` / `code/table` / `hr`）→ `{top:0, bottom:0}`。

`classifyBoundary` 不再把 `boundary` / `chain` 返回给调用方（两者已无消费者），`lineShapes` 不再剥字段。
删除「下一行分类」后，视口求值也不再触碰下一行（单元测试「视口求值不扫描后续全文」同判）。

## 4. CM 机制与风险

- CM 用行元素 `getBoundingClientRect().height` 更新可见行高度（`@codemirror/view` 的 measure 段），padding
  会进 heightmap；`Decoration.line` 本身不是 height-relevant decoration，heightmap 由测量周期修正。
  因此判据必须做 **DOM ↔ `lineBlockAt` ↔ active gutter** 对账，只判 DOM 会漏掉陈旧 heightmap。
- caret 由 `coordsAtPos` 的文本矩形绘制；padding 只让文字与 caret 一起位移，不改变 caret 高度（m647 合同
  不受影响）。
- 归零（而不是 bottom→top）不改变落点归属：旧 8px 区域消失，段落之间紧邻——点击不再有「吸附上一行末尾」的
  8px 带。本 change 不承诺「点击落点与旧版逐点相同」，只承诺既有合同：点击在文本行内落到该行（m647 /
  markdown-editing-stability 的指针用例保持绿）。
- IME：组合期列表装饰仍沿用冻结 / 恢复窗口；块几何不依赖组合状态，提交后不得给其它行补 8px（浏览器场景
  用 CDP `Input.imeSetComposition` 判）。

## 5. 合同与证伪矩阵

MODIFIED requirement「块边界纵向几何的源码同步稳定性」的三条可证伪条款：

1. **普通行局部性**：顶层正文与空行的纵向 padding 恒 0，不读邻行 / EOF / 光标 / 焦点 / IME。
2. **非语义迁移稳定**：空↔有字、正文编辑、光标 / 选区 / 焦点变化，所有行的 padding、行盒、END、gutter 与
   文档总高不变；滚出视口再滚回同值。
3. **语义 reflow 有界**：标题 / 列表 / Setext 成立或消失时，只有受影响块内的行允许变高；块外行高度不变，
   其后行位移等于获批高度变化之和。

对应判据（每格都有测试）：

| 面 | 纯函数 | 浏览器 |
|---|---|---|
| 局部性矩阵（正文 / 空行 / 引用 / 代码 / HR / 嵌套） | 逐行 shape | 行盒 + padding |
| 末行空行落字 | 迁移对 | 行盒 / gutter / END / 总高 |
| `a\n` → `a\nx` | 迁移对 | 两行行盒 + 总高 |
| 57 行同族 | 逐行 shape | 全篇行盒 / top |
| heading↔text | 前行 / 标题行 / 后行 | 前行行盒 + 后行位移 |
| Enter 拆合 | shape + 总 padding | 两行行盒 + 总高增量 |
| 视口 / 滚动 | 片段 = 全量 | 滚出滚回同值 |
| selection / focus | 重复求值相等 | 行盒不变 |
| IME | —（纯函数无 IME 输入） | CDP 组合 + 提交后行盒不变 |

## 6. 红绿证据

- 纯函数：旧实现 7 红 / 6 绿（`tests/unit/block-geometry.test.ts`），终态 13 绿。
  红日志 `.local/reviews/empty-line-height-nov27/evidence/unit-red-master.log`。
- 浏览器：旧实现 15 红 / 2 绿（绿的两条是「纯空行文档」——没有正文行——与「selection / focus」，按设计本
  就与 8px 无关），终态 17 绿。红日志 `…/evidence/visual-red-master.log`。
- 旧 8px 断言作为反向证据修改：`block-boundary-geometry.spec.ts` 前行 8px → 0px（新增 EOF 用例）、
  `markdown-editing-stability.spec.ts` 33.5 → 25.5 与 8 → 0。
- m399 / m647 一字未改，全量目标视觉 179/179 绿。

## 7. 视觉代价与基线策略

终态把静态间距收紧（不是像素等价搬家）：

- 段落之间、正文与标题 / 列表 / 引用 / 代码 / 表格 / HR 之间各少 8px（旧模型由前一行付账）；
- 文档最后一个非空正文行少 8px；文末仍有 `.cm-content` 的 20px 下 padding；
- 空行自身仍是 25.5px（M399 不变量），标题 / 列表自身间距不变。

因此普通 Markdown 整页基线会重排。本轮**不更新正式基线**：候选实现 + 10 个 fixture 的 before/after 截图与
逐行读数落在 `.local/reviews/empty-line-height-nov27/index.html`（内置控制面板：场景 / 初始 vs 操作后 /
并排 vs 单张 vs 交替闪烁 / 参考线；query 深链 `?case=&state=&mode=&panel=0&guides=0`）；全量像素层报红的
基线清单在交付说明中逐条给出，由 Alex 过目后走基线更新流程。

## 8. 已知边界

- 未跑真机（WKWebView）。几何判据在 chromium 结构层与纯函数层；真机手感、像素审美与基线更新归 Alex。
- 像素层差异是**有意的静态间距收紧**，不是回归；`gate.sh visual` 的像素档在基线更新前会保持红——这是
  基线过目这一人肉裁决点的正确形态，不做机械 `--update`。
- 性能：删除「下一行分类」后，每行少一次邻居分类；巨大文档的视口构建略优，但本 change 不以此为卖点。
