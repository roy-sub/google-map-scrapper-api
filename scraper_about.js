require("dotenv").config();
const puppeteer = require('puppeteer');

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

const waitForSelector = async (page, selector, timeout = 5000) => {
    try {
        return await page.waitForSelector(selector, { timeout });
    } catch (error) {
        console.warn(`Timeout waiting for selector: ${selector}`);
        return null;
    }
};

const scrapeAbout = async (inputUrl, retryCount = 2) => {
    const url = await encodeUrl(inputUrl);
    let browser = null;
    
    try {
        browser = await puppeteer.launch({
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-infobars",
                "--window-position=0,0",
                "--ignore-certifcate-errors",
                "--ignore-certifcate-errors-spki-list",
                "--disable-accelerated-2d-canvas",
                "--hide-scrollbars",
                "--disable-web-security"
            ],
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Set a longer timeout for the entire navigation
        await page.setDefaultNavigationTimeout(60000);
        
        // Set viewport and user agent
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Set additional headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        });

        // Enable JavaScript and cookies
        await page.setJavaScriptEnabled(true);
        
        // Navigate with retry logic
        let navigationSuccess = false;
        for (let attempt = 0; attempt < retryCount && !navigationSuccess; attempt++) {
            try {
                await page.goto(url, {
                    waitUntil: ['networkidle0', 'domcontentloaded'],
                    timeout: 60000
                });
                navigationSuccess = true;
            } catch (error) {
                console.warn(`Navigation attempt ${attempt + 1} failed:`, error.message);
                if (attempt === retryCount - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
            }
        }

        // Wait for page to be fully loaded
        await page.waitForFunction(() => document.readyState === 'complete');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Additional wait for dynamic content

        let about = {};
        try {
            // Wait for and click the About tab
            const aboutTab = await waitForSelector(page, 'button[aria-label^="About"][role="tab"]', 15000);
            if (aboutTab) {
                await aboutTab.click();
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for content to load
                
                // Wait for About section
                const aboutSection = await waitForSelector(page, 'div[aria-label^="About"]', 15000);
                if (aboutSection) {
                    const subsections = await page.evaluate(() => {
                        const sections = document.querySelectorAll('div.iP2t7d.fontBodyMedium');
                        return Array.from(sections).map(section => ({
                            title: section.querySelector('h2.iL3Qke.fontTitleSmall')?.textContent || 'Unknown',
                            items: Array.from(section.querySelectorAll('li.hpLkke span')).map(item => item.textContent)
                        }));
                    });
                    
                    subsections.forEach(({ title, items }) => {
                        if (title && items.length > 0) {
                            about[title] = items;
                        }
                    });
                }
            }
        } catch (err) {
            console.warn('About section scraping failed:', err.message);
            about = { error: 'Failed to scrape about section', message: err.message };
        }

        return { about };
    } catch (error) {
        console.error('Scraping error:', error);
        throw new Error(`Error scraping POI data: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
};

module.exports = { scrapeAbout };
