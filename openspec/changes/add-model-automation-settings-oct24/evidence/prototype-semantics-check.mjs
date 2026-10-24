// 原型产品语义反向断言（M704 r2，随 change add-model-automation-settings-oct24 提交）。
//
// 守的不是视觉，而是四条第 1 轮漏判过的产品语义（Alex 2026-10-24 实看反馈）：
//   1) 四个自动化开关是全局键，不是 provider 的子项：切换 provider 不得复制 / 重排 / 改归属；
//   2) 会话命名不是每轮生成：文案必须写明首轮 / 5 轮周期 / 漂移提前 / 至少隔 3 轮 / 失败按
//      自然节奏 / 单飞行 / 异步落盘，且不得出现「每轮」「下一轮必定生效」；
//   3) 模型清单只来自 config.json，不能暗示内置模型表 / 模型目录；
//   4) provider 固定两项、不可增删：不能出现添加 / 删除 / 重命名的入口或暗示。
//
// 判据有区分度（REVIEW.md「断言等价于子串，没有区分度」条）：每条 predicate 都配一个
// **必须让它 FAIL 的合成输入**（negative control），合成输入不过就一直红；另对「取到的文本
// 为空 / 函数体没找到」单独判 FAIL（REVIEW.md「读不到当成空」条）。
//
// 跑法（在仓根或 worktree 根）：
//   node openspec/changes/add-model-automation-settings-oct24/evidence/prototype-semantics-check.mjs
//   PROTOTYPE_HTML=/abs/path.html node .../prototype-semantics-check.mjs
//   node .../prototype-semantics-check.mjs --static-only   # 不依赖 Playwright
//
// 路径解析顺序：PROTOTYPE_HTML → 脚本同目录的 prototype.html（评审副本）→
// <repo>/design/prototypes/model-automation-settings-oct24.html。Playwright 依次找
// <repo>/tests/visual 与 worktree 上三层的 tests/visual；找不到时 browser 段显式 SKIP，
// 静态段仍必须全绿。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const staticOnly = args.has("--static-only");

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, "design/prototypes"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`仓库根未找到（从 ${start} 向上找不到 design/prototypes）`);
}

const repoRoot = findRepoRoot(scriptDir);

function resolvePrototype() {
  if (process.env.PROTOTYPE_HTML) return path.resolve(process.env.PROTOTYPE_HTML);
  const sibling = path.join(scriptDir, "prototype.html");
  if (fs.existsSync(sibling)) return sibling;
  return path.join(repoRoot, "design/prototypes/model-automation-settings-oct24.html");
}

const prototypePath = resolvePrototype();
const html = fs.readFileSync(prototypePath, "utf8");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── 文本 predicate（每条都要求「合法输入 true / 合成坏输入 false」） ─────────────

/** 自动化区不得把会话命名说成每轮生成。 */
function namingCadenceCopyOk(text) {
  return (
    text.length > 200 &&
    !/每轮/.test(text) &&
    !/下一轮必定生效/.test(text) &&
    text.includes("首轮") &&
    text.includes("5 轮") &&
    text.includes("3 轮") &&
    text.includes("异步")
  );
}

/** 模型来源必须写明 config.json，且不能暗示第二来源。 */
function modelSourceCopyOk(text) {
  return (
    text.includes("config.json") &&
    text.includes("harness.providers") &&
    text.includes("不内置") &&
    !/模型市场|推荐模型|模型目录|可选模型库/.test(text)
  );
}

/** 增删 provider 的入口 / 暗示（允许「新增 provider 属于 schema 变更」这类否定说明）。 */
function providerMutationViolation(text) {
  return /添加\s*provider|删除\s*provider|移除\s*provider|重命名\s*provider|provider\s*(管理|增删)|\+\s*provider/i.test(
    text,
  );
}

/** 自动化是否被塞进 provider 表单 / 复制成多份。 */
function automationOwnershipViolation({ inProviderPanel, totalRows, keys }) {
  const expected = ["auto_compact", "session_naming", "attachment_naming", "subagents"];
  return inProviderPanel > 0 || totalRows !== 4 || keys.join(",") !== expected.join(",");
}

// 负向对照：这些合成输入必须让 predicate 判红。任何一条没红，说明判据没有区分度。
check("N0 负向对照：namingCadenceCopyOk 能识别「每轮生成」", () => {
  const bad = `${"填充".repeat(120)}首轮 5 轮 3 轮 异步 每轮完成后生成会话名`;
  assert(bad.length > 200, "negative sample should be long enough");
  assert(namingCadenceCopyOk(bad) === false, "每轮 sample must fail");
  assert(namingCadenceCopyOk(`${"填充".repeat(120)}首轮 5 轮 3 轮 异步`) === true, "clean sample must pass");
});

check("N1 负向对照：modelSourceCopyOk 能识别「模型目录」", () => {
  const bad = "config.json harness.providers 不内置 可选模型目录";
  assert(modelSourceCopyOk(bad) === false, "模型目录 sample must fail");
  assert(modelSourceCopyOk("config.json harness.providers 不内置 合成数据") === true, "clean sample must pass");
});

check("N2 负向对照：providerMutationViolation 能识别「添加 provider」", () => {
  assert(providerMutationViolation("添加 provider") === true, "添加 provider must violate");
  assert(providerMutationViolation("新增 provider 属于 schema 变更，不能增删") === false, "negative copy must pass");
});

check("N3 负向对照：automationOwnershipViolation 能识别复制 / 改归属", () => {
  const keys = ["auto_compact", "session_naming", "attachment_naming", "subagents"];
  assert(automationOwnershipViolation({ inProviderPanel: 1, totalRows: 5, keys }) === true, "duplicate must fail");
  assert(automationOwnershipViolation({ inProviderPanel: 0, totalRows: 4, keys: keys.slice().reverse() }) === true, "reorder must fail");
  assert(automationOwnershipViolation({ inProviderPanel: 0, totalRows: 4, keys }) === false, "clean must pass");
});

// ── 静态源码断言 ──────────────────────────────────────────────────────────────

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} not found`);
  const open = source.indexOf("{", start);
  assert(open >= 0, `function ${name} body not found`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`function ${name} body unbalanced`);
}

const providerPanelBody = functionBody(html, "renderProviderPanel");
const setProviderBody = functionBody(html, "setProvider");
const renderAutomationBody = functionBody(html, "renderAutomation");

check("S1 renderProviderPanel / setProvider 不触碰自动化区", () => {
  assert(providerPanelBody.length > 400, `renderProviderPanel body too short (${providerPanelBody.length})`);
  assert(setProviderBody.length > 50, `setProvider body too short (${setProviderBody.length})`);
  for (const [name, body] of [
    ["renderProviderPanel", providerPanelBody],
    ["setProvider", setProviderBody],
  ]) {
    assert(!/auto-row|automation|AUTOMATION|renderAutomation/.test(body), `${name} must not reference automation`);
  }
});

check("S2 renderAutomation 只由 render() 与 resetSwitch() 调用，provider 路径不调用", () => {
  assert(renderAutomationBody.length > 200, `renderAutomation body too short (${renderAutomationBody.length})`);
  const renderBody = functionBody(html, "render");
  const resetSwitchBody = functionBody(html, "resetSwitch");
  assert(/renderAutomation\(\);/.test(renderBody), "render() must call renderAutomation()");
  assert(/renderAutomation\(\);/.test(resetSwitchBody), "resetSwitch() must refresh the automation list");
  assert(!/renderAutomation\(\);/.test(providerPanelBody), "renderProviderPanel must not call renderAutomation()");
  assert(!/renderAutomation\(\);/.test(setProviderBody), "setProvider must not call renderAutomation()");
  const calls = html.match(/renderAutomation\(\);/g) || [];
  assert(calls.length === 2, `renderAutomation() calls = ${calls.length}, expected render + resetSwitch`);
  assert(renderAutomationBody.includes("data-auto-row"), "renderAutomation must render auto rows");
});

check("S3 自动化节在静态结构上与模型接入节平级", () => {
  const modelStart = html.indexOf('id="sec-model"');
  const autoStart = html.indexOf('id="sec-auto"');
  const panelAt = html.indexOf('id="provider-panel"');
  const automationAt = html.indexOf("data-automation>");
  assert(modelStart > 0 && autoStart > 0 && panelAt > 0 && automationAt > 0, "markers missing");
  const modelClose = html.indexOf("</section>", modelStart);
  assert(modelClose > modelStart && modelClose < autoStart, "model section must close before automation section");
  assert(panelAt > modelStart && panelAt < modelClose, "provider panel must sit inside the model section");
  assert(automationAt > autoStart, "automation pane must sit inside the automation section");
  assert(automationAt > modelClose, "automation must be outside the model section");
  assert((html.match(/data-automation(?=[\s>])/g) || []).length === 1, "automation pane marker must be unique");
  const panelRegion = html.slice(panelAt, html.indexOf("</div>", panelAt));
  assert(!panelRegion.includes("data-auto-row"), "provider panel markup must not contain automation rows");
});

check("S4 自动化文案：节奏准确、无「每轮」", () => {
  const autoStart = html.indexOf('id="sec-auto"');
  const autoSection = html.slice(autoStart, html.indexOf("</section>", autoStart));
  const automationLiteral = html.slice(html.indexOf("const AUTOMATION = ["), html.indexOf("function renderAutomation"));
  const text = `${autoSection}\n${automationLiteral}`;
  assert(text.length > 300, `automation text too short (${text.length})`);
  assert(namingCadenceCopyOk(text), "automation copy must state first-turn / 5-turn / 3-turn / async and must not say 每轮");
  assert(!/下一轮/.test(text), "automation copy must not promise 下一轮");
  assert(/全局/.test(text), "automation copy must state it is global");
});

check("S5 模型来源写明 config.json，且无内置目录暗示", () => {
  const modelStart = html.indexOf('id="sec-model"');
  const modelSection = html.slice(modelStart, html.indexOf("</section>", modelStart));
  const text = `${modelSection}\n${providerPanelBody}`;
  assert(modelSourceCopyOk(text), "model source copy must name config.json / harness.providers / 不内置 and no catalog");
});

check("S6 provider 无增删入口或暗示", () => {
  const modelStart = html.indexOf('id="sec-model"');
  const modelSection = html.slice(modelStart, html.indexOf("</section>", modelStart));
  const tabsBody = functionBody(html, "renderTabs");
  const text = `${modelSection}\n${tabsBody}`;
  assert(!/data-provider-(add|remove|rename)/.test(html), "must not contain provider add / remove hooks");
  assert(!providerMutationViolation(text), "model pane must not advertise provider add / remove");
  assert(text.includes("固定两项") && text.includes("不能增删"), "model pane must state fixed / no add-remove");
  assert(/\["kimi", "deepseek"\]\.map/.test(tabsBody), "provider tabs must be the closed pair kimi / deepseek");
  assert(!/mock/.test(tabsBody), "mock must not be a provider tab");
});

check("S7 命名目标说明：跟随当前会话 / 可单独覆盖 / 一次一个目标", () => {
  const note = html.match(/data-naming-target-note[^>]*>([\s\S]*?)<\/p>/);
  assert(note !== null, "naming target note missing");
  const text = note[1];
  assert(text.includes("跟随当前会话"), "must say follows current session");
  assert(text.includes("单独覆盖"), "must say can override separately");
  assert(text.includes("一个目标"), "must say one target per trigger");
  assert(text.includes("不会对每个 provider 各做一次"), "must deny per-provider fan-out");
});

// ── 浏览器交互断言（可选依赖 Playwright） ────────────────────────────────────

function findPlaywright() {
  const candidates = [
    path.join(repoRoot, "tests/visual/node_modules/@playwright/test/index.mjs"),
    path.resolve(repoRoot, "../../../tests/visual/node_modules/@playwright/test/index.mjs"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function browserChecks() {
  const entry = findPlaywright();
  if (staticOnly) {
    console.log("SKIP  browser（--static-only）");
    return;
  }
  if (!entry) {
    console.log("SKIP  browser（未找到 Playwright；静态段已全绿）");
    return;
  }
  const { chromium } = await import(pathToFileURL(entry).href);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  try {
    await page.goto(`${pathToFileURL(prototypePath).href}?theme=light&scene=configured`);
    await page.waitForSelector("#settings-panel", { state: "attached" });

    await checkAsync("B1 自动化只有一个全局实例，且不在 provider 表单内", async () => {
      assert((await page.locator("[data-automation]").count()) === 1, "expected exactly one automation pane");
      assert((await page.locator("#provider-panel [data-auto-row]").count()) === 0, "automation must not render inside provider panel");
      const keys = await page.locator("[data-automation] [data-auto-row]").evaluateAll((els) =>
        els.map((el) => el.dataset.autoRow),
      );
      assert(
        !automationOwnershipViolation({ inProviderPanel: 0, totalRows: keys.length, keys }),
        `automation rows must be the four global keys in order, got ${keys.join(",")}`,
      );
      const layout = await page.evaluate(() => {
        const model = document.querySelector("#model-pane");
        const auto = document.querySelector("#automation-pane");
        const provider = document.querySelector("#provider-panel");
        if (!model || !auto || !provider) return null;
        return {
          nestedInModel: model.contains(auto),
          nestedInProvider: provider.contains(auto),
          sameSection: model.closest("section") === auto.closest("section"),
        };
      });
      assert(layout !== null, "model / automation / provider panes missing");
      assert(!layout.nestedInModel, "automation pane must not be nested in the model pane");
      assert(!layout.nestedInProvider, "automation pane must not be nested in the provider form");
      assert(!layout.sameSection, "automation and model access must live in different sections");
    });

    const before = await page.locator("[data-automation]").evaluate((el) => el.outerHTML);
    await page.click('[data-provider-tab="deepseek"]');
    const after = await page.locator("[data-automation]").evaluate((el) => el.outerHTML);
    await checkAsync("B2 切换 provider 不改写自动化 DOM / 归属", async () => {
      assert(before === after, "automation pane HTML changed after provider switch");
      assert((await page.locator("#provider-panel [data-auto-row]").count()) === 0, "automation leaked into provider form");
      const keys = await page.locator("[data-automation] [data-auto-row]").evaluateAll((els) =>
        els.map((el) => el.dataset.autoRow),
      );
      assert(
        !automationOwnershipViolation({ inProviderPanel: 0, totalRows: keys.length, keys }),
        `automation rows changed after switch: ${keys.join(",")}`,
      );
      const checked = await page.locator("[data-automation] [data-switch]").evaluateAll((els) =>
        els.map((el) => `${el.dataset.switch}:${el.getAttribute("aria-checked")}`),
      );
      assert(checked.length === 4, `switch count ${checked.length}`);
    });
    await page.click('[data-provider-tab="kimi"]');

    const autoText = await page.locator("[data-automation]").innerText();
    await checkAsync("B3 自动化文案：全局、无每轮、节奏准确", async () => {
      assert(autoText.length > 200, `automation text too short (${autoText.length})`);
      assert(/全局/.test(autoText), "automation must state global");
      assert(!/每轮/.test(autoText), "automation must not say 每轮");
      assert(!/下一轮/.test(autoText), "automation must not promise 下一轮");
      assert(autoText.includes("首轮") && autoText.includes("5 轮") && autoText.includes("3 轮") && autoText.includes("异步"), "cadence copy incomplete");
    });

    await checkAsync("B4 会话命名 / 图片命名各自写清后果", async () => {
      const session = await page.locator('[data-auto-row="session_naming"]').innerText();
      assert(session.includes("首轮") && session.includes("5 轮") && session.includes("3 轮"), `session copy: ${session}`);
      assert(!/每轮/.test(session), "session naming must not say 每轮");
      const attachment = await page.locator('[data-auto-row="attachment_naming"]').innerText();
      assert(attachment.includes("vision") && attachment.includes("跳过") && attachment.includes("不换模型"), `attachment copy: ${attachment}`);
      const target = await page.locator("[data-naming-target-note]").innerText();
      assert(target.includes("跟随当前会话") && target.includes("单独覆盖") && target.includes("一个目标"), `target note: ${target}`);
    });

    await checkAsync("B5 模型来源与 provider 固定写清", async () => {
      const modelText = await page.locator("#model-pane").innerText();
      assert(modelSourceCopyOk(modelText), `model pane copy: ${modelText}`);
      assert(providerMutationViolation(modelText) === false, `provider mutation hint: ${modelText}`);
      assert(modelText.includes("固定两项") && modelText.includes("不能增删"), `fixed provider copy: ${modelText}`);
      const tabIds = await page.locator("[data-provider-tab]").evaluateAll((els) => els.map((el) => el.dataset.providerTab));
      assert(tabIds.join(",") === "kimi,deepseek", `provider tabs: ${tabIds.join(",")}`);
      assert((await page.locator("[data-provider-fixed-badge]").innerText()).includes("固定"), "fixed badge missing");
      const labels = await page.locator("#model-pane button, #model-pane a").evaluateAll((els) =>
        els.map((el) => `${el.textContent || ""} ${el.getAttribute("aria-label") || ""}`),
      );
      const addRemove = labels.filter((text) => providerMutationViolation(text));
      assert(addRemove.length === 0, `provider mutating controls: ${addRemove.join(" | ")}`);
    });

    await checkAsync("B6 页面无 JS 错误", async () => {
      assert(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
    });
  } finally {
    await browser.close();
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

console.log(`PROTOTYPE  ${prototypePath}`);
await browserChecks();

const failed = results.filter((entry) => !entry.ok);
console.log(`\nRESULT: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
if (failed.length) {
  process.exitCode = 1;
}
