const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

/** @type {import('webpack').Configuration} */
module.exports = {
  context: __dirname,
  mode: 'none',
  entry: {
    extension: './src/extension/extension.ts'
  },
  output: {
    filename: '[name].js',
    path: path.join(__dirname, 'dist'),
    libraryTarget: 'commonjs'
  },
  target: 'node',
  resolve: {
    mainFields: ['module', 'main'],
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }]
      }
    ]
  },
  externals: {
    vscode: 'commonjs vscode',
    // Keep @vscode/tree-sitter-wasm as external — it loads WASM at runtime
    // and cannot be bundled by webpack.
    '@vscode/tree-sitter-wasm': 'commonjs @vscode/tree-sitter-wasm'
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        // Only copy the files we actually need — not all 20+ language WASMs
        {
          from: 'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter.js',
          to: path.join(__dirname, 'dist', 'wasm', 'tree-sitter.js')
        },
        {
          from: 'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm',
          to: path.join(__dirname, 'dist', 'wasm', 'tree-sitter.wasm')
        },
        {
          from: 'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm',
          to: path.join(__dirname, 'dist', 'wasm', 'tree-sitter-python.wasm')
        }
      ]
    })
  ],
  performance: {
    hints: false
  },
  devtool: 'nosources-source-map'
};
