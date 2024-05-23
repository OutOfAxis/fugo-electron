import Block from './block'
import { eventsToRecord, headlessActions } from './constants'
import { findLast } from 'lodash'

export const defaults = {
  wrapAsync: false,
  headless: true,
  waitForNavigation: true,
  waitForSelectorOnClick: true,
  blankLinesBetweenBlocks: true,
  dataAttribute: '',
  showPlaywrightFirst: true,
  keyCode: 9,
} as const

export default abstract class BaseGenerator {
  _options: Options
  _blocks: Block[]
  _frame: string
  _frameId: number
  _allFrameIndices: { [key: number]: number }
  _allFrameSelectors: { [key: number]: string[] | null }
  _allFrames: { [keys: number]: string }
  _screenshotCounter: number
  _wrappedHeader: string = ''
  _header: string = ''
  _wrappedFooter: string = ''
  _footer: string = ''
  _initialUrl: string = ''
  _lastUrl: string = ''
  _scroll: number = 0

  constructor(options?: Options) {
    this._options = Object.assign(defaults, options)
    this._blocks = []
    this._frame = 'page'
    this._frameId = 0
    this._allFrameIndices = {}
    this._allFrameSelectors = {}
    this._allFrames = {}
    this._screenshotCounter = 0
  }

  _getHeader() {
    let hdr = this._header
    hdr = this._options.headless
      ? hdr
      : hdr?.replace('launch()', 'launch({ headless: false })')
    return hdr
  }

  _getFooter() {
    return this._options.wrapAsync ? this._wrappedFooter : this._footer
  }

  _parseEvents(events: Event[], tenantId: string) {
    let result = ''

    if (!events) return result
    this._lastUrl = getLastPageUrl(events)

    const canUseCustomCode = this.canUseCustomCode(events, tenantId)
    if (canUseCustomCode) {
      console.log('CAN OMIT')
      const newEvents = this.generateCustomCode(events)
      events = newEvents
    } else {
      console.log('CANNOT OMIT')
      const newEvents = this.optimizeEvents(events)
      events = newEvents
    }

    if (shouldSimplifySelectors(events)) {
      console.log('simplifying selectors')
      events = simplifySelectors(events)
    }

    if (shouldFixForKibana(events)) {
      console.log('fixing for kibana')
      events = fixKibana(events)
    }

    let lastTabIndex = 0
    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      const { action, frameId, frameUrl, frameIndex, frameSelectors } = event
      const selector = 'selector' in event ? event.selector : ''
      const escapedSelector = selector
        ? selector?.replace(/\\/g, '\\\\')
        : selector

      // we need to keep a handle on what frames events originate from
      this._setFrames(frameId, frameUrl, frameIndex, frameSelectors)

      const tabIndex = event.tabIndex
      if (
        tabIndex != undefined &&
        tabIndex !== lastTabIndex &&
        !canUseCustomCode
      ) {
        this._blocks.push(
          new Block(this._frameId, {
            type: headlessActions.PAGE_SET,
            value: `
              await (async () => {
                await Promise.all([
                  waitForNetworkIdle({ page: ${this._frame}, timeout: 3000 }),
                  new Promise(resolve => setTimeout(resolve, 1000))
                ]);
                const pageList = await browser.pages();
                if (pageList.length < initialTabCount + ${tabIndex}) {
                  return;
                }
                page = pageList[initialTabCount + ${tabIndex}];
                await page.bringToFront();
                await waitForNetworkIdle({ page: page, timeout: 3000 });
              })()
            `,
          })
        )
        lastTabIndex = tabIndex
      }

      switch (action) {
        case eventsToRecord.SUBMIT:
          this._blocks.push(this._handleSubmit(escapedSelector))
          break
        case 'keydown':
          if (event.keyCode === this._options.keyCode) {
            this._blocks.push(this._handleKeyDown(escapedSelector, event.value))
          }
          break
        case 'click':
          this._blocks.push(this._handleClick(escapedSelector))
          break
        case 'change':
          if (event.tagName === 'SELECT') {
            this._blocks.push(this._handleChange(escapedSelector, event.value))
          } else if (event.tagName === 'INPUT') {
            this._blocks.push(
              this._handleInputChange(escapedSelector, event.value)
            )
          }
          break
        case headlessActions.GOTO:
          this._blocks.push(this._handleGoto(event.href))
          break
        case headlessActions.VIEWPORT:
          this._blocks.push(
            this._handleViewport(event.value.width, event.value.height)
          )
          break
        case headlessActions.NAVIGATION:
          this._blocks.push(this._handleWaitForNavigation())
          break
        case headlessActions.SCREENSHOT:
          this._blocks.push(this._handleScreenshot(event.value))
          break
        case 'totp':
          this._blocks.push(this._handleTotp(escapedSelector, event.value))
          break
        case 'removeElement':
          this._blocks.push(this._handleRemoveElement(escapedSelector))
          break
        case headlessActions.PAUSE:
          const pauseBlock = this._handlePause(event.value)
          if (pauseBlock) {
            this._blocks.push(pauseBlock)
          }
          break
        case headlessActions.SCROLL:
          const scrollBlock = this._handleScroll(event.value)
          if (scrollBlock) {
            this._blocks.push(scrollBlock)
          }
          break
        case 'custom':
          this._blocks.push(
            new Block(this._frameId, {
              type: headlessActions.CUSTOM,
              value: event.code,
            })
          )
          break
      }
    }

    const block = new Block(0, {
      type: headlessActions.NAVIGATION_PROMISE,
      value: 'let navigationPromise = page.waitForNavigation()',
    })
    this._blocks.unshift(block)

    this._postProcess()

    const indent = this._options.wrapAsync ? '  ' : ''
    const newLine = `\n`

    for (let block of this._blocks) {
      const lines = block.getLines()
      for (let line of lines) {
        result += indent + line.value + newLine
      }
    }

    return result
  }

  optimizeEvents(events: Event[]): Event[] {
    return optimizeGoogleAuthentication(events)
  }

  generateCustomCode(events: Event[]): Event[] {
    const removeElementEvents = events.filter(
      (e) => e.action === 'removeElement'
    )
    const initialUrl = this.getInitialUrl(events)
    const lastPageUrl = getLastPageUrl(events)
    const screenshotEvent = findLast(
      events,
      (event) => event.action === headlessActions.SCREENSHOT
    ) ?? {
      action: headlessActions.SCREENSHOT,
      value: '',
      frameId: null,
      frameUrl: null,
      frameIndex: null,
      frameSelectors: null,
      isSecret: false,
    }
    const email = (
      findLast(
        events,
        (event) =>
          event.action === 'change' &&
          event.value.includes('@') &&
          event.value.includes('.')
      ) as ChangeEvent
    )?.value
    const password = (
      findLast(
        events,
        (event) => event.action === 'change' && event.isSecret
      ) as ChangeEvent
    )?.value
    const viewportEvent =
      events.find((event) => event.action === headlessActions.VIEWPORT) ||
      events[0]
    const totpEvent = events.find((event) => isTotpEvent(event)) as TotpEvent
    const secretKey = totpEvent?.value || ''
    const pauseEvent = events.find(
      (event) => event.action === headlessActions.PAUSE
    )
    const scrollEvent = events.find(
      (event) => event.action === headlessActions.SCROLL
    )
    if (isPowerBiUrl(lastPageUrl) || isDynamicsUrl(lastPageUrl)) {
      const isOAE = email === 'onairfugo@derivco.com'
      const oaeLastPageUrl = lastPageUrl.includes('rproxy.goskope.com')
        ? lastPageUrl
        : lastPageUrl.replace(
            'https://app.powerbi.com',
            'https://app.powerbi.com.rproxy.goskope.com'
          )
      const newEvents = [
        viewportEvent,
        {
          action: 'custom',
          code: `
            const isOAE = ${isOAE};
            if (isOAE) {
              await page.goto("https://portal.office.com");
            } else {
              await page.goto("${lastPageUrl}");

              // PowerBI flashes email collection form that confuses the rest of the script
              await new Promise((resolve) => setTimeout(resolve, 5000));
            }

            // determine whether we need to login
            const containerSelector = "#content-container";
            const userPickerItemSelector = ".tile-container";
            const loginLinkSelector = ".bapi-menu > .is-menu-link:nth-child(2) > a > span";
            const emailSelector = '#i0116 , .row > .form-group .form-control'
            const codeSelector = 'input[name="otc"]';
            const emailCollectionSelector = '#emailCollection';
            const createTaggedPromise = async (tag, promise) => {
              await promise;
              return tag;
            }

            const waitForEmailCollectionPage = createTaggedPromise(
              "emailCollection",
              page.waitForSelector(emailCollectionSelector, { timeout: 20000 })
            );
            const waitForHomePage = createTaggedPromise(
              "home",
              page.waitForSelector(containerSelector, { timeout: 20000 })
            );
            const waitForLoginLink = createTaggedPromise(
              "login",
              page.waitForSelector(loginLinkSelector, { timeout: 20000 })
            );
            const waitForUserPicker = createTaggedPromise(
              "picker",
              page.waitForSelector(userPickerItemSelector, { timeout: 20000 })
            );
            const waitForAuthForm = createTaggedPromise(
              "auth",
              page.waitForSelector(emailSelector, { timeout: 20000 })
            );
            const waitForCode = createTaggedPromise(
              "code",
              page.waitForSelector(codeSelector, { timeout: 20000 })
            );

            let pageKind = "auth";
            try {
              pageKind = await any([
                waitForEmailCollectionPage,
                waitForHomePage,
                waitForLoginLink,
                waitForUserPicker,
                waitForAuthForm,
                waitForCode
              ]);
            } catch (e) {
              console.log("Nothing showed up");
              await page.goto("https://app.powerbi.com/?noSignUpCheck=1", { timeout: 60000 });
            }

            const passwordSelector = '#i0118';
            const nextSelector = '#idSIButton9';
            console.log({ pageKind });

            switch (pageKind) {
              case "home":
                // already logged in
                break;
              case "login":
                // click on Login
                await page.click(loginLinkSelector);
              case "auth":
                // pause
                await Promise.all([
                  waitForNetworkIdle({ page: page, timeout: 3000 }),
                  new Promise(resolve => setTimeout(resolve, 3000))
                ]);

                // switch tab
                const pageList = await browser.pages();
                const newTabIndex = pageList.length - 1;
                page = pageList[newTabIndex];
                console.log(\`Switching to tab #\${newTabIndex}\`);
                console.log(\`Tab count: \${pageList.length}\`);
                await page.bringToFront();

                try {
                  // type email
                  await page.waitForSelector(emailSelector, { timeout: 10000 });
                  await page.evaluate(
                    () => (document.getElementById("i0116").value = "")
                  );
                  await new Promise((resolve) => setTimeout(resolve, 1500));
                  await page.click(emailSelector);
                  await page.type(emailSelector, '${email}');
                  await new Promise((resolve) => setTimeout(resolve, 1500));
                  console.log("typed email");

                  // click next
                  await page.waitForSelector(nextSelector, { timeout: 10000 });
                  await page.click(nextSelector);
                  console.log("clicked next");
                  await new Promise((resolve) => setTimeout(resolve, 15000));
                } catch (e) {
                  console.log("Failed to type email, skipping");
                }

                await passwordFlow();

                break;
              case "picker":
                await page.click(userPickerItemSelector);
                await enterPassword();
                await enter2faCode();
                await kmsi();
                break;
              case "code":
                await enter2faCode();
                await kmsi();
                break;
              case "emailCollection":
                // type email
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const emailCollectionInputSelector = '.pbi-text-input';
                await page.waitForSelector(emailCollectionInputSelector, { timeout: 10000 });
                await page.click(emailCollectionInputSelector);
                await page.type(emailCollectionInputSelector, '${email}')
                console.log("Entered email");

                // click submit
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const submitSelector = '#submitBtn';
                await page.click(submitSelector);
                console.log("Clicked submit");

                await passwordFlow();
                break;
            }

            async function passwordFlow() {
              const oktaUserNameSelector = "input[name=identifier]";
        
              const waitForPowerBi = createTaggedPromise(
                "powerbi",
                page.waitForSelector(passwordSelector, { timeout: 15000 })
              );
              const waitForOkta = createTaggedPromise(
                "okta",
                page.waitForSelector(oktaUserNameSelector, { timeout: 15000 })
              );
              const pageKind = await any([waitForPowerBi, waitForOkta]);
        
              if (pageKind === "powerbi") {
                console.log("MS login detected");
                await enterPassword();
                await enter2faCode();
                await kmsi();
              } else if (pageKind === "okta") {
                console.log("OKTA detected");
                // type username
                // clear the email field. When cookies are used, the email
                // is already typed
                await page.evaluate(
                  () => (document.querySelector("input[name=identifier]").value = "")
                );
                await page.click(oktaUserNameSelector);
                await page.type(oktaUserNameSelector, '${email}');
                console.log("Entered email");

                // click next
                const nextSelector = "[value=Next]";
                await page.click(nextSelector);
                console.log("clicked next");
                await new Promise((resolve) => setTimeout(resolve, 1000));
        
                // type password
                const passwordSelector = "[name='credentials.passcode']";
                await page.waitForSelector(passwordSelector, {
                  timeout: 10000,
                });
                await page.click(passwordSelector);
                await page.type(passwordSelector, "${password}");
                console.log("Entered password");
                await new Promise((resolve) => setTimeout(resolve, 1000));
        
                // click Verify
                const verifySelector = "[value=Verify]";
                await page.waitForSelector(verifySelector, {
                  timeout: 10000,
                });
                await page.click(verifySelector);
                console.log("clicked verify");
                await new Promise((resolve) => setTimeout(resolve, 5000));

                // click select Google Authenticator or type 2fa
                const googleOtpSelector = "[data-se=google_otp]";
                const oktaCodeSelector = "[name='credentials.passcode']";
        
                const waitForSelectGoogle = createTaggedPromise(
                  "selectGoogle",
                  page.waitForSelector(googleOtpSelector, { timeout: 15000 })
                );
                const waitForTotp = createTaggedPromise(
                  "totp",
                  page.waitForSelector(oktaCodeSelector, { timeout: 15000 })
                );
                const pageKind = await any([waitForSelectGoogle, waitForTotp]);
        
                switch (pageKind) {
                  case "selectGoogle":
                    await page.click(googleOtpSelector);
                    console.log("clicked google otp");
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                  // break is omitted on purpose
                  case "totp":
                    // enter 2fa
                    const secretKey = "${secretKey}";
                    const totpCode = await getTotpCode(secretKey);
                    await page.click(oktaCodeSelector);
                    await page.type(oktaCodeSelector, totpCode);
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                    break;
                }
        
                // submit
                await page.waitForSelector(verifySelector, { timeout: 2000 });
                await page.click(verifySelector);
                await new Promise((resolve) => setTimeout(resolve, 10000));
                console.log("clicked verify");
        
                await kmsi();
                await new Promise((resolve) => setTimeout(resolve, 1500));
              }
            }

            async function enter2faCode() {
              // optional 2FA
              try {
                const secretKey = "${secretKey}";
                const codeSelector = \`input[name="otc"]\`;
                if (!secretKey) throw new Error("empty secret");
                await page.waitForSelector(codeSelector, { timeout: 2000 });
                console.log("2FA requested");
                const totpCode = await getTotpCode(secretKey);
                await page.click(codeSelector);
                await page.type(codeSelector, totpCode);
                await new Promise((resolve) => setTimeout(resolve, 1500));

                const verifySelector = "#idSubmit_SAOTCC_Continue";
                await page.waitForSelector(verifySelector, { timeout: 2000 });
                console.log("Verify btn")
                await page.click(verifySelector);
              } catch (e) {
                console.log(\`Skipping 2FA: \${e}\`);
              }
            }

            async function enterPassword() {
              // type password
              await page.waitForSelector(passwordSelector, { timeout: 10000 });
              await page.click(passwordSelector);
              await page.type(passwordSelector, "${password}");
              console.log("Entered password");
        
              // wait for the form to change & click next
              await page.waitForSelector(nextSelector, { timeout: 10000 });
              await page.click(nextSelector);
              await new Promise((resolve) => setTimeout(resolve, 1500));
              console.log("Clicked next");
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            async function kmsi() {
              // wait until "Keep me signed in" popup is displayed
              try {
                await page.waitForSelector("#KmsiDescription", { timeout: 10000 });
                const yesSelector =
                  "#idSIButton9 , div > .col-xs-24 .win-button.ext-primary";
                await page.waitForSelector(yesSelector, { timeout: 10000 });
                await page.click(yesSelector);
                console.log("Clicked remember me");
                await new Promise((resolve) => setTimeout(resolve, 1000));
              } catch (e) {
                console.log("Skipping KMSI");
              }
            }

            // open dashboard
            console.log("Go to the last page: ${lastPageUrl}");
            const networkIdlePromise = waitForNetworkIdle({ page, maxInflightRequests: 0 });
            if (isOAE) {
              await page.goto('${oaeLastPageUrl}');
              await new Promise((resolve) => setTimeout(resolve, 10000));
              await page.goto('${oaeLastPageUrl}');
            } else {
              await page.goto('${lastPageUrl}');
            }
            await networkIdlePromise;
            try {
              await any(
               [
                 page.waitForSelector('#content-container'),
                 page.waitForSelector('#DashboardScrollView')
               ]
              );
              console.log("Dashboard detected")
            } catch (e) {
              console.log(e)
            }
          `,
          frameId: this._frameId,
          frameUrl: '',
          isSecret: false,
        } as CustomCode,
        ...removeElementEvents,
      ]
      if (pauseEvent) {
        if (
          pauseEvent.action === headlessActions.PAUSE &&
          pauseEvent.value < 20000
        ) {
          pauseEvent.value = 20000
        }
        newEvents.push(pauseEvent)
      }
      if (scrollEvent) newEvents.push(scrollEvent)
      newEvents.push(screenshotEvent)
      this._initialUrl = initialUrl
      return newEvents
    } else if (isLookerUrl(lastPageUrl)) {
      const newEvents = [
        viewportEvent,
        {
          action: 'custom',
          code: `
            await page.goto("${lastPageUrl}");

            const emailSelector = "#login-email";
            const passwordSelector = "#login-password";
            const submitSelector = "#login-submit";
            const legacyDashboardSelector = "#lk-container";
            const dashboardSelector = "#lk-react-container";

            await page.waitForSelector(submitSelector);

            let isSSO = false
            try {
              await page.waitForSelector(emailSelector,{ timeout: 1000 });
            } catch (e) {
              console.log("Using SSO");
              isSSO = true
            }

            if (isSSO) {
              await page.click(submitSelector);

              const createTaggedPromise = async (tag, promise) => {
                await promise;
                return tag;
              }

              const googleAuthSelector = '#identifierId,.d2CFce:nth-child(1) > .rFrNMe .whsOnd,[type="email"]';
              const waitForGoogleAuth = createTaggedPromise(
                "googleAuth",
                page.waitForSelector(googleAuthSelector, { timeout: 10000 })
              );

              const oktaAuthSelector = ".o-form-input-name-identifier > input";
              const waitForOktaAuth = createTaggedPromise(
                "oktaAuth",
                page.waitForSelector(oktaAuthSelector, { timeout: 10000 })
              );

              const pageKind = await any([
                waitForGoogleAuth,
                waitForOktaAuth,
              ]);

              console.log({ pageKind });
              if (pageKind === "googleAuth") {
                await googleAuth();
              } else if (pageKind === "oktaAuth") {
                await oktaAuth();
              } else {
                throw new Error("Didn't detect Google nor Okta");
              }

              async function oktaAuth() {
                await page.type(oktaAuthSelector, "${email}");

                // click next
                const nextButtonSelector = ".o-form-button-bar > input";
                await page.click(nextButtonSelector);
                await new Promise((resolve) => setTimeout(resolve, 2500));

                // select google authenticator 
                const googleButtonSelector = "[data-se='google_otp'] > a";
                await page.waitForSelector(googleButtonSelector);
                await page.click(googleButtonSelector);
                await new Promise((resolve) => setTimeout(resolve, 2500));

                // enter 2fa code
                const faInputSelector = ".okta-form-input-field > input";
                await page.waitForSelector(faInputSelector);
                const totpCode = await getTotpCode("${secretKey}");
                await page.type(faInputSelector, totpCode);

                // click Verify button
                const verifyButtonSelector = ".o-form-button-bar > input";
                await page.click(verifyButtonSelector);
                await new Promise(resolve => setTimeout(resolve, 2500));

                // enter password
                const passwordInputSelector = ".password-with-toggle";
                await page.waitForSelector(passwordInputSelector);
                await page.type(passwordInputSelector, "${password}");
                await page.click(verifyButtonSelector);
              }

              async function googleAuth() {
                // type email
                await page.waitForSelector(googleAuthSelector);
                await page.type(googleAuthSelector, "${email}");

                // click next
                await page.waitForSelector('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > div > [type="button"] > span');
                //await page.hover('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > div > [type="button"] > span');
                await page.click('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > div > [type="button"] > span');
                await new Promise((resolve) => setTimeout(resolve, 2500));

                // type password
                await page.waitForSelector('.hDp5Db > .rFrNMe > .aCsJod > .aXBtI .whsOnd,[type="password"]');
                await page.type('.hDp5Db > .rFrNMe > .aCsJod > .aXBtI .whsOnd,[type="password"]', "${password}");

                // click next
                await page.waitForSelector('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > [type="button"] > span');
                //await page.hover('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > [type="button"] > span');
                await page.click('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > [type="button"] > span');
                await new Promise((resolve) => setTimeout(resolve, 2500));

                // click login via 2fa
                try {
                  // in this case the option list doesn't show up
                  await page.waitForSelector(".OVnw0d > .JDAKTe:nth-child(3) > .lCoei > .vxx8jf,li:nth-child(3) div:nth-child(2)", { timeout: 1000 });
                  await page.hover(".OVnw0d > .JDAKTe:nth-child(3) > .lCoei > .vxx8jf,li:nth-child(3) div:nth-child(2)");
                  await page.click(".OVnw0d > .JDAKTe:nth-child(3) > .lCoei > .vxx8jf,li:nth-child(3) div:nth-child(2)");
                  await new Promise((resolve) => setTimeout(resolve, 2500));
                } catch (e) {
                  console.log(e)
                }

                // type 2fa code
                const totpCode = await getTotpCode("${secretKey}");
                await page.type('#totpPin,.aCsJod > .aXBtI .whsOnd,[type="tel"]', totpCode);
                await page.waitForSelector('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > [type="button"] > span');
                await page.hover('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > [type="button"] > span');
                await page.click('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > [type="button"] > span');

                // click next
                await page.waitForSelector('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > [type="button"] > span');
                const networkIdlePromise = waitForNetworkIdle({ page, maxInflightRequests: 0 });
                await page.click('.DL0QTb > .VfPpkd-dgl2Hf-ppHlrf-sM5MNb > .VfPpkd-LgbsSe > .VfPpkd-vQzf8d,div:nth-child(1) > div > div > [type="button"] > span');
                await networkIdlePromise;
                await new Promise(resolve => setTimeout(resolve, 2500));
              }
            } else {
              await page.type(emailSelector, "${email}");
              await page.type(passwordSelector, "${password}");
              const networkIdlePromise = waitForNetworkIdle({ page, maxInflightRequests: 0 });
              await page.click(submitSelector);
              await networkIdlePromise;
            }

            // waiting for the element that indicates a dashboard
            await any([
              page.waitForSelector(dashboardSelector),
              page.waitForSelector(legacyDashboardSelector),
            ]);

            // waiting for all loaders/spinners to go away
            const spinnersWaitTimeout = 5000;
            const spinnersWaitStart = Date.now();
            while (true) {
              const spinners = await page.$$('#lk-inner-container .spinner, [aria-label="Element Loading"]');
              if (!spinners.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                break;
              } else if (Date.now() - spinnersWaitStart > spinnersWaitTimeout) {
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            await new Promise((resolve) => setTimeout(resolve, 10000));
          `,
          frameId: this._frameId,
          frameUrl: '',
          isSecret: false,
        } as CustomCode,
        ...removeElementEvents,
        screenshotEvent,
      ]
      this._initialUrl = initialUrl
      return newEvents
    } else if (isTableauUrl(lastPageUrl)) {
      const newEvents = [
        viewportEvent,
        {
          action: 'custom',
          code: `
            await page.goto("${lastPageUrl}");

            // type email
            const emailSelector = '#email,.tb-padded .hover > .tb-text-box-input,[name="email"]';
            await page.waitForSelector(emailSelector);
            await page.type(emailSelector, "${email}", { delay: 100 });

            // click login
            const loginSubmitSelector = '#login-submit';
            await page.waitForSelector(loginSubmitSelector, { timeout: 10000 });
            await page.click(loginSubmitSelector);

            // type password
            const passwordSelector = "#password";
            await page.waitForSelector(passwordSelector, { timeout: 10000 });
            await page.type(passwordSelector, "${password}", { delay: 100 });

            // click login
            await page.click(loginSubmitSelector);

            // type 2fa code
            const twoFaSelector = "pierce/#input-9";
            await page.waitForSelector(twoFaSelector);
            const totpCode = await getTotpCode("${secretKey}");
            await page.type(twoFaSelector, totpCode);

            // submit 2fa code
            const submit2faSelector = 'pierce/[type="submit"]';
            await page.click(submit2faSelector);

            await new Promise((resolve) => setTimeout(resolve, 15000));
          `,
          frameId: this._frameId,
          frameUrl: '',
          isSecret: false,
        } as CustomCode,
        ...removeElementEvents,
      ]
      if (pauseEvent) newEvents.push(pauseEvent)
      if (scrollEvent) newEvents.push(scrollEvent)
      newEvents.push(screenshotEvent)
      this._initialUrl = initialUrl
      return newEvents
    } else if (isSalesForceUrl(lastPageUrl)) {
      const newEvents = [
        viewportEvent,
        {
          action: 'custom',
          code: `
            const createTaggedPromise = async (tag, promise) => {
              await promise;
              return tag;
            }

            await page.goto("${lastPageUrl}");

            // determine if we have OKTA
            const oktaUserEmailSelector = "#okta-signin-username";
            const emailSelector = '#username,form > .inputgroup .input,[type="email"]';
        
            const waitForEmail = createTaggedPromise(
              "email",
              page.waitForSelector(emailSelector, { timeout: 15000 })
            );
            const waitForOkta = createTaggedPromise(
              "okta",
              page.waitForSelector(oktaUserEmailSelector, { timeout: 15000 })
            );
            const pageKind = await any([waitForEmail, waitForOkta]);
            
            if (pageKind === "okta") {
              // type email
              await page.type(oktaUserEmailSelector, "${email}", { delay: 100 });

              // type password
              const oktaPasswordSelector = "#okta-signin-password";
              await page.type(oktaPasswordSelector, "${password}", { delay: 100 });

              // click login
              const oktaLoginSubmitSelector = "#okta-signin-submit";
              await page.click(oktaLoginSubmitSelector);

              // type 2fa code
              const oktaTwoFaSelector = ".o-form-input-name-answer input";
              await page.waitForSelector(oktaTwoFaSelector);
              const totpCode = await getTotpCode("${secretKey}");
              await page.type(oktaTwoFaSelector, totpCode);

              // click Verify
              const verifySelector = "[value=Verify]";
              await page.waitForSelector(verifySelector, {
                timeout: 10000,
              });
              await page.click(verifySelector);
              console.log("clicked verify");
              await new Promise((resolve) => setTimeout(resolve, 5000));
            } else if (pageKind === "email") {
              // type email
              await page.type(emailSelector, "${email}", { delay: 100 });

              // type password
              const passwordSelector = '#password,div > div .password,[type="password"]';
              await page.waitForSelector(passwordSelector, { timeout: 10000 });
              await page.type(passwordSelector, "${password}", { delay: 100 });

              // click login
              const loginSubmitSelector = '#Login,div form > .button,[type="submit"]';
              await page.click(loginSubmitSelector);

              try {
                // type 2fa code
                const twoFaSelector = '#tc,div .formArea > .input,[name="tc"]';
                await page.waitForSelector(twoFaSelector);
                const totpCode = await getTotpCode("${secretKey}");
                await page.type(twoFaSelector, totpCode);

                // submit 2fa code
                const submit2faSelector = '#save,div > div .button,[name="save"]';
                await page.click(submit2faSelector);
              } catch (e) {
                console.log("No 2fa code needed");
              }
            }

            let frame_93 = page;
            try {
              console.log("looking for the iframe with the refresh button");
              const iframeSelector =
                ".windowViewMode-normal > .standalone > .dashboardContainer > iframe";
              await frame_93.waitForSelector(iframeSelector, { timeout: 30000 });
              frame_93 = await(await frame_93.$(iframeSelector)).contentFrame();
              const frames = page.frames();
              frame_93 =
                frames.length === 2
                  ? frames[1]
                  : frames.find(
                      (f) =>
                        f.url() ===
                        "https://kii--dsandbox.sandbox.lightning.force.com/desktopDashboards/dashboardApp.app?dashboardId=01Z5e000000BTIGEA4&displayMode=view&networkId=000000000000000&userId=0057e00000U6dY7AAJ"
                    ) || frames[0];
              console.log(frame_93);
              const refreshButtonSelector = "button.slds-button.slds-button_neutral.refresh";
              console.log("looking for the Refresh button");
              await frame_93.waitForSelector(refreshButtonSelector, { timeout: 20000 });
            
              await frame_93.click(refreshButtonSelector);
              console.log("clicked the Refresh button");
            } catch (e) {
              console.log(e);
              console.log("failed clicking the Refresh button");
            }
          `,
          frameId: this._frameId,
          frameUrl: '',
          isSecret: false,
        } as CustomCode,
        ...removeElementEvents,
      ]
      if (pauseEvent) {
        if (
          pauseEvent.action === headlessActions.PAUSE &&
          pauseEvent.value < 20000
        ) {
          pauseEvent.value = 20000
        }
        newEvents.push(pauseEvent)
      }
      if (scrollEvent) newEvents.push(scrollEvent)
      newEvents.push(screenshotEvent)
      this._initialUrl = initialUrl
      return newEvents
    }
    return events
  }

  canUseCustomCode(events: Event[], tenantId: string) {
    const lastPageUrl = getLastPageUrl(events)
    console.log(`LAST PAGE ${lastPageUrl}`)
    if (isPowerBiUrl(lastPageUrl)) {
      return true
    }
    if (isDynamicsUrl(lastPageUrl)) return true
    if (isLookerUrl(lastPageUrl)) return true
    if (isTableauUrl(lastPageUrl)) {
      const hasTotpEvent =
        events.find((event) => isTotpEvent(event)) !== undefined
      return hasTotpEvent
    }
    if (isSalesForceUrl(lastPageUrl)) {
      const hasGoogleSteps = getGoogleAuthSteps(events) !== null
      // if we have google steps, we can't use custom code
      return !hasGoogleSteps
    }
    return false
  }

  getInitialUrl(events: Event[]) {
    const gotoEvent = events.find((event) => isGotoEvent(event)) as GotoEvent
    return gotoEvent?.href ?? ''
  }

  private _handleTotp(selector: string, value: string): Block {
    const block = new Block(this._frameId)
    block.addLine({
      type: headlessActions.CUSTOM,
      value: `
        await ${this._frame}.waitForSelector(\`${selector}\`, { timeout: 10000 });
        await ${this._frame}.click(\`${selector}\`);
      `,
    })
    block.addLine({
      type: eventsToRecord.TOTP,
      value: `const totpCode = await getTotpCode("${value}");`,
    })
    block.addLine({
      type: eventsToRecord.CHANGE,
      value: `await ${this._frame}.type(\`${selector}\`, totpCode);`,
    })
    return block
  }

  _setFrames(
    frameId: null | number,
    frameUrl: null | string,
    frameIndex: null | number,
    frameSelectors: null | Array<string>
  ) {
    if (frameId && frameId !== 0) {
      this._frameId = frameId
      this._frame = `frame_${frameId}`
      this._allFrames[frameId] = frameUrl ?? ''
      this._allFrameIndices[frameId] = frameIndex ?? 0
      this._allFrameSelectors[frameId] = frameSelectors
    } else {
      this._frameId = 0
      this._frame = 'page'
    }
  }

  _postProcess() {
    // when events are recorded from different frames, we want to add a frame setter near the code that uses that frame
    if (Object.keys(this._allFrames).length > 0) {
      this._postProcessSetFrames()
    }

    if (this._options.blankLinesBetweenBlocks && this._blocks.length > 0) {
      this._postProcessAddBlankLines()
    }
  }

  _handleKeyDown(selector: string, value: string) {
    const block = new Block(this._frameId)
    block.addLine({
      type: eventsToRecord.KEYDOWN,
      value: `await ${this._frame}.type('${selector}', '${this._escapeUserInput(
        value
      )}', {
        delay: 100
      })`,
    })
    return block
  }

  _handleClick(selector: string) {
    const waitForSelectorCode = selector
      .split(`,`)
      .reduceRight((result, selector, i) => {
        return `
        try {
          await ${this._frame}.waitForSelector('${selector}', { timeout: ${
          i ? 1000 : 10000
        } })
        } catch (e) {
          ${result}
        }
      `
      }, `throw new Error('${selector} not found');`)
    const clickCode = selector.split(',').reduceRight((result, selector) => {
      return `
        try {
          await ${this._frame}.click('${selector}')
        } catch (e) {
          ${result}
        }
      `
    }, `throw new Error('Click on ${selector} failed');`)
    const block = new Block(this._frameId)
    if (this._options.waitForSelectorOnClick) {
      block.addLine({
        type: eventsToRecord.CLICK,
        value: waitForSelectorCode,
      })
    }
    const maxInflightRequests = this.getMaxInflightRequests()
    block.addLine({
      type: eventsToRecord.CLICK,
      value: `
          {
            try { 
              await ${this._frame}.hover('${selector}');
              const networkIdlePromise = waitForNetworkIdle({ page, maxInflightRequests: ${maxInflightRequests} });
              ${clickCode}
              await networkIdlePromise;
              await new Promise(resolve => setTimeout(resolve, 2500));
            } catch (e) {
              const networkIdlePromise = waitForNetworkIdle({ page, maxInflightRequests: ${maxInflightRequests} });
              await ${this._frame}.evaluate(() => document.querySelector('${selector}').click());
              await networkIdlePromise;
              await new Promise(resolve => setTimeout(resolve, 2500));
            }
          }
      `,
    })
    return block
  }

  _handleRemoveElement(selector: string) {
    const block = new Block(this._frameId)
    if (this._options.waitForSelectorOnClick) {
      block.addLine({
        type: eventsToRecord.REMOVE_ELEMENT,
        value: `
          try {
            await ${this._frame}.waitForSelector('${selector}', { timeout: 5000 });
          } catch (e) {
            console.log("Skipping remove element", e);
          }
        `,
      })
    }
    block.addLine({
      type: eventsToRecord.REMOVE_ELEMENT,
      value: `
        await ${this._frame}.evaluate(() => {
          document.querySelectorAll('${selector}').forEach(elem => elem.style.display = 'none')
        })
      `,
    })
    return block
  }

  _handleChange(selector: string, value: string) {
    return new Block(this._frameId, {
      type: eventsToRecord.CHANGE,
      value: `await ${this._frame}.select('${selector}', '${value}')`,
    })
  }

  _handleInputChange(selector: string, value: string) {
    return new Block(this._frameId, {
      type: eventsToRecord.CHANGE,
      value: `
        await ${this._frame}.waitForSelector('${selector}');
        await ${this._frame}.type('${selector}', '${this._escapeUserInput(
        value
      )}', {
        delay: 100
      });`,
    })
  }

  _handleGoto(href: string) {
    if (this._initialUrl.length === 0) {
      this._initialUrl = href
    }

    const block = new Block(this._frameId)
    const parsedUrl = new URL(href)
    if (parsedUrl.username) {
      // remove the creds from the URL and use them in page.authenticate method
      const { username, password } = parsedUrl
      parsedUrl.username = ''
      parsedUrl.password = ''
      block.addLine({
        type: headlessActions.GOTO,
        value: `
          await ${this._frame}.authenticate({
            username: "${username}",
            password: "${password}",
          });
          await ${this._frame}.goto('${parsedUrl}', { timeout: 60000 });
        `,
      })
    } else {
      block.addLine({
        type: headlessActions.GOTO,
        value: `await ${this._frame}.goto('${href}')`,
      })
    }
    return block
  }

  _handleSubmit(selector: string) {
    return new Block(this._frameId, {
      type: eventsToRecord.SUBMIT,
      value: `
        try {
          await ${this._frame}.$eval('${selector}', form => form.requestSubmit());
        } catch (e) {
          console.error('Error submitting form:', e);
        }
      `,
    })
  }

  abstract _handleViewport(width: number, height: number): Block

  getMaxInflightRequests() {
    if (this._initialUrl.includes('trello')) {
      return 2
    }
    return 0
  }

  getCaptureBeyondViewport() {
    const enabledDomains = [
      'looker.com',
      'metabaseapp.com',
      'splunk',
      'geckoboard.com',
    ]
    const shouldBeDisabled = enabledDomains.some((domain) =>
      this._lastUrl.includes(domain)
    )
    return !shouldBeDisabled
  }

  getCleanUpScript(lastUrl: string): string {
    if (lastUrl.includes('console.aws.amazon.com')) {
      return `
        await ${this._frame}.evaluate(() => {
          // remove hint popups
          document.querySelectorAll(".popover-wrapper").forEach(el => el.remove());

          // remove cookies popup
          document.querySelectorAll("#awsccc-cb-c").forEach(el => el.remove());

          // remove tutorial
          document.querySelectorAll('[role=dialog]').forEach(el => el.remove());
        })
      `
    } else if (lastUrl.includes('online.tableau.com/')) {
      return `
        await ${this._frame}.evaluate(() => {
          // remove hint popups
          document.querySelectorAll("[data-tb-test-id=postlogin-test-id-Dialog-Glass-Root]").forEach(el => el.remove());
          document.querySelectorAll("[data-tb-test-id=postlogin-test-id-Dialog-Floater-Root]").forEach(el => el.remove());
          document.querySelectorAll("[data-tb-test-id=viz-header-search-closeviz-header-container]").forEach(el => el.remove());
          document.querySelectorAll("#toolbar-container").forEach(el => el.remove());
        });
    `
    }
    return ''
  }

  _handleScreenshot(value?: string) {
    this._screenshotCounter += 1

    const maxInflightRequests = this.getMaxInflightRequests()

    const captureBeyondViewport = this.getCaptureBeyondViewport()
    const pause = isSplunkUrl(this._lastUrl)
      ? 5000
      : isLookerUrl(this._lastUrl)
      ? 1000
      : 2000

    const cleanUpScript = this.getCleanUpScript(this._lastUrl)

    if (value) {
      return new Block(this._frameId, {
        type: headlessActions.SCREENSHOT,
        value: `
          await waitForNetworkIdle({ page, maxInflightRequests: ${maxInflightRequests}, waitForFirstRequest: 500 });
          await ${this._frame}.waitForSelector('${value}');
          console.log("Pause before screenshot ${pause}ms");
          await new Promise(resolve => setTimeout(resolve, ${pause}));
          ${cleanUpScript}
          const element${this._screenshotCounter} = await ${this._frame}.$('${value}');
          let screenshot = await element${this._screenshotCounter}.screenshot({ captureBeyondViewport: ${captureBeyondViewport}, type: "jpeg", quality: 90 });
          if (${this._scroll}) {
            const img = sharp(screenshot);
            const meta = await img.metadata();
            screenshot = await img.extract({ left: 0, top: ${this._scroll}, width: meta.width, height: ${this._scroll} + 1080 > meta.height ? meta.height - ${this._scroll} : 1080  }).toBuffer();
            console.log("sharp", { left: 0, top: ${this._scroll}, width: meta.width, height: ${this._scroll} + 1080 > meta.height ? meta.height - ${this._scroll} : 1080  });
          }
        `,
      })
    }

    let loaderWaitBlock = ``
    if (isSplunkUrl(this._lastUrl)) {
      loaderWaitBlock = `
        try {
          await ${this._frame}.waitForSelector("#placeholder-main-section-body", { timeout: 3000 });
          await ${this._frame}.waitForSelector("#placeholder-main-section-body", { hidden: true });
        } catch (e) {
          console.log(\`Skipping waiting loader: \${e}\`);
        }
      `
    }

    return new Block(this._frameId, {
      type: headlessActions.SCREENSHOT,
      value: `
        try {
          await navigationPromise
          console.log("Navigation promise resolved");
          await waitForNetworkIdle({ page: ${this._frame}, maxInflightRequests: ${maxInflightRequests}, waitForFirstRequest: 500 });
          console.log("Network idle promise resolved");
          ${loaderWaitBlock}
          await new Promise(resolve => setTimeout(resolve, ${pause}));
          console.log("Pause is resolved");
        } catch (e) {
          console.log('Error on waiting before screenshot:', e);
        }
        ${cleanUpScript}
        console.log("About to take a screenshot");
        const screenshot = await ${this._frame}.screenshot({ captureBeyondViewport: ${captureBeyondViewport}, type: "jpeg", quality: 90 });
        console.log("Page screenshot is taken");
      `,
    })
  }

  _handleWaitForNavigation() {
    const block = new Block(this._frameId)
    if (this._options.waitForNavigation) {
      block.addLine({
        type: headlessActions.NAVIGATION,
        value: `
          try {
            await navigationPromise;
            navigationPromise = page.waitForNavigation({ timeout: 5000, waitUntil: "networkidle0" }).catch(() => {
              console.log("Skipping navigation");
            });
          } catch (e) {
            console.log(\`Skipping navigation: \${e}\`);
          }
        `,
      })
    }
    return block
  }

  _postProcessSetFrames() {
    for (let [i, block] of this._blocks.entries()) {
      const lines = block.getLines()
      for (let line of lines) {
        const { frameId } = line
        if (
          frameId &&
          Object.keys(this._allFrames).includes(frameId.toString())
        ) {
          const frameUrl = this._allFrames[frameId]
          const frameIndex = this._allFrameIndices[frameId]
          const frameSelectors = this._allFrameSelectors[frameId]
          const declaration = `
            let frame_${frameId} = page;
            try {
              ${
                frameSelectors
                  ? `
                    ${frameSelectors
                      .map((frameSelector) =>
                        frameSelector.split(',').reduceRight(
                          (result, selector, i) => `
                            try {
                              await frame_${frameId}.waitForSelector(\`${selector}\`, { timeout: ${
                            i ? 1000 : 10000
                          } });
                              frame_${frameId} = await (await frame_${frameId}.$(\`${selector}\`)).contentFrame();
                            } catch (e) {
                              ${result}
                            }
                          `,
                          `throw new Error(\`Can't find frame by selector: ${frameSelector}\`);`
                        )
                      )
                      .join('\n')}
                    `
                  : `throw new Error("Selectors are not provided for frame");`
              }
            } catch (e) {
              console.log("Failed to get iframe by selectors", e)
              const frames = page.frames();
              frame_${frameId} = frames.length === 2 ? frames[1] : (frames.find(f => f.url() === '${frameUrl}') || frames[${frameIndex}]);
              if (frame_${frameId} === page) {
                throw new Error(\`Failed to find iframe with url "${frameUrl}", index "${frameIndex}" and selector "${frameSelectors?.join(
            '; '
          )}"\`);
              }
            }
          `
          this._blocks[i].addLineToTop({
            type: headlessActions.FRAME_SET,
            value: declaration,
          })
          delete this._allFrames[frameId]
          break
        }
      }
    }
  }

  _postProcessAddBlankLines() {
    let i = 0
    while (i <= this._blocks.length) {
      const blankLine = new Block(0)
      blankLine.addLine({ type: null, value: '' })
      this._blocks.splice(i, 0, blankLine)
      i += 2
    }
  }

  _escapeUserInput(value: string) {
    return value?.replace(/\\/g, '\\\\')?.replace(/'/g, "\\'")
  }

  _handlePause(value?: number) {
    if (!value) {
      return
    }

    return new Block(this._frameId, {
      type: headlessActions.PAUSE,
      value: `
        console.log("Pausing ${value}ms");
        await new Promise((resolve) => setTimeout(resolve, ${value}));
      `,
    })
  }

  _handleScroll(value?: number) {
    if (!value) {
      return
    }
    this._scroll = value
    return new Block(this._frameId, {
      type: headlessActions.SCROLL,
      value: `await ${this._frame}.evaluate(() => {
        window.scrollTo(0, ${value});
      });`,
    })
  }
}

function shouldSimplifySelectors(events: Event[]): boolean {
  const lastPageUrl = getLastPageUrl(events)
  const simplifiedDomains = ['studio.amillionads.com', 'aws.amazon.com']
  if (simplifiedDomains.some((domain) => lastPageUrl.includes(domain))) {
    return true
  }
  return false
}

// for some unknown reason Puppeteer using the same input twice for username
// and password when using grouped selector like "#id,.class" so this function
// strips down it to single id selector like "#id"
function simplifySelectors(events: Event[]): Event[] {
  return events.map((event) => {
    const selector = 'selector' in event ? event.selector : ''
    if (selector) {
      const selectors = selector.split(',')
      const idSelector = selectors.find((selector) => selector.startsWith('#'))
      if (idSelector) {
        return {
          ...event,
          selector: idSelector,
        }
      }
      return {
        ...event,
        selector: selectors[0],
      }
    }
    return event
  })
}

function shouldFixForKibana(events: Event[]): boolean {
  const lastPageUrl = getLastPageUrl(events)
  const kibanaPath = ['_plugin/kibana/']
  if (kibanaPath.some((path) => lastPageUrl.includes(path))) {
    return true
  }
  return false
}

// kibana login form uses same #ids multiple times so it confuses our code
// this code strips out #ids
function fixKibana(events: Event[]): Event[] {
  return events.map((event) => {
    const selector = 'selector' in event ? event.selector : ''
    if (selector) {
      const selectors = selector.split(',')
      const selectorsWithoutIds = selectors
        .filter((selector) => !selector.startsWith('#'))
        .join(',')
      if (selectorsWithoutIds.length > 0) {
        console.log(`before: ${selector}, after: ${selectorsWithoutIds}`)
        return {
          ...event,
          selector: selectorsWithoutIds,
        }
      }
      return {
        ...event,
        selector: selectors[0],
      }
    }
    return event
  })
}

function isGotoEvent(event: Event): event is GotoEvent {
  if (event.action === headlessActions.GOTO) return true
  return false
}

function isClickEventWithHref(event: Event): event is ClickEventWithHref {
  if (event.action === eventsToRecord.CLICK && (event as any).href) return true
  return false
}

function isTotpEvent(event: Event): event is TotpEvent {
  return event.action === 'totp'
}

export function getPlatform(events: Event[]): string {
  const lastPageUrl = getLastPageUrl(events)
  try {
    return new URL(lastPageUrl).host
  } catch (e) {
    return ''
  }
}

export function getLastPageUrl(events: Event[]) {
  const screenshotEvent = events.find(
    (event): event is ScreenshotEvent =>
      event.action === headlessActions.SCREENSHOT
  )
  if (screenshotEvent && screenshotEvent.href) return screenshotEvent.href

  const lastClickEvent = findLast(events, (event) =>
    isClickEventWithHref(event)
  ) as ClickEventWithHref
  return lastClickEvent?.href ?? ''
}

function isLookerUrl(url: string): boolean {
  return /^https:\/\/.+\.looker.com/.test(url)
}

function isDynamicsUrl(url: string): boolean {
  return url.includes('.dynamics.com/main.aspx')
}

export function isPowerBiUrl(url: string): boolean {
  return url.startsWith('https://app.powerbi.com')
}

export function isSplunkUrl(url: string): boolean {
  return url.includes('splunk')
}

function isTableauUrl(url: string) {
  return url.includes('online.tableau.com')
}

function isSalesForceUrl(url: string) {
  return url.includes('lightning.force.com')
}

export function getAccount(events: Event[]): string {
  const emailEvent = events.find(
    (event) =>
      event.action === 'change' &&
      event.value.includes('@') &&
      event.value.includes('.')
  ) as ChangeEvent
  return emailEvent?.value ?? ''
}

function optimizeGoogleAuthentication(events: Event[]): Event[] {
  const googleAuthSteps = getGoogleAuthSteps(events)
  if (googleAuthSteps) {
    const customStep: CustomCode = {
      action: 'custom',
      code: `
        // type email
        const emailSelector = "#identifierId, [type=email]";
        await page.waitForSelector(emailSelector);
        await page.type(emailSelector, "${googleAuthSteps.values.email}");

        // click next
        const nextEmailSelector = "#identifierNext, [role=presentation] > div > div > div > div > div > button > span";
        await page.waitForSelector(nextEmailSelector);
        await page.click(nextEmailSelector);
        await new Promise((resolve) => setTimeout(resolve, 5000)); // network requests, animations

        // type password
        const passwordSelector = "[type=password]";
        await page.waitForSelector(passwordSelector);
        await page.type(passwordSelector, "${googleAuthSteps.values.password}");

        // click next
        const nextPasswordSelector = "#passwordNext";
        await page.waitForSelector(nextPasswordSelector);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await page.click(nextPasswordSelector);
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // click login via Google Authenticator
        await page.evaluate(async () => {
          for (let i = 0; i < 5; ++i) {
            const allElements = Array.from(document.querySelectorAll("*"));
            const authenticatorButton = allElements
              .filter(
                (el) => el.innerText && el.innerText.includes("Google Authenticator")
              )
              .sort((a, b) => a.innerText.length - b.innerText.length)[0];
            const select2fa = allElements
              .filter((el) => el.innerText && el.innerText.includes("Try another way"))
              .filter((el) => el.type === "button")
              .pop();
            if (select2fa) {
              select2fa.click();
              console.log("clicked try another way");
              await new Promise((resolve) => setTimeout(resolve, 10000));
            } else if (authenticatorButton) {
              authenticatorButton.click();
              console.log("clicked Google Authenticator");
              break;
            } else {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        });
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // type 2fa code
        const totpSelector = "#totpPin, [type=tel]";
        await page.waitForSelector(totpSelector);
        const totpCode = await getTotpCode("${googleAuthSteps.values.totp}");
        await page.type(totpSelector, totpCode);

        // click next
        const nextTotpSelector = "#submit, div:nth-child(1) > div > div > [type=button] > span";
        await page.waitForSelector(nextTotpSelector);
        await page.click(nextTotpSelector);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      `,
      frameId: 0,
      frameIndex: 0,
      frameUrl: 'https://accounts.google.com/v3/signin/identifier',
      frameSelectors: [],
      isSecret: false,
    }
    const newEvents = [...events]
    newEvents.splice(
      googleAuthSteps.start,
      googleAuthSteps.end - googleAuthSteps.start + 1,
      customStep
    )
    console.log('OPTIMIZED GOOGLE authentication')
    return newEvents
  } else {
    console.log('NO OPTIMIZATIONS')
    return events
  }
}

function getGoogleAuthSteps(steps: Event[]) {
  const dataSteps = [
    // email
    {
      cond: (step: Event) =>
        step.action === 'change' && step.value.includes('@'),
      extract: (step: Event) => ({
        email: step.action === 'change' ? step.value : '',
      }),
    },
    // password
    {
      cond: (step: Event) => step.action === 'change' && step.isSecret,
      extract: (step: Event) => ({
        password: step.action === 'change' ? step.value : '',
      }),
    },
    // totp
    {
      cond: (step: Event) => step.action === 'totp',
      extract: (step: Event) => ({
        totp: step.action === 'totp' ? step.value : '',
      }),
    },
  ]
  let start = -1
  let values = { email: '', password: '', totp: '' }
  for (let i = 0; i < steps.length; ++i) {
    const step = steps[i]
    if (step.action === 'NAVIGATION') {
      continue
    }
    if (step.action === 'click' && step.tagName === 'INPUT') {
      continue
    }
    if (
      step.frameUrl?.startsWith(
        'https://accounts.google.com/o/oauth2/auth/identifier'
      )
    ) {
      if (start === -1) {
        console.log('start')
        start = i
      }
      const stepValues = dataSteps.reduce((acc, dataStep) => {
        if (dataStep.cond(step)) {
          return { ...acc, ...dataStep.extract(step) }
        }
        return acc
      }, {})
      values = { ...values, ...stepValues }
    } else if (start !== -1) {
      return { start, end: i, values }
    }
  }
  return null
}

export interface Options {
  wrapAsync?: boolean
  headless?: boolean
  waitForNavigation?: boolean
  waitForSelectorOnClick?: boolean
  blankLinesBetweenBlocks?: boolean
  dataAttribute?: string
  showPlaywrightFirst?: boolean
  keyCode?: number
}

export type Event =
  | SubmitEvent
  | KeydownEvent
  | GotoEvent
  | ViewportEvent
  | ClickEvent
  | ClickEventWithHref
  | ChangeEvent
  | NavigationEvent
  | ScreenshotEvent
  | TotpEvent
  | RemoveElementEvent
  | CustomCode
  | PauseEvent
  | ScrollEvent

interface CommonEvent {
  frameId: null | number
  frameIndex: null | number
  frameUrl: null | string
  frameSelectors: null | Array<string>
  tabIndex?: number
  isSecret: boolean
  tagName?: string
  coordinates?: any
  windowIndex?: number
}

type PauseEvent = CommonEvent & {
  action: 'PAUSE'
  value: number
}

type ScrollEvent = CommonEvent & {
  action: 'SCROLL'
  value: number
}

type CustomCode = CommonEvent & {
  action: 'custom'
  code: string
}

type SubmitEvent = CommonEvent & {
  action: 'submit'
  selector: string
}

type KeydownEvent = CommonEvent & {
  action: 'keydown'
  selector: string
  value: string
  tagName: string
  keyCode: number
  href: null | string
  coordinates: null
}

type GotoEvent = CommonEvent & {
  action: typeof headlessActions.GOTO
  href: string
  username?: string
  password?: string
}

type ViewportEvent = CommonEvent & {
  value: { width: number; height: number }
  action: typeof headlessActions.VIEWPORT
}

type NavigationEvent = CommonEvent & {
  action: typeof headlessActions.NAVIGATION
}

type ScreenshotEvent = CommonEvent & {
  action: typeof headlessActions.SCREENSHOT
  value: string
  href?: string | null
}

type ClickEvent = CommonEvent & {
  selector: string
  action: 'click'
}

type ClickEventWithHref = ClickEvent & {
  selector: string
  href: string
}

type ChangeEvent = CommonEvent & {
  action: 'change'
  value: string
  tagName: string
}

type TotpEvent = CommonEvent & {
  action: 'totp'
  value: string
  selector: string
}

type RemoveElementEvent = CommonEvent & {
  action: 'removeElement'
  selector: string
}
