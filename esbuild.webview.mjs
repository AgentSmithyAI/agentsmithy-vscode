import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const sharedConfig = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: !production,
  minify: production || !watch,
  logLevel: 'info',
};

// Build main webview
const mainCtx = await esbuild.context({
  ...sharedConfig,
  entryPoints: ['src/webview/src/index.ts'],
  outfile: 'dist/webview.js',
});

// Build config webview
const configCtx = await esbuild.context({
  ...sharedConfig,
  entryPoints: ['src/webview/src/config-webview.ts'],
  outfile: 'dist/config-webview.js',
});

if (watch) {
  await mainCtx.watch();
  await configCtx.watch();
  console.log('Watching webview files...');
} else {
  await mainCtx.rebuild();
  await configCtx.rebuild();
  await mainCtx.dispose();
  await configCtx.dispose();
  console.log('Webview build complete');
}
