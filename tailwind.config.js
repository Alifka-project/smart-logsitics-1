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
        /* Electrolux brand blue scale — primary palette */
        primary: {
          50:  '#f2f6f9',
          100: '#e6eef5',
          200: '#cfe0ec',
          300: '#9fc4df',
          400: '#4e88b9',
          500: '#1f5f93',
          600: '#114a76',
          700: '#0a3254',
          800: '#042336',
          900: '#011E41',   /* Electrolux Blue */
          DEFAULT: '#1f5f93',
        },
        /* Surface palette — maps to CSS token vars */
        surface: {
          page:    'var(--bg)',
          default: 'var(--surface)',
          alt:     'var(--surface2)',
        },
        /* Electrolux brand scale alias */
        brand: {
          900: '#011E41', 800: '#042336', 700: '#0a3254',
          600: '#114a76', 500: '#1f5f93', 400: '#4e88b9',
          300: '#9fc4df', 200: '#cfe0ec', 100: '#e6eef5', 50: '#f2f6f9',
        },
      },
      screens: {
        xs: '475px', sm: '640px', md: '768px',
        lg: '1024px', xl: '1280px', '2xl': '1536px',
      },
      fontFamily: {
        // Single canonical stack: Electrolux Sans → DM Sans → system fallbacks.
        // font-sans / font-mono / font-serif all resolve to the same family so
        // every element — including monospaced IDs, POs, and coordinates —
        // renders in the Electrolux brand typeface.
        sans:  ['Electrolux Sans', 'DM Sans', 'Inter', '-apple-system', 'BlinkMacSystemFont',
                'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
        mono:  ['Electrolux Sans', 'DM Sans', 'Inter', '-apple-system', 'BlinkMacSystemFont',
                'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
        serif: ['Electrolux Sans', 'DM Sans', 'Inter', '-apple-system', 'BlinkMacSystemFont',
                'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
      },
      borderRadius: {
        /* Mapped to tokens */
        'lg':  'var(--radius-lg)',   /* 16px */
        '2xl': 'var(--radius-lg)',
        '3xl': '24px',
        'md':  'var(--radius-md)',   /* 12px */
        'pill': 'var(--radius-pill)',
      },
      boxShadow: {
        'card':    'var(--shadow1)',
        'card-lg': 'var(--shadow2)',
        'card-xl': 'var(--shadow3)',
        'glow':    '0 0 20px rgba(1, 30, 65, 0.30)',
        'glow-sm': '0 0 10px rgba(1, 30, 65, 0.20)',
        'pill':    '0 1px 3px rgba(0,0,0,0.08), 0 1px 6px rgba(0,0,0,0.05)',
      },
      backgroundImage: {
        'gradient-accent':  'linear-gradient(135deg, #011E41, #114a76)',
        'gradient-primary': 'linear-gradient(135deg, #011E41 0%, #1f5f93 100%)',
        'gradient-info':    'linear-gradient(135deg, #011E41 0%, #0a3254 100%)',
      },
      spacing: {
        /* Airy spacing scale */
        'page-x': '28px',
        'page-y': '28px',
        'card-p': '20px',
        'gap-sm': '12px',
        'gap-md': '16px',
        'gap-lg': '24px',
      },
    },
  },
  plugins: [],
};
