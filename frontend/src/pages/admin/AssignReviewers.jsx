import { useEffect, useState, useMemo } from 'react'
import {
  Search, ChevronDown, ChevronUp, RefreshCw, Users, FileText,
  RotateCcw, UserCheck, ArrowUpDown,
  Zap, UserMinus, Mail, Calendar, CheckCircle2
} from 'lucide-react'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import ConfirmModal from '../../components/ConfirmModal'
import { sendNotification } from '../../lib/api'

// ── Workload colour helpers ────────────────────────────────────────────────
function workloadColor(count) {
  if (count === 0) return { bg: '#d1fae5', text: '#065f46', dot: '#10b981', label: 'Free' }
  if (count <= 3) return { bg: '#fef9c3', text: '#713f12', dot: '#eab308', label: 'Moderate' }
  return { bg: '#fee2e2', text: '#7f1d1d', dot: '#ef4444', label: 'Heavy' }
}

function WorkloadBadge({ count, showLabel = false }) {
  const c = workloadColor(count)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
      background: c.bg, color: c.text,
      fontSize: '0.72rem', fontWeight: 700,
      padding: '0.25rem 0.65rem', borderRadius: '9999px',
      whiteSpace: 'nowrap', flexShrink: 0,
      border: `1px solid ${c.dot}44`
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {count} {count === 1 ? 'paper' : 'papers'} {showLabel && `(${c.label})`}
    </span>
  )
}

// ── Filter Tab ─────────────────────────────────────────────────────────────
function FilterTab({ label, count, active, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.35rem 0.85rem',
        borderRadius: '9999px',
        border: active ? `2px solid ${color}` : '1px solid var(--border)',
        background: active ? color : 'var(--card)',
        color: active ? '#fff' : 'var(--foreground)',
        fontSize: '0.78rem', fontWeight: 600,
        cursor: 'pointer', transition: 'all 0.15s ease',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      <span style={{
        background: active ? 'rgba(255,255,255,0.25)' : 'var(--muted)',
        color: active ? '#fff' : 'var(--muted-foreground)',
        fontSize: '0.68rem', fontWeight: 700,
        padding: '0.05rem 0.38rem', borderRadius: '9999px',
      }}>{count}</span>
    </button>
  )
}

export default function AssignReviewers() {
  const toast = useToast()
  const [journals, setJournals]             = useState([])
  const [allJournals, setAllJournals]       = useState([])
  const [reviewers, setReviewers]           = useState([])
  const [assignments, setAssignments]       = useState({})   // { journalId: [{ id, reviewer_id, profiles }] }
  const [selected, setSelected]             = useState(null)
  const [search, setSearch]                 = useState('')
  const [filter, setFilter]                 = useState('all')
  const [loading, setLoading]               = useState(true)
  const [viewMode, setViewMode]             = useState('papers') // 'papers' | 'reviewers'
  const [sortOrder, setSortOrder]           = useState('oldest') // 'oldest' | 'newest'

  // Inline selection per paper card: { [journalId]: reviewerId }
  const [inlineSelectedReviewers, setInlineSelectedReviewers] = useState({})

  // Confirmation modal for unassigning
  const [confirmOpen, setConfirmOpen]       = useState(false)
  const [confirmData, setConfirmData]       = useState(null)
  const [confirmLoading, setConfirmLoading] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    setSelected(null)
    const [journalsRes, reviewersRes, assignmentsRes] = await Promise.all([
      supabase
        .from('journals')
        .select('id, title, abstract, keywords, file_url, created_at, resubmission_count, prev_admin_comments, prev_reviewer_comments, prev_reviewer_name, profiles(name, id), student_id')
        .in('status', ['submitted', 'pending', 'rework', 'revision_required'])
        .order('resubmission_count', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('profiles')
        .select('id, name, email, role, status, created_at')
        .eq('role', 'reviewer')
        .eq('status', 'active')
        .limit(200),
      supabase
        .from('assignments')
        .select('id, journal_id, reviewer_id, accepted_at, profiles(name)')
        .limit(1000),
    ])

    if (journalsRes.error) toast.error('Failed to load journals')
    if (reviewersRes.error) toast.error('Failed to load reviewers')
    if (assignmentsRes.error) toast.error('Failed to load assignments')

    const jData = journalsRes.data ?? []
    setJournals(jData)
    setAllJournals(jData)
    setReviewers(reviewersRes.data ?? [])

    const grouped = {}
    for (const a of assignmentsRes.data ?? []) {
      if (!grouped[a.journal_id]) grouped[a.journal_id] = []
      grouped[a.journal_id].push(a)
    }
    setAssignments(grouped)
    setLoading(false)
  }

  async function assignReviewer(journalId, reviewer) {
    const current = assignments[journalId] ?? []
    if (current.some(a => a.reviewer_id === reviewer.id)) {
      toast.error(`${reviewer.name} is already assigned to this paper`)
      return false
    }
    if (current.length >= 1) {
      toast.error('Only 1 reviewer allowed per paper. Unassign the existing one first.')
      return false
    }

    const { error } = await supabase.rpc('assign_reviewer_to_journal', {
      p_journal_id: journalId,
      p_reviewer_id: reviewer.id
    })
    if (error) { toast.error(error.message || 'Failed to assign reviewer'); return false }

    const { data } = await supabase
      .from('assignments')
      .select('id, journal_id, reviewer_id, profiles(name)')
      .eq('journal_id', journalId)
      .eq('reviewer_id', reviewer.id)
      .single()

    if (data) {
      setAssignments(prev => ({ ...prev, [journalId]: [...(prev[journalId] ?? []), data] }))
    }

    const journal = allJournals.find(j => j.id === journalId)

    // Remove this paper from the list immediately — it's now under_review and belongs in Assigned Papers
    setJournals(prev => prev.filter(j => j.id !== journalId))
    setAllJournals(prev => prev.filter(j => j.id !== journalId))
    if (selected === journalId) setSelected(null)

    if (journal) {
      let emailFailed = false
      const revRes = await sendNotification('/api/notify/assign', {
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        journalTitle: journal.title,
        isRework: (journal.resubmission_count ?? 0) > 0
      })
      if (!revRes || !revRes.ok) emailFailed = true

      if (journal.student_id) {
        const stuRes = await sendNotification('/api/notify/sent-for-review', {
          studentId: journal.student_id,
          studentName: journal.profiles?.name || 'Author',
          journalTitle: journal.title
        })
        if (!stuRes || !stuRes.ok) emailFailed = true
      }

      if (emailFailed) {
        toast.error('Assigned! But email notification failed.', { duration: 5000 })
      } else {
        toast.success(`${reviewer.name} assigned to "${journal.title.slice(0, 35)}${journal.title.length > 35 ? '…' : ''}"`)
      }
    } else {
      toast.success(`${reviewer.name} assigned successfully!`)
    }
    return true
  }

  async function removeReviewer(journalId, assignmentId, reviewerName, reviewerId, journalTitle, acceptedAt) {
    const isAccepted = Boolean(acceptedAt)
    const { error } = await supabase.rpc('unassign_reviewer_from_journal', {
      p_journal_id: journalId,
      p_assignment_id: assignmentId,
      p_force: isAccepted
    })
    if (error) { toast.error('Failed to unassign reviewer: ' + error.message); return }

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

    const remaining = (assignments[journalId] ?? []).filter(a => a.id !== assignmentId)
    setAssignments(prev => ({ ...prev, [journalId]: remaining }))

    if (emailFailed) {
      toast.error('Unassigned reviewer, but email notification failed.', { duration: 5000 })
    } else {
      toast.success(`Unassigned ${reviewerName || 'Reviewer'} & notified by email.`)
    }
  }

  function triggerRemove(journalId, assignmentId, reviewerName, journalTitle, reviewerId, acceptedAt) {
    setConfirmData({ journalId, assignmentId, reviewerName, journalTitle, reviewerId, acceptedAt })
    setConfirmOpen(true)
  }

  async function handleConfirmRemove() {
    if (!confirmData) return
    setConfirmLoading(true)
    await removeReviewer(
      confirmData.journalId,
      confirmData.assignmentId,
      confirmData.reviewerName,
      confirmData.reviewerId,
      confirmData.journalTitle,
      confirmData.acceptedAt
    )
    setConfirmLoading(false)
    setConfirmOpen(false)
    setConfirmData(null)
  }

  // ── Workload per reviewer ────────────────────────────────────────────────
  const reviewerWorkloads = useMemo(() => {
    const counts = {}
    const papers  = {}
    for (const reviewer of reviewers) { counts[reviewer.id] = 0; papers[reviewer.id] = [] }
    for (const [jid, assignList] of Object.entries(assignments)) {
      const journal = allJournals.find(j => j.id === jid)
      for (const a of assignList) {
        if (counts[a.reviewer_id] !== undefined) {
          counts[a.reviewer_id]++
          papers[a.reviewer_id].push({ journalId: jid, title: journal?.title ?? 'Unknown', assignmentId: a.id, reviewerId: a.reviewer_id, acceptedAt: a.accepted_at, reviewerName: a.profiles?.name, author: journal?.profiles?.name })
        }
      }
    }
    return { counts, papers }
  }, [reviewers, assignments, allJournals])

  // ── Categorised journals ────────────────────────────────────────────────
  const categorised = useMemo(() => ({
    reworks: journals.filter(j => (j.resubmission_count ?? 0) > 0),
    all:     journals,
  }), [journals])

  const filteredJournals = useMemo(() => {
    const base = filter === 'all' ? journals : (categorised[filter] ?? [])
    const searched = base.filter(j =>
      j.title.toLowerCase().includes(search.toLowerCase()) ||
      (j.profiles?.name ?? '').toLowerCase().includes(search.toLowerCase())
    )
    return [...searched].sort((a, b) => {
      const diff = new Date(a.created_at) - new Date(b.created_at)
      return sortOrder === 'oldest' ? diff : -diff
    })
  }, [filter, journals, categorised, search, sortOrder])

  // Least loaded reviewer helper
  const leastLoadedReviewer = useMemo(() => {
    if (reviewers.length === 0) return null
    return [...reviewers].sort((a, b) => (reviewerWorkloads.counts[a.id] ?? 0) - (reviewerWorkloads.counts[b.id] ?? 0))[0]
  }, [reviewers, reviewerWorkloads])

  // ───────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '100%' }}>

      {/* ── Page Header ───────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Assign Reviewers
            </h1>
            <p className="page-subtitle">Assign or unassign expert reviewers for journal submissions one paper at a time</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* View Mode Switcher */}
            <div style={{ display: 'inline-flex', background: 'var(--muted)', padding: '0.2rem', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
              <button
                onClick={() => setViewMode('papers')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.35rem 0.85rem', borderRadius: '0.375rem', fontSize: '0.8rem', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                  background: viewMode === 'papers' ? 'var(--card)' : 'transparent',
                  color: viewMode === 'papers' ? 'var(--foreground)' : 'var(--muted-foreground)',
                  boxShadow: viewMode === 'papers' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                <FileText size={14} />
                By Papers ({journals.length})
              </button>
              <button
                onClick={() => setViewMode('reviewers')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.35rem 0.85rem', borderRadius: '0.375rem', fontSize: '0.8rem', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                  background: viewMode === 'reviewers' ? 'var(--card)' : 'transparent',
                  color: viewMode === 'reviewers' ? 'var(--foreground)' : 'var(--muted-foreground)',
                  boxShadow: viewMode === 'reviewers' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                <Users size={14} />
                By Reviewers ({reviewers.length})
              </button>
            </div>

            <button
              className="btn btn-outline btn-sm"
              onClick={fetchAll}
              disabled={loading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats Summary Bar */}
        {!loading && (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
            {[
              { icon: RotateCcw,   label: 'Reworks',         value: categorised.reworks.length,    color: '#7c3aed' },
              { icon: Users,       label: 'Active Reviewers', value: reviewers.length,              color: '#2563eb' },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: '0.55rem',
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: '0.625rem', padding: '0.5rem 0.9rem',
                flex: '1 1 140px',
              }}>
                <span style={{ background: color + '18', borderRadius: '0.4rem', padding: '0.35rem', display: 'flex' }}>
                  <Icon size={15} style={{ color }} />
                </span>
                <div>
                  <p style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--foreground)' }}>{value}</p>
                  <p style={{ fontSize: '0.68rem', color: 'var(--muted-foreground)', margin: 0, fontWeight: 500 }}>{label}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Loading state */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--muted-foreground)', padding: '3rem 0', justifyContent: 'center' }}>
          <RefreshCw size={18} className="spin" />
          Loading manuscripts and reviewer workloads…
        </div>
      ) : viewMode === 'papers' ? (
        /* ── VIEW MODE 1: PAPERS VIEW (Clean paper list with one-by-one inline assign) ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

          {/* Search + Filter Tabs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', background: 'var(--card)', padding: '0.9rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--border)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }} />
              <input
                className="input"
                style={{ paddingLeft: '2.25rem', width: '100%' }}
                placeholder="Search by manuscript title or author name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <FilterTab label="All Manuscripts" count={categorised.all.length}    active={filter === 'all'}     color="#2563eb" onClick={() => setFilter('all')} />
                <FilterTab label="Reworks"         count={categorised.reworks.length} active={filter === 'reworks'} color="#7c3aed" onClick={() => setFilter('reworks')} />
              </div>
              {/* Sort toggle */}
              <button
                onClick={() => setSortOrder(s => s === 'oldest' ? 'newest' : 'oldest')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.3rem 0.75rem', borderRadius: '0.375rem',
                  border: '1px solid var(--border)', background: 'var(--muted)',
                  color: 'var(--foreground)', fontSize: '0.75rem', fontWeight: 600,
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
                title="Toggle sort order by submission date"
              >
                <ArrowUpDown size={13} />
                {sortOrder === 'oldest' ? 'Oldest First' : 'Newest First'}
              </button>
            </div>
          </div>

          {/* Journal Cards List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filteredJournals.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted-foreground)', background: 'var(--card)', borderRadius: '0.75rem', border: '1px dashed var(--border)' }}>
                <FileText size={30} style={{ marginBottom: '0.5rem', opacity: 0.4 }} />
                <p style={{ fontWeight: 600, fontSize: '0.9rem', margin: '0 0 0.25rem 0' }}>No manuscripts found</p>
                <p style={{ fontSize: '0.8rem', margin: 0 }}>Try adjusting your search query or switching active filters.</p>
              </div>
            )}

            {filteredJournals.map(j => {
              const assigned      = assignments[j.id] ?? []
              const isSelected    = selected === j.id
              const isUnassigned   = assigned.length === 0
              const isReworked    = (j.resubmission_count ?? 0) > 0

              const prevReviewerObj = j.prev_reviewer_name
                ? reviewers.find(r => r.name.trim().toLowerCase() === j.prev_reviewer_name.trim().toLowerCase())
                : null

              let borderColor = 'var(--border)'
              let bgColor = 'var(--card)'
              let shadow = 'none'

              if (isSelected) { borderColor = 'var(--primary)'; shadow = `0 0 0 3px var(--primary)22` }
              else if (isReworked && isUnassigned) { borderColor = 'color-mix(in srgb, #a78bfa 50%, var(--border))'; bgColor = 'color-mix(in srgb, #a78bfa 8%, var(--card))' }
              else if (isUnassigned) { borderColor = 'color-mix(in srgb, #ef4444 35%, var(--border))' }

              return (
                <div
                  key={j.id}
                  className="card"
                  style={{
                    borderColor, background: bgColor, boxShadow: shadow,
                    borderWidth: (isSelected || isReworked) ? '2px' : '1px',
                    transition: 'all 0.18s ease',
                  }}
                >
                  <div className="card-content" style={{ padding: '1rem 1.15rem' }}>
                    {/* Top Row: Title + Metadata + Status Badges */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setSelected(isSelected ? null : j.id)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                          <h3 style={{ fontWeight: 600, fontSize: '0.92rem', margin: 0, color: 'var(--foreground)', lineHeight: 1.35 }}>
                            {j.title}
                          </h3>
                          {isReworked && (
                            <span style={{
                              background: 'color-mix(in srgb, #a78bfa 18%, transparent)',
                              color: '#a78bfa',
                              border: '1px solid color-mix(in srgb, #a78bfa 35%, transparent)',
                              borderRadius: '9999px', padding: '0.12rem 0.5rem',
                              fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap'
                            }}>
                              Revision #{j.resubmission_count}
                            </span>
                          )}
                          {isUnassigned && !isReworked && (
                            <span style={{
                              background: 'color-mix(in srgb, #ef4444 18%, transparent)',
                              color: '#f87171',
                              border: '1px solid color-mix(in srgb, #ef4444 35%, transparent)',
                              borderRadius: '9999px', padding: '0.12rem 0.5rem',
                              fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap'
                            }}>
                              Needs Reviewer
                            </span>
                          )}
                          {!isUnassigned && (
                            <span style={{
                              background: 'color-mix(in srgb, #10b981 18%, transparent)',
                              color: '#34d399',
                              border: '1px solid color-mix(in srgb, #10b981 35%, transparent)',
                              borderRadius: '9999px', padding: '0.12rem 0.5rem',
                              fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap'
                            }}>
                              Assigned ✓
                            </span>
                          )}
                        </div>

                        <p style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', margin: 0 }}>
                          by <strong style={{ color: 'var(--foreground)', fontWeight: 600 }}>{j.profiles?.name ?? '—'}</strong> · Submitted on {new Date(j.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>

                      <button
                        onClick={() => setSelected(isSelected ? null : j.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--muted-foreground)' }}
                        title={isSelected ? 'Hide manuscript details' : 'View manuscript abstract & details'}
                      >
                        {isSelected ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                    </div>

                    {/* Assigned Reviewer Bar with CLEAR UNASSIGN BUTTON or Inline Assign Bar */}
                    <div style={{ marginTop: '0.75rem' }}>
                      {assigned.length > 0 ? (
                        <div style={{ background: 'var(--muted)35', padding: '0.65rem 0.85rem', borderRadius: '0.5rem', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {assigned.map(a => {
                            const revWorkload = reviewerWorkloads.counts[a.reviewer_id] ?? 1
                            return (
                              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                  <UserCheck size={16} style={{ color: '#16a34a', flexShrink: 0 }} />
                                  <span style={{ fontSize: '0.83rem', color: 'var(--foreground)' }}>
                                    Assigned Reviewer: <strong style={{ color: 'var(--foreground)', fontWeight: 700 }}>{a.profiles?.name ?? '—'}</strong>
                                    <span style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', marginLeft: '0.35rem' }}>
                                      ({revWorkload} {revWorkload === 1 ? 'paper total' : 'papers total'})
                                    </span>
                                  </span>
                                  <span style={{
                                    fontSize: '0.7rem', fontWeight: 700,
                                    padding: '0.15rem 0.5rem', borderRadius: '9999px',
                                    background: a.accepted_at ? '#d1fae5' : '#fef3c7',
                                    color: a.accepted_at ? '#065f46' : '#92400e',
                                    border: `1px solid ${a.accepted_at ? '#a7f3d0' : '#fde68a'}`,
                                    marginLeft: '0.35rem'
                                  }}>
                                    {a.accepted_at ? '✓ Accepted' : '⏳ Pending Acceptance'}
                                  </span>
                                </div>

                                <button
                                  onClick={() => triggerRemove(j.id, a.id, a.profiles?.name, j.title, a.reviewer_id, a.accepted_at)}
                                  className="btn btn-outline btn-sm"
                                  style={{ color: '#dc2626', borderColor: '#fca5a5', fontSize: '0.75rem', padding: '0.3rem 0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}
                                  title={a.accepted_at ? `Reviewer has accepted. Unassigning will force-revoke their assignment.` : `Unassign ${a.profiles?.name} from "${j.title}"`}
                                >
                                  <UserMinus size={14} />
                                  {a.accepted_at ? 'Force Unassign' : 'Unassign Reviewer'}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        /* ── INLINE DIRECT ONE-BY-ONE ASSIGNMENT BAR ── */
                        <div style={{ background: 'var(--muted)35', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <select
                              className="input"
                              style={{ flex: '1 1 240px', fontSize: '0.8rem', padding: '0.35rem 0.65rem', height: 'auto', background: 'var(--card)' }}
                              value={inlineSelectedReviewers[j.id] || ''}
                              onChange={e => setInlineSelectedReviewers(prev => ({ ...prev, [j.id]: e.target.value }))}
                            >
                              <option value="">Select Reviewer for this paper…</option>
                              {reviewers.map(r => {
                                const count = reviewerWorkloads.counts[r.id] ?? 0
                                const isPrev = j.prev_reviewer_name === r.name
                                return (
                                  <option key={r.id} value={r.id}>
                                    {r.name} — {count} {count === 1 ? 'paper assigned' : 'papers assigned'} {isPrev ? '(Previous Reviewer)' : ''}
                                  </option>
                                )
                              })}
                            </select>

                            <button
                              className="btn btn-primary btn-sm"
                              disabled={!inlineSelectedReviewers[j.id]}
                              onClick={async () => {
                                const revId = inlineSelectedReviewers[j.id]
                                const reviewer = reviewers.find(r => r.id === revId)
                                if (reviewer) {
                                  const ok = await assignReviewer(j.id, reviewer)
                                  if (ok) setInlineSelectedReviewers(prev => ({ ...prev, [j.id]: '' }))
                                }
                              }}
                              style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem', whiteSpace: 'nowrap' }}
                            >
                              Assign Reviewer
                            </button>
                          </div>

                          {/* 1-Click Smart Action Buttons */}
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {isReworked && prevReviewerObj && (
                              <button
                                onClick={() => assignReviewer(j.id, prevReviewerObj)}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                  background: 'color-mix(in srgb, #a78bfa 18%, transparent)',
                                  color: '#a78bfa',
                                  border: '1px solid color-mix(in srgb, #a78bfa 35%, transparent)',
                                  borderRadius: '0.375rem', padding: '0.2rem 0.55rem', fontSize: '0.7rem', fontWeight: 700,
                                  cursor: 'pointer', transition: 'all 0.15s ease',
                                }}
                                title={`Instantly assign previous reviewer ${prevReviewerObj.name}`}
                              >
                                <Zap size={12} />
                                Re-assign {prevReviewerObj.name} ({reviewerWorkloads.counts[prevReviewerObj.id] ?? 0} active)
                              </button>
                            )}

                            {leastLoadedReviewer && (
                              <button
                                onClick={() => assignReviewer(j.id, leastLoadedReviewer)}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                  background: 'color-mix(in srgb, #10b981 18%, transparent)',
                                  color: '#34d399',
                                  border: '1px solid color-mix(in srgb, #10b981 35%, transparent)',
                                  borderRadius: '0.375rem', padding: '0.2rem 0.55rem', fontSize: '0.7rem', fontWeight: 700,
                                  cursor: 'pointer', transition: 'all 0.15s ease',
                                }}
                                title={`Auto-assign to ${leastLoadedReviewer.name} (Lowest workload: ${reviewerWorkloads.counts[leastLoadedReviewer.id] ?? 0} papers assigned)`}
                              >
                                <Zap size={12} />
                                Assign Least Loaded ({leastLoadedReviewer.name.split(' ')[0]} — {reviewerWorkloads.counts[leastLoadedReviewer.id] ?? 0} assigned)
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Expandable Manuscript Detail Panel */}
                    {isSelected && (
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
                      >
                        <div>
                          <p style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted-foreground)', marginBottom: '0.35rem' }}>Abstract</p>
                          {/* SEC-004: Abstract is plain text — never use as href. */}
                          <p style={{ fontSize: '0.82rem', lineHeight: 1.65, color: 'var(--foreground)', whiteSpace: 'pre-wrap', maxHeight: '160px', overflowY: 'auto', margin: 0 }}>{j.abstract || 'No abstract provided.'}</p>
                        </div>

                        {j.keywords && (
                          <div>
                            <p style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted-foreground)', marginBottom: '0.35rem' }}>Keywords</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                              {j.keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => (
                                <span key={k} className="badge badge-secondary" style={{ fontSize: '0.7rem' }}>{k}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {j.file_url && (
                          <div>
                            <p style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted-foreground)', marginBottom: '0.35rem' }}>Full Manuscript</p>
                            <button
                              onClick={async () => {
                                const { getSignedUrl } = await import('../../lib/storage')
                                const url = await getSignedUrl(supabase, j.file_url)
                                if (url) window.open(url, '_blank', 'noreferrer')
                              }}
                              className="btn btn-primary btn-sm"
                              style={{ display: 'inline-flex', gap: '0.4rem' }}
                            >
                              Open Full Manuscript PDF
                            </button>
                          </div>
                        )}

                        {isReworked && (j.prev_admin_comments || j.prev_reviewer_comments) && (
                          <div style={{
                            background: 'color-mix(in srgb, #a78bfa 10%, var(--card))',
                            border: '1px solid color-mix(in srgb, #a78bfa 30%, transparent)',
                            borderRadius: '0.625rem', padding: '0.85rem'
                          }}>
                            <p style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#a78bfa', marginBottom: '0.5rem' }}>Previous Round Feedback</p>
                            {j.prev_admin_comments && (
                              <div style={{ marginBottom: '0.5rem' }}>
                                <p style={{ fontSize: '0.7rem', color: '#c4b5fd', fontWeight: 700, marginBottom: '0.15rem' }}>Editor's Comments</p>
                                <p style={{ fontSize: '0.8rem', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', margin: 0 }}>{j.prev_admin_comments}</p>
                              </div>
                            )}
                            {j.prev_reviewer_comments && (
                              <div>
                                <p style={{ fontSize: '0.7rem', color: '#c4b5fd', fontWeight: 700, marginBottom: '0.15rem' }}>Reviewer's Comments</p>
                                <p style={{ fontSize: '0.8rem', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto', margin: 0 }}>{j.prev_reviewer_comments}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* ── VIEW MODE 2: REVIEWERS VIEW (Reviewer Directory & Active Workload Dashboard) ── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.25rem' }}>
          {reviewers.map(r => {
            const workload = reviewerWorkloads.counts[r.id] ?? 0
            const activeJournals = reviewerWorkloads.papers[r.id] ?? []
            const initials = r.name ? r.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'R'
            const joinDate = r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : null

            return (
              <div
                key={r.id}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.85rem',
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Card Top Banner / Profile Header */}
                <div style={{ padding: '1.1rem 1.2rem', borderBottom: '1px solid var(--border)', background: 'linear-gradient(180deg, var(--muted)30 0%, var(--card) 100%)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                    
                    {/* Avatar & Basic Info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', minWidth: 0, flex: 1 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #2563eb18, #3b82f635)',
                        color: '#2563eb', fontWeight: 800, fontSize: '0.95rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1.5px solid #2563eb30', flexShrink: 0,
                        boxShadow: '0 2px 4px rgba(37,99,235,0.08)'
                      }}>
                        {initials}
                      </div>

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <h3 style={{ fontSize: '1.02rem', fontWeight: 700, margin: 0, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.name}
                          </h3>
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, color: '#34d399',
                            background: 'color-mix(in srgb, #10b981 16%, transparent)',
                            border: '1px solid color-mix(in srgb, #10b981 35%, transparent)',
                            padding: '0.08rem 0.45rem', borderRadius: '9999px',
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap'
                          }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399' }} />
                            Active Reviewer
                          </span>
                        </div>

                        {r.email && (
                          <p style={{ fontSize: '0.76rem', color: 'var(--muted-foreground)', margin: '0.2rem 0 0 0', display: 'flex', alignItems: 'center', gap: '0.3rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Mail size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
                            {r.email}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Workload Pill */}
                    <WorkloadBadge count={workload} showLabel={true} />
                  </div>

                  {/* Quick Metrics Bar inside Header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '1rem',
                    marginTop: '0.85rem', paddingTop: '0.65rem',
                    borderTop: '1px stroke var(--border)',
                    borderTopStyle: 'dashed', borderTopWidth: '1px',
                    fontSize: '0.72rem', color: 'var(--muted-foreground)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <FileText size={13} style={{ color: '#2563eb' }} />
                      <span>Assigned: <strong style={{ color: 'var(--foreground)', fontWeight: 700 }}>{workload}</strong></span>
                    </div>

                    {joinDate && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Calendar size={13} style={{ opacity: 0.6 }} />
                        <span>Joined: <strong style={{ color: 'var(--foreground)', fontWeight: 600 }}>{joinDate}</strong></span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Body - Active Manuscripts List */}
                <div style={{ padding: '1rem 1.2rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <FileText size={13} style={{ opacity: 0.7 }} />
                      Currently Assigned Manuscripts ({activeJournals.length})
                    </span>
                  </div>

                  {activeJournals.length === 0 ? (
                    <div style={{
                      background: 'var(--muted)15',
                      border: '1px dashed var(--border)',
                      borderRadius: '0.6rem',
                      padding: '1.25rem 1rem',
                      textAlign: 'center',
                      color: 'var(--muted-foreground)',
                      marginTop: '0.2rem',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}>
                      <CheckCircle2 size={20} style={{ color: '#10b981', opacity: 0.8 }} />
                      <p style={{ fontSize: '0.8rem', margin: 0, fontWeight: 600, color: 'var(--foreground)' }}>
                        Available for Assignment
                      </p>
                      <p style={{ fontSize: '0.72rem', margin: 0, color: 'var(--muted-foreground)' }}>
                        No active manuscripts are currently assigned to this reviewer.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', maxHeight: '280px', overflowY: 'auto' }}>
                      {activeJournals.map(ap => (
                        <div key={ap.journalId} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.65rem',
                          background: 'var(--card)', padding: '0.65rem 0.85rem', borderRadius: '0.5rem',
                          border: '1px solid var(--border)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                        }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--foreground)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ap.title}
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.15rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)' }}>
                                Author: <strong style={{ fontWeight: 600, color: 'var(--foreground)' }}>{ap.author ?? '—'}</strong>
                              </span>
                              <span style={{
                                fontSize: '0.64rem', fontWeight: 700,
                                padding: '0.08rem 0.45rem', borderRadius: '9999px',
                                background: ap.acceptedAt ? 'color-mix(in srgb, #10b981 16%, transparent)' : 'color-mix(in srgb, #f59e0b 16%, transparent)',
                                color: ap.acceptedAt ? '#34d399' : '#fbbf24',
                                border: `1px solid ${ap.acceptedAt ? 'color-mix(in srgb, #10b981 35%, transparent)' : 'color-mix(in srgb, #f59e0b 35%, transparent)'}`
                              }}>
                                {ap.acceptedAt ? '✓ Accepted' : '⏳ Pending'}
                              </span>
                            </div>
                          </div>

                          <button
                            onClick={() => triggerRemove(ap.journalId, ap.assignmentId, r.name, ap.title, r.id, ap.acceptedAt)}
                            className="btn btn-outline btn-sm"
                            style={{
                              padding: '0.28rem 0.65rem', fontSize: '0.72rem', color: '#f87171',
                              borderColor: 'color-mix(in srgb, #ef4444 35%, transparent)',
                              background: 'color-mix(in srgb, #ef4444 12%, transparent)',
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                              fontWeight: 600, flexShrink: 0, borderRadius: '0.375rem'
                            }}
                            title={ap.acceptedAt ? `Force revoke assignment of "${ap.title}"` : `Unassign ${r.name} from "${ap.title}"`}
                          >
                            <UserMinus size={12} />
                            Unassign
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Confirmation Modal for Unassigning */}
      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmRemove}
        title={confirmData?.acceptedAt ? "Force Revoke Assignment?" : "Unassign Reviewer?"}
        message={
          confirmData?.acceptedAt
            ? `⚠️ ${confirmData?.reviewerName ?? 'The reviewer'} has already accepted this assignment! Force revoking will revoke their assignment, send them an email notification, and return "${confirmData?.journalTitle ?? 'this paper'}" to the assignment queue.`
            : `Are you sure you want to unassign ${confirmData?.reviewerName ?? 'the reviewer'} from "${confirmData?.journalTitle ?? 'this paper'}"?`
        }
        confirmText={confirmData?.acceptedAt ? "Force Revoke" : "Unassign Reviewer"}
        loading={confirmLoading}
        type="danger"
      />
    </div>
  )
}
