// 浮层宽度 / 落点的纯几何层（M702，change overlay-width-contract-oct24）。
//
// 判据只钉「合同条款」，不钉某一组数值的巧合：
//   - W1：宽度 = clamp(自然宽, 下限, min(em 上限, 宿主可用宽))；短内容不被拉伸、长内容不被挤窄；
//   - W2：em 上限随 font-size 走（12px 与 2.13 档 25.56px 两档分别核）；
//   - W4：两侧锚定边里选位移最小者，默认边只在位移相同时生效；
//   - 落点恒在宿主可用区内（这条是 W1/W6 的几何前提，越界即被祖先 overflow 裁掉）。
//
// 区分度输入：host 240/320/420/700 × natural 140/240/490 × fontSize 12/25.56 的网格里同时
// 存在「短内容被抬高」「恰好放下」「必须收窄」三类样本——只造一类样本时任一分支删掉都会假绿。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OVERLAY_TIERS,
  placeOverlay,
  resolveOverlayWidth,
} from "../../src/overlay-placement.ts";
import type { OverlayPlacementInput } from "../../src/overlay-placement.ts";

const HOSTS = [240, 320, 420, 700];
const NATURALS = [140, 240, 490];
const FONT_SIZES = [12, 25.56];

function base(overrides: Partial<OverlayPlacementInput> = {}): OverlayPlacementInput {
  return {
    tier: "prose",
    natural: 240,
    host: 700,
    hostLeft: 100,
    fontSize: 12,
    anchor: { left: 300, right: 340 },
    preferred: "right",
    rightOffset: 18,
    ...overrides,
  };
}

test("resolve：宽度恒在 [下限, min(em 上限, 可用宽)] 内，且不拉伸短内容", () => {
  for (const tier of ["compact", "list", "prose"] as const) {
    const spec = OVERLAY_TIERS[tier];
    for (const host of HOSTS) {
      for (const natural of NATURALS) {
        for (const fontSize of FONT_SIZES) {
          const solved = resolveOverlayWidth({ tier, natural, host, fontSize });
          const avail = host - 2 * spec.inset;
          const max = Math.min(spec.maxEm * fontSize, avail);
          assert.ok(solved.width <= max + 1e-9, `${tier} host=${host} natural=${natural} fontSize=${fontSize}：宽度超上限`);
          assert.ok(solved.width >= Math.min(spec.minWidth, max) - 1e-9, `${tier} host=${host}：宽度低于下限`);
          // 不拉伸：内容比下限宽时，宽度不超过内容固有宽（不得为了整齐拉宽）。
          if (natural > spec.minWidth) {
            assert.ok(solved.width <= natural + 1e-9, `${tier} host=${host} natural=${natural}：短内容被拉伸`);
          }
        }
      }
    }
  }
});

test("resolve：em 上限随字号走——2.13 档能装下 1 档被挤折的长句", () => {
  const natural = 482; // M698 实测：2.13 档 ctxpop 首行 482px
  const at1x = resolveOverlayWidth({ tier: "prose", natural, host: 1000, fontSize: 12 });
  const at213 = resolveOverlayWidth({ tier: "prose", natural, host: 1000, fontSize: 25.56 });
  assert.equal(at1x.width, Math.min(natural, 34 * 12));
  assert.equal(at213.width, natural, "2.13 档的 34em 上限应容得下 482px");
  assert.ok(at213.cap > at1x.cap, "上限必须随字号变大——写死 px 时两者相等");
});

test("resolve：极窄宿主下宽度收敛到可用宽，不越过 pane", () => {
  const solved = resolveOverlayWidth({ tier: "prose", natural: 490, host: 240, fontSize: 12 });
  assert.equal(solved.width, 240 - 16);
  // 组件下限高于可用宽时同样被钳住（下限不能反向制造越界）。
  const floored = resolveOverlayWidth({ tier: "prose", natural: 100, host: 200, fontSize: 12, minWidth: 224 });
  assert.equal(floored.width, 200 - 16);
});

test("resolve：组件下限覆盖档位下限（ctxpop 保留既有 224px）", () => {
  const solved = resolveOverlayWidth({ tier: "prose", natural: 205, host: 700, fontSize: 12, minWidth: 224 });
  assert.equal(solved.width, 224);
  // 内容超过下限时按内容走（这才是「只缩不放」被修掉的那一半）。
  const grown = resolveOverlayWidth({ tier: "prose", natural: 237.5, host: 700, fontSize: 12, minWidth: 224 });
  assert.equal(grown.width, 237.5);
});

test("place：默认边放得下时零位移、不换边", () => {
  const p = placeOverlay(base({ host: 700, natural: 240, anchor: { left: 300, right: 340 } }));
  assert.equal(p.side, "right");
  assert.equal(p.shift, 0);
  assert.equal(p.width, 240);
  // 右锚：盒右缘 = 锚右缘 + 18。
  assert.equal(p.left, 340 + 18 - 240);
});

test("place：默认边越界、另一侧放得下 ⇒ 换边而不是长距平移", () => {
  // 锚点贴宿主右缘：右锚默认落点越界（690+18-240=468 > 452），左锚（盒左缘对锚左缘 400）
  // 恰好放得下 ⇒ 换边、零位移。
  const p = placeOverlay(
    base({ host: 700, hostLeft: 0, natural: 240, anchor: { left: 400, right: 690 }, preferred: "right", rightOffset: 18 }),
  );
  assert.equal(p.side, "left");
  assert.equal(p.shift, 0);
  assert.equal(p.left, 400);
});

test("place：两侧都要位移时选位移较小的一侧", () => {
  // 宿主 420、宽 380 ⇒ 可用区 [8, 32]（maxLeft = 420-8-380 = 32）。
  // 默认左锚落点 300（要 -268）、另一侧右锚落点 38（要 -6）⇒ 右锚胜——默认边是 left，
  // 这条同时证明「默认边不因偏好而胜出」。
  const p = placeOverlay(
    base({ host: 420, hostLeft: 0, natural: 380, anchor: { left: 300, right: 400 }, preferred: "left" }),
  );
  assert.equal(p.side, "right");
  assert.equal(p.shift, -6);
  assert.equal(p.left, 32);
});

test("place：落点恒在宿主可用区内（网格 + 换边与平移两条路径）", () => {
  for (const host of HOSTS) {
    for (const natural of NATURALS) {
      for (const preferred of ["left", "right"] as const) {
        for (const anchorLeft of [0, 40, 160, host - 40]) {
          const hostLeft = 100;
          const p = placeOverlay(
            base({
              tier: "list",
              host,
              hostLeft,
              natural,
              preferred,
              rightOffset: 18,
              anchor: { left: hostLeft + anchorLeft, right: hostLeft + anchorLeft + 40 },
            }),
          );
          assert.ok(p.left >= hostLeft + 8 - 1e-9, `左缘越界：host=${host} natural=${natural} preferred=${preferred}`);
          assert.ok(
            p.left + p.width <= hostLeft + host - 8 + 1e-9,
            `右缘越界：host=${host} natural=${natural} preferred=${preferred} left=${p.left} width=${p.width}`,
          );
        }
      }
    }
  }
});

test("place：幂等——同一输入重复裁决得到同一落点", () => {
  const input = base({ host: 320, hostLeft: 0, natural: 490, anchor: { left: 120, right: 200 } });
  const first = placeOverlay(input);
  const second = placeOverlay(input);
  assert.deepEqual(second, first);
  // 用第一次的结果当锚点再算，宽度不变（宽度只由内容与宿主决定，不依赖上一次的位置）。
  const after = placeOverlay({ ...input, natural: first.width, anchor: { left: first.left, right: first.left + 40 } });
  assert.equal(after.width, first.width);
});

test("place：负例——320px host 上不可能产出 390px 宽（M698 的越界读数）", () => {
  const p = placeOverlay(base({ tier: "list", host: 320, hostLeft: 0, natural: 391, anchor: { left: 120, right: 260 } }));
  assert.equal(p.width, 304);
  assert.ok(p.left + p.width <= 320 - 8);
});

test("place：非法读数不制造 NaN / 越界", () => {
  const p = placeOverlay({
    ...base(),
    natural: Number.NaN,
    host: Number.POSITIVE_INFINITY,
    fontSize: 0,
    anchor: { left: Number.NaN, right: Number.NaN },
  });
  assert.ok(Number.isFinite(p.width));
  assert.ok(Number.isFinite(p.left));
  assert.ok(p.width >= 0);
});
