import { parentPort, workerData } from 'worker_threads'
import PuppeteerCodeGenerator from './code-generator/puppeteer'
import { Event } from './code-generator/base-generator'
import fs from 'fs'
import log from 'electron-log'
log.info('Log from the renderer process')

console.log = log.info

const dashboardId = workerData.dashboardId ?? 'default'
const width = workerData.width ?? 1920
const height = workerData.height ?? 1080
const steps = workerData.steps ?? []
const dir = workerData.dir ?? 'screenshots'
const screenshotPath = `${dir}/${dashboardId}-${width}x${height}.png`
const isPackaged = workerData.isPackaged ?? true

;(async function run() {
  try {
    const generator = new PuppeteerCodeGenerator({
      waitForNavigation: false,
    })
    const code = generator.generate(
      steps as Event[],
      'request.tenantId',
      dashboardId
    )
    const [img, err] = await generateScreenshot(code)
    if (err) throw err
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir)
    }

    fs.writeFileSync(screenshotPath, img)
    parentPort.postMessage({ isDone: true })
  } catch (e) {
    console.log(e)
  }
})()

async function generateScreenshot(code: string): Promise<[Buffer, Error]> {
  if (isPackaged) {
    code = code.replace(
      'await chromium.executablePath',
      "'./resources/app.asar.unpacked/node_modules/chromium/lib/chromium/chrome-win/chrome.exe'"
    )
  } else {
    code = code.replace('executablePath: await chromium.executablePath,', '')
  }

  globalThis.parentPortA = parentPort // so it's accesible in the code context
  const wrapped = `(async() => { ${code} })()`
  return await eval(wrapped)
}
