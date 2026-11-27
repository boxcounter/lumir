# Tasks: fix-tab-cycle-shift-symbols-nov27

## 1. 诊断（先证据、后改动）

- [x] 静态追踪：binding 表 → `keyToken` → `Keymap.handle` → `main.ts` 命令转发 → `cycleTab`；
      排除原生菜单（tauri 2.12.4 `Menu::default()` + 自建项无方括号 accelerator）、JS 侧其它
      keydown 拦截（escape-router 只处理 Escape、link-suggest 只记录事件）。
- [x] 独立 WKWebView 探针（`.local/probes/tab-navigation-keys-nov27/`）：裸 WKWebView + 同
      accelerator 菜单，两条注入通道取 NSEvent / DOM 形态；记录 `key` / `code` / 修饰位 /
      `isComposing` / `defaultPrevented` / 归一后 token。
- [x] WebKit 源码核对：`keyForKeyEvent` 无 Control 时取 `[event characters]`。
- [x] 排除 HID 级注入通道（`IOHIDEventSystemClientDispatchEvent` 在本进程被系统丢弃）——物理按键
      形态登记为「未验」，不用合成结果冒充。

## 2. 实现

- [x] `src/keys.ts`：新增 `SHIFTED_SYMBOLS`（单一来源），`SHIFT_IMPLIED_KEYS` 由值集派生，
      `normalizeKey` 折平「Shift + 未 Shift 字符」与 Shift 后字符。
- [x] `src/key-glyphs.ts`：`SHIFTED_TO_PHYSICAL` 从 `SHIFTED_SYMBOLS` 派生，去掉第二份映射。
- [x] 文案：D315 / D316 / D544 / D545 / D973 与 `文案-Copy.md` 同步改准（删掉「写
      `Cmd-Shift-]` 永不命中」的旧句）。
- [x] `src/keys.ts` 头注释与绑定注释清扫旧口径（M242 / M627 / M195 段）。

## 3. 测试

- [x] 红测试先行：`tests/unit/keys.test.ts` 新增「两种事件形态同 token」专测，并翻转 M242 /
      M627 / M195 三处旧断言。旧实现下 **5 条红**：① `Ctrl-Shift-/ → Ctrl-?`；② 通用 Shift 符号
      映射；③ 方括号两种形态；④ 逗号 / 句号两种形态；⑤ `Cmd-Shift-= → Cmd-+`。独立反向运行
      （父提交算法的 `src/keys.ts` + 当前测试）：`tests 55 / pass 50 / fail 5`，退出码 1，
      证据 `.local/reviews/tab-navigation-keys-nov27/evidence/unit-parent-reverse.log`；
      实现后目标单测 `tests 58 / pass 58 / fail 0`（同目录 `unit-target.log`）。
- [x] `tests/visual/scenes/m242-tab-cycle-key-tokens.spec.ts`：两条「边界固化（不命中）」翻转为
      「WKWebView 形态必须命中」，另保留 Shift 后形态的命中用例。
- [x] 反向核对：临时回退 `normalizeKey` 的归一分支，新增断言逐条转红；恢复后绿。

## 4. 验收材料（真机由主会话统一跑）

- [x] 场景 45 新增 `⌘⇧]` / `⌘⇧[` 两段真机步骤；「验不了」一节改写为「形态差异已收口」，
      附事件矩阵、WebKit 来源与探针路径。
- [x] `scripts/acceptance/README.md` 的「键盘注入通道的两类不可达」第 2 条改写：不再是不可达，
      注入形态命中表内绑定；残留边界（物理键 `characters`）如实登记。
- [x] 真机跑场景 45（主会话执行）：`status.txt` = PASS，`summary.md` 记 52 条断言 / 0 失败 /
      47.7s；新增 `cmd+shift+rightbracket` / `cmd+shift+leftbracket` 两步均 PASS
      （`tabs-a → tabs-b → tabs-a`，AX 选中态 + 前台正文双读数）。证据：
      `.local/acceptance/2026-11-27-tab-navigation-keys/45-tab-cycle-keys/`。
      该结果证明**注入通道**（KimiCU → DOM → 归一化 → 标签命令）的链路，不证明物理 HID / TSM 形态。
- [x] 物理键盘边界：**注入通道**已由场景 45 验（见上）；**物理键盘**按一次 `⌘⇧]` / `⌘⇧[` 的
      读数仍是独立待验项（无自动化通道），留 Alex dogfood——登记为已知边界，不冒充已验、不阻塞归档
      （证据边界见 design §5 与探针 README）。

## 5. 门禁与收尾

- [x] `pnpm test`（单元）：rebase 后低负载 `tests 2193 / pass 2193 / fail 0`。历史读数：
      `2192/2193` 那次唯一红是 `link-suggest` 的单次 16ms 预算测量（同函数 steady-state 中位
      0.77ms / master 0.81ms，master 同负载下同样红），与本次改动无关，按环境噪声登记，未放宽判据。
- [x] 视觉 m242 场景：`7 passed`（首轮端口 4291；rebase 后端口 4296 复跑同为 `7 passed`），
      含两条 WKWebView 未 Shift 形态。
- [x] `scripts/gate.sh quick`（rebase 到 `f458ace7` 后，补 backlog 队列条目后复跑）：
      `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0。历史读数保留：旧基高负载下曾 `12/13`
      （唯一 FAIL 即上述 `link-suggest` 测量）。
- [x] 完整 `scripts/gate.sh visual`（rebase 后四次，原始日志在
      `.local/reviews/tab-navigation-keys-nov27/evidence/gate-visual-rebased-{1,2,3,4}-*.log`）：
      四次均 `GATE RESULT: 14/15 PASS（SKIP 0）`，**未取得单次全绿**，逐次分类如下：
      1. 第 1 次：visual-regression PASS（1945 passed / 13 skipped / 0 failed，1359s）；
         `unit-tests` FAIL——`link-suggest` 单次 16ms 预算测出 22.02ms，失败时段同机有他树
         2195 测试全通过日志（并发单测），归因为外部负载。
      2. 第 2 次：visual-regression PASS（1945 / 13 / 0，1359s）；`unit-tests` PASS（2196/2196）；
         `docs-check` FAIL——`openspec-archive-check` 的归档队列面要求本 change 在
         `docs/backlog.md` 有唯一队列条目，而 tasks 刚全勾、条目尚未补（本条已随后补上）。
      3. 第 3 次（补条目后）：`unit-tests` PASS（2196/2196）；visual-regression 1944 passed /
         **1 failed** / 13 skipped——失败为 `editing-oracle.spec.ts:1143`（IME 组合结束 4s 后
         250ms 低频恢复），与首轮旧基失败同一用例。
      4. 第 4 次（确认机器空闲、隔离端口 4297 重跑）：`unit-tests` PASS（2196/2196）、
         visual-regression 1944 passed / **1 failed** / 13 skipped——同一 `editing-oracle`
         用例再失败。该用例在 rebase 后隔离复跑 4/4 PASS，第 1 / 2 次完整 visual 通过；`docs/backlog.md`
         的 END 归档条记录 master 侧同一 oracle 的 A/B（候选 40/40 vs master 37/40），属既有
         flaky oracle（全量串行下约半数失败）。
      **历史结论（当时）：四次完整 visual 均为 `14/15`，未取得单次全绿 ⇒ 未归档**（节点 2 未放行）；
      四次红均不在本 change 的键位代码 / 场景面（外负载 / 流程条目 / 既有 flaky oracle）。该 red 的
      根因（`editing-oracle` 的 settle 计时 oracle）随后由 change `fix-ime-settle-oracle-nov27` 修掉。
- [x] **最终集成 tip `c21e5fbc` 的完整 `scripts/gate.sh visual`**（在历史四次之后）：
      `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；visual-regression 1410s / 1993 passed /
      13 skipped / 0 failed。证据
      `.local/reviews/tab-navigation-keys-nov27/evidence/gate-visual-integrated-2026-11-28.log`。
- [x] **最终集成 tip `c21e5fbc` 的 `scripts/gate.sh quick`**：`GATE RESULT: 13/13 PASS（SKIP 0）`，
      退出码 0；前端单测 `tests 2196 / pass 2196 / fail 0`。证据
      `.local/reviews/tab-navigation-keys-nov27/evidence/gate-quick-final-tip-2026-11-28.log`。
      历史读数保留：`f458ace7` 时期 quick 13/13（2196）、旧基高负载 12/13（`link-suggest` 噪声）。
- [x] **最终集成 tip 的真机 45（注入通道）**：PASS，27.4s / 52 断言 / 0 失败（含
      `cmd+shift+rightbracket` / `cmd+shift+leftbracket` 两步，AX 选中态 + 前台正文双读数）。
      证据 `.local/acceptance/2026-11-28-tab-navigation-keys-final/`（`status.txt` 与 `steps.md`
      在 `evidence/45-tab-cycle-keys/`）。**不冒称物理键盘**：dogfood 仍是独立人工边界。
- [x] 独立审查：首轮 findings P1=0 / P2=1 / P3=2（`final-judgment.md`）→ 修准 → R2 clean/merge
      （`final-judgment-r2.md`，绑 `f10d9ffd`）→ 终审 **clean/merge P1/P2/P3=0** 绑 `c21e5fbc`
      （`independent-review-final.md`）。
