import { build } from 'esbuild';
import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';

const root = process.cwd();
const source = join(root, 'apps/web/dist/agree-first/browser');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
const assets = {};
async function collect(directory, prefix = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${item.name}`;
    if (item.isDirectory()) await collect(join(directory, item.name), relative);
    else {
      if (item.name.endsWith('.map')) continue;
      const bytes = await readFile(join(directory, item.name));
      assets[relative] = { type: types[extname(item.name)] ?? 'application/octet-stream', body: bytes.toString('base64') };
    }
  }
}
await collect(source);
await writeFile(join(root, 'apps/hosted/src/assets.generated.json'), JSON.stringify(assets));
await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(join(root, 'dist/server'), { recursive: true });
await mkdir(join(root, 'dist/.openai'), { recursive: true });
await build({ entryPoints: [join(root, 'apps/hosted/src/index.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:crypto', 'node:buffer'], outfile: join(root, 'dist/server/index.js'), minify: true });
const manifest = JSON.parse(await readFile(join(root, '.openai/hosting.json'), 'utf8'));
await writeFile(join(root, 'dist/.openai/hosting.json'), JSON.stringify(manifest));
await writeFile(join(root, 'dist/server/wrangler.json'), JSON.stringify({ name: 'agree-first', main: 'index.js', compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], d1_databases: [{ binding: 'DB', database_name: 'agree-first', database_id: '00000000-0000-4000-8000-000000000000' }] }));
console.log(`Hosted Worker built with ${Object.keys(assets).length} Angular assets.`);
