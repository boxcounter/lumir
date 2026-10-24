// 原型产品语义反向断言（M716 r3，随 change add-model-automation-settings-oct24 提交）。
//
// 守的不是视觉，而是 r3 的核心产品语义：
//   1) provider 可添加 / 删除 / 选择；id 冲突与非法字符被拒（不是固定两项的编辑器）；
//   2) 删除当前使用项 / 被命名引用的项必须给替代目标，空清单有明确后果；
//   3) 四个自动化开关仍是全局键：增删 / 切换 provider 不复制、不重排、不改变开关 DOM；
//   4) 命名目标读数是「实际发往哪个 provider + 哪个模型」，含 vision 资格与悬空回落；
//   5) 模型清单只来自 config.json，不能暗示内置模型表 / 模型目录；
//   6) 会话命名不是每轮生成。
//
// 判据有区分度（REVIEW.md「断言等价于子串，没有区分度」条）：每条 predicate 都配一个
// **必须让它 FAIL 的合成输入**（negative control）；另对「取到的文本为空 / 函数体没找到」
// 单独判 FAIL（REVIEW.md「读不到当成空」条）。
//
// 跑法（在仓根或 worktree 根）：
//   node openspec/changes/add-model-automation-settings-oct24/evidence/prototype-semantics-check.mjs
//   PROTOTYPE_HTML=/abs/path.html node .../prototype-semantics-check.mjs
//   node .../prototype-semantics-check.mjs --static-only   # 不依赖 Playwright
//
// 路径解析顺序：PROTOTYPE_HTML → 脚本同目录的 prototype.html（评审副本）→
// <repo>/design/prototypes/model-automation-settings-oct24.html。Playwright 依次找
// <repo>/tests/visual 与主仓的 tests/visual；找不到时 browser 段显式 SKIP，静态段仍必须全绿。

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
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── 文本 predicate（每条都要求「合法输入 true / 合成坏输入 false」） ─────────────

/** 自动化开关必须恰好是这四个全局键、顺序固定，且不在 provider 表单里。 */
const AUTOMATION_KEYS = ["auto_compact", "session_naming", "attachment_naming", "subagents"];
function automationOwnershipViolation({ inProviderForm, totalRows, keys }) {
  return inProviderForm > 0 || totalRows !== 4 || keys.join(",") !== AUTOMATION_KEYS.join(",");
}

/** 会话命名不得说成每轮生成。 */
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

/** provider 管理必须是可操作入口，而不是一句「请手改 config.json」。 */
function providerManagementCopyOk(text) {
  return (
    text.includes("添加 provider") &&
    text.includes("删除") &&
    text.includes("id") &&
    text.includes("预设") &&
    !/不能增删|固定两项|新增 provider 属于 schema 变更/.test(text)
  );
}

/** 删除保护：当前使用项必须有替代选择；命名引用必须可重定向。 */
function deleteGuardOk({ hasActiveSelect, hasNamingSelect, hasDraftNotice, hasLastNotice }) {
  return (hasActiveSelect || hasLastNotice) && (hasNamingSelect || hasLastNotice) && hasDraftNotice;
}

/** provider id 规则：非法 / 保留 / 重复都必须被拒。 */
function idRuleViolation(id, existing) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) return "charset";
  if (id === "mock") return "reserved";
  if (existing.includes(id)) return "duplicate";
  return null;
}

// 负向对照：这些合成输入必须让 predicate 判红。任何一条没红，说明判据没有区分度。
check("N0 负向对照：automationOwnershipViolation 能识别复制 / 改归属 / 顺序变化", () => {
  const keys = AUTOMATION_KEYS.slice();
  assert(automationOwnershipViolation({ inProviderForm: 1, totalRows: 5, keys }) === true, "in provider form must fail");
  assert(automationOwnershipViolation({ inProviderForm: 0, totalRows: 4, keys: keys.slice().reverse() }) === true, "reorder must fail");
  assert(automationOwnershipViolation({ inProviderForm: 0, totalRows: 3, keys: keys.slice(0, 3) }) === true, "missing row must fail");
  assert(automationOwnershipViolation({ inProviderForm: 0, totalRows: 4, keys }) === false, "clean must pass");
});

check("N1 负向对照：namingCadenceCopyOk 能识别「每轮生成」", () => {
  const bad = `${"填充".repeat(120)}首轮 5 轮 3 轮 异步 每轮完成后生成会话名`;
  assert(bad.length > 200, "negative sample should be long enough");
  assert(namingCadenceCopyOk(bad) === false, "每轮 sample must fail");
  assert(namingCadenceCopyOk(`${"填充".repeat(120)}首轮 5 轮 3 轮 异步`) === true, "clean sample must pass");
});

check("N2 负向对照：modelSourceCopyOk 能识别「模型目录」", () => {
  const bad = "config.json harness.providers 不内置 可选模型目录";
  assert(modelSourceCopyOk(bad) === false, "模型目录 sample must fail");
  assert(modelSourceCopyOk("config.json harness.providers 不内置 合成数据") === true, "clean sample must pass");
});

check("N3 负向对照：providerManagementCopyOk 拒绝旧版「不能增删」", () => {
  const fixed = "provider 固定两项，不能增删；新增 provider 属于 schema 变更。";
  assert(providerManagementCopyOk(fixed) === false, "fixed-provider copy must fail");
  const good = "添加 provider；删除 provider；输入 id 并选择预设。";
  assert(providerManagementCopyOk(good) === true, "management copy must pass");
});

check("N4 负向对照：deleteGuardOk 能识别缺失的替代目标 / 草稿提示", () => {
  assert(deleteGuardOk({ hasActiveSelect: false, hasNamingSelect: true, hasDraftNotice: true, hasLastNotice: false }) === false, "missing active target must fail");
  assert(deleteGuardOk({ hasActiveSelect: true, hasNamingSelect: false, hasDraftNotice: true, hasLastNotice: false }) === false, "missing naming retarget must fail");
  assert(deleteGuardOk({ hasActiveSelect: true, hasNamingSelect: true, hasDraftNotice: false, hasLastNotice: false }) === false, "missing draft notice must fail");
  assert(deleteGuardOk({ hasActiveSelect: true, hasNamingSelect: true, hasDraftNotice: true, hasLastNotice: false }) === true, "clean must pass");
});

check("N5 负向对照：idRuleViolation 能识别大写 / 点 / 保留 / 重复", () => {
  const existing = ["kimi", "deepseek"];
  assert(idRuleViolation("Kimi Work", existing) === "charset", "uppercase+space must fail");
  assert(idRuleViolation("kimi.work", existing) === "charset", "dot must fail");
  assert(idRuleViolation("mock", existing) === "reserved", "mock must fail");
  assert(idRuleViolation("kimi", existing) === "duplicate", "duplicate must fail");
  assert(idRuleViolation("kimi-work", existing) === null, "clean id must pass");
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

const providerPaneBody = functionBody(html, "renderProviderPane");
const selectProviderBody = functionBody(html, "selectProvider");
const confirmAddBody = functionBody(html, "confirmAdd");
const confirmDeleteBody = functionBody(html, "confirmDelete");
const validateIdBody = functionBody(html, "validateProviderId");
const renderNamingBody = functionBody(html, "renderNamingReadout");

check("S1 provider 路径不重渲染自动化开关", () => {
  assert(providerPaneBody.length > 200, `renderProviderPane body too short (${providerPaneBody.length})`);
  assert(selectProviderBody.length > 50, `selectProvider body too short (${selectProviderBody.length})`);
  for (const [name, body] of [
    ["renderProviderPane", providerPaneBody],
    ["selectProvider", selectProviderBody],
    ["confirmAdd", confirmAddBody],
    ["confirmDelete", confirmDeleteBody],
  ]) {
    assert(!/renderAutomationSwitches|automation-list|data-auto-row/.test(body), `${name} must not touch automation switches`);
  }
});

check("S2 自动化开关只在 render/resetSwitch 路径渲染", () => {
  const renderBody = functionBody(html, "render");
  const resetSwitchBody = functionBody(html, "resetSwitch");
  assert(/renderAutomation\(\);/.test(renderBody), "render() must call renderAutomation()");
  assert(/renderAutomationSwitches\(\);/.test(resetSwitchBody), "resetSwitch() must refresh switches");
  const callSites = html.match(/renderAutomationSwitches\(\);/g) || [];
  assert(callSites.length === 2, `renderAutomationSwitches() calls = ${callSites.length}, expected renderAutomation + resetSwitch`);
});

check("S3 自动化节在静态结构上与模型接入节平级、不在 provider 表单内", () => {
  const modelStart = html.indexOf('id="sec-model"');
  const autoStart = html.indexOf('id="sec-auto"');
  const providerPanelAt = html.indexOf('id="provider-panel"');
  const automationAt = html.indexOf("data-automation>");
  assert(modelStart > 0 && autoStart > 0 && providerPanelAt > 0 && automationAt > 0, "markers missing");
  const modelClose = html.indexOf("</section>", modelStart);
  assert(modelClose > modelStart && modelClose < autoStart, "model section must close before automation section");
  assert(providerPanelAt > modelStart && providerPanelAt < modelClose, "provider panel must sit inside the model section");
  assert(automationAt > autoStart, "automation pane must sit inside the automation section");
  assert(automationAt > modelClose, "automation must be outside the model section");
  assert((html.match(/data-automation(?=[\s>])/g) || []).length === 1, "automation pane marker must be unique");
  const switchesAt = html.indexOf("data-automation-switches");
  assert(switchesAt > automationAt, "switches must live inside the automation pane");
  assert((html.match(/data-automation-switches/g) || []).length === 1, "switches marker must be unique");
});

check("S4 自动化文案：节奏准确、无「每轮」", () => {
  const autoStart = html.indexOf('id="sec-auto"');
  const autoSection = html.slice(autoStart, html.indexOf("</section>", autoStart));
  const automationLiteral = html.slice(html.indexOf("const AUTOMATION = ["), html.indexOf("function renderNamingReadout"));
  const text = `${autoSection}\n${automationLiteral}`;
  assert(text.length > 300, `automation text too short (${text.length})`);
  assert(namingCadenceCopyOk(text), "automation copy must state first-turn / 5-turn / 3-turn / async and must not say 每轮");
  assert(!/下一轮/.test(text), "automation copy must not promise 下一轮");
  assert(/全局/.test(text), "automation copy must state it is global");
});

check("S5 模型来源写明 config.json，且无内置目录暗示", () => {
  const modelStart = html.indexOf('id="sec-model"');
  const modelSection = html.slice(modelStart, html.indexOf("</section>", modelStart));
  const text = `${modelSection}\n${providerPaneBody}\n${functionBody(html, "renderEmptyState")}`;
  assert(modelSourceCopyOk(text), "model source copy must name config.json / harness.providers / 不内置 and no catalog");
});

check("S6 provider 管理入口与 id 规则在源码里真实存在", () => {
  const modelStart = html.indexOf('id="sec-model"');
  const modelSection = html.slice(modelStart, html.indexOf("</section>", modelStart));
  const text = `${modelSection}\n${functionBody(html, "renderAddForm")}\n${functionBody(html, "renderEmptyState")}\n${functionBody(html, "renderProviderForm")}\n${functionBody(html, "renderDeleteCard")}\n${providerPaneBody}\n${confirmAddBody}`;
  assert(providerManagementCopyOk(text), "model pane must advertise add / delete / id / preset");
  assert(/data-provider-add|data-provider-add-empty/.test(html), "add entry missing");
  assert(/data-provider-delete/.test(html), "delete entry missing");
  assert(/data-add-confirm/.test(html), "add confirm missing");
  assert(!/固定两项|不能增删/.test(text), "must not describe a fixed provider set");
  assert(validateIdBody.length > 120, "validateProviderId body too short");
  assert(/RESERVED_IDS/.test(validateIdBody) && /ID_RE/.test(validateIdBody), "id validation must check charset + reserved ids");
  assert(/hasOwnProperty/.test(validateIdBody), "id validation must check duplicates");
});

check("S7 命名目标读数：跟随 / 覆盖 / 悬空 / vision 资格都有文案", () => {
  assert(renderNamingBody.length > 300, `renderNamingReadout body too short (${renderNamingBody.length})`);
  const text = `${renderNamingBody}\n${functionBody(html, "resolveNaming")}`;
  assert(text.includes("跟随当前"), "must say follows current provider");
  assert(text.includes("覆盖"), "must say override");
  assert(text.includes("悬空"), "must handle dangling override");
  assert(text.includes("vision"), "must show vision eligibility");
  assert(text.includes("一个目标") || /不会对每个 provider 各做一次/.test(text), "must deny per-provider fan-out");
});

check("S8 控制面板覆盖全部场景与 provider 操作", () => {
  const cpanelStart = html.indexOf('id="cpanel"');
  const cpanel = html.slice(cpanelStart, html.indexOf("<script>", cpanelStart));
  const scenes = [...cpanel.matchAll(/data-go="scene:([a-z-]+)"/g)].map((m) => m[1]);
  for (const scene of ["configured", "empty", "add", "delete", "unconfigured", "validation", "warning", "saving", "saved", "conflict", "file-invalid", "closed"]) {
    assert(scenes.includes(scene), `control panel missing scene ${scene}`);
  }
  assert(/data-toggle="add"/.test(cpanel), "control panel must expose add");
  assert(/data-toggle="delete"/.test(cpanel), "control panel must expose delete");
  assert(/data-toggle="advanced"/.test(cpanel), "control panel must expose advanced");
  assert(/data-go="theme:light"/.test(cpanel) && /data-go="theme:dark"/.test(cpanel) && /data-go="theme:eink"/.test(cpanel), "control panel must expose all themes");
  assert((html.match(/data-go="theme:/g) || []).length >= 3, "theme buttons missing");
});

// ── 浏览器交互断言（可选依赖 Playwright） ────────────────────────────────────

function findPlaywright() {
  const candidates = [
    path.join(repoRoot, "tests/visual/node_modules/@playwright/test/index.mjs"),
    path.resolve(repoRoot, "../../../tests/visual/node_modules/@playwright/test/index.mjs"),
    path.resolve(repoRoot, "../../tests/visual/node_modules/@playwright/test/index.mjs"),
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
  const url = (query) => `${pathToFileURL(prototypePath).href}?${query}`;
  const switchSignature = () =>
    page.locator("[data-automation-switches] [data-auto-row]").evaluateAll((els) =>
      els.map((el) => `${el.dataset.autoRow}:${el.querySelector("[data-switch]").getAttribute("aria-checked")}`),
    );
  const switchHtml = () => page.locator("[data-automation-switches]").evaluate((el) => el.outerHTML);

  try {
    await page.goto(url("theme=light&scene=configured&panel=0"));
    await page.waitForSelector("#settings-panel", { state: "attached" });

    await checkAsync("B1 自动化只有一个全局实例、四个开关、不在 provider 表单内", async () => {
      assert((await page.locator("[data-automation]").count()) === 1, "expected exactly one automation pane");
      assert((await page.locator("#provider-panel [data-auto-row]").count()) === 0, "automation must not render inside provider form");
      const keys = await page.locator("[data-automation-switches] [data-auto-row]").evaluateAll((els) =>
        els.map((el) => el.dataset.autoRow),
      );
      assert(
        !automationOwnershipViolation({ inProviderForm: 0, totalRows: keys.length, keys }),
        `automation rows must be the four global keys in order, got ${keys.join(",")}`,
      );
    });

    await checkAsync("B2 切换 provider 只换表单：开关 DOM 不变、读数为当前 provider", async () => {
      const before = await switchHtml();
      await page.click('[data-provider-select="deepseek"]');
      const after = await switchHtml();
      assert(before === after, "switches changed after provider selection");
      assert((await page.locator("#provider-panel .provider-title").innerText()) === "deepseek", "selected form did not switch");
      const naming = await page.locator("[data-naming-target='session']").innerText();
      assert(naming.includes("kimi") && naming.includes("k3-256k"), `naming target should follow active kimi, got ${naming}`);
      assert((await page.locator("[data-current-badge]").count()) === 1, "current badge must stay unique");
    });

    await checkAsync("B3 添加 provider：重复 id 被拒、新 id 选中、开关 DOM 不变", async () => {
      const before = await switchHtml();
      await page.click("[data-provider-add]");
      assert((await page.locator("[data-add-card]").count()) === 1, "add card missing");
      await page.fill("[data-add-id]", "deepseek");
      await page.click("[data-add-confirm]");
      const duplicate = await page.locator("#add-id-error").innerText();
      assert(/已存在/.test(duplicate), `duplicate id should be rejected, got ${duplicate}`);
      await page.fill("[data-add-id]", "Kimi Work");
      await page.click("[data-add-confirm]");
      const charset = await page.locator("#add-id-error").innerText();
      assert(/小写字母/.test(charset), `invalid charset should be rejected, got ${charset}`);
      await page.fill("[data-add-id]", "kimi-work");
      await page.click("[data-add-confirm]");
      assert((await page.locator("[data-provider-select]").count()) === 4, "new provider should appear");
      assert((await page.locator("#provider-panel .provider-title").innerText()) === "kimi-work", "new provider should be selected");
      assert((await page.locator("[data-current-badge]").count()) === 1, "adding a non-first provider must not change active");
      assert((await switchHtml()) === before, "switches changed after add");
    });

    await checkAsync("B4 删除保护：当前使用项 + 命名引用 + 草稿提示，确认后重定向", async () => {
      await page.goto(url("theme=light&scene=delete&panel=0"));
      const cardText = await page.locator("[data-delete-card]").innerText();
      assert((await page.locator("[data-delete-active]").count()) === 1, "active replacement block missing");
      assert((await page.locator("[data-delete-session]").count()) === 1, "session naming retarget block missing");
      assert((await page.locator("[data-delete-attachment]").count()) === 1, "attachment naming retarget block missing");
      assert((await page.locator("[data-delete-draft]").count()) === 1, "draft notice missing");
      assert(
        deleteGuardOk({
          hasActiveSelect: (await page.locator("[data-delete-active-after]").count()) > 0,
          hasNamingSelect: (await page.locator("[data-delete-session-after]").count()) > 0
            && (await page.locator("[data-delete-attachment-after]").count()) > 0,
          hasDraftNotice: (await page.locator("[data-delete-draft]").count()) > 0,
          hasLastNotice: (await page.locator("[data-delete-last]").count()) > 0,
        }),
        `delete guard incomplete: ${cardText}`,
      );
      const before = await switchHtml();
      await page.selectOption("[data-delete-active-after]", "local-lab");
      await page.selectOption("[data-delete-session-after]", "follow");
      await page.selectOption("[data-delete-attachment-after]", "follow");
      await page.click("[data-delete-confirm]");
      const ids = await page.locator("[data-provider-select]").evaluateAll((els) => els.map((el) => el.dataset.providerSelect));
      assert(!ids.includes("kimi"), `kimi should be deleted, got ${ids.join(",")}`);
      const current = await page.locator("[data-current-badge]").evaluateAll((els) =>
        els.map((el) => el.parentElement.querySelector(".provider-name").textContent),
      );
      assert(current.join(",") === "local-lab", `active should move to local-lab, got ${current.join(",")}`);
      const naming = await page.locator("[data-naming-readout]").innerText();
      assert(!naming.includes("kimi"), "naming readout must not keep the deleted id");
      assert((await switchHtml()) === before, "switches changed after delete");
    });

    await checkAsync("B5 空清单：空态、添加第一个 provider 自动成为当前", async () => {
      await page.goto(url("theme=light&scene=empty&panel=0"));
      assert((await page.locator("[data-provider-empty]").count()) === 1, "empty state missing");
      assert((await page.locator("[data-provider-select]").count()) === 0, "empty scene must have no provider rows");
      await page.click("[data-provider-add-empty]");
      await page.fill("[data-add-id]", "local-first");
      await page.click('[data-add-preset="generic"]');
      await page.click("[data-add-confirm]");
      assert((await page.locator("[data-provider-select]").count()) === 1, "first provider should appear");
      assert((await page.locator("[data-current-badge]").count()) === 1, "first provider should become active");
      const naming = await page.locator("[data-naming-target='attachment']").innerText();
      assert(naming.includes("local-first"), `naming target should point to the new provider, got ${naming}`);
      await page.click("[data-save]");
      await page.waitForTimeout(700);
      assert((await page.locator("#save-status").innerText()).includes("已保存"), "an empty generic provider must be savable as a half-finished entry");
    });

    await checkAsync("B6 命名目标读数：vision 资格与悬空回落", async () => {
      await page.goto(url("theme=light&scene=warning&panel=0"));
      const attachment = await page.locator("[data-naming-target='attachment']").innerText();
      const stateText = await page.locator(".naming-line").nth(1).locator(".naming-state").innerText();
      assert(attachment.includes("kimi"), `dangling override should fall back to active kimi, got ${attachment}`);
      assert(/悬空/.test(stateText), `dangling state must be visible, got ${stateText}`);
      const session = await page.locator(".naming-line").nth(0).locator(".naming-state").innerText();
      assert(!/悬空/.test(session), "session target should not be marked dangling");
    });

    await checkAsync("B7 还原此页默认保留 provider 条目、清空字段并可保存", async () => {
      await page.goto(url("theme=light&scene=configured&panel=0"));
      await page.click("[data-reset-page]");
      assert((await page.locator("[data-provider-select]").count()) === 3, "reset must keep provider entries");
      assert((await page.locator("[data-current-badge]").count()) === 0, "reset must delete the active provider key");
      assert((await page.locator("[data-model-row]").count()) === 0, "reset must clear model rows");
      assert((await page.locator("#save-status").innerText()).includes("有未保存的修改"), "reset should make the draft dirty");
      await page.click("[data-save]");
      await page.waitForTimeout(700);
      assert((await page.locator("#save-status").innerText()).includes("已保存"), "reset result must be savable");
    });

    await checkAsync("B8 同一笔保存不允许复用被删 id", async () => {
      await page.goto(url("theme=light&scene=configured&panel=0"));
      await page.click('[data-provider-select="local-lab"]');
      await page.click("[data-provider-delete]");
      await page.click("[data-delete-confirm]");
      await page.click("[data-provider-add]");
      await page.fill("[data-add-id]", "local-lab");
      await page.click("[data-add-confirm]");
      const error = await page.locator("#add-id-error").innerText();
      assert(/本笔已删除/.test(error), `reusing a deleted id must be rejected, got ${error}`);
      await page.click("[data-add-cancel]");
      await page.click("[data-save]");
      await page.waitForTimeout(700);
      assert((await page.locator("#save-status").innerText()).includes("已保存"), "delete should save");
      await page.click("[data-provider-add]");
      await page.fill("[data-add-id]", "local-lab");
      await page.click("[data-add-confirm]");
      assert((await page.locator("[data-provider-select]").count()) === 3, "after saving the delete, the same id can be added again");
    });

    await checkAsync("B9 设为当前使用：active 与命名读数切换、开关 DOM 不变", async () => {
      await page.goto(url("theme=light&scene=configured&panel=0"));
      const before = await switchHtml();
      await page.click('[data-provider-select="deepseek"]');
      await page.click("[data-set-active]");
      const current = await page.locator("[data-current-badge]").evaluateAll((els) =>
        els.map((el) => el.parentElement.querySelector(".provider-name").textContent),
      );
      assert(current.join(",") === "deepseek", `active should move to deepseek, got ${current.join(",")}`);
      const naming = await page.locator("[data-naming-target='session']").innerText();
      assert(naming.includes("deepseek") && naming.includes("ds-chat"), `naming readout should follow the new active, got ${naming}`);
      assert((await switchHtml()) === before, "switches changed after setting the active provider");
    });

    await checkAsync("B10 控制面板全部选项点击可达", async () => {
      await page.goto(url("theme=light&scene=configured"));
      for (const scene of ["configured", "empty", "add", "delete", "unconfigured", "validation", "warning", "saving", "saved", "conflict", "file-invalid", "closed"]) {
        await page.click(`[data-go="scene:${scene}"]`);
        const active = await page.evaluate(() => document.body.dataset.scene);
        assert(active === scene, `scene button ${scene} did not activate (got ${active})`);
      }
      await page.click('[data-go="scene:configured"]');
      for (const theme of ["dark", "eink", "light"]) {
        await page.click(`[data-go="theme:${theme}"]`);
        const active = await page.evaluate(() => document.documentElement.dataset.theme);
        assert(active === theme, `theme button ${theme} did not activate (got ${active})`);
      }
      await page.click('[data-go="provider:deepseek"]');
      const selected = await page.locator(".provider-item.is-on").getAttribute("data-provider-select");
      assert(selected === "deepseek", `provider button did not select deepseek (got ${selected})`);
      await page.click('[data-toggle="add"]');
      assert((await page.locator("[data-add-card]").count()) === 1, "add toggle did not open the add form");
      await page.click("[data-add-cancel]");
      await page.click('[data-toggle="delete"]');
      assert((await page.locator("[data-delete-card]").count()) === 1, "delete toggle did not open the delete card");
      await page.click("[data-delete-cancel]");
      await page.click('[data-toggle="advanced"]');
      assert((await page.locator("[data-advanced]").isVisible()), "advanced toggle did not expand");
      await page.click('[data-toggle="advanced"]');
      assert(!(await page.locator("[data-advanced]").isVisible()), "advanced toggle did not collapse");
    });

    await checkAsync("B11 全部场景 × 三主题无 JS 错误、无横向溢出", async () => {
      const scenes = ["configured", "empty", "add", "delete", "unconfigured", "validation", "warning", "saving", "saved", "conflict", "file-invalid", "closed"];
      for (const theme of ["light", "dark", "eink"]) {
        for (const scene of scenes) {
          await page.goto(url(`theme=${theme}&scene=${scene}&panel=0`));
          await page.waitForTimeout(20);
          if (!["closed"].includes(scene)) {
            const overflow = await page.evaluate(() => {
              const body = document.querySelector("#settings-panel .settings-body");
              return body.scrollWidth > body.clientWidth + 1;
            });
            assert(!overflow, `horizontal overflow in ${theme}/${scene}`);
          }
        }
      }
      assert(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
    });
  } finally {
    await browser.close();
  }
}

console.log(`PROTOTYPE  ${prototypePath}`);
await browserChecks();

const failed = results.filter((entry) => !entry.ok);
console.log(`\nRESULT: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
if (failed.length) {
  process.exitCode = 1;
}
