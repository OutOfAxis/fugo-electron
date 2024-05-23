import { AsyncDatabase } from "promised-sqlite3";

type OpenDB = () => Promise<DB>;
export interface DB {
  saveLastAcceptedScreenshotRequest(
    dashboardId: string,
    time: Date
  ): Promise<void>;
  getLastAcceptedScreenshotRequest(dashboardId: string): Promise<Date>;
  saveDashboardLastSuccess(dashboardId, time: Date): Promise<void>;
  getDashboardLastSuccess(dashboardId): Promise<Date>;
}

export const sqlite: OpenDB = async () => {
  const db = await AsyncDatabase.open("./db.sqlite");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dashboards
    (
      dashboardId TEXT NOT NULL UNIQUE,
      lastAcceptedRequest TEXT,
      lastSuccess TEXT
    );
  `);
  return {
    async saveLastAcceptedScreenshotRequest(dashboardId: string, time: Date) {
      await db.run(
        `
          INSERT INTO dashboards(dashboardId, lastAcceptedRequest)
          VALUES(?, ?)
          ON CONFLICT(dashboardId) DO UPDATE SET lastAcceptedRequest = ?;
        `,
        [dashboardId, time.toString(), time.toString()]
      );
    },
    async getLastAcceptedScreenshotRequest(dashboardId: string) {
      const row = await db.get<{ lastAcceptedRequest: string }>(
        `
          SELECT lastAcceptedRequest
          FROM dashboards
          WHERE dashboardId = ?
          LIMIT 1
        `,
        [dashboardId]
      );
      const date = new Date(row?.lastAcceptedRequest ?? 0);
      if (date instanceof Date && !isNaN(date.getTime())) {
        return date;
      } else {
        return new Date(0);
      }
    },
    async saveDashboardLastSuccess(dashboardId, time) {
      await db.run(
        `
          INSERT INTO dashboards(dashboardId, lastSuccess)
          VALUES(?, ?)
          ON CONFLICT(dashboardId) DO UPDATE SET lastSuccess = ?;
        `,
        [dashboardId, time.toString(), time.toString()]
      );
    },
    async getDashboardLastSuccess(dashboardId) {
      const row = await db.get<{ lastSuccess: string }>(
        `
          SELECT lastSuccess
          FROM dashboards
          WHERE dashboardId = ?
          LIMIT 1
        `,
        [dashboardId]
      );
      const date = new Date(row?.lastSuccess ?? 0);
      if (date instanceof Date && !isNaN(date.getTime())) {
        return date;
      } else {
        return new Date(0);
      }
    },
  };
};
