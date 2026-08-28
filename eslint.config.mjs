import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Covers come from IGDB's CDN at fixed sizes; the Next image optimizer adds nothing on a LAN.
  { rules: { "@next/next/no-img-element": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "scratch/**", "test-results/**", "playwright-report/**"]),
]);

export default eslintConfig;
