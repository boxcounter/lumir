import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// eink 降级规则逐条落地（change restyle-ui-tokens-v1，tasks §7.1）：
// tokens 文档 §eink 规则 的 9 条各自至少一条计算属性断言。主题经桩的 `config.theme`
// 走真实配置通道（见 restyle-theme.spec.ts 的文件头）。
//
// 逐条对号：
//   ① 色彩退场（含 tint = transparent）        → 「规则①」
//   ② 字重 / 明度承担对比（keyword 700、comment 灰）→ 「规则②」
//   ③ 实心黑 hairline（结构档黑、层次档保留灰）  → 「规则③」
//   ④ 选中态黑底反白（含组件内次级元素手工反白） → 「规则④」
//   ⑤ 浅底区块翻白底黑框（代码块 / fm）         → 「规则⑤」
//   ⑥ chip 描边化                              → 「规则⑥」
//   ⑦ 阴影退场                                  → 「规则⑦」
//   ⑧ 强调档改由线宽承担（1.2–1.6px）           → 「规则⑧」
//   ⑨ wikilink 药丸降级为下划线                 → 「规则⑨」

const DOC = [
  "---",
  "title: 主题",
  "status: open",
  "---",
  "",
  "# 标题",
  "",
  "正文含 [[guide]] 链接。",
  "",
  "```js",
  "// 注释",
  "const x = 1;",
  "```",
  "",
  "> [!note] 提示",
  "> callout 正文。",
  "",
].join("\n");

const VAULT = {
  entries: [
    { path: "doc.md", kind: "file", size: DOC.length, mtime_ms: 0 },
    { path: "guide.md", kind: "file", size: 8, mtime_ms: 0 },
  ],
  files: { "doc.md": DOC, "guide.md": "# Guide\n" },
  links: {
    "[[guide]]": {
      status: "resolved",
      path: "guide.md",
      candidates: [],
      embed_target: null,
      anchor: { status: "none", heading: null, line: null },
    },
  },
};

async function openEink(page: Page): Promise<void> {
  await stubTauri(page, { ...VAULT, config: { theme: "eink" } });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("eink");
  await page.locator('.ft-row[title="doc.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("正文含");
}

/** token 的**计算值**：把 `var(--x)` 落到一个探针元素的 background 上再读回。
 *
 *  为什么不直接 `getPropertyValue`：自定义属性的原文形态不保证可比——Chromium 会把颜色类取值
 *  按其最短形式序列化（本仓 eink 块写 `#000000`，读回是 `#000`），拿字面量比会在「其实相等」时红。
 *  落到计算属性上则两侧都是 `rgb(...)` / `rgba(...)`（transparent 读得到 alpha），与取值写法解耦。 */
function tokenColors(page: Page, names: string[]) {
  return page.evaluate((list: string[]) => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const values: Record<string, string> = {};
    for (const name of list) {
      probe.style.backgroundColor = `var(${name})`;
      values[name] = getComputedStyle(probe).backgroundColor;
    }
    probe.remove();
    return values;
  }, names);
}

/** eink 作用域里的线宽声明（CSSOM 原文）。见「规则⑧」的说明：亚像素 border-width 在
 *  deviceScaleFactor=1 下会被向下取整到整数设备像素，计算值判不出 1.4px 与 1px 的差别。 */
function einkBorderWidthDeclarations(page: Page, widths: string[]) {
  return page.evaluate((wanted: string[]) => {
    const hits: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      for (const rule of [...(sheet.cssRules ?? [])]) {
        const text = rule.cssText ?? "";
        if (!text.includes('data-theme="eink"')) continue;
        for (const width of wanted) {
          if (text.includes(`border-width: ${width}`) || text.includes(`border-bottom-width: ${width}`)) {
            hits.push(text);
          }
        }
      }
    }
    return hits;
  }, widths);
}

const SEMANTIC = ["--accent", "--run", "--ok", "--pending", "--danger", "--tk-k", "--tk-s", "--tk-n"];
const TINTS = ["--accent-tint", "--ok-tint", "--pending-tint", "--danger-tint"];

test("规则①：色彩退场——语义色全黑，全部 tint = transparent", async ({ page }) => {
  await openEink(page);
  const colors = await tokenColors(page, [...SEMANTIC, ...TINTS]);
  for (const name of SEMANTIC) {
    expect(colors[name], `${name} 应解析为纯黑`).toBe("rgb(0, 0, 0)");
  }
  for (const name of TINTS) {
    expect(colors[name], `${name} 应为透明（无 alpha 之外的分量）`).toBe("rgba(0, 0, 0, 0)");
  }
  // 正文文字黑、底色白（eink 的对比全部来自明度与字重）
  const surfaces = await tokenColors(page, ["--text", "--content-bg"]);
  expect(surfaces["--text"]).toBe("rgb(0, 0, 0)");
  expect(surfaces["--content-bg"]).toBe("rgb(255, 255, 255)");
});

test("规则②：字重 / 明度承担对比——keyword 700、comment 灰", async ({ page }) => {
  await openEink(page);
  const keyword = page.locator(".cm-lp-tok-keyword").first();
  await expect(keyword).toBeVisible();
  const now = await page.evaluate(() => ({
    weight: getComputedStyle(document.querySelector(".cm-lp-tok-keyword")!).fontWeight,
    color: getComputedStyle(document.querySelector(".cm-lp-tok-keyword")!).color,
    comment: getComputedStyle(document.querySelector(".cm-lp-tok-comment")!).color,
  }));
  expect(now.weight).toBe("700");
  expect(now.color).toBe("rgb(0, 0, 0)");
  expect(now.comment).toBe("rgb(110, 110, 110)");
  // 明度差成立：注释（灰）与代码（黑）不同明度
  expect(now.comment).not.toBe(now.color);
});

test("规则③：hairline——结构档实心黑、层次档保留灰", async ({ page }) => {
  await openEink(page);
  const borders = await tokenColors(page, ["--border", "--border-soft"]);
  expect(borders["--border"]).toBe("rgb(0, 0, 0)");
  expect(borders["--border-soft"]).toBe("rgb(185, 185, 185)");
  // 结构档真的落在某个平铺表面的边线上（token 有消费者），且比层次档深
  const sidebarBorder = await page.locator(".pane-filetree").evaluate((el) => getComputedStyle(el).borderRightColor);
  expect(sidebarBorder).toBe("rgb(0, 0, 0)");
});

test("规则④：选中态黑底反白，组件内次级元素手工反白", async ({ page }) => {
  await openEink(page);
  // 指针移开文件树：悬停底色（`--hover`）在同一心智模型下压过选中底色（`.ft-row:hover` 声明在
  // `.ft-row.is-current` 之后），指针停在该行上时读到的不是本规则要验的形态。
  await page.mouse.move(640, 700);
  const row = page.locator(".ft-row.is-current").first();
  await expect(row).toHaveCount(1);
  // 过渡（0.1s）落定后再读：底色从 --hover 切到 --sel 的中间帧是插值出来的半透明黑
  await expect
    .poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor), { message: "选中行底色 = --sel" })
    .toBe("rgb(0, 0, 0)");
  expect(await row.evaluate((el) => getComputedStyle(el.querySelector(".ft-name")!).color)).toBe("rgb(255, 255, 255)");
  // 次级元素（caret / 当前标记）与文字一样手工反白——行内没有颜色继承链
  const secondary = await row.evaluate((el) => {
    const caret = el.querySelector(".ft-caret");
    const mark = el.querySelector(".ft-current-mark");
    return {
      caret: caret ? getComputedStyle(caret).color : null,
      mark: mark ? getComputedStyle(mark).color : null,
    };
  });
  for (const [name, value] of Object.entries(secondary)) {
    if (value !== null) expect(value, `${name} 应手工反白`).toBe("rgb(255, 255, 255)");
  }
  // 配套：悬停态不是白底白字（`:hover` 下底色回到 --hover，文字必须回到常字色）
  await row.hover();
  await expect
    .poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor), { message: "悬停态底色 = --hover" })
    .toBe("rgba(0, 0, 0, 0.06)");
  expect(
    await row.evaluate((el) => getComputedStyle(el.querySelector(".ft-name")!).color),
    "悬停态文字必须可读（不能是白的）",
  ).toBe("rgb(0, 0, 0)");
  // token 层：选中前景只由 eink 定义（light / dark 不写这一条）
  const sel = await tokenColors(page, ["--sel", "--sel-text"]);
  expect(sel["--sel"]).toBe("rgb(0, 0, 0)");
  expect(sel["--sel-text"]).toBe("rgb(255, 255, 255)");
});

test("规则⑤：浅底区块翻转为白底黑框（代码块 / frontmatter）", async ({ page }) => {
  await openEink(page);
  const code = await page.locator(".cm-lp-codeblock-scroll").evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, width: style.borderTopWidth, color: style.borderTopColor };
  });
  expect(code.background).toBe("rgb(255, 255, 255)");
  expect(code.width).toBe("1px");
  expect(code.color).toBe("rgb(0, 0, 0)");
  const fm = await page.locator(".cm-lp-frontmatter").evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, width: style.borderTopWidth, color: style.borderTopColor };
  });
  expect(fm.background).toBe("rgb(255, 255, 255)");
  expect(fm.width).toBe("1px");
  expect(fm.color).toBe("rgb(0, 0, 0)");
});

test("规则⑥：chip 描边化（fm status 底色退场、实心黑框）", async ({ page }) => {
  await openEink(page);
  const chip = await page.locator(".cm-lp-fm-status").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, width: style.borderTopWidth, color: style.borderTopColor };
  });
  expect(chip.background).toBe("rgba(0, 0, 0, 0)");
  expect(chip.width).toBe("1px");
  expect(chip.color).toBe("rgb(0, 0, 0)");
});

test("规则⑦：阴影全退场（两档 token 均为 none，且没有别的投影）", async ({ page }) => {
  await openEink(page);
  const shadows = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      pop: root.getPropertyValue("--shadow-pop").trim(),
      raise: root.getPropertyValue("--shadow-raise").trim(),
      tab: getComputedStyle(document.querySelector(".tab.is-active")!).boxShadow,
    };
  });
  expect(shadows.pop).toBe("none");
  expect(shadows.raise).toBe("none");
  expect(shadows.tab).toBe("none");
});

test("规则⑧：强调档改由线宽承担（eink 块里的 1.4px / 1.6px 声明）", async ({ page }) => {
  await openEink(page);
  // **判声明不判计算值**：chromium 在 deviceScaleFactor=1（本套件与 CI runner 的口径）下把
  // 亚像素 border-width 向下取整到整数设备像素——实测 1.2 / 1.4 / 1.6 / 1.8px 全部计算为 1px
  // （2.4px → 2px）。也就是说 1.4px 与 1px 在这个环境下**不可区分**，拿计算值判会让这条规则
  // 既无法验证也无法反证。CSSOM 同源可读，因此判据是「eink 作用域里存在该线宽声明」，
  // 并配一条「阴影不存在」的下半条（强调靠线宽而非投影）。
  const hits = await einkBorderWidthDeclarations(page, ["1.4px", "1.6px"]);
  expect(hits.some((text) => text.includes("1.4px")), `1.4px 声明：${hits.join(" | ") || "未命中"}`).toBe(true);
  expect(hits.some((text) => text.includes("1.6px")), `1.6px 声明：${hits.join(" | ") || "未命中"}`).toBe(true);
  const shadow = await page.locator(".tab.is-active").evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow, "强调不能靠投影（规则⑦）").toBe("none");
  // 反证：light 主题下没有这两条声明（否则「有声明」这条判据在任何主题下都恒真）
  const lightHits = await page.evaluate(() => {
    const hits: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      for (const rule of [...(sheet.cssRules ?? [])]) {
        const text = rule.cssText ?? "";
        if (text.includes("1.4px") || text.includes("1.6px")) hits.push(text.slice(0, 80));
      }
    }
    return hits;
  });
  expect(lightHits.every((text) => text.includes('data-theme="eink"')), `非 eink 的亚像素线宽：${lightHits.join(" | ")}`).toBe(true);
});

test("规则⑨：wikilink 药丸降级为下划线（底色退场、线型标识）", async ({ page }) => {
  await openEink(page);
  const link = await page.locator(".cm-lp-wikilink-resolved").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      background: style.backgroundColor,
      decoration: style.textDecorationLine,
      color: style.color,
    };
  });
  expect(link.background).toBe("rgba(0, 0, 0, 0)");
  expect(link.decoration).toContain("underline");
  expect(link.color).toBe("rgb(0, 0, 0)");
});
