import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
const config = defineConfig([
  globalIgnores([".next/**", "next-env.d.ts"]),
  ...nextVitals,
  ...nextTs,
  { rules: { "react-hooks/set-state-in-effect": "off" } },
]);
export default config;
