import { demoCharacter } from "../defaults.js";
import type { Character, Chat, Memory, Message, Persona, PersistedSettings } from "../types.js";

const DB_NAME = "chara-db";
const DB_VERSION = 1;
const stores = ["characters", "personas", "chats", "messages", "memories", "settings"] as const;
type StoreName = (typeof stores)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of stores) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run<T>(storeName: StoreName, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = action(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return run<T[]>(store, "readonly", (s) => s.getAll());
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  await run<IDBValidKey>(store, "readwrite", (s) => s.put(value));
}

export async function remove(store: StoreName, id: string): Promise<void> {
  await run<undefined>(store, "readwrite", (s) => s.delete(id));
}

export async function clearStore(store: StoreName): Promise<void> {
  await run<undefined>(store, "readwrite", (s) => s.clear());
}

export async function loadSnapshot() {
  const [characters, personas, chats, messages, memories, settings] = await Promise.all([
    getAll<Character>("characters"),
    getAll<Persona>("personas"),
    getAll<Chat>("chats"),
    getAll<Message>("messages"),
    getAll<Memory>("memories"),
    getAll<{ id: string; value: PersistedSettings }>("settings"),
  ]);
  const hydratedCharacters = characters.map((character) => character.id === demoCharacter.id
    ? {
        ...character,
        tagline: demoCharacter.tagline,
        description: demoCharacter.description,
        personality: demoCharacter.personality,
        speechStyle: demoCharacter.speechStyle,
        background: demoCharacter.background,
        relationship: demoCharacter.relationship,
        scenario: demoCharacter.scenario,
        exampleDialogue: demoCharacter.exampleDialogue,
        firstMessage: demoCharacter.firstMessage,
        innerThoughtInstruction: demoCharacter.innerThoughtInstruction,
        stripInnerThoughtWhitespace: demoCharacter.stripInnerThoughtWhitespace,
      }
    : character);
  return { characters: hydratedCharacters, personas, chats, messages, memories, settings: settings[0]?.value };
}

export async function saveSettings(settings: PersistedSettings) {
  await put("settings", { id: "app-settings", value: settings });
}

export async function replaceAllData(data: {
  characters: Character[];
  personas: Persona[];
  chats: Chat[];
  messages: Message[];
  memories: Memory[];
  settings: PersistedSettings;
}) {
  await Promise.all(stores.map((s) => clearStore(s)));
  for (const item of data.characters) await put("characters", item);
  for (const item of data.personas) await put("personas", item);
  for (const item of data.chats) await put("chats", item);
  for (const item of data.messages) await put("messages", item);
  for (const item of data.memories) await put("memories", item);
  await saveSettings(data.settings);
}
