/**
 * FirestoreMockService
 *
 * Intercepta chamadas ao Firestore durante runs de QA com modo `firestoreMock: true`.
 * Objetivo: descobrir quais serviços ainda dependem do Firestore antes do cutover para Supabase.
 *
 * Estratégia (safe — sem crash):
 * - Patcha `db.collection()` e `db.doc()` no objeto singleton já instanciado.
 * - Registra cada acesso em `_accesses` (path + method + timestamp).
 * - Retorna respostas Firestore vazias e plausíveis (não lança erros síncronos).
 *   → Isso evita crashes de processo causados por erros no SDK interno do Firebase.
 * - Steps que dependem de dados do Firestore falharão de forma graceful (dados vazios),
 *   mas sem derrubar o servidor.
 *
 * Uso:
 *   const firestoreMock = require('./FirestoreMockService');
 *   firestoreMock.activate(db);
 *   // ... run flows ...
 *   const accesses = firestoreMock.getAccesses();
 *   firestoreMock.deactivate();
 */
class FirestoreMockService {
  constructor() {
    this._active             = false;
    this._accesses           = [];
    this._originalCollection = null;
    this._originalDoc        = null;
    this._db                 = null;

    // Paths QA-internos que continuam funcionando mesmo com mock ativo.
    this._whitelist = new Set([
      'qa_runs',
      'qa_interpretation_cache',
      'qa_autofixes',
      'qa_autofix_pending',
    ]);
  }

  /**
   * Ativa o mock no objeto Firestore singleton.
   * @param {FirebaseFirestore.Firestore} db — instância retornada por getFirestore()
   */
  activate(db) {
    if (this._active) return;

    this._db       = db;
    this._accesses = [];

    this._originalCollection = db.collection.bind(db);
    this._originalDoc        = db.doc ? db.doc.bind(db) : null;

    const self = this;

    db.collection = function (path) {
      const top = (path || '').split('/')[0];
      if (self._whitelist.has(top)) {
        return self._originalCollection(path);
      }
      self._recordAccess(path, 'collection');
      return self._createFakeCollectionRef(path);
    };

    if (this._originalDoc) {
      db.doc = function (path) {
        const top = (path || '').split('/')[0];
        if (self._whitelist.has(top)) {
          return self._originalDoc(path);
        }
        self._recordAccess(path, 'doc');
        return self._createFakeDocRef(path);
      };
    }

    this._active = true;
  }

  /**
   * Restaura os métodos originais do Firestore.
   */
  deactivate() {
    if (!this._active || !this._db) return;

    if (this._originalCollection) this._db.collection = this._originalCollection;
    if (this._originalDoc)        this._db.doc        = this._originalDoc;

    this._active             = false;
    this._originalCollection = null;
    this._originalDoc        = null;
    this._db                 = null;
  }

  /** @returns {boolean} */
  isActive() { return this._active; }

  /**
   * Retorna lista de acessos registrados.
   * @returns {Array<{path, method, timestamp}>}
   */
  getAccesses() { return [...this._accesses]; }

  /**
   * Resumo agregado deduplicado por path.
   * @returns {Array<{path, method, count}>}
   */
  getSummary() {
    const map = {};
    for (const a of this._accesses) {
      const key = `${a.method}:${a.path}`;
      if (!map[key]) map[key] = { path: a.path, method: a.method, count: 0 };
      map[key].count++;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }

  // ─── privado ─────────────────────────────────────────────────────────────

  _recordAccess(path, method) {
    this._accesses.push({ path, method, timestamp: new Date().toISOString() });
  }

  /**
   * Fake QuerySnapshot (resultado de collection().get() ou where().get())
   */
  _fakeQuerySnapshot() {
    return {
      empty:    true,
      size:     0,
      docs:     [],
      forEach:  () => {},
      [Symbol.iterator]: function* () {},
    };
  }

  /**
   * Fake DocumentSnapshot (resultado de doc().get())
   */
  _fakeDocSnapshot(path) {
    const id = (path || '').split('/').pop() || 'mock-id';
    return {
      exists:    false,
      id,
      ref:       null,
      data:      () => null,
      get:       () => undefined,
      isEqual:   () => false,
    };
  }

  /**
   * Fake WriteResult (resultado de set/update/delete)
   */
  _fakeWriteResult() {
    return { writeTime: new Date() };
  }

  /**
   * Retorna um fake CollectionReference que registra acessos e nunca lança.
   */
  _createFakeCollectionRef(path) {
    const self = this;

    const ref = {
      id:   (path || '').split('/').pop() || 'mock',
      path,

      // Encadeamento de query — retorna o mesmo ref
      where:      (..._args) => ref,
      orderBy:    (..._args) => ref,
      limit:      (..._args) => ref,
      limitToLast:(..._args) => ref,
      startAfter: (..._args) => ref,
      startAt:    (..._args) => ref,
      endBefore:  (..._args) => ref,
      endAt:      (..._args) => ref,
      select:     (..._args) => ref,
      withConverter: (..._args) => ref,

      // Acesso a sub-doc
      doc: (id) => {
        const subPath = id ? `${path}/${id}` : path;
        self._recordAccess(subPath, 'doc');
        return self._createFakeDocRef(subPath);
      },

      // Terminal: leitura
      get: async () => self._fakeQuerySnapshot(),

      // Terminal: escrita (add retorna um fake DocRef com id gerado)
      add: async () => self._createFakeDocRef(`${path}/mock-${Date.now()}`),

      // Batch operations (não fazem nada, retornam o batch)
      isEqual: () => false,
    };

    return ref;
  }

  /**
   * Retorna um fake DocumentReference que registra acessos e nunca lança.
   */
  _createFakeDocRef(path) {
    const self = this;
    const id   = (path || '').split('/').pop() || 'mock-id';

    const ref = {
      id,
      path,
      parent: null,
      firestore: null,

      // Acesso a sub-coleção
      collection: (subColl) => {
        const subPath = `${path}/${subColl}`;
        self._recordAccess(subPath, 'collection');
        return self._createFakeCollectionRef(subPath);
      },

      // Terminal: leitura
      get:    async () => self._fakeDocSnapshot(path),

      // Terminal: escrita
      set:    async () => self._fakeWriteResult(),
      update: async () => self._fakeWriteResult(),
      delete: async () => self._fakeWriteResult(),
      create: async () => self._fakeWriteResult(),

      // Listener (retorna função de unsubscribe)
      onSnapshot: (cb) => {
        if (typeof cb === 'function') {
          try { cb(self._fakeDocSnapshot(path)); } catch (_) {}
        }
        return () => {}; // unsubscribe
      },

      isEqual: () => false,
      withConverter: (..._args) => ref,
    };

    return ref;
  }
}

module.exports = new FirestoreMockService();
