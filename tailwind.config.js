module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        glow: '0 20px 60px rgba(6, 182, 212, 0.18)',
      },
      colors: {
        surface: '#0b1321',
      },
    },
  },
  plugins: [],
};
