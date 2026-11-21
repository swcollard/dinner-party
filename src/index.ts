import { Hono } from "hono";
import { requireMember } from "./auth";
import { BACKUP_CRON, runBackup } from "./backup";
import type { AppBindings } from "./env";
import { markPastDinnersDone } from "./lifecycle";
import { runReminders } from "./notify/reminders";
import { adminRoutes } from "./routes/admin";
import { attendanceRoutes } from "./routes/attendance";
import { calendarRoutes } from "./routes/calendar";
import { dinnerRoutes } from "./routes/dinners";
import { groupRoutes } from "./routes/group";
import { memberRoutes } from "./routes/members";
import { meRoutes } from "./routes/me";
import { potluckRoutes } from "./routes/potluck";

const app = new Hono<AppBindings>();

// Addresses and allergy data live behind these routes: never cache or index them.
app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
});

app.get("/healthz", (c) => c.json({ ok: true }));
app.route("/admin", adminRoutes);
app.route("/calendar", calendarRoutes);

// Everything under /api requires a valid personal link.
const api = new Hono<AppBindings>();
api.use("*", requireMember);
api.route("/", meRoutes);
api.route("/", memberRoutes);
api.route("/", groupRoutes);
api.route("/", dinnerRoutes);
api.route("/", attendanceRoutes);
api.route("/", potluckRoutes);
app.route("/api", api);

export default {
  fetch: app.fetch,
  // Two crons (see wrangler.jsonc): hourly reminders + closing past dinners, weekly backup.
  scheduled: (event: ScheduledController, env: AppBindings["Bindings"], ctx: ExecutionContext) => {
    const now = new Date();
    if (event.cron === BACKUP_CRON) {
      ctx.waitUntil(runBackup(env, now));
      return;
    }
    // Independent jobs: one failing must not stop the other.
    ctx.waitUntil(
      Promise.allSettled([runReminders(env, now), markPastDinnersDone(env, now)]).then((results) => {
        for (const r of results) if (r.status === "rejected") console.error("hourly job failed", r.reason);
      }),
    );
  },
} satisfies ExportedHandler<AppBindings["Bindings"]>;
