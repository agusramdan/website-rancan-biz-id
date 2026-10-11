/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cocoa: {
          50: '#FBF9F7',
          100: '#F3EFEA',
          200: '#E5DBD0',
          300: '#D1BEB0',
          600: '#7A5C47',
          800: '#5C4033',
          900: '#3D2C1E',
        },
        terracotta: {
          DEFAULT: '#C86D51',
          hover: '#B85D3E',
          light: '#F5EBE8',
        },
        cream: {
          DEFAULT: '#FDFBF7',
          dark: '#F7F4EE',
        }
      },
      fontFamily: {
        serif: ['Georgia', 'serif'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
