import { describe, expect, it } from "vitest";
import { prisma } from "./db";

describe("database", () => {
  it("is reachable and uses the test file", async () => {
    expect(process.env.DATABASE_URL).toBe("file:./test.db");
    expect(typeof (await prisma.ownedGame.count())).toBe("number");
  });
});
