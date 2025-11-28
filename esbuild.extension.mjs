/**
 * Extension bundler using esbuild.
 *
 * We bundle the extension into a single file to avoid shipping node_modules
 * in the VSIX package (reduces from 2000+ files to ~13 files, ~500KB total).
 */
import * as esbuild from 'esbuild';
import {copyFileSync, mkdirSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/**
 * Copy VS Code codicon assets (CSS + font) from node_modules to media/.
 *
 * Why: The webview needs codicon.css and codicon.ttf for icon buttons.
 * Since we exclude node_modules from VSIX, we must copy these static assets
 * to media/ where they're included in the package.
 */
const copyCodiconAssets = () => {
  const codiconSrc = join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
  const mediaDest = join(__dirname, 'media');

  mkdirSync(mediaDest, {recursive: true});
  copyFileSync(join(codiconSrc, 'codicon.css'), join(mediaDest, 'codicon.css'));
  copyFileSync(join(codiconSrc, 'codicon.ttf'), join(mediaDest, 'codicon.ttf'));
  console.log('Copied codicon assets to media/');
};

/**
 * Plugin that copies codicon assets on every build (including rebuilds in watch mode).
 * This ensures updates to @vscode/codicons are picked up automatically.
 */
const copyCodiconsPlugin = {
  name: 'copy-codicons',
  setup(build) {
    build.onStart(() => {
      copyCodiconAssets();
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  external: ['vscode'], // vscode module is provided by VS Code runtime
  plugins: [copyCodiconsPlugin],
};

const ctx = await esbuild.context(config);

if (watch) {
  await ctx.watch();
  console.log('Watching extension files...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('Extension build complete');
}
