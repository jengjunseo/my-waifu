import type { Persona, PersistedSettings } from "../types.js";
import type { WorldMemory, WorldMessage, WorldPersistedSettings, WorldSession } from "./types.js";

const DB_NAME = "chara-world-if-db";
const DB_VERSION = 1;
const stores = ["sessions", "messages", "memories", "settings"] as const;
type StoreName = (typeof stores)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openWorldDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of stores) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run<T>(storeName: StoreName, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openWorldDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = action(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function worldGetAll<T>(store: StoreName): Promise<T[]> {
  return run<T[]>(store, "readonly", (s) => s.getAll());
}

export async function worldPut<T>(store: StoreName, value: T): Promise<void> {
  await run<IDBValidKey>(store, "readwrite", (s) => s.put(value));
}

export async function worldRemove(store: StoreName, id: string): Promise<void> {
  await run<undefined>(store, "readwrite", (s) => s.delete(id));
}

export async function loadWorldSnapshot() {
  const [sessions, messages, memories, settings] = await Promise.all([
    worldGetAll<WorldSession>("sessions"),
    worldGetAll<WorldMessage>("messages"),
    worldGetAll<WorldMemory>("memories"),
    worldGetAll<WorldPersistedSettings>("settings"),
  ]);
  return { sessions, messages, memories, settings: settings[0] };
}

export async function saveWorldSettings(settings: WorldPersistedSettings) {
  await worldPut("settings", settings);
}

function openCharaDbReadOnly(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open("chara-db");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve(null);
    };
  });
}

async function readCharaStore<T>(storeName: string): Promise<T[]> {
  const db = await openCharaDbReadOnly();
  if (!db || !db.objectStoreNames.contains(storeName)) {
    db?.close();
    return [];
  }
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result as T[]);
    };
    request.onerror = () => {
      db.close();
      resolve([]);
    };
  });
}

export async function loadSharedCharaContext(): Promise<{ persona?: Persona; settings?: PersistedSettings }> {
  const [personas, rawSettings] = await Promise.all([
    readCharaStore<Persona>("personas"),
    readCharaStore<{ id: string; value: PersistedSettings }>("settings"),
  ]);
  return { persona: personas[0], settings: rawSettings.find((item) => item.id === "app-settings")?.value ?? rawSettings[0]?.value };
}
