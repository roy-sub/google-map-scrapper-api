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
    let browser = null;
    const url = await encodeUrl(inputUrl);

    try {
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
            headless: "new",  // Added this for better stability
            timeout: 60000,
        });

        const page = await browser.newPage();
        
        // Increase timeouts
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);

        // Enable console logs from the page
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));

        // Optimize performance
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const blockedResources = ['image', 'stylesheet', 'font', 'media'];
            if (blockedResources.includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Navigate with retries
        let retries = 3;
        while (retries > 0) {
            try {
                await page.goto(url, { 
                    waitUntil: "networkidle0",
                    timeout: 60000 
                });
                break;
            } catch (error) {
                console.log(`Navigation error: ${error.message}`);
                retries--;
                if (retries === 0) throw error;
                console.log(`Retrying navigation... ${retries} attempts left`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Scrape About Tab
        let about = {};
        try {
            // Wait for tab to be ready
            await page.waitForFunction(
                () => document.querySelector('button[aria-label^="About"][role="tab"]') !== null,
                { timeout: 30000 }
            );

            // Click the About tab and wait for content
            await Promise.all([
                page.click('button[aria-label^="About"][role="tab"]'),
                page.waitForTimeout(3000)  // Increased wait time
            ]);

            // Verify the tab switch
            await page.waitForFunction(
                () => document.querySelector('div[role="tabpanel"][aria-label^="About"]') !== null,
                { timeout: 20000 }
            );

            // Extract data using evaluate for better performance
            const subsections = await page.evaluate(() => {
                const sections = Array.from(document.querySelectorAll('div.iP2t7d.fontBodyMedium'));
                return sections.map(section => {
                    const titleEl = section.querySelector('h2.iL3Qke.fontTitleSmall');
                    const items = Array.from(section.querySelectorAll('li.hpLkke span'));
                    
                    return {
                        title: titleEl ? titleEl.textContent.trim() : '',
                        items: items
                            .map(item => item.textContent.trim())
                            .filter(text => text.length > 0)
                    };
                }).filter(section => section.title && section.items.length > 0);
            });

            // Process the results
            subsections.forEach(({ title, items }) => {
                if (title && items.length > 0) {
                    about[title] = items;
                }
            });

            // Log the results for debugging
            console.log('Scraped data:', JSON.stringify(about, null, 2));

            if (Object.keys(about).length === 0) {
                console.log('Warning: No data was scraped');
            }

        } catch (err) {
            console.error("Error in about section scraping:", err);
            throw err;  // Rethrow to trigger retry if needed
        }

        return { about };

    } catch (error) {
        console.error(`Scraping error: ${error.message}`);
        throw new Error(`Error scraping POI data: ${error.message}`);
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (error) {
                console.error("Error closing browser:", error);
            }
        }
    }
};

module.exports = { scrapeAbout };
