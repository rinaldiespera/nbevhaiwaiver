import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx,js,jsx,mdx}",
    "./components/**/*.{ts,tsx,js,jsx,mdx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Oxygen",
          "Ubuntu",
          "Cantarell",
          "sans-serif",
        ],
      },
      colors: {
        brand: {
          50: "#eff6ff",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
        },
        success: {
          50: "#ecfdf5",
          500: "#10b981",
          600: "#059669",
        },
        danger: {
          50: "#fef2f2",
          500: "#ef4444",
          600: "#dc2626",
        },
      },
      screens: {},
    },
  },
  plugins: [],
  corePlugins: {
    preflight: true,
  },
};

export default config;
