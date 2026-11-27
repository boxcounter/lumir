# Design: Shift 符号的物理键归一

## 1. 问题与证据

`⌘⇧]` 在真机 WKWebView 上得到 `key="]"` + `shiftKey`，旧 `keyToken` 产出 `Cmd-Shift-]`，与表内
`Cmd-}` 不相等。证据三段：

1. **WebKit 源码**：`Source/WebCore/platform/mac/PlatformEventFactoryMac.mm` 的 `keyForKeyEvent`
   在无 Control 时取 `[event characters]`（Control 才用 `charactersIgnoringModifiers`）——
   Command+Shift 下 `characters` 是未 Shift 的字符。
2. **独立 WKWebView 探针**（`.local/probes/tab-navigation-keys-nov27/`）：裸 WKWebView + 与 Tauri
   同 accelerator 集合的菜单，两条注入通道（进程内 `CGEvent` keycode+flags、`System Events`
   `key code`）一致给出上表形态；同一事件显式设 unicode 串为 `}` 后 `key` 才变 `}`。
3. **既有合同的来源**：M242 的「真机给 `}`」只是字符输入事实的外推；该 change 的真机场景 45 明确
   登记「按键链路未验」。M627（`⌘⇧,` / `⌘⇧.`）与 M195（`⌘⇧=`）是同一层的复发。

## 2. 事件矩阵（判定口径）

| 物理键（US） | 事件 `key` | `code` | 修饰 | 归一后 token | 表内绑定 |
|---|---|---|---|---|---|
| ⇧⌘] | `]`（未 Shift 形态）/ `}`（Shift 后形态） | `BracketRight` | Cmd+Shift | `Cmd-}` | `tab.next` |
| ⇧⌘[ | `[` / `{` | `BracketLeft` | Cmd+Shift | `Cmd-{` | `tab.prev` |
| ⇧⌘. | `.` / `>` | `Period` | Cmd+Shift | `Cmd->` | `tab.next` |
| ⇧⌘, | `,` / `<` | `Comma` | Cmd+Shift | `Cmd-<` | `tab.prev` |
| ⇧⌘= | `=` / `+` | `Equal` | Cmd+Shift | `Cmd-+` | `view.text-scale-up` |
| ⌘1 | `1` | `Digit1` | Cmd | `Cmd-1` | `tab.goto-1` |
| ⌃⇥ | `Tab` | `Tab` | Ctrl | `Ctrl-Tab` | `tab.next` |

（`⇧⌘,` / `⇧⌘.` 的方向映射是 M627 的既有假设，本 change 不动。）

## 3. 决策：在共享归一化层折平两种形态

`normalizeKey` 增加一条规则：若 token 带 Shift 且键是 `SHIFTED_SYMBOLS` 的「未 Shift 字符」，替换成
Shift 后的字符并删掉 Shift。`SHIFTED_SYMBOLS` 与 `SHIFT_IMPLIED_KEYS` 同源（后者由前者的值集派生），
`src/key-glyphs.ts` 的字形反解也从它派生。

**为什么放在 `normalizeKey`（而不是只改 `keyToken`）**：表内绑定文本、`[keys]` 配置文本、运行期事件
三者共用这一个函数。只改事件侧会让「用户写 `Cmd-Shift-]`」仍然得到死键——同一语义两处真源，正是
REVIEW.md「同一语义两处真源」条的形态。

**为什么不给同一物理键加第二条绑定**（如 `{ key: "Cmd-Shift-]", command: "tab.next" }`）：
`Keymap` 的重复绑定检查会拒绝（两条归一后同 token）；即便绕过，`[keys]` 解绑一条另一条还在，
违背「一个物理键一条绑定」。旧口径的测试把「`Cmd-Shift-]` 不在表内」当反向断言，本 change 改为
「两种事件形态归一后等于表内那一条」。

## 4. 备选方案与取舍

- **A（采纳）字符对归一**：只动 `normalizeKey`，无需新表；两侧一致；对非 US 布局影响面最小
  （非 ASCII 字符不在表里，不触发）。
- **B（否决为主动方案）含 Cmd/Ctrl+Shift 时按 `code` 判定**（沿用 Alt 的路径）：能把布局差异也吃掉，
  但 `[keys]` 配置文本没有 `code`，会造出「事件侧 code、配置侧字符」的两套口径；且对每个键位都要
  维护 code→字符表，非 US 布局上会把用户按的物理键静默重映射。若将来出现第三种形态（如 IME 把
  `key` 换成 `】`），再按 B 补一条显式规则，届时先取真机证据。
- **C（否决）只在 `tab.next` / `tab.prev` 的命令入口做字符兼容**：命令层看不到事件字符（`CommandRunner`
  可拿事件但 `tab.*` 的实现已按命令分派），且会把同样的坑留给下一个符号键位。

## 5. 验证边界（原生 vs 合成）

- **已验**：WebKit 源码路径；两条独立注入通道在真实 WKWebView 里的 NSEvent 与 DOM 形态；归一化后
  的 token 与表内绑定相等（单元）；两种形态都命中同一命令（chromium 场景）。
- **未验**：**物理键盘**按下时 TSM 填进 `characters` 的值。HID 级注入
  （`IOHIDEventSystemClientDispatchEvent`）在本进程被系统丢弃（`hidtest*.swift` 记录），没有自动化
  通道；只有人手按键能给出这一读数。修复对两种取值都成立，故行为判据不依赖它；Alex dogfood 时
  按一次 `⌘⇧]` 即可确认端到端。
- **不做**：不以「注入过」冒充物理按键证据（REVIEW.md「覆盖声明超出真实验证」条）；场景 45 的
  新步骤在报告里按「注入通道 PASS」记，不写成「物理键已验」。

## 6. 影响面

- 归一化规则对所有含 Shift 的**符号 / 数字**键位生效；字母键不受影响（`⌘⇧S` ≠ `⌘S`）。
- 仓内无 Shift+数字 / Shift+符号的既有绑定被改变语义（`rg` 已核）。
- 键位面板的字形（`glyphOfToken`）随单一来源重构保持逐字不变。
