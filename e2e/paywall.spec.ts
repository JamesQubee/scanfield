import { expect, test } from "@playwright/test";
import { noContactDetails, ready, watchErrors } from "./helpers";

test("locked drill -> paywall -> test checkout -> verified webhook -> Pro; cancel -> Free", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await ready(page);
  await expect(page.locator(".plan")).toHaveText("FREE");
  await page.locator('.drill[data-drill="back-to-goal"]').click();
  await expect(page.getByRole("heading", { name: "Unlock Back to goal" })).toBeVisible();
  await page.getByRole("button", { name: "Start test checkout" }).click();
  await expect(page.getByText("TEST MODE")).toBeVisible();
  await noContactDetails(page);
  await page.getByRole("button", { name: "Complete test purchase" }).click();
  await expect(page.locator(".plan")).toHaveText("PRO");
  await expect(page.locator(".drill.locked")).toHaveCount(0);
  const me = await page.evaluate(() => (window as any).__game.api.me());
  expect(me.plan).toBe("pro");
  expect(me.subscription.testMode).toBe(true);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Cancel test subscription" }).click();
  await expect(page.getByRole("button", { name: "See Pro" })).toBeVisible();
  const after = await page.evaluate(() => (window as any).__game.api.me());
  expect(after.plan).toBe("free");
  expect(errors).toEqual([]);
});
