import { BrowserWindow } from 'electron/main'

export async function requestDashboardPreview(
  width: number,
  height: number,
  steps: RecorderEvent[],
  settings?: DashboardSettings
) {
  const win = new BrowserWindow({ webPreferences: { offscreen: true } })
  for (const step of steps) {
    if (step.action === headlessActions.GOTO) {
      win.goto
    }
  }
}

export type DashboardSettings = {
  pause?: number
  scroll?: number
}

export type RecorderEvent =
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
  action: 'click'
}

type ClickEventWithHref = ClickEvent & {
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

enum headlessActions {
  GOTO = 'GOTO',
  VIEWPORT = 'VIEWPORT',
  WAITFORSELECTOR = 'WAITFORSELECTOR',
  NAVIGATION = 'NAVIGATION',
  NAVIGATION_PROMISE = 'NAVIGATION_PROMISE',
  FRAME_SET = 'FRAME_SET',
  SCREENSHOT = 'SCREENSHOT',
  PAGE_SET = 'PAGE_SET',
  CUSTOM = 'CUSTOM',
  PAUSE = 'PAUSE',
  SCROLL = 'SCROLL',
}
