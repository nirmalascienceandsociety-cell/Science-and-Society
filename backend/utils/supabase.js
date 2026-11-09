'use strict';

const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;

/**
 * Lazy Supabase client factory.
 * Prevents "supabaseUrl is required" or "supabaseKey is required" crashes
 * during Cloudflare Workers script upload and top-level module evaluation.
 */
function getSupabase() {
  const url = process.env.SUPABASE_URL || 'https://gmcenokgsyicwarkicjs.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-worker-initialization';

  if (!cachedClient || cachedClient._url !== url || cachedClient._key !== key) {
    cachedClient = createClient(url, key);
    cachedClient._url = url;
    cachedClient._key = key;
  }
  return cachedClient;
}

// Proxy allows `supabase.from(...)`, `supabase.auth...`, etc. without requiring
// eager initialization at module load time.
const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getSupabase();
    const val = client[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  }
});

module.exports = { supabase, getSupabase };
