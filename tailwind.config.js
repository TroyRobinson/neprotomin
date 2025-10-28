import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#edf2ff",
          100: "#d7e2ff",
          200: "#b6caff",
          300: "#85a3ff",
          400: "#5b7cff",
          500: "#3755f0",
          600: "#273ed4",
          700: "#1e31ab",
          800: "#1c2b85",
          900: "#1b2769",
          950: "#101540",
        },
      },
      fontFamily: {
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
        display: ["Plus Jakarta Sans", ...defaultTheme.fontFamily.sans],
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
