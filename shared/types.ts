// Tipos compartilhados entre o site (src/) e a API (api/).

export type Rounding = 'none' | 'x90' | 'integer' | 'x5';

export interface FixedCost {
  id: string;
  name: string;
  /** Valor mensal em R$ */
  value: number;
}

export interface Settings {
  /** Taxa da maquininha / cartão / link de pagamento (% sobre o preço de venda) */
  paymentFeePct: number;
  /** Taxa de marketplace ou plataforma (Shopee, Nuvemshop etc.) */
  marketplaceFeePct: number;
  /** Imposto sobre a venda (0% sem CNPJ; alíquota do Simples no futuro) */
  taxPct: number;
  /** Margem de lucro líquida desejada (% do preço de venda) */
  defaultMarginPct: number;
  /** Custo padrão de embalagem/extras por peça (R$) */
  defaultPackaging: number;
  /** Custos fixos mensais (internet, anúncios, DAS do MEI…) */
  fixedCosts: FixedCost[];
  /** Quantas peças são vendidas por mês, em média (para ratear os custos fixos) */
  piecesPerMonth: number;
  rounding: Rounding;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  /** Quanto foi pago ao fornecedor (R$) */
  cost: number;
  /** Frete da compra rateado por peça (R$) */
  shipping: number;
  /** Embalagem, etiqueta, brinde… (R$) */
  packaging: number;
  /** null = usa a margem padrão das configurações */
  marginPct: number | null;
  /** Preço de venda escolhido (R$) */
  salePrice: number;
  createdAt: number;
  updatedAt: number;
}

/** Peça como enviada pelo site (as datas são definidas pelo servidor). */
export type ProductDraft = Omit<Product, 'createdAt' | 'updatedAt'>;

export interface AppData {
  version: 1;
  settings: Settings;
  products: Product[];
}
