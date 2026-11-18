import { requireAuth } from './_lib/auth.js';
import { SETTINGS_ID, collections, toProduct, toProductDoc } from './_lib/db.js';
import { HttpError, handle, json, readJson } from './_lib/http.js';
import { LIMITS, isObj, normalizeData } from '../shared/data.js';
import type { AppData } from '../shared/types.js';

/**
 * POST /api/import { settings, products } → substitui todos os dados pelo backup.
 * Grava/atualiza primeiro e só depois remove o que sobrou: se algo falhar no meio,
 * nenhum dado antigo é perdido.
 */
export const POST = handle(async (request) => {
  requireAuth(request);
  const body = await readJson(request);
  if (!isObj(body) || !Array.isArray(body.products)) throw new HttpError(400, 'Backup inválido');
  if (body.products.length > LIMITS.products) throw new HttpError(413, `Máximo de ${LIMITS.products} peças por backup`);

  const data = normalizeData(body);
  const { products, settings } = await collections();

  if (data.products.length > 0) {
    await products.bulkWrite(
      data.products.map((p) => {
        const doc = toProductDoc(p);
        return { replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } };
      }),
      { ordered: false },
    );
  }
  await products.deleteMany({ _id: { $nin: data.products.map((p) => p.id) } });
  await settings.replaceOne({ _id: SETTINGS_ID }, data.settings, { upsert: true });

  const saved = await products.find().sort({ updatedAt: -1 }).toArray();
  const result: AppData = { version: 1, settings: data.settings, products: saved.map(toProduct) };
  return json(result);
});
