/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        uae: { red: '#E4002B', green: '#00843D', black: '#0B0B0C', white: '#FFFFFF' },
        ink: { 900: '#0B0B0C', 800: '#141416', 700: '#1D1D21', 600: '#2A2A30', 500: '#3A3A42', 300: '#9A9AA6', 200: '#C9C9D1' },
        sand: { 100: '#F6F1E7', 200: '#E9DFC9', 400: '#C8A96A' },
      },
      fontFamily: { sans: ['"Inter"', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
