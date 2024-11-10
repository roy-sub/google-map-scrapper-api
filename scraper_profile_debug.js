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
        let about = {};
        try {
            console.log('Starting About tab scraping process with enhanced debugging...');
            
            // Inject debug logging functions into the page
            await page.evaluate(() => {
                const logDOMState = () => {
                    console.log('DOM State Check:');
                    console.log('About tab exists:', !!document.querySelector('button[aria-label^="About"][role="tab"]'));
                    
                    // Log all tab elements
                    const tabs = document.querySelectorAll('[role="tab"]');
                    console.log('Available tabs:', Array.from(tabs).map(tab => tab.getAttribute('aria-label')));
                    
                    // Check content visibility
                    const aboutContent = document.querySelectorAll('div.iP2t7d');
                    console.log('About content elements found:', aboutContent.length);
                    console.log('About content visible:', Array.from(aboutContent).some(el => el.offsetParent !== null));
                    
                    // Log DOM structure
                    console.log('Parent container structure:', 
                        document.querySelector('button[aria-label^="About"]')?.closest('[role="tablist"]')?.innerHTML
                    );
                };

                // Log initial state
                console.log('Initial DOM state:');
                logDOMState();

                // Watch for DOM changes
                const observer = new MutationObserver((mutations) => {
                    console.log('DOM mutation detected:', mutations.length, 'changes');
                    logDOMState();
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true
                });
            });

            // Wait for About tab with debugging
            console.log('Attempting to locate About tab button...');
            const aboutTab = await page.waitForSelector('button[aria-label^="About"][role="tab"]', {
                timeout: 30000,
                visible: true
            });
            console.log('Successfully found About tab button');

            // Enhanced click handling with multiple promises
            console.log('Attempting to click About tab...');
            try {
                await Promise.all([
                    page.click('button[aria-label^="About"][role="tab"]'),
                    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}),
                    page.waitForResponse(response => response.url().includes('about')).catch(() => {})
                ]);
                console.log('Successfully clicked About tab and waited for response');
            } catch (clickError) {
                console.error('Error during About tab click:', clickError);
            }

            // Wait for content with debugging
            console.log('Waiting for About content to load...');
            await page.waitForFunction(() => {
                const selectors = [
                    'div[aria-label^="About"]',
                    'div.iP2t7d.fontBodyMedium',
                    'div[role="tabpanel"][aria-label^="About"]'
                ];
                return selectors.some(selector => document.querySelector(selector));
            }, { timeout: 30000 });

            // Extract content with debugging
            const subsections = await page.evaluate(() => {
                console.log('Starting content extraction...');
                const sections = document.querySelectorAll('div.iP2t7d.fontBodyMedium');
                console.log(`Found ${sections.length} subsections`);
                
                return Array.from(sections).map((section, index) => {
                    const titleElement = section.querySelector('h2.iL3Qke.fontTitleSmall');
                    const items = Array.from(section.querySelectorAll('li.hpLkke span'));
                    
                    const result = {
                        title: titleElement?.textContent || '',
                        items: items.map(item => item.textContent || '').filter(Boolean)
                    };
                    
                    console.log(`Processed subsection ${index}:`, {
                        title: result.title,
                        itemCount: result.items.length
                    });
                    
                    return result;
                }).filter(section => section.title && section.items.length > 0);
            });

            // Process extracted content
            subsections.forEach(({ title, items }) => {
                if (title && items.length > 0) {
                    console.log(`Adding subsection: ${title} with ${items.length} items`);
                    about[title] = items;
                }
            });

        } catch (err) {
            console.error('Critical error in About section scraping:', {
                message: err.message,
                stack: err.stack,
                phase: 'about-tab-scraping',
                aboutObject: about,
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
