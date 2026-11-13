// Migraciones al arrancar el contenedor. A diferencia de `drizzle-kit migrate`, muestra el error real
// de PostgreSQL (permiso, SSL, conexión) en los logs en vez de terminar en silencio con código 1.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('[migrate] Falta DATABASE_URL'); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 20000 });
try {
  const who = await pool.query('select current_user, current_database(), version()');
  console.log('[migrate] Conectado como', who.rows[0].current_user, 'a', who.rows[0].current_database);
  await migrate(drizzle(pool), { migrationsFolder: new URL('../db/migrations', import.meta.url).pathname });
  console.log('[migrate] Migraciones aplicadas');
} catch (error) {
  const e = error as { message?: string; code?: string; detail?: string; cause?: { message?: string; code?: string } };
  console.error('[migrate] ERROR:', e.message, e.code ?? '', e.detail ?? '', e.cause?.message ?? '', e.cause?.code ?? '');
  process.exitCode = 1;
} finally { await pool.end(); }
