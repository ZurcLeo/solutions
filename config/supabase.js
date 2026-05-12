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
  // Service role key bypasses RLS (preferred for backend).
  // Falls back to anon/publishable key when running without service role (requires RLS disabled on QA tables).
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    logger.warn('Supabase credentials missing — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
    return null;
  }

  const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon';
  logger.info(`Supabase: conectando com chave ${keyType}`, { url: supabaseUrl });

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
