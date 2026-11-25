export interface Bindings {
  DB: D1Database;
  SETUP_SECRET: string;
  LINK_SECRET: string;
  PUBLIC_BASE_URL: string;
}

export interface Person {
  id: number;
  public_id: string;
  kind: "member" | "guest";
  name: string;
  phone: string | null;
  is_organizer: number;
  texts_opt_out: number;
  link_version: number;
  removed_at: number | null;
}

export interface Dinner {
  id: number;
  public_id: string;
  season_id: number | null;
  host_id: number;
  title: string;
  starts_at: number | null;
  location: string;
  note: string;
  capacity: number | null;
  status: "planning" | "polling" | "confirmed" | "cancelled";
  rsvp_closed: number;
}

export interface Invitation {
  id: number;
  public_id: string;
  dinner_id: number;
  person_id: number;
  rsvp: "yes" | "maybe" | "no" | null;
  link_version: number;
}

export interface GroupSettings {
  name: string;
  time_zone: string;
  default_courses: string;
}

/** Who is making the request. "dinner" scope comes from a one-dinner link. */
export type Actor = { person: Person } & (
  | { scope: "full" }
  | { scope: "dinner"; dinnerId: number }
);

export type AppEnv = {
  Bindings: Bindings;
  Variables: { actor: Actor | null };
};
