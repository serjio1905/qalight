import { QA } from "../../index";
import { test } from "@playwright/test";

test("google search", async ({ page }) => {
    const qa = new QA(page);
    await qa.open("https://www.google.com");
    await qa.get("textarea", "search").fill("Playwright");
    await qa.pressEnter();
    await qa.get("a", "https://playwright.dev").click();
    await qa.waitFor(3000);
});
