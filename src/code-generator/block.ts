import { eventsToRecord, headlessActions } from './constants'

export default class Block {
  _frameId: number
  _lines: Line[]

  constructor(frameId: number, framelessLine?: FramelessLine) {
    this._lines = []
    this._frameId = frameId

    if (framelessLine) {
      this.addLine(framelessLine)
    }
  }

  addLineToTop(line: FramelessLine) {
    this._lines.unshift({ ...line, frameId: this._frameId })
  }

  addLine(framelessLine: FramelessLine) {
    const l = { ...framelessLine, frameId: this._frameId }
    this._lines.push(l)
  }

  getLines() {
    return this._lines
  }
}

interface Line {
  frameId: number
  type: eventsToRecord | headlessActions | null
  value: string
}

type FramelessLine = Omit<Line, 'frameId'> | { type: null; value: '' }
