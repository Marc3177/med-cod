/**
 * Typography is fixed here, not chosen ad-hoc in components — see docs/DESIGN.md.
 * Base body text is 13px, dense data (tables, code lists) drops to 11px.
 * Sans-serif only: this is a data-entry application, not a reading surface.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    fontFamily: {
      sans: [
        "Inter",
        "-apple-system",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "sans-serif",
      ],
    },
    fontSize: {
      xs: ["11px", { lineHeight: "16px" }],
      sm: ["13px", { lineHeight: "20px" }],
      base: ["13px", { lineHeight: "20px" }],
      md: ["15px", { lineHeight: "22px" }],
      lg: ["18px", { lineHeight: "24px" }],
    },
    extend: {
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};
