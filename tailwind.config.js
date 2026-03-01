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
        /* Token-mapped primary */
        primary: {
          50:  '#eef1fe',
          100: '#dde4fd',
          200: '#bbc9fb',
          300: '#8da8f8',
          400: '#6b8bf4',
          500: '#4f70f5',
          600: '#3d5ae0',
          700: '#2e45c8',
          800: '#2338a8',
          900: '#1b2d88',
          DEFAULT: '#4f70f5',
        },
        /* Surface palette — maps to CSS token vars */
        surface: {
          page:    'var(--bg)',
          default: 'var(--surface)',
          alt:     'var(--surface2)',
        },
        /* Legacy compat */
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
        sans: ['DM Sans', 'Inter', '-apple-system', 'BlinkMacSystemFont',
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
        'glow':    '0 0 20px rgba(79, 112, 245, 0.25)',
        'glow-sm': '0 0 10px rgba(79, 112, 245, 0.15)',
        'pill':    '0 1px 3px rgba(0,0,0,0.08), 0 1px 6px rgba(0,0,0,0.05)',
      },
      backgroundImage: {
        'gradient-accent':  'linear-gradient(135deg, #4f70f5, #7c3aed)',
        'gradient-primary': 'linear-gradient(135deg, #4F70F5 0%, #5E7EF6 100%)',
        'gradient-info':    'linear-gradient(135deg, #4F70F5 0%, #6B4FE8 100%)',
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
