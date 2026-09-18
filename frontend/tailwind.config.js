/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
        },
        phase: {
          extraction: 'hsl(var(--phase-extraction))',
          'extraction-bg': 'hsl(var(--phase-extraction-bg))',
          'extraction-text': 'hsl(var(--phase-extraction-text))',
          dependency: 'hsl(var(--phase-dependency))',
          'dependency-bg': 'hsl(var(--phase-dependency-bg))',
          'dependency-text': 'hsl(var(--phase-dependency-text))',
          risk: 'hsl(var(--phase-risk))',
          'risk-bg': 'hsl(var(--phase-risk-bg))',
          'risk-text': 'hsl(var(--phase-risk-text))',
        },
        ey: {
          yellow: 'hsl(var(--ey-yellow))',
          'yellow-hover': 'hsl(var(--ey-yellow-hover))',
          navy: 'hsl(var(--ey-navy))',
          dark: 'hsl(var(--ey-dark))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'fade-rise': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'icon-float': {
          '0%,100%': { transform: 'translateY(0px) rotate(0deg)' },
          '40%': { transform: 'translateY(-7px) rotate(1.2deg)' },
          '70%': { transform: 'translateY(-3px) rotate(-0.6deg)' },
        },
        'grad-shift': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'pulse-glow': {
          '0%,100%': { boxShadow: '0 0 0 1px rgba(255,215,0,0.08), 0 2px 8px rgba(255,215,0,0.04)' },
          '50%': { boxShadow: '0 0 0 1px rgba(255,215,0,0.28), 0 0 22px 4px rgba(255,215,0,0.12)' },
        },
        'indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(350%)' },
        },
      },
      animation: {
        'fade-rise': 'fade-rise 0.5s ease-out both',
        'fade-rise-delay': 'fade-rise 0.5s ease-out 0.1s both',
        'fade-rise-delay-2': 'fade-rise 0.5s ease-out 0.2s both',
        'fade-in': 'fade-in 0.3s ease-out both',
        'float': 'icon-float 4s ease-in-out infinite',
        'float-slow': 'icon-float 6s ease-in-out infinite',
        'float-fast': 'icon-float 2.5s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 3.5s ease-in-out infinite',
        'indeterminate': 'indeterminate 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};