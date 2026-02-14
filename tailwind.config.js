import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Primary — Legacy Purple, anchored at #a9abd6
        brand: {
          50: "#f0f0f8",
          100: "#e4e4f2",
          200: "#cccde7",
          300: "#b8b9de",
          400: "#a9abd6",
          500: "#8e90c4",
          600: "#7678b2",
          700: "#5f619e",
          800: "#4e5085",
          900: "#42446e",
          950: "#2a2b48",
        },
        // Secondary — Cedar Tree, anchored at #0a3023
        cedar: {
          50: "#f0f7f4",
          100: "#dceee6",
          200: "#bbddce",
          300: "#8dc5ae",
          400: "#5da88a",
          500: "#3d8b6f",
          600: "#2d7059",
          700: "#255a48",
          800: "#1f483b",
          900: "#153a2e",
          950: "#0a3023",
        },
        // Cedar-tinted neutrals (replaces default blue-grey slate)
        slate: {
          50: "#f7f8f7",
          100: "#f0f2f0",
          200: "#e0e4e1",
          300: "#c8cfcb",
          400: "#8d9990",
          500: "#637069",
          600: "#48554c",
          700: "#313d35",
          800: "#1e2a22",
          900: "#111a14",
          950: "#070f0a",
        },
      },
      fontFamily: {
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
        // Use font-display (Space Grotesk) for editorial content like titles and headings
        // in long-form pages (e.g., AddOrganizationScreen) and modals (e.g., WelcomeModal)
        display: ["Space Grotesk", ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        floating: "0 24px 60px -24px rgba(31, 41, 55, 0.25)",
      },
      spacing: {
        18: "4.5rem",
      },
    },
    container: {
      center: true,
      padding: "1.5rem",
    },
  },
  plugins: [],
};
