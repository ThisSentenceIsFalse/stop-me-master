const pkgMeta = require('./package.json');

module.exports = [
    {
        input: './src/overlord.js',
        output: {
            file: pkgMeta.module,
            format: 'es'
        },
        external: ['events', 'child_process']
    },
    {
        input: './src/overlord.js',
        output: {
            file: pkgMeta.main,
            format: 'cjs'
        },
        external: ['events', 'child_process']
    }
];
