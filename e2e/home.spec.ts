import { expect, test } from "@playwright/test";
import { noContactDetails, noHorizontalOverflow, ready, watchErrors } from "./helpers";

test("home loads, signs in an anonymous player and lists the drills", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await ready(page);
  await expect(page.getByRole("heading", { name: "See it before you get it." })).toBeVisible();
  await expect(page.locator(".drill")).toHaveCount(3);
  await expect(page.locator(".player-chip")).not.toContainText("…");
  await expect(page.locator(".drill.locked")).toHaveCount(1);
  await noHorizontalOverflow(page);
  await noContactDetails(page);
  expect(errors).toEqual([]);
});

test("how to play, progress and settings screens open and close", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "How to play" }).click();
  await expect(page.getByRole("heading", { name: "How to play" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Progress" }).click();
  await expect(page.getByText("No drills played yet")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await noContactDetails(page);
  await page.getByRole("button", { name: "Analytics events" }).click();
  await expect(page.locator(".events li").first()).toContainText("app_open");
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
