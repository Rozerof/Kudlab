// Publica en el catálogo las cuatro tareas digitales (TG-01 a TG-04) con los juegos TD-* (contrato ext-1).
// TG-01 queda con el juego de AlexanderNino97/TD-LLUVIA-DE-ESTRELLAS como versión vigente. No habilita ni aprueba reglas.
import { publishExternal } from '../modules/tareas/catalog/publish.js';
import { EXTERNAL_TASK_IDS } from '../modules/evolucion/external.js';
import { pool } from '../db/client.js';
try {
  const out: Record<string, string> = {};
  for (const id of EXTERNAL_TASK_IDS) out[id] = await publishExternal(id);
  console.log(JSON.stringify({ publishedVersionIds: out, methodology: 'PROPOSED' }));
} finally { await pool.end(); }
