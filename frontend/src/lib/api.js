// Central API base URL - reads from environment variable so it works in both dev and production.
const _configuredUrl = import.meta.env.VITE_API_URL;
if (import.meta.env.PROD && !_configuredUrl) {
  // SEC-001: Fail closed. Do not silently fall back to localhost in production.
  // This prevents the app from sending sensitive Bearer tokens to a local service on port 3001.
  throw new Error('CRITICAL: VITE_API_URL must be set in production.');
}
if (import.meta.env.PROD && !_configuredUrl.startsWith('https://')) {
  throw new Error('CRITICAL: VITE_API_URL must use HTTPS in production.');
}
// In development, if VITE_API_URL points to local server or is not explicitly external,
// default to relative path ('') to utilize Vite's dev proxy and avoid CORS/browser port blocking.
export const API_BASE = (import.meta.env.DEV && (!_configuredUrl || _configuredUrl.includes('localhost') || _configuredUrl.includes('127.0.0.1')))
  ? ''
  : (_configuredUrl || 'http://localhost:3001');

import { supabase } from './supabase';

export async function sendNotification(endpoint, body) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    
    return await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('Notification Error:', err);
    return null;
  }
}
