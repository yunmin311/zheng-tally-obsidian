import { build, context } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

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
      external: ['obsidian'],
      sourcemap: true,
      minify: isProduction,
    });
    await ctx.watch();
    copyFileSync(join(__dirname, 'manifest.json'), join(outDir, 'manifest.json'));
    console.log('Watching for changes...');
  } else {
    await build({
      entryPoints: [join(__dirname, 'src/main.ts')],
      bundle: true,
      outfile: join(outDir, 'main.js'),
      platform: 'node',
      target: 'es2022',
      format: 'cjs',
      external: ['obsidian'],
      sourcemap: true,
      minify: isProduction,
    });
    copyFileSync(join(__dirname, 'manifest.json'), join(outDir, 'manifest.json'));
    console.log(`Build ${isProduction ? 'production' : 'development'} complete`);
  }
}

buildPlugin().catch(() => process.exit(1));