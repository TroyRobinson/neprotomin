import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f1ff",
          100: "#e3e5ff",
          200: "#ccd0ff",
          300: "#a8afff",
          400: "#8a93ff",
          500: "#737de6",
          600: "#5f68d9",
          700: "#4d54c7",
          800: "#3f44a8",
          900: "#363a89",
          950: "#252565",
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
