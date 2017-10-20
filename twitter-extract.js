// Extract links.
const { URL } = require('url');
const Apify = require('apify');
const puppeteer = require('puppeteer');
const { typeCheck } = require('type-check');

const { log, dir } = console;

const INPUT_TYPE = `{
  baseUrl: String,
  postCSSSelector: String,
  usernames: [String],
}`;

const parseUrlFor = baseUrl => input => new URL(input, baseUrl);
let parseUrl = null;

async function extractUrls(browser, username, url, cssSelector) {
  let page = null;
  const result = {
    username,
    postsLinks: [],
  };
  try {
    page = await browser.newPage();
    log(`New browser page for: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector(cssSelector);

    const postsUrls = await page.evaluate((selector) => {
      const targets = Array.from(document.querySelectorAll(selector));
      return targets.map(target => target.dataset.permalinkPath);
    }, cssSelector);

    const parsedPostsUrls = postsUrls.map(parseUrl);
    result.postsLinks.push(...parsedPostsUrls);
  } catch (error) {
    throw new Error(`The page ${url}, could not be loaded: ${error}`);
  } finally {
    if (page) {
      await page.close().catch(error => log(`Error closing page: (${url}): ${error}.`));
    }
  }
  return result;
}

Apify.main(async () => {
  log('Aqui');
  const input = await Apify.getValue('INPUT');
  log(input);
  if (!typeCheck(INPUT_TYPE, input)) {
    log('Expected input:');
    log(INPUT_TYPE);
    log('Received input:');
    dir(input);
    throw new Error('Received invalid input');
  }
  const { baseUrl, usernames, postCSSSelector } = input;
  log(baseUrl, usernames);

  log('Openning browser...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS,
  });
  log('New browser window.');

  parseUrl = parseUrlFor(baseUrl);
  const allExtractedUrls = usernames.map((username) => {
    const { href } = parseUrl(username);
    return extractUrls(browser, username, href, postCSSSelector);
  });
  const urls = await Promise.all(allExtractedUrls);
  await Apify.setValue('ALL_LINKS', urls);
  log(urls);

  log('Closing browser.');
  await browser.close();
});
