const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function brl(n: number): string {
  return brlFormatter.format(Number.isFinite(n) ? n : 0);
}

export function pct(n: number, digits = 1): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;
}

/** Aceita "12,50", "1.234,56", "12.5", "R$ 10". Retorna null se vazio/inválido. */
export function parseNum(input: string): number | null {
  const t = input.trim().replace(/\s|R\$|%/g, '');
  if (!t) return null;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Número -> texto para campo de formulário (vazio quando 0). */
export function toInput(n: number | null | undefined): string {
  if (n == null || n === 0 || !Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}


/** Para busca sem acento e sem diferenciar maiúsculas. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export { newId } from '../shared/data';

/** Valor em R$ -> texto para campo de formulário, sempre com 2 casas ("68,90"). Vazio quando 0. */
export function toMoneyInput(n: number | null | undefined): string {
  if (n == null || n === 0 || !Number.isFinite(n)) return '';
  return n.toFixed(2).replace('.', ',');
}
