require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const { sendRegisterOTP, verifyRegisterOTP, sendResetOTP, verifyResetOTP, sendEmailChangeOTP, verifyEmailChangeOTP, cancelDeletion } = require('./controllers/authController');
const { notifyUpload, notifyAssign, notifyUnassignReviewer, notifyReview, notifyDecision, notifyBan, notifyUnban, notifyAccountDeleted, notifyReviewerApproved, notifyReviewerRejected, notifySentForReview, notifyRework, notifyResubmit, notifyPublish, notifyPaperRequest, notifyPaperRequestRejected, notifyPaperDelivery, notifyPaperDeleted, notifyContact, replyContact, notifyReviewerDeclinedAssignment, notifyForceUnassign } = require('./controllers/notifyController');
const { resubmitJournal } = require('./controllers/resubmitController');
const { requireAuth, requireAdmin } = require('./middleware/requireAuth');
// node-cron removed: does not work on serverless platforms. The account deletion cron
// is replaced by a Supabase Scheduled Edge Function (see HOSTING.md for setup).
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── Shared Storage Helpers ──────────────────────────────────────────
// Extract a bare storage path from either a full Supabase URL or an already-bare path.
// Returns null if the URL is falsy or does not contain a recognisable /journals/ segment.
function extractStoragePath(url) {
  if (!url) return null;
  // New records store a bare path (e.g. uuid/timestamp_file.pdf)
  if (!url.startsWith('http')) return url.split('?')[0];
  // Legacy records stored full Supabase URLs — strip down to just the path
  try {
    const parts = url.split('/journals/');
    if (parts.length > 1) return parts[1].split('?')[0];
    return null;
  } catch { return null; }
}

// Remove an array of storage paths from the 'journals' bucket.
// Logs but does NOT throw on storage failure — a missing file is an orphan,
// not a reason to surface a 500 to the caller when the DB record is already gone.
async function removeStorageFiles(paths) {
  if (!paths || paths.length === 0) return;
  const { error } = await supabase.storage.from('journals').remove(paths);
  if (error) console.error('Storage Deletion Error (Orphaned File):', error);
}


const app = express();

// Trust the first proxy hop (Cloudflare / load balancer) so that
// express-rate-limit uses the real client IP from X-Forwarded-For
// instead of the proxy's IP, which would make per-IP limiting useless.
app.set('trust proxy', 1);

// Secure HTTP Headers (API server returns JSON)
app.use(helmet({
  contentSecurityPolicy: false,
  // Prevent browsers from sniffing MIME type
  noSniff: true,
  // Enforce HTTPS for 1 year
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  // Prevent clickjacking
  frameguard: { action: 'deny' },
  // Disable X-Powered-By
  hidePoweredBy: true,
}));

// Secure CORS configuration
const envOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(u => u.trim().replace(/\/$/, ''))
  .filter(Boolean);

const devOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const allowedOrigins = process.env.NODE_ENV === 'production' && envOrigins.length > 0
  ? envOrigins
  : [...new Set([...envOrigins, ...devOrigins])];

app.use(cors({
  origin: (origin, callback) => {
    // SEC-011: In production, deny requests with no Origin header.
    // A missing Origin is acceptable for health checks but not for general API calls.
    // Server-to-server callers should set a shared secret instead.
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        // Allow health-check path without origin; block everything else
        return callback(null, false);
      }
      // In development, allow no-origin (curl, Postman, etc.)
      return callback(null, true);
    }
    
    const normalizedOrigin = origin.replace(/\/$/, '');
    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    
    const err = new Error('CORS Policy: Origin not allowed');
    err.status = 403;
    return callback(err, false);
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// CORS error handler — must come immediately after the cors() middleware.
// Without this, Express' generic handler would return 500 for rejected origins.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status === 403) {
    return res.status(403).json({ error: 'CORS: Origin not allowed' });
  }
  next(err);
});

app.use(express.json({ limit: '1mb' }));

// Health Check Endpoint (Required for Cloudflare Workers / uptime monitors)
app.get('/health', async (req, res) => {
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1);
    if (error) throw error;
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (err) {
    console.error('Health Check DB error:', err.message);
    res.status(503).json({ status: 'degraded', database: 'disconnected' });
  }
});

// Rate limiter for OTP & public endpoints to prevent brute force & spam
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15, // Limit each IP to 15 requests per 10-minute window
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter to prevent bot floods on authenticated routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // Limit each IP to 150 requests per 15-minute window
  message: { error: 'Too many API requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// SEC-008: Dedicated tight limiter for view-count metrics — prevents artificial inflation / DoS
const metricsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 view pings per IP per minute (legitimate browsing never exceeds this)
  message: { error: 'Too many view requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiters
app.use('/api', apiLimiter);
app.use('/api/auth', otpLimiter);

// Auth Routes (Custom OTP via Nodemailer)
app.post('/api/auth/register-otp', sendRegisterOTP);
app.post('/api/auth/verify-register', verifyRegisterOTP);
app.post('/api/auth/reset-otp', sendResetOTP);
app.post('/api/auth/verify-reset', verifyResetOTP);
// Protected Auth Routes
app.post('/api/auth/email-change-otp', requireAuth, sendEmailChangeOTP);
app.post('/api/auth/verify-email-change', requireAuth, verifyEmailChangeOTP);
app.post('/api/auth/cancel-deletion', requireAuth, cancelDeletion);

// Public Notification Routes (Rate limited)
app.post('/api/notify/paper-request', otpLimiter, notifyPaperRequest);
app.post('/api/notify/contact', otpLimiter, notifyContact);

// Metrics Route (SEC-008: add metricsLimiter + only allow published paper IDs)
app.post('/api/metrics/paper-view/:id', metricsLimiter, async (req, res) => {
  try {
    const journalId = req.params.id;
    if (!journalId || typeof journalId !== 'string') {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }

    // SEC-008: Verify the paper is actually published before incrementing — prevents
    // DoS with random UUIDs and metric stuffing on non-public papers.
    const { data: check } = await supabase
      .from('journals')
      .select('id')
      .eq('id', journalId)
      .eq('status', 'published')
      .maybeSingle();

    if (!check) {
      // Return 200 silently — don't reveal whether the ID exists (enumeration)
      return res.status(200).json({ success: true });
    }

    const { error } = await supabase.rpc('increment_paper_views', { p_journal_id: journalId });
    if (error) {
      console.error('increment_paper_views RPC error:', error.message);
      // Don't expose internal error details
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error incrementing paper view:', err);
    res.status(500).json({ error: 'Failed to record paper view' });
  }
});

// Notification Routes (Protected)
app.use('/api/notify', requireAuth);

// Admin-only notification routes
app.post('/api/notify/assign', requireAdmin, notifyAssign);
app.post('/api/notify/unassign-reviewer', requireAdmin, notifyUnassignReviewer);
app.post('/api/notify/decision', requireAdmin, notifyDecision);
app.post('/api/notify/ban', requireAdmin, notifyBan);
app.post('/api/notify/unban', requireAdmin, notifyUnban);
app.post('/api/notify/reviewer-approved', requireAdmin, notifyReviewerApproved);
app.post('/api/notify/reviewer-rejected', requireAdmin, notifyReviewerRejected);
app.post('/api/notify/sent-for-review', requireAdmin, notifySentForReview);
app.post('/api/notify/rework', requireAdmin, notifyRework);
app.post('/api/notify/publish', requireAdmin, notifyPublish);
app.post('/api/notify/paper-request-rejected', requireAdmin, notifyPaperRequestRejected);
app.post('/api/notify/paper-delivery', requireAdmin, notifyPaperDelivery);
app.post('/api/notify/paper-deleted', requireAdmin, notifyPaperDeleted);
// delete-account moved here: admin-only because only admin triggers this notification
app.post('/api/notify/delete-account', requireAdmin, notifyAccountDeleted);
app.post('/api/notify/force-unassign', requireAdmin, notifyForceUnassign);
app.post('/api/notify/reply-contact', requireAdmin, replyContact);

// Authenticated-user notification routes (auth + rate-limited to prevent email spam)
app.post('/api/notify/upload', requireAuth, otpLimiter, notifyUpload);
app.post('/api/notify/review', requireAuth, otpLimiter, notifyReview);
app.post('/api/notify/resubmit', requireAuth, otpLimiter, notifyResubmit);
app.post('/api/notify/reject-assignment', requireAuth, otpLimiter, notifyReviewerDeclinedAssignment);

// Secure Student Actions (require auth but performed by the student themselves)
app.post('/api/student/resubmit', requireAuth, resubmitJournal);

// Secure Admin Deletion Route
app.post('/api/admin/journals/:id/delete', requireAuth, requireAdmin, async (req, res) => {
  try {
    const journalId = req.params.id;

    // 1. Fetch only the actual storage-path columns — NOT abstract (which is plain text, not a file path)
    const { data: journal } = await supabase
      .from('journals')
      .select('file_url, revision_report_url, approval_proof_url')
      .eq('id', journalId)
      .single();
    if (!journal) {
      return res.status(404).json({ error: 'Journal not found' });
    }

    // 2. Extract and validate storage paths — only storage paths, never plain-text fields
    const filesToRemove = [
      extractStoragePath(journal.file_url),
      extractStoragePath(journal.revision_report_url),
      extractStoragePath(journal.approval_proof_url),
    ].filter(Boolean);

    // 3. Delete the Database Record (Service Role bypasses RLS)
    // SECURITY/DATA-CONSISTENCY: Delete DB record FIRST. If this fails, the file remains intact.
    // If DB deletion succeeds but storage fails, we leave an orphaned file (which is harmless)
    // rather than breaking the UI with a ghost database record pointing to a missing file.
    const { error: dbError } = await supabase.from('journals').delete().eq('id', journalId);
    if (dbError) throw dbError;

    await removeStorageFiles(filesToRemove);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Secure Delete Journal Error:', err);
    res.status(500).json({ error: 'Failed to delete journal' });
  }
});

// Secure Student Deletion Route
app.post('/api/student/journals/:id/delete', requireAuth, async (req, res) => {
  try {
    const journalId = req.params.id;
    const userId = req.user.id;

    // 1. Fetch only the actual storage-path columns — NOT abstract (which is plain text, not a file path)
    const { data: journal, error: fetchError } = await supabase
      .from('journals')
      .select('student_id, status, file_url')
      .eq('id', journalId)
      .single();

    if (fetchError || !journal) {
      return res.status(404).json({ error: 'Journal not found' });
    }

    if (journal.student_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this paper' });
    }

    if (journal.status !== 'pending' && journal.status !== 'submitted') {
      return res.status(400).json({ error: 'Cannot delete paper after it has been sent for review' });
    }

    // 2. Extract storage path and enforce strict ownership boundary.
    // Students may ONLY delete files inside their own UID folder.
    // This prevents the service-role from being weaponised against other users' files
    // even if file_url were somehow forged in the DB prior to the trigger fix.
    const filePath = extractStoragePath(journal.file_url);
    const filesToRemove = [];

    // SECURITY: Only delete if the path provably belongs to this user.
    // If the path doesn't start with the user's UID, refuse and log — do NOT delete.
    if (filePath) {
      if (!filePath.startsWith(userId + '/')) {
        console.error(`SECURITY: student ${userId} attempted to delete out-of-bound path: ${filePath}`);
        return res.status(403).json({ error: 'Forbidden: file path does not belong to you' });
      }
      filesToRemove.push(filePath);
    }

    // 3. Delete the Database Record (Service Role bypasses RLS)
    // SECURITY/DATA-CONSISTENCY: Delete DB record FIRST.
    const { error: dbError } = await supabase.from('journals').delete().eq('id', journalId);
    if (dbError) throw dbError;

    await removeStorageFiles(filesToRemove);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Secure Student Delete Journal Error:', err);
    res.status(500).json({ error: 'Failed to delete journal' });
  }
});

// Global Error Handler to prevent stack trace leaks
// SEC-009: Sentry import removed — @sentry/node is not installed.
// If you add Sentry in future: npm install @sentry/node and uncomment.
// if (process.env.SENTRY_DSN) {
//   const Sentry = require('@sentry/node');
//   Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
//   Sentry.setupExpressErrorHandler(app);
// }

app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack || err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Export Express app for tests, Workers, and local development
module.exports = app;

// Start local/persistent server only when invoked directly (node index.js)
// When imported by worker.mjs or test suites, require.main !== module so
// the importer controls server binding.
if (require.main === module && process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3001;

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Email & Auth Server running on port ${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Error: Port ${PORT} is ALREADY IN USE by another process!`);
      console.error(`   The backend server is already running in the background.`);
      console.error(`   If you want to restart it, kill the existing process on port ${PORT} first.\n`);
    } else {
      console.error('Server Error:', err);
    }
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server...');
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });

  // SEC-C: Handle Ctrl-C / container stop (SIGINT) the same way as SIGTERM
  process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server...');
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
