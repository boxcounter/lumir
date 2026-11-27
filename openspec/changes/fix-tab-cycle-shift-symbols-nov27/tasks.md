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
      M627 / M195 三处旧断言（旧实现下 4 条红，实现后全绿）。
- [x] `tests/visual/scenes/m242-tab-cycle-key-tokens.spec.ts`：两条「边界固化（不命中）」翻转为
      「WKWebView 形态必须命中」，另保留 Shift 后形态的命中用例。
- [x] 反向核对：临时回退 `normalizeKey` 的归一分支，新增断言逐条转红；恢复后绿。

## 4. 验收材料（真机由主会话统一跑）

- [x] 场景 45 新增 `⌘⇧]` / `⌘⇧[` 两段真机步骤；「验不了」一节改写为「形态差异已收口」，
      附事件矩阵、WebKit 来源与探针路径。
- [x] `scripts/acceptance/README.md` 的「键盘注入通道的两类不可达」第 2 条改写：不再是不可达，
      注入形态命中表内绑定；残留边界（物理键 `characters`）如实登记。
- [ ] 真机跑场景 45（`node scripts/acceptance/run.mjs 45`）——主会话统一执行，避免并行真机。
- [ ] Alex dogfood：物理键盘按一次 `⌘⇧]` / `⌘⇧[`，确认标签切换（唯一能给出物理形态读数的通道）。

## 5. 门禁与收尾

- [x] `pnpm test`（单元）：`tests 2193 / pass 2192 / fail 1`——唯一红是 `link-suggest` 的单次
      16ms 预算测量（同函数 steady-state 中位 0.77ms，master 0.81ms；master 同负载下同样红），
      与本次改动无关，登记为环境噪声。
- [x] 视觉 m242 场景（端口 4291 隔离）：`7 passed`，含两条 WKWebView 未 Shift 形态。
- [x] `scripts/gate.sh quick`：`GATE RESULT: 12/13 PASS（SKIP 0）`，唯一 FAIL 即上述单元测量；
      cargo-fmt / clippy / cargo-test / bindings / schemas / tsc×3 / perf 夹具 / acceptance 契约 /
      docs-check / openspec validate 全 PASS。
- [ ] 节点 1 评审、归档（tower）
