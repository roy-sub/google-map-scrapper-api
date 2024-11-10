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

const scrapeAbout2 = async (inputUrl) => {
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
            timeout: 60000,
        });

        const page = await browser.newPage();
        
        // Set longer timeouts
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

        // Add retry mechanism for navigation
        let retries = 3;
        while (retries > 0) {
            try {
                await page.goto(url, { 
                    waitUntil: "networkidle0",
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
        
        // Scrape About Tab
        let about = {};
        try {
            // Wait for the About tab with increased timeout
            const aboutTab = await page.waitForSelector('button[aria-label^="About"][role="tab"]', { 
                timeout: 30000,
                visible: true 
            });
        
            // Click the About tab and wait for navigation
            await Promise.all([
                aboutTab.click(),
                page.waitForTimeout(2000) // Give some time for content to load
            ]);
        
            // Try multiple selectors for the About section
            const aboutSelectors = [
                'div[aria-label^="About"]',
                'div.iP2t7d.fontBodyMedium',
                'div[role="tabpanel"][aria-label^="About"]'
            ];
        
            let aboutSection = null;
            for (const selector of aboutSelectors) {
                try {
                    aboutSection = await page.waitForSelector(selector, { 
                        timeout: 20000,
                        visible: true 
                    });
                    if (aboutSection) break;
                } catch (err) {
                    continue;
                }
            }
        
            if (aboutSection) {
                // Use a single evaluate call to get all subsections
                const subsections = await page.evaluate(() => {
                    const sections = document.querySelectorAll('div.iP2t7d.fontBodyMedium');
                    return Array.from(sections).map(section => {
                        const titleElement = section.querySelector('h2.iL3Qke.fontTitleSmall');
                        const items = Array.from(section.querySelectorAll('li.hpLkke span'));
                        return {
                            title: titleElement?.textContent || '',
                            items: items.map(item => item.textContent || '').filter(Boolean)
                        };
                    }).filter(section => section.title && section.items.length > 0);
                });
        
                subsections.forEach(({ title, items }) => {
                    if (title && items.length > 0) {
                        about[title] = items;
                    }
                });
            }
        } catch (err) {
            console.log("Error getting about section:", err);
        }

        return {
            about
        };
    } catch (error) {
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

module.exports = { scrapeAbout2 };
