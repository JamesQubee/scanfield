import { expect, test } from "@playwright/test";
import { bestTargetOnScreen, noContactDetails, noHorizontalOverflow, ready, state, step, stepUntil, tap, watchErrors } from "./helpers";

test("a whole drill: six moments, summary, saved to D1, shown in progress", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/?capture=1");
  await ready(page);
  // Wait until the anonymous player exists, then play the first drill through the menus.
  await expect(page.locator(".player-chip")).not.toContainText("…");
  await page.getByRole("button", { name: "Play: Half-turn basics" }).click();
  await page.getByRole("button", { name: "Got it, let's play" }).click();
  const n = await page.evaluate(() => (window as any).__game.game.run.specs.length);
  expect(n).toBe(6);
  for (let i = 0; i < n; i++) {
    await stepUntil(page, "play");
    // One late shoulder check each side, like a good player.
    let s = await state(page);
    while (s && s.tau < s.arrival - 1.0) {
      await step(page, 5);
      s = await state(page);
    }
    await page.evaluate(() => (window as any).__game.game.scan(-1));
    await step(page, 24);
    await page.evaluate(() => (window as any).__game.game.scan(1));
    await stepUntil(page, "decide");
    const t = await bestTargetOnScreen(page);
    // The tap must land on the pitch itself, not on something covering it.
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [t.x, t.y] as const)).toBe("stage");
    await tap(page, t.x, t.y);
    await stepUntil(page, "review");
    await page.locator(".board-next").click();
  }
  await expect(page.locator(".summary-score")).toBeVisible();
  await expect(page.locator(".moment-list li")).toHaveCount(6);
  await expect(page.locator(".save-state")).toHaveText("Saved to your progress ✓");
  await noHorizontalOverflow(page);
  await noContactDetails(page);

  // The server has it, scored by the server.
  const runs = await page.evaluate(() => (window as any).__game.api.runs());
  expect(runs.runs).toHaveLength(1);
  expect(runs.runs[0].momentsCount).toBe(6);
  expect(runs.runs[0].score).toBeGreaterThanOrEqual(85);
  // Tapping the model's best option, after late checks both ways, is right every time.
  expect(runs.runs[0].correctCount).toBe(6);

  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Progress" }).click();
  await expect(page.locator(".run-list li")).toHaveCount(1);
  await expect(page.locator(".skill")).not.toHaveCount(0);
  expect(errors).toEqual([]);
});
