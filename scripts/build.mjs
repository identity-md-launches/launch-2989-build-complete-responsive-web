// Build the static export: copy src/ into a clean dist/.
// The app is plain ES modules with no dependencies, so the build is a copy
// plus a check that every asset URL in index.html is relative.
//   node scripts/build.mjs          rebuild dist/
//   node scripts/build.mjs --check  fail if dist/ differs from src/
import { cp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');

/** @param {string} dir @returns {Promise<string[]>} */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out.sort();
}

async function check() {
  const a = (await walk(src)).map((p) => relative(src, p));
  const b = (await walk(dist).catch(() => [])).map((p) => relative(dist, p));
  const problems = [];
  for (const f of a) {
    if (!b.includes(f)) problems.push(`missing in dist: ${f}`);
    else if (!(await readFile(join(src, f))).equals(await readFile(join(dist, f)))) problems.push(`differs: ${f}`);
  }
  for (const f of b) if (!a.includes(f)) problems.push(`extra in dist: ${f}`);
  return problems;
}

async function assertRelative() {
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const bad = urls.filter((u) => u.startsWith('/') && !u.startsWith('//'));
  if (bad.length) throw new Error(`absolute asset URLs in index.html: ${bad.join(', ')}`);
  for (const u of urls.filter((x) => x.startsWith('./'))) {
    await stat(join(dist, u)).catch(() => {
      throw new Error(`index.html references a missing file: ${u}`);
    });
  }
}

if (process.argv.includes('--check')) {
  const problems = await check();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  await assertRelative();
  console.log('dist/ matches src/ and uses relative asset URLs');
} else {
  await rm(dist, { recursive: true, force: true });
  await cp(src, dist, { recursive: true });
  await assertRelative();
  const files = await walk(dist);
  console.log(`built dist/ (${files.length} files)`);
}
