import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { astropodsCliPath, setupAstropodsCli } from '../setup-ai.mjs';
async function project(t) { const root = await mkdtemp(join(tmpdir(), 'agree-first-cli-')); t.after(() => rm(root, { recursive:true, force:true })); return root; }
test('platform-specific CLI paths use the pinned release', () => {
  assert.match(astropodsCliPath('/example', 'darwin'), /ast-0\.32\.0[/\\]ast$/);
  assert.match(astropodsCliPath('/example', 'win32'), /ast-0\.32\.0[/\\]ast\.exe$/);
});
test('an altered local CLI is rejected without running or downloading anything', async t => {
  const root = await project(t); const path = astropodsCliPath(root); await mkdir(dirname(path), {recursive:true}); await writeFile(path, 'altered');
  await assert.rejects(setupAstropodsCli(root, {fetch: () => { throw new Error('Must not download'); }}), /unexpected checksum/);
});
test('unsupported platforms fail before a download', async t => {
  await assert.rejects(setupAstropodsCli(await project(t), {platform:'unknown',arch:'x64'}), /supports macOS/);
});
test('a changed release cannot silently install a different CLI', async t => {
  await assert.rejects(setupAstropodsCli(await project(t), {fetch:async () => new Response('99.0.0')}), /release changed/);
});
test('a changed official manifest cannot replace a pinned executable', async t => {
  await assert.rejects(setupAstropodsCli(await project(t), {fetch:async url => new Response(url.endsWith('VERSION') ? '0.32.0' : 'wrong manifest')}), /checksum differs/);
});
test('download failure does not install a program', async t => {
  await assert.rejects(setupAstropodsCli(await project(t), {fetch:async () => new Response('', {status:503})}), /download failed/);
});

test('binary bytes must match the independently pinned checksum', async t => {
  const root = await project(t);
  await assert.rejects(setupAstropodsCli(root, {platform:'darwin',arch:'arm64',fetch:async url => new Response(url.endsWith('VERSION') ? '0.32.0' : url.endsWith('checksums.txt') ? 'a0fcd6823dbca271fb69a93c5826e984cdcbe310e18ff521feba0da17d109c79  ast-darwin-arm64' : 'wrong binary')}), /verification failed/);
});
