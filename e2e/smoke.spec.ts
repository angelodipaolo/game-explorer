import { expect, test } from "@playwright/test";

test("home page renders the shelf with the shipped collection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Game Explorer/ }).first()).toBeVisible();
  await expect(page.getByTestId("result-count")).toContainText(/\d+ games/);
});
