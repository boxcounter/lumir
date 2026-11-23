# Harness composer 交互合同

> 状态：`harness-composer-inline-cards-nov23`。composer 使用单一 CodeMirror 6 文本内核；卡片是文档
> 精确 UTF-16 偏移处的零长度 block widget。文档只含问题文字，阅读顺序、投递顺序与 history 顺序
> 共用同一份块序。Rust 投递协议、JSONL 与历史消息解析不变。

## 适用范围

composer 有两个状态投影，但只有一个文本真源：

- **文本面**：CM doc、selection 与 history，承载全部问题文字、IME 和文本命令。
- **附件面**：`PlacedAttachment { id, card, anchor }` 数组。`id` 只作会话内稳定身份；`anchor` 是
  `[0, doc.length]` 内的精确 UTF-16 偏移，不是独立文本位置，也不是卡片占位字符。

卡片不可编辑、不可聚焦、不可跨选，只能经 × 移除。初始插入按 caret 落位；后续文本编辑只映射
anchor，不把卡片位置重写成别的编辑不变量。

## 不变量

### HC1 — 单一文本、选区与精确块序

普通输入、IME、⇧Enter、粘贴、删除、Emacs 命令、kill-yank、转置与全选 MUST 只通过 CM state
修改文本和选区。实现 MUST NOT 从 DOM 反推块模型，MUST NOT 维护 DOM↔block caret 映射、
normalize 或自绘块级选区带。

1. ⇧Enter 在当前文本选区插入一个 `\n`，不发送。⌘A 的选区端点为 `0 → doc.length`。
2. 初始插卡按 caret 的 `head` 落位，不删除非空选区：行首直接锚定；行中插入一个真实换行；
   非末行行尾锚到下一行行首；文末补一个真实换行；空文档不补换行。插入后 caret 在卡片下方。
3. 拆行与卡片 effect MUST 在同一 transaction。多卡同锚点合并为一个 widget，新卡在堆叠底部。
4. 文本事务用 `tr.changes.mapPos(anchor, -1)` 映射每张卡的 anchor，再按新 anchor 稳定排序。
   在 anchor 处输入落在卡片下方；删除覆盖 anchor 时收到删除点。映射不得改写卡片 id 或相对顺序。
5. `composerBlocks()` 按 anchor 切分文本并插入卡片。锚点前一个行界归入块分隔；行中偏移直接切开。
   无卡时仍只产出一个全文段落，既有 XML 转义与空段落跳过规则不变。
6. 字素簇 / 词边界与 kill 槽继续复用编辑器共享原语；竖直移动的列位仍是行内字符列，不是像素 x。

### HC2 — 单一 history 与完整可逆映射

文本与附件 MUST 共用 `@codemirror/commands` 的 history。`mapPos` 只负责前向映射，不能恢复
删除前位于被删区间内的 anchor，因此 history MUST 另存完整 placed-attachment 快照。

1. 每个改 doc 或卡片结构的前向事务都携带 `composerAnchorsSyncEffect`，载荷是事务后的完整数组。
   事务已有 sync effect 时不重复追加；effect 坐标不再做二次映射。
2. `invertedEffects` 只为 sync effect 产出一条逆 effect，载荷是 `tr.startState` 的完整数组。
   insert/remove 结构 effect 不另产逆 effect。字段采用最后一条 sync effect，保证分组 undo 回到最早
   快照、redo 回到最终快照。
3. undo / redo / select.undo / select.redo 事务不得追加前向 sync effect。行中插卡、移除卡片各自
   是一步 history；连续文本输入按 CM 规则聚簇。
4. 现有 composer history 上 MUST NOT 执行 `addToHistory:false` 或 `remote` 的文档变更。事务
   过滤器拒绝这类变更；不得给 sync effect 增加 `mapPos` 来修补旧分支。
5. 草稿恢复、切 vault、新会话、会话重载、发送清空与拒绝合并后的复位 MUST 新建 `EditorState`，
   旧 history 不可达。新会话与会话重载 MUST 同时清除当前 bound vault 的盘上草稿，其他 vault
   的草稿与复位后的新输入不得受影响。不得用非 history 文档补丁复位。

### HC3 — IME 组合归 CM，插卡 FIFO 与单 pendingSend

CM 独占组合文本、组合选区与组合中删除。实现 MUST NOT 在 compositionstart/end 重建文本 DOM、
改写组合范围或手工计算 marked-text 删除区间。

1. 组合期 Enter 与 WebKit 序的 compositionend 后确认拍 MUST NOT 发送或换行；确认窗外 Enter
   才进入发送路径。其余组合期按键交给 CM / IME。
2. 组合期插卡请求进入 FIFO。compositionend 后逐条 drain，只有成功落入 composer 的请求才可出队；
   移除卡片不改文档，可立即生效。组合文本 MUST NOT 丢失，组合 MUST NOT 被插卡打断。
3. 发送投影前先 drain。组合仍进行或无法安全 drain 时延迟发送，MUST NOT 清空队列。延迟发送意图
   由单个带视图世代的 `pendingSend` 承载，Enter、发送钮和命令重复触发只合并为一次。
4. compositionend drain 成功且世代匹配时，先清 pending，再调用一次 `performSend()`。drain 失败
   取消发送并保留未消费请求，MUST NOT 投递缺卡消息；后续可重试。
5. 切 vault、新会话与面板销毁取消旧代队列和 pendingSend。`activity.phase` 不得代替 pendingSend
   去重。发送成功清空 composer 与草稿，不把未消费的队列当成已投递内容。
6. Chromium CDP 只证明真引擎回归通道；原生 WKWebView 拼音与候选窗动作仍需真机终判。

### HC4 — 零长度 widget、纯文本复制与 scoped AX

1. 同一 anchor 的卡片合成一个 `Decoration.widget({ block:true, side:-1 })`，容器
   `contenteditable=false`。widget 不带纵向 margin，间距由 wrapper padding 与内部 gap 承担。
2. widget `eq` 比较 id 序列、卡片对象身份与图片编号。anchor 变化但判等命中时 MUST 复用原 DOM；
   编号变化经 `updateDOM` 就地更新。缩略图销毁后下一帧 prune，逐键输入不得重复发读图命令。
3. 卡片没有文档范围，因此卡间 caret、卡内选区与跨卡选择在模型上不可表达。Backspace / Delete
   只删文本；跨卡文本选区删除后卡片保留并精确映射。若原生 DOM 删除在 widget 旁不落地，
   `beforeinput` 按 `state.selection` 显式删除非空选区；组合期与只读不接管。
4. 应用内 copy event 的 `text/plain` MUST 逐字节等于 `state.sliceDoc(main.from, main.to)`，不得含
   卡片文本、×、@、占位字符或哨兵。空选区 MUST 写入 `""`，不得复制整段；`clipboardData === null`
   时不得 `preventDefault()`，保留原生回退。外部剪贴板按平台归一后比较，不把外部读数写成逐字节合同。
5. AX 顺序与负向断言 MUST 限定 composer 子树。scope 缺失、不唯一或不可读一律 FAIL。卡片
   标记不得进入 composer 的 `AXTextArea.value`；编辑器源文档允许包含原始摘录。同一 AXTextArea
   的 value 可按节点内偏移多次匹配，允许其中的文本片段与后续卡片节点交错，且不得重读已消费文本。
6. composer 摘录正文 MUST 以 `data-excerpt + CSS ::before` 保留视觉呈现，出处、编号与动作 glyph
   同样以 data 属性 + CSS pseudo 呈现。实际 AX 树的 textbox value MUST 只含文档文字（块分隔换行
   除外），完整摘录 MUST 只暴露一个阅读节点，出处与动作不得混入 value；动作的 aria-label 保留。
   卡片容器不得暴露为可编辑控件或按钮，不得进入 Tab 序。图片 `alt=""` 与 `aria-hidden` 只用于
   装饰缩略图，编号可读名保留。

### HC5 — 块序投递、编号与拒绝合并

1. `projectDelivery(composerBlocks(state))` 是唯一投递投影点。文本 / 图片 parts 按块序 flush；
   `panelText` 与 parts 同源。wire、JSONL、历史消息解析与重试回放不变。
2. 图片编号只数块序中的图片，1-based、无空号。徽标、@ 插入和投递标签共用同一块序编号源；
   @ 按附件 id 反查点击时的当前编号。移除后即时重编，已插入的 `Image N` 文本不回写。
3. transcript 按同一组 blocks 渲染多个文本段落与卡片；历史消息继续原样解析，不做二次投影。
4. 同步拒绝的迟到合并保持原文在前、当前在后：文本直接拼接，当前卡片 anchor 平移
   `restored.text.length`，再稳定排序；不额外补换行。空当前态原样返回 restored。合并后新建 state
   并显式标草稿。

### HC6 — 草稿 v3 与全版本共同 CRLF 出口

草稿形状为 `{version:3,text,caret,cards:[{card,at}]}`。`at` 是精确 UTF-16 偏移，id 不写盘；
图片只存内容寻址引用与可选尺寸，MUST NOT 内联 base64。防抖、无变更不写、离散 flush、串行写清
和 per-vault 隔离不变。

1. v3 逐字段校验，非法 caret 归 null；非整数或越界 `at` 钳到 `[0,text.length]`，不得改变为别的
   位置规则。损坏文件安静回空。
2. v2 的卡片按原相对顺序全部落 `at:0` 并立即写回 v3。v1 沿用段落 / 未知块 / caret 的一次性
   转换，再同样落 v3。不得双写或保留旧写出路径。
3. v1 / v2 / v3 先各自解析成同形状原始坐标草稿，再经共同出口把 `\r\n` / `\r` 归一为 `\n`。
   caret 与每张卡的 `at` MUST 用同一份原始→归一偏移映射重定位。
4. 归一后的同一份草稿同时用于立即写回与创建 state。`migrated || changed` 触发既有串行 store
   写回；写失败只走 warning / 重试，不谎报已保存，旧写不得夺回新编辑。
5. 发送成功清除；拒绝 / 失败保留；切 vault 不串草稿。恢复后新建 state，旧 history 不可达。

## 证伪方式

- **纯状态属性测试**：初始落位矩阵、精确 anchor 与完整块序、删除行界 / 跨行删除 / 全选替换、
  分组 undo/redo、非 history guard、拒绝合并与图片 id 编号。
- **草稿测试**：v3 往返、真实 CRLF v3、CRLF v2 caret、混合行界 v1、越界钳制、损坏回空、迁移
  写回与旧写竞态。
- **IME 状态机**：连续两卡 FIFO、重复 pendingSend、切视图取消、drain 失败保留队列并禁止缺卡投递。
- **真实浏览器结构**：行首与行中 widget 顺序、无占位字符、copy event 纯文本、选区不覆盖卡片、
  200 字输入 DOM 身份复用与图片读回计数不增。
- **真机 scoped AX**：只在 composer 子树判序与负向 value；编辑器原文作为合法对照。scope 不可读、
  不唯一或顺序反转都必须判红。
- **性能**：最小 CM 实例 keypress-to-paint `<16ms`；卡片在场连续 200 字无长帧、无逐键 IPC。
  常驻内存对照项目 `<200MB`，浏览器读数不得冒充整个 Tauri app。
