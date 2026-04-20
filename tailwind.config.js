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
        /* ═══════════════════════════════════════════════════════════
           Electrolux Arabia brand palette
           Anchor: Deep Navy #032145 (primary)
           Accents: Warm Gold #D8B873, Sage Green #6F7B69, Blue-Gray Slate #8392A3
           ═══════════════════════════════════════════════════════════ */
        primary: {
          50:  '#f3f6fa',
          100: '#e1eaf3',
          200: '#c2d6e9',
          300: '#8fb7db',
          400: '#5796c9',
          500: '#1f72b3',
          600: '#115a96',
          700: '#0a4478',
          800: '#06325f',
          900: '#032145',   /* Deep Navy — canonical brand */
          DEFAULT: '#032145',
        },
        /* Alias: brand.* === primary.* (kept for legacy component imports) */
        brand: {
          50:  '#f3f6fa', 100: '#e1eaf3', 200: '#c2d6e9', 300: '#8fb7db',
          400: '#5796c9', 500: '#1f72b3', 600: '#115a96', 700: '#0a4478',
          800: '#06325f', 900: '#032145',
        },
        /* Warm Gold accent — secondary brand, use for highlights / premium CTAs */
        gold: {
          50:  '#fbf7ee',
          100: '#f5ead1',
          200: '#ecd9a8',
          300: '#e0c588',
          400: '#d8b873',   /* Warm Gold — canonical accent */
          500: '#c9a352',
          600: '#a98838',
          700: '#856a2c',
          800: '#5f4b20',
          900: '#3d3015',
          DEFAULT: '#d8b873',
        },
        /* Sage Green — tertiary, quiet positive tone (not the same as status green) */
        sage: {
          50:  '#f3f4f1',
          100: '#e3e6df',
          200: '#c7cdbf',
          300: '#a1ac97',
          400: '#828e78',
          500: '#6f7b69',   /* Sage — canonical */
          600: '#596154',
          700: '#464d42',
          800: '#353a32',
          900: '#262a23',
          DEFAULT: '#6f7b69',
        },
        /* Blue-Gray Slate — neutral text/border accent */
        slateBrand: {
          50:  '#f4f6f8',
          100: '#e6eaef',
          200: '#ced5de',
          300: '#adb8c6',
          400: '#8392a3',   /* Blue-Gray Slate — canonical */
          500: '#677685',
          600: '#525e6b',
          700: '#424b55',
          800: '#333a42',
          900: '#24292f',
          DEFAULT: '#8392a3',
        },
        /* Surface palette — maps to CSS token vars */
        surface: {
          page:    'var(--bg)',
          default: 'var(--surface)',
          alt:     'var(--surface2)',
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
        'glow':    '0 0 20px rgba(3, 33, 69, 0.30)',
        'glow-sm': '0 0 10px rgba(3, 33, 69, 0.20)',
        'glow-gold':    '0 0 20px rgba(216, 184, 115, 0.35)',
        'glow-gold-sm': '0 0 10px rgba(216, 184, 115, 0.25)',
        'pill':    '0 1px 3px rgba(0,0,0,0.08), 0 1px 6px rgba(0,0,0,0.05)',
      },
      backgroundImage: {
        'gradient-accent':  'linear-gradient(135deg, #032145, #115a96)',
        'gradient-primary': 'linear-gradient(135deg, #032145 0%, #115a96 100%)',
        'gradient-info':    'linear-gradient(135deg, #032145 0%, #06325f 100%)',
        'gradient-gold':    'linear-gradient(135deg, #d8b873 0%, #c9a352 100%)',
        'gradient-navy-gold': 'linear-gradient(135deg, #032145 0%, #06325f 60%, #c9a352 100%)',
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
