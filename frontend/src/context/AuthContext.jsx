/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { API_BASE, sendNotification } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(false)

  useEffect(() => {
    // Get the current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
      }
    }).catch((err) => {
      console.error('AuthContext: failed to get session:', err)
      setLoading(false)
    })

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setProfileError(false)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email, role, status, is_permanent, deletion_scheduled_at')
      .eq('id', userId)
      .single()

    if (!data) {
      // SEC-021: Track if profile load failed (e.g. DB down, row missing)
      setProfileError(true)
    } else {
      setProfileError(false)
      if (data?.deletion_scheduled_at) {
        try {
          // Auto-cancel deletion because the user logged back in within the grace period
          const res = await sendNotification('/api/auth/cancel-deletion', {});
          if (!res || !res.ok) {
            console.error('Failed to auto-cancel deletion: session expired or server error', res?.status);
          } else {
            data.deletion_scheduled_at = null;
            // Store a flag — the app will display a welcome-back message on load
            localStorage.setItem('account_restored', '1');
          }
        } catch (err) {
          console.error('Failed to auto-cancel deletion exception:', err);
        }
      }
      setProfile(data)
    }
    
    setLoading(false)
  }


  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function requestRegisterOTP(email, role) {
    const res = await fetch(`${API_BASE}/api/auth/register-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role })
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Failed to send OTP')
    }
  }

  async function verifyRegisterOTP(email, otp, password, name, role) {
    const res = await fetch(`${API_BASE}/api/auth/verify-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, password, name, role })
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Failed to verify OTP')
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const value = { user, profile, loading, profileError, signIn, requestRegisterOTP, verifyRegisterOTP, signOut }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
