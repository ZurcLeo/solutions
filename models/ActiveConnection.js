const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

class ActiveConnection {
  constructor(data) {
    this.id = data.id || null;
    this.nome = data.nome || 'Desconhecido';
    this.username = data.username || null;
    this.fotoDoPerfil = data.fotoDoPerfil || '';
    this.descricao = data.descricao || '';
    this.email = data.email || '';
    this.status = data.status || 'active';
    this.dataDoAceite = this.formatDate(data.dataDoAceite);
  }

  formatDate(dateInput) {
    if (!dateInput) return null;
    try {
      if (typeof dateInput === 'number') return new Date(dateInput);
      if (typeof dateInput === 'string') return new Date(dateInput);
      if (dateInput instanceof Date) return dateInput;
      // Legacy Firestore timestamp format (may still exist in cached data)
      if (dateInput._seconds || dateInput.seconds) {
        return new Date((dateInput._seconds || dateInput.seconds) * 1000);
      }
      return null;
    } catch (error) {
      logger.error('Erro ao formatar data:', { error: error.message });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  static async findOne(conditions) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    let query = supabase
      .from('user_connections')
      .select('*')
      .eq('status', 'active')
      .limit(1);

    if (conditions.userId) {
      query = query.eq('user_id', conditions.userId);
    }
    if (conditions.friendId) {
      query = query.eq('connected_user_id', conditions.friendId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return null;

    return new ActiveConnection({
      id: data.id,
      nome: data.sender_name || 'Desconhecido',
      email: data.sender_email || '',
      fotoDoPerfil: data.sender_photo_url || '',
      status: data.status,
      dataDoAceite: data.data_aceite,
    });
  }

  // ---------------------------------------------------------------------------
  // exists
  // ---------------------------------------------------------------------------
  static async exists(userId, friendId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { count, error } = await supabase
      .from('user_connections')
      .select('id', { count: 'exact', head: true })
      .or(
        `and(user_id.eq.${userId},connected_user_id.eq.${friendId}),` +
        `and(user_id.eq.${friendId},connected_user_id.eq.${userId})`
      )
      .eq('status', 'active');

    if (error) throw error;
    return (count || 0) > 0;
  }

  // ---------------------------------------------------------------------------
  // getConnectionsByUserId
  // ---------------------------------------------------------------------------
  static async getConnectionsByUserId(userId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { data: rows, error } = await supabase
      .from('user_connections')
      .select('*')
      .or(`user_id.eq.${userId},connected_user_id.eq.${userId}`)
      .eq('status', 'active');

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return { friends: [], bestFriends: [] };
    }

    logger.info('Supabase: ActiveConnection.getConnectionsByUserId', { userId, count: rows.length });

    const friends = [];
    const bestFriends = [];
    const seenFriendIds = new Set();

    await Promise.all(
      rows.map(async (row) => {
        try {
          const friendId = row.user_id === userId ? row.connected_user_id : row.user_id;

          // Deduplicar: acceptConnectionRequest cria 2 linhas (A→B e B→A)
          if (seenFriendIds.has(friendId)) return;
          seenFriendIds.add(friendId);

          const isBestFriend = row.is_best_friend === true;

          // Buscar perfil diretamente do Supabase users table
          let profileData = {};
          const { data: sbProfile } = await supabase
            .from('users')
            .select('full_name, username, email, avatar_url, descricao')
            .eq('id', friendId)
            .maybeSingle();

          if (sbProfile) {
            const rawEmail = sbProfile.email || '';
            const resolvedEmail = rawEmail.startsWith('pending_sync_') ? null : rawEmail;
            profileData = {
              nome: sbProfile.full_name || sbProfile.username || (resolvedEmail ? resolvedEmail.split('@')[0] : null),
              email: resolvedEmail,
              fotoDoPerfil: sbProfile.avatar_url || '',
              username: sbProfile.username || null,
              descricao: sbProfile.descricao || '',
            };
          }

          const connection = new ActiveConnection({
            id: friendId,
            nome: profileData.nome || row.sender_name || 'Desconhecido',
            username: profileData.username || null,
            email: profileData.email || row.sender_email || '',
            fotoDoPerfil: profileData.fotoDoPerfil || row.sender_photo_url || '',
            descricao: profileData.descricao || '',
            status: 'active',
            dataDoAceite: row.data_aceite,
          });

          connection.uid = friendId;
          connection.isBestFriend = isBestFriend;
          connection.connectionDate = row.created_at || null;
          connection.connectionType = 'regular';

          if (isBestFriend) {
            bestFriends.push(connection);
          } else {
            friends.push(connection);
          }
        } catch (profileErr) {
          logger.error('ActiveConnection — erro ao enriquecer perfil', {
            friendId: row.user_id === userId ? row.connected_user_id : row.user_id,
            error: profileErr.message,
          });
        }
      })
    );

    return { friends, bestFriends };
  }

  // ---------------------------------------------------------------------------
  // addBestFriend
  // ---------------------------------------------------------------------------
  static async addBestFriend(userId, friendId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { data: existing, error: selectErr } = await supabase
      .from('user_connections')
      .select('id, user_id, connected_user_id, is_best_friend')
      .or(
        `and(user_id.eq.${userId},connected_user_id.eq.${friendId}),` +
        `and(user_id.eq.${friendId},connected_user_id.eq.${userId})`
      )
      .eq('status', 'active');

    if (selectErr) throw selectErr;

    if (!existing || existing.length === 0) {
      throw new Error('Este amigo não é uma conexão ativa.');
    }

    const alreadyBestFriend = existing.some(row => row.is_best_friend === true);
    if (alreadyBestFriend) {
      return 'Este amigo já é um melhor amigo.';
    }

    const ids = existing.map(row => row.id);
    const { error: updateErr } = await supabase
      .from('user_connections')
      .update({ is_best_friend: true, updated_at: new Date().toISOString() })
      .in('id', ids);

    if (updateErr) throw updateErr;

    logger.info('Supabase: ActiveConnection.addBestFriend', { userId, friendId });
    return 'Melhor amigo adicionado com sucesso.';
  }

  // ---------------------------------------------------------------------------
  // removeBestFriend
  // ---------------------------------------------------------------------------
  static async removeBestFriend(userId, friendId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { data: existing, error: selectErr } = await supabase
      .from('user_connections')
      .select('id, user_id, connected_user_id, is_best_friend')
      .or(
        `and(user_id.eq.${userId},connected_user_id.eq.${friendId}),` +
        `and(user_id.eq.${friendId},connected_user_id.eq.${userId})`
      )
      .eq('status', 'active');

    if (selectErr) throw selectErr;

    if (!existing || existing.length === 0) {
      throw new Error('Este amigo não é uma conexão ativa.');
    }

    const isBestFriend = existing.some(row => row.is_best_friend === true);
    if (!isBestFriend) {
      return 'Este amigo já não é um melhor amigo.';
    }

    const ids = existing.map(row => row.id);
    const { error: updateErr } = await supabase
      .from('user_connections')
      .update({ is_best_friend: false, updated_at: new Date().toISOString() })
      .in('id', ids);

    if (updateErr) throw updateErr;

    logger.info('Supabase: ActiveConnection.removeBestFriend', { userId, friendId });
    return 'Melhor amigo removido com sucesso.';
  }

  // ---------------------------------------------------------------------------
  // deleteByUserAndFriend
  // ---------------------------------------------------------------------------
  static async deleteByUserAndFriend(userId, friendId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { error } = await supabase
      .from('user_connections')
      .delete()
      .or(
        `and(user_id.eq.${userId},connected_user_id.eq.${friendId}),` +
        `and(user_id.eq.${friendId},connected_user_id.eq.${userId})`
      )
      .eq('status', 'active');

    if (error) throw error;

    logger.info('Supabase: ActiveConnection.deleteByUserAndFriend', { userId, friendId });
    return { success: true };
  }
}

module.exports = ActiveConnection;
