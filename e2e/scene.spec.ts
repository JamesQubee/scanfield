import { expect, test } from "@playwright/test";
import { bestTargetOnScreen, noContactDetails, ready, screenOf, state, step, stepUntil, tap, watchErrors } from "./helpers";

/** Metres between where we remember a player and where he really is. */
function memoryError(page: import("@playwright/test").Page, id: string): Promise<number> {
  return page.evaluate((who) => {
    const m = (window as any).__game.game.moment;
    const mem = m.vision.memory.get(who);
    const p = m.truePos(m.scenario.byId.get(who), m.tau, { x: 0, y: 0 });
    return Math.hypot(mem.x - p.x, mem.y - p.y);
  }, id);
}

// The stepped clock (?capture=1) makes every run see the same frames.
test("one scene: scan, the hidden marker is revealed, the best tap scores 100", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/?scene=ht-01-marker-leaves&capture=1");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  await step(page, 5);
  await expect(page.locator(".hud-banner")).toHaveClass(/on/);
  await stepUntil(page, "play");
  await expect(page.locator(".scan-btn.left")).toHaveClass(/on/);

  // Check over a shoulder late in the pass, with a real tap on the button.
  let s = await state(page);
  while (s && s.tau < s.arrival - 0.9) {
    await step(page, 5);
    s = await state(page);
  }
  // Their 8 is on our left of the screen at this point; check both sides to be sure.
  const left = await page.locator(".scan-btn.left").boundingBox();
  await tap(page, left!.x + left!.width / 2, left!.y + left!.height / 2);
  await step(page, 24);
  const right = await page.locator(".scan-btn.right").boundingBox();
  await tap(page, right!.x + right!.width / 2, right!.y + right!.height / 2);
  await step(page, 6);
  expect(await page.evaluate(() => (window as any).__game.game.moment.vision.scans.length)).toBe(2);
  await expect(page.locator(".hud-scans")).toHaveText("2 checks");

  await stepUntil(page, "decide");
  await expect(page.locator(".hud-hint")).toContainText("Tap where the ball goes");
  // Our late check saw the marker leave: we remember him close to where he really is.
  expect(await memoryError(page, "o8")).toBeLessThan(2);

  const target = await bestTargetOnScreen(page);
  expect(target.id.startsWith("carry:")).toBe(true);
  await tap(page, target.x, target.y);
  await step(page, 2);
  s = await state(page);
  expect(s!.phase).toBe("outcome");
  expect(s!.result!.correct).toBe(true);
  expect(s!.result!.grade).toBe(100);

  await stepUntil(page, "review");
  await expect(page.locator(".board")).toHaveClass(/on/);
  await expect(page.locator(".board-verdict")).toHaveText("Spot on!");
  await expect(page.locator(".board-grade")).toHaveText("100");
  await noContactDetails(page);
  expect(errors).toEqual([]);
});

test("without scanning, the right answer counts as a guess and is capped", async ({ page }) => {
  await page.goto("/?scene=ht-01-marker-leaves&capture=1");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  await stepUntil(page, "decide");
  // Without a check we still remember him right behind us, metres from where he is.
  expect(await memoryError(page, "o8")).toBeGreaterThan(6);
  const target = await bestTargetOnScreen(page);
  await tap(page, target.x, target.y);
  await step(page, 2);
  const s = await state(page);
  expect(s!.result!.correct).toBe(true);
  expect(s!.result!.grade).toBe(70);
  await stepUntil(page, "review");
  await expect(page.locator(".board-verdict")).toHaveText("Right call, but a guess");
});

test("a pass into a defender is intercepted, and the board says so", async ({ page }) => {
  await page.goto("/?scene=ht-01-marker-leaves&capture=1");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  await stepUntil(page, "decide");
  // Our 10 is tightly marked by their 5.
  const ten = await page.evaluate(() => (window as any).__game.game.world.targets.find((t: any) => t.id === "m10"));
  const p = await screenOf(page, ten.x, ten.y);
  await tap(page, p.x, p.y);
  await step(page, 2);
  const s = await state(page);
  expect(s!.result!.choice).toBe("pass:m10");
  expect(s!.result!.outcome).toBe("intercepted");
  await stepUntil(page, "review");
  await expect(page.locator(".board-verdict")).toHaveText("Intercepted!");
});

test("a timed scene runs out: too slow", async ({ page }) => {
  await page.goto("/?scene=ht-03-away-from-pressure&capture=1");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  await stepUntil(page, "decide");
  await expect(page.locator(".hud-timer")).toHaveClass(/on/);
  await stepUntil(page, "review");
  const s = await state(page);
  expect(s!.result!.outcome).toBe("lost");
  await expect(page.locator(".board-verdict")).toHaveText("Too slow");
});

test("a tap before the decision window opens is ignored", async ({ page }) => {
  await page.goto("/?scene=ht-01-marker-leaves&capture=1");
  await ready(page);
  await page.getByRole("button", { name: "Tap to start" }).click();
  await stepUntil(page, "play");
  const vp = page.viewportSize()!;
  await tap(page, vp.width / 2, vp.height / 3);
  await step(page, 3);
  const s = await state(page);
  expect(s!.phase).toBe("play");
  expect(s!.result).toBeNull();
});
