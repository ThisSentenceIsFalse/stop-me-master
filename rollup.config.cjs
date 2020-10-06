const pkgMeta = require('./package.json');

module.exports = {
  input: './src/overlord.js',
  output: {
      file: pkgMeta.main,
      format: 'es'
  },
  external: ['events', 'child_process']
};
