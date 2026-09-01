import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, readTokens } from "./contrast";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const tokens = readTokens(css);

/**
 * The grounds text is ever printed on. `--surface-2` is in the list because
 * `text-faint` lands on it in the main menu's platform counts — "every surface
 * where it is used" is the rule, not "the three the ticket happened to name".
 */
const GROUNDS = ["bg", "bg-elev", "surface", "surface-2"] as const;

/** WCAG AA for normal-size text. Nothing here renders at large-text sizes. */
const AA = 4.5;

describe("contrast ratios", () => {
  it("computes the WCAG ratio", () => {
    // The published reference pair: #767676 is the lightest grey that passes
    // AA on white. If this drifts, every number below is meaningless.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("reads the theme tokens out of globals.css", () => {
    expect(tokens.bg).toBe("#0a0a0a");
    expect(tokens.faint).toBeTruthy();
    expect(tokens.muted).toBeTruthy();
  });

  for (const name of ["faint", "muted", "text", "nes-grey"] as const) {
    for (const ground of GROUNDS) {
      it(`--${name} on --${ground} meets AA`, () => {
        expect(contrastRatio(tokens[name], tokens[ground])).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  /**
   * Three *distinguishable* steps, not three names for the same grey. Without
   * this, the cheapest way to pass the assertions above is to set every text
   * token to #f4f4f4 and delete the hierarchy the palette exists to express.
   */
  it("keeps faint, muted and text apart", () => {
    expect(contrastRatio(tokens.faint, tokens.muted)).toBeGreaterThan(1.4);
    expect(contrastRatio(tokens.muted, tokens.text)).toBeGreaterThan(1.4);
  });
});
