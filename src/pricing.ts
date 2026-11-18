import type { Rounding, Settings } from '../shared/types';
import { round2 } from './format';

export interface PriceInput {
  cost: number;
  shipping: number;
  packaging: number;
  marginPct: number;
}

export interface PriceBreakdown {
  directCost: number;
  fixedPerPiece: number;
  totalCost: number;
  /** Taxas + impostos (% do preço de venda) */
  variablePct: number;
  marginPct: number;
  /** false quando taxas + margem >= 100% ou não há custo */
  valid: boolean;
  /** Preço exato que entrega a margem desejada */
  suggested: number;
  /** Preço sugerido após o arredondamento escolhido (sempre para cima) */
  rounded: number;
}

export interface PriceAnalysis {
  fees: number;
  profit: number;
  marginPct: number;
  /** Preço ÷ custo da peça */
  markup: number;
}

export function fixedCostTotal(s: Settings): number {
  return s.fixedCosts.reduce((sum, c) => sum + (c.value > 0 ? c.value : 0), 0);
}

export function fixedPerPiece(s: Settings): number {
  return s.piecesPerMonth > 0 ? fixedCostTotal(s) / s.piecesPerMonth : 0;
}

export function variablePct(s: Settings): number {
  return s.paymentFeePct + s.marketplaceFeePct + s.taxPct;
}

export function roundPrice(price: number, mode: Rounding): number {
  const p = round2(price);
  switch (mode) {
    case 'x90':
      // próximo valor terminado em ,90 (ex.: 57,30 -> 57,90; 57,95 -> 58,90)
      return round2(Math.ceil(round2(p - 0.9)) + 0.9);
    case 'integer':
      return Math.ceil(p);
    case 'x5':
      return Math.ceil(p / 5) * 5;
    default:
      return p;
  }
}

/**
 * Preço de venda pelo método do markup divisor:
 *   preço = custo total / (1 - (taxas% + impostos% + margem%) / 100)
 * Assim as taxas e o imposto são calculados sobre o preço final, e a margem
 * informada é o lucro líquido que sobra de cada venda.
 */
export function calcPrice(input: PriceInput, s: Settings): PriceBreakdown {
  const directCost = Math.max(0, input.cost) + Math.max(0, input.shipping) + Math.max(0, input.packaging);
  const perPiece = fixedPerPiece(s);
  const totalCost = directCost + perPiece;
  const vPct = variablePct(s);
  const divisor = 1 - (vPct + input.marginPct) / 100;
  const valid = divisor > 0 && totalCost > 0;
  const suggested = valid ? totalCost / divisor : 0;
  return {
    directCost,
    fixedPerPiece: perPiece,
    totalCost,
    variablePct: vPct,
    marginPct: input.marginPct,
    valid,
    suggested,
    rounded: valid ? roundPrice(suggested, s.rounding) : 0,
  };
}

/** O que realmente sobra vendendo a um determinado preço. */
export function analyzePrice(price: number, totalCost: number, vPct: number, pieceCost: number): PriceAnalysis {
  const fees = (price * vPct) / 100;
  const profit = price - totalCost - fees;
  return {
    fees,
    profit,
    marginPct: price > 0 ? (profit / price) * 100 : 0,
    markup: pieceCost > 0 ? price / pieceCost : 0,
  };
}
