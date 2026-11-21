import { Hono } from "hono";
import { requireMember } from "./auth";
import type { AppBindings } from "./env";
import { runReminders } from "./notify";
import { adminRoutes } from "./routes/admin";
import { attendanceRoutes } from "./routes/attendance";
import { calendarRoutes } from "./routes/calendar";
import { dinnerRoutes } from "./routes/dinners";
import { groupRoutes } from "./routes/group";
import { memberRoutes } from "./routes/members";
import { meRoutes } from "./routes/me";

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
app.route("/api", api);

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: AppBindings["Bindings"], ctx: ExecutionContext) => {
    ctx.waitUntil(runReminders(env, new Date()));
  },
} satisfies ExportedHandler<AppBindings["Bindings"]>;
