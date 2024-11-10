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

const getRatingAndReviews = async (page) => {
    try {
        await page.waitForSelector('.LBgpqf .fontBodyMedium .F7nice span', { 
            timeout: 60000 
        });

        const ratingData = await page.evaluate(() => {
            const ratingElement = document.querySelector('.LBgpqf .fontBodyMedium .F7nice span span[aria-hidden="true"]');
            const reviewsElement = document.querySelector('.LBgpqf .fontBodyMedium .F7nice span span[aria-label*="reviews"]');

            const rating = ratingElement ? ratingElement.innerText : null;
            const reviews = reviewsElement ? reviewsElement.innerText.match(/\d+/)[0] : null;

            return { rating, reviews };
        });

        return ratingData;
    } catch (err) {
        console.log("Error getting rating and reviews:", err.message);
        return { rating: null, reviews: null };
    }
};

const scrapePoi_Debug = async (inputUrl) => {
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

        // Enable console log from the page context
        page.on('console', msg => console.log('Page Console:', msg.text()));

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

        // 1. Scrape Title
        let titleName = '';
        try {
            await page.waitForSelector('h1.DUwDvf', { timeout: 60000 });
            titleName = await page.$eval('h1.DUwDvf', (el) => el.textContent.trim());
        } catch (err) {
            console.log("Error getting title:", err.message);
        }

        // 2. Scrape Average Rating and Total Number of Reviews
        const ratingData = await getRatingAndReviews(page);
        const { rating: avgRating, reviews: totalNumberOfReviews } = ratingData;

        // 4. Scrape Description
        let description = '';
        try {
            await page.waitForSelector('h2.bwoZTb.fontBodyMedium span', { timeout: 30000 });
            description = await page.$eval('h2.bwoZTb.fontBodyMedium span', (el) => el.textContent.trim());
        } catch (err) {
            console.log("Error getting description:", err.message);
        }

        // 5. Scrape Service Category
        let category = '';
        try {
            await page.waitForSelector('button.DkEaL', { timeout: 30000 });
            category = await page.$eval('button.DkEaL', (el) => el.textContent.trim());
        } catch (err) {
            console.log("Error getting category:", err.message);
        }

        // 6. Scrape Address
        let address = '';
        try {
            const addressButton = await page.waitForSelector('button[aria-label^="Address"]', { timeout: 30000 });
            address = await page.evaluate((el) => el.getAttribute('aria-label').split(': ')[1], addressButton);
        } catch (err) {
            console.log("Error getting address:", err.message);
        }

        // 7. Scrape Open Hours
        let openHours = '';
        try {
            const openHoursElement = await page.waitForSelector('.t39EBf.GUrTXd', { timeout: 30000 });
            openHours = await page.evaluate((el) => el.getAttribute('aria-label'), openHoursElement);
        } catch (err) {
            console.log("Error getting hours:", err.message);
        }

        // 8. Scrape Website Link
        let websiteLink = '';
        try {
            const websiteElement = await page.waitForSelector('a[aria-label^="Website"]', { timeout: 30000 });
            websiteLink = await page.evaluate((el) => el.getAttribute('href'), websiteElement);
        } catch (err) {
            console.log("Error getting website:", err.message);
        }

        // 9. Scrape Phone Number
        let phoneNumber = '';
        try {
            const phoneButton = await page.waitForSelector('button[aria-label^="Phone"]', { timeout: 30000 });
            phoneNumber = await page.evaluate((el) => el.textContent.split('\n').pop(), phoneButton);
        } catch (err) {
            console.log("Error getting phone:", err.message);
        }

        // 10. Scrape Reviews
        let reviews = [];
        try {
            const reviewElements = await page.$$eval('.DUGVrf [jslog*="track:click"]', (els) =>
                els.map((el) => el.getAttribute('aria-label'))
            );
            for (const reviewText of reviewElements) {
                const review = reviewText.match(/"([^"]*)"/)[1];
                reviews.push(review);
            }
        } catch (err) {
            // No-op
        }
        try {
            const reviewElements = await page.$$eval('.wiI7pd', (els) => els.map((el) => el.textContent));
            reviews = [...reviews, ...reviewElements];
        } catch (err) {
            // No-op
        }
        
        // 12. Enhanced About Tab Scraping with Debugging
        // Replace the About tab scraping section with this updated version
        let about = {};
        try {
            console.log('Starting About tab scraping process...');
            
            // Wait for the About tab
            const aboutTabSelector = 'button[aria-label="About"]';
            await page.waitForSelector(aboutTabSelector, {
                visible: true,
                timeout: 30000
            });
            
            // Click and wait for content load
            await Promise.all([
                page.click(aboutTabSelector),
                // Wait for network to be idle
                page.waitForNetworkIdle({ timeout: 30000 }),
                // Additional wait for dynamic content
                page.waitForTimeout(5000)
            ]);
        
            // Try alternative selectors for content
            const contentSelectors = [
                '.RcCsl button[aria-label="About"]',  // New selector
                'div[role="tabpanel"]:not([hidden])', // Any visible tabpanel
                'div[jscontroller] div.iP2t7d',       // Dynamic content container
                '.section-layout-root'                 // Root container
            ];
        
            let contentFound = false;
            for (const selector of contentSelectors) {
                try {
                    await page.waitForSelector(selector, {
                        visible: true,
                        timeout: 10000
                    });
                    contentFound = true;
                    console.log(`Content found with selector: ${selector}`);
                    break;
                } catch (err) {
                    console.log(`Selector failed: ${selector}`);
                    continue;
                }
            }
        
            if (!contentFound) {
                throw new Error('No content selectors found');
            }
        
            // Extract content with a more robust approach
            const aboutContent = await page.evaluate(() => {
                // Helper function to get text content safely
                const getTextContent = (element) => element?.textContent?.trim() || '';
                
                // Find all content sections
                const sections = Array.from(document.querySelectorAll('div[role="tabpanel"]:not([hidden]) div'));
                
                const result = {};
                let currentSection = '';
                
                sections.forEach(section => {
                    // Check if this is a section header
                    const headerText = getTextContent(section.querySelector('h2, h3, .fontTitleSmall'));
                    if (headerText) {
                        currentSection = headerText;
                        result[currentSection] = [];
                    } 
                    // Check for list items or content
                    else {
                        const items = Array.from(section.querySelectorAll('li, .fontBodyMedium > div'))
                            .map(item => getTextContent(item))
                            .filter(text => text.length > 0);
                        
                        if (items.length > 0 && currentSection) {
                            result[currentSection].push(...items);
                        }
                    }
                });
        
                return result;
            });
        
            about = aboutContent;
            console.log('Extracted about content:', about);
        
        } catch (err) {
            console.error('Error in About section scraping:', {
                message: err.message,
                stack: err.stack,
                phase: 'about-tab-scraping',
                timestamp: new Date().toISOString()
            });
        }
        return {
            url,
            title: titleName,
            avgRating,
            totalNumberOfReviews,
            description,
            category,
            address,
            openHours,
            websiteLink,
            phoneNumber,
            reviews,
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

module.exports = { scrapePoi_Debug };
