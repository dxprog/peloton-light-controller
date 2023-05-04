const path = require('path');

module.exports = (env, argv) => {
  const isDev = argv.mode !== 'production';

  return {
    entry: './src/index.ts',
    target: 'node',
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader'
          },
          resolve: {
            fullySpecified: false,
          },
        },
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    output: {
      filename: 'index.js',
      path: path.resolve(__dirname, 'dist'),
    },
  };
}
