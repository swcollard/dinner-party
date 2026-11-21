import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../src/lib/tokens";
import { memberLink } from "../src/lib/provision";

describe("tokens", () => {
  it("generates long, URL-safe, unique tokens", () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it("hashes deterministically to hex SHA-256", async () => {
    expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("puts the token in the URL fragment so it is never sent to a server", () => {
    expect(memberLink("https://dinner.example/", "tok")).toBe("https://dinner.example/#t=tok");
  });
});
