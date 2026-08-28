import { describe, expect, it } from "vitest";
import { prisma } from "./db";

describe("database", () => {
  it("is reachable and starts empty in tests", async () => {
    expect(await prisma.ownedGame.count()).toBe(0);
  });
});
