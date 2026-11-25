import { test } from "node:test";
import assert from "node:assert/strict";
import { revealScrollTop } from "../../src/selector-reveal.ts";

// 合同：docs/specs/selector-contract.md C3（最小揭示）。纯函数只认坐标，不碰 DOM。
// 坐标口径：scrollTop / itemTop 在滚动内容坐标系里；band 是**真实可见带相对滚动口的内缩量**
// （菜单矩形 ∩ 面板矩形 ∩ 视口，再扣掉滚动容器的边框与 padding），不是滚动容器自身高度。
const ROW = 20;

function reveal(over: Partial<Parameters<typeof revealScrollTop>[0]> = {}): number {
  return revealScrollTop({
    scrollTop: 0,
    scrollHeight: 400,
    clientHeight: 120,
    band: { top: 0, bottom: 120 },
    itemTop: 0,
    itemHeight: ROW,
    ...over,
  });
}

test("完整可见时 scrollTop 必须不动（含贴上、贴下两个边界）", () => {
  for (const itemTop of [0, 40, 100]) {
    assert.equal(reveal({ itemTop }), 0, `itemTop=${itemTop}`);
  }
  // 带底项：itemBottom 恰等于可见带底仍算完整可见
  assert.equal(reveal({ itemTop: 100, itemHeight: 20 }), 0);
  // 中部窗口：滚动位置已非零，带内移动同样不动
  assert.equal(reveal({ scrollTop: 60, itemTop: 100 }), 60);
});

test("下方越界：滚到带底再留一行上下文", () => {
  // 贴上带底仍算完整可见
  assert.equal(reveal({ itemTop: 100 }), 0);
  // 下一项整体在带外：新 scrollTop = itemBottom − 带底 + 一行
  assert.equal(reveal({ itemTop: 120 }), 40);
  // 下缘部分可见（露出 0px）：同样按「带底留一行」而非最小位移
  assert.equal(reveal({ itemTop: 100.5 }), 20.5);
  // 完全在带外
  assert.equal(reveal({ itemTop: 300 }), 220);
});

test("上方越界：滚到带顶再留一行上下文", () => {
  assert.equal(reveal({ scrollTop: 100, itemTop: 40 }), 20);
  // 上缘部分可见：item 90..110，可见带从内容坐标 100 开始 → 目标 itemTop = 120
  assert.equal(reveal({ scrollTop: 100, itemTop: 90 }), 70);
  // 可见带顶有内缩（面板 / 视口裁切）时按内缩量算
  assert.equal(reveal({ scrollTop: 100, band: { top: 8, bottom: 120 }, itemTop: 100 }), 72);
});

test("首尾自然 clamp：不产生负 scrollTop，也不越过最大滚动量", () => {
  assert.equal(reveal({ scrollTop: 4, itemTop: 0 }), 0);
  // scrollHeight 400 − clientHeight 120 = 280 是上界
  assert.equal(reveal({ scrollTop: 270, itemTop: 380 }), 280);
});

test("带高与余量的边界：≥2 行留满一行，1–2 行用尽剩余空间，≤1 行取 0", () => {
  // 带高恰好 2 行：目标贴底时，目标与带底之间保留整一行上下文
  assert.equal(reveal({ band: { top: 0, bottom: 40 }, itemTop: 40 }), 40);
  // 带高 2.2 行：仍留满一行，不按对称居中缩成半行
  assert.equal(reveal({ band: { top: 0, bottom: 44 }, itemTop: 44 }), 40);
  // 带高 1.5 行：无法留满一行，剩余空间（半行）全部留给上下文
  assert.equal(reveal({ band: { top: 0, bottom: 30 }, itemTop: 30 }), 30);
  // 带高 1.2 行：剩余 0.2 行
  assert.equal(reveal({ band: { top: 0, bottom: 24 }, itemTop: 24 }), 24);
  // 带高 1 行：无余量可留，目标贴边
  assert.equal(reveal({ band: { top: 0, bottom: 20 }, itemTop: 20 }), 20);
  // 上方越界的同一组边界
  assert.equal(reveal({ scrollTop: 40, band: { top: 0, bottom: 40 }, itemTop: 20 }), 0);
  assert.equal(reveal({ scrollTop: 30, band: { top: 0, bottom: 30 }, itemTop: 20 }), 10);
  // 带比一行还窄时丢弃上下文余量，只保证贴边
  assert.equal(reveal({ band: { top: 8, bottom: 28 }, itemTop: 8, itemHeight: 20 }), 0);
  assert.equal(reveal({ band: { top: 8, bottom: 28 }, itemTop: 28 }), 20);
});

test("目标比可视带还高时对齐上缘，不制造无法满足的断言", () => {
  assert.equal(reveal({ band: { top: 0, bottom: 40 }, itemTop: 60, itemHeight: 80 }), 60);
});

test("亚像素坐标不被取整丢失", () => {
  const next = reveal({ itemTop: 130.5, itemHeight: 19.5 });
  assert.ok(Math.abs(next - 49.5) < 1e-9, String(next));
  assert.equal(reveal({ itemTop: 40.25 }), 0);
});

test("属性矩阵：任意带内位置 × 任意滚动位置都满足不变量", () => {
  const scrollHeight = 1000;
  const clientHeight = 120;
  const maxScroll = scrollHeight - clientHeight;
  for (const scrollTop of [0, 7.5, 60, 200, maxScroll]) {
    for (const bandTop of [0, 10]) {
      for (const bandBottom of [80, 120]) {
        for (let index = 0; index < 30; index += 1) {
          const itemTop = index * ROW;
          const itemHeight = ROW;
          const band = { top: bandTop, bottom: bandBottom };
          const next = revealScrollTop({
            scrollTop,
            scrollHeight,
            clientHeight,
            band,
            itemTop,
            itemHeight,
          });
          const visibleTop = scrollTop + band.top;
          const visibleBottom = scrollTop + band.bottom;
          const label = `scrollTop=${scrollTop} band=${bandTop}..${bandBottom} item=${itemTop}`;
          assert.ok(next >= 0 && next <= maxScroll, `${label} 越出滚动范围：${next}`);
          if (itemTop >= visibleTop && itemTop + itemHeight <= visibleBottom) {
            assert.equal(next, scrollTop, `${label} 可见时必须不动`);
          }
          if (next > 0 && next < maxScroll) {
            assert.ok(
              itemTop >= next + band.top - 1e-9 && itemTop + itemHeight <= next + band.bottom + 1e-9,
              `${label} 滚动后目标仍未完整落在可见带内（${itemTop}..${itemTop + itemHeight} vs ${next + band.top}..${next + band.bottom}）`,
            );
          }
        }
      }
    }
  }
});
