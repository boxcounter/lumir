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

test("/tmp 仍可显示被动候选且自动视觉高亮唯一项，但前缀不是全名时不武装", () => {
  const tmp = [skill("tmp-acc")];
  for (const text of ["/tmp", "see /tmp", "- /tmp"]) {
    assert.deepEqual(skillTokenAt(text, text.length), { from: text.indexOf("/"), to: 4 + text.indexOf("/"), prefix: "tmp" });
    const state = openSkillMenu(text, text.length, tmp)!;
    assert.equal(state.highlighted, 0, "唯一候选必须自动成为视觉高亮");
    assert.equal(state.armed, false, "路径前缀 /tmp 不是全名 tmp-acc，不得武装 Enter");
    assert.equal(skillSelectionSpec(text, state), null);
  }
  assert.equal(skillTokenAt("x/tmp", 5), null);
  assert.deepEqual(skillTokenAt("/tmp", 2), { from: 0, to: 2, prefix: "t" });
  assert.equal(skillTokenAt("/tmp", 5), null);
});

test("全名逐字相等时自动武装；路径片段不算全名", () => {
  const state = openSkillMenu("/tmp-acc", 8, [skill("tmp-acc")])!;
  assert.equal(state.armed, true);
  assert.equal(state.highlighted, 0);
  assert.deepEqual(skillSelectionSpec("/tmp-acc", state)?.skill, { name: "tmp-acc", from: 0 });

  const partial = openSkillMenu("/tmp-a", 6, [skill("tmp-acc")])!;
  assert.equal(partial.armed, false);
  assert.equal(skillSelectionSpec("/tmp-a", partial), null);
  // grammar / 过滤是大小写敏感的：大小写不匹配时候选根本不出现，谈不上武装
  assert.equal(openSkillMenu("/TMP-ACC", 8, [skill("tmp-acc")]), null);
});

test("技能全名恰好是 tmp 时，/tmp 按全名规则武装（批准规则的明确边界）", () => {
  const state = openSkillMenu("/tmp", 4, [skill("tmp")])!;
  assert.equal(state.armed, true, "token 前缀逐字等于某项全名 → 武装，与名字是否像路径无关");
  assert.equal(state.highlighted, 0);
  assert.deepEqual(skillSelectionSpec("/tmp", state)?.changes, { from: 0, to: 4, insert: "/tmp " });
  assert.deepEqual(skillSelectionSpec("/tmp", state)?.skill, { name: "tmp", from: 0 });
  // 与更长的 tmp-acc 并存时，全名项仍是被指向的那一项
  const mixed = openSkillMenu("/tmp", 4, [skill("tmp-acc"), skill("tmp")])!;
  assert.equal(mixed.armed, true);
  assert.equal(mixed.items[mixed.highlighted]?.name, "tmp");
  // 差一个字符就不是全名
  assert.equal(openSkillMenu("/tm", 3, [skill("tmp")])!.armed, false);
});

test("查询变化自动视觉高亮首项，并按名字保留上一次高亮", () => {
  const opened = openSkillMenu("/acc", 4, catalog)!;
  assert.deepEqual(opened.items.map((item) => item.name), ["acc-skill-abc", "acc-deploy"]);
  assert.equal(opened.highlighted, 0);
  assert.equal(opened.armed, false);

  const moved = moveSkillHighlight(opened, 1);
  assert.equal(moved.highlighted, 1);
  assert.equal(moved.armed, true);

  // 键入一个字符：两项仍命中 → 按名字保留 acc-deploy
  const narrowed = syncSkillMenuState(moved, "/acc-", 5, catalog)!;
  assert.equal(narrowed.highlighted, 1);
  assert.equal(narrowed.items[narrowed.highlighted]?.name, "acc-deploy");
  assert.equal(narrowed.armed, false, "query 变化不得继承 armed");

  // 删回原前缀：名字仍然存在 → 依旧保留
  const widened = syncSkillMenuState(narrowed, "/acc", 4, catalog)!;
  assert.equal(widened.highlighted, 1);
  assert.equal(widened.items[widened.highlighted]?.name, "acc-deploy");
});

test("按名字保留失效时回落到首项，且不继承 armed", () => {
  const moved = moveSkillHighlight(openSkillMenu("/acc", 4, catalog)!, 1);
  const filtered = syncSkillMenuState(moved, "/acc-s", 6, catalog)!;
  assert.deepEqual(filtered.items.map((item) => item.name), ["acc-skill-abc"]);
  assert.equal(filtered.highlighted, 0);
  assert.equal(filtered.armed, false);
});

test("全名前缀命中时 query 变化重新武装，并指向该全名项", () => {
  const narrowed = syncSkillMenuState(openSkillMenu("/acc", 4, catalog), "/acc-deploy", 11, catalog)!;
  assert.deepEqual(narrowed.items.map((item) => item.name), ["acc-deploy"]);
  assert.equal(narrowed.highlighted, 0);
  assert.equal(narrowed.armed, true);
});

test("异步 catalog 只改高亮：保留按名字的高亮，绝不把 armed 从 false 变成 true", () => {
  const only = [skill("acc-skill-abc")];
  const opened = openSkillMenu("/acc", 4, only)!;
  assert.equal(opened.armed, false);
  const arrived = syncSkillMenuState(opened, "/acc", 4, catalog)!;
  assert.deepEqual(arrived.items.map((item) => item.name), ["acc-skill-abc", "acc-deploy"]);
  assert.equal(arrived.highlighted, 0);
  assert.equal(arrived.armed, false, "迟到 catalog 不得让被动态 Enter 变成接受");
});

test("异步 catalog 保留已武装的同一名字项；该名字消失时解除武装并回落首项", () => {
  const moved = moveSkillHighlight(openSkillMenu("/acc", 4, catalog)!, 1);
  const extra = [...catalog, skill("acc-extra")];
  const refreshed = syncSkillMenuState(moved, "/acc", 4, extra)!;
  assert.equal(refreshed.items[refreshed.highlighted]?.name, "acc-deploy");
  assert.equal(refreshed.armed, true);

  const dropped = syncSkillMenuState(refreshed, "/acc", 4, [skill("acc-skill-abc")])!;
  assert.deepEqual(dropped.items.map((item) => item.name), ["acc-skill-abc"]);
  assert.equal(dropped.highlighted, 0);
  assert.equal(dropped.armed, false);
});

test("候选首次出现且 token 已是全名时，异步回包按全名规则武装", () => {
  const state = syncSkillMenuState(null, "/acc-skill-abc", 14, catalog)!;
  assert.equal(state.armed, true);
  assert.equal(state.items[state.highlighted]?.name, "acc-skill-abc");
});

test("同一状态重复同步不重建：sameSkillMenuState 认 token / 游标 / 武装与逐项引用", () => {
  const opened = openSkillMenu("/acc", 4, catalog)!;
  assert.equal(sameSkillMenuState(opened, syncSkillMenuState(opened, "/acc", 4, catalog)), true);
  assert.equal(sameSkillMenuState(null, null), true);
  assert.equal(sameSkillMenuState(opened, null), false);
  assert.equal(sameSkillMenuState(opened, moveSkillHighlight(opened, 1)), false);
  // 真实 catalog 回包是新对象数组：即使名字相同也必须允许重建（内容可能变）
  const refreshed = syncSkillMenuState(opened, "/acc", 4, catalog.map((item) => ({ ...item })))!;
  assert.equal(sameSkillMenuState(opened, refreshed), false);
});

test("方向键从自动高亮项移动，到端停住；导航即武装", () => {
  const opened = openSkillMenu("/acc", 4, catalog)!;
  assert.equal(opened.armed, false);
  const down = moveSkillHighlight(opened, 1);
  assert.equal(down.highlighted, 1);
  assert.equal(down.armed, true);
  assert.equal(moveSkillHighlight(down, 1).highlighted, 1, "末项停住");
  const up = moveSkillHighlight(opened, -1);
  assert.equal(up.highlighted, 0, "首项停住（不环绕到末项）");
  assert.equal(up.armed, true);
});

test("指针悬停置高亮并武装，越界索引被忽略", () => {
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

test("选中只替换当前 token，复用既有尾随空格并产出 ref；未武装时不可选中", () => {
  const opened = openSkillMenu("ask /acc", 8, catalog)!;
  assert.equal(skillSelectionSpec("ask /acc", opened), null, "被动态即使有视觉高亮也不得接受");
  const selecting = hoverSkillHighlight(opened, 0);
  const spec = skillSelectionSpec("ask /acc next", selecting);
  assert.notEqual(spec, null);
  assert.deepEqual(spec!.changes, { from: 4, to: 9, insert: "/acc-skill-abc " });
  assert.deepEqual(spec!.skill, { name: "acc-skill-abc", from: 4 });
  assert.deepEqual(spec!.selection, { anchor: 19 });
});
