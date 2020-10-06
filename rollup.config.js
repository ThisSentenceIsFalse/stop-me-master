export default {
  input: 'src/overlord.mjs',
  output: {
      file: 'index.js',
      format: 'cjs'
  },
  external: ['events', 'child_process']
};
