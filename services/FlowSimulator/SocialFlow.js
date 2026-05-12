const BaseFlow = require('./BaseFlow');

/**
 * Simula o ciclo de vida social: Conexão -> Post -> Interação.
 * 
 * Ciclo testado:
 *   1. Usuário A solicita conexão com Usuário B.
 *   2. Usuário B aceita a solicitação.
 *   3. Usuário A cria um post.
 *   4. Usuário B curte o post.
 *   5. Usuário B comenta no post.
 */
class SocialFlow extends BaseFlow {
  constructor(runId, backendUrl) {
    super('social', 'api', runId, backendUrl);
  }

  async run(testUser, secondUser) {
    if (!secondUser) {
      this.logger.warn('SocialFlow requer dois usuários de teste. Pulando...');
      return this.result();
    }

    const authA = { Authorization: `Bearer ${testUser.accessToken}` };
    const authB = { Authorization: `Bearer ${secondUser.accessToken}` };

    let postId = null;

    // 1. Usuário A solicita conexão com Usuário B
    await this.step('request_connection', async ({ axios }) => {
      const res = await axios.post('/api/connections/requested', {
        userId: testUser.uid,
        friendId: secondUser.uid
      }, { headers: authA });

      return { success: true, message: res.data.message };
    });

    // 2. Usuário B aceita a solicitação
    await this.step('accept_connection', async ({ axios }) => {
      const res = await axios.post(`/api/connections/requests/${testUser.uid}/accept`, {}, { headers: authB });

      return { success: true, message: res.data.message };
    });

    // 3. Usuário A cria um post
    await this.step('create_social_post', async ({ axios }) => {
      const res = await axios.post('/api/posts/', {
        userId: testUser.uid,
        content: `Post de QA ${this.runId} para interação social`,
        type: 'text'
      }, { headers: authA });

      postId = res.data?.id;
      return { postId, content: res.data?.content };
    });

    if (!postId) return this.result();

    // 4. Usuário B curte o post
    await this.step('like_post', async ({ axios }) => {
      const res = await axios.post(`/api/posts/${postId}/reactions`, {
        type: 'like'
      }, { headers: authB });

      return { success: true };
    });

    // 5. Usuário B comenta no post
    await this.step('comment_on_post', async ({ axios }) => {
      const res = await axios.post(`/api/posts/${postId}/comments`, {
        content: 'Belo post! Teste de QA funcionando.'
      }, { headers: authB });

      return { success: true, commentId: res.data?.id };
    });

    // 6. Verificar se o post tem as interações
    await this.step('verify_post_interactions', async ({ axios }) => {
      const res = await axios.get(`/api/posts/${postId}`, { headers: authA });
      
      const interactions = {
        reactionsCount: res.data?.reacoes?.length || 0,
        commentsCount: res.data?.comentarios?.length || 0
      };

      if (interactions.reactionsCount < 1 || interactions.commentsCount < 1) {
        throw new Error(`Interações não registradas. Reações: ${interactions.reactionsCount}, Comentários: ${interactions.commentsCount}`);
      }

      return interactions;
    });

    return this.result();
  }
}

module.exports = SocialFlow;
