import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";

// vault 切换器行级活动标记的**结构**场景（change extend-harness-activity-across-vaults-nov23
// tasks 1.4 / design §14.5）。判据只做结构 / 计算属性断言，**不新增整页像素基线**（基线新增
// 是人肉裁决点，见 tests/visual/README.md「新增场景」第 5 条）：6×6 的标记远小于整页容差预算
// （1200×800×0.001 ≈ 960 px），像素对比对它没有区分度。
//
// 判据分五组：
//   1. 非当前行三态形状可判（`data-activity` + 计算样式：border / background / box-shadow）；
//   2. 标记矩形完全落在切换钮矩形内、不与移除钮相交（键盘 / 鼠标落点不变）；
//   3. 当前行无标记、空闲行无标记节点（零新增像素）+ 空闲行宽度与改动前一致（不预留占位）；
//   4. 三主题下靠形状可分（eink 不依赖颜色，`--accent` / `--danger` 恒 #000）；
//   5. 浮层关闭后标记不可见（无浮层外节点）。

const DOC = "# 行标记\n\n第一段，给面板一个可开的文档。\n";
const A_ROOT = "/tmp/lumir-row-activity-a";
const B_ROOT = "/tmp/lumir-row-activity-b";

const REGISTRY: VaultListRow[] = [
  { id: "row-a", path: A_ROOT, name: "row-a", available: true, last_opened_at: 1757000002000, tab_count: 0 },
  { id: "row-b", path: B_ROOT, name: "row-b", available: true, last_opened_at: 1757000001000, tab_count: 0 },
];

const VAULT: VaultFixture & { root: string } = {
  root: A_ROOT,
  vault_id: "row-a",
  entries: [{ path: "row-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "row-note.md": DOC },
  links: {},
  vaults: REGISTRY,
};

/** 只补 `harness_state` 与事件注入通道（活动记录由事件驱动，本场景不切 vault）。 */
async function stubRows(page: Page): Promise<void> {
  await page.addInitScript((root: string) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [] as number[];
    w.__root = root;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          vault: w.__root,
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0, has_usage: false },
          in_flight: false,
          pending_approvals: [],
          warn_ctx_pct: 85,
          thinking: { level: "high", supported: true },
        });
      }
      if (cmd === "harness_send" || cmd === "harness_abort" || cmd === "harness_new_session") {
        return null;
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if ((cmd === "vault_open" || cmd === "vault_open_path") && result?.root) w.__root = result.root;
      return result;
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  }, A_ROOT);
}

async function fire(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (body) => (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(body),
    payload,
  );
}

/** B 行（非当前）的标记计算样式与几何。 */
async function rowActivity(page: Page, vaultId: string) {
  return page.evaluate((id: string) => {
    const row = document.querySelector(`.vault-row[data-vault="${id}"]`) as HTMLElement | null;
    if (row === null) return null;
    const marker = row.querySelector(".vault-row-activity") as HTMLElement | null;
    if (marker === null) {
      return { kind: null, title: row.title, text: row.textContent ?? "", hasTitleAttr: row.hasAttribute("title") };
    }
    const style = getComputedStyle(marker);
    const r = marker.getBoundingClientRect();
    const b = row.getBoundingClientRect();
    const del = row.parentElement?.querySelector(".vault-row-del")?.getBoundingClientRect() ?? null;
    return {
      kind: marker.dataset.activity ?? null,
      title: row.title,
      hasTitleAttr: row.hasAttribute("title"),
      text: marker.textContent ?? "",
      ariaHidden: marker.getAttribute("aria-hidden"),
      styles: {
        width: r.width,
        height: r.height,
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        boxShadow: style.boxShadow,
        pointerEvents: style.pointerEvents,
      },
      geometry: {
        inside:
          r.left >= b.left - 0.5 &&
          r.top >= b.top - 0.5 &&
          r.right <= b.right + 0.5 &&
          r.bottom <= b.bottom + 0.5,
        // 与移除钮不相交（移除钮是 wrap 的兄弟，标记在切换钮内）
        overlapsDelete:
          del !== null &&
          r.right > del.left &&
          r.left < del.right &&
          r.bottom > del.top &&
          r.top < del.bottom,
        rightGapToRow: b.right - r.right,
      },
    };
  }, vaultId);
}

async function openSwitcher(page: Page): Promise<void> {
  await page.locator(".ft-vault").click();
  await expect(page.locator(".vault-pop")).toBeVisible();
  await expect(page.locator(".vault-row")).toHaveCount(2);
}

test("行标记：三态形状 / 落在切换钮内且不压移除钮 / 当前行与空闲行零节点", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubRows(page);
  await page.goto("/");
  await page.locator('.ft-row[title="row-note.md"]').click();

  // 空闲：两行都没有标记节点、没有 title（不预留占位宽度）。
  await openSwitcher(page);
  const idleB = await rowActivity(page, "row-b");
  expect(idleB).not.toBeNull();
  expect(idleB!.kind).toBeNull();
  expect(idleB!.hasTitleAttr).toBe(false);
  // 空闲行宽度：记下当前宽度，下面有态时只允许「名称省略号提前 ≤12px」的收缩，
  // 不允许整行位移或宽度变化（行宽由 CSS 决定，标记是 flex 项、不吃固定槽位）。
  const idleRowWidth = await page
    .locator('.vault-row[data-vault="row-b"]')
    .evaluate((el) => el.getBoundingClientRect().width);

  // 在途：空心环（有描边、无填充、无外环）。
  await fire(page, { type: "auto_turn_started", vault: B_ROOT });
  const inflight = await rowActivity(page, "row-b");
  if (inflight === null || inflight.styles === undefined) throw new Error("行标记没有渲染");
  expect(inflight.kind).toBe("inflight");
  expect(inflight.text).toBe("");
  expect(inflight.ariaHidden).toBe("true");
  expect(inflight.title).toBe("row-b · 处理中");
  expect(inflight.styles!.width).toBe(6);
  expect(inflight.styles!.height).toBe(6);
  expect(inflight.styles!.pointerEvents).toBe("none");
  expect(inflight.styles!.borderStyle).toBe("solid");
  expect(Number.parseFloat(inflight.styles!.borderWidth)).toBeGreaterThan(0);
  expect(inflight.styles!.background).toBe("rgba(0, 0, 0, 0)");
  expect(inflight.styles!.boxShadow).toBe("none");
  expect(inflight.geometry!.inside).toBe(true);
  expect(inflight.geometry!.overlapsDelete).toBe(false);
  expect(inflight.geometry!.rightGapToRow).toBeGreaterThan(0);
  const activeRowWidth = await page
    .locator('.vault-row[data-vault="row-b"]')
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(activeRowWidth - idleRowWidth)).toBeLessThanOrEqual(0.5);

  // 未读回复：实心点（无描边、无外环）。
  await fire(page, { type: "done", vault: B_ROOT });
  const reply = await rowActivity(page, "row-b");
  if (reply === null || reply.styles === undefined) throw new Error("回复档标记没有渲染");
  expect(reply.kind).toBe("reply");
  expect(reply.title).toBe("row-b · 有新的回复");
  expect(reply.styles!.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(reply.styles!.borderWidth)).toBe(0);
  expect(reply.styles!.boxShadow).toBe("none");

  // 未读失败：实心点 + 外环（与回复档形状可分，不单靠颜色）。
  await fire(page, { type: "auto_turn_started", vault: B_ROOT });
  await fire(page, { type: "error", code: "llm_upstream", message: "上游炸了", vault: B_ROOT });
  const failure = await rowActivity(page, "row-b");
  if (failure === null || failure.styles === undefined) throw new Error("失败档标记没有渲染");
  expect(failure.kind).toBe("failure");
  expect(failure.title).toBe("row-b · 有失败结果");
  expect(failure.styles!.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(failure.styles!.boxShadow).toContain("rgb(");
  expect(failure.geometry!.inside).toBe(true);
  expect(failure.geometry!.overlapsDelete).toBe(false);

  // 当前行永不建标记：给当前 vault（A）也造一个未读，行上仍零节点。
  await fire(page, { type: "done", vault: A_ROOT });
  const currentA = await rowActivity(page, "row-a");
  expect(currentA!.kind).toBeNull();
  expect(currentA!.hasTitleAttr).toBe(false);

  // 浮层关闭后不可见：标记节点随浮层一起隐藏（无浮层外节点）。
  await page.keyboard.press("Escape");
  await expect(page.locator(".vault-pop")).toBeHidden();
  await expect(page.locator(".vault-row-activity")).toBeHidden();
  // 行 DOM 留在浮层容器内（每次打开重建），浮层隐藏即不可见——MUST NOT 有浮层外的常驻节点。
  await expect(page.locator(".vault-row").first()).not.toBeVisible();
});

test("行标记：三主题下靠形状可分（eink 不依赖颜色）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubRows(page);
  await page.goto("/");
  await page.locator('.ft-row[title="row-note.md"]').click();
  // 三态各来一轮，最后停在失败档；再逐个主题读同一节点的形状。
  await openSwitcher(page);
  await fire(page, { type: "auto_turn_started", vault: B_ROOT });
  await fire(page, { type: "done", vault: B_ROOT });
  const replyShape = await rowActivity(page, "row-b");
  if (replyShape === null || replyShape.styles === undefined) throw new Error("回复档标记没有渲染");

  // 主题是 `<html data-theme>` 上的 CSS 输入（配置通道 → 该属性由 scope 外的场景覆盖；
  // 本场景判的是同一属性下的计算样式）。
  const shapes: Record<string, { background: string; borderWidth: string; boxShadow: string }> = {};
  for (const theme of ["light", "dark", "eink"]) {
    await page.evaluate((value: string) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const state = await rowActivity(page, "row-b");
    if (state === null || state.styles === undefined) throw new Error(`主题 ${theme} 下没有标记`);
    shapes[theme] = {
      background: state.styles.background,
      borderWidth: state.styles.borderWidth,
      boxShadow: state.styles.boxShadow,
    };
    // 回复档在每一主题下都是「实心点、无环」——形状不随主题变。
    expect(state.kind).toBe("reply");
    expect(state.styles.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(Number.parseFloat(state.styles.borderWidth)).toBe(0);
  }
  // eink：颜色退化为 #000（形状仍是唯一区分手段）。
  expect(shapes.eink.background).toBe("rgb(0, 0, 0)");
  expect(replyShape.styles!.background).not.toBe("rgba(0, 0, 0, 0)");

  // eink + 在途：空心环仍与实心点可分（描边提实为正文色）。
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "eink";
  });
  await fire(page, { type: "auto_turn_started", vault: B_ROOT });
  const inflightEink = await rowActivity(page, "row-b");
  if (inflightEink === null || inflightEink.styles === undefined) throw new Error("eink 在途标记没有渲染");
  expect(inflightEink.kind).toBe("inflight");
  expect(inflightEink.styles.borderStyle).toBe("solid");
  expect(Number.parseFloat(inflightEink.styles.borderWidth)).toBeGreaterThan(0);
  expect(inflightEink.styles.background).toBe("rgba(0, 0, 0, 0)");
});
