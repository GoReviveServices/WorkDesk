import { MongoClient, type Db } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'gorevive';

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Copy .env.local.example to .env.local and fill it in.');
  }

  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 8000,
    });
    global._mongoClientPromise = client.connect();
  }

  return global._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(dbName);
}