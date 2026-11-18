import { requireAuth } from './_lib/auth.js';
import { SETTINGS_ID, collections } from './_lib/db.js';
import { handle, json, readJson } from './_lib/http.js';
import { normalizeSettings } from '../shared/data.js';

/** PUT /api/settings { ...settings } → salva as configurações */
export const PUT = handle(async (request) => {
  requireAuth(request);
  const settings = normalizeSettings(await readJson(request));
  const { settings: col } = await collections();
  await col.replaceOne({ _id: SETTINGS_ID }, settings, { upsert: true });
  return json(settings);
});
