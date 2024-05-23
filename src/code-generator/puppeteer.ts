import Block from './block'
import { headlessActions } from './constants'
import BaseGenerator, {
  Options,
  Event,
  getLastPageUrl,
  isSplunkUrl,
} from './base-generator'

export const CHROME_USER_DATA_DIR = './tmp/chromium-user-data'

const importPuppeteer = ({ isStealthPluginEnabled = true } = {}) => `
  const totp = require("totp-generator");
  const puppeteer = require("puppeteer");
  const { addExtra } = require("puppeteer-extra")
  const StealthPlugin = require("puppeteer-extra-plugin-stealth")
  const any = require("promise.any");
  const sharp = require("sharp");

  const puppeteerExtra = addExtra(puppeteer)
  ${
    isStealthPluginEnabled
      ? `
      const stealthPlugin = StealthPlugin();
      stealthPlugin.enabledEvasions.delete("iframe.contentWindow");
      stealthPlugin.enabledEvasions.delete("navigator.plugins");
      puppeteerExtra.use(stealthPlugin)
  `
      : ``
  }
`

// FIXME: dashboardId is not used =\
const genHeader = ({
  proxy,
  dashboardId,
}: {
  proxy: string | null
  dashboardId: string
}) => `
  const puppArgs = {
    args: ["--disable-web-security", "--ignore-certificate-errors", "--ignore-certificate-errors-spki-list"],
    headless: "new",
    ignoreHTTPSErrors: true,
    userDataDir: "${CHROME_USER_DATA_DIR}/${dashboardId}",
    executablePath: await chromium.executablePath,
  };
  const browser = await puppeteerExtra.launch(puppArgs);
  console.log(JSON.stringify(puppArgs));

  const process = browser.process();
  parentPortA.postMessage({ pid: process.pid });

  const initialTabCount = (await browser.pages()).length;
  let page = await browser.newPage();
  page.on('console', (msg) => {
    for (let i = 0; i < msg.args().length; ++i)
      console.log(\`Page console \${i}: \${msg.args()[i]}\`);
  });
  
  page.on('framenavigated', (frame) => {
    console.log('framenavigated', frame.url());
  });
  page.on('requestfailed', (request) => {
    console.log(\`url: \${request.url()}, errText: \${request.failure().errorText}, method: \${request.method()}\`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.log('response not ok', response.status(), response.url());
    }
  });
  try {
    await page.setBypassCSP(true)
`

const footer = `
    await closeBrowser(browser);
    return [screenshot, null]
  } catch (e) {
    console.log("SCREENSHOT FAILED");
    console.log(e);
    const screenshot = await page.screenshot({ type: "jpeg", quality: 90 });
    await closeBrowser(browser);
    return [screenshot, null];
  }

  async function closeBrowser(browser) {
    const openPages = await browser.pages();
    await Promise.all(openPages.map((page) => page.close()));
    console.log("All pages are closed");
    await Promise.race([
      browser.close(),
      new Promise((resolve) =>
        setTimeout(() => {
          console.log("Browser close timeout");
          resolve();
        }, 5000)
      ),
    ]);
    console.log("Browser is closed");
  }

  async function getTotpCode(secret) {
    const code = totp(secret);
    console.log("totp code: " + code);
    return code;
  }

  function waitForNetworkIdle({ page, timeout = 10000, waitForFirstRequest = 5000, waitForLastRequest = 3000, maxInflightRequests = 2 }) {
    const start = Date.now();
    let inflight = 0;
    let resolve;
    let reject;
    let firstRequestTimeoutId;
    let lastRequestTimeoutId;
    let timeoutId;
    maxInflightRequests = Math.max(maxInflightRequests, 0);
  
    function cleanup() {
      clearTimeout(timeoutId);
      clearTimeout(firstRequestTimeoutId);
      clearTimeout(lastRequestTimeoutId);
      /* eslint-disable no-use-before-define */
      //page.removeListener('request', onRequestStarted);
      //page.removeListener('requestfinished', onRequestFinished);
      //page.removeListener('requestfailed', onRequestFinished);
      /* eslint-enable no-use-before-define */
    }
  
    function check() {
      if (inflight <= maxInflightRequests) {
        clearTimeout(lastRequestTimeoutId);
        lastRequestTimeoutId = setTimeout(onLastRequestTimeout, waitForLastRequest);
      }
    }
  
    function onRequestStarted() {
      clearTimeout(firstRequestTimeoutId);
      clearTimeout(lastRequestTimeoutId);
      inflight += 1;
    }
  
    function onRequestFinished() {
      inflight -= 1;
      check();
    }
  
    function onTimeout() {
      cleanupAndResolve("Timeouted waiting for network idle");
    }
  
    function onFirstRequestTimeout() {
      cleanupAndResolve("Timeouted waiting for the first request");
    }
  
    function onLastRequestTimeout() {
      cleanupAndResolve("Timeouted after the last request");
    }

    function cleanupAndResolve(msg) {
      console.log(msg);
      console.log(\`Waiting time for the network to idle: \${Date.now() - start}ms\`)
      cleanup();
      resolve();
    }
  
    page.on('request', onRequestStarted);
    page.on('requestfinished', onRequestFinished);
    page.on('requestfailed', onRequestFinished);
  
    timeoutId = setTimeout(onTimeout, timeout); // Overall page timeout
    firstRequestTimeoutId = setTimeout(onFirstRequestTimeout, waitForFirstRequest);
  
    return new Promise((res, rej) => { resolve = res; reject = rej; });
  }
`

export default class PuppeteerCodeGenerator extends BaseGenerator {
  constructor(options?: Options) {
    super(options)
    this._footer = footer
  }

  generate(events: Event[], tenantId: string, dashboardId: string) {
    const proxy = getProxy(events, tenantId)
    console.log(`Proxy ${proxy ? 'enabled' : 'not used'}`)
    this._header = genHeader({ proxy, dashboardId })
    const lastPageUrl = getLastPageUrl(events)
    const isSplunk = isSplunkUrl(lastPageUrl)
    const code =
      importPuppeteer({ isStealthPluginEnabled: !isSplunk }) +
      this._getHeader() +
      this._parseEvents(events, tenantId) +
      this._getFooter()
    return code
  }

  _handleViewport(width: number, height: number) {
    return new Block(this._frameId, {
      type: headlessActions.VIEWPORT,
      value: `await ${this._frame}.setViewport({ width: ${width}, height: ${height} })`,
    })
  }
}

const NATIONAL_LOCUMS_TENANT_ID = '9c28739e-a6be-42cf-a7e3-13c9430d15a8'
const ELEGALINC_TENANT_ID = '5e37b7b9-4573-4545-83c6-3baaf9eceb4e'
const MPB_TENANT_ID = '40e335a8-0659-4224-a59e-6bc0494fd645'
const VIRGINIA_PROXY = '54.85.73.37:8888'
const UK_PROXY = '35.177.131.253:8888'
function getProxy(events: Event[], tenantId: string): string | null {
  const lastPageUrl = getLastPageUrl(events)
  const isHCDB = lastPageUrl.includes('hchb.com/')
  const isSquareUp = lastPageUrl.includes('squareup.com')
  if (
    tenantId === NATIONAL_LOCUMS_TENANT_ID ||
    tenantId === ELEGALINC_TENANT_ID ||
    isHCDB ||
    isSquareUp
  ) {
    return VIRGINIA_PROXY
  }
  if (tenantId === MPB_TENANT_ID) {
    return UK_PROXY
  }
  return null
}
