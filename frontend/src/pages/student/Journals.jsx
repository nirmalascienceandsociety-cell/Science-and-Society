import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'

import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { sendNotification } from '../../lib/api'
import ConfirmModal from '../../components/ConfirmModal'

const statusLabels = { pending: 'Pending', submitted: 'Submitted', under_review: 'Under Review', approved: 'Accepted', accepted: 'Accepted', rejected: 'Rejected', revision_required: 'Revision Required', rework: 'Revision Required', published: 'Published' }

const isPdfMagicBytes = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = (e) => {
      const bytes = new Uint8Array(e.target.result)
      // %PDF- = 0x25 0x50 0x44 0x46 0x2D
      resolve(
        bytes[0] === 0x25 && bytes[1] === 0x50 &&
        bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2D
      )
    }
    reader.readAsArrayBuffer(file.slice(0, 5))
  })

/* ── Journal List ─────────────────────────────────────────────────── */
export function StudentJournals() {
  const { user } = useAuth()
  const toast = useToast()
  const [journals, setJournals] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [fetchError, setFetchError] = useState(false)
  
  // ConfirmModal state
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) fetchJournals() }, [user])

  async function fetchJournals() {
    setLoading(true)
    setFetchError(false)
    const { data, error } = await supabase
      .from('journals')
      .select('id, title, status, created_at')
      .eq('student_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      console.error('StudentJournals: failed to load journals', error.message)
      setFetchError(true)
    } else {
      setJournals(data ?? [])
    }
    setLoading(false)
  }



  const filtered = filter === 'all'
    ? journals
    : (filter === 'approved' || filter === 'accepted')
    ? journals.filter(j => j.status === 'approved' || j.status === 'accepted')
    : journals.filter(j => j.status === filter)

  function triggerDelete(id) {
    setConfirmId(id)
    setConfirmOpen(true)
  }

  async function handleDeleteConfirm() {
    if (!confirmId) return
    setDeleting(true)
    try {
      const res = await sendNotification(`/api/student/journals/${confirmId}/delete`, {})
      if (!res || !res.ok) {
        const errBody = res ? await res.json().catch(() => ({})) : {}
        throw new Error(errBody.error || 'Failed to delete paper on the server')
      }
      toast.success('Paper deleted successfully')
      setJournals(prev => prev.filter(j => j.id !== confirmId))
    } catch (err) {
      console.error('Delete error:', err)
      toast.error(err.message || 'Failed to delete paper')
    }
    setDeleting(false)
    setConfirmOpen(false)
    setConfirmId(null)
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Submissions</h1>
          <p className="page-subtitle">Track all your journal submissions and their review status</p>
        </div>
        <Link to="/student/upload" className="btn btn-primary">
          Upload New
        </Link>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {['all', 'submitted', 'under_review', 'revision_required', 'rework', 'approved', 'rejected', 'published'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-outline'}`}>
            {f === 'all' ? 'All' : statusLabels[f]}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-content">
          {loading ? (
            <p className="text-sm text-muted" style={{ padding: '2rem 0' }}>Loading…</p>
          ) : fetchError ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--destructive)' }}>
              <p className="text-sm">Failed to load submissions. Please check your connection.</p>
              <button className="btn btn-outline btn-sm" style={{ marginTop: '0.75rem' }} onClick={fetchJournals}>Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted-foreground)' }}>
              <p style={{ fontStyle: 'italic', fontSize: '0.95rem' }}>No journals found matching your search criteria.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filtered.map(j => (
                <div key={j.id} className="submission-item">
                  <div>
                    <Link to={`/student/journals/${j.id}`} className="submission-link">{j.title}</Link>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                      <span className="text-xs text-muted">
                        {new Date(j.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className={`status-${j.status}`}>{statusLabels[j.status] || 'Pending'}</span>

                    {j.status === 'submitted' && (
                      <button 
                        className="btn btn-outline btn-sm" 
                        style={{ color: '#ef4444', borderColor: '#ef4444' }}
                        onClick={() => triggerDelete(j.id)}
                        disabled={deleting}
                        title="Delete Paper"
                      >
                        Delete
                      </button>
                    )}

                    <Link to={`/student/journals/${j.id}`} className="btn btn-outline btn-sm">
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Paper?"
        message="Are you sure you want to delete this paper? This action cannot be undone."
        confirmText="Delete"
        loading={deleting}
        type="danger"
      />
    </div>
  )
}

/* ── Journal Detail ───────────────────────────────────────────────── */
export function StudentJournalDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const [journal, setJournal] = useState(null)
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)

  // Resubmission form state
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editAbstract, setEditAbstract] = useState('')
  const [editKeywords, setEditKeywords] = useState('')
  const [editFile, setEditFile] = useState(null)
  const [resubmitting, setResubmitting] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchDetail() }, [id])

  async function fetchDetail() {
    setLoading(true)
    const [journalRes, reviewsRes] = await Promise.all([
      supabase.from('journals').select('*').eq('id', id).single(),
      supabase.from('reviews')
        .select('id, decision, comments, originality, methodology, clarity, refs, overall, created_at')
        .eq('journal_id', id)
        .order('created_at', { ascending: true }),
    ])
    const j = journalRes.data ?? null
    setJournal(j)
    setReviews(reviewsRes.data ?? [])
    if (j) {
      setEditTitle(j.title)
      setEditAbstract(j.abstract || '')
      setEditKeywords(j.keywords)
    }
    setLoading(false)
  }

  async function handleResubmit(e) {
    e.preventDefault()
    if (!editTitle.trim()) { toast.error('Title is required'); return }
    if (!editAbstract.trim()) { toast.error('Abstract is required'); return }
    if (!editKeywords.trim()) { toast.error('Keywords are required'); return }
    if (!editFile) { toast.error('Please upload the revised manuscript PDF'); return }
    setResubmitting(true)

    let newFileUrl = null;

    try {
      if (editFile.size > 10 * 1024 * 1024) {
        toast.error('File size must be under 10MB')
        setResubmitting(false)
        return
      }

      const validPdf = await isPdfMagicBytes(editFile)
      if (!validPdf) {
        toast.error('Invalid file format. Please upload a valid PDF document.')
        setResubmitting(false)
        return
      }

      // The backend securely fetches the previous reviewer name from the DB.
      const prevReviewerName = null

      // ── 1. Upload the new manuscript file ──────────────────────────────
      // RLS Policy requires students to upload strictly to their own UID folder
      const newFileName = `${user.id}/${Date.now()}_resubmit_${editFile.name}`
      const { error: upErr } = await supabase.storage
        .from('journals')
        .upload(newFileName, editFile, { cacheControl: '3600', upsert: false })
      if (upErr) throw upErr
      // Store the storage PATH (not a public URL) — bucket is private
      newFileUrl = newFileName


      // ── 2. Capture reviewer comments for history ────────────────────────
      const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null

      // ── 4. Call secure backend API — handles DB update, review/assignment
      //        deletion and notifications using service-role key (bypasses RLS)
      const res = await sendNotification('/api/student/resubmit', {
        journalId: id,
        title: editTitle.trim(),
        abstract: editAbstract.trim(),
        keywords: editKeywords,
        fileUrl: newFileUrl,
        prevAdminComments: journal.admin_comments || null,
        prevRevisionReportUrl: journal.revision_report_url || null,
        prevReviewerComments: latestReview?.comments || null,
        prevReviewerName: prevReviewerName || null,
        resubmissionCount: (journal.resubmission_count || 0) + 1,
        studentName: journal.author_name || 'Author',
      })

      if (!res || !res.ok) {
        const errBody = res ? await res.json().catch(() => ({})) : {}
        throw new Error(errBody.error || 'Resubmission failed on the server')
      }

      // ── 4. Delete the OLD manuscript file from storage ONLY IF SUCCESS ─
      if (journal.file_url) {
        try {
          const { extractStoragePath } = await import('../../lib/storage')
          const oldPath = extractStoragePath(journal.file_url)
          if (oldPath) await supabase.storage.from('journals').remove([oldPath])
        } catch (delErr) {
          console.warn('Could not delete old file from storage:', delErr)
        }
      }

      toast.success('Manuscript resubmitted! The admin will assign it for the next review round.')
      setEditing(false)
      fetchDetail()
    } catch (err) {
      console.error('Resubmission error:', err)
      toast.error(err.message || 'Resubmission failed')
      // Rollback orphaned file upload
      if (newFileUrl) {
        await supabase.storage.from('journals').remove([newFileUrl]).catch(() => {})
      }
    }
    setResubmitting(false)
  }

  if (loading) return <p className="text-muted text-sm" style={{ padding: '2rem' }}>Loading…</p>

  if (!journal) return (
    <div style={{ textAlign: 'center', padding: '4rem 0' }}>
      <p>Journal not found.</p>
      <button className="btn btn-outline mt-4" onClick={() => navigate('/student/journals')}>Go back</button>
    </div>
  )

  const isRevisionRequired = journal.status === 'revision_required' || journal.status === 'rework'

  return (
    <div className="space-y-6">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/student/journals')}>
            Back
          </button>
          <h1 className="page-title" style={{ margin: 0, fontSize: '1.25rem' }}>Journal Details</h1>
          {journal.resubmission_count > 0 && (
            <span className="badge" style={{ background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>
              Resubmission #{journal.resubmission_count}
            </span>
          )}
        </div>


      </div>

      <div className="review-grid">
        <div className="space-y-4">
          {/* Journal Info / Edit Form */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div className="card-title" style={{ flex: 1 }}>{editing ? 'Edit & Resubmit' : journal.title}</div>
                <span className={`status-${journal.status}`}>{statusLabels[journal.status] || journal.status}</span>
              </div>
            </div>
            <div className="card-content space-y-4">
              {editing ? (
                /* ── Resubmission Edit Form ── */
                <form onSubmit={handleResubmit} className="space-y-4">
                  <div className="form-group">
                    <label className="text-sm font-medium">Title <span style={{ }}>*</span></label>
                    <input className="input" value={editTitle} onChange={e => setEditTitle(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-medium">Abstract <span style={{ color: '#ef4444' }}>*</span></label>
                    <textarea
                      className="input"
                      style={{ minHeight: '120px', resize: 'vertical', padding: '0.75rem', lineHeight: 1.6 }}
                      value={editAbstract}
                      onChange={e => setEditAbstract(e.target.value)}
                      placeholder="Enter the full text of the abstract..."
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-medium">Keywords <span style={{ color: '#ef4444' }}>*</span></label>
                    <input className="input" value={editKeywords} onChange={e => setEditKeywords(e.target.value)}
                      placeholder="comma-separated keywords" required />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-medium">
                      Upload Revised Manuscript (PDF) <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <p className="text-xs text-muted" style={{ marginBottom: '0.5rem' }}>
                      The existing file will be permanently replaced. Upload your revised manuscript.
                    </p>
                    {editFile ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: 'var(--muted)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                        <span className="text-sm">{editFile.name}</span>
                        <button type="button" className="btn btn-primary btn-sm" style={{ gap: '0.25rem', padding: '0.25rem 0.5rem' }} onClick={() => setEditFile(null)} title="Remove journal file">
                          Remove
                        </button>
                      </div>
                    ) : (
                      <input type="file" accept=".pdf" className="input" style={{ padding: '0.4rem' }}
                        onChange={e => { if (e.target.files?.[0]) setEditFile(e.target.files[0]) }} required />
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" className="btn btn-outline" onClick={() => setEditing(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={resubmitting}>
                      {resubmitting ? 'Resubmitting…' : 'Resubmit your Manuscript'}
                    </button>
                  </div>
                </form>
              ) : (
                /* ── Normal View ── */
                <>
                  <div>
                    <p className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Abstract</p>
                    {/* SEC-004: Never use abstract as href — render as plain text only.
                        Abstract is user-supplied text, not a URL. */}
                    <p className="text-sm">{journal.abstract || 'No abstract provided.'}</p>
                  </div>
                  <div className="grid-2">
                    <div>
                      <p className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Submitted</p>
                      <p className="text-sm">{new Date(journal.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Keywords</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {journal.keywords.split(',').map(k => (
                        <span key={k} className="badge badge-secondary">{k.trim()}</span>
                      ))}
                    </div>
                  </div>
                  {journal.file_url && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={async () => {
                        const { getSignedUrl } = await import('../../lib/storage')
                        const url = await getSignedUrl(supabase, journal.file_url)
                        if (url) window.open(url, '_blank', 'noreferrer')
                        else toast.error('Could not open file. Please try again.')
                      }}
                    >
                      Download PDF
                    </button>
                  )}

                  {/* Resubmit Button - only when revision required */}
                  {isRevisionRequired && (
                    <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}
                      onClick={() => setEditing(true)}>
                      Edit & Resubmit your Manuscript
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Review Progress */}
          <div className="card">
            <div className="card-header"><div className="card-title">Review Progress</div></div>
            <div className="card-content space-y-4">
              {(() => {
                let level1Status = 'Pending'
                let level2Status = 'Pending'
                let level1Active = false
                let level2Active = false
                let level1Completed = false
                let level2Completed = false

                if (journal.status === 'submitted') {
                  level1Status = 'Pending'
                  level2Status = 'Pending'
                } else if (journal.status === 'under_review') {
                  if (reviews.length === 0) {
                    level1Status = 'Under Review'
                    level1Active = true
                  } else {
                    level1Status = 'Review Completed'
                    level1Completed = true
                    level2Status = 'Under Review'
                    level2Active = true
                  }
                } else {
                  level1Status = 'Review Completed'
                  level1Completed = true
                  level2Status = 'Decision Made'
                  level2Completed = true
                }

                const levels = [
                  { num: 1, title: 'Level 1', status: level1Status, active: level1Active, completed: level1Completed },
                  { num: 2, title: 'Level 2', status: level2Status, active: level2Active, completed: level2Completed },
                ]

                return levels.map(level => {
                  const isHighlighted = level.active || level.completed;
                  return (
                    <div key={level.num} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{
                        width: '2rem', height: '2rem', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 600, flexShrink: 0,
                        background: isHighlighted ? 'var(--primary)' : 'var(--muted)',
                        color: isHighlighted ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                      }}>{level.num}</div>
                      <div>
                        <p className="text-sm font-medium">{level.title}</p>
                        <p className="text-xs text-muted" style={{
                          color: level.active ? 'var(--primary)' : 'var(--muted-foreground)',
                          fontWeight: level.active ? 600 : 'normal'
                        }}>
                          {level.status}
                        </p>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {/* Admin Decision - only show when admin has made a decision */}
          {journal.admin_comments && (
            <div className="card" style={{ borderTop: `4px solid ${journal.status === 'approved' ? '#059669' : journal.status === 'rejected' ? '#dc2626' : '#d97706'}` }}>
              <div className="card-header"><div className="card-title">Editor's Decision</div></div>
              <div className="card-content space-y-3">
                <div>
                  <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Decision</p>
                  <span className={`status-${journal.status}`}>
                    {(journal.status === 'approved' || journal.status === 'accepted') ? 'Approved' : journal.status === 'rejected' ? 'Rejected' : (journal.status === 'revision_required' || journal.status === 'rework') ? 'Revision Required' : journal.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Comments</p>
                  <p className="text-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{journal.admin_comments}</p>
                </div>
                {journal.revision_report_url && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ width: '100%' }}
                    onClick={async () => {
                      const { getSignedUrl } = await import('../../lib/storage')
                      const url = await getSignedUrl(supabase, journal.revision_report_url)
                      if (url) window.open(url, '_blank', 'noreferrer')
                      else toast.error('Could not open file. Please try again.')
                    }}
                  >
                    Download Revision Report
                  </button>
                )}
                {journal.approval_proof_url && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ width: '100%' }}
                    onClick={async () => {
                      const { getSignedUrl } = await import('../../lib/storage')
                      const url = await getSignedUrl(supabase, journal.approval_proof_url)
                      if (url) window.open(url, '_blank', 'noreferrer')
                      else toast.error('Could not open file. Please try again.')
                    }}
                  >
                    Download Proof of Approval
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Previous Feedback (from prior submission rounds) */}
          {journal.prev_admin_comments && (
            <div className="card" style={{ borderTop: '4px solid var(--muted-foreground)', opacity: 0.85 }}>
              <div className="card-header"><div className="card-title">Previous Feedback</div></div>
              <div className="card-content space-y-3">
                <div>
                  <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Editor's Comments</p>
                  <p className="text-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{journal.prev_admin_comments}</p>
                </div>
                {journal.prev_reviewer_comments && (
                  <div>
                    <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Reviewer's Comments</p>
                    <p className="text-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{journal.prev_reviewer_comments}</p>
                  </div>
                )}
                {journal.prev_revision_report_url && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ width: '100%' }}
                    onClick={async () => {
                      const { getSignedUrl } = await import('../../lib/storage')
                      const url = await getSignedUrl(supabase, journal.prev_revision_report_url)
                      if (url) window.open(url, '_blank', 'noreferrer')
                      else toast.error('Could not open file. Please try again.')
                    }}
                  >
                    Previous Revision Report
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header"><div className="card-title">Need Help?</div></div>
            <div className="card-content">
              <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
                If you have questions about your submission, contact our editorial team.
              </p>
              <a href="mailto:editorscisoc@nirmalacollege.ac.in" className="btn btn-outline w-full">
                Contact Support
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
