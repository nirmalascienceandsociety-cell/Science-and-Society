import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { FileText, ArrowLeft, User, Download, Clock, Search, CheckCircle, RotateCcw, XCircle, MessageSquare } from 'lucide-react'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { sendNotification } from '../../lib/api'

/** Reads the first 5 bytes of a File and checks for the %PDF- magic number. */
const isPdfMagicBytes = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = (e) => {
      const bytes = new Uint8Array(e.target.result)
      resolve(
        bytes[0] === 0x25 && bytes[1] === 0x50 &&
        bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2D
      )
    }
    reader.readAsArrayBuffer(file.slice(0, 5))
  })

/* ── Review Reports List (List View) ──────────────────────────────── */
export default function AdminReports() {
  const [journals, setJournals] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => { fetchJournals() }, [])


  async function fetchJournals() {
    setLoading(true)
    const [journalsRes, reviewsRes, assignmentsRes] = await Promise.all([
      supabase
        .from('journals')
        .select(`
          id, title, status, review_level, resubmission_count, prev_admin_comments, prev_reviewer_comments, created_at,
          profiles ( name )
        `)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('reviews').select('id, journal_id, profiles(name)').limit(2000),
      supabase.from('assignments').select('id, journal_id, profiles(name)').limit(2000)
    ])

    if (journalsRes.error) { setLoading(false); return }

    const records = journalsRes.data ?? []
    const reviews = reviewsRes.data ?? []
    const assignments = assignmentsRes.data ?? []

    const merged = records.map(j => ({
      ...j,
      reviews: reviews.filter(r => r.journal_id === j.id),
      assignments: assignments.filter(a => a.journal_id === j.id),
      // Collect all reviewer names from reviews for this journal
      reviewerNames: [...new Set(
        reviews.filter(r => r.journal_id === j.id && r.profiles?.name)
               .map(r => r.profiles.name)
      )],
    }))

    setJournals(merged)
    setLoading(false)
  }

  const filtered = journals.filter(j => {
    const matchSearch = j.title.toLowerCase().includes(search.toLowerCase()) ||
      (j.profiles?.name ?? '').toLowerCase().includes(search.toLowerCase())

    const hasReviews = Array.isArray(j.reviews) && j.reviews.length > 0
    const hasAdminDecision = ['approved', 'accepted', 'rejected', 'revision_required', 'rework', 'published'].includes(j.status)
    const hasAssignments = Array.isArray(j.assignments) && j.assignments.length > 0

    if (!hasReviews && !hasAdminDecision && !hasAssignments) return false

    let matchFilter = true
    if (filter === 'assigned') {
      matchFilter = hasAssignments && !hasReviews && !hasAdminDecision
    } else if (filter === 'under_review') {
      matchFilter = hasReviews && !hasAdminDecision
    }

    return matchSearch && matchFilter
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Review Reports</h1>
        <p className="page-subtitle">View reviewer reports and give the final editorial decision</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }} />
          <input className="input input-icon-left" style={{ paddingLeft: '2.5rem' }}
            placeholder="Search reports…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {['under_review', 'assigned', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-outline'}`}>
              {f === 'all' ? 'All' : f === 'assigned' ? 'Assigned' : 'For Review'}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-content space-y-4">
          {loading ? (
            <p className="text-sm text-muted">Loading journals…</p>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--muted-foreground)' }}>
              <p style={{ fontStyle: 'italic', fontSize: '0.95rem' }}>No review reports found matching your criteria.</p>
            </div>
          ) : filtered.map(j => (
            <div key={j.id} className="submission-item">
              <div>
                <h3 className="font-medium" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {j.title}
                  {(j.resubmission_count ?? 0) > 0 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      background: '#ede9fe', color: '#6d28d9',
                      borderRadius: '9999px', padding: '0.1rem 0.5rem',
                      fontSize: '0.65rem', fontWeight: 700
                    }}>
                      Reworked Paper (Revision #{j.resubmission_count})
                    </span>
                  )}
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.25rem' }}>
                  <span className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <User size={12} />{j.profiles?.name ?? '—'}
                  </span>
                  <span className="text-xs text-muted">Level {j.review_level} Review</span>
                  <span className="text-xs text-muted">
                    <Clock size={12} style={{ display: 'inline', marginRight: '0.25rem' }} />
                    {new Date(j.created_at).toLocaleDateString()}
                  </span>
                  <span className="badge badge-secondary" style={{ fontSize: '0.65rem' }}>{j.reviews?.length ?? 0} Feedback</span>
                  {j.reviewerNames?.length > 0 ? (
                    <span className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      Reviewer: {j.reviewerNames.join(', ')}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--muted-foreground)' }}>Unassigned</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className={`status-${j.status}`}>{j.status.replace('_', ' ')}</span>
                <Link to={`/admin/reports/${j.id}`} className="btn btn-primary btn-sm">
                  View Reports
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Review Report Detail (Detail View) ────────────────────────────── */
export function ReviewReportDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [journal, setJournal] = useState(null)
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [isEditingDecision, setIsEditingDecision] = useState(false)
  const { user } = useAuth()

  // Admin decision form state
  const [selectedDecision, setSelectedDecision] = useState(null)
  const [adminComments, setAdminComments] = useState('')
  const [approvalFile, setApprovalFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchDetail is stable; id is the only meaningful dep and is already included
  useEffect(() => { fetchDetail() }, [id])


  async function fetchDetail() {
    setLoading(true)
    const [journalRes, reviewsRes] = await Promise.all([
      supabase.from('journals').select('*, profiles(name, id)').eq('id', id).single(),
      supabase.from('reviews').select('*, profiles(name)').eq('journal_id', id).order('created_at', { ascending: false })
    ])

    setJournal(journalRes.data ?? null)
    setReviews(reviewsRes.data ?? [])

    if (journalRes.data) {
      const j = journalRes.data
      if (j.admin_comments) setAdminComments(j.admin_comments)
      if (['approved', 'accepted', 'rejected', 'revision_required', 'rework', 'published'].includes(j.status)) {
        setSelectedDecision(j.status)
        setIsEditingDecision(false)
      } else {
        setIsEditingDecision(true)
      }
    }
    setLoading(false)
  }

  async function handleDecisionSubmit(e) {
    e.preventDefault()
    if (!selectedDecision) { toast.error('Please select a decision'); return }

    setSubmitting(true)
    try {
      let approvalUrl = journal.approval_proof_url || null

      // Upload approval proof PDF if provided (only for accepted)
      if (approvalFile && selectedDecision === 'accepted') {
        // RLS Policy requires admins to upload strictly to their own UID folder
        const fileName = `admin/${user.id}/approval_${Date.now()}.pdf`
        const { error: upErr } = await supabase.storage
          .from('journals')
          .upload(fileName, approvalFile, { cacheControl: '3600', upsert: false })
        if (upErr) throw upErr
        // Store the storage PATH (not a public URL) — bucket is private
        approvalUrl = fileName
      }

      const reviewerReportUrl = reviews[0]?.revision_report_url ?? null

      const { error } = await supabase.rpc('admin_make_decision', {
        p_journal_id: id,
        p_status: selectedDecision,
        p_admin_comments: adminComments || '',
        p_approval_proof_url: selectedDecision === 'accepted' ? approvalUrl : null,
        p_revision_report_url: (selectedDecision === 'rework' || selectedDecision === 'revision_required') ? reviewerReportUrl : null
      })

      if (error) throw error

      setJournal(prev => ({
        ...prev,
        status: selectedDecision,
        admin_comments: adminComments,
        approval_proof_url: selectedDecision === 'accepted' ? approvalUrl : null,
        revision_report_url: (selectedDecision === 'rework' || selectedDecision === 'revision_required') ? reviewerReportUrl : null,
      }))

      // Notify student based on decision
      const studentId = journal.student_id
      const studentName = journal.profiles?.name || 'Author'
      const journalTitle = journal.title

      let emailFailed = false;
      if (selectedDecision === 'rework') {
        const res = await sendNotification('/api/notify/rework', { journalId: id, studentId, studentName, journalTitle, adminComments })
        if (!res || !res.ok) emailFailed = true;
      } else {
        const res = await sendNotification('/api/notify/decision', { journalId: id, studentId, studentName, journalTitle, status: selectedDecision })
        if (!res || !res.ok) emailFailed = true;
      }

      const labels = { accepted: 'Accepted', rejected: 'Rejected', rework: 'Rework Requested', approved: 'Approved', revision_required: 'Revision Required' }
      if (emailFailed) {
        toast.error(`Decision recorded, but failed to send email notification.`, { duration: 5000 });
      } else {
        toast.success(`Decision submitted — ${labels[selectedDecision] || selectedDecision}`)
      }
      setIsEditingDecision(false)
    } catch (err) {
      toast.error(err.message || 'Failed to submit decision')
    }
    setSubmitting(false)
  }

  if (loading) return <p className="text-muted text-sm" style={{ padding: '2rem' }}>Loading report details…</p>
  if (!journal) return <p>Journal not found.</p>

  const decisionOptions = [
    { status: 'accepted', label: 'Accept', icon: CheckCircle, color: '#059669', bg: '#ecfdf5' },
    { status: 'rework', label: 'Needs Rework', icon: RotateCcw, color: '#d97706', bg: '#fffbeb' },
    { status: 'rejected', label: 'Reject', icon: XCircle,  bg: '#fef2f2' },
  ]

  const hasReviewerReport = reviews.length > 0
  // PDF is stored on the reviews row (reviewer has write access there, not on journals)
  const reviewerReportUrl = reviews[0]?.revision_report_url ?? null
  const hasRevisionPDF = !!reviewerReportUrl

  return (
    <div className="space-y-6">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/admin/reports')}>
          <ArrowLeft size={16} /> Back to List
        </button>
        <h1 className="page-title" style={{ margin: 0, fontSize: '1.25rem' }}>Journal Reports</h1>
        {journal.resubmission_count > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
            background: '#ede9fe', color: '#6d28d9',
            borderRadius: '9999px', padding: '0.25rem 0.75rem',
            fontSize: '0.75rem', fontWeight: 700
          }}>
            Revision #{journal.resubmission_count}
          </span>
        )}
      </div>

      <div className="review-grid">
        {/* Left: Journal Details + Reviewer Report */}
        <div className="space-y-6">
          {/* Journal info */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">{journal.title}</div>
              <div className="card-description">by {journal.author_name || journal.profiles?.name || '—'}</div>
            </div>
            <div className="card-content space-y-4">
              <div>
                <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Abstract</p>
                {journal.abstract?.startsWith('http') ? (
                  <a href={journal.abstract} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ display: 'inline-flex', marginTop: '0.25rem' }}>
                    <Download size={14} /> Download Abstract
                  </a>
                ) : (
                  <p className="text-sm" style={{ lineHeight: '1.6' }}>{journal.abstract}</p>
                )}
              </div>
              {journal.file_url && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '1rem 1.25rem',
                  background: 'linear-gradient(to right, var(--gold-subtle), transparent)',
                  borderRadius: '0.75rem',
                  border: '1px solid var(--gold-border)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ background: 'var(--gold-muted)', padding: '0.5rem', borderRadius: '0.5rem' }}>
                      <FileText size={20} style={{ color: 'var(--gold)' }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Full Manuscript</p>
                      <p className="text-xs text-muted">Original Submission Document</p>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ boxShadow: '0 4px 12px var(--gold-muted)', padding: '0.5rem 1rem' }}
                    onClick={async () => {
                      const { getSignedUrl } = await import('../../lib/storage')
                      const url = await getSignedUrl(supabase, journal.file_url)
                      if (url) window.open(url, '_blank', 'noreferrer')
                      else toast.error('Could not open file. Please try again.')
                    }}
                  >
                    <Download size={16} /> Download
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Reviewer Report — text comments + PDF */}
          <div className="card" style={{ borderTop: '4px solid var(--primary)' }}>
            <div className="card-header">
              <div className="card-title">Reviewer Report</div>
              <div className="card-description">Feedback and revision report submitted by the assigned reviewer</div>
            </div>
            <div className="card-content space-y-4">
              {!hasReviewerReport ? (
                <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--muted-foreground)' }}>
                  <p className="text-sm italic">No feedback has been submitted for this journal yet.</p>
                </div>
              ) : (
                <>
                  {reviews.map((r) => (
                    <div key={r.id} style={{
                      padding: '1.25rem',
                      background: 'var(--muted)',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <MessageSquare size={15} style={{ color: 'var(--primary)' }} />
                        <span className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Reviewer Comments
                        </span>
                        {r.profiles?.name && (
                          <span className="badge badge-secondary" style={{ fontSize: '0.65rem', marginLeft: 'auto' }}>
                            {r.profiles.name}
                          </span>
                        )}
                      </div>
                      <p className="text-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: 'var(--foreground)' }}>
                        {r.comments}
                      </p>
                    </div>
                  ))}

                  {/* Reviewer's uploaded Revision Report PDF */}
                  {hasRevisionPDF ? (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '1rem 1.25rem',
                      background: 'linear-gradient(to right, var(--gold-subtle), transparent)',
                      borderRadius: '0.75rem',
                      border: '1px solid var(--gold-border)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ background: 'var(--gold-muted)', padding: '0.5rem', borderRadius: '0.5rem' }}>
                          <FileText size={20} style={{ color: 'var(--gold)' }} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Reviewer's Revision Report</p>
                          <p className="text-xs text-muted">PDF uploaded by reviewer</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const { getSignedUrl } = await import('../../lib/storage')
                          const url = await getSignedUrl(supabase, reviewerReportUrl)
                          if (url) window.open(url, '_blank', 'noreferrer')
                          else toast.error('Could not open file. Please try again.')
                        }}
                        className="btn btn-primary btn-sm"
                        style={{ boxShadow: '0 4px 12px color-mix(in srgb, var(--primary) 20%, transparent)', padding: '0.5rem 1rem' }}
                      >
                        <Download size={16} /> Download PDF
                      </button>
                    </div>
                  ) : (
                    <div style={{
                      padding: '0.875rem 1rem',
                      borderRadius: 'var(--radius)',
                      background: '#fffbeb',
                      border: '1px solid #fcd34d',
                      color: '#92400e',
                      fontSize: '0.875rem'
                    }}>
                      Reviewer has not uploaded the Revision Report PDF yet.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Metadata + Previous Feedback + Decision Form */}
        <div className="space-y-4">
          {/* Submission Details */}
          <div className="card">
            <div className="card-header"><div className="card-title">Submission Details</div></div>
            <div className="card-content space-y-3">
              {[
                ['Status', <span key="s" className={`status-${journal.status}`}>{journal.status.replace('_', ' ')}</span>],
                ['Submitted', new Date(journal.created_at).toLocaleDateString()],
                ...(journal.resubmission_count > 0 ? [
                  ['Revision Round', `#${journal.resubmission_count}`],
                ] : []),
                ...(reviews.length > 0 ? [
                  ['Previous Reviewer', reviews[0].profiles?.name ?? '—'],
                  ['Reviewed On', new Date(reviews[0].created_at).toLocaleDateString()],
                ] : []),
                ['Revision Report', hasRevisionPDF ? 'Uploaded' : 'Pending'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                  <span className="text-muted">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
              {journal.resubmission_count > 0 && reviews.length > 0 && (
                <div style={{
                  marginTop: '0.5rem', padding: '0.75rem',
                  background: '#ede9fe', borderRadius: 'var(--radius)',
                  border: '1px solid #c4b5fd', fontSize: '0.8rem', color: '#5b21b6'
                }}>
                  Note: This is a resubmission. You can assign it to the same reviewer ({reviews[0].profiles?.name ?? '—'}) or a different one via Manage Journals.
                </div>
              )}
            </div>
          </div>

          {/* Previous Feedback (from prior submission rounds) */}
          {journal.prev_admin_comments && (
            <div className="card" style={{ borderTop: '4px solid var(--muted-foreground)', opacity: 0.85 }}>
              <div className="card-header"><div className="card-title">Previous Round Feedback</div></div>
              <div className="card-content space-y-3">
                <div>
                  <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Your Previous Comments</p>
                  <p className="text-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{journal.prev_admin_comments}</p>
                </div>
                {journal.prev_reviewer_comments && (
                  <div>
                    <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Reviewer's Previous Comments</p>
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
                    <Download size={14} /> Previous Revision Report
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Admin Final Decision */}
          <div className="card">
            <div className="card-header"><div className="card-title">Final Decision</div></div>
            <div className="card-content">
              {!hasReviewerReport ? (
                <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--muted-foreground)' }}>
                  <p className="text-sm italic">⏳ Waiting for the reviewer to submit their report before you can make a decision.</p>
                </div>
              ) : !isEditingDecision && journal.admin_comments ? (
                /* ── Read-only view after decision is made ── */
                <div className="space-y-4 animate-fade-in">
                  <div>
                    <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Decision</p>
                    <span className={`status-${journal.status}`}>
                      {journal.status === 'accepted' ? 'Accepted' : journal.status === 'rejected' ? 'Rejected' : journal.status === 'rework' ? 'Rework Requested' : journal.status === 'approved' ? 'Approved' : 'Revision Required'}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Your Comments</p>
                    <p className="text-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{journal.admin_comments}</p>
                  </div>
                  {journal.approval_proof_url && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Documents</p>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                        onClick={async () => {
                          const { getSignedUrl } = await import('../../lib/storage')
                          const url = await getSignedUrl(supabase, journal.approval_proof_url)
                          if (url) window.open(url, '_blank', 'noreferrer')
                          else toast.error('Could not open file. Please try again.')
                        }}
                      >
                        <Download size={14} /> Download Proof of Approval (PDF)
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline w-full"
                    style={{ marginTop: '0.75rem', borderColor: 'var(--primary)', color: 'var(--primary)' }}
                    onClick={() => setIsEditingDecision(true)}
                  >
                    Edit Decision
                  </button>
                </div>
              ) : (
                /* ── Decision form ── */
                <form onSubmit={handleDecisionSubmit} className="space-y-4">
                  {/* Decision Selection */}
                  <div className="space-y-2">
                    <p className="text-sm text-muted" style={{ marginBottom: '0.25rem' }}>Select Decision:</p>
                    {decisionOptions.map(({ status, label, icon: Icon, color, bg }) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setSelectedDecision(status)}
                        className="btn btn-sm"
                        style={{
                          width: '100%',
                          justifyContent: 'flex-start',
                          gap: '0.5rem',
                          color: selectedDecision === status ? '#fff' : color,
                          background: selectedDecision === status ? color : bg,
                          border: `1px solid ${color}`,
                          fontWeight: selectedDecision === status ? 600 : 400,
                        }}
                      >
                        <Icon size={16} />
                        {label}
                        {selectedDecision === status && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', opacity: 0.9 }}>SELECTED</span>}
                      </button>
                    ))}
                  </div>

                  {selectedDecision && (
                    <>
                      {/* Admin Comments */}
                      <div className="form-group">
                        <label className="text-sm font-medium">Comments to Author <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}>(optional)</span></label>
                        <textarea
                          className="textarea"
                          rows={4}
                          placeholder="Provide your editorial comments for the author…"
                          value={adminComments}
                          onChange={e => setAdminComments(e.target.value)}
                        />
                      </div>

                      {/* Proof of Approval PDF — only for accepted */}
                      {selectedDecision === 'accepted' && (
                        <div className="form-group">
                          <label className="text-sm font-medium">Proof of Approval (PDF) <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}>(optional)</span></label>
                          {approvalFile || journal.approval_proof_url ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: 'var(--muted)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                              <span className="text-sm">{approvalFile ? approvalFile.name : 'Existing Document Uploaded'}</span>
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => {
                                setApprovalFile(null)
                                setJournal(prev => ({ ...prev, approval_proof_url: null }))
                              }}>Remove</button>
                            </div>
                          ) : (
                            <input type="file" accept=".pdf,application/pdf" className="input" style={{ padding: '0.4rem' }}
                              onChange={async e => { 
                                const file = e.target.files?.[0]
                                if (file) {
                                  if (file.type !== 'application/pdf') {
                                    return toast.error('Only PDF files are allowed')
                                  }
                                  if (file.size > 10 * 1024 * 1024) {
                                    return toast.error('File size must be less than 10MB')
                                  }
                                  const validMagicBytes = await isPdfMagicBytes(file)
                                  if (!validMagicBytes) {
                                    return toast.error('Invalid PDF file format')
                                  }
                                  setApprovalFile(file)
                                }
                              }} />
                          )}
                        </div>
                      )}

                      <div className="space-y-2">
                        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
                          {submitting ? 'Submitting Decision…' : (journal.admin_comments ? 'Save Decision' : 'Submit Final Decision')}
                        </button>
                        {journal.admin_comments && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ width: '100%' }}
                            onClick={() => {
                              setAdminComments(journal.admin_comments)
                              setSelectedDecision(journal.status)
                              setIsEditingDecision(false)
                            }}
                            disabled={submitting}
                          >
                            Cancel Edit
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
