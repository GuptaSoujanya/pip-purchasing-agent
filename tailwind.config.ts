import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#f6f4f8",
        panel: "#ffffff",
        edge: "#e4dce9",
        muted: "#655a6e",
        challenge: "#9c542d",
        powder: "#edf0e9",
        lavender: "#edf0e9",
        peach: "#f8ede3",
      },
      fontFamily: {
        sans: [
          "DM Sans",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
