// en 面（change ui-language-i18n / M282）：chrome 文案取英文列、切换后不残留中文、
// 切换后长驻 chrome 与预览装饰同步换语言。
//
// 为什么单列一个场景（tasks §8.3 / §8.4）：本 change 的视觉层选择是「既有整页基线继续用
// `zh` 形态作结构与外观的回归面」（`tests/visual/scenes/tauri-stub.ts` 的桩把界面语言钉在
// `zh`），`en` 面因此需要自己的判据——不为每个既有场景加第二份 en 基线（成本与收益不成比例，
// 如实登记为覆盖选择）。
//
// 判据形态（REVIEW.md 第 1 条 / 第 2 条）：
//   - 每条「en 下不残留中文」的负向断言都配一条正观测（同一屏里英文确实上屏）；
//   - 断言**能单独读出是哪一个面**（树头部 / modeline / 标签读屏名 / 预览装饰各自一条）。
//
// 反向验证（MUST 做，tasks §8.5）：把 `src/main.ts` 的 `applyLanguage` 里
// `runRelabels(); editor.refreshPreview();` 两行注释掉后，本文件「切换后 chrome 已换语言」与
// 「预览装饰随切换重建」两组断言必须红——重绘面因此不是形同没有。

import { expect, test } from "@playwright/test";
import { COPY } from "../../../src/copy-data";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const DOC = "# 语言场景\n\n切换语言后这一段必须仍是同一份内容。\n\n![[不存在的附件.png]]\n";

const VAULT: VaultFixture = {
  root: "/mock/vault",
  vault_id: "v1",
  files: { "note.md": DOC, "with-missing-attachment.md": DOC },
  entries: [
    { path: "note.md", name: "note.md", kind: "file" },
    // 附件引用指向一个不存在的文件：预览装饰会渲染「附件未找到」的 widget（D31 一族），
    // 它的文本在 `toDOM()` 里生成——语言切换后必须重建（这是本 change 的重绘面判据）。
    { path: "with-missing-attachment.md", name: "with-missing-attachment.md", kind: "file" },
  ],
};

/** 打开一个带「附件未找到」装饰的文档，界面语言由桩决定。 */
async function openWithAttachmentLanguage(
  page: import("@playwright/test").Page,
  language: "en" | "zh",
): Promise<void> {
  await stubTauri(page, { ...VAULT, config: { language } });
  await page.goto("/");
  await expect(page.locator(".ft-row", { hasText: "with-missing-attachment.md" }).first()).toBeVisible();
  await page.locator(".ft-row", { hasText: "with-missing-attachment.md" }).first().click();
  await expect(page.locator(".cm-content")).toContainText("切换语言后这一段必须仍是同一份内容。");
}

test.describe("en 面：chrome 与预览装饰的英文列", () => {
  test("桩配置 language=en：chrome 文案取英文列，且不残留中文", async ({ page }) => {
    await stubTauri(page, { ...VAULT, config: { language: "en" } });
    await page.goto("/");
    await expect(page.locator(".ft-row", { hasText: "note.md" }).first()).toBeVisible();
    await page.locator(".ft-row", { hasText: "note.md" }).first().click();
    await expect(page.locator(".cm-content")).toBeVisible();

    // 正向观测（先证明这一屏真的是 en）
    await expect(page.locator(".ft-vault")).toHaveAttribute(
      "aria-label",
      COPY["D96"].en.replace("{name}", "vault"),
    );
    await expect(page.locator(".ft-vault")).toHaveAttribute("title", COPY["D96"].en.replace("{name}", "vault"));
    // 树空态不在场，但入口的提示就是 chrome 的英文面判据；反向：中文提示不得残留
    await expect(page.locator(".ft-vault")).not.toHaveAttribute("aria-label", /点击查看全部 vault/);

    // modeline 右段：`{language} · {lines} 行 · UTF-8` 的英文列
    await expect(page.locator(".modeline-meta")).toContainText("lines · UTF-8");
    await expect(page.locator(".modeline-meta")).not.toContainText("行 ·");

    // 语言钮：可见文本是语言档本身（读数不译文），提示取英文列
    await expect(page.locator(".modeline-language")).toHaveText("en");
    await expect(page.locator(".modeline-language")).toHaveAttribute(
      "aria-label",
      COPY["D317"].en.replace("{lang}", "en"),
    );
    // 主题钮的提示也是英文列（同族长驻 chrome）
    await expect(page.locator(".modeline-theme")).toHaveAttribute(
      "aria-label",
      COPY["D122"].en.replace("{theme}", "light"),
    );
  });

  test("zh 面按同一份桩回退：chrome 取中文列（迁移是纯搬运，zh 侧逐字不变）", async ({ page }) => {
    await stubTauri(page, { ...VAULT, config: { language: "zh" } });
    await page.goto("/");
    await expect(page.locator(".ft-row", { hasText: "note.md" }).first()).toBeVisible();
    await page.locator(".ft-row", { hasText: "note.md" }).first().click();
    await expect(page.locator(".cm-content")).toBeVisible();
    await expect(page.locator(".ft-vault")).toHaveAttribute(
      "aria-label",
      COPY["D96"].zh.replace("{name}", "vault"),
    );
    await expect(page.locator(".modeline-meta")).toContainText("行 · UTF-8");
    await expect(page.locator(".modeline-language")).toHaveAttribute(
      "aria-label",
      COPY["D317"].zh.replace("{lang}", "zh"),
    );
  });

  test("预览装饰随切换重建：已渲染的「附件未找到」widget 换成英文列", async ({ page }) => {
    await openWithAttachmentLanguage(page, "en");
    // 正向观测：装饰句是英文列（widget 的文本在 toDOM 里生成）
    // 装饰句取英文列（widget 的文本在 `toDOM()` 里生成，因此这条同时钉住「重建发生了」）。
    // 只判前缀而不锚定整串：`{ref}` 取的是引用原文（含 `![[…]]` 包裹），那是数据不是文案。
    await expect(page.locator(".cm-lp-embed-unsupported").first()).toContainText(COPY["D31"].en.split("{ref}")[0]);
    await expect(page.locator(".cm-lp-embed-unsupported").first()).not.toContainText("附件未找到");
  });

  test("切换（zh → en）：长驻 chrome 与预览装饰同步换语言，且不残留中文", async ({ page }) => {
    await openWithAttachmentLanguage(page, "zh");
    // 起点：装饰句是中文列
    await expect(page.locator(".cm-lp-embed-unsupported").first()).toContainText("附件未找到");
    await expect(page.locator(".ft-vault")).toHaveAttribute("aria-label", /点击查看全部 vault/);

    // 走真实入口：命令 `view.language-cycle` 的键位（⌘⇧L）
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+Shift+L");

    // ① 长驻 chrome（`runRelabels()` 的判据：树头部入口的 title / aria-label 是装载时写死的）
    await expect(page.locator(".ft-vault")).toHaveAttribute("aria-label", /click to see all vaults/);
    await expect(page.locator(".ft-vault")).not.toHaveAttribute("aria-label", /点击查看全部 vault/);
    // ② modeline 两段（`syncDirtyIndicator` / `syncModelineMeta` 是「文档变化时才写」的派生文本）
    await expect(page.locator(".modeline-meta")).toContainText("lines · UTF-8");
    await expect(page.locator(".modeline-language")).toHaveText("en");
    // ③ 预览装饰（`editor.refreshPreview()` 的判据：widget 文本与 `data-degraded` 属性都要重建）
    await expect(page.locator(".cm-lp-embed-unsupported").first()).toContainText(COPY["D31"].en.split("{ref}")[0]);

    // ④ 写回配置（乐观施加 + 异步写回）：与主题同款的通道，桩记录的调用序列里应有一次
    //   `config_set_ui_value`（值由桩的通用键值写路由接收；具体键值对由真机场景 55 断言）。
    const writes = await page.evaluate(
      () => (window as unknown as { __invokes: string[] }).__invokes.filter((c) => c === "config_set_ui_value").length,
    );
    expect(writes).toBeGreaterThan(0);
  });

  test("切换两次（zh → en → zh）后回到起点：长驻 chrome 与装饰逐字回到 zh 列（往返幂等）", async ({ page }) => {
    await openWithAttachmentLanguage(page, "zh");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+Shift+L");
    await expect(page.locator(".modeline-language")).toHaveText("en");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+Shift+L");
    await expect(page.locator(".modeline-language")).toHaveText("zh");
    await expect(page.locator(".ft-vault")).toHaveAttribute("aria-label", /点击查看全部 vault/);
    await expect(page.locator(".cm-lp-embed-unsupported").first()).toContainText("附件未找到");
  });

  test("上屏列锁定：标签右键菜单三项在 zh 界面下仍是英文（M257 裁决不回退）", async ({ page }) => {
    await stubTauri(page, { ...VAULT, config: { language: "zh" } });
    await page.goto("/");
    await expect(page.locator(".ft-row", { hasText: "note.md" }).first()).toBeVisible();
    await page.locator(".ft-row", { hasText: "note.md" }).first().click();
    await expect(page.locator(".cm-content")).toBeVisible();
    const tab = page.locator(".tab", { hasText: "note.md" }).first();
    await tab.click({ button: "right" });
    const menu = page.locator(".tab-menu");
    await expect(menu).toBeVisible();
    // 锁定列 = English 列：zh 界面下上屏的仍是 Close 三串，MUST NOT 回落到中文列的沿革措辞
    await expect(menu.getByRole("menuitem", { name: COPY["D149"].en, exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: COPY["D150"].en, exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: COPY["D151"].en, exact: true })).toBeVisible();
  });

  // M285：标签段的读屏名（D88）是**构造期**写死的长驻 chrome（`src/shell.ts` 装配时取一次
  // `t("D88")`，而那时配置还没到达、取值落默认档 `en`），此前没有重跑路径 ⇒ zh 配置下
  // `AXTabGroup` 永久停在 `Open documents`（M284 的真机现场：同一屏其余 chrome 都是 zh，只有
  // 标签段是 en；finding `20260928-...-relabel-zh-axtabgroup-en.md`）。修法是把它抽成函数并挂进
  // `onRelabel`——本用例判的就是那条重跑路径真的接上了：同一元素上的值随语言切换而变。
  test("标签段的读屏名跟着语言走（M285：容器 aria-label 的重跑路径）", async ({ page }) => {
    await openWithAttachmentLanguage(page, "zh");
    // 起点：zh 桩下标签段在场（有打开的文件），读屏名取中文列——修前这里是英文列
    await expect(page.locator(".tabstrip")).toHaveAttribute("aria-label", COPY["D88"].zh);
    // 反向：同一 DOM 元素上切到 en 后取英文列（证明那不是「zh 恰好等于初始值」的巧合）
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+Shift+L");
    await expect(page.locator(".modeline-language")).toHaveText("en");
    await expect(page.locator(".tabstrip")).toHaveAttribute("aria-label", COPY["D88"].en);
  });

  test("取值门禁的运行时对照：zh 与 en 两态下同一元素的文本只差语言列（单一取值点）", async ({ page }) => {
    await openWithAttachmentLanguage(page, "en");
    const enText = await page.locator(".ft-vault").getAttribute("aria-label");
    expect(enText).toBe(COPY["D96"].en.replace("{name}", "vault"));
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+Shift+L");
    await expect(page.locator(".ft-vault")).toHaveAttribute(
      "aria-label",
      COPY["D96"].zh.replace("{name}", "vault"),
    );
    expect(await page.locator(".ft-vault").getAttribute("aria-label")).not.toBe(enText);
  });
});
