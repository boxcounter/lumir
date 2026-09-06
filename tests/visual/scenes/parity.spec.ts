import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const prototype = readFileSync(new URL("../../../design/editorial/index.html", import.meta.url), "utf8");
const paragraph = "读一篇长文，总会碰到几处卡顿。一个术语没有解释，一个论断缺少出处，一段语气忽然变得陌生。过去的做法是把它们记下来——记在本子上、脑子里，或者另一个应用的对话框里——然后继续读。";
const second = "更多时候，卡顿消失在搬运里：复制片段，粘贴到对话窗口，组织上下文，等待回答，再回到原文，人肉找到刚才的位置，判断那个回答值不值得变成修改。";
const text = `# 把卡顿变成正文\n\n${paragraph}\n\n${second}\n\n## 回路\n\n${second}\n`;
const fixture: VaultFixture = {
  root: "/fixture/编辑部", vault_id: "fixture-vault",
  entries: ["写作", "写作/正文.md", "研究", "研究/参考.md", "missing.md"].map(path => ({ path, kind: path.includes(".") ? "file" : "dir", size: 128, mtime_ms: 0 })),
  files: { "写作/正文.md": text, "研究/参考.md": "# 参考\n\n短段。\n\n下一段。" },
  threads: [
    { vault_id: "fixture-vault", id: "ta", title: "把卡顿变成正文", status: "active", files: [{ vault_id: "fixture-vault", path: "写作/正文.md", role: "main" }, { vault_id: "fixture-vault", path: "研究/参考.md", role: "ref" }], recent_activity: "2026-09-06T00:00:00Z", brief: null },
    { vault_id: "fixture-vault", id: "tb", title: "整理成演讲稿", status: "paused", files: [{ vault_id: "fixture-vault", path: "写作/正文.md", role: "source" }], recent_activity: "2026-09-06T00:00:00Z", brief: null },
  ], currentThread: "ta",
};

for (const theme of ["light", "dark", "eink"]) {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 1440, height: 900 }, { width: 1200, height: 700 }, { width: 1000, height: 600 }, { width: 640, height: 480 }]) {
    test(`原型对照 ${theme} ${viewport.width}x${viewport.height}`, async ({ page, context }, info) => {
      await page.setViewportSize(viewport);
      await stubTauri(page, fixture);
      await page.addInitScript(t => localStorage.setItem("lumir-theme", t), theme);
      await page.goto("/");
      await page.locator('.ft-row[title="写作"]').click();
      await page.locator('.ft-row[title="写作/正文.md"]').click();
      await expect(page.locator(".cm-content")).toContainText(paragraph);
      const reference = await context.newPage();
      await reference.setViewportSize(viewport);
      await reference.route("**/prototype?**", route => route.fulfill({ contentType: "text/html", body: prototype }));
      await reference.goto("http://127.0.0.1:4173/prototype?state=clean&theme=" + theme);
      await reference.addStyleTag({ content: "#console { display:none!important } #stage { height:100vh!important }" });
      await reference.evaluate(({ paragraph, second }) => {
        const doc = document.querySelector("#doc")!;
        doc.innerHTML = `<h1>把卡顿变成正文</h1><p class="dropcap">${paragraph}</p><p>${second}</p><h2>回路</h2><p>${second}</p>`;
        document.querySelector(".mh-name")!.textContent = "编辑部";
        document.querySelector(".mh-sub")!.textContent = "写作/正文.md";
        document.querySelector(".mh-right")!.textContent = "把卡顿变成正文 进行中";
        const tree = document.querySelector(".nav-tree")!;
        tree.replaceChildren();
        for (const [path, dir, depth] of [["写作", true, 0], ["写作/正文.md", false, 1], ["研究", true, 0], ["missing.md", false, 0]] as const) {
          const row = document.createElement("button");
          row.className = `tr-row ${dir ? "tr-dir" : "tr-file"}${path === "写作/正文.md" ? " current" : ""}`;
          row.style.setProperty("--i", String(depth)); row.dataset.d = String(depth); row.title = path;
          row.innerHTML = `<span class="tr-caret">${dir ? "▾" : ""}</span><span class="tr-name">${path.split("/").pop()}</span>${path === "写作/正文.md" ? '<span class="tr-multi">×2</span>' : ""}`;
          tree.append(row);
        }
        document.querySelector(".nav-threads")!.innerHTML = '<div class="thr-card"><div class="thr-t">把卡顿变成正文</div><div class="thr-meta">进行中</div><div class="thr-roles"><button class="thr-role current"><span class="rl-name">正文.md</span><span class="rl-role">主文档</span></button><button class="thr-role"><span class="rl-name">参考.md</span><span class="rl-role">参考</span></button></div></div><button class="thr-line"><span class="tl-name">整理成演讲稿</span><span class="tl-meta">暂停</span></button>';
      }, { paragraph, second });
      await page.screenshot({ path: info.outputPath("production.png") });
      await reference.screenshot({ path: info.outputPath("prototype.png") });
      const geometry = async (target: typeof page, selectors: string[]) => target.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
        const element = document.querySelector(selector)!;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: style.color, background: style.backgroundColor, font: style.font, padding: style.padding }];
      })), selectors);
      const production = await geometry(page, [".pane-filetree", ".masthead", ".pane-editor", ".cm-content", ".cm-line"]);
      const frozen = await geometry(reference, ["#nav", "#masthead", "#sheet", "#body-col", "#doc h1"]);
      await info.attach("computed", { body: JSON.stringify({ production, prototype: frozen }, null, 2), contentType: "application/json" });
      expect.soft(production[".pane-filetree"].width).toBe(frozen["#nav"].width);
      expect.soft(production[".cm-content"].width).toBe(frozen["#body-col"].width);
      expect.soft(production[".cm-content"].x).toBe(frozen["#body-col"].x);
      expect.soft(production[".cm-line"].y).toBe(frozen["#doc h1"].y);
      const treeStyle = await page.locator('.ft-row[title="写作"]').evaluate(el => ({ height: el.getBoundingClientRect().height, weight: getComputedStyle(el.querySelector(".ft-name") ?? el).fontWeight }));
      expect.soft(treeStyle.height).toBe(27);
      expect.soft(treeStyle.weight).toBe("600");
      expect.soft(production[".cm-content"].background).toBe("rgba(0, 0, 0, 0)");
      expect.soft(production[".pane-editor"].color).toBe(frozen["#sheet"].color);
      await expect(page.locator(".pane-panel")).toBeHidden();
      await expect(page.locator(".thread-card.is-current .thread-file-role")).toHaveText(["主文档", "参考"]);
      await expect(page.locator(".thread-card:not(.is-current) .thread-file")).toHaveCount(0);
      await reference.close();
    });
  }
}

test("Thread IPC 成功与失败反馈", async ({ page }) => {
  await stubTauri(page, fixture);
  await page.goto("/");
  await page.locator('[data-thread-id="tb"] .thread-select').click();
  await expect(page.locator('.thread-card.is-current .thread-file-role')).toHaveText(["来源"]);
  await page.getByRole("button", { name: "+ 新建" }).click();
  await page.getByRole("textbox", { name: "Thread 名称" }).fill("验收 Thread");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".lumir-toast")).toContainText("已创建并切换到 Thread：验收 Thread");
  await expect(page.locator('.thread-card.is-current .thread-select')).toContainText('验收 Thread');
  const persisted = await page.evaluate(async () => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: object) => Promise<{ title: string }> } }).__TAURI_INTERNALS__;
    return api.invoke('thread_current', { vault_id: 'fixture-vault' });
  });
  expect(persisted.title).toBe('验收 Thread');
  await page.locator('.ft-row[title="missing.md"]').click();
  await expect(page.locator(".editor-notice")).toContainText("文件不存在：missing.md");
});

test("Thread 创建失败保留输入并提示", async ({ page }) => {
  await stubTauri(page, { ...fixture, failures: { thread_create: { code: "thread_write", message: "无法保存 Thread：测试只读目录" } } });
  await page.goto("/");
  await page.getByRole("button", { name: "+ 新建" }).click();
  await page.getByRole("textbox", { name: "Thread 名称" }).fill("不能丢失的名称");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".lumir-toast")).toContainText("无法保存 Thread");
  await expect(page.getByRole("textbox", { name: "Thread 名称" })).toHaveValue("不能丢失的名称");
});
