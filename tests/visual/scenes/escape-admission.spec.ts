import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// Escape 的准入与层栈——**真实监听链**（change fix-escape-overlay-close-oct24 的 tasks 3.6）。
//
// 为什么必须有这一层（不以 `tests/unit/escape-router.test.ts` 代替）：
//   缺陷的 r1 现场不在纯逻辑层，而在**谁先跑**：各层的就地键处理器挂在自己的容器上，先于
//   window 上的兜底运行。只要某一处还留着「只看 `event.key === "Escape"` 就关层」的写法，
//   ⇧/⌘/⌃/⌥+Escape 与输入法组合期就会在兜底看到之前把层关掉——router 单测全绿也证明不了这条
//   链是对的（M718 r1 P1）。本场景因此驱动的是**真实 DOM + 真实装配**：`src/main.ts` 里装的
//   `installEscapeRouter`、`src/harness-panel.ts` 里挂的 seg / panel 监听、各浮层自己的
//   keydown 监听，全部照生产路径装配（Tauri 后端用 tauri-stub 打桩）。
//
// 判据组（对应设计 §5.1 的五条）：
//   ① 权限浮层持焦时 ⇧/⌘/⌃/⌥+Escape 各不关层、焦点不动；随后裸 Escape 才收起浮层并回焦 chip；
//   ② 向持焦项派发 `KeyboardEvent{ key:"Escape", isComposing:true }`（以及旧口径 keyCode 229）
//      不关层、不消费；
//   ③ 会话浮层的 **seg 监听器**重复 ①②（段在标题栏、不在 panel 子树里，是另一处现场）；
//   ④ effort 提示（不持焦的层）：Escape 只收提示，焦点与面板状态不变；
//   ⑤ 反向验证（人工执行，读数写在完工报告里）：把 panel / seg 监听改回字面判断 → ①②③ 必红。
//
// 另外两条同层的判据（层栈本身）：两层打开时一次只收栈顶；焦点在 `body`（无层）时兜底只消费
// 默认行为、不关层也不移焦点——这一条是缺陷「按 Esc 退出应用」的直接对照面。

const DOC = `# Escape 准入笔记

EADM-ALPHA 第一段，给编辑器一个可断言的读者位置。
EADM-BETA 第二段，全程逐字节不变。

| 列 | 值 |
| --- | --- |
| A | 1 |
| B | 2 |
`;

const VAULT: VaultFixture = {
  entries: [{ path: "escape-admission.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "escape-admission.md": DOC },
  links: {},
};

/**
 * `harness_state` / `harness_list_sessions` 的桩（叠在 tauri-stub 的通用路由之上）：
 *   - `thinking.supported = false` + 一个合法档位 ⇒ effort 读数置灰、hover 提示可打开（④ 的前提）；
 *   - 会话清单非空 ⇒ 会话浮层能真正揭示（③ 的前提；空清单按 O5 不揭示）。
 */
async function stubHarness(page: Page, opts: { configWrite?: "ok" | "fail" } = {}): Promise<void> {
  await page.addInitScript((spec) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
          thinking: { level: "high", supported: false },
        });
      }
      if (cmd === "harness_list_sessions") {
        return JSON.stringify([
          { session_id: "s1759912345678-k3x9ab", first_user_text: "帮我整理这份笔记", ts: 1759912345 },
        ]);
      }
      // 写回通道：成功路径与「写回失败回滚」路径都要能造（重建保焦的两条分支）。
      if (cmd === "config_set_value") {
        if (spec.configWrite === "fail") throw new Error("config_write_failed");
        return null;
      }
      return invoke(cmd, args);
    };
  }, opts);
}

/** 打开文档 + ⌘⇧A 开 harness pane（生产键位路径，不点 toggle 按钮——键位分发器也在被测链上）。 */
async function openPane(page: Page): Promise<void> {
  await page.locator('.ft-row[title="escape-admission.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("EADM-ALPHA");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-perm")).toBeVisible();
}

const permPop = (page: Page) => page.locator(".lumir-hp-permpop");
const permChip = (page: Page) => page.locator(".lumir-hp-perm");

/** 展开权限浮层并把焦点落到指定档位项上（真实 DOM 焦点，不是 AX 按下）。 */
async function focusPermItem(page: Page, id: string): Promise<void> {
  await permChip(page).click();
  await expect(permPop(page)).toBeVisible();
  const item = page.locator(`.lumir-hp-permpop-item[data-id="${id}"]`);
  await item.focus();
  await expect(item).toBeFocused();
}

/** 在**当前焦点元素**上派发一个可合成的 Escape（IME / 旧引擎的 keyCode 信号用它）。 */
async function dispatchEscape(
  page: Page,
  init: { isComposing?: boolean; keyCode?: number },
): Promise<boolean> {
  return page.evaluate((spec) => {
    const target = (document.activeElement ?? document.body) as HTMLElement;
    const ev = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      isComposing: spec.isComposing === true,
    });
    if (spec.keyCode !== undefined) {
      Object.defineProperty(ev, "keyCode", { get: () => spec.keyCode });
    }
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, init);
}

test("权限浮层：修饰键与组合期不关层，裸 Escape 只收浮层并回焦 chip", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openPane(page);
  await focusPermItem(page, "full_access");

  // ① 四个修饰键组合：浮层保持、焦点不动（就地处理器走共享准入）。
  for (const chord of ["Shift+Escape", "Meta+Escape", "Control+Escape", "Alt+Escape"]) {
    await page.keyboard.press(chord);
    await expect(permPop(page), `${chord} 不得关层`).toBeVisible();
    await expect(
      page.locator('.lumir-hp-permpop-item[data-id="full_access"]'),
      `${chord} 不得移动焦点`,
    ).toBeFocused();
    await expect(page.locator(".lumir-harness"), `${chord} 不得收面板`).toBeVisible();
  }

  // ② 输入法组合期：不关层、不消费（默认行为留给输入法取消组合）。
  expect(await dispatchEscape(page, { isComposing: true }), "组合期不 preventDefault").toBe(false);
  await expect(permPop(page)).toBeVisible();
  await expect(page.locator('.lumir-hp-permpop-item[data-id="full_access"]')).toBeFocused();
  // 旧引擎口径的 keyCode 229 同样归输入法。
  expect(await dispatchEscape(page, { keyCode: 229 }), "keyCode 229 不 preventDefault").toBe(false);
  await expect(permPop(page)).toBeVisible();

  // 裸 Escape：这一拍才收浮层，且焦点回到触发钮（不是 body）。
  await page.keyboard.press("Escape");
  await expect(permPop(page)).toBeHidden();
  await expect(permChip(page)).toBeFocused();
  await expect(page.locator(".lumir-harness")).toBeVisible();
});

test("会话浮层：seg 监听器与权限浮层同一份准入（修饰键 / 组合期 / 裸 Escape）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openPane(page);

  const sess = page.locator(".lumir-hp-sesspop");
  const sessionButton = page.locator(".lumir-hp-session");
  await sessionButton.click();
  await expect(sess).toBeVisible();
  await expect(sessionButton).toBeFocused();

  for (const chord of ["Shift+Escape", "Meta+Escape", "Control+Escape", "Alt+Escape"]) {
    await page.keyboard.press(chord);
    await expect(sess, `${chord} 不得关会话浮层`).toBeVisible();
    await expect(sessionButton, `${chord} 不得移动焦点`).toBeFocused();
  }
  expect(await dispatchEscape(page, { isComposing: true }), "组合期不 preventDefault").toBe(false);
  await expect(sess).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sess).toBeHidden();
  await expect(sessionButton).toBeFocused();
  await expect(page.locator(".lumir-harness")).toBeVisible();
});

test("effort 提示：Escape 只收提示，焦点与面板状态不变", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openPane(page);

  const eff = page.locator(".lumir-hp-eff-reading");
  const hint = page.locator(".lumir-hp-effhint");
  await expect(eff).toHaveClass(/is-disabled/);
  await page.locator(".cm-content").click(); // 焦点回编辑器：提示是 hover 面，不该由它夺焦
  await eff.hover();
  await expect(hint).toBeVisible();
  await expect(page.locator(".cm-content")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(hint).toBeHidden();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.locator(".cm-content").blur();
  await expect(page.locator(".cm-content")).not.toBeFocused();
});

test("层栈：两层打开时一次只收栈顶；焦点在 body 且无层时只消费默认行为", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openPane(page);

  // 两层：面板 + 权限浮层。第一拍只收浮层。
  await focusPermItem(page, "vault_write");
  await page.keyboard.press("Escape");
  await expect(permPop(page)).toBeHidden();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  // 第二拍才收面板（栈顶变成面板本体）。
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-harness")).toBeHidden();

  // 无层 + 焦点在 body：兜底只消费默认行为（缺陷「按 Esc 退出应用」的直接对照面）。
  await page.locator(".cm-content").click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  const reading = await page.evaluate(() => {
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented, active: document.activeElement?.tagName ?? "" };
  });
  expect(reading.prevented, "无层时兜底 MUST 消费默认行为（挡原生关窗）").toBe(true);
  expect(reading.active, "消费不等于产品动作：焦点仍在 body，不被移动").toBe("BODY");
  // 文档与面板都没被这一拍改动。
  await expect(page.locator(".cm-content")).toContainText("EADM-ALPHA");
  await expect(page.locator(".lumir-harness")).toBeHidden();
});

test("⌘P 快速打开：修饰键不关层，裸 Escape 收层并把焦点交还编辑器", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await page.locator('.ft-row[title="escape-admission.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("EADM-ALPHA");
  await page.locator(".cm-content").click();

  const qo = page.locator(".lumir-qo");
  await page.keyboard.press("Meta+p");
  await expect(qo).toBeVisible();

  await page.keyboard.press("Shift+Escape");
  await expect(qo, "⇧Escape 不得关快速打开浮层").toBeVisible();
  expect(await dispatchEscape(page, { isComposing: true })).toBe(false);
  await expect(qo).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(qo).toBeHidden();
  // 关闭后焦点交还编辑器（各层既有回还口径；未持焦件被摘除时也不会落到 body）。
  await expect(page.locator(".cm-content")).toBeFocused();
});

test("重建保焦：点选一档后重建，焦点仍落在同一语义项（真实点击，不是 DOM focus）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openPane(page);

  const item = (id: string) => page.locator(`.lumir-hp-permpop-item[data-id="${id}"]`);
  await permChip(page).click();
  await expect(permPop(page)).toBeVisible();
  await item("full_access").click();
  // 重建后：新选中项仍在、且焦点落在它上面（不是 body、不是 chip）。
  // 这一步判的是「重建窗口内焦点不丢」——持焦项被摘除时引擎的焦点修复会把它送回 body
  //（docs/specs/overlay-visibility.md O6 的两个引擎分叉），实现必须先把焦点停到不重建的容器上。
  await expect(item("full_access")).toHaveAttribute("aria-checked", "true");
  await expect(item("full_access")).toBeFocused();
  await expect(permPop(page)).toBeVisible();
});

test("重建保焦：写回失败回滚后，焦点落在回滚项（不是失败的新项、不是 body）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page, { configWrite: "fail" });
  await page.goto("/");
  await openPane(page);

  const item = (id: string) => page.locator(`.lumir-hp-permpop-item[data-id="${id}"]`);
  await permChip(page).click();
  await expect(permPop(page)).toBeVisible();
  // 默认档 vault_write → 点 full_access → 写回失败 → 回滚到 vault_write 并重建。
  await item("full_access").click();
  await expect(item("full_access")).toHaveAttribute("aria-checked", "false");
  await expect(item("vault_write")).toHaveAttribute("aria-checked", "true");
  await expect(item("vault_write")).toBeFocused();
  await expect(permPop(page)).toBeVisible();
});

test("同一条路由：已被上游消费的 Escape 不关层（组件就地处理器与 harness 面板同口径）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");

  // 模拟「更靠近事件目标的处理器已经消费了这一拍」：window **capture** 阶段的监听先于任何容器
  // 冒泡处理运行，`defaultPrevented` 因此在我们测的两条入口看到事件之前就是 true。这正是
  // M718 r1 P1-1 的现场——修复前非 harness 的就地入口不看这个标志，照样把容器层关掉。
  const consumeNextKeydown = async (): Promise<void> => {
    await page.evaluate(() => {
      window.addEventListener(
        "keydown",
        (event) => {
          event.preventDefault();
        },
        { capture: true, once: true },
      );
    });
  };

  // ① 组件就地路径（⌘P 快速打开，它的 keydown 监听）：已消费 → 不关；再按一次（没人消费）→ 关。
  await page.locator('.ft-row[title="escape-admission.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("EADM-ALPHA");
  await page.locator(".cm-content").click();
  const qo = page.locator(".lumir-qo");
  await page.keyboard.press("Meta+p");
  await expect(qo).toBeVisible();
  await consumeNextKeydown();
  await page.keyboard.press("Escape");
  await expect(qo, "已被上游消费的 Escape MUST NOT 关层（就地入口要让路）").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(qo, "没人消费时同一拍才关层（正向对照，证明上一条不是恒真）").toBeHidden();

  // ② harness 面板自己的监听（权限浮层）：同一条 `escapeRouter.handle`，语义一致。
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await focusPermItem(page, "full_access");
  await consumeNextKeydown();
  await page.keyboard.press("Escape");
  await expect(permPop(page), "已消费的 Escape 不得关浮层").toBeVisible();
  await expect(page.locator('.lumir-hp-permpop-item[data-id="full_access"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(permPop(page)).toBeHidden();
  await expect(permChip(page)).toBeFocused();
});

test("就地路径按打开序关栈顶：⌘P 先开、后开的 hover 提示才被第一拍收掉", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openPane(page);

  const qo = page.locator(".lumir-qo");
  const hint = page.locator(".lumir-hp-effhint");
  const ctxPop = page.locator(".lumir-hp-ctxpop");
  const qoInput = page.locator(".lumir-qo-input");

  // 打开序 = 栈序：面板（已在场）→ ⌘P → 不持焦的 hover 提示。焦点始终在 ⌘P 的输入框里。
  await page.keyboard.press("Meta+p");
  await expect(qo).toBeVisible();
  await expect(qoInput).toBeFocused();
  await page.locator(".lumir-hp-eff-reading").hover();
  await expect(hint).toBeVisible();

  // 第一拍：只收**后开**的提示；⌘P 与焦点都不动（M718 r2 P1-1 的缺陷形态：这一拍会收掉 ⌘P）。
  await page.keyboard.press("Escape");
  await expect(hint, "第一拍只收后开的 effort 提示").toBeHidden();
  await expect(qo, "先开的 ⌘P 必须保持打开").toBeVisible();
  await expect(qoInput, "这一拍不移动焦点").toBeFocused();

  // 第二拍：栈顶变成 ⌘P，才收它。
  await page.keyboard.press("Escape");
  await expect(qo, "第二拍才收 ⌘P").toBeHidden();

  // Context hover 泡同形（同一份登记与同一条就地路径，换一个不持焦的层）。
  await page.keyboard.press("Meta+p");
  await expect(qo).toBeVisible();
  await page.locator(".lumir-hp-ctx").hover();
  await expect(ctxPop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ctxPop, "第一拍只收后开的 Context 泡").toBeHidden();
  await expect(qo).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(qo).toBeHidden();
});

test("widget 持焦 + 后开 hover 层：第一拍只收层且焦点不动；无层时既有的交还照旧", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await page.locator('.ft-row[title="escape-admission.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("EADM-ALPHA");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();

  const hint = page.locator(".lumir-hp-effhint");
  const ctxPop = page.locator(".lumir-hp-ctxpop");
  const container = page.locator(".cm-lp-block-scroll").first();

  /** 把焦点交给表格的块级横滚容器：点进表格（caret 进块）→ 生产键位 ⌃⌥S。 */
  const focusWidget = async (): Promise<void> => {
    await page.locator(".cm-lp-table").first().click();
    await page.keyboard.press("Control+Alt+s");
    await expect(container, "容器自身持焦（widget 的既有 Escape 归属前提）").toBeFocused();
  };

  await focusWidget();

  // ① widget 持焦 + 后开的 effort 提示：第一拍只收提示，**焦点不动**。
  //    修复前：keymap 的 editor.widget-escape 先命中并 preventDefault，焦点被交还编辑器、提示不收。
  await page.locator(".lumir-hp-eff-reading").hover();
  await expect(hint).toBeVisible();
  await expect(container).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(hint, "第一拍只收后开的提示").toBeHidden();
  await expect(container, "关 hover 层 MUST NOT 移动焦点").toBeFocused();

  // ② Context 泡同形。
  await page.locator(".lumir-hp-ctx").hover();
  await expect(ctxPop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ctxPop, "第一拍只收后开的 Context 泡").toBeHidden();
  await expect(container).toBeFocused();

  // ③ 无层对照：收起面板（它自己的关闭路径会按既有口径交还编辑器）后重新把焦点交给容器，
  //    这一拍没有层 ⇒ `editor.widget-escape` 的既有「交还编辑器」照旧。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeHidden();
  await focusWidget();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-content"), "无层时既有归属不变：焦点交还编辑器").toBeFocused();
});

test("键位面板：已消费的 Escape 不跑级联（面板栈顶 / 后开 hover 栈顶两条反例 + 未消费对照）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await page.locator('.ft-row[title="escape-admission.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("EADM-ALPHA");
  // harness 面板在场，才有「不持焦的 hover 层」可以后开到键位面板之上。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();

  const panel = page.locator(".lumir-bindings-panel");
  const input = page.locator(".lumir-bindings-input");
  const hint = page.locator(".lumir-hp-effhint");

  await page.keyboard.press("Meta+/");
  await expect(panel).toBeVisible();
  await input.fill("撤");
  await expect(input).toHaveValue("撤");

  /** 模拟「更靠近事件目标的处理器已经消费了这一拍」：window capture 阶段先 preventDefault。 */
  const consumeNextKeydown = async (): Promise<void> => {
    await page.evaluate(() => {
      window.addEventListener(
        "keydown",
        (event) => {
          event.preventDefault();
        },
        { capture: true, once: true },
      );
    });
  };

  // ① 面板自身是栈顶：已消费的 Escape MUST NOT 清查询 / 关面板（rebase-r1 P1-1 的现场之一）。
  await consumeNextKeydown();
  await page.keyboard.press("Escape");
  await expect(input, "已消费的 Escape MUST NOT 清查询").toHaveValue("撤");
  await expect(panel).toBeVisible();

  // ② 后开的不持焦 hover 层为栈顶：已消费的 Escape 既不收栈顶、也不落下清面板查询
  //    （另一处现场：`handle()` 因已消费返回 false 不能当成「继续级联」的许可）。
  //    面板是模态遮罩，真实指针到不了面板外的读数，这里直接派发 `mouseenter`——本判据要的是
  //    「层栈分流 + 已消费让路」，hover 通道本身归第 3 条用例。
  await page.locator(".lumir-hp-eff-reading").dispatchEvent("mouseenter");
  await expect(hint).toBeVisible();
  await consumeNextKeydown();
  await page.keyboard.press("Escape");
  await expect(hint, "已消费的 Escape 不得收栈顶 hover").toBeVisible();
  await expect(input, "也不得清面板查询").toHaveValue("撤");
  await expect(panel).toBeVisible();

  // ③ 未消费正向对照：第一拍只收 hover（面板级联不动），第二拍清查询，第三拍关面板。
  await page.keyboard.press("Escape");
  await expect(hint, "未消费时第一拍只收后开的 hover").toBeHidden();
  await expect(input, "第一拍不清查询").toHaveValue("撤");
  await page.keyboard.press("Escape");
  await expect(input, "第二拍清查询").toHaveValue("");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel, "第三拍关面板").toBeHidden();
});
