import { describe, expect, it } from "vitest";
import { runBackup } from "../src/backup";
import type { Env } from "../src/env";
import { testDb } from "./helpers/d1";

describe("runBackup", () => {
  it("exports every table but never writes live calendar tokens (review finding)", async () => {
    const db = testDb();
    db.sql.exec(`
      INSERT INTO groups (id, name) VALUES ('g', 'Supper');
      INSERT INTO members (id, group_id, name, email, address, calendar_token)
        VALUES ('m1', 'g', 'Alex', 'alex@example.com', '1 Main St', 'LIVE-CALENDAR-SECRET-1'),
               ('m2', 'g', 'Bea', 'bea@example.com', NULL, 'LIVE-CALENDAR-SECRET-2');`);
    const store = new Map<string, string>();
    const env = {
      DB: db.d1,
      BACKUPS: { put: async (key: string, value: string) => void store.set(key, value) },
    } as unknown as Env;

    const { day, tables } = await runBackup(env, new Date("2026-11-22T09:00:00Z"));

    expect(day).toBe("2026-11-22");
    expect(tables.members).toBe(2);
    const members = store.get("backups/2026-11-22/members.ndjson")!.trim().split("\n").map((l) => JSON.parse(l));
    expect(members.map((m) => m.calendar_token)).toEqual([null, null]);
    expect(members[0]).toMatchObject({ id: "m1", email: "alex@example.com", address: "1 Main St" }); // the rest is intact
    for (const [key, body] of store) expect(body, key).not.toContain("LIVE-CALENDAR-SECRET");
    expect(JSON.parse(store.get("backups/2026-11-22/manifest.json")!).redacted).toEqual({ members: ["calendar_token"] });
  });
});
