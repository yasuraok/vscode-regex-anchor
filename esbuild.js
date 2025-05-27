const { build } = require('esbuild');

build({
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: './out/extension.js',
  platform: 'node',
  target: 'node16',
  packages: 'bundle',        // 依存関係をバンドルに含める
  external: ['vscode'],      // VSCodeモジュールのみ外部化
  sourcemap: true,
  minify: true,
}).catch(() => process.exit(1));
