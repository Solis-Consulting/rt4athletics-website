#!/usr/bin/env node
/**
 * Capture marketing screenshots from the local RT4Athletics V4 dashboard.
 *
 * School IDs and nav surfaces are data-driven. One pipeline, not 17 scripts.
 *
 * Prerequisite: V4 dashboard serving at http://127.0.0.1:8765
 *   from ~/rt4athletics-acc  →  python3 -m rt4athletics ui-serve
 */
import { mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "assets", "product");

const DASHBOARD_ORIGIN = process.env.RT4_DASHBOARD_ORIGIN || "http://127.0.0.1:8765";
const DASHBOARD_PATH = "/rt4athletics_v4_dashboard.html";

const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const DEVICE_SCALE = 2;
const NAV_TIMEOUT_MS = 25_000;
const SURFACE_TIMEOUT_MS = 45_000;
const SETTLE_MS = 700;

const SCHOOLS = Object.freeze([
  "bc",
  "cal",
  "clemson",
  "duke",
  "fsu",
  "georgiatech",
  "louisville",
  "miami",
  "ncstate",
  "pitt",
  "smu",
  "stanford",
  "syracuse",
  "uva",
  "vtech",
  "wakeforest",
]);

const SURFACES = Object.freeze([
  {
    id: "decisions",
    file: "decision-center.webp",
    ready: ".v4-dc__cockpit .v4-dc-table tbody tr",
    loadingText: /Loading capital command/i,
  },
  {
    id: "market",
    file: "market-context.webp",
    ready: ".v4-acc-table tbody tr",
    loadingText: /Loading market context/i,
    minRows: 10,
  },
  {
    id: "scenarios",
    file: "scenario-lab.webp",
    ready: ".v4-scenarios .v4-sc-kpis",
    loadingText: /Loading ACC replacements/i,
  },
]);

/** Hero-ready copies. Mix of surfaces so the site reads as a platform. */
const FEATURED = Object.freeze([
  { school: "miami", file: "decision-center.webp" },
  { school: "clemson", file: "decision-center.webp" },
  { school: "smu", file: "market-context.webp" },
  { school: "wakeforest", file: "scenario-lab.webp" },
  { school: "duke", file: "decision-center.webp" },
]);

const HIDE_CHROME_CSS = `
  #v4LoadStatus,
  .v4-conf-stub,
  .v4-search-hits,
  [data-agent-debug],
  [data-cursor-debug] {
    display: none !important;
  }
`;

function dashboardUrl(schoolId) {
  return `${DASHBOARD_ORIGIN}${DASHBOARD_PATH}?school=${encodeURIComponent(schoolId)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertDashboardUp() {
  const url = `${DASHBOARD_ORIGIN}${DASHBOARD_PATH}`;
  let res;
  try {
    res = await fetch(url, { method: "GET" });
  } catch (err) {
    throw new Error(
      `Dashboard not reachable at ${DASHBOARD_ORIGIN}.\n` +
        `Start it from ~/rt4athletics-acc:\n` +
        `  python3 -m rt4athletics ui-serve\n` +
        `(${err.message})`
    );
  }
  if (!res.ok) {
    throw new Error(`Dashboard responded ${res.status} at ${url}`);
  }
}

async function waitForSchool(page, schoolId) {
  if (schoolId === "unc") {
    throw new Error("UNC views are excluded from marketing captures.");
  }
  const app = page.locator(".v4-app");
  await app.waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await page.waitForFunction(
    (id) => document.querySelector(".v4-app")?.dataset?.school === id,
    schoolId,
    { timeout: NAV_TIMEOUT_MS }
  );
  const resolved = await app.getAttribute("data-school");
  if (resolved !== schoolId) {
    throw new Error(
      `School ${schoolId} did not resolve (data-school="${resolved || ""}"). ` +
        `Unknown IDs fall back to UNC — refusing to capture the wrong program.`
    );
  }
  const status = (await page.locator("#v4LoadStatus").textContent().catch(() => "")) || "";
  if (/failed to load/i.test(status)) {
    throw new Error(`${schoolId}: dashboard failed to load — ${status.trim()}`);
  }
}

async function openSurface(page, surface) {
  const nav = page.locator(`.v4-nav__item[data-v4-nav="${surface.id}"]`);
  if ((await nav.count()) === 0) {
    throw new Error(`Nav control missing for surface "${surface.id}"`);
  }
  const already = await nav.evaluate((el) => el.classList.contains("is-active"));
  if (!already) {
    await nav.click();
  }
  await page.locator(surface.ready).first().waitFor({
    state: "visible",
    timeout: SURFACE_TIMEOUT_MS,
  });

  if (surface.minRows) {
    await page.waitForFunction(
      ({ sel, min }) => document.querySelectorAll(sel).length >= min,
      { sel: surface.ready, min: surface.minRows },
      { timeout: SURFACE_TIMEOUT_MS }
    );
  }

  if (surface.loadingText) {
    const deadline = Date.now() + SURFACE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const body = await page.locator("#v4Table").innerText();
      if (!surface.loadingText.test(body)) break;
      await sleep(200);
    }
    const body = await page.locator("#v4Table").innerText();
    if (surface.loadingText.test(body)) {
      throw new Error(`Surface "${surface.id}" still shows a loading state`);
    }
  }

  const status = (await page.locator("#v4LoadStatus").textContent().catch(() => "")) || "";
  if (/failed to load|roster api failed/i.test(status)) {
    throw new Error(`Surface "${surface.id}" rendered with error: ${status.trim()}`);
  }

  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await sleep(SETTLE_MS);
}

async function hideDevChrome(page) {
  await page.addStyleTag({ content: HIDE_CHROME_CSS });
}

async function writeWebp(pngBuffer, dest) {
  await sharp(pngBuffer).webp({ quality: 82 }).toFile(dest);
}

async function captureSurface(page, schoolId, surface) {
  await openSurface(page, surface);
  const destDir = path.join(OUT_ROOT, schoolId);
  await mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, surface.file);
  const png = await page.screenshot({
    type: "png",
    fullPage: false,
    animations: "disabled",
  });
  await writeWebp(png, dest);
  return dest;
}

async function copyFeatured() {
  const featuredDir = path.join(OUT_ROOT, "featured");
  await mkdir(featuredDir, { recursive: true });
  const copied = [];
  for (const item of FEATURED) {
    const src = path.join(OUT_ROOT, item.school, item.file);
    if (!existsSync(src)) {
      throw new Error(`Featured source missing: ${src}`);
    }
    const stem = item.file.replace(/\.webp$/, "");
    const dest = path.join(featuredDir, `${item.school}-${stem}.webp`);
    await copyFile(src, dest);
    copied.push(path.relative(ROOT, dest));
  }
  return copied;
}

function printSummary(results, featured, elapsedMs) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log("── capture summary ──");
  console.log(`dashboard:  ${DASHBOARD_ORIGIN}${DASHBOARD_PATH}`);
  console.log(`viewport:   ${VIEWPORT.width}×${VIEWPORT.height} @${DEVICE_SCALE}x`);
  console.log(`schools:    ${SCHOOLS.length}`);
  console.log(`surfaces:   ${SURFACES.map((s) => s.file.replace(".webp", "")).join(", ")}`);
  console.log(`captured:   ${ok.length}`);
  console.log(`failed:     ${failed.length}`);
  console.log(`featured:   ${featured.length}`);
  console.log(`elapsed:    ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`output:     ${path.relative(ROOT, OUT_ROOT)}/`);
  if (ok.length) {
    console.log("");
    console.log("ok:");
    for (const r of ok) console.log(`  ${r.school}/${r.file}`);
  }
  if (featured.length) {
    console.log("");
    console.log("featured:");
    for (const f of featured) console.log(`  ${f}`);
  }
  if (failed.length) {
    console.log("");
    console.log("failed:");
    for (const r of failed) console.log(`  ${r.school}/${r.file} — ${r.error}`);
  }
  console.log("─────────────────────");
}

async function main() {
  const started = Date.now();
  await assertDashboardUp();

  await rm(OUT_ROOT, { recursive: true, force: true });
  await mkdir(OUT_ROOT, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });

  const results = [];
  let featured = [];

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(SURFACE_TIMEOUT_MS);
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
    });

    for (const schoolId of SCHOOLS) {
      process.stdout.write(`\n[${schoolId}] loading…`);
      await page.goto(dashboardUrl(schoolId), {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      await waitForSchool(page, schoolId);
      await hideDevChrome(page);
      process.stdout.write(" ready\n");

      for (const surface of SURFACES) {
        try {
          const dest = await captureSurface(page, schoolId, surface);
          results.push({ ok: true, school: schoolId, file: surface.file, dest });
          console.log(`  ✓ ${surface.file}`);
        } catch (err) {
          const message = err && err.message ? err.message : String(err);
          results.push({ ok: false, school: schoolId, file: surface.file, error: message });
          console.error(`  ✗ ${surface.file} — ${message}`);
        }
      }
    }

    const anyFailed = results.some((r) => !r.ok);
    if (!anyFailed) {
      featured = await copyFeatured();
    }
  } finally {
    await browser.close();
  }

  printSummary(results, featured, Date.now() - started);

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    process.exitCode = 1;
    throw new Error(`${failed.length} capture(s) failed. See summary above.`);
  }
}

main().catch((err) => {
  console.error(`\nmedia:capture failed: ${err.message || err}`);
  process.exitCode = 1;
});
