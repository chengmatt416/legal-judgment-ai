const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    'background': './src/background/service-worker.js',
    'content-script': ['./src/content/floating-panel.js', './src/content/content-script.js'],
    'src/popup/popup': './src/popup/popup.js',
    'src/options/options': './src/options/options.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist/build'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          format: {
            comments: false,
          },
          compress: {
            drop_console: false,
            drop_debugger: true,
          },
        },
        extractComments: false,
      }),
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: '_locales', to: '_locales' },
        { from: 'icons', to: 'icons' },
        { from: 'src/lib', to: 'src/lib' },
        { from: 'src/popup/popup.html', to: 'src/popup/popup.html' },
        { from: 'src/popup/popup.css', to: 'src/popup/popup.css' },
        { from: 'src/options/options.html', to: 'src/options/options.html' },
        { from: 'src/options/options.css', to: 'src/options/options.css' },
        { from: 'src/content/floating-panel.css', to: 'src/content/floating-panel.css' },
      ],
    }),
  ],
};
