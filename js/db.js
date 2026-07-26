// Local persistence layer (IndexedDB).
// Books are keyed by a unique `id` (not ISBN) so the library can hold multiple
// copies of the same ISBN — needed for duplicate flagging and physical multi-copies.
// `isbn` is kept as an indexed field for lookups.
const DB = (() => {
  const DB_NAME = "stackhouse-db";
  const DB_VERSION = 2;
  let dbPromise = null;

  function genId(isbn) {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${isbn || "m"}-${Date.now()}-${rand}`;
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = event.target.transaction;

        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }

        if (db.objectStoreNames.contains("books")) {
          const oldStore = tx.objectStore("books");
          if (oldStore.keyPath === "isbn") {
            // migrate v1 (keyed by isbn) -> v2 (keyed by id, isbn indexed)
            const getAll = oldStore.getAll();
            getAll.onsuccess = () => {
              const old = getAll.result || [];
              db.deleteObjectStore("books");
              const ns = db.createObjectStore("books", { keyPath: "id" });
              ns.createIndex("isbn", "isbn", { unique: false });
              old.forEach((rec) => {
                try {
                  if (!rec.id) rec.id = genId(rec.isbn);
                  ns.add(rec);
                } catch (_) { /* skip any malformed record */ }
              });
            };
          }
        } else {
          const ns = db.createObjectStore("books", { keyPath: "id" });
          ns.createIndex("isbn", "isbn", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode) {
    const db = await open();
    return db.transaction(store, mode).objectStore(store);
  }

  return {
    genId,

    async getAllBooks() {
      const store = await tx("books", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result.filter((b) => !b.deleted));
        req.onerror = () => reject(req.error);
      });
    },

    async getAllRaw() {
      const store = await tx("books", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async getById(id) {
      const store = await tx("books", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },

    // All non-deleted copies sharing an ISBN (for duplicate detection + checkout matching)
    async getByIsbn(isbn) {
      if (!isbn) return [];
      const store = await tx("books", "readonly");
      return new Promise((resolve, reject) => {
        const results = [];
        const idx = store.index("isbn");
        const req = idx.openCursor(IDBKeyRange.only(isbn));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            if (!cursor.value.deleted) results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = () => reject(req.error);
      });
    },

    async putBook(book) {
      if (!book.id) book.id = genId(book.isbn);
      book.updatedAt = Date.now();
      const store = await tx("books", "readwrite");
      return new Promise((resolve, reject) => {
        const req = store.put(book);
        req.onsuccess = () => resolve(book);
        req.onerror = () => reject(req.error);
      });
    },

    async deleteBook(id) {
      const existing = await this.getById(id);
      if (!existing) return;
      existing.deleted = true;
      existing.updatedAt = Date.now();
      return this.putBook(existing);
    },

    async putManyRaw(records) {
      const store = await tx("books", "readwrite");
      return new Promise((resolve, reject) => {
        let remaining = records.length;
        if (!remaining) return resolve();
        records.forEach((b) => {
          if (!b.id) b.id = genId(b.isbn);
          const req = store.put(b);
          req.onsuccess = () => { if (--remaining === 0) resolve(); };
          req.onerror = () => reject(req.error);
        });
      });
    },

    async setMeta(key, value) {
      const store = await tx("meta", "readwrite");
      return new Promise((resolve, reject) => {
        const req = store.put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    async getMeta(key) {
      const store = await tx("meta", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
      });
    },

    async getPeople() {
      const p = await this.getMeta("people");
      return Array.isArray(p) ? p : [];
    },

    async addPerson(name) {
      const people = await this.getPeople();
      if (!people.some((n) => n.toLowerCase() === name.toLowerCase())) {
        people.push(name);
        people.sort((a, b) => a.localeCompare(b));
        await this.setMeta("people", people);
      }
      return people;
    },

    async removePerson(name) {
      const people = (await this.getPeople()).filter((n) => n !== name);
      await this.setMeta("people", people);
      return people;
    },
  };
})();
