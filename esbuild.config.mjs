import { build, context } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/**
 * Copies the files esbuild does not process into dist/, so dist/ is a complete
 * installable plugin folder (and the folder sync-plugins.ps1 ships to the vault).
 * styles.css is skipped when absent — not every build needs one.
 */
function stageStaticAssets(outDir) {
  copyFileSync(join(__dirname, 'manifest.json'), join(outDir, 'manifest.json'));
  const styles = join(__dirname, 'styles.css');
  if (existsSync(styles)) copyFileSync(styles, join(outDir, 'styles.css'));
}

async function buildPlugin() {
  const outDir = join(__dirname, 'dist');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  if (isWatch) {
    const ctx = await context({
      entryPoints: [join(__dirname, 'src/main.ts')],
      bundle: true,
      outfile: join(outDir, 'main.js'),
      platform: 'node',
      target: 'es2022',
      format: 'cjs',
      external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
      sourcemap: true,
      minify: isProduction,
    });
    await ctx.watch();
    stageStaticAssets(outDir);
    console.log('Watching for changes...');
  } else {
    await build({
      entryPoints: [join(__dirname, 'src/main.ts')],
      bundle: true,
      outfile: join(outDir, 'main.js'),
      platform: 'node',
      target: 'es2022',
      format: 'cjs',
      external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
      sourcemap: true,
      minify: isProduction,
    });
    stageStaticAssets(outDir);
    console.log(`Build ${isProduction ? 'production' : 'development'} complete`);
  }
}

buildPlugin().catch(() => process.exit(1));