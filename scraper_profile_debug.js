const puppeteer = require("puppeteer");
require("dotenv").config();

const scrapePoi_Debug = async (inputUrl) => {
    let browser = null;
    const url = inputUrl; // Using original URL to maintain HTTPS

    try {
        browser = await puppeteer.launch({
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-web-security",  // Handle mixed content
                "--allow-running-insecure-content", // Allow mixed content
                "--disable-features=IsolateOrigins,site-per-process", // Handle iframe issues
                "--ignore-certificate-errors",
                "--ignore-certificate-errors-spki-list",
            ],
            executablePath:
                process.env.NODE_ENV === "production"
                    ? process.env.PUPPETEER_EXECUTABLE_PATH
                    : puppeteer.executablePath(),
            timeout: 60000,
            headless: "new", // Use new headless mode
        });

        const page = await browser.newPage();
        
        // Configure page settings
        await page.setDefaultNavigationTimeout(60000);
        await page.setDefaultTimeout(60000);
        
        // Enable all necessary features
        await page.setBypassCSP(true);
        
        // Modified request interception
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            // Only block image and font resources
            if (['image', 'font'].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Handle console messages
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('Page Error:', msg.text());
            } else if (msg.type() === 'warning') {
                console.log('Page Warning:', msg.text());
            }
        });

        // Navigate with retry mechanism
        let retries = 3;
        while (retries > 0) {
            try {
                await page.goto(url, {
                    waitUntil: ['networkidle0', 'domcontentloaded'],
                    timeout: 60000
                });
                break;
            } catch (error) {
                retries--;
                console.log(`Navigation retry ${3 - retries}/3:`, error.message);
                if (retries === 0) throw error;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Wait for main content to load
        await page.waitForSelector('div[role="main"]', { timeout: 30000 });

        // About tab scraping with improved handling
        let about = {};
        try {
            console.log('Starting About tab scraping...');
            
            // Wait for tabs to be interactive
            await page.waitForFunction(() => {
                const tabs = document.querySelectorAll('button[role="tab"]');
                return Array.from(tabs).some(tab => tab.textContent.includes('About'));
            }, { timeout: 30000 });

            // Find and click About tab
            const aboutTab = await page.evaluateHandle(() => {
                const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
                return tabs.find(tab => tab.textContent.includes('About'));
            });

            if (!aboutTab) {
                throw new Error('About tab not found');
            }

            // Click with proper wait
            await Promise.all([
                aboutTab.click(),
                page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}),
                new Promise(resolve => setTimeout(resolve, 5000)) // Additional wait
            ]);

            // Extract content with retry
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    about = await page.evaluate(() => {
                        const results = {};
                        
                        // Find all content containers
                        const containers = document.querySelectorAll('[role="tabpanel"] div');
                        let currentSection = 'General';
                        
                        containers.forEach(container => {
                            // Check for headers
                            const header = container.querySelector('h1, h2, h3, .fontTitleSmall');
                            if (header) {
                                currentSection = header.textContent.trim();
                                if (!results[currentSection]) {
                                    results[currentSection] = [];
                                }
                            }
                            
                            // Check for content
                            const content = container.querySelector('.fontBodyMedium');
                            if (content && content.textContent.trim()) {
                                results[currentSection].push(content.textContent.trim());
                            }
                            
                            // Check for lists
                            const listItems = container.querySelectorAll('li');
                            if (listItems.length > 0) {
                                results[currentSection].push(
                                    ...Array.from(listItems)
                                        .map(item => item.textContent.trim())
                                        .filter(text => text.length > 0)
                                );
                            }
                        });
                        
                        return results;
                    });

                    if (Object.keys(about).length > 0) {
                        console.log('Successfully extracted About content');
                        break;
                    }
                    
                    console.log(`Attempt ${attempt + 1}: No content found, retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (err) {
                    console.log(`Attempt ${attempt + 1} failed:`, err.message);
                    if (attempt === 2) throw err;
                }
            }

        } catch (err) {
            console.error('Error in About section:', err);
            about = { error: err.message };
        }

        return { about };

    } catch (error) {
        console.error('Critical error:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close().catch(console.error);
        }
    }
};

module.exports = { scrapePoi_Debug };
