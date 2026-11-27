# Design: code pane 工作区布局

## 1. 现状与唯一改动点

- `src/editor.ts` 的 `modeExtensions()` 已按会话 mode 构造 base theme。Markdown grid 中列读 `--layout-doc-measure`；code 中列也读同一 token。此处是唯一几何分派点。
- `src/main.ts` 只有 root doc pane 一套阅读手柄。`showEditor()` / notice / 首启提示目前直接写 `widthDrag.setVisible()`；`syncActiveDocument()` 已是标签切换与 pane 激活的唯一表现层同步点。
- `setContentWidth()` 仍保存全局 Markdown 阅读意图、写 token 并逐实例重测量。code 不再消费该 token，不因此删除这条广播链，也不另造 per-mode 配置真源。
- 模式装载与切换已经通过 `modeAndWrapEffects()` 重配；pane resize 由 CM 既有观察与手柄控制器的 ResizeObserver 承担。本 change 不新增测量通道。

## 2. 最小实现

### 2.1 code grid

code 分支改为：

```text
max-content minmax(0, 1fr) 0px
```

- 第一轨只承载行号 gutter 的自然宽；无 gutter 时为 0。
- 第二轨是正文，占满剩余可用宽；`minmax(0,1fr)` 保留 `min-width:0` 的收缩能力，长行继续溢出到主 scroller。
- 第三轨不再有吸收余量的弹性空间。
- Markdown 分支逐字保留，继续读 `--layout-doc-measure`。

行号开/关因此有一个合同内差异：开时正文左缘移到 gutter 右缘，宽减少 gutter 自然宽；右缘与 pane 右缘不变。不得裁行号，不得让短行文档仅因 gutter 产生横滚。

### 2.2 阅读手柄显隐

新增一个装配层小函数，唯一判定为：

```text
root 手柄宿主的会话是 md && 活跃 doc 会话是 md && notice 不在场 && 首启 tips 不在场
```

`showEditor()`、首启提示撤下和 `syncActiveDocument()` 共用。notice 建立仍明确隐藏。函数只调既有 `setVisible()`；位置仍由既有 `reposition()`、ResizeObserver 与 scroller scroll 负责，不复制定位公式。手柄 DOM 只有 root 一套，因此必须同时检查 root 与活跃 doc 的模式：root=code、右侧活跃 Markdown 时同样隐藏，不能在 root code 上显示其它 pane 的手柄。

code 模式没有阅读手柄，因此原「满 pane 后阅读手柄拖成侧栏/窗口」形态在该控制上不再存在。侧栏分隔条与 OS 窗口缘仍是各自的合法控制，本 change 不改它们，也不把拖动那些位置伪造成阅读栏操作。

## 3. 不变量与机器判据

- **code 满 pane**：off 时 content left/right = scroller left/right；on 时 content left = gutter right、content right = scroller right。
- **code 无阅读手柄**：overlay hidden，AX 不再提供「调整内容宽度」；Markdown 恢复为两条。
- **token 无消费者关系**：先在 code 记录几何，再切 Markdown 拖宽，再切回 code；code rect、自然宽与滚动语义不变，写入只来自 Markdown 手势。
- **Markdown 零漂移**：同 fixture 的列框、文字宽、手柄、折行、代码块/宽表容器 client/scroll 与主 scroller 均按现行公式。
- **长行可达**：nowrap 时 scrollWidth > clientWidth，滚到最右后目标文本右端进入 scroller；wrap 时主 scroller 不产生横滚。
- **模式与 pane**：单/双 pane、活跃 pane 切换、标签往返、行号 off/on、折行 off/on、只读与可编辑均取实测几何，不靠实现函数调用计数。
- **排版与选区**：字号步进后右缘不变、文档与 CM selection 不变；光标仍由既有 CM 测量链维护，不新增 caret 移动逻辑。
- **不拖错对象**：code 正文内部的横向手势不写 `content_width`，不改侧栏 token；真实 WK 侧重验 code 无阅读手柄与窗口/侧栏控制各自归位。

## 4. 反向必红策略

- 新 contract 场景先在新基线未实现时运行，保留旧实现 FAIL；实现后同命令 PASS。
- 对「不变」断言使用读数变异做负对照：把 content 宽度、gutter 对齐或块容器读数改到错误值，断言函数必须拒绝；随后恢复原读数通过。
- 既有 `content-width.spec.ts` 的 code 手柄用例改为「无阅读手柄 + 满 pane」，旧实现红。
- 既有 `m281-goto-line.spec.ts` 的 code 宽窗几何改为「gutter 占自然宽、正文右缘不动」，旧实现红；窄窗不裁与不横滚继续原样判。
- 每轮的类别分开记录：旧实现不符合新合同 = 需求/视觉迭代，不计产品缺陷；断言自身错误 = oracle 缺陷；环境通道失败 = INVALID。
- OpenSpec 1.12 不允许 MODIFIED 删除或更名 scenario。`code 模式同样有手柄`、`全部标签页同宽` 两个历史名仅为对账保留，正文明确改为新合同；若未来工具支持场景改名，再清掉这个形式限制。

## 5. 视觉保真

本 change 有研究原型，但验收对象是生产实现的现状/候选并排图，不追求独立 HTML 与产品的逐像素相等。

- **布局节奏**：Markdown 的栏宽、居中和 24px 最小侧轨不动。code 单 pane 左缘贴可用区左缘，右缘贴 pane 右缘；双 pane 各自占满自己的可用区，1:1 分栏与分隔条位置不动。
- **行号**：off 时零 gutter 宽；on 时 gutter 自然宽、正文从 gutter 右缘起排。行号底色、字号、行高、纵向对准与现有 token 不动。
- **代码块/宽表**：仍是 Markdown 栏内组件，块内横滚条、底板、间距、字族和字层级不变。
- **三主题**：light / dark / eink 仅更换既有主题，不新增色值。选区、光标、语法色、滚动条不退让。
- **状态**：单/双 pane、行号 off/on、折行 off/on、窄窗各有代表图。阅读手柄常态仍不可见；code 不存在对应 hover 命中区。
- **基线纪律**：候选图只写主仓 `.local/reviews/code-pane-workspace-nov27/`。不调用 `--update`，不改 `tests/visual/baselines/`。审美与最终基线更新归 Alex。

## 6. 范围边界

容量死区与 latent token 是 Markdown 阅读上限语义，和本次 code 不消费 token 可以直接切开，故不做联动修补。code 满 pane 后原有阅读手柄冲突的最小处理就是合同规定的「code 不显示该控制」；不改侧栏、pane 或窗口控制。
