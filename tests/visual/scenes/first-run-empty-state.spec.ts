import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test as baseTest } from "@playwright/test";
import { documentWrites, fireFsEvent, fsMutations, guardPageChannel, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";

// M851（0.13.0 初装验证，M849 报告 §B/E）：
//   1. 无 vault 首屏不再展示 SAMPLE 演示文档——初始会话是空白未命名文档，左栏 D5/D6 是
//      唯一且可见的出口；「标题一 / i18n-exempt / Attachment not found / Image read failed」
//      这些伪文档与错误占位串 MUST NOT 出现在首屏。
//   2. 空 vault 的正文空态（D107）给一个**可见**的新建入口（D882「New note」），与右键根
//      菜单的「新建文件…」走同一条 tree 命令；不依赖隐藏右键。
//   3. 新建时无扩展名输入默认落 `.md`（用户显式写扩展名时原样保留）——判据取后端收到的
//      实际创建路径，不是输入框里的文本；撞名预检同样按最终落盘名判。
//
// 判据落点一律是「用户可见文本 / 后端调用参数」：前者在 DOM 上直接读，后者读桩的
// `__fsMutations` / `__documentWrites` 记录。没有新增像素基线（「保持视觉合同」= 既有整页
// 基线不因本场景新增或重录；首屏本体的基线变化由独立的人肉裁决承担，见 mission M851）。
//
// 页面场景统一经通道守卫跑（M793，tests/visual/README.md「页面 target 死亡」节）：浏览器
// 偶发收掉 target 时换新页面整场重跑，产品断言失败不重跑。
const pageTest = (name: string, body: (page: Page) => Promise<void>): void => {
  baseTest(name, async ({ page }, testInfo) => {
    await guardPageChannel(page, body, { testInfo });
  });
};

/** 合成空 vault：条目为空、无会话历史——开箱即触发 D107 的空 vault 首入态。 */
const EMPTY_VAULT: VaultFixture = {
  root: "/Users/alex/empty-vault",
  vault_id: "empty-vault",
  entries: [],
  files: {},
  // 产品出厂语言是 en（桩缺省 zh 只为既有整页基线）；这里显式钉 en，验出厂首启面。
  config: { language: "en" },
};

pageTest("无 vault 首屏：空白正文 + 可见 Open vault，不再展示 SAMPLE / 内部串 / 错误占位", async (page) => {
  await stubTauri(page, null);
  await page.goto("/");

  // 左栏空态是首屏唯一的指引面（D5 文案 + D6 按钮），且按钮在可点元素上（不是纯文本）。
  const empty = page.locator(".ft-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("打开一个目录作为 vault，开始浏览全部文件。");
  await expect(page.getByRole("button", { name: "打开 vault" })).toBeVisible();

  // 正文是可读的空白未命名文档（CM 仍在场、不是被覆盖层藏起来的空转读写面）。
  const content = page.locator(".cm-content");
  await expect(content).toBeVisible();
  expect((await content.textContent())?.trim() ?? "").toBe("");

  // SAMPLE 的判据串一条都不许在（正观测：上面已确认正文可读、左栏空态在场，负向断言
  // 不是对着「读不到」空转——REVIEW.md『读不到当成空』条）。
  for (const junk of ["标题一", "i18n-exempt", "Attachment not found", "Image read failed"]) {
    await expect(content, `首屏正文不得含 ${junk}`).not.toContainText(junk);
  }
  await expect(page.locator(".editor-notice")).toBeHidden();
  await expect(page.locator(".tabstrip")).toBeHidden();
});

pageTest("空 vault 首屏：D107 可执行引导 + 可见 New note；新建默认 .md、显式扩展名保留", async (page) => {
  await stubTauri(page, EMPTY_VAULT);
  await page.goto("/");

  await expect(page.locator(".ft-vault-name")).toHaveText("empty-vault");

  // 空 vault 正文空态：引导句 + 可点的「New note」入口（不是右键菜单那种隐藏入口）。
  const notice = page.locator(".editor-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("No files opened in this vault yet. Create a note to start.");
  const newNote = page.getByRole("button", { name: "New note" });
  await expect(newNote).toBeVisible();

  // 旧病串（SAMPLE 的 frontmatter / 错误附件占位）不得出现在可见正文面。
  for (const junk of ["i18n-exempt", "Attachment not found", "Image read failed", "标题一"]) {
    await expect(notice, `空态正文不得含 ${junk}`).not.toContainText(junk);
  }

  // 入口开始同一套行内新建（tree.beginCreate("")）：输入框落在树里并持焦点。
  await newNote.click();
  const input = page.locator(".ft-row.is-editing input");
  await expect(input).toHaveAttribute("aria-label", "New file name");
  await expect(input).toBeFocused();

  // 无扩展名输入 → 后端收到的实际创建名是 note.md（判据不是输入框里的文本）。
  await input.fill("note");
  await page.keyboard.press("Enter");
  await expect.poll(async () => fsMutations(page)).toEqual([{ cmd: "fs_create_file", path: "note.md" }]);

  // 新建成功即自动打开；空态覆盖层随之撤下。
  await expect(page.locator(".modeline-path")).toHaveText("note.md");
  await expect(page.locator(".tab-name")).toHaveText("note.md");
  await expect(notice).toBeHidden();
  // watcher 回响把真实条目收敛进树（桩只让 fixture 世界前进、事件由场景显式发，与
  // tree-menu.spec 同一口径）——后面「撞名预检」要对着树模型里的 note.md 判。
  await fireFsEvent(page, [{ kind: "created", path: "note.md", entry_kind: "file" }]);
  await expect(page.locator('.ft-row[title="note.md"]')).toBeVisible();

  // 编辑 + 保存：写入落在 note.md（桩的 document_save 记录）。
  await page.locator(".cm-content").click();
  await page.keyboard.type("First note from a brand new user.");
  await page.keyboard.press("Meta+s");
  await expect
    .poll(async () => documentWrites(page))
    .toEqual([{ path: "note.md", content: "First note from a brand new user." }]);

  // 用户显式写扩展名时原样保留（同一入口之外的既有右键根菜单路径）：todo.txt 不得被补 .md。
  await page.locator(".ft-vault").click({ button: "right" });
  await page.locator(".ft-menu-item", { hasText: "New file" }).click();
  const explicit = page.locator(".ft-item.is-new .ft-edit");
  await explicit.fill("todo.txt");
  await page.keyboard.press("Enter");
  await expect.poll(async () => fsMutations(page)).toEqual([
    { cmd: "fs_create_file", path: "note.md" },
    { cmd: "fs_create_file", path: "todo.txt" },
  ]);
  await fireFsEvent(page, [{ kind: "created", path: "todo.txt", entry_kind: "file" }]);
  await expect(page.locator('.ft-row[title="todo.txt"]')).toBeVisible();

  // 撞名预检对着**最终落盘名**判：输入 note（无扩展名）撞上已有 note.md 时当场标红，
  // 不等到后端 fs_already_exists 才报错。
  await page.locator(".ft-vault").click({ button: "right" });
  await page.locator(".ft-menu-item", { hasText: "New file" }).click();
  const collision = page.locator(".ft-item.is-new .ft-edit");
  await collision.fill("note");
  await expect(page.locator(".ft-item.is-new .ft-edit-error")).toHaveText(
    "An entry with that name already exists: note.md",
  );
  // 非法状态不提交：Esc 取消后磁盘无第三笔创建。
  await page.keyboard.press("Escape");
  await expect(page.locator(".ft-item.is-new")).toHaveCount(0);
  expect(await fsMutations(page)).toHaveLength(2);
});
