import { isAuthenticated } from './_lib/auth.js';
import { handle, json } from './_lib/http.js';

/** GET /api/session → { authenticated } */
export const GET = handle(async (request) => json({ authenticated: isAuthenticated(request) }));
