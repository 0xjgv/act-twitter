// Crawl links.
const Apify = require('apify');
const puppeteer = require('puppeteer');
const { typeCheck } = require('type-check');
const requestPromise = require('request-promise');

const { log, dir } = console;

const INPUT_TYPE = `{
  actId: String,
  token: String,
  postCSSSelector: String,
  extractActInput: Object
}`;

const results = {};

async function crawlUrl(browser, username, url, cssSelector = 'article') {
  let page = null;
  let crawlResult = {};
  try {
    page = await browser.newPage();
    log(`New browser page for: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector(cssSelector);

    // Crawl page
    const articleHandle = await page.$(cssSelector);
    crawlResult = await page.evaluate((article) => {
      const handle = article.querySelector('[title]').title;
      let postText = [...article.querySelectorAll(`[title="${handle}"]`)];
      postText = postText[1] ? postText[1].nextElementSibling.textContent : '';
      const time = article.querySelector('time').getAttribute('datetime');
      return {
        handle,
        url: document.URL,
        'post-text': postText || 'No text post',
        'date/time': time,
      };
    }, articleHandle);

    results[username].push(crawlResult);
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
  let uri = null;
  const input = await Apify.getValue('INPUT');
  if (!typeCheck(INPUT_TYPE, input)) {
    log('Expected input:');
    log(INPUT_TYPE);
    log('Received input:');
    dir(input);
    throw new Error('Received invalid input');
  }
  const {
    actId,
    token,
    postCSSSelector,
    extractActInput,
  } = input;
  log(extractActInput);

  const waitForFinish = 'waitForFinish=60';
  uri = `https://api.apify.com/v2/acts/${actId}/runs?token=${token}&${waitForFinish}`;
  let options = {
    uri,
    method: 'POST',
    'content-type': 'application/json',
    body: extractActInput,
    json: true,
  };
  log('REQUESTING ACT-EXTRACT...');
  const { data } = await requestPromise(options);
  log('ACT-EXTRACT Run result: ', data);

  const storeId = data.defaultKeyValueStoreId;
  const recordKey = 'ALL_LINKS';
  uri = `https://api.apify.com/v2/key-value-stores/${storeId}/records/${recordKey}`;
  options = {
    uri,
    method: 'GET',
    gzip: true,
    'content-type': 'application/json',
    json: true,
  };
  log('REQUESTING ACT-EXTRACT STORED RECORD...');
  const arrayOfUsers = await requestPromise(options);
  log('ACT-Extract Stored record: ', arrayOfUsers);

  log('Openning browser...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS,
  });
  log('New browser window.');

  const crawlData = arrayOfUsers.map(({ username, postsLinks }) => {
    Object.assign(results, { [username]: [] });
    return postsLinks.reduce((prev, url) => (
      prev.then(() => crawlUrl(browser, username, url, postCSSSelector))
    ), Promise.resolve());
  });
  await Promise.all(crawlData);

  log('SETTING OUTPUT RESULT...');
  await Apify.setValue('OUTPUT', results);

  log('Closing browser.');
  await browser.close();
});
