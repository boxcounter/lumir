import { expect, test, type Page } from "@playwright/test";
import { DEMO_VAULT, documentWrites, fileText, sessionPuts, stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";

// 切换 vault 的 dirty 前置门（change multi-vault-workspaces 任务 4.1–4.2 的三条出口）。
//
// 为什么这条要放在 chromium 通道（而不是只靠真机场景 19-vault-switch-guard）：三条出口里
// 「保存并切换」的**顺路**（保存成功 → 继续切换）在真机上要求「文档变更后 2s 内发出切换请求」，
// 而真机套件的键盘注入每键约 250ms + 一次 MCP 往返（见 scripts/acceptance/README.md 已知边界），
// 抢不到那个窗口——那边的场景因此只覆盖「保存未闭环 → 不切换」这一支（任务 4.2 的原文）。
// 这里用真实前端 + 桩后端直连 DOM 事件，没有注入耗时，三条出口都能确定性走完，
// 并且用桩的 `document_save` / `vault_session_put` 调用记录做**写动作**级别的判据
// （「放弃后没写盘」这类负向断言没有观测点就会空转，REVIEW.md 第 2 条）。

const VAULT_A = "fixture-vault";
const VAULT_B = "fixture-vault-b";
const VAULT_B_ROOT = "/Users/alex/notes-vault";

const REGISTRY: VaultListRow[] = [
  { id: VAULT_A, path: "/Users/alex/demo-vault", name: "demo-vault", available: true, last_opened_at: 1757000002000, tab_count: 1 },
  { id: VAULT_B, path: VAULT_B_ROOT, name: "notes-vault", available: true, last_opened_at: 1757000001000, tab_count: 0 },
];

const VAULT_B_FIXTURE: VaultFixture & { root: string } = {
  root: VAULT_B_ROOT,
  vault_id: VAULT_B,
  entries: [
    { path: "inbox.md", kind: "file", size: 64, mtime_ms: 1757000000000 },
    { path: "note.md", kind: "file", size: 32, mtime_ms: 1757000000000 },
  ],
  files: {
    "inbox.md": "# Inbox\n\n第二个 vault 的收件箱。\n",
    "note.md": "# Note\n\n第二个 vault 的笔记。\n",
  },
};

const DISK_BEFORE = DEMO_VAULT.files!["README.md"];

/** 打开 README.md 并改出未保存状态；返回 dirty 现场就绪后的断言入口。 */
async function makeDirty(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('.ft-row[title="README.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Demo Vault");
  await page.locator(".cm-content").click();
  await page.keyboard.type("EDITED-A");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
}

/** 打开浮层并点目标 vault 那一行，等 dirty 拦截浮条出现。 */
async function requestSwitchToB(page: Page): Promise<void> {
  await page.locator(".ft-vault").click();
  await page.locator(`.vault-row[data-vault="${VAULT_B}"]`).click();
}

const guard = (page: Page) => page.locator(".lumir-toast", { hasText: "切换会丢弃这些修改" });

test("dirty 拦下：点名当前 vault 与脏标签数，三条出口齐全", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, vaults: REGISTRY, switchTo: VAULT_B_FIXTURE });
  await makeDirty(page);
  await requestSwitchToB(page);

  const bar = guard(page);
  await expect(bar).toHaveCount(1);
  // D109：未保存修改属于**当前** vault，提示点名当前 vault 与脏标签数，不点名目标
  await expect(bar).toContainText("「demo-vault」里有 1 个标签有未保存修改，切换会丢弃这些修改");
  await expect(bar).not.toContainText("notes-vault");
  await expect(bar.getByRole("button")).toHaveText(["保存并切换", "放弃修改并切换", "取消"]);
  // 拦下时上下文不变
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
  await expect(page.locator(".cm-content")).toContainText("EDITED-A");
  // 也没写盘
  expect((await documentWrites(page)).filter((c) => c.content.includes("EDITED-A"))).toHaveLength(0);
});

test("出口「取消」：留在当前 vault，不写盘也不丢内容", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, vaults: REGISTRY, switchTo: VAULT_B_FIXTURE });
  await makeDirty(page);
  await requestSwitchToB(page);

  await guard(page).getByRole("button", { name: "取消" }).click();
  await expect(guard(page)).toHaveCount(0);
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
  await expect(page.locator(".cm-content")).toContainText("EDITED-A");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  expect((await documentWrites(page)).filter((c) => c.content.includes("EDITED-A"))).toHaveLength(0);
});

test("出口「保存并切换」：保存成功才切换，会话按稳定 id 落盘", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, vaults: REGISTRY, switchTo: VAULT_B_FIXTURE });
  await makeDirty(page);
  await requestSwitchToB(page);

  await guard(page).getByRole("button", { name: "保存并切换" }).click();

  // 保存真的发生（写动作级别的判据，不是「界面看起来切走了」）
  await expect.poll(async () => (await documentWrites(page)).map((c) => c.path)).toContain("README.md");
  const saved = (await documentWrites(page)).at(-1);
  expect(saved?.content).toContain("EDITED-A");

  // 保存闭环后切换才继续：整窗上下文换到 B
  await expect(page.locator(".ft-vault-name")).toHaveText("notes-vault");
  await expect(page.locator('.ft-row[title="inbox.md"]')).toBeVisible();
  await expect(page.locator('.ft-row[title="README.md"]')).toHaveCount(0);

  // 切换前 flush：当前 vault 的会话落盘（键入固定住了那个预览标签，所以它入盘）
  await expect.poll(async () => (await sessionPuts(page)).at(-1)).toEqual({
    vault_id: VAULT_A,
    tabs: ["README.md"],
    active: "README.md",
  });
});

test("出口「放弃修改并切换」：切换照常完成，改动不写盘", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, vaults: REGISTRY, switchTo: VAULT_B_FIXTURE });
  await makeDirty(page);
  await requestSwitchToB(page);

  // 先确认桩里这个文件的基线是真值（防空转）：这条读发生在切换之前，读的是 A 的文件表
  // ——切换之后 `__fileText` 读的已经是 B 的文件表（切换即整窗换上下文）。
  expect(await fileText(page, "README.md")).toBe(DISK_BEFORE);

  await guard(page).getByRole("button", { name: "放弃修改并切换" }).click();

  await expect(page.locator(".ft-vault-name")).toHaveText("notes-vault");
  // 负向判据有观测点：放弃的动作里没有发生任何一次「把 EDITED-A 写下去」的保存
  expect((await documentWrites(page)).filter((c) => c.content.includes("EDITED-A"))).toHaveLength(0);
});
