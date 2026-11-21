# Design: harness 两条既有导航路径的缺陷修复

- Change ID: `fix-harness-navigation-nov21`
- 日期: 2026-11-21

本文只写「为什么坏、怎么修、判据落在哪」。Requirement 正文在 `specs/` 的两份 delta；行号会漂，
实现前以符号名为准。

## 1. 不变量

- **N1 后缀完整性**：`path:line` 家族的后缀是否成立，只由「后缀自身的形状 + 其后的字符是否仍属于
  路径」决定。**行文标点**（句号 / 省略号 / 逗号 / 括号 / 引号 / 中文标点）MUST NOT 使一个合法后缀
  失效；但**连续点号段之后若仍接路径延续字符**（ASCII 字母 / 数字 / `_` / `-` / `/`），整个后缀仍按
  畸形处理（`.5` / `..5` / `.foo` / `.-3` / `._3` / `./3` 都是小数 / 版本号 / 路径的延续）。
- **N2 落点不变**：修复只影响「后缀是否被识别」；`:行号` / `:行号:列号` / `:起-止` 的落点算式、
  闭区间高亮、越界钳制、2000 行上限逐字不变。
- **N3 通知点击的焦点归属**：cron 结果通知的点击落点是「看见这次运行的会话」。pane 的展开与内容
  恢复 SHALL 发生；键盘焦点 MUST NOT 从正文编辑器移到 harness composer。正文的焦点与阅读位置
  以点击前的状态为准原地保留。
- **N4 显式动作不变**：`harness.toggle` / 标题栏 toggle 钮 / `cron:run` 的交互槽位等显式打开路径，
  composer 聚焦行为逐字不变（`openHarnessPane()` 缺省 `focusComposer = true`）。

## 2. 根因（代码级证据）

### 2.1 句末句号吞掉行号后缀

- `src/harness-path-link.ts:21` `LINE_SUFFIX = /:(\d{1,7})(?:-(\d{1,7})|:(\d{1,7}))?/y` 本身正确：
  对 `design.md:69.` 能匹配出 `:69`。
- 失败在紧随其后的后置守卫（修复前 `:107`）：
  `if (/[A-Za-z0-9_.\-/]/.test(text[at + match[0].length] ?? "")) return { end: at };`
  —— `.` 在拒绝类里，句末句号被当成「路径还在继续」，**整个后缀被丢弃**。
- 后果链：`lineSuffixAt` 返回 `line = undefined` → `PathCandidate.line/lineEnd` 缺省 → 面板链接
  文本退化成 `design.md` → `openPathAtLine` 收到 `line === undefined` ⇒ 只打开文件、不 reveal、
  不高亮。用户看到的形态就是「点击行号不解析」。
- 同族形态（实测同因）：`design.md:69...`（省略号）、`design.md:69-72.`（行范围 + 句号）、
  `design.md:69:5.`（行列 + 句号）。
- 反面对照：`design.md:69` / `design.md:69。` / `design.md:69，` / `design.md:69)` / `(…:69)` 全部
  正常——说明候选扫描、标题 / 列表 / 表格 / 引用块 / 行内代码渲染、点击链路都没有第二处缺陷。

### 2.2 cron 结果通知点击抢焦点

- `src/main.ts:3196` `handleCronOpenSession` 在 `harness_resume_session` 之后调
  `openHarnessPane()`。
- `src/main.ts:852` `openHarnessPane()` 无参数；新建 pane 后无条件 `harnessPanel.focusComposer()`
  ——这是**唯一**的焦点写点（`addPane` / `attachTo` 都不动焦点，已核对）。
- pane 已存在时该函数在 `if (paneLayout.isSplit()) return;` 早退——既不重装内容，也不碰焦点；
  内容恢复实际由 `handleCronOpenSession` 随后的两次 `vaultChanged`（先置空再设回，绕开
  「同 vault 空操作」）触发 `resetView` + `fetchSnapshot` 承担。因此「pane 已存在」形态原本就
  不抢焦点（实测旧代码该形态判绿），缺陷只在「pane 关闭 → 新建 pane」这一条路径上。
- 诊断结论：「`openHarnessPane` 未生效」不是 pane 没展开，而是它**没有不聚焦的模式**——调用方无法
  表达「展开但不抢正文焦点」。

## 3. 修复

### 3.1 解析：把句末点号段从「路径延续」里拆出来单判

```ts
const trailing = text[at + match[0].length] ?? "";
if (trailing !== "" && /[A-Za-z0-9_\-/]/.test(trailing)) return { end: at };
if (trailing === ".") {
  let afterDots = at + match[0].length;
  while ((text[afterDots] ?? "") === ".") afterDots += 1;
  if (/[A-Za-z0-9_\-/]/.test(text[afterDots] ?? "")) return { end: at };
}
```

- 字母 / 数字 / `_` / `-` / `/`：逐字沿用原拒绝口径；
- `.`：按**连续点号段整体**判定——点号段之后的第一个字符仍是路径延续字符时拒绝（`.5` / `..5` /
  `.foo` / `.-3` / `._3` / `./3`），否则（串尾、空白、中文、其他标点）按行文句号 / 省略号放行。
  v1 只判「`.` 后紧跟数字」曾被评审 r1 P1 实证误放行 `.foo` / `..5` / `.-3` / `._3` / `./3`；
- 可点范围仍止于数字（`text` = `design.md:69`），句号与省略号留作普通文本——展示文本逐字不变。
- `src/quick-open.ts` 的 `splitLineSuffix` 复用同一函数，但它额外要求 `suffix.end === 输入串长度`；
  `a.md:12.` 在快速打开里仍不成立（句号未被消耗），**行为逐字不变**（本 change 不修快速打开）。

### 3.2 焦点：给 `openHarnessPane` 一个显式的「不聚焦」模式

```ts
function openHarnessPane(focusComposer = true): void {
  // …既有 pane 收拢 / 上限二早退不变…
  addPane("harness");
  if (focusComposer) harnessPanel.focusComposer();
  syncActiveDocument();
  switcher.sessionChanged();
}
```

- `handleCronOpenSession` 改为 `openHarnessPane(false)`；
- 缺省 true ⇒ `toggleHarnessPane` / `cron:run` 的交互槽位等既有调用点逐字不变；
- pane 已存在时早退不动焦点（既有行为）——cron 路径的内容恢复仍由随后的 `vaultChanged` 承担；
- 不在 cron 路径激活 harness pane：激活会改活跃 pane / modeline，与「正文原焦点与阅读位置不被抢」
  的意图相反；pane 已存在即已可见。

## 4. 验证策略（判别性优先）

- **纯函数单测**（`tests/unit/harness-path-link.test.ts`）：
  - `design.md:69.` → `line = 69`、`lineEnd = 69`、`text = "design.md:69"`、`to` 不含句号；
  - `design.md:69-72.` → `lineEnd = 72`；`design.md:69:5.` → `column = 5`；`design.md:69...` → `line = 69`；
  - 反证：`.5` / `.foo` / `..5` / `.-3` / `._3` / `./3`（单行 / range / 行列三形态）全部无
    `line` / `lineEnd` / `column`；`a.md:12x` / `a.md:12/5` / `a.md:12_3` / `a.md:12-3` 逐字不变。
- **视觉场景**（新增 `tests/visual/scenes/harness-navigation-nov21.spec.ts`）：
  - 句号形态：链接文本恰为 `design.md:69`（不存在裸 `design.md` 按钮）、点击落第 69 行、单行高亮；
    行范围 `:69-72.` 仍是 4 行闭区间高亮；小数形态 `decimal.md:12.5` 只链接路径本身；
  - cron 结果通知（事件经真实 `listen` 回调注入）：pane 关闭 / 已打开两态都断言 pane 可见、恢复
    内容上屏、`document.activeElement` 仍在正文、光标行与 `scrollTop` 不变；
  - 回归锚点：显式 toggle 后 composer 仍持焦。
  - **判别性实测**：在旧代码（`git checkout -- src/harness-path-link.ts src/main.ts`）上该场景
    2 条判红（句号形态的链接文本断言 / cron pane 关闭态的焦点断言），新代码 + m632 既有场景
    12 条全绿。证据：`.local/missions/harness-navigation-nov21/red-visual-before-fix.log` 与
    `green-visual-after-fix.log`。
- **真机验收**：`269-harness-path-line-sentence-period.md`（tier full）与
  `270-cron-open-session-keeps-doc-focus.md`（tier bundle：通知点击只能在打包实例上判）。后者用
  「键入落点」判焦点归属——编辑器与 composer 都是 AXTextArea，只看 role 分不出（README 的
  `focusWindow click` 条同一归因）。
- **门禁**：根 `tsc --noEmit`、全量单测、受影响 Playwright specs（端口 4284）。

## 5. 已知边界（如实登记）

1. 阅读位置（滚动）在真机 AX 层没有读数；真机场景以截图人工判读，机器判据在视觉场景的
   `scrollTop` 断言。
2. 真机 cron 场景的点击通道只在打包实例上可用（dev flavour 的响应路由到 Terminal）；主会话按
   `requires: bundle` 统一跑。
3. 用户消息气泡里的路径仍按块纯文本渲染、不可点（既有设计；本 change 的 Non-goals）。
4. 句末标点只修 `.` 的判定；其他标点原本就在拒绝类之外，行为未变。
5. 本 change 不覆盖「pane 已存在 + 通知点击」的跨进程（app 退出后）形态——真机场景判进程内点击；
   跨进程 relaunch 的恢复链路归场景 252。
