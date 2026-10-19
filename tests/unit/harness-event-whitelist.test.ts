// IPC 事件白名单不变量（M595）：`HarnessEvent` 联合里声明的每个 type，`parseHarnessEvent`
// 的准入白名单都必须放行——漏一个就是事件在 IPC 边界被静默丢弃（REVIEW.md「同一语义两处
// 真源」条：「联合已声明、白名单缺分支」是本仓第二次踩的同族形态）。
//
// M603 在同一份联合上补消费侧的两处同族形态（文件末尾的三组用例）：`handleEvent` 的 switch
// 穷尽性（default + never 断言）与轮次闸门集合的类型化。
//
// 现场：M576（9b97ff4a）引入 `title` 事件（会话自动命名的即时改名）时漏了白名单分支，
// M590（bee2ee69）扩白名单仍未补；类型层写着 `{ type: "title"; title: string }`，运行期
// 却被 `parseHarnessEvent` 的 default 丢成 null，标题只在重开快照 / 切 vault 后从磁盘恢复。
// 验收场景 163/167 因此判红，164 因断言与回落名撞车而假 PASS（M594 findings）。
//
// 本层落两条互补的判据：
//   1. **运行期**：从源码取联合声明的 type 清单（类型擦除后运行期拿不到联合本身），逐个喂给
//      parseHarnessEvent——任一 type 被解析成 null 即红。这条不信任白名单的写法，直接判行为。
//   2. **结构**：白名单 switch 的 case 集合与联合的 type 集合逐项对账（多一个少一个都红）。
// 白名单在代码里是**单一来源**（`isHarnessEventType`，类型层由 `uncoveredEventType` 的
// `never` 形参把关），本测试是它的第二道、独立的机器防线。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHarnessEvent } from "../../src/ipc.ts";

const IPC_SOURCE = readFileSync(new URL("../../src/ipc.ts", import.meta.url), "utf8");

/** 按 `{` / `}` 深度截出某个函数 / 类型的完整块（从首个 `{` 到配对的 `}`）。 */
function blockOf(source: string, header: string): string {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `src/ipc.ts 里找不到锚点：${header}`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `锚点之后没有块起始：${header}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`块未闭合：${header}`);
}

/** `HarnessEvent` 联合声明的 type 字面量（升序）。联合成员一行一个、以 `| { type: "…"` 起头。 */
function unionTypesOf(source: string): string[] {
  const header = "export type HarnessEvent = HarnessEventEnvelope &";
  const start = source.indexOf(header);
  assert.notEqual(start, -1, "src/ipc.ts 里找不到 HarnessEvent 联合声明");
  const end = source.indexOf("\n  );", start);
  assert.notEqual(end, -1, "HarnessEvent 联合声明找不到 `  );` 收尾");
  const types = [...source.slice(start, end).matchAll(/^\s*\| \{ type: "([^"]+)"/gm)].map(
    (match) => match[1],
  );
  assert.ok(types.length > 0, "HarnessEvent 联合声明的成员一个都没解析出来（解析口径已过期）");
  return types.sort();
}

/** 准入白名单 `isHarnessEventType` 的 case 字面量（升序）。 */
function whitelistTypesOf(source: string): string[] {
  const body = blockOf(source, "function isHarnessEventType(");
  const types = [...body.matchAll(/^\s*case "([^"]+)":/gm)].map((match) => match[1]);
  assert.ok(types.length > 0, "isHarnessEventType 的 case 一个都没解析出来（解析口径已过期）");
  return types.sort();
}

test("运行期不变量：联合声明的每个 type 都通过 IPC 准入门（漏接即红）", () => {
  const union = unionTypesOf(IPC_SOURCE);
  for (const type of union) {
    const parsed = parseHarnessEvent({ type });
    assert.notEqual(parsed, null, `事件 type "${type}" 在联合里声明了、却被 parseHarnessEvent 丢掉`);
    assert.equal(parsed?.type, type);
  }
});

test("结构对账：白名单 case 集合与联合 type 集合逐项一致（任一侧漂移即红）", () => {
  const union = unionTypesOf(IPC_SOURCE);
  const whitelist = whitelistTypesOf(IPC_SOURCE);
  assert.deepEqual(whitelist, union, "白名单与 HarnessEvent 联合不一致（漏接或幽灵分支）");
});

test("白名单单点消费：parseHarnessEvent 自身不再另列一份 case 清单（防第三份真源）", () => {
  const body = blockOf(IPC_SOURCE, "export function parseHarnessEvent(");
  assert.ok(body.includes("isHarnessEventType("), "parseHarnessEvent 没有经白名单函数准入");
  assert.equal(
    /^\s*case "/m.test(body),
    false,
    "parseHarnessEvent 里又出现了一份 case 清单——两处真源会再次漂移",
  );
});

test("回归现场：title 事件放行且标题值原样带出；未知 / 非字符串 type 仍丢弃", () => {
  const object = parseHarnessEvent({ type: "title", title: "Rust 生命周期排查", vault: "/v/a" });
  assert.equal(object?.type, "title");
  assert.equal((object as { title?: string } | null)?.title, "Rust 生命周期排查");
  // string 载荷（宽容入口）同样放行
  const text = parseHarnessEvent('{"type":"title","title":"非法值回落标题"}');
  assert.equal((text as { title?: string } | null)?.title, "非法值回落标题");
  // 白名单之外的 type 照旧丢弃（宽容入口不抛错）：拼错 / 缺 type / 非字符串
  assert.equal(parseHarnessEvent({ type: "titles" }), null);
  assert.equal(parseHarnessEvent({ title: "x" }), null);
  assert.equal(parseHarnessEvent({ type: 42 }), null);
});

test("对账的反向输入：从源码里删掉任一 case，对账必须如实判红（断言有区分度）", () => {
  const union = unionTypesOf(IPC_SOURCE);
  // 删除本条 mission 修复的那个 case（title）
  const withoutTitle = IPC_SOURCE.replace(/^\s*case "title":\n/m, "");
  assert.notEqual(withoutTitle, IPC_SOURCE, "反向输入的改写必须真的删掉了 case（否则本用例恒真）");
  assert.deepEqual(
    union.filter((type) => !whitelistTypesOf(withoutTitle).includes(type)),
    ["title"],
    "删掉 case \"title\" 后对账必须报出 title",
  );
  // 删除一个与本条无关的冷门 case（auto_turn_started）：同一判据同样判红（不是 title 专属特判）
  const withoutAuto = IPC_SOURCE.replace(/^\s*case "auto_turn_started":\n/m, "");
  assert.notEqual(withoutAuto, IPC_SOURCE, "反向输入的改写必须真的删掉了 case（否则本用例恒真）");
  assert.deepEqual(
    union.filter((type) => !whitelistTypesOf(withoutAuto).includes(type)),
    ["auto_turn_started"],
  );
  // 反向：多一个联合里不存在的幽灵 case 也必须判不等
  const withGhost = IPC_SOURCE.replace(
    /^(\s*)case "title":\n/m,
    '$1case "ghost_event":\n$1case "title":\n',
  );
  assert.notDeepEqual(whitelistTypesOf(withGhost), union, "幽灵 case 必须被对账判红");
});

// ── M603：消费侧的同一族穷尽性闸门 ─────────────────────────────────────────────
//
// M595 收的是 IPC 入口的准入门（白名单）；M603 收的是消费侧两处同族形态：
//   1. `handleEvent` 的 switch 没有 default ⇒ 联合新增 type 漏补 case 时事件被静默忽略；
//   2. `GATED_EVENT_TYPES` 曾是 `Set<string>`，与 `HarnessEvent["type"]` 无编译期关系。
// 编译期判据分别是 default 里的 `uncoveredEventType(event)`（收窄到 `never`，漏 case 时
// tsc 报 TS2345）与 `ReadonlySet<HarnessEvent["type"]>` 注解（拼错词元即报错）。本层从源码
// 取集合与联合逐项对账，是独立的第二道机器防线——实例化检查与源码对账互为兜底。

const PANEL_SOURCE = readFileSync(new URL("../../src/harness-panel.ts", import.meta.url), "utf8");
const HANDLE_EVENT_HEADER = "function handleEvent(event: HarnessEvent): void {";

/** `handleEvent` switch 的 case 字面量（升序）。case 在 switch 内缩进六格，嵌套块不命中。 */
function handleEventTypesOf(source: string): string[] {
  const body = blockOf(source, HANDLE_EVENT_HEADER);
  const types = [...body.matchAll(/^      case "([^"]+)":/gm)].map((match) => match[1]);
  assert.ok(types.length > 0, "handleEvent 的 case 一个都没解析出来（解析口径已过期）");
  return types.sort();
}

/** `GATED_EVENT_TYPES` 声明块（从声明行到 `]);`）。 */
function gatedDeclarationOf(source: string): string {
  const start = source.indexOf("const GATED_EVENT_TYPES");
  assert.notEqual(start, -1, "src/harness-panel.ts 里找不到 GATED_EVENT_TYPES 声明");
  const end = source.indexOf("]);", start);
  assert.notEqual(end, -1, "GATED_EVENT_TYPES 声明找不到 `]);` 收尾");
  return source.slice(start, end + 3);
}

/** 轮次闸门集合的字面量（升序）。只取 `new Set(...)` 的数组实参，不把注解里的 `"type"` 当词元。 */
function gatedTypesOf(source: string): string[] {
  const decl = gatedDeclarationOf(source);
  const setStart = decl.indexOf("new Set");
  assert.notEqual(setStart, -1, "GATED_EVENT_TYPES 不是由 new Set(...) 构造");
  const arrayStart = decl.indexOf("([", setStart);
  assert.notEqual(arrayStart, -1, "GATED_EVENT_TYPES 的 new Set 找不到数组实参起点");
  const arrayEnd = decl.indexOf("]", arrayStart);
  assert.notEqual(arrayEnd, -1, "GATED_EVENT_TYPES 的数组实参没有收尾");
  const types = [...decl.slice(arrayStart, arrayEnd).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(types.length > 0, "GATED_EVENT_TYPES 的字面量一个都没解析出来");
  return types.sort();
}

test("M603 handleEvent：case 集合与联合 type 集合逐项一致（漏 case / 幽灵 case 即红）", () => {
  assert.deepEqual(
    handleEventTypesOf(PANEL_SOURCE),
    unionTypesOf(IPC_SOURCE),
    "handleEvent 与 HarnessEvent 联合不一致（漏 case 或幽灵 case）",
  );
});

test("M603 handleEvent：default 分支经共享的 never 断言收口（静默忽略的出口已封）", () => {
  const body = blockOf(PANEL_SOURCE, HANDLE_EVENT_HEADER);
  const defaultIndex = body.lastIndexOf("\n      default:");
  assert.notEqual(defaultIndex, -1, "handleEvent 的 switch 没有 default 分支");
  assert.ok(
    body.slice(defaultIndex).includes("uncoveredEventType(event);"),
    "default 分支没有调用 uncoveredEventType(event)——穷尽性断言缺席",
  );
  const helperStart = IPC_SOURCE.indexOf("export function uncoveredEventType(");
  assert.notEqual(helperStart, -1, "src/ipc.ts 里找不到 uncoveredEventType 的导出");
  const helperSignature = IPC_SOURCE.slice(helperStart, IPC_SOURCE.indexOf("{", helperStart));
  assert.match(
    helperSignature,
    /_uncovered: never/,
    "uncoveredEventType 的形参不是 never，断言不成立",
  );
});

test("M603 GATED_EVENT_TYPES：类型化为 ReadonlySet<HarnessEvent[\"type\"]>，词元全在联合内", () => {
  const decl = gatedDeclarationOf(PANEL_SOURCE);
  assert.ok(
    decl.includes('ReadonlySet<HarnessEvent["type"]>'),
    "GATED_EVENT_TYPES 没有 ReadonlySet<HarnessEvent[\"type\"]> 注解——拼错词元不会编译失败",
  );
  const gated = gatedTypesOf(PANEL_SOURCE);
  assert.deepEqual([...new Set(gated)], gated, "闸门集合有重复词元");
  const union = unionTypesOf(IPC_SOURCE);
  const ghosts = gated.filter((type) => !union.includes(type));
  assert.deepEqual(ghosts, [], `闸门里出现联合不存在的词元：${ghosts.join(", ")}`);
});

test("M603 GATED_EVENT_TYPES：闸门只含内容事件五类；title / notice / approval_request 不在其内", () => {
  assert.deepEqual(
    gatedTypesOf(PANEL_SOURCE),
    ["compact", "reasoning_chunk", "text_chunk", "tool_call", "usage"],
    "闸门集合与 M374 的「内容类事件」口径不一致——扩缩闸门是产品语义决定，须同步本断言与注释",
  );
});

test("M603 反向输入：删 case / 删闸门词元 / 去注解 / 删 default 调用，四条判据各自判红", () => {
  const union = unionTypesOf(IPC_SOURCE);

  const withoutNotice = PANEL_SOURCE.replace(/^      case "notice":\n/m, "");
  assert.notEqual(withoutNotice, PANEL_SOURCE, "反向输入必须真的删掉了 case（否则本用例恒真）");
  assert.deepEqual(
    union.filter((type) => !handleEventTypesOf(withoutNotice).includes(type)),
    ["notice"],
    "删掉 case \"notice\" 后 handleEvent 对账必须报出 notice",
  );

  const withoutCompact = PANEL_SOURCE.replace(/^    "compact",\n/m, "");
  assert.notEqual(withoutCompact, PANEL_SOURCE, "反向输入必须真的删掉了闸门词元（否则本用例恒真）");
  assert.deepEqual(gatedTypesOf(withoutCompact), ["reasoning_chunk", "text_chunk", "tool_call", "usage"]);

  const untyped = PANEL_SOURCE.replace('ReadonlySet<HarnessEvent["type"]> = ', "= ");
  assert.notEqual(untyped, PANEL_SOURCE, "反向输入必须真的去掉了注解（否则本用例恒真）");
  assert.equal(
    gatedDeclarationOf(untyped).includes('ReadonlySet<HarnessEvent["type"]>'),
    false,
    "去掉注解后类型化判据必须如实判红",
  );

  const withoutDefaultCall = PANEL_SOURCE.replace(/^        uncoveredEventType\(event\);\n/m, "");
  assert.notEqual(withoutDefaultCall, PANEL_SOURCE, "反向输入必须真的删掉了 default 里的断言调用");
  const body = blockOf(withoutDefaultCall, HANDLE_EVENT_HEADER);
  assert.equal(
    body.slice(body.lastIndexOf("\n      default:")).includes("uncoveredEventType(event);"),
    false,
    "删掉 default 里的 uncoveredEventType 调用后判据必须如实判红",
  );
});
