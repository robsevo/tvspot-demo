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
    // Generated deploy output (vercel build) — thousands of bundled-code hits.
    ".vercel/**",
    // Intentionally ES5, run on the 2019 TV webview — modern-JS rules don't apply.
    "tizen/**",
    "public/tv-polyfills.js",
    "public/sw.js",
  ]),
  {
    // ---------------------------------------------------------------------
    // Tracked debt, downgraded to warnings.
    //
    // These are NOT disabled — every one still prints on every run. They are
    // warnings rather than errors so that `npm run lint` fails on something
    // NEW, which is the only thing a gate can usefully tell you. A gate that
    // has been red for months tells you nothing, and the usual response to it
    // is to stop reading the output entirely.
    //
    // Each entry says what it would take to clear it. None of them are
    // "ignore this rule, it's wrong".
    // ---------------------------------------------------------------------

    rules: {
      // ~70 sites. Almost all are external payloads — scoreboard JSON, M3U
      // attribute bags, upstream catalogue responses — where the honest type is
      // "whatever the remote sent". Clearing this means writing real parsers
      // with runtime validation at each boundary, which is worth doing and is
      // not a mechanical find-and-replace.
      "@typescript-eslint/no-explicit-any": "warn",

      // ~70 sites across four rules, all from the React Compiler rule set added
      // in eslint-plugin-react-hooks v6. This code predates those rules. They
      // flag real patterns worth revisiting (effects that set state, refs read
      // during render), but each one needs to be reasoned about individually —
      // a blind sweep through a video player's lifecycle code is how you break
      // playback in ways no test catches.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",

      // ~27 sites, and mostly deliberate. `next/image` optimises through the
      // Next server, which does nothing for third-party channel logos on hosts
      // we do not control, and the TV webview needs a plain element it can size
      // itself. Where it genuinely helps, it is already used.
      "@next/next/no-img-element": "warn",
    },
  },
]);

export default eslintConfig;
