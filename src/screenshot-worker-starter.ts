import * as fastq from 'fastq'
import type { queueAsPromised } from 'fastq'
import { Event } from './code-generator/base-generator'
import { headlessActions } from './code-generator/constants'
import { DashboardReply } from './preload'
import { sqlite } from './db'
import { app } from 'electron/main'
import * as path from 'path'
import { Worker } from 'worker_threads'
import fs from 'fs/promises'

export async function handleGetPlayerDashboardScreenshot(
  _sevent: any,
  dashboardId: string,
  dashboard: DashboardReply
) {
  try {
    const db = await sqlite()
    const width = dashboard.dashboard.width ?? 1920
    const height = dashboard.dashboard.height ?? 1080
    const screenshotPath = `screenshots/${dashboardId}-${width}x${height}.png`

    const settings = {
      width,
      height,
      pause: dashboard.dashboard.settings.pause ?? 2000,
      scroll: dashboard.dashboard.settings.scroll ?? 0,
      interval: dashboard.dashboard.screenshotPeriod ?? 10000,
    } as const
    const stepsWithSettings = populateStepsWithSettings(
      dashboard.dashboard.steps,
      settings
    )

    const steps = stepsWithSettings.map((step) => {
      if (
        step.isSecret &&
        (step.action === 'totp' || step.action === 'change')
      ) {
        const secret = dashboard.secrets.secrets.find(
          (secret) => secret.key === step.value
        )
        if (!secret) {
          throw new Error(`Secret ${step.value} not found`)
        }
        return {
          ...step,
          value: secret.value,
        }
      }
      return step
    })

    const lastHandledRequestTime = await db.getLastAcceptedScreenshotRequest(
      dashboardId
    )
    const timeElapsed = new Date().getTime() - lastHandledRequestTime.getTime()
    if (timeElapsed > settings.interval) {
      const isQueued = q.getQueue().some((t) => t.dashboardId === dashboardId)
      if (!isQueued) {
        await q.push({
          db,
          dashboardId,
          width,
          height,
          steps,
          isPackaged: app.isPackaged,
          send: (...args) => console.log({ args }),
        })
        console.log(`${dashboardId} is planned, Q length: ${q.length()}`)
      } else {
        console.log(`${dashboardId} is alredy in the Q, skipping`)
      }
    } else {
      console.log(
        'not enough time elapsed ' + timeElapsed + ', ' + settings.interval
      )
    }

    const contents = await fs.readFile(screenshotPath, {
      encoding: 'base64',
    })

    return 'data:image/png;base64,' + contents
  } catch (e) {
    return ''
  }
}

const populateStepsWithSettings = (
  steps: Array<Event>,
  settings: {
    width: number
    height: number
    pause: number
    scroll: number
  }
): Array<Event> => {
  return [
    {
      frameId: null,
      frameUrl: null,
      frameIndex: null,
      frameSelectors: null,
      action: headlessActions.VIEWPORT,
      value: { width: settings.width, height: settings.height },
      isSecret: false,
    },
    ...steps.slice(0, steps.length - 1),
    {
      frameId: null,
      frameUrl: null,
      frameIndex: null,
      frameSelectors: null,
      action: headlessActions.SCROLL,
      value: settings.scroll || 0,
      isSecret: false,
    },
    {
      frameId: null,
      frameUrl: null,
      frameIndex: null,
      frameSelectors: null,
      action: headlessActions.PAUSE,
      value: settings.pause ?? 2000,
      isSecret: false,
    },
    ...steps.slice(steps.length - 1),
  ]
}

type Task = {
  dashboardId: string
  db: any
  width: number
  height: number
  steps: any[]
  isPackaged: boolean
  send: (command: string) => void
}

const q: queueAsPromised<Task> = fastq.promise(asyncWorker, 1)

q.saturated = () => {
  console.log(`Q is saturated; Q lenght: ${q.length()}`)
}

async function asyncWorker({
  db,
  dashboardId,
  width,
  height,
  steps,
  isPackaged,
  send,
}: Task): Promise<void> {
  db.saveLastAcceptedScreenshotRequest(dashboardId, new Date())
  console.log('requesting screenshot of ' + dashboardId)
  const start = Date.now()
  const myWorker = new Worker(path.join(__dirname, 'screenshot-worker.js'), {
    workerData: {
      dashboardId,
      width,
      height,
      steps,
      isPackaged,
    },
  })
  let pid = null
  myWorker.on('message', (message) => {
    if (message.isDone) {
      send('screenshotIsDone')
      db.saveDashboardLastSuccess(dashboardId, new Date())

      console.log(
        `Screenshot is made in ${(Date.now() - start) / 1000} seconds.`
      )
      try {
        process.kill(pid, 'SIGKILL')
        myWorker.terminate()
      } catch (e) {
        console.log(`all clean already`)
      }
    } else if (message.pid) {
      console.log(`Chrome pid - ${message.pid}`)
      pid = message.pid
      // kill the worker and chrome in 2 mins
      setTimeout(() => {
        try {
          myWorker.terminate()
          process.kill(message.pid, 'SIGKILL')
        } catch (e) {
          console.log(`all clean, no timeout`)
        }
      }, 120_000)
    }
  })
}
