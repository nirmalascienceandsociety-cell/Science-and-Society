import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { BookOpen, Home, Eye, EyeOff, Mail, ShieldCheck, KeyRound } from 'lucide-react'
import { API_BASE } from '../lib/api'


export default function ForgotPassword() {
  const navigate  = useNavigate()
  const location  = useLocation()

  // If Login passed an email via router state, capture it
  const prefillEmail = location.state?.prefillEmail ?? ''

  // Steps: 'email' → 'otp-sending' → 'reset' → 'success'
  const [step, setStep] = useState(prefillEmail ? 'otp-sending' : 'email')

  const [email,       setEmail]       = useState(prefillEmail)
  const [otpInput,    setOtpInput]    = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [passwordError, setPasswordError] = useState('')

  /* ── Core OTP sender (shared by auto-send and manual submit) ──── */

  const sendOtp = useCallback(async (emailToSend) => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToSend })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP')
      setStep('reset')
    } catch (err) {
      if (err.name === 'TypeError' && err.message?.includes('fetch')) {
        setError('Unable to reach the server. Please try again shortly.')
      } else {
        setError(err.message || 'Something went wrong. Please try again.')
      }
      // Fall back to the email entry step so the user can correct the address
      setStep('email')
    }
    setLoading(false)
  }, [])

  /* ── Auto-send OTP when prefilled email is present ──────────── */

  useEffect(() => {
    if (prefillEmail && step === 'otp-sending') {
      sendOtp(prefillEmail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount

  /* ── Step 1 – Manual email form submit ──────────────────────── */

  const handleSendOtp = (e) => {
    e.preventDefault()
    sendOtp(email.trim())
  }

  /* ── Step 2 – Verify OTP & update password ──────────────────── */

  const validatePassword = (pwd) => {
    if (pwd.length < 8)        return 'Password must be at least 8 characters.'
    if (!/[0-9]/.test(pwd))    return 'Password must contain at least one number.'
    if (!/[A-Z]/.test(pwd))    return 'Password must contain at least one uppercase letter.'
    return ''
  }

  const handleUpdatePassword = async (e) => {
    e.preventDefault()
    setError('')
    setPasswordError('')

    const valErr = validatePassword(newPassword)
    if (valErr) { setPasswordError(valErr); return }

    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otpInput, newPassword })
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update password')
      }
      setStep('success')
      setTimeout(() => navigate('/login', { replace: true }), 3000)
    } catch (err) {
      if (err.name === 'TypeError' && err.message?.includes('fetch')) {
        setError('Unable to reach the server. Please try again shortly.')
      } else {
        setError(err.message || 'Failed to update password. Your OTP may have expired.')
      }
    }
    setLoading(false)
  }

  /* ── Step indicator ──────────────────────────────────────────── */

  const renderStepIndicator = () => {
    const steps = [
      { key: 'email',  label: 'Email',  icon: <Mail      size={14} /> },
      { key: 'reset',  label: 'Reset',  icon: <KeyRound  size={14} /> },
    ]
    const currentIdx = steps.findIndex(s =>
      step === 'otp-sending' ? s.key === 'email' : s.key === step
    )
    return (
      <div className="fp-steps">
        {steps.map((s, i) => (
          <div key={s.key} className={`fp-step-item ${i <= currentIdx ? 'active' : ''} ${i < currentIdx ? 'done' : ''}`}>
            <div className="fp-step-dot">{s.icon}</div>
            <span className="fp-step-label">{s.label}</span>
            {i < steps.length - 1 && <div className="fp-step-line" />}
          </div>
        ))}
      </div>
    )
  }

  /* ── Render ──────────────────────────────────────────────────── */

  const cardTitle = step === 'success' ? 'All Done!' : 'Reset Password'
  const cardDesc  = {
    'email':       'Enter your email to receive a one-time password.',
    'otp-sending': `Sending OTP to ${email}…`,
    'reset':       'Enter the OTP sent to your email and choose a new password.',
    'success':     'Your password has been updated.',
  }[step]

  return (
    <div className="auth-page login-page-override">
      {/* Top bar */}
      <div className="login-topbar">
        <div className="login-topbar-brand">
          <BookOpen size={24} />
          <span style={{ fontWeight: 600, fontSize: '1.125rem' }}>Science and Society</span>
        </div>
        <Link to="/" aria-label="Home" className="login-topbar-home">
          <Home size={20} />
        </Link>
      </div>

      <div className="auth-wrapper login-wrapper-override">
        <div className="auth-card card">
          <div className="auth-card-header">
            <div className="auth-card-title">{cardTitle}</div>
            <div className="auth-card-desc">{cardDesc}</div>

            {step !== 'success' && (
              <div style={{ marginTop: '1.25rem' }}>{renderStepIndicator()}</div>
            )}
          </div>

          <div className="auth-card-body">
            {/* Error banner */}
            {error && (
              <div className="fp-error-banner">{error}</div>
            )}

            {/* ── Sending OTP automatically (prefill flow) ── */}
            {step === 'otp-sending' && (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <span className="fp-spinner" style={{ display: 'inline-block', marginBottom: '0.75rem' }} />
                <p style={{ color: 'var(--muted-foreground)', fontSize: '0.95rem' }}>
                  Sending OTP to <strong>{email}</strong>…
                </p>
              </div>
            )}

            {/* ── Step: Email ── */}
            {step === 'email' && (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="form-group">
                  <label htmlFor="fp-email">Email address</label>
                  <input
                    id="fp-email"
                    type="email"
                    className="input"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError('') }}
                    required
                    autoFocus
                  />
                </div>

                <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                  {loading ? (
                    <span className="fp-btn-loading"><span className="fp-spinner" /> Sending…</span>
                  ) : (
                    'Send OTP'
                  )}
                </button>
              </form>
            )}

            {/* ── Step: Reset (OTP + New Password) ── */}
            {step === 'reset' && (
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="fp-success-banner">
                  OTP sent to <strong>{email}</strong>! Check your inbox and spam folder.
                </div>

                <div className="form-group">
                  <label htmlFor="fp-otp">One-Time Password</label>
                  <input
                    id="fp-otp"
                    type="text"
                    className="input"
                    placeholder="Enter the 6-digit OTP"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    autoComplete="one-time-code"
                    required
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="fp-password">New Password</label>
                  <div className="password-wrapper">
                    <input
                      id="fp-password"
                      type={showPassword ? 'text' : 'password'}
                      className="input"
                      placeholder="Minimum 8 characters"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setPasswordError('') }}
                      style={{ paddingRight: '2.5rem' }}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(v => !v)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {passwordError && (
                    <span className="fp-field-error">{passwordError}</span>
                  )}
                  <ul className="fp-pw-rules">
                    <li className={newPassword.length >= 8 ? 'met' : ''}>At least 8 characters</li>
                    <li className={/[0-9]/.test(newPassword) ? 'met' : ''}>At least one number</li>
                    <li className={/[A-Z]/.test(newPassword) ? 'met' : ''}>At least one uppercase letter</li>
                  </ul>
                </div>

                <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                  {loading ? (
                    <span className="fp-btn-loading"><span className="fp-spinner" /> Updating password…</span>
                  ) : (
                    'Verify & Update Password'
                  )}
                </button>

                <button
                  type="button"
                  className="btn btn-outline w-full"
                  style={{ marginTop: '0.5rem' }}
                  disabled={loading}
                  onClick={() => { setStep('email'); setError(''); setOtpInput('') }}
                >
                  Wrong email / Resend OTP
                </button>
              </form>
            )}

            {/* ── Step: Success ── */}
            {step === 'success' && (
              <div className="fp-success-final">
                <div className="fp-success-icon">
                  <ShieldCheck size={40} />
                </div>
                <p className="fp-success-text">
                  Password updated successfully! Redirecting to login…
                </p>
                <div className="fp-progress-bar"><div className="fp-progress-fill" /></div>
              </div>
            )}
          </div>

          {(step === 'email' || step === 'otp-sending') && (
            <div className="auth-card-footer">
              Remember your password?{' '}
              <Link to="/login" className="auth-link">Sign in</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
