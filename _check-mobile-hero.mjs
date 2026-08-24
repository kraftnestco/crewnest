const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium
    .launch({ headless: true, channel: "msedge" })
    .catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://localhost:3000/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const copy = document.querySelector(".cn-mobile-hero .cn-hero-copy");
    if (!copy) return { err: "no copy", hero: !!document.querySelector(".cn-mobile-hero") };
    return {
      kids: [...copy.children].map((el) => ({
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
        display: getComputedStyle(el).display,
        hidden: el.hasAttribute("data-cn-mobile-chrome-hidden"),
        badge: el.hasAttribute("data-cn-hero-badge"),
        platforms: el.hasAttribute("data-cn-hero-platforms"),
        top: Math.round(el.getBoundingClientRect().top),
        bottom: Math.round(el.getBoundingClientRect().bottom),
        h: Math.round(el.getBoundingClientRect().height),
        w: Math.round(el.getBoundingClientRect().width),
      })),
      vw: window.innerWidth,
      vh: window.innerHeight,
      layout: !!document.getElementById("cn-mobile-hero-layout-v12"),
    };
  });
  fs.writeFileSync("_mobile-hero-check.json", JSON.stringify(info, null, 2));
  await page.screenshot({ path: "_mobile-hero-check.png", fullPage: false });
  await browser.close();
  console.log(JSON.stringify(info, null, 2));
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
