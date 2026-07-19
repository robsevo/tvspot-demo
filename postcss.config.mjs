const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // Legacy-engine pass, AFTER Tailwind: the living-room Samsung (RU7100,
    // 2019, Tizen 5.0 ≈ Chromium 63) drops every `@layer` block wholesale —
    // Tailwind v4 wraps ALL utilities in cascade layers, so the app rendered
    // completely unstyled there. preset-env flattens the layers into
    // specificity-equivalent plain rules and rewrites oklch/color-mix()/
    // modern-gradient output into forms that engine parses. Modern browsers
    // get the same (visually identical) CSS. See also the `@supports not`
    // fallbacks in globals.css for what no transform can express
    // (aspect-ratio, flex gap, inset).
    "postcss-preset-env": {
      browsers: "chrome >= 63",
      // Only the transforms we need — the full preset rewrites far more
      // (:focus-visible, nesting, logical props) than the risk is worth.
      features: {
        "cascade-layers": true,
        "oklab-function": true,
        "color-mix": true,
        "gradients-interpolation-method": true,
        // Tailwind v4 emits margin-inline/padding-inline/inset-inline for
        // mx-*/px-*/inset-x-* — Chromium 87+ only. On the TV that meant NO
        // horizontal centering (mx-auto dead → everything hugged the left) and
        // NO horizontal button padding. Lower to physical left/right (app is
        // LTR-only).
        "logical-properties-and-values": true,
      },
      autoprefixer: false,
      stage: false,
    },
  },
};

export default config;
