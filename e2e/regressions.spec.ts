// UI regressions found by a review after the first suites were green.
import { expect, test } from "@playwright/test";
import { bestTargetOnScreen, ready, state, step, stepUntil, tap } from "./helpers";

async function playOne(page: import("@playwright/test").Page): Promise<void> {
  await stepUntil(page, "decide");
  const t = await bestTargetOnScreen(page);
  await tap(page, t.x, t.y);
  await stepUntil(page, "review");
}

test("Space after Next does not press the hidden board's button (no skipped moment)", async ({ page }) => {
  await page.goto("/?capture=1");
  await ready(page);
  await expect(page.locator(".player-chip")).not.toContainText("…");
  await page.getByRole("button", { name: "Play: Half-turn basics" }).click();
  await page.getByRole("button", { name: "Got it, let's play" }).click();
  await playOne(page);
  await page.locator(".board-next").click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__game.game.run.index)).toBe(1);
  // Space in the brief starts play; it must not also click the off-screen Next.
  await page.keyboard.press("Space");
  await step(page, 2);
  expect(await page.evaluate(() => (window as any).__game.game.run.index)).toBe(1);
  expect((await state(page))!.phase).toBe("play");
  expect(await page.locator(".board").evaluate((b) => (b as HTMLElement).inert)).toBe(true);
});

test("'Try again' inside a drill replaces the attempt", async ({ page }) => {
  await page.goto("/?capture=1");
  await ready(page);
  await expect(page.locator(".player-chip")).not.toContainText("…");
  await page.getByRole("button", { name: "Play: Half-turn basics" }).click();
  await page.getByRole("button", { name: "Got it, let's play" }).click();
  await playOne(page);
  await page.locator(".board-replay").click();
  await page.waitForTimeout(400);
  await playOne(page);
  const run = await page.evaluate(() => ({ index: (window as any).__game.game.run.index, n: (window as any).__game.game.run.results.length }));
  expect(run).toEqual({ index: 0, n: 1 });
  await expect(page.locator(".pip.good, .pip.ok, .pip.bad")).toHaveCount(1);
});

test("a Pro drill deep link asks for Pro first (and starts from a real tap)", async ({ page }) => {
  await page.goto("/?drill=back-to-goal");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  await expect(page.getByRole("heading", { name: "Unlock Back to goal" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__game.game.moment)).toBeNull();
});

test("a free player's Pro drill run is refused by the server", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await expect(page.locator(".player-chip")).not.toContainText("…");
  const status = await page.evaluate(async () => {
    const api = (window as any).__game.api;
    const now = Date.now();
    return api.saveRun({ id: crypto.randomUUID(), drillId: "back-to-goal", contentVersion: "x", startedAt: now - 60_000, finishedAt: now, deviceClass: null, moments: [{ idx: 0, sceneId: "bg-01", skill: "back-to-goal", choiceKind: "setback", choiceId: "setback", bestId: "setback", grade: 100, correct: true, reactionMs: 500, scans: 1, lastScanBeforeArrivalMs: 300, inputToFrameMs: 10 }] });
  });
  expect(status.status).toBe("rejected");
});

test("the coach board redraws at the new shape when the phone rotates", async ({ page }) => {
  await page.goto("/?scene=ht-01-marker-leaves&capture=1");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  await playOne(page);
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(600);
  const r = await page.locator(".board-canvas").evaluate((c) => {
    const cv = c as HTMLCanvasElement;
    return { bitmap: cv.width / cv.height, box: cv.clientWidth / cv.clientHeight };
  });
  expect(Math.abs(r.bitmap - r.box)).toBeLessThan(0.03);
});

test("a slow checkout answer does not pull the menu over a drill started meanwhile", async ({ page }) => {
  await page.goto("/?capture=1");
  await ready(page);
  await expect(page.locator(".player-chip")).not.toContainText("…");
  await page.route("**/api/demo/checkout/complete", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.locator('.drill[data-drill="back-to-goal"]').click();
  await page.getByRole("button", { name: "Start test checkout" }).click();
  await page.getByRole("button", { name: "Complete test purchase" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Play: Half-turn basics" }).click();
  await page.getByRole("button", { name: "Got it, let's play" }).click();
  await page.waitForTimeout(3500);
  expect(await page.locator(".shell.on").count()).toBe(0);
  expect((await state(page))?.phase).toBeTruthy();
  // Game keys still work because no menu covers the pitch.
  await stepUntil(page, "play");
  await page.keyboard.press("ArrowLeft");
  expect(await page.evaluate(() => (window as any).__game.game.moment.vision.scans.length)).toBe(1);
});
