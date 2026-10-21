import { context } from 'esbuild';

const ctx = await context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
  sourcemap: true,
  minify: !process.argv.includes('--watch'),
  logLevel: 'info',
});
if (process.argv.includes('--watch')) await ctx.watch();
else {
  await ctx.rebuild();
  await ctx.dispose();
}
