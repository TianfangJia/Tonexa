import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        // Action blue — replaces indigo throughout the UI
        indigo: {
          50:  "#eef3ff",
          100: "#dce7fd",
          200: "#b8cefb",
          300: "#80aaf8",
          400: "#4683f6",
          500: "#1a6ef5",
          600: "#0061f4",
          700: "#0051cb",
          800: "#0040a1",
          900: "#003079",
          950: "#001f52",
        },
        // Success green
        green: {
          50:  "#f2f7ec",
          100: "#deeecb",
          200: "#bedda0",
          300: "#96c770",
          400: "#76b24e",
          500: "#62983f",
          600: "#548235",
          700: "#42672a",
          800: "#315020",
          900: "#213815",
          950: "#13220c",
        },
        // Secondary surface — slightly warmer than zinc-50 default
        zinc: {
          50: "oklch(0.97 0 0)",
        },
        // Pitch accuracy palette (canvas colors + score notehead colors)
        pitch: {
          green:   "#548235",
          yellow:  "#eab308",
          red:     "#ef4444",
          darkred: "#991b1b",
        },
      },
      animation: {
        "pulse-fast": "pulse 0.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
