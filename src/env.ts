export interface Env {
  DB: D1Database;
  DEFAULT_TIMEZONE: string;
  SESSION_SECRET: string;
  RESEND_API_KEY?: string;
}

export interface AuthedMember {
  id: string;
  groupId: string;
  role: "admin" | "member";
}

export type AppBindings = {
  Bindings: Env;
  Variables: { member: AuthedMember };
};
