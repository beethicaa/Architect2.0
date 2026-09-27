import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    /*
     * Generated, not written.
     *
     * `public/preview/` is produced by `prebuild` (scripts/build-react-runtime.mjs)
     * - a minified React bundle. Linting it reported 694 warnings, all
     * "expected an assignment and instead saw an expression" on line 9 of a
     * minified file, which is noise about code nobody can change.
     *
     * It is still committed, deliberately: the preview needs it at runtime and a
     * reviewer should be able to see exactly what the preview loads. Ignoring it
     * for lint is not ignoring it for review.
     */
    "public/preview/**",
  ]),
]);

export default eslintConfig;
