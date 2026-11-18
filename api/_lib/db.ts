import { MongoClient, type Collection } from 'mongodb';
import type { Product, Settings } from '../../shared/types.js';

export interface ProductDoc extends Omit<Product, 'id'> {
  _id: string;
}

export interface SettingsDoc extends Settings {
  _id: string;
}

export interface LoginAttemptDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}

/** Documento único de configurações (preparado para várias lojas no futuro). */
export const SETTINGS_ID = 'default';

// A conexão é reaproveitada entre execuções da mesma instância serverless.
const cache = globalThis as unknown as { _luyaMongo?: Promise<MongoClient>; _luyaIndexes?: Promise<unknown> };

async function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Variável de ambiente MONGODB_URI não configurada');
  if (!cache._luyaMongo) {
    cache._luyaMongo = new MongoClient(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
      appName: 'luya-calc',
    })
      .connect()
      .catch((err) => {
        cache._luyaMongo = undefined;
        throw err;
      });
  }
  return cache._luyaMongo;
}

export async function collections(): Promise<{
  products: Collection<ProductDoc>;
  settings: Collection<SettingsDoc>;
  loginAttempts: Collection<LoginAttemptDoc>;
}> {
  const client = await getClient();
  const db = client.db(process.env.MONGODB_DB || 'luya');
  const result = {
    products: db.collection<ProductDoc>('products'),
    settings: db.collection<SettingsDoc>('settings'),
    loginAttempts: db.collection<LoginAttemptDoc>('login_attempts'),
  };
  // Índices criados uma vez por instância (operação idempotente no Mongo).
  cache._luyaIndexes ??= Promise.all([
    result.products.createIndex({ updatedAt: -1 }),
    result.loginAttempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]).catch((err) => {
    cache._luyaIndexes = undefined;
    console.error('Falha ao criar índices', err);
  });
  return result;
}

export function toProduct({ _id, ...rest }: ProductDoc): Product {
  return { id: _id, ...rest };
}

export function toProductDoc({ id, ...rest }: Product): ProductDoc {
  return { _id: id, ...rest };
}
