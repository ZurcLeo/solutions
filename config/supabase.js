const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { logger } = require('../logger');

// Node.js < 22 compatibility for Supabase Realtime
if (!global.WebSocket) {
  global.WebSocket = WebSocket;
}

let supabase = null;

/**
 * Obtém o cliente Supabase (Singleton)
 */
function getSupabaseClient() {
  if (supabase) return supabase;
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    logger.warn('Supabase credentials missing (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)');
    return null;
  }

  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { fetch: require('node-fetch') },
      realtime: { websocket: WebSocket }
    });
    return supabase;
  } catch (err) {
    logger.error('Falha ao inicializar cliente Supabase', { error: err.message });
    return null;
  }
}

module.exports = { getSupabaseClient };
