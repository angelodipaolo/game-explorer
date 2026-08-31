import { expect, test } from "@playwright/test";

test("the shelf renders the shipped collection", async ({ page }) => {
  await page.goto("/shelf");
  await expect(page.getByRole("link", { name: /Game Explorer/ }).first()).toBeVisible();
  await expect(page.getByTestId("result-count")).toContainText(/\d+ games/);
});
