/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}', './pages/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f4f8ff',
          100: '#e9f0ff',
          200: '#c9dafe',
          300: '#a9c3fd',
          400: '#6a96fb',
          500: '#2b68f9',
          600: '#265ddf',
          700: '#1f4db9',
          800: '#183c92',
          900: '#123073'
        }
      }
    }
  },
  plugins: []
};
