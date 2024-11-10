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

        // 11. Profile Photo
        let profilePictureUrl = '';
        try {
            // Wait for button using a single class name
            await page.waitForSelector('button.aoRNLd', { timeout: 30000 });
            
            // Get the profile picture URL
            profilePictureUrl = await page.evaluate(() => {
                const button = document.querySelector('button.aoRNLd');
                if (!button) return '';
                
                const img = button.querySelector('img');
                if (!img) return '';
                
                return img.src || '';
            });
        } catch (err) {
            console.log("Error getting profile picture:", err.message);
        }
        
        // 12. Scrape About Tab
        let about = {};
        try {
            console.log('Starting About tab scraping process...');
            
            // Wait for the About tab with increased timeout
            console.log('Attempting to locate About tab button...');
            const aboutTab = await page.waitForSelector('button[aria-label^="About"][role="tab"]', { 
                timeout: 30000,
                visible: true 
            });
            console.log('Successfully found About tab button');
        
            // Click the About tab and wait for navigation
            console.log('Attempting to click About tab...');
            try {
                await Promise.all([
                    aboutTab.click(),
                    page.waitForTimeout(2000) // Give some time for content to load
                ]);
                console.log('Successfully clicked About tab and waited for timeout');
            } catch (clickError) {
                console.error('Error clicking About tab:', {
                    message: clickError.message,
                    stack: clickError.stack
                });
                throw clickError;
            }
        
            // Try multiple selectors for the About section
            const aboutSelectors = [
                'div[aria-label^="About"]',
                'div.iP2t7d.fontBodyMedium',
                'div[role="tabpanel"][aria-label^="About"]'
            ];
            
            console.log('Attempting to find About section using multiple selectors:', aboutSelectors);
            
            let aboutSection = null;
            let successfulSelector = null;
            
            for (const selector of aboutSelectors) {
                try {
                    console.log(`Trying selector: ${selector}`);
                    aboutSection = await page.waitForSelector(selector, { 
                        timeout: 20000,
                        visible: true 
                    });
                    if (aboutSection) {
                        successfulSelector = selector;
                        console.log(`Successfully found About section using selector: ${selector}`);
                        break;
                    }
                } catch (selectorError) {
                    console.log(`Selector "${selector}" failed:`, {
                        message: selectorError.message,
                        stack: selectorError.stack
                    });
                    continue;
                }
            }
        
            if (!aboutSection) {
                console.error('Failed to find About section with any selector');
                throw new Error('No valid About section selector found');
            }
        
            if (aboutSection) {
                console.log('Beginning content extraction from About section...');
                
                // Use a single evaluate call to get all subsections
                const subsections = await page.evaluate(() => {
                    console.log('Starting client-side evaluation...');
                    
                    const sections = document.querySelectorAll('div.iP2t7d.fontBodyMedium');
                    console.log(`Found ${sections.length} potential subsections`);
                    
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
        
                console.log(`Successfully extracted ${subsections.length} subsections`);
                
                subsections.forEach(({ title, items }) => {
                    if (title && items.length > 0) {
                        console.log(`Adding subsection to about object: ${title} with ${items.length} items`);
                        about[title] = items;
                    } else {
                        console.log(`Skipping invalid subsection:`, { title, itemCount: items.length });
                    }
                });
                
                console.log('Final about object structure:', {
                    sectionCount: Object.keys(about).length,
                    sections: Object.keys(about)
                });
            }
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
            profilePictureUrl,
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
