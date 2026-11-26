import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterSkillCatalog,
  hoverSkillHighlight,
  isSkillName,
  moveSkillHighlight,
  openSkillMenu,
  sameSkillMenuState,
  skillMenuNavigationDelta,
  skillSelectionSpec,
  skillTokenAt,
  syncSkillMenuState,
} from "../../src/skill-menu.ts";
import type { SkillSummary } from "../../src/bindings/SkillSummary.ts";

const skill = (name: string, over: Partial<SkillSummary> = {}): SkillSummary => ({
  name,
  description: `${name} description`,
  source: "vault",
  user_invocable: true,
  model_invocable: true,
  invocation_valid: true,
  ...over,
});
const catalog = [
  skill("acc-skill-abc"),
  skill("acc-deploy", { model_invocable: false }),
  skill("acc-background", { user_invocable: false }),
  skill("acc-invalid", { invocation_valid: false, user_invocable: false, model_invocable: false }),
];

test("grammar 只服务显式入口，过滤禁手动与非法项但保留禁自动项", () => {
  assert.equal(isSkillName("acc-skill_1"), true);
  for (const name of ["", ".hidden", "has.dot", "has space", "中文", "a/b"]) {
    assert.equal(isSkillName(name), false, name);
  }
  assert.deepEqual(filterSkillCatalog(catalog, "acc").map((item) => item.name), [
    "acc-skill-abc",
    "acc-deploy",
  ]);
});

test("/tmp 有唯一候选时高亮即 armed，Enter 接受 tmp-acc（Alex 2026-11-26 新合同）", () => {
  const tmp = [skill("tmp-acc")];
  for (const text of ["/tmp", "see /tmp", "- /tmp"]) {
    assert.deepEqual(skillTokenAt(text, text.length), { from: text.indexOf("/"), to: 4 + text.indexOf("/"), prefix: "tmp" });
    const state = openSkillMenu(text, text.length, tmp)!;
    assert.equal(state.highlighted, 0, "唯一候选必须自动成为高亮");
    assert.equal(state.armed, true, "有效高亮必须 armed：/tmp 不再享有「不是全名」豁免");
    const selected = skillSelectionSpec(text, state)!;
    assert.equal(selected.skill.name, "tmp-acc");
    assert.equal(selected.changes.from, text.indexOf("/"));
    assert.equal(selected.changes.to, text.length);
    assert.equal(selected.changes.insert, "/tmp-acc ");
  }
  // token 边界不受新合同影响
  assert.equal(skillTokenAt("x/tmp", 5), null);
  assert.deepEqual(skillTokenAt("/tmp", 2), { from: 0, to: 2, prefix: "t" });
  assert.equal(skillTokenAt("/tmp", 5), null);
});

test("部分匹配与全名同路：不要求全名即可接受，大小写不匹配则无候选", () => {
  const full = openSkillMenu("/tmp-acc", 8, [skill("tmp-acc")])!;
  assert.equal(full.armed, true);
  assert.equal(full.highlighted, 0);
  assert.deepEqual(skillSelectionSpec("/tmp-acc", full)?.skill, { name: "tmp-acc", from: 0 });

  const partial = openSkillMenu("/tmp-a", 6, [skill("tmp-acc")])!;
  assert.equal(partial.armed, true, "部分前缀命中同样按当前高亮接受");
  assert.equal(skillSelectionSpec("/tmp-a", partial)?.skill.name, "tmp-acc");
  // grammar / 过滤是大小写敏感的：大小写不匹配时候选根本不出现，谈不上接受
  assert.equal(openSkillMenu("/TMP-ACC", 8, [skill("tmp-acc")]), null);
});

test("多个候选默认接受首项；箭头 / 指针改变的是接受目标", () => {
  const opened = openSkillMenu("/acc", 4, catalog)!;
  assert.deepEqual(opened.items.map((item) => item.name), ["acc-skill-abc", "acc-deploy"]);
  assert.equal(opened.highlighted, 0);
  assert.equal(opened.armed, true);
  assert.equal(skillSelectionSpec("/acc", opened)?.skill.name, "acc-skill-abc");

  const moved = moveSkillHighlight(opened, 1);
  assert.equal(moved.highlighted, 1);
  assert.equal(moved.armed, true);
  assert.equal(skillSelectionSpec("/acc", moved)?.skill.name, "acc-deploy");

  const hovered = hoverSkillHighlight(opened, 1);
  assert.equal(hovered.highlighted, 1);
  assert.equal(hovered.armed, true);
  assert.equal(skillSelectionSpec("/acc", hovered)?.skill.name, "acc-deploy");
});

test("技能全名恰好是 tmp 时 /tmp 接受该项；/tm 也按高亮接受（不再要求全名）", () => {
  const state = openSkillMenu("/tmp", 4, [skill("tmp")])!;
  assert.equal(state.armed, true);
  assert.equal(state.highlighted, 0);
  assert.deepEqual(skillSelectionSpec("/tmp", state)?.changes, { from: 0, to: 4, insert: "/tmp " });
  assert.deepEqual(skillSelectionSpec("/tmp", state)?.skill, { name: "tmp", from: 0 });

  const mixed = openSkillMenu("/tmp", 4, [skill("tmp-acc"), skill("tmp")])!;
  assert.equal(mixed.armed, true);
  assert.equal(mixed.items[mixed.highlighted]?.name, "tmp");
  assert.equal(mixed.items.length, 2, "全名项被指向，不是把前缀相同的项过滤掉");

  assert.equal(openSkillMenu("/tm", 3, [skill("tmp")])!.armed, true);
  assert.equal(skillSelectionSpec("/tm", openSkillMenu("/tm", 3, [skill("tmp")])!)?.skill.name, "tmp");
});

test("查询变化自动高亮首项，并按名字保留上一次高亮与接受态", () => {
  const opened = openSkillMenu("/acc", 4, catalog)!;
  assert.deepEqual(opened.items.map((item) => item.name), ["acc-skill-abc", "acc-deploy"]);
  assert.equal(opened.highlighted, 0);
  assert.equal(opened.armed, true);

  const moved = moveSkillHighlight(opened, 1);
  // 键入一个字符：两项仍命中 → 按名字保留 acc-deploy，仍是接受态
  const narrowed = syncSkillMenuState(moved, "/acc-", 5, catalog)!;
  assert.equal(narrowed.highlighted, 1);
  assert.equal(narrowed.items[narrowed.highlighted]?.name, "acc-deploy");
  assert.equal(narrowed.armed, true);
  assert.equal(skillSelectionSpec("/acc-", narrowed)?.skill.name, "acc-deploy");

  // 删回原前缀：名字仍然存在 → 依旧保留
  const widened = syncSkillMenuState(narrowed, "/acc", 4, catalog)!;
  assert.equal(widened.highlighted, 1);
  assert.equal(widened.items[widened.highlighted]?.name, "acc-deploy");
  assert.equal(widened.armed, true);
});

test("按名字保留失效时回落首项，并保持接受态", () => {
  const moved = moveSkillHighlight(openSkillMenu("/acc", 4, catalog)!, 1);
  const filtered = syncSkillMenuState(moved, "/acc-s", 6, catalog)!;
  assert.deepEqual(filtered.items.map((item) => item.name), ["acc-skill-abc"]);
  assert.equal(filtered.highlighted, 0);
  assert.equal(filtered.armed, true);
  assert.equal(skillSelectionSpec("/acc-s", filtered)?.skill.name, "acc-skill-abc");
});

test("全名前缀命中时仍指向该全名项，接受态不依赖全名", () => {
  const narrowed = syncSkillMenuState(openSkillMenu("/acc", 4, catalog), "/acc-deploy", 11, catalog)!;
  assert.deepEqual(narrowed.items.map((item) => item.name), ["acc-deploy"]);
  assert.equal(narrowed.highlighted, 0);
  assert.equal(narrowed.armed, true);
});

test("异步 catalog 迟到只改 items：保留按名字的高亮与接受目标", () => {
  const only = [skill("acc-skill-abc")];
  const opened = openSkillMenu("/acc", 4, only)!;
  assert.equal(opened.armed, true);
  const arrived = syncSkillMenuState(opened, "/acc", 4, catalog)!;
  assert.deepEqual(arrived.items.map((item) => item.name), ["acc-skill-abc", "acc-deploy"]);
  assert.equal(arrived.highlighted, 0);
  assert.equal(arrived.armed, true, "迟到 catalog 到达后仍是接受态");

  const moved = moveSkillHighlight(opened, 0);
  const refreshed = syncSkillMenuState(moved, "/acc", 4, [...catalog, skill("acc-extra")])!;
  assert.equal(refreshed.items[refreshed.highlighted]?.name, "acc-skill-abc");
  assert.equal(refreshed.armed, true);
  assert.equal(skillSelectionSpec("/acc", refreshed)?.skill.name, "acc-skill-abc");
});

test("异步回包新增与 query 同名的项：同一 token 仍保留当前目标，不改选", () => {
  const moved = moveSkillHighlight(openSkillMenu("/acc", 4, catalog)!, 1);
  assert.equal(skillSelectionSpec("/acc", moved)?.skill.name, "acc-deploy");
  const arrived = syncSkillMenuState(moved, "/acc", 4, [skill("acc"), ...catalog])!;
  assert.equal(arrived.items[arrived.highlighted]?.name, "acc-deploy", "同 token 的异步回包不得被全名规则改选");
  assert.equal(arrived.armed, true);
  assert.equal(skillSelectionSpec("/acc", arrived)?.skill.name, "acc-deploy");
  // query 变化仍按「全名项 > 保留 > 首项」：新前缀逐字等于全名时指向该全名项
  const typed = syncSkillMenuState(arrived, "/acc", 4, [skill("acc"), ...catalog])!;
  const renamed = syncSkillMenuState(typed, "/acc-", 5, [skill("acc"), ...catalog])!;
  assert.equal(renamed.items[renamed.highlighted]?.name, "acc-deploy", "按名字保留");
  const full = syncSkillMenuState(renamed, "/acc", 4, [skill("acc"), ...catalog])!;
  assert.equal(full.items[full.highlighted]?.name, "acc", "query 变化回全名时指向全名项");
});

test("异步 catalog 重排不得换掉刚接受的目标：按名字保留，selection 指向同一项", () => {
  const accepted = moveSkillHighlight(openSkillMenu("/acc", 4, catalog)!, 1);
  assert.equal(skillSelectionSpec("/acc", accepted)?.skill.name, "acc-deploy");

  // 回包把顺序整个翻过来，并在前面插入新项：目标仍必须按名字锁定
  const reordered = [skill("acc-extra"), skill("acc-deploy"), skill("acc-skill-abc")];
  const refreshed = syncSkillMenuState(accepted, "/acc", 4, reordered)!;
  assert.equal(refreshed.items[refreshed.highlighted]?.name, "acc-deploy");
  assert.equal(refreshed.armed, true);
  assert.equal(skillSelectionSpec("/acc", refreshed)?.skill.name, "acc-deploy");

  // 目标消失：回落到首项，接受态仍成立
  const dropped = syncSkillMenuState(refreshed, "/acc", 4, [skill("acc-skill-abc")])!;
  assert.equal(dropped.highlighted, 0);
  assert.equal(dropped.items[dropped.highlighted]?.name, "acc-skill-abc");
  assert.equal(dropped.armed, true);
});

test("同一状态重复同步不重建：sameSkillMenuState 认 token / 游标 / 接受态与逐项引用", () => {
  const opened = openSkillMenu("/acc", 4, catalog)!;
  assert.equal(sameSkillMenuState(opened, syncSkillMenuState(opened, "/acc", 4, catalog)), true);
  assert.equal(sameSkillMenuState(null, null), true);
  assert.equal(sameSkillMenuState(opened, null), false);
  assert.equal(sameSkillMenuState(opened, moveSkillHighlight(opened, 1)), false);
  // 真实 catalog 回包是新对象数组：即使名字相同也必须允许重建（内容可能变）
  const refreshed = syncSkillMenuState(opened, "/acc", 4, catalog.map((item) => ({ ...item })))!;
  assert.equal(sameSkillMenuState(opened, refreshed), false);
});

test("方向键从自动高亮项移动，到端停住；接受态始终成立", () => {
  const opened = openSkillMenu("/acc", 4, catalog)!;
  assert.equal(opened.armed, true);
  const down = moveSkillHighlight(opened, 1);
  assert.equal(down.highlighted, 1);
  assert.equal(down.armed, true);
  assert.equal(moveSkillHighlight(down, 1).highlighted, 1, "末项停住");
  const up = moveSkillHighlight(opened, -1);
  assert.equal(up.highlighted, 0, "首项停住（不环绕到末项）");
  assert.equal(up.armed, true);
});

test("指针悬停置高亮，越界索引被忽略；接受态不变", () => {
  const opened = openSkillMenu("/acc", 4, catalog)!;
  const hovered = hoverSkillHighlight(opened, 1);
  assert.equal(hovered.highlighted, 1);
  assert.equal(hovered.armed, true);
  assert.equal(hoverSkillHighlight(hovered, 9), hovered);
  assert.equal(hoverSkillHighlight(hovered, -1), hovered);
});

test("键盘类型 × 列表长度 × 高亮位置：Ctrl+N/P 与方向键逐步同态且到端停住", () => {
  for (const length of [1, 2, 6, 17]) {
    const items = Array.from({ length }, (_, index) => skill(`skill-${index}`));
    for (const family of ["arrows", "ctrl"] as const) {
      const down = family === "arrows" ? "ArrowDown" : "n";
      const up = family === "arrows" ? "ArrowUp" : "p";
      const downKey = { key: down, ctrlKey: family === "ctrl", metaKey: false, altKey: false };
      const upKey = { key: up, ctrlKey: family === "ctrl", metaKey: false, altKey: false };
      assert.equal(skillMenuNavigationDelta(downKey), 1);
      assert.equal(skillMenuNavigationDelta(upKey), -1);
      let state = openSkillMenu("/skill", 6, items)!;
      const forward = [state.highlighted];
      for (let step = 0; step < length + 2; step += 1) {
        state = moveSkillHighlight(state, skillMenuNavigationDelta(downKey)!);
        assert.equal(state.armed, true);
        forward.push(state.highlighted);
      }
      assert.deepEqual(
        forward,
        [0, ...Array.from({ length: length + 2 }, (_, step) => Math.min(length - 1, step + 1))],
        `${family} length=${length} 正向`,
      );
      const backward = [state.highlighted];
      for (let step = 0; step < length + 2; step += 1) {
        state = moveSkillHighlight(state, skillMenuNavigationDelta(upKey)!);
        backward.push(state.highlighted);
      }
      assert.deepEqual(
        backward,
        [length - 1, ...Array.from({ length: length + 2 }, (_, step) => Math.max(0, length - 2 - step))],
        `${family} length=${length} 反向`,
      );
    }
  }
});

test("候选导航不接管 Shift/Meta/Alt 组合；无修饰 Ctrl+N/P 仍严格分流", () => {
  for (const key of ["n", "N", "p", "P"]) {
    assert.equal(skillMenuNavigationDelta({ key, ctrlKey: true, metaKey: true, altKey: false }), null);
    assert.equal(skillMenuNavigationDelta({ key, ctrlKey: true, metaKey: false, altKey: true }), null);
    assert.equal(skillMenuNavigationDelta({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }), null);
    assert.equal(skillMenuNavigationDelta({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), key.toLowerCase() === "n" ? 1 : -1);
  }
  for (const key of ["ArrowDown", "ArrowUp"]) {
    assert.equal(skillMenuNavigationDelta({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: true }), null);
  }
  assert.equal(skillMenuNavigationDelta({ key: "ArrowDown", ctrlKey: true, metaKey: false, altKey: false }), null);
  assert.equal(skillMenuNavigationDelta({ key: "ArrowUp", ctrlKey: false, metaKey: true, altKey: false }), null);
  assert.equal(skillMenuNavigationDelta({ key: "ArrowDown", ctrlKey: false, metaKey: false, altKey: true }), null);
});

test("选中只替换当前 token，复用既有尾随空格并产出 ref；部分匹配同样可接受", () => {
  const opened = openSkillMenu("ask /acc", 8, catalog)!;
  assert.equal(opened.armed, true, "旧口径「被动态即使有视觉高亮也不得接受」已废止");
  const spec = skillSelectionSpec("ask /acc next", opened);
  assert.notEqual(spec, null);
  assert.deepEqual(spec!.changes, { from: 4, to: 9, insert: "/acc-skill-abc " });
  assert.deepEqual(spec!.skill, { name: "acc-skill-abc", from: 4 });
  assert.deepEqual(spec!.selection, { anchor: 19 });
});

test("无候选时没有可接受状态：零命中 / 空 catalog / 全被过滤", () => {
  assert.equal(openSkillMenu("/zzz", 4, catalog), null);
  assert.equal(openSkillMenu("/acc", 4, []), null);
  assert.equal(openSkillMenu("/acc", 4, [
    skill("acc-background", { user_invocable: false }),
    skill("acc-invalid", { invocation_valid: false, user_invocable: false }),
  ]), null);
  assert.equal(openSkillMenu("/acc", 0, catalog), null, "caret 在 token 之外不显示候选");
});

test("不变量矩阵：任何非空候选状态都 armed（不存在「有游标但未武装」）", () => {
  const catalogs: Array<Array<ReturnType<typeof skill>>> = [
    catalog,
    [skill("tmp-acc")],
    [skill("tmp")],
    [skill("in-notes"), skill("in-search")],
    [],
  ];
  const texts = ["/a", "/acc", "/acc-", "/tmp", "/tmp-a", "/in", "/zzz", "ask /acc next"];
  for (const items of catalogs) {
    for (const text of texts) {
      const state = openSkillMenu(text, text.length, items);
      if (state !== null) {
        assert.equal(state.armed, true, `${text} / ${items.map((item) => item.name).join(",")}`);
        assert.ok(state.items.length > 0);
        assert.ok(state.highlighted >= 0 && state.highlighted < state.items.length);
        assert.notEqual(skillSelectionSpec(text, state), null);
      } else {
        assert.equal(skillSelectionSpec(text, { token: { from: 0, to: 0, prefix: "" }, items: [], highlighted: 0, armed: false }), null);
      }
    }
  }
});
