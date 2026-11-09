import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { FileText, ArrowLeft, Download, CheckCircle, Upload, Check, X, AlertTriangle, Edit3, Calendar, Clock, ArrowRight, Eye, AlertCircle } from 'lucide-react'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { sendNotification } from '../../lib/api'

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

// Only reviewer-safe statuses — admin decisions are protected/private
const statusLabels = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  revision_required: 'Revision Required',
  rework: 'Revision Required',
}
// Helper: always return a displayable label — defensive default for any future status added
const getStatusLabel = (status) => statusLabels[status] ?? 'In Progress'
// Statuses that are admin-only and must not be shown to reviewers
const adminOnlyStatuses = new Set(['approved', 'accepted', 'published', 'rejected'])

// Helper: format authors & co-authors
function getAuthorsDisplay(j) {
  if (!j) return { authorStr: '', coAuthorsStr: '' }
  let authorsArr = []
  if (Array.isArray(j.authors)) {
    authorsArr = j.authors
  } else if (typeof j.authors === 'string') {
    try {
      const parsed = JSON.parse(j.authors)
      if (Array.isArray(parsed)) authorsArr = parsed
    } catch {
      // not JSON array
    }
  }

  if (authorsArr.length > 0) {
    const mainList = authorsArr
      .filter(a => typeof a === 'object' && a !== null ? (a.is_corresponding || a.role === 'corresponding' || a.role === 'first_author') : true)
      .map(a => typeof a === 'string' ? a : a.name)
      .filter(Boolean)

    const coList = authorsArr
      .filter(a => typeof a === 'object' && a !== null && (a.role === 'co_author' || (!a.is_corresponding && a.role !== 'corresponding' && a.role !== 'first_author')))
      .map(a => typeof a === 'string' ? a : a.name)
      .filter(Boolean)

    const authorStr = mainList.length > 0 ? mainList.join(', ') : (j.author_name || j.profiles?.name || '')
    const coAuthorsStr = coList.join(', ')
    return { authorStr, coAuthorsStr }
  }

  const authorStr = j.author_name || j.profiles?.name || ''
  return { authorStr, coAuthorsStr: '' }
}

/* ── Assigned Journals List ───────────────────────────────────────── */
export function AssignedJournals() {
  const { user, profile } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [actionLoadingId, setActionLoadingId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) fetchAssigned() }, [user])

  async function fetchAssigned() {
    setLoading(true)
    const { data, error } = await supabase
      .from('assignments')
      .select(`
        id,
        accepted_at,
        created_at,
        journals (
          id, title, abstract, keywords, status, review_level, resubmission_count, created_at, authors, author_name, profiles(name)
        )
      `)
      .eq('reviewer_id', user.id)
      .limit(500)

    if (error) { setLoading(false); return }

    const journalIds = (data ?? []).map(a => a.journals?.id).filter(Boolean)
    const { data: reviewedData } = await supabase
      .from('reviews')
      .select('journal_id, created_at')
      .eq('reviewer_id', user.id)
      .in('journal_id', journalIds.length ? journalIds : ['none'])
      .limit(500)

    const reviewsMap = {}
    for (const r of (reviewedData ?? [])) {
      reviewsMap[r.journal_id] = r
    }

    setItems(
      (data ?? [])
        .filter(a => a.journals)
        .map(a => {
          let reviewStatus = 'pending_accept'
          if (!a.accepted_at) {
            reviewStatus = 'pending_accept'
          } else {
            const rev = reviewsMap[a.journals.id]
            if (rev) {
              reviewStatus = 'completed'
            } else {
              reviewStatus = 'pending'
            }
          }
          return {
            ...a.journals,
            assignmentId: a.id,
            acceptedAt: a.accepted_at,
            reviewStatus,
          }
        })
    )
    setLoading(false)
  }

  async function handleAccept(item) {
    setActionLoadingId(item.assignmentId)
    const { error } = await supabase.rpc('reviewer_respond_to_assignment', {
      p_assignment_id: item.assignmentId,
      p_accept: true,
    })
    setActionLoadingId(null)
    if (error) {
      toast.error(error.message || 'Failed to accept assignment')
      return
    }
    toast.success(`Accepted assignment for "${item.title.slice(0, 30)}…"`)
    fetchAssigned()
  }

  async function handleDecline(item) {
    if (!window.confirm(`Are you sure you want to decline reviewing "${item.title}"?`)) return
    setActionLoadingId(item.assignmentId)

    const { error } = await supabase.rpc('reviewer_respond_to_assignment', {
      p_assignment_id: item.assignmentId,
      p_accept: false,
    })

    if (error) {
      setActionLoadingId(null)
      toast.error(error.message || 'Failed to decline assignment')
      return
    }

    await sendNotification('/api/notify/reject-assignment', {
      journalTitle: item.title,
      reviewerName: profile?.name || user?.name || 'Reviewer',
    })

    setActionLoadingId(null)
    toast.success(`Declined review request for "${item.title.slice(0, 30)}…"`)
    fetchAssigned()
  }

  const filtered = filter === 'all' 
    ? items 
    : items.filter(j => j.reviewStatus === filter)

  const pendingAcceptCount = items.filter(i => i.reviewStatus === 'pending_accept').length
  const pendingCount = items.filter(i => i.reviewStatus === 'pending').length
  const completedCount = items.filter(i => i.reviewStatus === 'completed').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 className="page-title">Assigned Manuscripts</h1>
        <p className="page-subtitle">Manage, accept, and conduct peer reviews for your assigned submissions</p>
      </div>

      {/* Filter Tabs Bar */}
      <div className="reviewer-filter-bar">
        {[
          { id: 'all', label: 'All Submissions', count: items.length, badgeBg: 'var(--muted)', badgeColor: 'var(--foreground)' },
          { id: 'pending_accept', label: 'Pending Acceptance', count: pendingAcceptCount, badgeBg: pendingAcceptCount > 0 ? '#fef3c7' : 'var(--muted)', badgeColor: pendingAcceptCount > 0 ? '#d97706' : 'var(--muted-foreground)' },
          { id: 'pending', label: 'Assigned (Accepted)', count: pendingCount, badgeBg: 'var(--muted)', badgeColor: 'var(--foreground)' },
          { id: 'completed', label: 'Completed Reviews', count: completedCount, badgeBg: 'var(--muted)', badgeColor: 'var(--foreground)' },
        ].map(f => {
          const isActive = filter === f.id
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.4rem 0.9rem',
                borderRadius: '9999px',
                border: isActive ? '1px solid var(--primary)' : '1px solid var(--border)',
                background: isActive ? 'var(--primary)' : 'var(--card)',
                color: isActive ? '#ffffff' : 'var(--foreground)',
                fontSize: '0.8rem', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.18s ease',
                boxShadow: isActive ? '0 2px 8px rgba(29, 78, 216, 0.2)' : 'none',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {f.label}
              <span style={{
                background: isActive ? 'rgba(255,255,255,0.25)' : f.badgeBg,
                color: isActive ? '#ffffff' : f.badgeColor,
                fontSize: '0.7rem', fontWeight: 700,
                padding: '0.1rem 0.4rem', borderRadius: '9999px',
              }}>
                {f.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Manuscript Cards List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--muted-foreground)' }}>
            <p className="text-sm">Loading assigned manuscripts…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '3rem 1rem',
            color: 'var(--muted-foreground)', background: 'var(--card)',
            borderRadius: '0.75rem', border: '1px dashed var(--border)'
          }}>
            <FileText size={32} style={{ opacity: 0.35, marginBottom: '0.5rem' }} />
            <p style={{ fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No manuscripts match this filter.</p>
          </div>
        ) : filtered.map(j => {
          const isPendingAccept = j.reviewStatus === 'pending_accept'
          const isAccepted = j.reviewStatus === 'pending'
          const isCompleted = j.reviewStatus === 'completed'
          const isExpanded = expandedId === j.id

          return (
            <div
              key={j.id}
              className="reviewer-card"
              style={{
                background: 'var(--card)',
                borderRadius: '0.75rem',
                border: '1px solid var(--border)',
                borderLeft: isPendingAccept ? '4px solid #f59e0b' : isAccepted ? '4px solid #10b981' : '1px solid var(--border)',
                boxShadow: 'var(--shadow-card)',
                padding: '1rem 1.25rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: '0.75rem',
                transition: 'all 0.18s ease',
              }}
            >
              {/* Top Header Bar: Status Badges (Left) & Submitted Date (Right) */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '0.75rem', flexWrap: 'wrap', width: '100%',
                paddingBottom: '0.6rem', borderBottom: '1px solid var(--border)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <span
                    className={adminOnlyStatuses.has(j.status) ? 'status-under_review' : `status-${j.status}`}
                    style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.12rem 0.55rem', borderRadius: '9999px' }}
                  >
                    {adminOnlyStatuses.has(j.status) ? 'Under Review' : getStatusLabel(j.status)}
                  </span>

                  {j.resubmission_count > 0 && (
                    <span style={{
                      background: 'rgba(234, 88, 12, 0.1)', color: '#ea580c',
                      border: '1px solid rgba(234, 88, 12, 0.3)',
                      borderRadius: '4px', padding: '0.1rem 0.45rem',
                      fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase'
                    }}>
                      Rework
                    </span>
                  )}

                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
                    color: isPendingAccept ? '#d97706' : isAccepted ? '#059669' : '#2563eb'
                  }}>
                    • {isPendingAccept ? 'Pending Acceptance' : isAccepted ? 'Accepted' : 'Completed'}
                  </span>
                </div>

                <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                  <Calendar size={12} style={{ opacity: 0.65 }} />
                  Submitted Date: {new Date(j.created_at).toLocaleDateString()}
                </span>
              </div>

              {/* Main Card Content Row: Left Details & Right Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.25rem', flexWrap: 'wrap', width: '100%' }}>
                {/* Left Info Column */}
                <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <h3 style={{
                    fontFamily: "var(--font-serif, 'EB Garamond', Georgia, serif)",
                    fontSize: '1.15rem',
                    fontWeight: 600,
                    color: 'var(--foreground)',
                    margin: 0,
                    lineHeight: 1.3,
                  }}>
                    {j.title}
                  </h3>

                  {(() => {
                    const { authorStr, coAuthorsStr } = getAuthorsDisplay(j)
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem' }}>
                        {authorStr && (
                          <div style={{ color: 'var(--muted-foreground)' }}>
                            <strong style={{ color: 'var(--foreground)', fontWeight: 600 }}>Author(s): </strong>{authorStr}
                          </div>
                        )}
                        {coAuthorsStr && (
                          <div style={{ color: 'var(--muted-foreground)' }}>
                            <strong style={{ color: 'var(--foreground)', fontWeight: 600 }}>Co-Author(s): </strong>{coAuthorsStr}
                          </div>
                        )}
                        {j.keywords && (
                          <div style={{ color: 'var(--muted-foreground)' }}>
                            <strong style={{ color: 'var(--foreground)', fontWeight: 600 }}>Keywords: </strong>{j.keywords}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {/* Right Action Column */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
                  <button
                    onClick={() => toggleExpand(j.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      padding: '0.42rem 0.8rem', borderRadius: '0.375rem',
                      background: isExpanded ? 'var(--primary)' : 'var(--muted)',
                      color: isExpanded ? '#ffffff' : 'var(--foreground)',
                      border: '1px solid var(--border)', fontSize: '0.78rem', fontWeight: 600,
                      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease'
                    }}
                  >
                    <Eye size={13} /> {isExpanded ? 'Hide Abstract' : 'View Abstract'}
                  </button>

                  {isPendingAccept && (
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        disabled={actionLoadingId === j.assignmentId}
                        onClick={() => handleAccept(j)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                          padding: '0.4rem 0.85rem', borderRadius: '0.375rem',
                          background: '#10b981', color: '#ffffff', border: 'none',
                          fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                          whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(16, 185, 129, 0.2)'
                        }}
                      >
                        <Check size={14} /> Accept Review
                      </button>
                      <button
                        disabled={actionLoadingId === j.assignmentId}
                        onClick={() => handleDecline(j)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          padding: '0.4rem 0.7rem', borderRadius: '0.375rem',
                          background: 'rgba(239, 68, 68, 0.08)', color: '#ef4444',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <X size={13} /> Decline
                      </button>
                    </div>
                  )}

                  {isAccepted && (
                    <Link
                      to={`/reviewer/review/${j.id}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        padding: '0.4rem 0.9rem', borderRadius: '0.375rem',
                        background: 'var(--primary)', color: '#ffffff', textDecoration: 'none',
                        fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap'
                      }}
                    >
                      <Edit3 size={14} /> Conduct Review
                    </Link>
                  )}

                  {isCompleted && (
                    <Link
                      to={`/reviewer/review/${j.id}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        padding: '0.4rem 0.85rem', borderRadius: '0.375rem',
                        background: 'var(--card)', color: 'var(--foreground)',
                        border: '1px solid var(--border)', textDecoration: 'none',
                        fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap'
                      }}
                    >
                      <CheckCircle size={14} style={{ color: '#10b981' }} /> View Review
                    </Link>
                  )}
                </div>
              </div>

              {/* Expandable Abstract & Details Drawer */}
              {isExpanded && (
                <div style={{
                  borderTop: '1px solid var(--border)',
                  paddingTop: '0.75rem',
                  marginTop: '0.1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  fontSize: '0.82rem',
                  color: 'var(--foreground)',
                  background: 'var(--bg-section, rgba(0,0,0,0.02))',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--muted-foreground)', letterSpacing: '0.04em', margin: '0 0 0.3rem 0' }}>
                      Abstract
                    </p>
                    <p style={{ margin: 0, lineHeight: 1.55, fontSize: '0.85rem' }}>
                      {j.abstract || 'No abstract text available for this manuscript.'}
                    </p>
                  </div>

                  {j.keywords && (
                    <div>
                      <p style={{ fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--muted-foreground)', letterSpacing: '0.04em', margin: '0 0 0.25rem 0' }}>
                        Keywords
                      </p>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                        {j.keywords}
                      </p>
                    </div>
                  )}

                  {/* Security notice regarding PDF file download */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.74rem', color: isPendingAccept ? '#d97706' : '#059669', marginTop: '0.2rem' }}>
                    <AlertCircle size={13} />
                    <span>
                      {isPendingAccept 
                        ? 'Full manuscript PDF download is protected and will be unlocked after you accept the review assignment.'
                        : 'Full manuscript PDF download is available on the review page.'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Review Detail / Form ─────────────────────────────────────────── */
export function ReviewJournal() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user, profile } = useAuth()

  const [journal, setJournal] = useState(null)
  const [assignment, setAssignment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [comments, setComments] = useState('')
  const [revisionFile, setRevisionFile] = useState(null)
  const [existingReportUrl, setExistingReportUrl] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [existing, setExisting] = useState(null)
  const [confirmRead, setConfirmRead] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [isReplacingFile, setIsReplacingFile] = useState(false)
  const [acceptingAssignment, setAcceptingAssignment] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchJournal() }, [id])

  async function fetchJournal() {
    setLoading(true)
    const [journalRes, reviewRes, assignmentRes] = await Promise.all([
      supabase.from('journals').select('id, title, abstract, status, review_level, resubmission_count, created_at, file_url, keywords, authors, author_name, profiles(name)').eq('id', id).single(),
      supabase.from('reviews').select('*').eq('journal_id', id).eq('reviewer_id', user?.id).maybeSingle(),
      supabase.from('assignments').select('id, accepted_at').eq('journal_id', id).eq('reviewer_id', user?.id).maybeSingle(),
    ])
    setJournal(journalRes.data ?? null)
    setAssignment(assignmentRes.data ?? null)

    if (reviewRes.data) {
      setExisting(reviewRes.data)
      setComments(reviewRes.data.comments)
      setExistingReportUrl(reviewRes.data.revision_report_url ?? null)
    }
    setLoading(false)
  }

  async function handleAcceptAssignment() {
    if (!assignment) return
    setAcceptingAssignment(true)
    const { error } = await supabase.rpc('reviewer_respond_to_assignment', {
      p_assignment_id: assignment.id,
      p_accept: true,
    })
    setAcceptingAssignment(false)
    if (error) {
      toast.error(error.message || 'Failed to accept assignment')
      return
    }
    toast.success('Assignment accepted! You can now complete your review.')
    setAssignment(prev => ({ ...prev, accepted_at: new Date().toISOString() }))
  }

  if (loading) return <p className="text-muted text-sm" style={{ padding: '2rem' }}>Loading…</p>
  if (!journal) return <p>Journal not found.</p>

  const isAccepted = Boolean(assignment?.accepted_at)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isAccepted) {
      toast.error('You must accept the assignment before submitting a review.')
      return
    }
    if (!confirmRead) {
      toast.error('Please confirm that you have downloaded and read the full manuscript.')
      return
    }
    if (!comments.trim()) { toast.error('Please provide review comments'); return }

    if (!existing && !revisionFile) {
      toast.error('Please upload the Revision Report PDF'); return
    }

    setSubmitting(true)

    try {
      let revisionUrl = existingReportUrl
      if (revisionFile) {
        if (revisionFile.size > 10 * 1024 * 1024) {
          toast.error('File size must be under 10MB')
          setSubmitting(false)
          return
        }
        const validPdf = await isPdfMagicBytes(revisionFile)
        if (!validPdf) {
          toast.error('Invalid file format. Please upload a valid PDF document.')
          setSubmitting(false)
          return
        }
        const fileName = `reviewer/${user.id}/revision_${Date.now()}.pdf`
        const { error: upErr } = await supabase.storage
          .from('journals')
          .upload(fileName, revisionFile, { cacheControl: '3600', upsert: false })
        if (upErr) throw upErr
        revisionUrl = fileName
      }

      const payload = {
        journal_id: id,
        reviewer_id: user.id,
        decision: null,
        comments,
        revision_report_url: revisionUrl,
        originality: null,
        methodology: null,
        clarity: null,
        refs: null,
        overall: null,
      }

      if (existing) {
        const { error } = await supabase.from('reviews').update(payload).eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('reviews').insert(payload)
        if (error) throw error
      }

      const res = await sendNotification('/api/notify/review', {
        journalId: journal.id,
        studentId: journal.student_id,
        reviewerName: profile?.name,
        journalTitle: journal.title
      });
      
      setExistingReportUrl(revisionUrl)
      
      if (!res || !res.ok) {
        toast.error('Review submitted, but failed to send email notification.', { duration: 5000 });
      } else {
        toast.success('Review report submitted successfully!')
      }
      navigate('/reviewer/assigned')
    } catch (err) {
      toast.error(err.message || 'Failed to submit review.')
    }
    setSubmitting(false)
  }

  return (
    <div className="space-y-6">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/reviewer/assigned')}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="page-title" style={{ margin: 0, fontSize: '1.25rem' }}>Review Journal</h1>
        {existing && <span className="badge badge-secondary">Previously Submitted</span>}
        {journal.resubmission_count > 0 && (
          <span className="badge" style={{ background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>
            Resubmission #{journal.resubmission_count}
          </span>
        )}
      </div>

      {/* Acceptance Banner if reviewer has not yet accepted */}
      {!isAccepted && (
        <div style={{
          background: '#fef3c7', border: '1px solid #f59e0b',
          borderRadius: '0.75rem', padding: '1.25rem 1.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '1rem', flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertTriangle size={24} style={{ color: '#d97706', flexShrink: 0 }} />
            <div>
              <p style={{ fontWeight: 700, color: '#92400e', margin: 0, fontSize: '0.95rem' }}>
                Pending Review Acceptance
              </p>
              <p style={{ fontSize: '0.85rem', color: '#b45309', margin: '0.2rem 0 0' }}>
                Please review the paper details below and accept the assignment to begin your review.
              </p>
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={acceptingAssignment}
            onClick={handleAcceptAssignment}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Check size={16} /> {acceptingAssignment ? 'Accepting…' : 'Accept Assignment Now'}
          </button>
        </div>
      )}

      <div className="space-y-6">
        {/* Journal info card */}
        <div className="card">
          <div className="card-header" style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
            {/* Submitted date + optional rework label above title */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <div>
                {journal.resubmission_count > 0 && (
                  <span style={{
                    background: 'rgba(234, 88, 12, 0.1)', color: '#ea580c',
                    border: '1px solid rgba(234, 88, 12, 0.3)',
                    borderRadius: '4px', padding: '0.15rem 0.55rem',
                    fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase'
                  }}>Rework</span>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <Calendar size={12} style={{ opacity: 0.65 }} />
                Submitted Date: {new Date(journal.created_at).toLocaleDateString()}
              </span>
            </div>
            <div className="card-title" style={{ fontSize: '1.6rem', marginBottom: '0.5rem', color: 'var(--foreground)' }}>{journal.title}</div>
          </div>
          <div className="card-content space-y-6">
            {/* Authors, Co-Authors & Keywords */}
            {(() => {
              const { authorStr, coAuthorsStr } = getAuthorsDisplay(journal)
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', fontSize: '0.92rem', paddingBottom: '0.25rem' }}>
                  {authorStr && (
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>Author(s): </span>
                      <span style={{ color: 'var(--muted-foreground)' }}>{authorStr}</span>
                    </div>
                  )}
                  {coAuthorsStr && (
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>Co-Authors: </span>
                      <span style={{ color: 'var(--muted-foreground)' }}>{coAuthorsStr}</span>
                    </div>
                  )}
                  {journal.keywords && (
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>Keywords: </span>
                      <span style={{ color: 'var(--muted-foreground)' }}>{journal.keywords}</span>
                    </div>
                  )}
                </div>
              )
            })()}
            <div>
              <p style={{ fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', color: 'var(--foreground)' }}>Abstract</p>
              {journal.abstract?.startsWith('http') ? (
                <a href={journal.abstract} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ display: 'inline-flex', marginTop: '0.25rem' }}>
                  <Download size={16} style={{ marginRight: '0.5rem' }} /> Download Abstract
                </a>
              ) : (
                <p style={{ fontSize: '1.05rem', lineHeight: '1.75', color: 'var(--foreground)' }}>{journal.abstract}</p>
              )}
            </div>
            {journal.file_url && (
              <div style={{ paddingTop: '1rem' }}>
                {isAccepted ? (
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
                      style={{ boxShadow: '0 4px 12px color-mix(in srgb, var(--primary) 20%, transparent)', padding: '0.5rem 1rem' }}
                      onClick={async () => {
                        const { getSignedUrl } = await import('../../lib/storage')
                        const url = await getSignedUrl(supabase, journal.file_url)
                        if (url) window.open(url, '_blank', 'noreferrer')
                        else toast.error('Could not open file. Please try again.')
                      }}
                    >
                      <Download size={16} /> Download Manuscript
                    </button>
                  </div>
                ) : (
                  <div style={{
                    padding: '0.85rem 1.15rem',
                    borderRadius: '0.75rem',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    fontSize: '0.85rem', color: '#b45309'
                  }}>
                    <AlertTriangle size={18} style={{ color: '#d97706', flexShrink: 0 }} />
                    <span>You must accept the review assignment above to unlock and download the full manuscript PDF document.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Previous Feedback (from prior submission rounds if present) */}
        {journal.prev_reviewer_comments && (
          <div className="card" style={{ borderTop: '4px solid var(--muted-foreground)' }}>
            <div className="card-header">
              <div className="card-title">
                {journal.prev_reviewer_name && profile?.name !== journal.prev_reviewer_name 
                  ? 'Previous Review' 
                  : 'Your Previous Review'}
              </div>
            </div>
            <div className="card-content space-y-3">
              <div>
                <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                  {journal.prev_reviewer_name && profile?.name !== journal.prev_reviewer_name 
                    ? "Reviewer's Comments" 
                    : 'Your Comments'}
                </p>
                <p className="text-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{journal.prev_reviewer_comments}</p>
              </div>
              {journal.prev_revision_report_url && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  onClick={async () => {
                    const { getSignedUrl } = await import('../../lib/storage')
                    const url = await getSignedUrl(supabase, journal.prev_revision_report_url)
                    if (url) window.open(url, '_blank', 'noreferrer')
                    else toast.error('Could not open file. Please try again.')
                  }}
                >
                  <Download size={14} /> Download Previous Revision Report
                </button>
              )}
            </div>
          </div>
        )}

        {/* View-only summary when review already exists and not editing */}
        {existing && !editMode ? (
          <div className="card" style={{ borderLeft: '4px solid var(--primary)' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle size={18} style={{ color: 'var(--primary)' }} />
                Your Submitted Review Report
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setEditMode(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Edit3 size={14} /> Edit Review
              </button>
            </div>
            <div className="card-content space-y-4">
              <div>
                <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                  Review Comments
                </p>
                <p className="text-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, background: 'var(--muted)', padding: '1rem', borderRadius: 'var(--radius)' }}>
                  {existing.comments || 'No written comments provided.'}
                </p>
              </div>
              {existingReportUrl && (
                <div>
                  <p className="text-xs font-semibold text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                    Revision Report (PDF)
                  </p>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={async () => {
                      const { getSignedUrl } = await import('../../lib/storage')
                      const url = await getSignedUrl(supabase, existingReportUrl)
                      if (url) window.open(url, '_blank', 'noreferrer')
                      else toast.error('Could not open file. Please try again.')
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <Download size={14} /> Download Submitted Report PDF
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Editable Form */
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                {existing ? 'Update Review Report' : 'Submit Review Report'}
              </div>
            </div>
            <div className="card-content">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Comments */}
                <div className="form-group">
                  <label>Review Comments <span style={{ color: 'red' }}>*</span></label>
                  <textarea className="textarea" rows={5}
                    placeholder="Provide detailed feedback on the paper — originality, methodology, clarity, references, and overall assessment…"
                    value={comments} onChange={e => setComments(e.target.value)} required />
                </div>

                {/* Revision Report PDF Upload */}
                <div className="form-group">
                  <label>
                    Revision Report (PDF) <span style={{ color: 'red' }}>*</span>
                  </label>
                  <p className="text-xs text-muted" style={{ marginBottom: '0.5rem' }}>
                    Upload your formal review report as a PDF. This will be shared with the admin for the final decision.
                  </p>

                  {/* Show existing uploaded file if already submitted */}
                  {existing && existingReportUrl && !revisionFile && !isReplacingFile ? (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.75rem', background: 'var(--muted)',
                      borderRadius: 'var(--radius)', border: '1px solid var(--border)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <FileText size={16} style={{ color: 'var(--primary)' }} />
                        <span className="text-sm font-medium">Revision Report (Uploaded)</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button 
                          type="button" 
                          className="btn btn-outline btn-sm"
                          onClick={async () => {
                            const { getSignedUrl } = await import('../../lib/storage')
                            const url = await getSignedUrl(supabase, existingReportUrl)
                            if (url) window.open(url, '_blank', 'noreferrer')
                            else toast.error('Could not open file. Please try again.')
                          }}
                        >
                          <Download size={13} /> View
                        </button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setIsReplacingFile(true)}>
                          Replace
                        </button>
                      </div>
                    </div>
                  ) : revisionFile ? (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.75rem', background: 'var(--muted)',
                      borderRadius: 'var(--radius)', border: '1px solid var(--border)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <FileText size={16} style={{ color: 'var(--primary)' }} />
                        <span className="text-sm">{revisionFile.name}</span>
                      </div>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => { setRevisionFile(null); setIsReplacingFile(false); }}>Remove</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        padding: '1.5rem', borderRadius: 'var(--radius)',
                        border: '2px dashed var(--border)', cursor: 'pointer',
                        background: 'var(--muted)', gap: '0.5rem',
                        transition: 'border-color 0.2s'
                      }}>
                        <Upload size={24} style={{ color: 'var(--primary)', opacity: 0.7 }} />
                        <span className="text-sm font-medium">Click to upload PDF</span>
                        <span className="text-xs text-muted">Only PDF files accepted</span>
                        <input type="file" accept=".pdf" style={{ display: 'none' }}
                          onChange={e => { if (e.target.files?.[0]) setRevisionFile(e.target.files[0]) }} />
                      </label>
                      {isReplacingFile && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => setIsReplacingFile(false)}
                          style={{ alignSelf: 'flex-start' }}
                        >
                          Cancel Replace
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Mandatory Checkbox to prevent premature / accidental submissions */}
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  padding: '0.85rem 1rem', background: 'var(--muted)',
                  borderRadius: 'var(--radius)', border: '1px solid var(--border)'
                }}>
                  <input
                    type="checkbox"
                    id="confirmReadManuscript"
                    checked={confirmRead}
                    onChange={e => setConfirmRead(e.target.checked)}
                    style={{ width: '1.15rem', height: '1.15rem', marginTop: '0.1rem', cursor: 'pointer' }}
                  />
                  <label htmlFor="confirmReadManuscript" style={{ cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'var(--foreground)', lineHeight: 1.4 }}>
                    I confirm that I have downloaded and thoroughly read the full manuscript before submitting this review.
                  </label>
                </div>

                <div className="page-footer-actions">
                  {existing && (
                    <button type="button" className="btn btn-outline" onClick={() => setEditMode(false)}>
                      Cancel Editing
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitting || !isAccepted || !confirmRead}
                  >
                    {submitting ? 'Submitting…' : <><CheckCircle size={16} /> {existing ? 'Update Review Report' : 'Submit Review Report'}</>}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
