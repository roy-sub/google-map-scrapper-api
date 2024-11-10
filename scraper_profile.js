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

const setupBrowser = async () => {
    const options = {
        headless: "new",
        args: [
            "--disable-setuid-sandbox",
            "--no-sandbox",
            "--single-process",
            "--no-zygote",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
            "--ignore-certificate-errors",
            "--window-size=1920,1080",
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
    };

    try {
        return await puppeteer.launch(options);
    } catch (error) {
        console.error("Browser launch error:", error);
        throw error;
    }
};

const scrapePoi = async (inputUrl) => {
    let browser = null;
    let page = null;
    
    try {
        const url = await encodeUrl(inputUrl);
        browser = await setupBrowser();
        page = await browser.newPage();

        // Set up page configurations
        await Promise.all([
            page.setDefaultNavigationTimeout(60000),
            page.setDefaultTimeout(60000),
            page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'),
        ]);

        // Minimal request interception
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Navigation with retries
        let loaded = false;
        for (let i = 0; i < 3 && !loaded; i++) {
            try {
                await page.goto(url, { 
                    waitUntil: ["domcontentloaded", "networkidle2"],
                    timeout: 30000 
                });
                loaded = true;
            } catch (error) {
                console.log(`Navigation attempt ${i + 1} failed:`, error.message);
                if (i === 2) throw error;
                await page.waitForTimeout(2000);
            }
        }

        // Wait for critical content
        await page.waitForTimeout(2000);

        // Scrape basic information
        const basicInfo = await page.evaluate(() => {
            try {
                return {
                    title: document.querySelector('h1.DUwDvf')?.textContent?.trim() || '',
                    description: document.querySelector('h2.bwoZTb.fontBodyMedium span')?.textContent?.trim() || '',
                    category: document.querySelector('button.DkEaL')?.textContent?.trim() || '',
                    address: document.querySelector('button[aria-label^="Address"]')?.getAttribute('aria-label')?.split(': ')?.[1] || '',
                    openHours: document.querySelector('.t39EBf.GUrTXd')?.getAttribute('aria-label') || '',
                    websiteLink: document.querySelector('a[aria-label^="Website"]')?.href || '',
                    phoneNumber: document.querySelector('button[aria-label^="Phone"]')?.textContent?.split('\n')?.pop() || '',
                };
            } catch (error) {
                console.error('Error in basic info scraping:', error);
                return {};
            }
        });

        // Scrape rating and reviews count
        const ratingData = await page.evaluate(() => {
            try {
                const ratingEl = document.querySelector('.LBgpqf .fontBodyMedium .F7nice span span[aria-hidden="true"]');
                const reviewsEl = document.querySelector('.LBgpqf .fontBodyMedium .F7nice span span[aria-label*="reviews"]');
                
                return {
                    rating: ratingEl?.textContent || null,
                    reviews: reviewsEl?.textContent?.match(/\d+/)?.[0] || null
                };
            } catch (error) {
                console.error('Error in rating scraping:', error);
                return { rating: null, reviews: null };
            }
        });

        // Scrape reviews
        const reviews = await page.evaluate(() => {
            try {
                const reviewsList = [];
                const reviewElements = Array.from(document.querySelectorAll('.DUGVrf [jslog*="track:click"], .wiI7pd'));
                
                reviewElements.forEach(el => {
                    const text = el.getAttribute('aria-label')?.match(/"([^"]*)"/)?.[1] || el.textContent?.trim();
                    if (text) reviewsList.push(text);
                });
                
                return reviewsList;
            } catch (error) {
                console.error('Error in reviews scraping:', error);
                return [];
            }
        });

        // Scrape about section
        let about = {};
        try {
            const aboutTab = await page.$('button[aria-label^="About"][role="tab"]');
            if (aboutTab) {
                await aboutTab.click();
                await page.waitForTimeout(2000);

                about = await page.evaluate(() => {
                    const result = {};
                    const sections = document.querySelectorAll('.iP2t7d.fontBodyMedium');
                    
                    sections.forEach(section => {
                        const title = section.querySelector('h2.iL3Qke.fontTitleSmall')?.textContent?.trim();
                        if (!title) return;
                        
                        const items = Array.from(section.querySelectorAll('li.hpLkke span'))
                            .map(item => item.textContent?.trim() || '')
                            .filter(Boolean);
                        
                        if (items.length > 0) {
                            result[title] = items;
                        }
                    });
                    
                    return result;
                });
            }
        } catch (error) {
            console.error('Error in about section scraping:', error);
        }

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
        console.error('Scraping error:', error);
        throw error;
    } finally {
        if (page) {
            await page.close().catch(console.error);
        }
        if (browser) {
            await browser.close().catch(console.error);
        }
    }
};

module.exports = { scrapePoi };
