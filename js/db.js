// Local persistence layer (IndexedDB). Books are keyed by ISBN.
const DB = (() => {
  const DB_NAME = "stackhouse-db";
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("books")) {
          db.createObjectStore("books", { keyPath: "isbn" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
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
    async getAllBooks() {
      const store = await tx("books", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result.filter((b) => !b.deleted));
        req.onerror = () => reject(req.error);
      });
    },

    // returns ALL rows including tombstoned deletes — used for sync merges
    async getAllRaw() {
      const store = await tx("books", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async getBook(isbn) {
      const store = await tx("books", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.get(isbn);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },

    async putBook(book) {
      book.updatedAt = Date.now();
      const store = await tx("books", "readwrite");
      return new Promise((resolve, reject) => {
        const req = store.put(book);
        req.onsuccess = () => resolve(book);
        req.onerror = () => reject(req.error);
      });
    },

    // soft-delete so the tombstone can propagate through sync
    async deleteBook(isbn) {
      const existing = await this.getBook(isbn);
      if (!existing) return;
      existing.deleted = true;
      existing.updatedAt = Date.now();
      return this.putBook(existing);
    },

    async putManyRaw(books) {
      const store = await tx("books", "readwrite");
      return new Promise((resolve, reject) => {
        let remaining = books.length;
        if (!remaining) return resolve();
        books.forEach((b) => {
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
  };
})();
