// Descarga los juegos TG-02 a TG-04 desde sus repositorios y copia su carpeta frontend/ a public/juegos/<slug>/.
// Se ejecuta antes de compilar (npm run build). Registra el commit exacto de cada juego en public/juegos/versions.json.
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { games } = JSON.parse(await readFile('games.json', 'utf8'));
const out = 'public/juegos';
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const versions = {};
for (const g of games) {
  if (process.env.GAMES_DIR) { // copia local para desarrollo sin red: GAMES_DIR=/ruta/con/TD-*
    const src = join(process.env.GAMES_DIR, g.repo.split('/').pop().replace(/\.git$/, ''), 'frontend');
    await cp(src, join(out, g.slug), { recursive: true }); versions[g.taskId] = { ...g, commit: 'local' }; continue;
  }
  const dir = await mkdtemp(join(tmpdir(), 'kudlab-game-'));
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', g.ref, g.repo, dir], { stdio: 'inherit' });
  const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
  await cp(join(dir, 'frontend'), join(out, g.slug), { recursive: true, filter: s => !s.includes('test_host.html') });
  await rm(dir, { recursive: true, force: true });
  versions[g.taskId] = { title: g.title, repo: g.repo, ref: g.ref, commit };
  console.log(`${g.taskId} ${g.title} ← ${g.repo}@${commit.slice(0, 7)}`);
}
await writeFile(join(out, 'versions.json'), JSON.stringify(versions, null, 1));
