const Apify = require('apify');
const moment = require('moment');
const puppeteer = require('puppeteer');
const { typeCheck } = require('type-check');

const { log, dir } = console;

const INPUT_TYPE = `{
  postCssSelector: String,
  extractActInput: Object | String
}`;

const results = {
  posts: [],
};

async function crawlUrl(browser, username, url, cssSelector = 'article') {
  let page = null;
  let crawlResult = {};
  try {
    page = await browser.newPage();
    log(`New browser page for: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector(cssSelector);

    // Crawl page
    const tagHandle = await page.$(cssSelector);
    crawlResult = await page.evaluate((tag) => {
      const handle = tag.dataset.screenName;
      const postText = tag.querySelector('.js-tweet-text-container').textContent;
      const time = tag.querySelector('.client-and-actions').textContent;
      return {
        handle,
        url: document.URL,
        'post-text': postText.trim(),
        'date/time': time.trim(),
      };
    }, tagHandle);

    // Adding only previous day posts.
    const previousDay = moment().subtract(1, 'day').startOf('day');
    log('Previous day', previousDay);
    const postDate = moment(crawlResult['date/time'], 'HH:mm A - DD MMM YYYY');
    log('Post Date', postDate, crawlResult['date/time']);
    if (postDate >= previousDay) {
      results.posts.push(crawlResult);
    }
  } catch (error) {
    throw new Error(`The page ${url}, could not be loaded: ${error}`);
  } finally {
    if (page) {
      await page.close().catch(error => log(`Error closing page: (${url}): ${error}.`));
    }
  }
  return crawlResult;
}

Apify.main(async () => {
  const input = await Apify.getValue('INPUT');
  if (!typeCheck(INPUT_TYPE, input)) {
    log('Expected input:');
    log(INPUT_TYPE);
    log('Received input:');
    dir(input);
    throw new Error('Received invalid input');
  }
  const {
    postCssSelector,
    extractActInput,
  } = input;

  log('Calling link-extractor with extractActInput...');
  const { output } = await Apify.call('juansgaitan/link-extractor', extractActInput);
  log('Link-Extractor Data: ', output.body);
  const arrayOfUsers = output.body;

  log('Openning browser...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS,
  });
  log('New browser window.');

  const crawlData = arrayOfUsers.map(({ username, postsLinks }) => (
    postsLinks.reduce((prev, url) => (
      prev.then(() => crawlUrl(browser, username, url, postCssSelector))
    ), Promise.resolve())
  ));
  await Promise.all(crawlData);

  log('Setting OUTPUT result...');
  await Apify.setValue('OUTPUT', results);

  log('Closing browser.');
  await browser.close();
});
