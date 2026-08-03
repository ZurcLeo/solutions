const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

class SessionService {
  /**
   * Create a session record when user logs in
   */
  async createSession(userId, refreshToken, deviceInfo = {}) {
    const supabase = getSupabaseClient();
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const browser = deviceInfo.browser || null;
    const os = deviceInfo.os || null;
    const deviceType = deviceInfo.deviceType || 'desktop';

    // Deduplicação: buscar sessão ativa para o mesmo user+browser+os+deviceType
    // Reutiliza a sessão existente ao invés de criar centenas de duplicatas
    if (browser && os) {
      const { data: existing } = await supabase
        .from('user_sessions')
        .select('id')
        .eq('user_id', userId)
        .eq('browser', browser)
        .eq('os', os)
        .eq('device_type', deviceType)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('last_active_at', { ascending: false })
        .limit(1)
        .single();

      if (existing) {
        // Atualiza a sessão existente com o novo token e renova expiração
        const { error: updateErr } = await supabase
          .from('user_sessions')
          .update({
            refresh_token_hash: tokenHash,
            ip_address: deviceInfo.ipAddress || null,
            last_active_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .eq('id', existing.id);

        if (!updateErr) {
          logger.info('[SessionService] Sessão reutilizada (dedup)', { userId, sessionId: existing.id });
          return existing.id;
        }
        // Se falhar o update, cai no insert abaixo
      }
    }

    const session = {
      user_id: userId,
      refresh_token_hash: tokenHash,
      device_name: deviceInfo.deviceName || 'Dispositivo desconhecido',
      device_type: deviceType,
      browser,
      os,
      ip_address: deviceInfo.ipAddress || null,
      city: deviceInfo.city || null,
      country: deviceInfo.country || null,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
    };

    const { data, error } = await supabase
      .from('user_sessions')
      .insert(session)
      .select('id')
      .single();

    if (error) {
      logger.error('[SessionService] createSession error:', { userId, error: error.message });
      return null;
    }
    return data?.id;
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_sessions')
      .select('id, device_name, device_type, browser, os, ip_address, city, country, created_at, last_active_at, is_current')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('last_active_at', { ascending: false });

    if (error) {
      logger.error('[SessionService] getUserSessions error:', { userId, error: error.message });
      throw error;
    }

    return data || [];
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(userId, sessionId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .select('refresh_token_hash')
      .single();

    if (error) {
      logger.error('[SessionService] revokeSession error:', { userId, sessionId, error: error.message });
      throw error;
    }
    return data;
  }

  /**
   * Revoke all sessions except current
   */
  async revokeAllOtherSessions(userId, currentSessionId) {
    const supabase = getSupabaseClient();

    let query = supabase
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (currentSessionId) {
      query = query.neq('id', currentSessionId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('[SessionService] revokeAllOtherSessions error:', { userId, error: error.message });
      throw error;
    }
    return data;
  }

  /**
   * Update last_active_at for a session (called on token refresh)
   */
  async touchSession(refreshTokenHash) {
    const supabase = getSupabaseClient();
    await supabase
      .from('user_sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('refresh_token_hash', refreshTokenHash)
      .is('revoked_at', null);
  }

  /**
   * Mark a session as the current one (set is_current = true, others false)
   */
  async markCurrentSession(userId, sessionId) {
    const supabase = getSupabaseClient();

    // Reset all is_current flags for this user
    await supabase
      .from('user_sessions')
      .update({ is_current: false })
      .eq('user_id', userId);

    // Set the specific session as current
    await supabase
      .from('user_sessions')
      .update({ is_current: true })
      .eq('id', sessionId)
      .eq('user_id', userId);
  }

  /**
   * Check if a session is still valid (not revoked)
   */
  async isSessionValid(refreshTokenHash) {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('user_sessions')
      .select('id')
      .eq('refresh_token_hash', refreshTokenHash)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    return !!data;
  }

  /**
   * Parse User-Agent into device info
   */
  parseUserAgent(userAgent = '', ip = '') {
    const info = {
      deviceName: 'Dispositivo desconhecido',
      deviceType: 'desktop',
      browser: null,
      os: null,
      ipAddress: ip
    };

    // OS detection
    if (/iPhone|iPad/.test(userAgent)) {
      info.os = 'iOS';
      info.deviceType = /iPad/.test(userAgent) ? 'tablet' : 'mobile';
    } else if (/Android/.test(userAgent)) {
      info.os = 'Android';
      info.deviceType = /Mobile/.test(userAgent) ? 'mobile' : 'tablet';
    } else if (/Windows/.test(userAgent)) {
      info.os = 'Windows';
    } else if (/Mac OS/.test(userAgent)) {
      info.os = 'macOS';
    } else if (/Linux/.test(userAgent)) {
      info.os = 'Linux';
    }

    // Browser detection
    if (/Chrome\/\d+/.test(userAgent) && !/Edg/.test(userAgent)) {
      info.browser = 'Chrome ' + (userAgent.match(/Chrome\/(\d+)/)?.[1] || '');
    } else if (/Safari\/\d+/.test(userAgent) && !/Chrome/.test(userAgent)) {
      info.browser = 'Safari';
    } else if (/Firefox\/\d+/.test(userAgent)) {
      info.browser = 'Firefox ' + (userAgent.match(/Firefox\/(\d+)/)?.[1] || '');
    } else if (/Edg\/\d+/.test(userAgent)) {
      info.browser = 'Edge ' + (userAgent.match(/Edg\/(\d+)/)?.[1] || '');
    }

    // Build device name
    if (info.browser && info.os) {
      info.deviceName = `${info.browser} no ${info.os}`;
    } else if (info.browser) {
      info.deviceName = info.browser;
    } else if (info.os) {
      info.deviceName = info.os;
    }

    return info;
  }
}

module.exports = new SessionService();
