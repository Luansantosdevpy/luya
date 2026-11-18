// Autenticação simples por senha única (APP_PASSWORD) + cookie de sessão assinado (HMAC).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

const COOKIE_NAME = 'luya_session';
const SESSION_DAYS = 30;
const MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

function signingKey(): string {
  const secret = process.env.SESSION_SECRET;
  const password = process.env.APP_PASSWORD;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET ausente ou curto (mínimo 32 caracteres)');
  if (!password) throw new Error('APP_PASSWORD não configurada');
  // Incluir a senha na chave faz com que trocar a senha encerre todas as sessões abertas.
  return `${secret}:${createHash('sha256').update(password).digest('hex')}`;
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

/** Comparação em tempo constante (evita descobrir a senha medindo o tempo de resposta). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error('APP_PASSWORD não configurada');
  return safeEqual(password, expected);
}

function isHttps(request: Request): boolean {
  return request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';
}

function cookie(value: string, maxAge: number, request: Request): string {
  const parts = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps(request)) parts.push('Secure');
  return parts.join('; ');
}

export function createSessionCookie(request: Request): string {
  const payload = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return cookie(`${payload}.${sign(payload)}`, MAX_AGE, request);
}

export function clearSessionCookie(request: Request): string {
  return cookie('', 0, request);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function isAuthenticated(request: Request): boolean {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() / 1000;
}

export function requireAuth(request: Request): void {
  if (!isAuthenticated(request)) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  );
}
