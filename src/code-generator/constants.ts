export enum headlessActions {
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

export enum eventsToRecord {
  CLICK = 'click',
  DBLCLICK = 'dblclick',
  CHANGE = 'change',
  KEYDOWN = 'keydown',
  SELECT = 'select',
  SUBMIT = 'submit',
  LOAD = 'load',
  UNLOAD = 'unload',
  TOTP = 'totp',
  REMOVE_ELEMENT = 'removeElement',
}
