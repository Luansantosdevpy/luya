/**
 * Comunicação com a API (que salva no MongoDB) + backup em arquivo.
 */
import type { AppData, Product, ProductDraft, Settings } from '../shared/types';
import { normalizeData } from '../shared/data';

/** Sessão expirada ou ausente: o app deve voltar para a tela de senha. */
export class AuthError extends Error {}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = 'GET', body } = options;
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && path !== 'login') throw new AuthError(data.error || 'Sessão expirada');
  if (!res.ok) throw new Error(data.error || `Erro ${res.status} no servidor`);
  return data as T;
}

export const api = {
  session: () => request<{ authenticated: boolean }>('session'),
  login: (password: string) => request<{ ok: true }>('login', { method: 'POST', body: { password } }),
  logout: () => request<{ ok: true }>('logout', { method: 'POST', body: {} }),
  load: () => request<AppData>('data').then(normalizeData),
  saveSettings: (settings: Settings) => request<Settings>('settings', { method: 'PUT', body: settings }),
  saveProduct: (product: ProductDraft) => request<Product>('products', { method: 'PUT', body: product }),
  deleteProduct: (id: string) => request<{ ok: true }>(`products?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  importData: (data: AppData) => request<AppData>('import', { method: 'POST', body: data }).then(normalizeData),
};

/* ---------- Dados da versão antiga (salvos só no navegador) ---------- */

const LEGACY_KEY = 'luya-calc:v1';

export function readLegacyLocalData(): AppData | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const data = normalizeData(JSON.parse(raw));
    return data.products.length > 0 ? data : null;
  } catch {
    return null;
  }
}

export function clearLegacyLocalData(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignorar
  }
}

/* ---------- Backup em arquivo ---------- */

export function downloadBackup(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `luya-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Lança erro se o arquivo não for um backup válido. */
export function parseBackup(text: string): AppData {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { products?: unknown }).products)) {
    throw new Error('Arquivo de backup inválido');
  }
  return normalizeData(raw);
}
