const { build } = require('esbuild');
const { nodeExternalsPlugin } = require('esbuild-node-externals');

build({
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: './out/extension.js',
  platform: 'node',
  target: 'node16', // Adjust according to the Node.js version you are using
  external: ['vscode'], // 'vscode' module is provided at runtime
  plugins: [nodeExternalsPlugin()],
  sourcemap: true, // Generate sourcemaps for debugging
  minify: true, // Minify code for production
}).catch(() => process.exit(1));
