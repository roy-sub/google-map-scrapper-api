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
    console.log('Starting scrape for URL:', url);

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
            headless: true, // Using true instead of "new" for v19.7.2
        });

        const page = await browser.newPage();
        
        // Add console logging
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        
        // Set viewport
        await page.setViewport({ width: 1280, height: 800 });

        console.log('Navigating to page...');
        await page.goto(url, { 
            waitUntil: "networkidle0",
            timeout: 30000 
        });

        // Wait for initial page load
        await page.waitForTimeout(3000);

        console.log('Looking for About button...');
        // Wait for the About button
        await page.waitForSelector('button[role="tab"][aria-label*="About"]', {
            visible: true,
            timeout: 10000
        });

        // Click the About button using plain JavaScript click()
        console.log('Clicking About button...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button[role="tab"]'));
            const aboutButton = buttons.find(button => 
                button.getAttribute('aria-label') && 
                button.getAttribute('aria-label').includes('About')
            );
            if (aboutButton) {
                aboutButton.click();
            }
        });

        // Wait for the content to load
        console.log('Waiting for content to load...');
        await page.waitForTimeout(2000);

        // Extract data with detailed logging
        console.log('Extracting data...');
        const about = await page.evaluate(() => {
            const result = {};
            console.log('Starting data extraction...');

            // Find all section containers
            const sections = document.querySelectorAll('div.iP2t7d.fontBodyMedium');
            console.log(`Found ${sections.length} sections`);

            sections.forEach((section, index) => {
                // Get section title
                const titleEl = section.querySelector('h2.iL3Qke');
                if (!titleEl) {
                    console.log(`No title found for section ${index}`);
                    return;
                }

                const title = titleEl.textContent.trim();
                console.log(`Processing section: ${title}`);

                // Get all items
                const items = Array.from(section.querySelectorAll('li.hpLkke span[aria-label]'))
                    .map(span => span.getAttribute('aria-label'))
                    .filter(text => text && text.length > 0);

                console.log(`Found ${items.length} items in section ${title}`);
                
                if (items.length > 0) {
                    result[title] = items;
                }
            });

            console.log('Extraction complete');
            return result;
        });

        // Log the results
        console.log('Scraped data:', JSON.stringify(about, null, 2));

        // Take a screenshot for debugging if no data
        if (Object.keys(about).length === 0) {
            console.log('No data found, taking screenshot...');
            await page.screenshot({ path: 'debug-screenshot.png' });
            
            // Try to get page content for debugging
            const pageContent = await page.content();
            console.log('Page content length:', pageContent.length);
            console.log('First 500 chars of page:', pageContent.substring(0, 500));
        }

        await browser.close();
        return { about };

    } catch (error) {
        console.error(`Scraping error: ${error.message}`);
        console.error(error.stack);
        
        // Try to take error screenshot
        try {
            if (page) {
                await page.screenshot({ path: 'error-screenshot.png' });
            }
        } catch (screenshotError) {
            console.error('Failed to take error screenshot:', screenshotError.message);
        }

        if (browser) {
            await browser.close();
        }
        throw error;
    }
};

module.exports = { scrapeAbout };
