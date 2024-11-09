const puppeteer = require("puppeteer");
require("dotenv").config();

const scrapeGoogleMapsTitlesAndHref = async (query) => {
  let browser = null;
  try {
    // Launch browser with additional configurations
    browser = await puppeteer.launch({
      args: [
        "--disable-setuid-sandbox",
        "--no-sandbox",
        "--single-process",
        "--no-zygote",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
      ],
      executablePath:
        process.env.NODE_ENV === "production"
          ? process.env.PUPPETEER_EXECUTABLE_PATH
          : puppeteer.executablePath(),
      timeout: 60000, // Increase browser launch timeout
    });

    const page = await browser.newPage();
    
    // Set longer timeouts for navigation and operations
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    // Optimize page performance
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const blockedResources = ['image', 'stylesheet', 'font', 'media'];
      if (blockedResources.includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    
    // Add retry mechanism for initial navigation
    let retries = 3;
    while (retries > 0) {
      try {
        await page.goto(url, { 
          waitUntil: "networkidle2",
          timeout: 60000 
        });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        console.log(`Retrying navigation... ${retries} attempts left`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Wait for the results sidebar with timeout and retry
    const sidebarSelector = `div[aria-label*="Results for ${query}"]`;
    await page.waitForSelector(sidebarSelector, { 
      timeout: 60000,
      visible: true 
    });

    // Scroll until all results are loaded
    let data = [];
    let lastHeight = 0;
    let currentHeight = 0;
    const SCROLL_INTERVAL = 500;
    const SCROLL_TIMEOUT = 180000; // 3 minutes total scroll timeout
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > SCROLL_TIMEOUT) {
        console.log("Scroll timeout reached after 3 minutes");
        break;
      }

      currentHeight = await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        return element.scrollHeight;
      }, sidebarSelector);

      // Scroll down until the height stops increasing
      while (currentHeight > lastHeight) {
        lastHeight = currentHeight;
        await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          element.scrollBy(0, 400);
        }, sidebarSelector);
        await new Promise((resolve) => setTimeout(resolve, SCROLL_INTERVAL));
        currentHeight = await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          return element.scrollHeight;
        }, sidebarSelector);
      }

      // Extract data with error handling
      const newData = await page.evaluate(() => {
        const elements = document.getElementsByClassName("hfpxzc");
        return Array.from(elements)
          .map((element) => ({
            title: element.getAttribute("aria-label"),
            href: element.getAttribute("href"),
          }))
          .filter((item) => item.title && item.href);
      });

      // Combine new data with existing data, removing duplicates
      data = [...new Set([...data, ...newData])];

      // Check if we've reached the end of the list
      const endOfListFound = await page.evaluate(() => {
        return document.documentElement.outerHTML.includes(
          "You've reached the end of the list"
        );
      });

      if (endOfListFound) {
        console.log("Found end of list message");
        break;
      }
    }

    return data;

  } catch (error) {
    const errorMessage = `Error scraping Google Maps data: ${error.message}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  } finally {
    // Ensure browser closes even if there's an error
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.error("Error closing browser:", error);
      }
    }
  }
};

module.exports = { scrapeGoogleMapsTitlesAndHref };
