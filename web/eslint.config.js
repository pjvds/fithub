// ESLint config for the web/ workspace when running eslint from within this directory.
// When running from the repo root (`eslint web/src`), the root eslint.config.js applies.
import rootConfig from "../eslint.config.js";

export default [
  ...rootConfig,
  {
    // Ignore Astro build artifacts (checked by `astro check` instead)
    ignores: ["dist/**", ".astro/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    // Any web-specific rule overrides go here
  },
];
