import { requireAuth } from './_lib/auth.js';
import { SETTINGS_ID, collections, toProduct } from './_lib/db.js';
import { handle, json } from './_lib/http.js';
import { normalizeSettings } from '../shared/data.js';
import type { AppData } from '../shared/types.js';

/** GET /api/data → { settings, products } */
export const GET = handle(async (request) => {
  requireAuth(request);
  const { products, settings } = await collections();
  const [settingsDoc, productDocs] = await Promise.all([
    settings.findOne({ _id: SETTINGS_ID }),
    products.find().sort({ updatedAt: -1 }).toArray(),
  ]);
  const data: AppData = {
    version: 1,
    settings: normalizeSettings(settingsDoc),
    products: productDocs.map(toProduct),
  };
  return json(data);
});
