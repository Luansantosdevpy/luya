import { checkPassword, clientIp, createSessionCookie } from './_lib/auth.js';
import { collections } from './_lib/db.js';
import { HttpError, handle, json, readJson } from './_lib/http.js';
import { isObj } from '../shared/data.js';

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

/** POST /api/login { password } → define o cookie de sessão */
export const POST = handle(async (request) => {
  const body = await readJson(request);
  const password = isObj(body) && typeof body.password === 'string' ? body.password : '';

  const ip = clientIp(request);
  const { loginAttempts } = await collections();
  const attempts = await loginAttempts.findOne({ _id: ip });
  if (attempts && attempts.count >= MAX_ATTEMPTS && attempts.expiresAt > new Date()) {
    throw new HttpError(429, 'Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.');
  }

  if (!password || password.length > 200 || !checkPassword(password)) {
    await loginAttempts.updateOne(
      { _id: ip },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + WINDOW_MS) } },
      { upsert: true },
    );
    throw new HttpError(401, 'Senha incorreta');
  }

  await loginAttempts.deleteOne({ _id: ip });
  return json({ ok: true }, 200, { 'set-cookie': createSessionCookie(request) });
});
