/** Forvet design tokens. `brand` = primary action/accent, `ink` = text & dark surfaces. */
module.exports = {
  content: ['./src/*.html', './src/*.js'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef4ff', 100: '#dbe6fe', 200: '#bfd2fd', 300: '#93b2fb', 400: '#6189f6', 500: '#3d65ef', 600: '#2a4ad9', 700: '#2239b4', 800: '#22338f', 900: '#212f71', 950: '#171e45' },
        ink: { 50: '#f6f7f9', 100: '#eceef2', 200: '#d5dae2', 300: '#b1bac8', 400: '#8693a8', 500: '#67758d', 600: '#525e74', 700: '#434c5f', 800: '#3a4250', 900: '#1f2430', 950: '#13161e' }
      },
      fontFamily: { mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'] },
      boxShadow: { menu: '0 10px 30px -8px rgba(19,22,30,.25), 0 2px 6px -2px rgba(19,22,30,.12)' }
    }
  },
  plugins: []
};
