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

const waitForSelector = async (page, selector, timeout = 30000) => {
    try {
        return await page.waitForSelector(selector, { 
            timeout,
            visible: true 
        });
    } catch (err) {
        console.log(`Timeout waiting for selector: ${selector}`);
        return null;
    }
};

const scrapeAboutSection = async (page) => {
    try {
        // First ensure we're on the about tab
        const aboutTab = await waitForSelector(page, 'button[aria-label^="About"][role="tab"]');
        if (!aboutTab) {
            console.log("About tab not found");
            return {};
        }

        // Click the About tab and wait for content
        await aboutTab.click();
        await page.waitForTimeout(3000); // Increased wait time for content load

        // Evaluate the about section content
        const about = await page.evaluate(() => {
            const result = {};
            
            // Find all section containers
            const sections = document.querySelectorAll('.iP2t7d.fontBodyMedium');
            
            sections.forEach(section => {
                // Get section title
                const titleEl = section.querySelector('h2.iL3Qke.fontTitleSmall');
                if (!titleEl) return;
                
                const title = titleEl.textContent.trim();
                if (!title) return;
                
                // Get section items
                const items = Array.from(section.querySelectorAll('li.hpLkke span'))
                    .map(item => item.textContent.trim())
                    .filter(Boolean);
                
                if (items.length > 0) {
                    result[title] = items;
                }
            });
            
            return result;
        });

        return about;
    } catch (err) {
        console.error("Error in scrapeAboutSection:", err.message);
        return {};
    }
};

const scrapePoi = async (inputUrl) => {
    let browser = null;
    const url = await encodeUrl(inputUrl);

    try {
        browser = await puppeteer.launch({
            headless: "new", // Use new headless mode
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-extensions",
                '--window-size=1920,1080',
            ],
            executablePath:
                process.env.NODE_ENV === "production"
                    ? process.env.PUPPETEER_EXECUTABLE_PATH
                    : puppeteer.executablePath(),
            defaultViewport: {
                width: 1920,
                height: 1080
            },
            timeout: 60000,
        });

        const page = await browser.newPage();
        
        // Set longer timeouts
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);

        // Enable request interception for performance
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Add retry mechanism for navigation
        let retries = 3;
        let lastError;
        
        while (retries > 0) {
            try {
                await page.goto(url, { 
                    waitUntil: "networkidle0",
                    timeout: 60000 
                });
                break;
            } catch (error) {
                lastError = error;
                retries--;
                if (retries === 0) break;
                console.log(`Retrying navigation... ${retries} attempts left`);
                await page.waitForTimeout(5000);
            }
        }

        if (retries === 0 && lastError) {
            throw lastError;
        }

        // Wait for main content to load
        await page.waitForTimeout(2000);

        // Basic information scraping with proper error handling
        const basicInfo = await page.evaluate(() => {
            const getValue = (selector, attribute = null) => {
                const element = document.querySelector(selector);
                if (!element) return '';
                return attribute ? element.getAttribute(attribute) : element.textContent.trim();
            };

            return {
                title: getValue('h1.DUwDvf'),
                description: getValue('h2.bwoZTb.fontBodyMedium span'),
                category: getValue('button.DkEaL'),
                address: getValue('button[aria-label^="Address"]', 'aria-label')?.split(': ')[1] || '',
                openHours: getValue('.t39EBf.GUrTXd', 'aria-label'),
                websiteLink: getValue('a[aria-label^="Website"]', 'href'),
                phoneNumber: getValue('button[aria-label^="Phone"]')?.split('\n').pop() || '',
            };
        });

        // Scrape reviews
        const reviews = await page.evaluate(() => {
            const reviewsList = [];
            
            // Try multiple selectors for reviews
            const selectors = [
                '.DUGVrf [jslog*="track:click"]',
                '.wiI7pd'
            ];
            
            selectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => {
                    const text = selector.includes('DUGVrf') 
                        ? el.getAttribute('aria-label')?.match(/"([^"]*)"/)?.[1]
                        : el.textContent;
                    if (text) reviewsList.push(text);
                });
            });
            
            return reviewsList;
        });

        // Scrape about section
        const about = await scrapeAboutSection(page);

        // Get rating and reviews count
        const ratingData = await page.evaluate(() => {
            const ratingEl = document.querySelector('.LBgpqf .fontBodyMedium .F7nice span span[aria-hidden="true"]');
            const reviewsEl = document.querySelector('.LBgpqf .fontBodyMedium .F7nice span span[aria-label*="reviews"]');
            
            return {
                rating: ratingEl?.textContent || null,
                reviews: reviewsEl?.textContent.match(/\d+/)?.[0] || null
            };
        });

        return {
            url,
            title: basicInfo.title,
            avgRating: ratingData.rating,
            totalNumberOfReviews: ratingData.reviews,
            description: basicInfo.description,
            category: basicInfo.category,
            address: basicInfo.address,
            openHours: basicInfo.openHours,
            websiteLink: basicInfo.websiteLink,
            phoneNumber: basicInfo.phoneNumber,
            reviews,
            about
        };

    } catch (error) {
        console.error(`Error scraping POI data:`, error);
        throw error;
    } finally {
        if (browser) {
            await browser.close().catch(console.error);
        }
    }
};

module.exports = { scrapePoi };
