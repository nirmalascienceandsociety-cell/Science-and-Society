const { sendMail } = require('../utils/mailer');
const { createClient } = require('@supabase/supabase-js');
const { 
  generateUploadNotification,
  generateUploadConfirmationStudent,
  generateAssignNotification,
  generateReviewCompleteNotification,
  generateReworkResubmittedNotification,
  generateDecisionNotification,
  generateBanNotification,
  generateUnbanNotification,
  generateAccountDeletedNotification,
  generateReviewerApprovalNotification,
  generateReviewerRejectionNotification,
  generateSentForReviewNotification,
  generateReworkNotification,
  generatePublishedNotification,
  generatePaperRequestAdminNotification,
  generatePaperRequestRejectedNotification,
  generatePaperDeletedNotification,
  generateContactNotification,
  generateContactReply,
  generateUnassignNotification,
  generateReviewerDeclinedAssignmentNotification,
  generateForceUnassignNotification,
  escHtml
} = require('../utils/emailTemplates');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getEmailForUser = async (userId) => {
  if (!userId) return null;
  // Try auth user first
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (!error && data?.user?.email) return data.user.email;
  // Fallback to profiles table
  const { data: profile } = await supabase.from('profiles').select('email').eq('id', userId).single();
  return profile?.email || null;
};

// esc is the canonical HTML-escape helper. Imported from emailTemplates.js
// so all backend email code shares a single source of truth.
const esc = escHtml;


const checkAdmin = async (userId) => {
  if (!userId) return false;
  // Check both role AND status — banned admins must not be able to act
  const { data } = await supabase.from('profiles').select('role, status').eq('id', userId).single();
  return data?.role === 'admin' && data?.status === 'active';
};

// Input validation helpers
const validateEmail = (email) => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validateString = (str, maxLen = 200) => typeof str === 'string' && str.trim().length > 0 && str.trim().length <= maxLen;

// ── Helper: insert in-app notification ────────────────────────────────
const insertNotification = async (userId, title, message, link) => {
  if (!userId) return;
  await supabase.from('notifications').insert({ user_id: userId, title, message, link });
};

// Helper: notify all admin profiles via in-app notification
const notifyAdminsInApp = async (title, message, link) => {
  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
  if (admins && admins.length > 0) {
    const records = admins.map(a => ({ user_id: a.id, title, message, link }));
    await supabase.from('notifications').insert(records);
  }
};

exports.notifyUpload = async (req, res) => {
  try {
  const { studentName, journalTitle } = req.body;
  if (!validateString(journalTitle, 500)) return res.status(400).json({ error: 'Invalid journal title' });
  
  // SEC: Check if submissions are open before accepting notification
  const { data: issue } = await supabase.from('current_issue').select('is_open').eq('id', 1).single();
  if (!issue || !issue.is_open) {
    return res.status(403).json({ error: 'Paper submissions are currently closed.' });
  }

  // H-3 Fix: Verify caller is an active student and journal actually exists in DB before sending notifications
  const { data: profile } = await supabase.from('profiles').select('role, status').eq('id', req.user?.id).single();
  if (!profile || profile.role !== 'student' || profile.status !== 'active') {
    return res.status(403).json({ error: 'Forbidden: Only active authors can send upload notifications' });
  }

  const { data: uploadedJournal } = await supabase
    .from('journals')
    .select('id')
    .eq('student_id', req.user.id)
    .eq('title', journalTitle.trim())
    .maybeSingle();
  if (!uploadedJournal) {
    return res.status(404).json({ error: 'Matching submitted paper not found in database' });
  }

  const studentEmail = req.user?.email || (req.user?.id ? await getEmailForUser(req.user.id) : null);

  // 1. Notify Admin
  const htmlAdmin = generateUploadNotification(esc(studentName), esc(journalTitle));
  const adminSent = await sendMail(process.env.EMAIL_USER, 'New Journal Submission', htmlAdmin);

  // 2. Notify Student Confirmation (if email available)
  if (studentEmail) {
    const htmlStudent = generateUploadConfirmationStudent(esc(studentName), esc(journalTitle));
    await sendMail(studentEmail, 'Submission Received - Science & Society', htmlStudent);
  }

  // 3. In-app notification for student
  if (req.user?.id) {
    await insertNotification(req.user.id, 'Paper Submitted', `Your paper "${journalTitle}" has been submitted for editorial review.`, '/student/journals');
  }
  await notifyAdminsInApp('New Paper Submission', `A new paper "${journalTitle}" was submitted by ${studentName}.`, '/admin/reviewers');

  res.status(200).json({ success: true, adminSent });
  } catch (err) {
    console.error('notifyUpload Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.notifyAssign = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { reviewerId, reviewerName, journalTitle, isRework } = req.body;
  const reviewerEmail = await getEmailForUser(reviewerId);
  if (!reviewerEmail) return res.status(404).json({ error: 'Reviewer not found' });
  
  const html = generateAssignNotification(esc(reviewerName), esc(journalTitle), isRework);
  const sent = await sendMail(reviewerEmail, isRework ? 'Reworked Paper Review Assignment' : 'New Review Assignment', html);
  
  const inAppTitle = isRework ? 'Reworked Paper Review Assignment' : 'New Review Assignment';
  const inAppMessage = isRework ? `You have been assigned to review the reworked paper "${journalTitle}".` : `You have been assigned to review "${journalTitle}".`;
  await insertNotification(reviewerId, inAppTitle, inAppMessage, '/reviewer/assigned');
  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyAssign Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.notifyUnassignReviewer = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { reviewerId, reviewerName, journalTitle } = req.body;
  const reviewerEmail = await getEmailForUser(reviewerId);
  if (!reviewerEmail) return res.status(404).json({ error: 'Reviewer email not found' });
  
  const html = generateUnassignNotification(esc(reviewerName), esc(journalTitle));
  const sent = await sendMail(reviewerEmail, `Review Assignment Removed: "${esc(journalTitle)}"`, html);
  
  await insertNotification(
    reviewerId,
    'Review Assignment Removed',
    `You have been unassigned from reviewing "${journalTitle}".`,
    '/reviewer/assigned'
  );
  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyUnassignReviewer Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.notifyReview = async (req, res) => {
  try {
  const { journalId, studentId, reviewerName, journalTitle, decision } = req.body;

  // Security: journalId is mandatory — reject calls that omit it to prevent ownership bypass
  if (!journalId) {
    return res.status(400).json({ error: 'journalId is required' });
  }

  // Verify the caller is the reviewer actually assigned to this journal
  const { data: assignment } = await supabase
    .from('assignments')
    .select('id')
    .eq('journal_id', journalId)
    .eq('reviewer_id', req.user.id)
    .single();
  if (!assignment) {
    return res.status(403).json({ error: 'Forbidden: you are not assigned to this journal' });
  }

  // 1. Notify Admin/Chief that reviewer has submitted review report
  const htmlAdmin = generateReviewCompleteNotification('admin', esc(journalTitle), esc(decision), esc(reviewerName));
  const sent = await sendMail(process.env.EMAIL_USER, `Review Report Submitted for "${esc(journalTitle)}"`, htmlAdmin);

  // 2. Send in-app notification to all admins
  await notifyAdminsInApp('Review Report Submitted', `Reviewer ${reviewerName || 'assigned'} submitted a report for "${journalTitle}".`, '/admin/reports');

  // H-2 Fix: Resolve actual student_id from journal row to prevent spoofed studentId calls
  const { data: journalRow } = await supabase.from('journals').select('student_id').eq('id', journalId).single();
  const actualStudentId = journalRow?.student_id;

  if (actualStudentId) {
    const studentEmail = await getEmailForUser(actualStudentId);
    if (studentEmail) {
      const htmlAuthor = generateReviewCompleteNotification('student', esc(journalTitle), null, esc(reviewerName));
      await sendMail(studentEmail, `Your Paper Has Been Reviewed — "${esc(journalTitle)}"`, htmlAuthor);
    }
    // In-app notification for the author
    await insertNotification(
      actualStudentId,
      'Paper Review Completed',
      `A reviewer has completed their report for "${journalTitle}". Your manuscript is now awaiting final decision by the editor.`,
      '/student/journals'
    );
  }

  res.status(200).json({ success: true, sent });
  } catch (err) {
    console.error('notifyReview Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.notifyResubmit = async (req, res) => {
  try {
  const { journalId, studentName, journalTitle } = req.body;

  // Security: journalId is mandatory — reject calls that omit it to prevent ownership bypass
  if (!journalId) {
    return res.status(400).json({ error: 'journalId is required' });
  }

  // Verify the caller actually owns the journal they claim to have resubmitted
  const { data: journal } = await supabase
    .from('journals')
    .select('student_id')
    .eq('id', journalId)
    .single();
  if (!journal || journal.student_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: you do not own this journal' });
  }

  // Notify Admin/Chief that paper assigned for rework was resubmitted
  const htmlAdmin = generateReworkResubmittedNotification(esc(studentName), esc(journalTitle));
  const sent = await sendMail(process.env.EMAIL_USER, `Reworked Paper Resubmitted: "${esc(journalTitle)}"`, htmlAdmin);

  // Send in-app notification to all admins
  await notifyAdminsInApp(
    'Reworked Paper Resubmitted',
    `Author ${studentName || 'Author'} resubmitted the reworked paper "${journalTitle}". Please assign a reviewer.`,
    '/admin/reviewers'
  );

  res.status(200).json({ success: true, sent });
  } catch (err) {
    console.error('notifyResubmit Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Helper: resolve journal author details and email from profile or authors metadata
const resolveJournalRecipient = async (journalId, studentId, studentName, journalTitle) => {
  let targetStudentId = studentId;
  let targetTitle = journalTitle;
  let targetName = studentName;
  let authorEmail = null;

  if (journalId) {
    const { data: jRow } = await supabase
      .from('journals')
      .select('student_id, title, authors, author_name, profiles(name, email)')
      .eq('id', journalId)
      .maybeSingle();

    if (jRow) {
      targetStudentId = jRow.student_id;
      targetTitle = jRow.title || journalTitle;
      targetName = jRow.profiles?.name || jRow.author_name || studentName;
      if (jRow.profiles?.email) authorEmail = jRow.profiles.email;

      if (!authorEmail && Array.isArray(jRow.authors)) {
        const corr = jRow.authors.find(a => typeof a === 'object' && a !== null && (a.is_corresponding || a.role === 'corresponding' || a.email));
        if (corr?.email) authorEmail = corr.email;
      }
    }
  }

  if (!authorEmail && targetStudentId) {
    authorEmail = await getEmailForUser(targetStudentId);
  }

  return { targetStudentId, targetTitle, targetName, authorEmail };
};

exports.notifyDecision = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { journalId, studentId, studentName, journalTitle, status } = req.body;

  const { targetStudentId, targetTitle, targetName, authorEmail } = await resolveJournalRecipient(journalId, studentId, studentName, journalTitle);

  if (!authorEmail) return res.status(404).json({ error: 'Author email not found' });
  
  const html = generateDecisionNotification(esc(targetName || 'Author'), esc(targetTitle), esc(status || 'Decision Reached'));
  const sent = await sendMail(authorEmail, 'Editorial Decision Reached', html);

  if (targetStudentId) {
    await insertNotification(targetStudentId, 'Editorial Decision', `Decision for "${targetTitle}": ${status}`, '/student/journals');
  }

  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyDecision Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.notifyBan = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, userName, reason } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  const resolvedEmail = await getEmailForUser(userId);
  if (!resolvedEmail) return res.status(404).json({ error: 'Could not resolve user email' });

  const html = generateBanNotification(esc(userName), esc(reason));
  const sent = await sendMail(resolvedEmail, 'Your Account Has Been Suspended', html);
  await sendMail(process.env.EMAIL_USER, `User Suspended: ${esc(userName)}`, html);
  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyBan Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.notifyUnban = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, userName } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  // Security: Resolve email server-side — same rationale as notifyBan above.
  const resolvedEmail = await getEmailForUser(userId);
  if (!resolvedEmail) return res.status(404).json({ error: 'Could not resolve user email' });

  const html = generateUnbanNotification(esc(userName));
  const sent = await sendMail(resolvedEmail, 'Your Account Has Been Reinstated', html);
  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyUnban Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.notifyAccountDeleted = async (req, res) => {
  try {
  // requireAdmin middleware already verified this, but double-check for defense-in-depth
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, userName, role } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });
  
  // Security: Resolve email from DB using userId — never trust caller-provided email
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, name')
    .eq('id', userId)
    .single();
  
  // Fall back to caller-provided data only for the already-deleted user
  const resolvedEmail = profile?.email;
  const resolvedName = profile?.name || userName;
  
  if (!resolvedEmail) {
    const html = generateAccountDeletedNotification(esc(resolvedName), esc(role));
    await sendMail(process.env.EMAIL_USER, `Account Deleted: ${esc(resolvedName)} (${esc(role)})`, html);
    return res.status(200).json({ success: true });
  }
  
  const html = generateAccountDeletedNotification(esc(resolvedName), esc(role));
  await sendMail(resolvedEmail, 'Your Account Has Been Removed', html);
  await sendMail(process.env.EMAIL_USER, `Account Deleted: ${esc(resolvedName)} (${esc(role)})`, html);
  res.status(200).json({ success: true });
  } catch (err) {
    console.error('notifyAccountDeleted Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.notifyReviewerApproved = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, userName } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });
  
  const resolvedEmail = await getEmailForUser(userId);
  if (!resolvedEmail) return res.status(404).json({ error: 'Could not resolve user email' });

  const html = generateReviewerApprovalNotification(esc(userName));
  const sent = await sendMail(resolvedEmail, 'Reviewer Application Approved', html);
  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyReviewerApproved Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.notifyReviewerRejected = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, userName } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });
  
  const resolvedEmail = await getEmailForUser(userId);
  if (!resolvedEmail) return res.status(404).json({ error: 'Could not resolve user email' });

  const html = generateReviewerRejectionNotification(esc(userName));
  const sent = await sendMail(resolvedEmail, 'Reviewer Application Status', html);
  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyReviewerRejected Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};



// ── Notify student: paper has been sent to reviewer ───────────────────
exports.notifySentForReview = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { journalId, studentId, studentName, journalTitle } = req.body;
  
  const { targetStudentId, targetTitle, targetName, authorEmail } = await resolveJournalRecipient(journalId, studentId, studentName, journalTitle);

  if (!authorEmail) return res.status(404).json({ error: 'Author email not found' });

  const html = generateSentForReviewNotification(esc(targetName || 'Author'), esc(targetTitle));
  const sent = await sendMail(authorEmail, 'Your Paper Has Been Sent for Review', html);
  if (targetStudentId) {
    await insertNotification(targetStudentId, 'Paper Sent for Review', `Your paper "${targetTitle}" has been assigned to a reviewer.`, '/student/journals');
  }
  res.status(200).json({ success: true, sent });
  } catch (err) {
    console.error('notifySentForReview Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Notify student: rework/revision requested ─────────────────────────
exports.notifyRework = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { journalId, studentId, studentName, journalTitle, adminComments } = req.body;
  
  const { targetStudentId, targetTitle, targetName, authorEmail } = await resolveJournalRecipient(journalId, studentId, studentName, journalTitle);

  if (!authorEmail) return res.status(404).json({ error: 'Author email not found' });

  const html = generateReworkNotification(esc(targetName || 'Author'), esc(targetTitle), esc(adminComments));
  const sent = await sendMail(authorEmail, 'Revision Requested for Your Paper', html);
  if (targetStudentId) {
    await insertNotification(targetStudentId, 'Revision Requested', `Please revise your paper "${targetTitle}" and resubmit.`, '/student/journals');
  }
  res.status(200).json({ success: true, sent });
  } catch (err) {
    console.error('notifyRework Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Notify student: paper published ───────────────────────────────────
exports.notifyPublish = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { journalId, studentId, studentName, journalTitle, paperId } = req.body;
  
  const jId = journalId || paperId;
  const { targetStudentId, targetTitle, targetName, authorEmail } = await resolveJournalRecipient(jId, studentId, studentName, journalTitle);

  if (!authorEmail) return res.status(404).json({ error: 'Author email not found' });

  const APP_URL = process.env.APP_URL || 'http://localhost:5173';
  const paperLink = `${APP_URL}/paper/${encodeURIComponent(paperId || journalId)}`;
  const html = generatePublishedNotification(esc(targetName || 'Author'), esc(targetTitle), paperLink);
  const sent = await sendMail(authorEmail, 'Your Paper Has Been Published!', html);
  if (targetStudentId) {
    await insertNotification(targetStudentId, 'Paper Published!', `Your paper "${targetTitle}" is now live on the platform.`, `/paper/${paperId || journalId}`);
  }
  res.status(200).json({ success: true, sent });
  } catch (err) {
    console.error('notifyPublish Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Notify student: paper deleted ─────────────────────────────────────
exports.notifyPaperDeleted = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { journalId, studentId, studentName, journalTitle } = req.body;
  
  let targetStudentId = studentId;
  let targetTitle = journalTitle;
  let targetName = studentName;

  if (journalId) {
    const { data: jRow } = await supabase.from('journals').select('student_id, title, profiles(name)').eq('id', journalId).single();
    if (jRow) {
      targetStudentId = jRow.student_id;
      targetTitle = jRow.title || journalTitle;
      targetName = jRow.profiles?.name || studentName;
    }
  }

  const studentEmail = await getEmailForUser(targetStudentId);
  if (!studentEmail) return res.status(404).json({ error: 'Author not found' });

  const html = generatePaperDeletedNotification(esc(targetName || 'Author'), esc(targetTitle));
  await sendMail(studentEmail, 'Notice: Your Published Paper Has Been Removed', html);
  await insertNotification(targetStudentId, 'Paper Removed', `Your published paper "${targetTitle}" has been permanently removed by the administration.`, '/student/journals');
  res.status(200).json({ success: true });
  } catch (err) {
    console.error('notifyPaperDeleted Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Notify admin: new full-paper request ──────────────────────────────
exports.notifyPaperRequest = async (req, res) => {
  try {
  const { requesterName, requesterEmail, journalTitle, journalId, affiliation, reason, website_url } = req.body;
  
  // HONEYPOT: If the hidden website_url field is filled out, this is a spam bot.
  if (website_url) {
    console.log(`Blocked spam request from bot for paper: ${journalTitle}`);
    return res.status(200).json({ success: true, honeypot: true });
  }

  if (!validateEmail(requesterEmail)) return res.status(400).json({ error: 'Invalid email address' });
  if (!validateString(requesterName, 100)) return res.status(400).json({ error: 'Invalid requester name (max 100 chars)' });
  if (!validateString(journalTitle, 300)) return res.status(400).json({ error: 'Invalid journal title (max 300 chars)' });
  if (affiliation && typeof affiliation === 'string' && affiliation.length > 200) return res.status(400).json({ error: 'Affiliation too long (max 200 chars)' });
  if (reason && typeof reason === 'string' && reason.length > 1000) return res.status(400).json({ error: 'Reason too long (max 1000 chars)' });

  if (!journalId) return res.status(400).json({ error: 'journalId is required' });

  let isPublished = false;
  const { data: journalRow } = await supabase.from('journals').select('id, status').eq('id', journalId).maybeSingle();
  if (journalRow && journalRow.status === 'published') {
    isPublished = true;
  } else {
    const { data: issueRow } = await supabase.from('published_issues').select('id').eq('id', journalId).maybeSingle();
    if (issueRow) isPublished = true;
  }

  if (!isPublished) {
    return res.status(404).json({ error: 'Requested journal not found or is not published' });
  }

  const { error: insertError } = await supabase.from('paper_requests').insert({
    journal_id: journalId,
    journal_title: journalTitle.trim(),
    requester_name: requesterName.trim(),
    requester_email: requesterEmail.trim(),
    affiliation: affiliation?.trim() || null,
    reason: reason?.trim() || null,
    status: 'pending',
  });
  if (insertError) {
    console.error('paper_requests insert error:', insertError);
    return res.status(500).json({ error: 'Failed to save paper request. Please try again.' });
  }
  
  const html = generatePaperRequestAdminNotification(
    esc(requesterName), esc(requesterEmail), esc(journalTitle), esc(affiliation), esc(reason)
  );
  
  await notifyAdminsInApp(
    'New Paper Request',
    `${requesterName} requested the full PDF of "${journalTitle}".`,
    '/admin/paper-requests'
  );

  const sent = await sendMail(process.env.EMAIL_USER, 'New Full Paper Request', html);
  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyPaperRequest Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};


// ── Notify requester: paper request rejected ───────────────────────────
exports.notifyPaperRequestRejected = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { requesterName, requesterEmail, journalTitle } = req.body;
  if (!requesterEmail) return res.status(400).json({ error: 'Requester email required' });
  const html = generatePaperRequestRejectedNotification(esc(requesterName), esc(journalTitle));
  const sent = await sendMail(requesterEmail, 'Your Paper Request — Science & Society', html);
  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyPaperRequestRejected Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Notify requester: paper delivered ───────────────────────────
exports.notifyPaperDelivery = async (req, res) => {
  try {
  // requireAdmin middleware already verified this
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { requesterName, requesterEmail, journalTitle, fileUrl } = req.body;
  if (!requesterEmail || !fileUrl) return res.status(400).json({ error: 'Missing data' });

  // U-8 FIX: Cross-check that the fileUrl belongs to the journal the requester
  // actually requested. Prevents a rogue admin from delivering an arbitrary file
  // to an arbitrary email address by constructing a crafted POST body.
  const { data: requestRecord, error: reqErr } = await supabase
    .from('paper_requests')
    .select('id, journals(file_url)')
    .eq('requester_email', requesterEmail)
    .eq('journal_title', journalTitle)
    .in('status', ['pending', 'approved'])
    .maybeSingle();

  if (reqErr || !requestRecord) {
    return res.status(403).json({ error: 'No matching approved paper request found for this requester.' });
  }

  const expectedFileUrl = requestRecord.journals?.file_url;
  if (!expectedFileUrl) {
    return res.status(404).json({ error: 'No file associated with this paper in the database.' });
  }

  const getStoragePath = (url) => {
    const marker = '/journals/';
    const idx = url.indexOf(marker);
    if (idx !== -1) return url.slice(idx + marker.length).split('?')[0];
    return url;
  };

  const expectedPath = getStoragePath(expectedFileUrl);

  const { data: signedData, error: signErr } = await supabase.storage
    .from('journals')
    .createSignedUrl(expectedPath, 600);

  if (signErr || !signedData?.signedUrl) {
    console.error('Failed to generate signed URL for paper delivery:', signErr);
    return res.status(500).json({ error: 'Could not access the requested file.' });
  }

  const html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #0A192F;">
      <h2 style="color: #1D4ED8;">Science &amp; Society</h2>
      <p>Dear ${esc(requesterName)},</p>
      <p>Your request for the full paper <strong>"${esc(journalTitle)}"</strong> has been approved by the editorial board.</p>
      <p>Please find the requested PDF attached to this email.</p>
      <p>Thank you for your interest in our journal.</p>
      <br/>
      <p style="color: #475569; font-size: 0.9em;">Regards,<br/>Editorial Board</p>
    </div>
  `;

  const attachments = [
    {
      filename: `${journalTitle.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
      path: signedData.signedUrl
    }
  ];

  const sent = await sendMail(requesterEmail, 'Full Paper Delivery — Science & Society', html, attachments);
  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyPaperDelivery Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Contact Form (Public) ───────────────────────────────────────────────
exports.notifyContact = async (req, res) => {
  try {
  const { name, email, subject, message, website_url } = req.body;
  
  // Honeypot check: automated spammers fill this hidden field
  if (website_url) {
    return res.status(400).json({ error: 'Spam detected' });
  }

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (!validateString(name, 100)) return res.status(400).json({ error: 'Name must be 1-100 characters' });
  if (!validateString(subject, 200)) return res.status(400).json({ error: 'Subject must be 1-200 characters' });
  if (!validateString(message, 5000)) return res.status(400).json({ error: 'Message must be 1-5000 characters' });

  // 1. Send email to admin
  const htmlAdmin = generateContactNotification(esc(name), esc(email), esc(subject), esc(message));
  const emailSent = await sendMail(process.env.EMAIL_USER, `Contact Form: ${esc(subject)}`, htmlAdmin);

  // 2. Insert notification for admins
  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
  if (admins && admins.length > 0) {
    const records = admins.map(a => ({
      user_id: a.id,
      title: `New Message: ${esc(subject)}`,
      message: esc(message).substring(0, 100) + (message.length > 100 ? '...' : ''),
      metadata: { type: 'contact', sender_name: name, sender_email: email, subject: subject, full_message: message }
    }));
    await supabase.from('notifications').insert(records);
  }

  res.status(emailSent ? 200 : 500).json({ success: emailSent });
  } catch (err) {
    console.error('notifyContact Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Admin Reply to Contact Form ─────────────────────────────────────────
exports.replyContact = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { notificationId, recipientEmail, originalSubject, originalMessage, replyMessage } = req.body;

  if (!replyMessage) {
    return res.status(400).json({ error: 'Missing reply message' });
  }

  let targetEmail = recipientEmail;
  let targetSubject = originalSubject;
  let targetMessage = originalMessage;

  if (notificationId) {
    const { data: notif } = await supabase
      .from('notifications')
      .select('id, metadata')
      .eq('id', notificationId)
      .maybeSingle();

    if (!notif || notif.metadata?.type !== 'contact') {
      return res.status(404).json({ error: 'Matching contact message record not found.' });
    }

    targetEmail = notif.metadata?.sender_email || recipientEmail;
    targetSubject = notif.metadata?.subject || originalSubject;
    targetMessage = notif.metadata?.full_message || originalMessage;
  } else {
    const { data: matchingNotif } = await supabase
      .from('notifications')
      .select('id')
      .eq('metadata->>sender_email', recipientEmail)
      .limit(1)
      .maybeSingle();
    if (!matchingNotif) {
      return res.status(403).json({ error: 'No contact message found for this recipient.' });
    }
  }

  if (!targetEmail || !validateEmail(targetEmail)) {
    return res.status(400).json({ error: 'Invalid recipient email' });
  }

  const html = generateContactReply(esc(targetSubject), esc(targetMessage), esc(replyMessage));
  const emailSent = await sendMail(targetEmail, `Re: ${esc(targetSubject || 'Your Message to Science & Society')}`, html);
  
  res.status(emailSent ? 200 : 500).json({ success: emailSent });
  } catch (err) {
    console.error('replyContact Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Notify admin that reviewer declined an assignment ──────────────────────
// Called by the reviewer (requireAuth, not requireAdmin)
exports.notifyReviewerDeclinedAssignment = async (req, res) => {
  try {
  const { journalTitle, reviewerName } = req.body;
  if (!validateString(journalTitle, 500)) return res.status(400).json({ error: 'Invalid journal title' });

  // Verify caller is an active reviewer
  const { data: caller } = await supabase.from('profiles').select('role, status, name').eq('id', req.user?.id).single();
  if (!caller || caller.role !== 'reviewer' || caller.status !== 'active') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const safeReviewerName = esc(reviewerName || caller.name || 'Reviewer');
  const safeJournalTitle = esc(journalTitle);

  // Email admin
  const html = generateReviewerDeclinedAssignmentNotification(safeReviewerName, safeJournalTitle);
  const sent = await sendMail(process.env.EMAIL_USER, `Review Assignment Declined: "${safeJournalTitle}"`, html);

  // In-app notification to all admins
  await notifyAdminsInApp(
    'Reviewer Declined Assignment',
    `${safeReviewerName} declined the review request for "${journalTitle}". Please assign another reviewer.`,
    '/admin/assign'
  );

  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyReviewerDeclinedAssignment Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Notify reviewer that admin force-unassigned them after acceptance ──────
// Called by admin (requireAdmin)
exports.notifyForceUnassign = async (req, res) => {
  try {
  if (!await checkAdmin(req.user?.id)) return res.status(403).json({ error: 'Forbidden' });
  const { reviewerId, reviewerName, journalTitle } = req.body;
  if (!validateString(journalTitle, 500)) return res.status(400).json({ error: 'Invalid journal title' });

  const reviewerEmail = await getEmailForUser(reviewerId);
  if (!reviewerEmail) return res.status(404).json({ error: 'Reviewer email not found' });

  const safeReviewerName = esc(reviewerName || 'Reviewer');
  const safeJournalTitle = esc(journalTitle);

  // Email reviewer
  const html = generateForceUnassignNotification(safeReviewerName, safeJournalTitle);
  const sent = await sendMail(reviewerEmail, `Review Assignment Revoked: "${safeJournalTitle}"`, html);

  // In-app notification to the reviewer
  await insertNotification(
    reviewerId,
    'Review Assignment Revoked',
    `Your accepted review assignment for "${journalTitle}" has been revoked by the editorial team.`,
    '/reviewer/assigned'
  );

  res.status(sent ? 200 : 500).json({ success: sent });
  } catch (err) {
    console.error('notifyForceUnassign Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

