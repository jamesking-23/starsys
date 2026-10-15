/** @type {import('tailwindcss').Config} */
module.exports = {
  // Tailwind scans these files for class names (including ones written inside JS strings).
  content: ['./index.html', './src/**/*.{js,css}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        ink: {
          50: '#f6f6f4', 100: '#e7e5e0', 200: '#d1cdc4', 300: '#b5ae9f',
          400: '#968d7a', 500: '#7d7363', 600: '#6a6053', 700: '#585045',
          800: '#4a443c', 900: '#2a2621', 950: '#141210',
        },
        gold: {
          50: '#fbf7ef', 100: '#f5ead3', 200: '#ecd4a4', 300: '#dfb76d',
          400: '#d4a04a', 500: '#c98a2f', 600: '#a86a25', 700: '#8a4f22',
          800: '#724022', 900: '#5f3620', 950: '#361b0e',
        },
        paper: '#faf8f3',
        cream: '#f3efe6',
      },
    },
  },
  plugins: [],
};
