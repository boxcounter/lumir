# Proposal: 无可插入文本的粘贴是严格空操作——HTML-only 剪贴板不得删除选区

- Change ID: `fix-html-only-paste-selection-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（原始需求与裁决），AI agent（起草 / 实现）

> 评审记录
> 节点 1（提案评审）：来源是 Alex 对 M843 finding 的整批处置要求——「用户要求类似的缺陷主动
> 安排修复，由 tower 代为做产品与技术取舍」。tower 据此立项 M859，并确定产品取舍：**只做
> 「无可插入文本时的降级空操作」，不做富文本支持**。本 change 不引入新的产品行为，只把一条
> 被证伪的既有降级条款收紧成可证伪的不变量；裁决点见文末 D1–D3。

## Why

### 现场

正文粘贴只有 `text/html`（没有 `text/plain`、也没有 `text/uri-list`）且存在非空选区时，
源码被**静默删除**：`alpha beta\n` 选中 `[2,8)` 后粘贴只含 `<b>ONLYHTML</b>` 的剪贴板，
文档变成 `alta\n`——没有插入任何内容，却删掉了选区，无 toast、无提示（finding
`20261119-worker-unicode-clipboard-bug-html-only-cm-dopaste`，M843 在 chromium 与
webkit-realua 双引擎实测）。

### 机制（已坐实到库源码）

`src/editor.ts` 的 paste 处理器只拦 `image/*` 文件项，其余一律 `return false` 交给
CodeMirror。CM6 的默认 paste 是：

```js
// @codemirror/view（本仓 node_modules 现值 6.43.x）handlers.paste
doPaste(view, data.getData("text/plain") || data.getData("text/uri-list"));
```

取不到文本时得到 `""`，但 `doPaste` 仍以空串走 `replaceSelection` ⇒ 非空选区被替换成空。
同一处理器在 `view.state.readOnly` 时提前 `return true`（只读本来就不会删），所以缺陷面
只在可编辑会话。对照：composer 的 paste 处理器无条件 `preventDefault`、只读 `text/plain`，
HTML-only 是空操作——两个输入面语义相反。

### 为什么这是产品缺陷，不是「引擎行为」

- 「粘贴什么都没插进去、却删掉了用户的源码」是静默数据丢失，且与同一应用里 composer 的
  语义直接矛盾；真实剪贴板通常同时带 `text/plain`，触发面窄，但一次触发就是不可感知的丢内容。
- 现有规格 `clipboard-image-paste` 的「非图片剪贴板降级」只承诺「与本能力存在之前逐字节
  一致」——本现场恰好是该承诺的反例：所谓「默认文本粘贴」在没有文本时不是空操作。条款需要
  一条可证伪的不变量，而不是对默认行为的转发（[rendering-defect-contract-first.md](../../../docs/process/rendering-defect-contract-first.md)）。

## What Changes

1. **`clipboard-image-paste` 的「非图片剪贴板降级」改写为可证伪的不变量**（MODIFIED）：
   粘贴的剪贴板既无 `image/*` 文件项、又取不到非空 `text/plain` / `text/uri-list` 时，可编辑
   正文的粘贴 SHALL 是**严格空操作**——文档、选区、撤销栈与 dirty 全部不变，MUST NOT 以空串
   替换选区、MUST NOT 解析或转换 HTML。`text/plain` / `text/uri-list` 任一非空时，仍逐字节
   走既有默认粘贴（plain 优先，其次 uri-list）；只读会话保持既有语义，不被这条降级拦截改变。

2. **实现收在现有正文 paste 入口**（`src/editor.ts` 的 `domEventHandlers.paste`）：图片分支
   原样在前，其后加一条闸门——「只读 或 plain/uri-list 任一非空 ⇒ 不拦；否则 `preventDefault`
   并 `return true`」。判据与 CM 默认粘贴读**同一组**剪贴板数据（同源，不另立类型表），不新增
   第二套粘贴管线、不引入 HTML 解析或富文本转换。

3. **把已知边界转成正向合同**：
   - 双引擎视觉用例（`tests/visual/scenes/text-clipboard-adversarial.spec.ts`，随 M843 合并
     后追加）：HTML-only 在折叠 caret、正向与反向非空选区上都是空操作（doc / 选区 / 撤销步
     不变）；只读（vault 外会话）不拦截；plain 压过 HTML、uri-list 降级、图片优先不回归；
     code 模式同一条降级成立。
   - `tests/visual/README.md` 的「已知产品边界」第三条从「不写成合同」改为合同描述，并删除
     该 finding 指针。
   - 新增真机场景 `267-html-only-paste-selection`：套件造不出 HTML-only 剪贴板（只有
     `clipboardText` 与合成 PNG 两个置剪贴板通道），因此真机 witness 取**同一退化类的另一
     形态**——code 模式 + 仅图片剪贴板 + 非空选区（修复前同样走 `doPaste("")` 删选区），
     另加 md 纯文本替换选区与 md 图片替换选区两条「不回归」。

## Non-goals

- **不做富文本 / HTML 支持**：不解析 HTML、不把 HTML 剥成纯文本、不引入第二种粘贴管线。
- **不改图片粘贴优先级与既有降级顺序**：`image/*` 文件项仍最优先；`text/plain` 仍压过
  `text/uri-list`；uri-list 的既有插入行为不变；composer 的粘贴语义不动。
- **不改 drop 路径**：本 change 只覆盖 paste 事件；drop 的文本 / 文件读取语义由 CM 既有实现
  承担，不在本缺陷面。
- **不按编辑器模式分裂判据**：md 与 code 会话共用同一条「可编辑 + 无可插入文本 ⇒ 空操作」，
  因为缺陷来自同一条 CM 默认语义；不给 code 模式另写一套。
- **不改快捷键与菜单**：⌘V 与原生菜单 Paste 走同一个 DOM 事件，行为随同一条闸门收敛。

## Impact

- 影响的 specs：`clipboard-image-paste`（MODIFIED「非图片剪贴板降级」）。
- 影响的代码 / 系统：`src/editor.ts` 的 paste 处理器（唯一实现落点）。
- 影响的测试 / 制品：`tests/visual/scenes/text-clipboard-adversarial.spec.ts`（M843 文件上
  追加用例）、`tests/visual/README.md`、真机场景 `scripts/acceptance/scenarios/267-…` 与
  重新生成的 `scripts/acceptance/COVERAGE.md`。
- 关联约束：性能合同（粘贴路径只多两次 `getData` 读数，常数开销、无 DOM 与布局）；ADR 0003
  （不改写源文件格式）；ADR 0004（AI-only 交付）。

## 裁决点（tower 已按 Alex 的整批要求代裁）

- **D1 退化时的动作**：**严格空操作**（消费事件、不插入、不删除），不做 HTML→文本的转换。
  理由：转换会引入「哪些 HTML 算文本」的新判定面与新的用户可见行为，超出缺陷修复；空操作
  与 composer 既有语义一致。
- **D2 判据来源**：与 CM 默认粘贴同源——`text/plain` 或 `text/uri-list` 任一非空即视为
  「有可插入文本」。另立一份「哪些 MIME 算文本」的集合会形成第二份真源
  （[REVIEW.md](../../../REVIEW.md)「同一语义两处真源」条）。
- **D3 作用面**：所有可编辑正文会话（md 与 code）；只读会话不消费事件，保持 CM 自己的只读
  早退语义。
