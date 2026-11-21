import { describe, expect, it } from "vitest";
import {
  can,
  canCancelDinner,
  canEditDinner,
  effectivePermissions,
  parsePermissions,
  type Actor,
} from "../src/lib/permissions";

const member = (permissions: Actor["permissions"] = []): Actor => ({ id: "m1", role: "member", permissions });
const admin: Actor = { id: "a1", role: "admin", permissions: [] };

describe("permissions", () => {
  it("admins can do everything; members only what they were granted", () => {
    expect(can(admin, "manage_members")).toBe(true);
    expect(can(member(), "schedule_dinners")).toBe(false);
    expect(can(member(["schedule_dinners"]), "schedule_dinners")).toBe(true);
  });

  it("parses stored JSON defensively", () => {
    expect(parsePermissions('["skip_weeks","bogus","skip_weeks"]')).toEqual(["skip_weeks"]);
    expect(parsePermissions("not json")).toEqual([]);
    expect(parsePermissions('{"a":1}')).toEqual([]);
    expect(parsePermissions(null)).toEqual([]);
  });

  it("merges group defaults with member-specific grants", () => {
    expect(effectivePermissions('["skip_weeks"]', '["override_host","skip_weeks"]').sort()).toEqual([
      "override_host",
      "skip_weeks",
    ]);
  });

  it("lets hosts manage their own dinner without a grant", () => {
    expect(canEditDinner(member(), "m1")).toBe(true);
    expect(canEditDinner(member(), "someone-else")).toBe(false);
    expect(canEditDinner(member(["edit_any_dinner"]), "someone-else")).toBe(true);
    expect(canCancelDinner(member(), "m1")).toBe(true);
    expect(canCancelDinner(member(), "someone-else")).toBe(false);
    expect(canCancelDinner(admin, "someone-else")).toBe(true);
  });
});
