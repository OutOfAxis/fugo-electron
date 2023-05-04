const fs = require('fs/promises')
const path = require('path')

interface Settings {
  get(): Promise<SettingsData>
  set(data: Partial<SettingsData>): Promise<void>
}

interface SettingsData {
  isKiosk: boolean
}

const fileName = path.join(__dirname, 'settings.json')
export const Settings: Settings = {
  async get() {
    try {
      const text = (await fs.readFile(fileName)) || '{}'
      const data = JSON.parse(text)
      return {
        isKiosk: data.isKiosk ?? false,
      }
    } catch (e) {
      console.log(e)
      return { isKiosk: false }
    }
  },
  async set(data) {
    try {
      const newData = {
        ...(await this.get()),
        ...data,
      }
      await fs.writeFile(fileName, JSON.stringify(newData))
    } catch (e) {
      console.log(e)
    }
  },
}
