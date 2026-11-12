// Used only by Jest (via jest.config.cjs). The app itself is built by the bundler.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  overrides: [
    {
      test: /\.(js|jsx|mjs|cjs|tsx)$/,
      presets: [['@babel/preset-react', { runtime: 'automatic' }]],
    },
    {
      test: /\.tsx?$/,
      presets: ['@babel/preset-typescript'],
    },
  ],
};
