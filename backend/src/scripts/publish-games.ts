// Publica en el catálogo las cuatro tareas digitales (TG-01 a TG-04). No habilita ninguna ni aprueba sus reglas.
import { publishTg01, publishExternal } from '../modules/tareas/catalog/publish.js';
import { EXTERNAL_TASK_IDS } from '../modules/evolucion/external.js';
import { pool } from '../db/client.js';
try {
  const out: Record<string, string> = { 'TG-01': await publishTg01() };
  for (const id of EXTERNAL_TASK_IDS) out[id] = await publishExternal(id);
  console.log(JSON.stringify({ publishedVersionIds: out, methodology: 'PROPOSED' }));
} finally { await pool.end(); }
