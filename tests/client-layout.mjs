import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root, configFile: false, server: { host: "127.0.0.1", port: 4178, strictPort: true },
  resolve: { alias: { "@": root } },
  plugins: [react(), {
    name: "local-layout-fixture",
    resolveId(id) { if (id === "next/navigation") return "\0layout-navigation"; },
    load(id) { if (id === "\0layout-navigation") return "export const useRouter = () => ({replace() {}, refresh() {}});"; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/") return next();
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml("/", '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/layout-harness.tsx"></script></body></html>'));
      });
    },
  }],
});
await server.listen();
const service = { id: "commercial-loading", label: "Товарене на търговски пратки (линеен метър)", unit: "linear_m", rate: 5 };
const kilometer = { ni: .09, di: .08 };
const document = {
  version: 10,
  drivers: [{ id: "ni", name: "NI", rate: .09, level: "senior", color: "#62e6a7" }, { id: "di", name: "DI", rate: .08, level: "junior", color: "#ffb86b" }],
  trips: [{ id: "trip", number: "1919", departureDate: "2026-10-04", totalKilometers: 4854, restDays: 0, pricing: { kilometer, restPerDay: 70 } }],
  entries: [{ id: "client", tripId: "trip", date: "2026-10-04", documentNo: "SEE-TEST", client: "Test client with a long name", direction: "outbound", reference: "", country: "BG", kilometers: 0, workAmount: 0, activity: service.label, rateItemId: service.id, quantity: 5, driverIds: ["ni", "di"], vehicleClass: "up-to-8-8", pricing: { service: { ...service, minimum: 0 }, kilometer } }],
  settings: { vehicle: "TEST", vehicleClass: "up-to-8-8", singleDriverKilometerRate: .17, currency: "EUR", company: "Test" },
  rates: { effectiveDate: "2026-01-01", minimumBusiness: 20, restPerDay: 70, kilometer: { "up-to-8-8": { senior: .09, junior: .08 }, "up-to-11-99": { senior: .1, junior: .09 } }, activities: [service] },
};

try {
  for (const engine of (process.env.LAYOUT_ENGINES === "chromium" ? [chromium] : [chromium, webkit])) {
    const browser = await engine.launch({ headless: true, ...(engine.name() === "chromium" && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    try {
      for (const width of [320, 375, 393, 430, 768, 1024, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.route("**/api/ledger", route => route.fulfill({ json: { document, revision: 1 } }));
        await page.goto("http://127.0.0.1:4178");
        await page.getByRole("tab", { name: "Настройки", exact: true }).click();
        assert.equal(await page.locator(".settings-menu-button").count(), 3);
        assert.equal(await page.getByText("Изтриване на данни", { exact: true }).count(), 0);
        assert.ok(await page.locator(".settings-home-footer").getByRole("button", { name: "Изход" }).isVisible());
        for (const [section, field] of [["Профил", "#report-name"], ["Превозно средство", "#vehicle"], ["Шофьори", "#single-driver-rate"]]) {
          await page.locator(".settings-menu-button").filter({ hasText: section }).click();
          await page.getByRole("heading", { name: section, exact: true }).waitFor();
          assert.ok(await page.locator(field).isVisible());
          assert.equal(await page.locator(".settings-menu").count(), 0);
          await page.getByRole("button", { name: "Назад към настройките" }).click();
          assert.equal(await page.locator(field).count(), 0);
        }
        await page.getByRole("tab", { name: "Командировки", exact: true }).click();
        await page.locator(".trip-card").click();
        if (await page.locator(".mobile-entry-card").isVisible()) {
          await page.locator(".mobile-entry-card").click();
        } else {
          await page.getByRole("button", { name: "Действия за записа" }).click();
          await page.getByRole("menuitem", { name: /Редактирай/ }).click();
        }
        await page.getByRole("heading", { name: "Редакция на клиент" }).waitFor();
        const helpers = page.getByRole("checkbox", { name: "Добави помощници" });
        assert.equal(await helpers.isChecked(), false);
        assert.equal(await page.locator("#entry-helper-count").count(), 0);
        await helpers.check();
        await page.getByLabel("Брой помощници", { exact: true }).fill("2");
        assert.ok(await page.locator(".calculation-split").getByText("Помощници (2), общо:", { exact: false }).isVisible());
        await helpers.uncheck();
        assert.equal(await page.locator("#entry-helper-count").count(), 0);
        assert.equal(await page.locator(".calculation-split").getByText("Помощници (2), общо:", { exact: false }).count(), 0);
        const overflow = await page.locator(".form-page, .form-page *").evaluateAll(nodes => nodes.filter(node => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1);
        }).map(node => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width })));
        assert.deepEqual(overflow, [], `${engine.name()} ${width}px: form overflows`);
        const trigger = page.locator(".activity-calculator [data-slot=select-trigger]");
        const value = trigger.locator("[data-slot=select-value]");
        assert.ok(await value.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "selected label should fit");
        await trigger.click();
        const popup = page.getByRole("listbox");
        await popup.waitFor();
        const bounds = await popup.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, "service menu must fit viewport");
        await page.getByRole("option", { name: "Без добавена услуга", exact: true }).click();
        await page.getByRole("button", { name: "Запази промените", exact: true }).scrollIntoViewIfNeeded();
        assert.ok(await page.getByRole("button", { name: "Запази промените", exact: true }).isVisible());
        if (process.env.LAYOUT_SCREENSHOT && width === 393) await page.screenshot({ path: process.env.LAYOUT_SCREENSHOT + "-" + engine.name() + ".png", fullPage: true });
        console.log(`PASS ${engine.name()} ${width}px`);
        await page.close();
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
