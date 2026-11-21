import { describe, expect, it } from "vitest";
import { closedReason } from "../src/lib/dinner-state";

describe("closedReason", () => {
  it("is open for a scheduled dinner today or later", () => {
    expect(closedReason({ status: "scheduled", date: "2026-11-22" }, "2026-11-21")).toBeNull();
    expect(closedReason({ status: "scheduled", date: "2026-11-22" }, "2026-11-22")).toBeNull();
  });

  it("closes once the date has passed", () => {
    expect(closedReason({ status: "scheduled", date: "2026-11-22" }, "2026-11-23")).toBe("dinner is in the past");
  });

  it("is closed when cancelled or done, whatever the date", () => {
    expect(closedReason({ status: "cancelled", date: "2026-12-01" }, "2026-11-21")).toBe("dinner is cancelled");
    expect(closedReason({ status: "done", date: "2026-11-01" }, "2026-11-21")).toBe("dinner is done");
  });
});
