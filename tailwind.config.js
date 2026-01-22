/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f2f6f9',
          100: '#e6eef5',
          200: '#cfe0ec',
          300: '#9fc4df',
          400: '#4e88b9',
          500: '#1f5f93',
          600: '#114a76',
          700: '#0a3254',
          800: '#042336',
          900: '#011E41',
          DEFAULT: '#011E41',
        },
        // Remap Tailwind's `purple` to the Electrolux blue palette so existing
        // `purple-*` utility classes become the brand blue without changing markup.
        purple: {
          50: '#f2f6f9',
          100: '#e6eef5',
          200: '#cfe0ec',
          300: '#9fc4df',
          400: '#4e88b9',
          500: '#1f5f93',
          600: '#114a76',
          700: '#0a3254',
          800: '#042336',
          900: '#011E41',
        },
      },
      screens: {
        'xs': '475px',
        'sm': '640px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
        '2xl': '1536px',
      },
      fontFamily: {
        'sans': ['Montserrat', 'Avenir', 'Circular', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

