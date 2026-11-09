import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';
import { AuthLayout } from '../components/layout/AuthLayout';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { supabase } from '../lib/supabase';

const handleForgotPassword = (email, navigate) => {
  navigate('/forgot-password', email ? { state: { prefillEmail: email } } : {});
};

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { signIn } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { user: authUser } = await signIn(form.email, form.password);
      const { data: profileData, error: profileError } = await supabase
        .from('profiles').select('name, role, status').eq('id', authUser.id).single();
      if (profileError) throw profileError;

      if (profileData.status === 'pending') {
        await supabase.auth.signOut();
        navigate('/pending-approval', { state: { name: profileData.name } });
        return;
      }
      if (profileData.status === 'suspended' || profileData.status === 'inactive') {
        await supabase.auth.signOut();
        toast.error('Your account has been suspended or deactivated. Please contact support for assistance.');
        setLoading(false);
        return;
      }

      toast.success('Welcome back!');
      if (profileData.role === 'admin') navigate('/admin/dashboard', { replace: true });
      else if (profileData.role === 'reviewer') navigate('/reviewer/dashboard', { replace: true });
      else navigate('/student/dashboard', { replace: true });
    } catch (err) {
      await supabase.auth.signOut().catch(() => {});
      toast.error(err.message || 'Login failed. Please check your credentials.');
    }
    setLoading(false);
  };

  return (
    <AuthLayout>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <div style={{ marginBottom: '2.5rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--foreground)', letterSpacing: '-0.02em' }}>Welcome back</h2>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '1rem' }}>Sign in to your account to continue</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="form-group">
            <label htmlFor="login-email" style={{ fontWeight: 600, fontSize: '0.9rem' }}>Email address</label>
            <input 
              id="login-email" type="email" autoComplete="email" className="input" 
              placeholder="name@example.com" 
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} 
              style={{ padding: '0.875rem 1rem', fontSize: '1rem', borderRadius: 'calc(var(--radius) * 0.75)' }}
              required 
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="login-password" style={{ fontWeight: 600, fontSize: '0.9rem' }}>Password</label>
              <button
                type="button"
                onClick={() => handleForgotPassword(form.email.trim(), navigate)}
                style={{ fontSize: '0.85rem', color: 'var(--primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 500 }}
              >
                Forgot password?
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input 
                id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" className="input" 
                placeholder="••••••••" 
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} 
                style={{ padding: '0.875rem 3rem 0.875rem 1rem', fontSize: '1rem', borderRadius: 'calc(var(--radius) * 0.75)' }}
                required 
              />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', display: 'flex' }}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <motion.button
            type="submit" disabled={loading}
            whileHover={!loading ? { scale: 1.01 } : {}}
            whileTap={!loading ? { scale: 0.98 } : {}}
            className="btn"
            style={{ 
              marginTop: '1rem',
              width: '100%', padding: '0.875rem', fontWeight: 600, fontSize: '1rem', 
              background: 'linear-gradient(135deg, var(--primary), var(--gold))', 
              color: '#fff', border: 'none', 
              boxShadow: '0 8px 24px rgba(29, 78, 216, 0.25), inset 0 1px 1px rgba(255,255,255,0.2)', 
              borderRadius: 'calc(var(--radius) * 0.75)' 
            }}
          >
            {loading ? <><div className="spinner-sm" /> Signing in…</> : 'Sign In'}
          </motion.button>
        </form>

        <div style={{ marginTop: '2.5rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--muted-foreground)' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>Create one now</Link>
        </div>
      </motion.div>
    </AuthLayout>
  );
}
