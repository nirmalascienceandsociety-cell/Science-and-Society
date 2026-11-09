import { useEffect, useState } from 'react'
import { Search, UserCheck, UserX, RefreshCw, ChevronDown, ChevronUp, FileText, Calendar, User } from 'lucide-react'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import ConfirmModal from '../../components/ConfirmModal'
import { sendNotification } from '../../lib/api'

export default function AssignedPapers() {
  const toast = useToast()
  const [papers, setPapers] = useState([])   // journals under_review with their assignment + reviewer
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)

  // Confirm modal state
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmData, setConfirmData] = useState(null)   // { journalId, assignmentId, reviewerName, journalTitle }
  const [confirmLoading, setConfirmLoading] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchAssigned is stable and intentionally mount-only
  useEffect(() => { fetchAssigned() }, [])


  async function fetchAssigned() {
    setLoading(true)
    const { data, error } = await supabase
      .from('journals')
      .select(`
        id, title, abstract, keywords, file_url, created_at,
        resubmission_count, status,
        profiles(name, id),
        assignments(id, reviewer_id, accepted_at, profiles(name, id))
      `)
      .eq('status', 'under_review')
      .order('created_at', { ascending: false })

    if (error) {
      toast.error('Failed to load assigned papers')
      setLoading(false)
      return
    }
    setPapers(data ?? [])
    setLoading(false)
  }

  function triggerUnassign(journalId, assignmentId, reviewerName, journalTitle, reviewerId, acceptedAt) {
    setConfirmData({ journalId, assignmentId, reviewerName, journalTitle, reviewerId, acceptedAt })
    setConfirmOpen(true)
  }

  async function handleConfirmUnassign() {
    if (!confirmData) return
    setConfirmLoading(true)

    const { journalId, assignmentId, reviewerName, journalTitle, reviewerId, acceptedAt } = confirmData
    const isAccepted = Boolean(acceptedAt)

    // 1. Delete assignment and update status atomically via RPC (pass p_force if already accepted)
    const { error: rpcErr } = await supabase.rpc('unassign_reviewer_from_journal', {
      p_journal_id: journalId,
      p_assignment_id: assignmentId,
      p_force: isAccepted
    })

    if (rpcErr) {
      toast.error(rpcErr.message || 'Failed to unassign reviewer')
      setConfirmLoading(false)
      return
    }

    // 2. Send email + in-app notification to the reviewer
    let emailFailed = false
    if (reviewerId) {
      const endpoint = isAccepted ? '/api/notify/force-unassign' : '/api/notify/unassign-reviewer'
      const res = await sendNotification(endpoint, {
        reviewerId,
        reviewerName: reviewerName || 'Reviewer',
        journalTitle: journalTitle || 'Manuscript'
      })
      if (!res || !res.ok) emailFailed = true
    }

    // 3. Remove from local state
    setPapers(prev => prev.filter(p => p.id !== journalId))

    setConfirmLoading(false)
    setConfirmOpen(false)
    setConfirmData(null)

    if (emailFailed) {
      toast.error('Reviewer unassigned, but email notification failed.', { duration: 5000 })
    } else {
      toast.success(`${reviewerName} unassigned — paper moved back to Assign Reviewers`)
    }
  }

  const filtered = papers.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    (p.profiles?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.assignments?.[0]?.profiles?.name ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Assigned Papers</h1>
          <p className="page-subtitle">
            Manuscripts currently under review — manage reviewer assignments
          </p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={fetchAssigned} disabled={loading}>
          <RefreshCw size={14} style={{ marginRight: '0.4rem' }} />
          Refresh
        </button>
      </div>

      {/* ── Summary Banner ── */}
      {!loading && (
        <div style={{
          display: 'flex', gap: '1rem', flexWrap: 'wrap'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
            border: '1px solid #bfdbfe',
            borderRadius: '0.75rem',
            padding: '1rem 1.5rem',
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            minWidth: '180px'
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <UserCheck size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1d4ed8', lineHeight: 1 }}>
                {papers.length}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: 500, marginTop: '0.15rem' }}>
                Under Review
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Search ── */}
      <div style={{ position: 'relative', maxWidth: '420px' }}>
        <Search size={16} style={{
          position: 'absolute', left: '0.75rem', top: '50%',
          transform: 'translateY(-50%)', color: 'var(--muted-foreground)'
        }} />
        <input
          className="input input-icon-left"
          style={{ paddingLeft: '2.5rem' }}
          placeholder="Search by title, author or reviewer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--muted-foreground)', padding: '2rem 0' }}>
          <div className="spinner-sm" />
          <span className="text-sm">Loading assigned papers…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem',
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: '0.75rem',
        }}>
          <UserCheck size={48} style={{ color: 'var(--muted-foreground)', margin: '0 auto 1rem', opacity: 0.4 }} />
          <p style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: '0.4rem' }}>
            {search ? 'No papers match your search' : 'No papers currently under review'}
          </p>
          <p className="text-sm text-muted">
            {search
              ? 'Try a different search term.'
              : 'Once a reviewer is assigned to a manuscript, it will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(paper => {
            const assignment = paper.assignments?.[0]
            const reviewerName = assignment?.profiles?.name ?? '—'
            const isExpanded = expanded === paper.id
            const isReworked = (paper.resubmission_count ?? 0) > 0

            return (
              <div
                key={paper.id}
                className="card"
                style={{
                  borderLeft: '4px solid #2563eb',
                  transition: 'box-shadow 0.2s ease',
                }}
              >
                <div className="card-content" style={{ paddingTop: '1.25rem' }}>

                  {/* ── Card Header ── */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap'
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Title + rework badge */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <h3 style={{
                          fontSize: '0.95rem', fontWeight: 700,
                          color: 'var(--foreground)', margin: 0, lineHeight: 1.4
                        }}>
                          {paper.title}
                        </h3>
                        {isReworked && (
                          <span style={{
                            background: '#ede9fe', color: '#6d28d9',
                            border: '1px solid #ddd6fe', borderRadius: '9999px',
                            padding: '0.1rem 0.5rem', fontSize: '0.65rem', fontWeight: 700,
                            flexShrink: 0
                          }}>
                            Revision #{paper.resubmission_count}
                          </span>
                        )}
                      </div>

                      {/* Meta row */}
                      <div style={{
                        display: 'flex', gap: '1rem', flexWrap: 'wrap',
                        marginTop: '0.5rem', alignItems: 'center'
                      }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                          <User size={12} />
                          {paper.profiles?.name ?? '—'}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                          <Calendar size={12} />
                          {new Date(paper.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    {/* Right actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0, flexWrap: 'wrap' }}>
                      {/* Reviewer badge */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        background: '#eff6ff', border: '1px solid #bfdbfe',
                        borderRadius: '9999px', padding: '0.3rem 0.75rem',
                      }}>
                        <UserCheck size={13} color="#2563eb" />
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1d4ed8' }}>
                          {reviewerName}
                        </span>
                      </div>

                      {/* Acceptance status badge */}
                      {assignment && (
                        <span style={{
                          fontSize: '0.72rem', fontWeight: 700,
                          padding: '0.25rem 0.6rem', borderRadius: '9999px',
                          background: assignment.accepted_at ? '#d1fae5' : '#fef3c7',
                          color: assignment.accepted_at ? '#065f46' : '#92400e',
                          border: `1px solid ${assignment.accepted_at ? '#a7f3d0' : '#fde68a'}`,
                        }}>
                          {assignment.accepted_at ? '✓ Accepted' : '⏳ Pending Acceptance'}
                        </span>
                      )}

                      {/* Unassign button */}
                      {assignment && (
                        <button
                          className="btn btn-sm"
                          style={{
                            background: '#fef2f2', color: '#dc2626',
                            border: '1px solid #fecaca',
                            display: 'flex', alignItems: 'center', gap: '0.35rem',
                          }}
                          onClick={() => triggerUnassign(paper.id, assignment.id, reviewerName, paper.title, assignment.reviewer_id, assignment.accepted_at)}
                          title={assignment.accepted_at ? "Reviewer has accepted. Unassigning will force-revoke their assignment." : "Unassign reviewer and return paper to assignment queue"}
                        >
                          <UserX size={13} />
                          {assignment.accepted_at ? 'Force Unassign' : 'Unassign'}
                        </button>
                      )}

                      {/* Expand toggle */}
                      <button
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--muted-foreground)', display: 'flex', padding: '0.25rem'
                        }}
                        onClick={() => setExpanded(isExpanded ? null : paper.id)}
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* ── Keywords ── */}
                  {paper.keywords && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.75rem' }}>
                      {paper.keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => (
                        <span key={k} className="badge badge-secondary" style={{ fontSize: '0.68rem' }}>{k}</span>
                      ))}
                    </div>
                  )}

                  {/* ── Expandable Detail Panel ── */}
                  {isExpanded && (
                    <div style={{
                      marginTop: '1rem', paddingTop: '1rem',
                      borderTop: '1px solid var(--border)',
                      display: 'flex', flexDirection: 'column', gap: '1rem'
                    }}>
                      {/* Abstract — SEC-004: render as text only, never as href */}
                      <div>
                        <p style={{
                          fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.07em', color: 'var(--muted-foreground)', marginBottom: '0.4rem'
                        }}>
                          Abstract
                        </p>
                        <p style={{
                          fontSize: '0.84rem', lineHeight: 1.65,
                          color: 'var(--foreground)', whiteSpace: 'pre-wrap',
                          maxHeight: '180px', overflowY: 'auto'
                        }}>
                          {paper.abstract || '—'}
                        </p>
                      </div>

                      {/* Full Manuscript */}
                      {paper.file_url && (
                        <div>
                          <p style={{
                            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                            letterSpacing: '0.07em', color: 'var(--muted-foreground)', marginBottom: '0.4rem'
                          }}>
                            Full Manuscript
                          </p>
                          <button
                            onClick={async () => {
                              const { getSignedUrl } = await import('../../lib/storage')
                              const url = await getSignedUrl(supabase, paper.file_url)
                              if (url) window.open(url, '_blank', 'noreferrer')
                            }}
                            className="btn btn-primary btn-sm"
                            style={{ display: 'inline-flex', gap: '0.4rem' }}
                          >
                            <FileText size={13} /> Open Full Paper PDF
                          </button>
                        </div>
                      )}

                      {/* Reviewer info box */}
                      <div style={{
                        background: '#eff6ff', border: '1px solid #bfdbfe',
                        borderRadius: '0.5rem', padding: '0.875rem',
                        display: 'flex', alignItems: 'center', gap: '0.75rem'
                      }}>
                        <UserCheck size={18} color="#2563eb" style={{ flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem' }}>
                            Assigned Reviewer
                          </p>
                          <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e40af' }}>
                            {reviewerName}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Confirm Unassign Modal ── */}
      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmData(null) }}
        onConfirm={handleConfirmUnassign}
        title={confirmData?.acceptedAt ? "Force Revoke Assignment?" : "Unassign Reviewer?"}
        message={
          confirmData?.acceptedAt
            ? `⚠️ ${confirmData?.reviewerName ?? 'The reviewer'} has already accepted this assignment! Force revoking will revoke their assignment, send them an email notification, and return "${confirmData?.journalTitle ?? 'this paper'}" to the assignment queue.`
            : `This will remove ${confirmData?.reviewerName ?? 'the reviewer'} from "${confirmData?.journalTitle ?? 'this paper'}" and return it to the assignment queue.`
        }
        confirmText={confirmData?.acceptedAt ? "Force Revoke" : "Unassign"}
        loading={confirmLoading}
        type="danger"
      />
    </div>
  )
}
