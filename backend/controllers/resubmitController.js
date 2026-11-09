const { supabase } = require('../utils/supabase');
const { sendMail } = require('../utils/mailer');
const { generateReworkResubmittedNotification, escHtml } = require('../utils/emailTemplates');

const notifyAdminsInApp = async (title, message, link) => {
  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
  if (admins && admins.length > 0) {
    const records = admins.map(a => ({ user_id: a.id, title, message, link }));
    await supabase.from('notifications').insert(records);
  }
};

// esc is the canonical HTML-escape helper — imported from emailTemplates.js.
const esc = escHtml;


/**
 * POST /api/student/resubmit
 * Securely handles a student resubmitting a reworked manuscript.
 * Uses service role to bypass RLS — all authorization checks done here.
 */
exports.resubmitJournal = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const {
      journalId,
      title,
      abstract,
      keywords,
      fileUrl,
      prevAdminComments,
      prevRevisionReportUrl,
      prevReviewerComments,
      prevReviewerName,
      resubmissionCount,
      studentName,
    } = req.body;

    if (!journalId || !title || !abstract || !fileUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (title.length > 255) return res.status(400).json({ error: 'Title is too long (max 255 characters)' });
    if (abstract.length > 5000) return res.status(400).json({ error: 'Abstract is too long (max 5000 characters)' });
    // M-3: Require non-empty keywords — the column is NOT NULL and an empty string produces a broken keyword badge on the UI.
    if (!keywords || !keywords.trim()) return res.status(400).json({ error: 'Keywords are required' });
    if (keywords.length > 500) return res.status(400).json({ error: 'Keywords are too long (max 500 characters)' });

    // 1. Verify the caller actually owns this journal
    const { data: journal, error: fetchErr } = await supabase
      .from('journals')
      .select('id, student_id, status, title, resubmission_count, admin_comments, revision_report_url')
      .eq('id', journalId)
      .single();

    if (fetchErr || !journal) {
      return res.status(404).json({ error: 'Journal not found' });
    }
    if (journal.student_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this journal' });
    }
    // Only allow resubmission when the paper is in a rework state
    const allowedStatuses = ['revision_required', 'rework'];
    if (!allowedStatuses.includes(journal.status)) {
      return res.status(400).json({ error: 'Journal is not in a resubmittable state' });
    }

    // SECURITY: Enforce that the new file_url belongs strictly to this student's
    // own storage folder (e.g. {userId}/timestamp_file.pdf).
    // The DB trigger enforce_journal_file_url_ownership() explicitly bypasses for
    // service_role callers, so this backend check is the only enforcement layer here.
    if (!fileUrl || !fileUrl.startsWith(userId + '/')) {
      console.error(`SECURITY: student ${userId} attempted resubmit with out-of-bound fileUrl: ${fileUrl}`);
      return res.status(403).json({ error: 'Forbidden: fileUrl must be in your own storage folder' });
    }

    // SECURITY: Fetch the latest review securely from DB before deleting it.
    // Do NOT trust the client payload for these historical fields.
    const { data: latestReview } = await supabase
      .from('reviews')
      .select('comments, profiles(name)')
      .eq('journal_id', journalId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const dbPrevReviewerComments = latestReview ? latestReview.comments : null;
    const dbPrevReviewerName = latestReview?.profiles ? latestReview.profiles.name : null;

    // 2. Delete old reviews (service role bypasses reviewer-only delete RLS)
    await supabase.from('reviews').delete().eq('journal_id', journalId);

    // 3. Delete old assignments (service role bypasses admin-only delete RLS)
    await supabase.from('assignments').delete().eq('journal_id', journalId);

    // 4. Update the journal — service role bypasses the student-update block
    const updatePayload = {
      title,
      abstract,
      keywords,
      file_url: fileUrl,
      status: 'submitted',
      review_level: 0,
      resubmission_count: (journal.resubmission_count || 0) + 1,
      // SECURITY: Use the verified DB values, ignoring the client payload
      prev_admin_comments: journal.admin_comments || null,
      prev_revision_report_url: journal.revision_report_url || null,
      prev_reviewer_comments: dbPrevReviewerComments,
      admin_comments: null,
      revision_report_url: null,
      approval_proof_url: null,
    };

    // Always include prev_reviewer_name, we handle the column-missing error below
    updatePayload.prev_reviewer_name = dbPrevReviewerName;

    const { error: updateErr } = await supabase
      .from('journals')
      .update(updatePayload)
      .eq('id', journalId);

    if (updateErr) {
      // If it fails due to missing prev_reviewer_name column, retry without it
      if (updateErr.code === '42703') {
        delete updatePayload.prev_reviewer_name;
        const { error: retryErr } = await supabase
          .from('journals')
          .update(updatePayload)
          .eq('id', journalId);
        if (retryErr) throw retryErr;
      } else {
        throw updateErr;
      }
    }

    // 5. Send email notification to chief editor
    const htmlAdmin = generateReworkResubmittedNotification(esc(studentName || 'Author'), esc(title));
    await sendMail(process.env.EMAIL_USER, `Reworked Paper Resubmitted: "${esc(title)}"`, htmlAdmin);

    // 6. Send in-app notification to all admins
    await notifyAdminsInApp(
      'Reworked Paper Resubmitted',
      `Author ${studentName || 'Author'} resubmitted the reworked paper "${title}". Please assign a reviewer.`,
      '/admin/reviewers'
    );

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Resubmit Error:', err);
    res.status(500).json({ error: 'Resubmission failed. Please try again.' });
  }
};
