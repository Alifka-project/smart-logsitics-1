/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Brand / accent */
        primary: {
          50:  '#eef1fe',
          100: '#dde4fd',
          200: '#bbc9fb',
          300: '#8da8f8',
          400: '#6b8bf4',
          500: '#4f70f5',   // main accent
          600: '#3d5ae0',
          700: '#2e45c8',
          800: '#2338a8',
          900: '#1b2d88',
          DEFAULT: '#4f70f5',
        },
        /* App surfaces — used directly in className */
        surface: {
          base:    '#0d0e1a',
          default: '#13142a',
          card:    '#181929',
          alt:     '#1e1f35',
          hover:   '#22243d',
        },
        border: {
          DEFAULT: '#252748',
          light:   '#2d2f52',
        },
        /* Keep Electrolux dark brand for backwards compat */
        brand: {
          900: '#011E41',
          800: '#042336',
          700: '#0a3254',
          600: '#114a76',
          500: '#1f5f93',
          400: '#4e88b9',
          300: '#9fc4df',
          200: '#cfe0ec',
          100: '#e6eef5',
          50:  '#f2f6f9',
        },
      },
      screens: {
        xs:  '475px',
        sm:  '640px',
        md:  '768px',
        lg:  '1024px',
        xl:  '1280px',
        '2xl': '1536px',
      },
      fontFamily: {
        sans: ['Inter', 'Montserrat', '-apple-system', 'BlinkMacSystemFont',
               'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        card:  '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        glow:  '0 0 20px rgba(79, 112, 245, 0.25)',
        'glow-sm': '0 0 10px rgba(79, 112, 245, 0.15)',
      },
      backgroundImage: {
        'gradient-accent': 'linear-gradient(135deg, #4f70f5, #7c3aed)',
      },
    },
  },
  plugins: [],
};
