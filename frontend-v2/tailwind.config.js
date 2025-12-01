/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    // Ensure all custom classes are included
    {
      pattern: /(bg|text|border|ring)-(bg|text|btn|semantic|price|divider|panel)-(dark|medium|light|primary|secondary|tertiary|quaternary|link|purple|pink|solid-text|success|error|warning|neutral|up|down|bg|border)/,
    },
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'sans-serif'],
        sora: ['Sora', 'sans-serif'], // Keep for components that use it
      },
      colors: {
        // Uniswap-inspired dark theme (primary)
        'dark-bg': '#0d0e14',
        'dark-surface': '#1a1b23',
        'dark-surface-hover': '#252730',
        'dark-border': '#2c2d3a',
        'dark-text-primary': '#ffffff',
        'dark-text-secondary': '#8e92bc',
        'dark-text-tertiary': '#5a5d7a',
        'uniswap-blue': '#ff007a',
        'uniswap-blue-hover': '#ff007a',
        
        // V1 component colors (for compatibility with ported components)
        primary: '#abc4ff',
        secondary: '#22D1F8',
        'bg-dark': '#0b1022',
        'bg-medium': '#161E32',
        'bg-light': '#1C243E',
        'text-primary': '#ECF5FF',
        'text-secondary': '#abc4ff',
        'text-tertiary': 'rgba(171, 196, 255, 0.5)',
        'text-quaternary': '#C4D6FF',
        'text-link': '#22D1F8',
        'text-purple': '#8C6EEF',
        'text-pink': '#FF4EA3',
        'btn-primary': '#22D1F8',
        'btn-secondary': '#8C6EEF',
        'btn-solid-text': '#0B1022',
        'semantic-success': '#22D1F8',
        'semantic-error': '#FF4EA3',
        'semantic-warning': '#FED33A',
        'semantic-neutral': '#ABC4FF',
        'price-up': '#22D1F8',
        'price-down': '#FF4EA3',
        'divider-bg': 'rgba(171, 196, 255, 0.12)',
        'panel-border': 'rgba(140, 110, 239, 0.5)',
      },
      backgroundColor: {
        'bg-dark-50': 'rgba(11, 16, 34, 0.5)',
        'bg-light-50': 'rgba(28, 36, 62, 0.53)',
        'bg-light-30': 'rgba(28, 36, 62, 0.3)',
        'bg-transparent-12': 'rgba(171, 196, 255, 0.12)',
        'bg-transparent-07': 'rgba(171, 196, 255, 0.07)',
        'bg-transparent-10': 'rgba(171, 196, 255, 0.1)',
        'secondary-10': 'rgba(34, 209, 248, 0.1)',
      },
      backgroundImage: {
        'solid-button': 'linear-gradient(272.03deg, #39D0D8 2.63%, #22D1F8 95.31%)',
        'outline-button': 'linear-gradient(272.03deg, rgba(57, 208, 216, 0.1) 2.63%, rgba(34, 209, 248, 0.1) 95.31%)',
      },
      boxShadow: {
        'panel-card': '0px 8px 24px rgba(79, 83, 243, 0.12)',
      },
    },
  },
  plugins: [],
}
