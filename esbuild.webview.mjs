import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

// Build main webview
const mainCtx = await esbuild.context({
  entryPoints: ['src/webview/src/index.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
});

// Build config webview
const configCtx = await esbuild.context({
  entryPoints: ['src/webview/src/config-webview.ts'],
  bundle: true,
  outfile: 'dist/config-webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
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
