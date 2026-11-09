const { supabase } = require('../utils/supabase');
require('dotenv').config();

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify the JWT token using Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Ensure the user account is active (blocks banned/deleted users from using valid JWTs)
    const { data: profile } = await supabase
      .from('profiles')
      .select('status')
      .eq('id', user.id)
      .single();

    if (!profile || profile.status === 'inactive') {
      return res.status(403).json({ error: 'Forbidden: Account is inactive or banned' });
    }
    if (profile.status === 'pending') {
      return res.status(403).json({ error: 'Forbidden: Account is pending approval' });
    }

    // Attach the user to the request object
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth Middleware Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', req.user.id)
      .single();

    if (error || !profile || profile.role !== 'admin' || profile.status !== 'active') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
  } catch (err) {
    console.error('Admin Middleware Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = { requireAuth, requireAdmin };

