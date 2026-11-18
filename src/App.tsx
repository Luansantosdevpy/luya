import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import type { AppData, Product, ProductDraft, Rounding, Settings } from '../shared/types';
import { defaultSettings } from '../shared/data';
import {
  AuthError,
  api,
  clearLegacyLocalData,
  downloadBackup,
  parseBackup,
  readLegacyLocalData,
} from './storage';
import { analyzePrice, calcPrice, fixedCostTotal, fixedPerPiece, variablePct } from './pricing';
import { brl, newId, normalizeText, parseNum, pct, round2, toInput, toMoneyInput } from './format';

type Tab = 'calc' | 'list' | 'settings';

interface FormState {
  id: string | null;
  name: string;
  category: string;
  cost: string;
  shipping: string;
  packaging: string;
  margin: string;
  salePrice: string;
}

type Status = 'loading' | 'login' | 'ready' | 'error';
type SyncState = 'idle' | 'saving' | 'saved' | 'error';
type Toast = { text: string; kind: 'ok' | 'error' };

function emptyForm(s: Settings): FormState {
  return {
    id: null,
    name: '',
    category: '',
    cost: '',
    shipping: '',
    packaging: toMoneyInput(s.defaultPackaging),
    margin: '',
    salePrice: '',
  };
}

function formFromProduct(p: Product): FormState {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    cost: toMoneyInput(p.cost),
    shipping: toMoneyInput(p.shipping),
    packaging: toMoneyInput(p.packaging),
    margin: p.marginPct == null ? '' : toInput(p.marginPct),
    salePrice: toMoneyInput(p.salePrice),
  };
}

const ROUNDING_LABELS: Record<Rounding, string> = {
  x90: 'Terminar em ,90 (ex.: R$ 89,90)',
  integer: 'Valor inteiro (ex.: R$ 90,00)',
  x5: 'Múltiplo de 5 (ex.: R$ 95,00)',
  none: 'Sem arredondamento',
};

export default function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState<AppData>(() => ({ version: 1, settings: defaultSettings(), products: [] }));
  const [tab, setTab] = useState<Tab>('calc');
  const [form, setForm] = useState<FormState>(() => emptyForm(data.settings));
  const [toast, setToast] = useState<Toast | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sync, setSync] = useState<SyncState>('idle');
  const [legacy, setLegacy] = useState<AppData | null>(null);
  const settingsDirty = useRef(false);

  const { settings, products } = data;

  const notify = (text: string, kind: Toast['kind'] = 'ok') => setToast({ text, kind });

  /** Trata erros da API: sessão expirada volta para o login; o resto vira aviso. */
  const handleError = useCallback((err: unknown) => {
    if (err instanceof AuthError) {
      setStatus('login');
      return;
    }
    setToast({ text: err instanceof Error ? err.message : 'Algo deu errado', kind: 'error' });
  }, []);

  const loadAll = useCallback(async () => {
    setStatus('loading');
    try {
      const { authenticated } = await api.session();
      if (!authenticated) {
        setStatus('login');
        return;
      }
      const loaded = await api.load();
      settingsDirty.current = false;
      setData(loaded);
      setForm(emptyForm(loaded.settings));
      setSettingsVersion((v) => v + 1);
      setLegacy(loaded.products.length === 0 ? readLegacyLocalData() : null);
      setStatus('ready');
    } catch (err) {
      if (err instanceof AuthError) {
        setStatus('login');
        return;
      }
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 5000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Salva as configurações no banco ~0,7s depois da última alteração.
  useEffect(() => {
    if (!settingsDirty.current) return;
    setSync('saving');
    const t = window.setTimeout(() => {
      settingsDirty.current = false;
      api
        .saveSettings(settings)
        .then(() => setSync('saved'))
        .catch((err) => {
          setSync('error');
          handleError(err);
        });
    }, 700);
    return () => window.clearTimeout(t);
  }, [settings, handleError]);

  // Avisa antes de fechar a página se ainda houver alteração sendo salva.
  useEffect(() => {
    if (sync !== 'saving') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [sync]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [products],
  );

  async function saveProduct(draft: ProductDraft) {
    setSaving(true);
    try {
      const saved = await api.saveProduct(draft);
      setData((d) => {
        const others = d.products.filter((x) => x.id !== saved.id);
        return { ...d, products: [saved, ...others] };
      });
      notify(form.id ? 'Peça atualizada' : 'Peça salva');
      setForm(emptyForm(settings));
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(p: Product) {
    if (!window.confirm(`Excluir "${p.name}"?`)) return;
    try {
      await api.deleteProduct(p.id);
      setData((d) => ({ ...d, products: d.products.filter((x) => x.id !== p.id) }));
      if (form.id === p.id) setForm(emptyForm(settings));
      notify('Peça excluída');
    } catch (err) {
      handleError(err);
    }
  }

  function editProduct(p: Product) {
    setForm(formFromProduct(p));
    setTab('calc');
    window.scrollTo({ top: 0 });
  }

  function duplicateProduct(p: Product) {
    setForm({ ...formFromProduct(p), id: null, name: `${p.name} (cópia)` });
    setTab('calc');
    window.scrollTo({ top: 0 });
  }

  function updateSettings(patch: Partial<Settings>) {
    settingsDirty.current = true;
    setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }

  async function replaceAllData(imported: AppData, successMessage: string) {
    const saved = await api.importData(imported);
    settingsDirty.current = false;
    setData(saved);
    setForm(emptyForm(saved.settings));
    setSettingsVersion((v) => v + 1);
    notify(successMessage);
  }

  async function importBackup(file: File) {
    let imported: AppData;
    try {
      imported = parseBackup(await file.text());
    } catch {
      notify('Arquivo inválido. Use um backup exportado por esta calculadora.', 'error');
      return;
    }
    const ok = window.confirm(
      `Importar backup com ${imported.products.length} peça(s)?\nIsso substitui as peças e configurações atuais.`,
    );
    if (!ok) return;
    try {
      await replaceAllData(imported, 'Backup importado');
    } catch (err) {
      handleError(err);
    }
  }

  async function migrateLegacy() {
    if (!legacy) return;
    try {
      await replaceAllData(legacy, `${legacy.products.length} peça(s) enviadas para o banco`);
      clearLegacyLocalData();
      setLegacy(null);
    } catch (err) {
      handleError(err);
    }
  }

  function discardLegacy() {
    if (!window.confirm('Descartar as peças salvas só neste navegador? Essa ação não pode ser desfeita.')) return;
    clearLegacyLocalData();
    setLegacy(null);
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      setStatus('login');
    }
  }

  if (status === 'loading') {
    return (
      <div className="screen-center">
        <img className="loading-mark" src="/monogram.png" alt="Carregando" width={72} height={72} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="screen-center">
        <div className="card login-card">
          <h2>Não foi possível carregar</h2>
          <p className="muted">{loadError}</p>
          <button className="btn btn-primary" onClick={() => void loadAll()}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (status === 'login') {
    return <LoginScreen onSuccess={() => void loadAll()} />;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img className="monogram" src="/monogram.png" alt="" width={46} height={46} />
          <div>
            <h1 className="wordmark">Luyá</h1>
            <p className="brand-sub">
              Precificação
              {sync === 'saving' && <span className="sync"> · salvando…</span>}
              {sync === 'saved' && <span className="sync"> · salvo</span>}
              {sync === 'error' && <span className="sync bad"> · erro ao salvar</span>}
            </p>
          </div>
        </div>
        <nav className="tabs" aria-label="Seções">
          <button className={tab === 'calc' ? 'active' : ''} onClick={() => setTab('calc')}>
            {form.id ? 'Editando' : 'Calcular'}
          </button>
          <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            Peças <span className="badge">{products.length}</span>
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            Configurações
          </button>
        </nav>
      </header>

      <main className="container">
        {legacy && (
          <div className="alert alert-warn legacy">
            <span>
              Encontramos {legacy.products.length} peça(s) salvas só neste navegador (versão anterior da calculadora).
            </span>
            <span className="legacy-actions">
              <button className="btn btn-small btn-primary" onClick={() => void migrateLegacy()}>
                Enviar para o banco
              </button>
              <button className="btn btn-small btn-ghost" onClick={discardLegacy}>
                Descartar
              </button>
            </span>
          </div>
        )}

        {tab === 'calc' && (
          <Calculator
            form={form}
            setForm={setForm}
            settings={settings}
            categories={categories}
            saving={saving}
            onSave={saveProduct}
            onCancel={() => setForm(emptyForm(settings))}
            goToSettings={() => setTab('settings')}
          />
        )}
        {tab === 'list' && (
          <ProductList
            products={products}
            settings={settings}
            categories={categories}
            onEdit={editProduct}
            onDuplicate={duplicateProduct}
            onDelete={deleteProduct}
            onNew={() => {
              setForm(emptyForm(settings));
              setTab('calc');
            }}
          />
        )}
        {tab === 'settings' && (
          <SettingsPanel
            key={settingsVersion}
            settings={settings}
            onChange={updateSettings}
            onExport={() => downloadBackup(data)}
            onImport={importBackup}
            onLogout={() => void logout()}
            productsCount={products.length}
          />
        )}
      </main>

      <footer className="footer">
        <Ornament />
        <p>Essência · Atemporal · Você</p>
      </footer>

      {toast && (
        <div className={`toast${toast.kind === 'error' ? ' toast-error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar');
      setBusy(false);
    }
  }

  return (
    <div className="screen-center">
      <form className="login" onSubmit={submit}>
        <img className="login-logo" src="/logo-luya.jpg" alt="Luyá — Essência, atemporal, você" />
        <p className="login-title">Calculadora de preço de venda</p>
        <Ornament />
        <Field label="Senha de acesso">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </Field>
        {error && <div className="alert alert-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

/** Linha dourada com a estrela de quatro pontas, como na logo. */
function Ornament() {
  return (
    <div className="ornament" aria-hidden>
      <span />
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d="M12 0C12.8 7 15 10.6 24 12C15 13.4 12.8 17 12 24C11.2 17 9 13.4 0 12C9 10.6 11.2 7 12 0Z" />
      </svg>
      <span />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Calculadora                                                         */
/* ------------------------------------------------------------------ */

function Calculator({
  form,
  setForm,
  settings,
  categories,
  saving,
  onSave,
  onCancel,
  goToSettings,
}: {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  settings: Settings;
  categories: string[];
  saving: boolean;
  onSave: (p: ProductDraft) => void;
  onCancel: () => void;
  goToSettings: () => void;
}) {
  const set = (key: keyof FormState) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const cost = Math.max(0, parseNum(form.cost) ?? 0);
  const shipping = Math.max(0, parseNum(form.shipping) ?? 0);
  const packaging = Math.max(0, parseNum(form.packaging) ?? 0);
  const customMargin = parseNum(form.margin);
  const marginPct = customMargin ?? settings.defaultMarginPct;

  const b = calcPrice({ cost, shipping, packaging, marginPct }, settings);
  const typedPrice = parseNum(form.salePrice);
  const hasTypedPrice = typedPrice != null && typedPrice > 0;
  const finalPrice = hasTypedPrice ? typedPrice : b.rounded;
  const a = analyzePrice(finalPrice, b.totalCost, b.variablePct, cost);

  const canSave = form.name.trim() !== '' && cost > 0 && finalPrice > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    onSave({
      id: form.id ?? newId(),
      name: form.name.trim(),
      category: form.category.trim(),
      cost,
      shipping,
      packaging,
      marginPct: customMargin,
      salePrice: round2(finalPrice),
    });
  }

  return (
    <form className="calc-grid" onSubmit={submit}>
      <section className="card">
        <h2>{form.id ? 'Editar peça' : 'Nova peça'}</h2>

        <Field label="Nome da peça" required>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
            placeholder="Ex.: Vestido midi floral"
            autoComplete="off"
          />
        </Field>

        <Field label="Categoria">
          <input
            type="text"
            list="categories"
            value={form.category}
            onChange={(e) => set('category')(e.target.value)}
            placeholder="Ex.: Vestidos"
            autoComplete="off"
          />
          <datalist id="categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <div className="row-2">
          <Field label="Custo da peça" required hint="Quanto você pagou ao fornecedor.">
            <MoneyInput value={form.cost} onChange={set('cost')} />
          </Field>
          <Field label="Frete da compra (por peça)" hint="Frete do pedido ÷ nº de peças.">
            <MoneyInput value={form.shipping} onChange={set('shipping')} />
          </Field>
        </div>

        <div className="row-2">
          <Field label="Embalagem e extras" hint="Sacola, etiqueta, tag, brinde…">
            <MoneyInput value={form.packaging} onChange={set('packaging')} />
          </Field>
          <Field label="Margem de lucro" hint={`Vazio = padrão (${pct(settings.defaultMarginPct)}).`}>
            <Affix suffix="%">
              <input
                inputMode="decimal"
                value={form.margin}
                onChange={(e) => set('margin')(e.target.value)}
                placeholder={toInput(settings.defaultMarginPct) || '0'}
              />
            </Affix>
          </Field>
        </div>

        <Field label="Preço de venda (opcional)" hint="Deixe vazio para usar o preço sugerido, ou digite o preço que quer cobrar para ver quanto sobra.">
          <MoneyInput value={form.salePrice} onChange={set('salePrice')} placeholder={b.valid && cost > 0 ? toMoneyInput(b.rounded) : '0,00'} />
        </Field>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={!canSave || saving}>
            {saving ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Salvar peça'}
          </button>
          {(form.id || form.name || form.cost) && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              {form.id ? 'Cancelar edição' : 'Limpar'}
            </button>
          )}
        </div>
      </section>

      <section className="card result" aria-live="polite">
        {cost <= 0 ? (
          <div className="empty">
            <p className="empty-title">Informe o custo da peça</p>
            <p>O preço sugerido aparece aqui conforme você preenche.</p>
          </div>
        ) : !b.valid ? (
          <div className="alert alert-error">
            Taxas e impostos ({pct(b.variablePct)}) + margem ({pct(marginPct)}) somam 100% ou mais. Diminua a margem ou
            revise as taxas.
          </div>
        ) : (
          <>
            <p className="result-label">{hasTypedPrice ? 'Seu preço de venda' : 'Preço sugerido'}</p>
            <p className="result-price">{brl(finalPrice)}</p>
            <p className="result-sub">
              {hasTypedPrice ? (
                <>Sugerido para {pct(marginPct)} de margem: {brl(b.rounded)}</>
              ) : (
                <>
                  Exato: {brl(b.suggested)} · arredondado {settings.rounding === 'none' ? '(desligado)' : 'para cima'}
                </>
              )}
            </p>

            <PriceStatus profit={a.profit} margin={a.marginPct} target={marginPct} />

            <dl className="breakdown">
              <Row label="Custo da peça" value={brl(cost)} />
              {shipping > 0 && <Row label="Frete da compra" value={brl(shipping)} />}
              {packaging > 0 && <Row label="Embalagem e extras" value={brl(packaging)} />}
              <Row
                label="Custos fixos rateados"
                value={brl(b.fixedPerPiece)}
                hint={
                  b.fixedPerPiece > 0
                    ? `${brl(fixedCostTotal(settings))} ÷ ${settings.piecesPerMonth} peças/mês`
                    : 'nenhum cadastrado'
                }
              />
              <Row label="Custo total" value={brl(b.totalCost)} strong />
              <Row label={`Taxas e impostos (${pct(b.variablePct)})`} value={`− ${brl(a.fees)}`} />
              <Row
                label="Lucro por peça"
                value={`${brl(a.profit)} (${pct(a.marginPct)})`}
                strong
                tone={a.profit < 0 ? 'bad' : 'good'}
              />
              <Row label="Markup" value={`${a.markup.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`} hint="preço ÷ custo da peça" />
            </dl>

            <p className="muted small">
              Taxas consideradas: pagamento {pct(settings.paymentFeePct)}
              {settings.marketplaceFeePct > 0 && <>, plataforma {pct(settings.marketplaceFeePct)}</>}, imposto{' '}
              {pct(settings.taxPct)}.{' '}
              <button type="button" className="link" onClick={goToSettings}>
                Ajustar
              </button>
            </p>
          </>
        )}
      </section>
    </form>
  );
}

function PriceStatus({ profit, margin, target }: { profit: number; margin: number; target: number }) {
  if (profit < 0) return <div className="alert alert-error">Esse preço dá prejuízo.</div>;
  if (margin < target - 0.5)
    return (
      <div className="alert alert-warn">
        Margem de {pct(margin)}, abaixo dos {pct(target)} desejados.
      </div>
    );
  return null;
}

function Row({
  label,
  value,
  hint,
  strong,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className={`bd-row${strong ? ' strong' : ''}${tone ? ` ${tone}` : ''}`}>
      <dt>
        {label}
        {hint && <small>{hint}</small>}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lista de peças                                                      */
/* ------------------------------------------------------------------ */

function ProductList({
  products,
  settings,
  categories,
  onEdit,
  onDuplicate,
  onDelete,
  onNew,
}: {
  products: Product[];
  settings: Settings;
  categories: string[];
  onEdit: (p: Product) => void;
  onDuplicate: (p: Product) => void;
  onDelete: (p: Product) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  const rows = useMemo(
    () =>
      [...products]
        .sort((x, y) => y.updatedAt - x.updatedAt)
        .map((p) => {
          const target = p.marginPct ?? settings.defaultMarginPct;
          const b = calcPrice({ cost: p.cost, shipping: p.shipping, packaging: p.packaging, marginPct: target }, settings);
          const a = analyzePrice(p.salePrice, b.totalCost, b.variablePct, p.cost);
          return { p, b, a, target };
        }),
    [products, settings],
  );

  const q = normalizeText(query.trim());
  const filtered = rows.filter(
    ({ p }) => (!category || p.category === category) && (!q || normalizeText(`${p.name} ${p.category}`).includes(q)),
  );

  const belowTarget = rows.filter(({ a, target }) => a.marginPct < target - 0.5).length;

  if (products.length === 0) {
    return (
      <section className="card empty">
        <p className="empty-title">Nenhuma peça salva ainda</p>
        <p>Calcule o preço de uma peça e clique em “Salvar peça” para ela aparecer aqui.</p>
        <button className="btn btn-primary" onClick={onNew}>
          Calcular primeira peça
        </button>
      </section>
    );
  }

  return (
    <section>
      <div className="list-toolbar">
        <input
          type="search"
          placeholder="Buscar peça…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar peça"
        />
        {categories.length > 0 && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filtrar por categoria">
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {belowTarget > 0 && (
        <div className="alert alert-warn">
          {belowTarget === 1 ? '1 peça está' : `${belowTarget} peças estão`} abaixo da margem desejada com as taxas e
          custos atuais. Veja o preço sugerido em cada uma.
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="muted center">Nenhuma peça encontrada.</p>
      ) : (
        <div className="items">
          {filtered.map(({ p, b, a, target }) => (
            <article key={p.id} className="item card">
              <div className="item-head">
                <div>
                  <h3>{p.name}</h3>
                  {p.category && <span className="tag">{p.category}</span>}
                </div>
                <div className="item-price">{brl(p.salePrice)}</div>
              </div>

              <dl className="item-stats">
                <div>
                  <dt>Custo total</dt>
                  <dd>{brl(b.totalCost)}</dd>
                </div>
                <div>
                  <dt>Lucro</dt>
                  <dd className={a.profit < 0 ? 'bad' : ''}>{brl(a.profit)}</dd>
                </div>
                <div>
                  <dt>Margem</dt>
                  <dd className={a.marginPct < target - 0.5 ? 'warn' : ''}>{pct(a.marginPct)}</dd>
                </div>
              </dl>

              {a.profit < 0 ? (
                <p className="item-alert bad">Prejuízo com os custos atuais. Sugerido hoje: {brl(b.rounded)}</p>
              ) : a.marginPct < target - 0.5 && b.valid ? (
                <p className="item-alert warn">
                  Abaixo da margem de {pct(target)}. Sugerido hoje: {brl(b.rounded)}
                </p>
              ) : null}

              <div className="item-actions">
                <button className="btn btn-small" onClick={() => onEdit(p)}>
                  Editar
                </button>
                <button className="btn btn-small btn-ghost" onClick={() => onDuplicate(p)}>
                  Duplicar
                </button>
                <button className="btn btn-small btn-danger" onClick={() => onDelete(p)}>
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Configurações                                                       */
/* ------------------------------------------------------------------ */

function SettingsPanel({
  settings,
  onChange,
  onExport,
  onImport,
  onLogout,
  productsCount,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onLogout: () => void;
  productsCount: number;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const total = fixedCostTotal(settings);
  const perPiece = fixedPerPiece(settings);
  const vPct = variablePct(settings);

  function updateFixed(id: string, patch: { name?: string; value?: number }) {
    onChange({ fixedCosts: settings.fixedCosts.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>Taxas e impostos</h2>
        <p className="muted small">Percentuais cobrados sobre o preço de venda.</p>
        <div className="row-3">
          <Field label="Taxa de pagamento" hint="Maquininha, cartão, link. Use a mais cara que você aceita.">
            <Affix suffix="%">
              <NumInput value={settings.paymentFeePct} onChange={(v) => onChange({ paymentFeePct: v })} />
            </Affix>
          </Field>
          <Field label="Taxa de plataforma" hint="Marketplace ou loja online (Shopee, Nuvemshop…).">
            <Affix suffix="%">
              <NumInput value={settings.marketplaceFeePct} onChange={(v) => onChange({ marketplaceFeePct: v })} />
            </Affix>
          </Field>
          <Field label="Imposto sobre a venda" hint="0% enquanto não houver CNPJ.">
            <Affix suffix="%">
              <NumInput value={settings.taxPct} onChange={(v) => onChange({ taxPct: v })} />
            </Affix>
          </Field>
        </div>
        <div className="info">
          <strong>Quando abrir CNPJ:</strong> como <b>MEI</b>, o imposto é um valor fixo mensal (DAS), então adicione-o
          em <i>Custos fixos mensais</i> e deixe o imposto em 0%. No <b>Simples Nacional</b>, informe aqui a alíquota
          (no comércio começa em torno de 4%).
        </div>
      </section>

      <section className="card">
        <h2>Padrões de preço</h2>
        <div className="row-3">
          <Field
            label="Margem de lucro padrão"
            hint="Quanto sobra de lucro, em % do preço. 30% = R$ 30 de lucro a cada R$ 100 vendidos."
          >
            <Affix suffix="%">
              <NumInput value={settings.defaultMarginPct} onChange={(v) => onChange({ defaultMarginPct: v })} />
            </Affix>
          </Field>
          <Field label="Embalagem padrão por peça" hint="Já vem preenchido em cada peça nova.">
            <Affix prefix="R$">
              <NumInput value={settings.defaultPackaging} onChange={(v) => onChange({ defaultPackaging: v })} />
            </Affix>
          </Field>
          <Field label="Arredondamento do preço" hint="Sempre arredonda para cima.">
            <select value={settings.rounding} onChange={(e) => onChange({ rounding: e.target.value as Rounding })}>
              {(Object.keys(ROUNDING_LABELS) as Rounding[]).map((r) => (
                <option key={r} value={r}>
                  {ROUNDING_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {vPct + settings.defaultMarginPct >= 100 && (
          <div className="alert alert-error">Taxas + margem padrão somam 100% ou mais; não é possível calcular o preço.</div>
        )}
      </section>

      <section className="card">
        <h2>Custos fixos mensais</h2>
        <p className="muted small">
          Gastos do negócio que não dependem de cada peça. Eles são divididos pelas peças vendidas no mês e somados ao
          custo de cada uma.
        </p>
        <div className="fixed-list">
          {settings.fixedCosts.map((c) => (
            <div key={c.id} className="fixed-row">
              <input
                type="text"
                value={c.name}
                placeholder="Ex.: Internet"
                onChange={(e) => updateFixed(c.id, { name: e.target.value })}
                aria-label="Nome do custo"
              />
              <Affix prefix="R$">
                <NumInput value={c.value} onChange={(v) => updateFixed(c.id, { value: v })} ariaLabel="Valor mensal" />
              </Affix>
              <button
                type="button"
                className="btn btn-small btn-ghost"
                aria-label={`Remover ${c.name || 'custo'}`}
                onClick={() => onChange({ fixedCosts: settings.fixedCosts.filter((x) => x.id !== c.id) })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => onChange({ fixedCosts: [...settings.fixedCosts, { id: newId(), name: '', value: 0 }] })}
        >
          + Adicionar custo
        </button>

        <div className="row-2 mt">
          <Field label="Peças vendidas por mês (média)" hint="Use uma estimativa realista, sem exagerar.">
            <Affix suffix="peças">
              <NumInput value={settings.piecesPerMonth} onChange={(v) => onChange({ piecesPerMonth: Math.max(0, v) })} />
            </Affix>
          </Field>
          <div className="summary-box">
            <span>Total mensal: {brl(total)}</span>
            <strong>{brl(perPiece)} por peça</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Backup dos dados</h2>
        <p className="muted small">
          As peças e configurações ficam salvas no banco de dados e aparecem em qualquer aparelho. Exportar gera uma
          cópia em arquivo. Importar <b>substitui</b> todos os dados atuais pelos do arquivo.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onExport}>
            Exportar backup ({productsCount} {productsCount === 1 ? 'peça' : 'peças'})
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            Importar backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <section className="card">
        <h2>Acesso</h2>
        <p className="muted small">A sessão dura 30 dias neste aparelho. Trocar a senha na Vercel desconecta todos.</p>
        <div className="actions">
          <button type="button" className="btn btn-danger" onClick={onLogout}>
            Sair
          </button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Componentes de formulário                                           */
/* ------------------------------------------------------------------ */

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <em aria-hidden> *</em>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Affix({ prefix, suffix, children }: { prefix?: string; suffix?: string; children: ReactNode }) {
  return (
    <div className="affix">
      {prefix && <span className="affix-part">{prefix}</span>}
      {children}
      {suffix && <span className="affix-part">{suffix}</span>}
    </div>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder = '0,00',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Affix prefix="R$">
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </Affix>
  );
}

/** Campo numérico que guarda o texto digitado (aceita vírgula) e devolve o número. */
function NumInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() => toInput(value));
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder="0"
      aria-label={ariaLabel}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseNum(e.target.value) ?? 0);
      }}
    />
  );
}
