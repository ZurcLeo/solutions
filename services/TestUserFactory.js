const { v4: uuidv4 } = require('uuid');
const { getAuth, getFirestore, FieldValue } = require('../firebaseAdmin');
const { logger } = require('../logger');

const TEST_EMAIL_DOMAIN = 'qa.eloscloud.internal';
const QA_COLLECTION     = 'qa_test_users';

class TestUserFactory {
  /**
   * Cria um usuário completamente isolado para uso em runs de QA.
   * Usa Firebase Admin SDK — não passa pelos middlewares de segurança do Express.
   *
   * @param {string} runId  - ID do run de QA (para agrupamento e cleanup)
   * @returns {Promise<TestUser>}
   */
  static async createIsolated(runId) {
    const shortId = uuidv4().split('-')[0]; // 8 chars
    const email   = `qa_${shortId}@${TEST_EMAIL_DOMAIN}`;
    const name    = `QA Bot ${shortId}`;

    let uid;
    try {
      const authInstance = getAuth();
      const fbUser = await authInstance.createUser({
        email,
        password:    `QATest#${shortId}!2024`,
        displayName: name,
        emailVerified: true, // evita bloqueios de verificação
      });
      uid = fbUser.uid;
    } catch (err) {
      logger.error('TestUserFactory: falha ao criar usuário no Firebase Auth', {
        service:  'TestUserFactory',
        function: 'createIsolated',
        error:    err.message,
      });
      throw err;
    }

    const db = getFirestore();

    // Cria doc mínimo em `usuario` — necessário para Caixinha.create() e inviteService
    // Replica o mesmo objeto que o firstAccess middleware criaria após o login
    await db.collection('usuario').doc(uid).set({
      uid,
      id: uid,
      email,
      nome:          name,
      fotoDoPerfil:  '',
      caixinhas:     [],
      amigos:        [],
      amigosAutorizados: [],
      roles:         {},
      reacoes:       {},
      conversas:     {},
      interesses:    {},
      saldoElosCoins: 0,
      emailVerified: true,
      perfilPublico: false,
      isOwnerOrAdmin: false,
      tipoDeConta:   'Cliente',
      descricao:     'Conta de teste QA',
      isTestAccount: true,
      dataCriacao:   FieldValue.serverTimestamp(),
    });

    // Registra no Firestore para rastreamento e cleanup
    await db.collection(QA_COLLECTION).doc(uid).set({
      uid,
      email,
      displayName: name,
      runId,
      isTestAccount: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    const testUser = {
      uid,
      email,
      displayName: name,
      password: `QATest#${shortId}!2024`,
      runId,
      // Tokens populados após autenticação bem-sucedida
      accessToken:  null,
      refreshToken: null,
    };

    logger.info('TestUserFactory: usuário de teste criado', {
      service:  'TestUserFactory',
      function: 'createIsolated',
      uid,
      runId,
    });

    return testUser;
  }

  /**
   * Gera um custom token Firebase para o usuário de teste.
   * O FlowSimulator usa esse token para autenticar nas rotas da API.
   *
   * @param {string} uid
   * @returns {Promise<string>} customToken
   */
  static async createCustomToken(uid) {
    const authInstance = getAuth();
    return authInstance.createCustomToken(uid, { isQAUser: true });
  }

  /**
   * Converte um Firebase custom token em um ID token utilizável pelo backend.
   *
   * O Admin SDK gera custom tokens (assinados pelo service account).
   * O backend exige ID tokens (emitidos pelo Firebase Identity Toolkit após sign-in).
   * Esta etapa faz a troca via Firebase REST API — equivalente ao signInWithCustomToken()
   * do client SDK, mas sem precisar de um navegador.
   *
   * @param {string} customToken - token gerado por createCustomToken()
   * @returns {Promise<{ idToken: string, refreshToken: string }>}
   */
  static async exchangeCustomTokenForIdToken(customToken) {
    const axios   = require('axios');
    const apiKey  = process.env.FIREBASE_API_KEY;

    if (!apiKey) {
      throw new Error('FIREBASE_API_KEY não configurada — impossível trocar custom token por ID token');
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
    const res = await axios.post(url, {
      token:             customToken,
      returnSecureToken: true,
    }, { timeout: 15000 });

    return {
      idToken:      res.data.idToken,
      refreshToken: res.data.refreshToken,
    };
  }

  /**
   * Remove o usuário de teste do Firebase Auth e do Firestore.
   * Também apaga dados relacionados criados durante o run (caixinhas, etc).
   *
   * @param {TestUser} testUser
   */
  static async cleanup(testUser) {
    const { uid, runId } = testUser;
    const db = getFirestore();

    try {
      // Remove do Firebase Auth
      await getAuth().deleteUser(uid);
    } catch (err) {
      logger.warn('TestUserFactory: falha ao remover do Auth (pode já ter sido removido)', {
        service: 'TestUserFactory', uid, error: err.message,
      });
    }

    // Remove documento de rastreamento
    await db.collection(QA_COLLECTION).doc(uid).delete().catch(() => {});

    // Remove dados de caixinhas criadas durante o run
    await TestUserFactory._cleanupCaixinhas(db, uid);

    // Remove o documento do usuário na collection principal
    await db.collection('usuario').doc(uid).delete().catch(() => {});

    logger.info('TestUserFactory: cleanup concluído', {
      service: 'TestUserFactory', uid, runId,
    });
  }

  /**
   * Remove todas as caixinhas criadas pelo usuário de teste.
   */
  static async _cleanupCaixinhas(db, uid) {
    try {
      const snap = await db.collection('caixinhas')
        .where('adminId', '==', uid)
        .where('isTestData', '==', true)
        .get();

      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      if (!snap.empty) await batch.commit();
    } catch (err) {
      logger.warn('TestUserFactory: falha ao limpar caixinhas de teste', {
        service: 'TestUserFactory', uid, error: err.message,
      });
    }
  }

  /**
   * Lista todos os usuários de teste de um run específico.
   * Útil para cleanup em lote após o run.
   */
  static async listByRunId(runId) {
    const db = getFirestore();
    const snap = await db.collection(QA_COLLECTION)
      .where('runId', '==', runId)
      .get();
    return snap.docs.map(d => d.data());
  }

  /**
   * Cleanup de emergência: remove TODOS os usuários de teste com mais de N horas.
   * Roda automaticamente no início de cada novo run para evitar acúmulo.
   *
   * @param {number} olderThanHours - Remove usuários criados há mais de N horas (padrão: 24h)
   */
  static async cleanupStale(olderThanHours = 24) {
    const db       = getFirestore();
    const cutoff   = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const snap     = await db.collection(QA_COLLECTION)
      .where('createdAt', '<', cutoff)
      .limit(50) // lotes de 50 para não sobrecarregar
      .get();

    if (snap.empty) return;

    logger.info(`TestUserFactory: removendo ${snap.size} usuário(s) de teste obsoleto(s)`, {
      service: 'TestUserFactory', olderThanHours,
    });

    await Promise.allSettled(
      snap.docs.map(doc => TestUserFactory.cleanup(doc.data()))
    );
  }
}

module.exports = TestUserFactory;
