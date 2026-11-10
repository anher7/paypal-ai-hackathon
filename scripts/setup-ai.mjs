import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const astropodsVersion = '0.32.0';
const releases = {
  'darwin-arm64': ['ast-darwin-arm64', 'a0fcd6823dbca271fb69a93c5826e984cdcbe310e18ff521feba0da17d109c79'],
  'darwin-x64': ['ast-darwin-amd64', '05c69caaf47a94542563753e1c9df1b4f48292341b0f461c591f0c16764bcd2b'],
  'linux-arm64': ['ast-linux-arm64', '9269a88b1393483d6716b399b3e8c03a7b038e3a1eb6419c6a60ec5b6646375c'],
  'linux-x64': ['ast-linux-amd64', 'a082e6a1acd22c20b5ff61ecdf992be13c5662bdb5cbe18071160ba042ee9ab1'],
  'win32-arm64': ['ast-windows-arm64.exe', '7f560b9d3759a3f8b0377dabfb3479bbb365d37bac074bdfceee7bf75a2c188e'],
  'win32-x64': ['ast-windows-amd64.exe', 'f477d1fbf63046d64dd401f237718e531d1efd80d66dda974561159b2dccdd89'],
};
export function astropodsCliPath(root, platform = process.platform) {
  return join(root, '.tools', `ast-${astropodsVersion}`, platform === 'win32' ? 'ast.exe' : 'ast');
}
export async function setupAstropodsCli(root, options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const release = releases[`${platform}-${arch}`];
  if (!release) throw new Error('Astropods setup supports macOS, Linux and Windows on x64 or ARM64.');
  const [filename, checksum] = release;
  const target = astropodsCliPath(root, platform);
  const digest = data => createHash('sha256').update(data).digest('hex');
  try {
    if (digest(await readFile(target)) !== checksum) throw new Error('The local Astropods executable has an unexpected checksum. No program was run.');
    return target;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const request = options.fetch ?? fetch;
  const download = async name => {
    const response = await request(`https://download.astropods.ai/latest/${name}`, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw new Error('The official Astropods download failed. Try again later.');
    return response;
  };
  if ((await (await download('VERSION')).text()).trim() !== astropodsVersion) throw new Error('The official Astropods release changed. Update the pinned version and checksums before installing.');
  const manifest = await (await download('checksums.txt')).text();
  const entries = manifest.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts[1] === filename);
  if (entries.length !== 1 || entries[0][0] !== checksum) throw new Error('The official Astropods checksum differs from the pinned release. Nothing was installed.');
  const binary = Buffer.from(await (await download(filename)).arrayBuffer());
  if (digest(binary) !== checksum) throw new Error('Astropods checksum verification failed. Nothing was installed.');
  await mkdir(dirname(target), { recursive: true });
  const pending = `${target}.${process.pid}.download`;
  await writeFile(pending, binary, { mode: 0o700 });
  if (platform !== 'win32') await chmod(pending, 0o700);
  await rename(pending, target);
  return target;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await setupAstropodsCli(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    console.log(`Astropods ${astropodsVersion} is checksum-verified inside this project. Run npm run ai:login, then npm run ai:connect with Docker running.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
