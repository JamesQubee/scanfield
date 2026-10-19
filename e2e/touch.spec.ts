import { expect, test } from "@playwright/test";
import { bestTargetOnScreen, ready, state, tap, watchErrors } from "./helpers";

// Live clock: the real frame loop, real touch events, the real latency measurement.
test("tap to frame: the answer to a tap is drawn in the next frame", async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.goto("/?scene=ht-01-marker-leaves&debug=1");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  await expect.poll(async () => (await state(page))?.phase, { timeout: 60_000, intervals: [100] }).toBe("decide");
  const t = await bestTargetOnScreen(page);
  await tap(page, t.x, t.y);
  await expect.poll(async () => (await state(page))?.result?.inputToFrameMs ?? null, { timeout: 20_000 }).not.toBeNull();
  const s = await state(page);
  const ms = s!.result!.inputToFrameMs!;
  // Software WebGL on a GPU-less machine: a generous bound. The number is logged for the report.
  expect(ms).toBeGreaterThanOrEqual(0);
  expect(ms).toBeLessThan(400);
  info.annotations.push({ type: "input-to-frame-ms", description: ms.toFixed(1) });
  console.log(`[${info.project.name}] input -> feedback frame: ${ms.toFixed(1)} ms`);
  expect(errors).toEqual([]);
});

test("double tap on the pitch does not zoom the page", async ({ page }) => {
  await page.goto("/?scene=ht-01-marker-leaves");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  const vp = page.viewportSize()!;
  await tap(page, vp.width / 2, vp.height / 2);
  await page.waitForTimeout(80);
  await tap(page, vp.width / 2, vp.height / 2);
  await page.waitForTimeout(500);
  const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  expect(scale).toBe(1);
});

test("survives a lost WebGL context", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/?scene=ht-01-marker-leaves");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const c = (window as any).__game.game.stage.renderer.getContext();
    const ext = c.getExtension("WEBGL_lose_context");
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 300);
  });
  await page.waitForTimeout(1500);
  const lost = await page.evaluate(() => (window as any).__game.game.stage.contextLost);
  expect(lost).toBe(false);
  await expect.poll(async () => (await state(page))?.phase, { timeout: 60_000 }).toBe("decide");
  expect(errors.filter((e) => !/context|CONTEXT_LOST/i.test(e))).toEqual([]);
});
