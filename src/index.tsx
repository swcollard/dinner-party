import { Hono } from "hono";
import { loadActor } from "./auth/session";
import { access } from "./routes/access";
import { dinners } from "./routes/dinners";
import { neutral, sameOriginPosts, securityHeaders } from "./routes/http";
import { members } from "./routes/members";
import { profile } from "./routes/profile";
import { rsvp } from "./routes/rsvp";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use(securityHeaders, sameOriginPosts, loadActor);
app.route("/", access);
app.route("/members", members);
app.route("/", dinners);
app.route("/", rsvp);
app.route("/", profile);
app.notFound(neutral);

export default app;
