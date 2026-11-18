import { clearSessionCookie } from './_lib/auth.js';
import { handle, json } from './_lib/http.js';

/** POST /api/logout → apaga o cookie de sessão */
export const POST = handle(async (request) => json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(request) }));
