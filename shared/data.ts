// Valores padrão e validação/normalização dos dados.
// Usado no site (para ler backups) e na API (para nunca gravar lixo no banco).
// Importações com extensão .js porque a API roda como ESM no Node.
import type { AppData, FixedCost, Product, Rounding, Settings } from './types.js';

export const LIMITS = {
  text: 120,
  money: 1_000_000,
  pct: 100,
  pieces: 100_000,
  fixedCosts: 50,
  products: 5_000,
};

export const DEFAULT_SETTINGS: Settings = {
  paymentFeePct: 4,
  marketplaceFeePct: 0,
  taxPct: 0,
  defaultMarginPct: 30,
  defaultPackaging: 0,
  fixedCosts: [
    { id: 'internet', name: 'Internet / celular', value: 0 },
    { id: 'anuncios', name: 'Anúncios (Instagram)', value: 0 },
  ],
  piecesPerMonth: 20,
  rounding: 'x90',
};

const ROUNDINGS: Rounding[] = ['none', 'x90', 'integer', 'x5'];
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type Loose = Record<string, unknown>;

export function isObj(v: unknown): v is Loose {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function isValidId(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

function num(v: unknown, fallback: number, max = LIMITS.money): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(0, n));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, LIMITS.text) : '';
}

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, fixedCosts: DEFAULT_SETTINGS.fixedCosts.map((c) => ({ ...c })) };
}

export function normalizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const s: Loose = isObj(raw) ? raw : {};
  const fixedCosts: FixedCost[] = Array.isArray(s.fixedCosts)
    ? s.fixedCosts
        .filter(isObj)
        .slice(0, LIMITS.fixedCosts)
        .map((c) => ({ id: isValidId(c.id) ? c.id : newId(), name: str(c.name), value: num(c.value, 0) }))
    : defaultSettings().fixedCosts;

  return {
    paymentFeePct: num(s.paymentFeePct, d.paymentFeePct, LIMITS.pct),
    marketplaceFeePct: num(s.marketplaceFeePct, d.marketplaceFeePct, LIMITS.pct),
    taxPct: num(s.taxPct, d.taxPct, LIMITS.pct),
    defaultMarginPct: num(s.defaultMarginPct, d.defaultMarginPct, LIMITS.pct),
    defaultPackaging: num(s.defaultPackaging, d.defaultPackaging),
    piecesPerMonth: num(s.piecesPerMonth, d.piecesPerMonth, LIMITS.pieces),
    rounding: ROUNDINGS.includes(s.rounding as Rounding) ? (s.rounding as Rounding) : d.rounding,
    fixedCosts,
  };
}

/** Retorna null se não for uma peça válida (sem nome). */
export function normalizeProduct(raw: unknown): Product | null {
  if (!isObj(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const now = Date.now();
  return {
    id: isValidId(raw.id) ? raw.id : newId(),
    name: str(raw.name).trim(),
    category: str(raw.category).trim(),
    cost: num(raw.cost, 0),
    shipping: num(raw.shipping, 0),
    packaging: num(raw.packaging, 0),
    marginPct:
      typeof raw.marginPct === 'number' && Number.isFinite(raw.marginPct)
        ? Math.min(LIMITS.pct, Math.max(0, raw.marginPct))
        : null,
    salePrice: num(raw.salePrice, 0),
    createdAt: num(raw.createdAt, now, Number.MAX_SAFE_INTEGER),
    updatedAt: num(raw.updatedAt, now, Number.MAX_SAFE_INTEGER),
  };
}

export function normalizeData(raw: unknown): AppData {
  const root: Loose = isObj(raw) ? raw : {};
  const products = Array.isArray(root.products)
    ? root.products
        .slice(0, LIMITS.products)
        .map(normalizeProduct)
        .filter((p): p is Product => p !== null)
    : [];
  return { version: 1, settings: normalizeSettings(root.settings), products };
}
