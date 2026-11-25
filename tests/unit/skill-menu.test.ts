import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterSkillCatalog,
  isSkillName,
  moveSkillHighlight,
  openSkillMenu,
  skillMenuNavigationDelta,
  skillSelectionSpec,
  skillTokenAt,
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

test("/tmp 仍可显示被动候选，但只有合法左边界的 token 才触发", () => {
  const tmp = [skill("tmp-acc")];
  for (const text of ["/tmp", "see /tmp", "- /tmp"]) {
    assert.deepEqual(skillTokenAt(text, text.length), { from: text.indexOf("/"), to: 4 + text.indexOf("/"), prefix: "tmp" });
    assert.equal(openSkillMenu(text, text.length, tmp)?.highlighted, null);
  }
  assert.equal(skillTokenAt("x/tmp", 5), null);
  assert.deepEqual(skillTokenAt("/tmp", 2), { from: 0, to: 2, prefix: "t" });
  assert.equal(skillTokenAt("/tmp", 5), null);
});

test("被动态无高亮，方向键进入选择态且到端停住", () => {
  const opened = openSkillMenu("/acc", 4, catalog)!;
  assert.equal(opened.highlighted, null);
  const down = moveSkillHighlight(opened, 1);
  assert.equal(down.highlighted, 0);
  assert.equal(moveSkillHighlight(down, -1).highlighted, 0);
  const up = moveSkillHighlight(opened, -1);
  assert.equal(up.highlighted, 1);
  assert.equal(moveSkillHighlight(up, 1).highlighted, 1);
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
      assert.deepEqual(forward, [null, ...Array.from({ length }, (_, index) => index), length - 1, length - 1], `${family} length=${length} 正向`);
      const backward = [state.highlighted];
      for (let step = 0; step < length + 2; step += 1) {
        state = moveSkillHighlight(state, skillMenuNavigationDelta(upKey)!);
        backward.push(state.highlighted);
      }
      assert.deepEqual(backward, [length - 1, ...Array.from({ length }, (_, index) => Math.max(0, length - 2 - index)), 0, 0], `${family} length=${length} 反向`);
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

test("选中只替换当前 token，复用既有尾随空格并产出 ref", () => {
  const opened = openSkillMenu("ask /acc", 8, catalog)!;
  const selecting = moveSkillHighlight(opened, 1);
  const spec = skillSelectionSpec("ask /acc next", selecting);
  assert.notEqual(spec, null);
  assert.deepEqual(spec!.changes, { from: 4, to: 9, insert: "/acc-skill-abc " });
  assert.deepEqual(spec!.skill, { name: "acc-skill-abc", from: 4 });
  assert.deepEqual(spec!.selection, { anchor: 19 });
});
