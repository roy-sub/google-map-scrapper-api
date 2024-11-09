const puppeteer = require("puppeteer");
// require("dotenv").config();

const encodeUrl = async (url) => {
    // Use let instead of const for variables that will be modified
    let baseUrl, query;
    
    // Initialize these variables using array destructuring
    [baseUrl, query] = url.split('?');
    
    let beforeData, dataPart;
    [beforeData, dataPart] = baseUrl.split('/data=');

    let parts = beforeData.split('/place/', 2);

    // Check if "/place/" exists in the URL
    if (parts.length === 2) {
        const placeParts = parts[1].split('/', 2);
        // Replace spaces with '+'
        placeParts[0] = placeParts[0].replace(/ /g, '+');
        parts[1] = placeParts.join('/');
        beforeData = parts.join('/place/');
    }

    // Handle data part encoding
    let encodedBaseUrl;
    if (dataPart) {
        // Replace '/g/' with '%2Fg%2F'
        const encodedDataPart = dataPart.replace('/g/', '%2Fg%2F');
        encodedBaseUrl = `${beforeData}/data=${encodedDataPart}`;
    } else {
        encodedBaseUrl = beforeData;
    }

    // Return the full encoded URL
    return query ? `${encodedBaseUrl}?${query}` : encodedBaseUrl;
};

const getRatingAndReviews = async (page) => {
    try {
        // Wait for the rating element to be available
        await page.waitForSelector('.LBgpqf .fontBodyMedium .F7nice span');

        // Extract rating and review count
        const ratingData = await page.evaluate(() => {
            const ratingElement = document.querySelector('.LBgpqf .fontBodyMedium .F7nice span span[aria-hidden="true"]');
            const reviewsElement = document.querySelector('.LBgpqf .fontBodyMedium .F7nice span span[aria-label*="reviews"]');

            const rating = ratingElement ? ratingElement.innerText : null;
            const reviews = reviewsElement ? reviewsElement.innerText.match(/\d+/)[0] : null;

            return { rating, reviews };
        });

        return ratingData;
    } catch (err) {
        return { rating: null, reviews: null };
    }
};

const scrapePoi = async (inputUrl) => {
    const url = await encodeUrl(inputUrl);

    try {
        const browser = await puppeteer.launch({
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
            ],
            executablePath:
                process.env.NODE_ENV === "production"
                    ? process.env.PUPPETEER_EXECUTABLE_PATH
                    : puppeteer.executablePath(),
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle0" });

        // 1. Scrape Title
        let titleName = '';
        try {
            titleName = await page.$eval('h1.DUwDvf', (el) => el.textContent.trim());
        } catch (err) {
            // No-op
        }

        // 2. Scrape Average Rating and Total Number of Reviews
        const ratingData = await getRatingAndReviews(page);
        const { rating: avgRating, reviews: totalNumberOfReviews } = ratingData;

        // 4. Scrape Description
        let description = '';
        try {
            description = await page.$eval('h2.bwoZTb.fontBodyMedium span', (el) => el.textContent.trim());
        } catch (err) {
            // No-op
        }

        // 5. Scrape Service Category
        let category = '';
        try {
            category = await page.$eval('button.DkEaL', (el) => el.textContent.trim());
        } catch (err) {
            // No-op
        }

        // 6. Scrape Address
        let address = '';
        try {
            const addressButton = await page.$('button[aria-label^="Address"]');
            address = await page.evaluate((el) => el.getAttribute('aria-label').split(': ')[1], addressButton);
        } catch (err) {
            // No-op
        }

        // 7. Scrape Open Hours
        let openHours = '';
        try {
            const openHoursElement = await page.$('.t39EBf.GUrTXd');
            openHours = await page.evaluate((el) => el.getAttribute('aria-label'), openHoursElement);
        } catch (err) {
            // No-op
        }

        // 8. Scrape Website Link
        let websiteLink = '';
        try {
            const websiteElement = await page.$('a[aria-label^="Website"]');
            websiteLink = await page.evaluate((el) => el.getAttribute('href'), websiteElement);
        } catch (err) {
            // No-op
        }

        // 9. Scrape Phone Number
        let phoneNumber = '';
        try {
            const phoneButton = await page.$('button[aria-label^="Phone"]');
            const phoneButtonText = await page.evaluate((el) => el.textContent, phoneButton);
            phoneNumber = phoneButtonText.split('\n').pop();
        } catch (err) {
            // No-op
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
            const profilePictureButton = await page.$('button.aoRNLd[aria-label^="Photo of"]');
            const imgElement = await profilePictureButton.$('img');
            profilePictureUrl = await page.evaluate((el) => el.getAttribute('src'), imgElement);
        } catch (err) {
            // No-op
        }

        // 12. Scrape About Tab
        let about = {};
        try {
            const aboutTab = await page.waitForSelector('button[aria-label^="About"][role="tab"]', { timeout: 10000 });
            await aboutTab.click();

            await page.waitForSelector('div[aria-label^="About"]', { timeout: 10000 });

            const aboutSection = await page.$('div[aria-label^="About"]');

            const subsections = await aboutSection.$$eval('div.iP2t7d.fontBodyMedium', (els) =>
                els.map((el) => ({
                    title: el.querySelector('h2.iL3Qke.fontTitleSmall').textContent,
                    items: Array.from(el.querySelectorAll('li.hpLkke span')).map((i) => i.textContent)
                }))
            );

            subsections.forEach(({ title, items }) => {
                about[title] = items;
            });
        } catch (err) {
            // No-op
        }

        await browser.close();

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
    }
};

module.exports = { scrapePoi };
