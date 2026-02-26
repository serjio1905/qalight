// Quick verification script to test Playwright installation
const { chromium } = require("playwright");

(async () => {
  console.log("🔍 Verifying Playwright Installation...\n");

  try {
    console.log("✓ Playwright package loaded successfully");

    // Launch browser
    console.log("⏳ Launching Chromium browser...");
    const browser = await chromium.launch();
    console.log("✓ Chromium launched successfully");

    // Create page
    const page = await browser.newPage();
    console.log("✓ New page created successfully");

    // Navigate to example page
    console.log("⏳ Navigating to example page...");
    await page.goto("https://playwright.dev/");
    console.log("✓ Navigation successful");

    // Get title
    const title = await page.title();
    console.log(`✓ Page title: "${title}"`);

    // Close browser
    await browser.close();
    console.log("✓ Browser closed successfully");

    console.log("\n✅ ALL CHECKS PASSED! Playwright is working correctly.\n");
    console.log("You can now run your tests with: npm test\n");
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error("\nPlease run: npx playwright install\n");
    process.exit(1);
  }
})();
