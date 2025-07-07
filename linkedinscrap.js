const puppeteer = require("puppeteer");

async function scrapeJob(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: "/usr/bin/chromium", // <-- THIS IS IMPORTANT
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle0" });

  const job = await page.evaluate(() => {
    const getText = (selector) => document.querySelector(selector)?.innerText || "";

    return {
      job_title: getText("h1"),
      company_name: getText(".topcard__org-name-link") || getText(".topcard__flavor"),
      location: getText(".topcard__flavor--bullet"),
      job_description:
        document.querySelector(".show-more-less-html__markup")?.innerText ||
        getText(".description__text"),
      experience_required: "",
      tech_stack: [],
      contact_info: []
    };
  });

  await browser.close();
  console.log(JSON.stringify(job));
}

if (require.main === module) {
  const url = process.argv[2];
  if (!url) {
    console.error("❌ No URL provided.");
    process.exit(1);
  }
  scrapeJob(url);
