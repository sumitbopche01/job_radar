import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // LinkedIn-style palette
        brand: { DEFAULT: "#0a66c2", dark: "#004182", light: "#e8f1fb" },
        canvas: "#f4f2ee", // warm page background
        line: "#e3e1dd", // hairline borders
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
