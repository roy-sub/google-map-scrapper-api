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
        
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const blockedResources = ['image', 'stylesheet', 'font', 'media'];
            if (blockedResources.includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        console.log("Navigating to the page...");
        let retries = 3;
        while (retries > 0) {
            try {
                await page.goto(url, { 
                    waitUntil: "networkidle2",
                    timeout: 60000 
                });
                console.log("Page loaded successfully");
                break;
            } catch (error) {
                retries--;
                console.log(`Retrying navigation... ${retries} attempts left`);
                if (retries === 0) throw error;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        console.log("Looking for the About tab...");
        let about = {};
        try {
            const aboutTab = await page.waitForSelector('button[aria-label^="About"][role="tab"]', { 
                timeout: 30000,
                visible: true 
            });

            await Promise.all([
                aboutTab.click(),
                page.waitForTimeout(3000)
            ]);
            console.log("Clicked the About tab");

            const aboutSelectors = [
                'div[aria-label^="About"]',
                'div.iP2t7d.fontBodyMedium',
                'div[role="region"][aria-label^="About"]'
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
                    console.log(`Selector ${selector} not found, trying next...`);
                    continue;
                }
            }

            if (aboutSection) {
                console.log("Extracting About section content...");
                const subsections = await page.evaluate(() => {
                    const sections = document.querySelectorAll('div.iP2t7d.fontBodyMedium');
                    return Array.from(sections).map(section => {
                        const titleElement = section.querySelector('h2.iL3Qke.fontTitleSmall');
                        const items = Array.from(section.querySelectorAll('li.hpLkke span[aria-label]'));
                        return {
                            title: titleElement?.textContent || '',
                            items: items.map(item => item.getAttribute('aria-label') || '').filter(Boolean)
                        };
                    }).filter(section => section.title && section.items.length > 0);
                });

                subsections.forEach(({ title, items }) => {
                    if (title && items.length > 0) {
                        about[title] = items;
                    }
                });
                console.log("Content extracted successfully");
            } else {
                console.log("About section not found on page.");
            }
        } catch (err) {
            console.log("Error in the About tab selection or extraction:", err);
        }

        return { about };
    } catch (error) {
        console.error(`Error scraping data: ${error.message}`);
        return { error: error.message };
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log("Browser closed");
            } catch (error) {
                console.error("Error closing browser:", error);
            }
        }
    }
};

module.exports = { scrapeAbout2 };
