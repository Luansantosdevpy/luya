import { requireAuth } from './_lib/auth.js';
import { collections, toProduct } from './_lib/db.js';
import { HttpError, handle, json, readJson } from './_lib/http.js';
import { isValidId, normalizeProduct } from '../shared/data.js';

/** PUT /api/products { ...peça } → cria ou atualiza uma peça */
export const PUT = handle(async (request) => {
  requireAuth(request);
  const product = normalizeProduct(await readJson(request));
  if (!product) throw new HttpError(400, 'Informe o nome da peça');

  const { id, createdAt: _createdAt, ...fields } = product;
  const now = Date.now();
  const { products } = await collections();
  const saved = await products.findOneAndUpdate(
    { _id: id },
    { $set: { ...fields, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true, returnDocument: 'after' },
  );
  if (!saved) throw new Error('Falha ao salvar peça');
  return json(toProduct(saved));
});

/** DELETE /api/products?id=... → exclui uma peça */
export const DELETE = handle(async (request) => {
  requireAuth(request);
  const id = new URL(request.url).searchParams.get('id');
  if (!isValidId(id)) throw new HttpError(400, 'ID inválido');
  const { products } = await collections();
  await products.deleteOne({ _id: id });
  return json({ ok: true });
});
