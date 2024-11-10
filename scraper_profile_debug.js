const puppeteer = require("puppeteer");
require("dotenv").config();

const encodeUrl = async (url) => {
    let baseUrl, query;
    [baseUrl, query] = url.split('?');
    
    let beforeData, dataPart;
    [beforeData, dataPart] = baseUrl.split('/data=');
    let parts = beforeData.split('/place/', 2);
    
    if (parts.length === 2) {
        const placeParts = parts[1].split('/', 2);
        placeParts[0] = placeParts[0].replace(/ /g, '+');
        parts[1] = placeParts.join('/');
        beforeData = parts.join('/place/');
    }
    
    let encodedBaseUrl;
    if (dataPart) {
        const encodedDataPart = dataPart.replace('/g/', '%2Fg%2F');
        encodedBaseUrl = `${beforeData}/data=${encodedDataPart}`;
    } else {
        encodedBaseUrl = beforeData;
    }
    
    return query ? `${encodedBaseUrl}?${query}` : encodedBaseUrl;
};

const scrapeAbout = async (inputUrl) => {
    const url = await encodeUrl(inputUrl);
    let browser = null;
    
    try {
        browser = await puppeteer.launch({
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
        });

        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(30000);
        await page.goto(url, { waitUntil: "networkidle0" });

        let about = {};
        try {
            const aboutTab = await page.waitForSelector('button[aria-label^="About"][role="tab"]', { timeout: 10000 });
            await aboutTab.click();
            await page.waitForSelector('div[aria-label^="About"]', { timeout: 10000 });
            
            const aboutSection = await page.$('div[aria-label^="About"]');
            const subsections = await aboutSection.$$eval('div.iP2t7d.fontBodyMedium', (els) =>
                els.map((el) => ({
                    title: el.querySelector('h2.iL3Qke.fontTitleSmall').textContent,
                    items: Array.from(el.querySelectorAll('li.hpLkke span')).map((i) => i.textContent)
                }))
            );
            
            subsections.forEach(({ title, items }) => {
                about[title] = items;
            });
        } catch (err) {
            console.warn('About section scraping failed:', err.message);
        }

        return { about };
    } catch (error) {
        throw new Error(`Error scraping POI data: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
};

module.exports = { scrapeAbout };
