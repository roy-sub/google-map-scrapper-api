const puppeteer = require('puppeteer');
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

async function createBrowser() {
    return await puppeteer.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
        ],
        headless: "new",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
        ignoreHTTPSErrors: true,
    });
}

async function createPage(browser) {
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
    });
    
    // Set user agent
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Set extra headers
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });
    
    return page;
}

const waitForSelectorSafely = async (page, selector, timeout = 10000) => {
    try {
        return await page.waitForSelector(selector, { timeout });
    } catch (error) {
        return null;
    }
};

const scrapeAbout = async (inputUrl) => {
    const url = await encodeUrl(inputUrl);
    let browser = null;
    let page = null;

    try {
        console.log('Launching browser...');
        browser = await createBrowser();
        
        console.log('Creating page...');
        page = await createPage(browser);
        
        // Set longer timeouts
        page.setDefaultNavigationTimeout(90000);
        page.setDefaultTimeout(90000);

        console.log('Navigating to URL:', url);
        await page.goto(url, {
            waitUntil: ['domcontentloaded', 'networkidle2'],
            timeout: 90000
        });

        // Wait for page to stabilize
        console.log('Waiting for page to stabilize...');
        await page.waitForFunction(
            () => document.readyState === 'complete',
            { timeout: 60000 }
        );
        
        // Additional wait for dynamic content
        await new Promise(r => setTimeout(r, 5000));

        let about = {};
        
        console.log('Looking for About tab...');
        const aboutTabSelector = 'button[aria-label^="About"][role="tab"]';
        const aboutTab = await waitForSelectorSafely(page, aboutTabSelector, 15000);

        if (aboutTab) {
            console.log('Found About tab, clicking...');
            await aboutTab.evaluate(b => b.click());
            
            // Wait after clicking
            await new Promise(r => setTimeout(r, 3000));

            console.log('Looking for About section...');
            const aboutSectionSelector = 'div[aria-label^="About"]';
            const aboutSection = await waitForSelectorSafely(page, aboutSectionSelector, 15000);

            if (aboutSection) {
                console.log('Found About section, extracting data...');
                about = await page.evaluate(() => {
                    const data = {};
                    const sections = document.querySelectorAll('div.iP2t7d.fontBodyMedium');
                    
                    sections.forEach(section => {
                        const titleElement = section.querySelector('h2.iL3Qke.fontTitleSmall');
                        const items = section.querySelectorAll('li.hpLkke span');
                        
                        if (titleElement && items.length > 0) {
                            const title = titleElement.textContent;
                            data[title] = Array.from(items).map(item => item.textContent);
                        }
                    });
                    
                    return data;
                });
            } else {
                console.log('About section not found');
                about = { error: 'About section not found' };
            }
        } else {
            console.log('About tab not found');
            about = { error: 'About tab not found' };
        }

        console.log('Scraping completed successfully');
        return { about, status: 'success' };

    } catch (error) {
        console.error('Scraping error:', error);
        throw new Error(`Scraping failed: ${error.message}`);
    } finally {
        try {
            if (page) {
                console.log('Closing page...');
                await page.close();
            }
            if (browser) {
                console.log('Closing browser...');
                await browser.close();
            }
        } catch (closeError) {
            console.error('Error during cleanup:', closeError);
        }
    }
};

module.exports = { scrapeAbout };
