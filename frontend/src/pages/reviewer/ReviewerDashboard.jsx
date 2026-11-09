import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, CheckCircle, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function ReviewerDashboard() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) fetchAssigned() }, [user])

  async function fetchAssigned() {
    setLoading(true)
    setFetchError(false)

    // Fetch assignments for this reviewer with journal info
    const { data: assignments, error: assignErr } = await supabase
      .from('assignments')
      .select(`id, accepted_at, created_at, journals ( id, title, review_level, created_at )`)
      .eq('reviewer_id', user.id)

    if (assignErr) {
      console.error('ReviewerDashboard: failed to load assignments', assignErr.message)
      setFetchError(true)
      setLoading(false)
      return
    }

    const journalIds = (assignments ?? []).map(a => a.journals?.id).filter(Boolean)

    // Check which ones this reviewer has already reviewed
    const { data: reviewedData, error: reviewErr } = await supabase
      .from('reviews')
      .select('journal_id, created_at')
      .eq('reviewer_id', user.id)
      .in('journal_id', journalIds.length ? journalIds : ['none'])

    if (reviewErr) {
      console.error('ReviewerDashboard: failed to load reviews', reviewErr.message)
      setFetchError(true)
      setLoading(false)
      return
    }

    const reviewsMap = {}
    for (const r of (reviewedData ?? [])) {
      reviewsMap[r.journal_id] = r
    }

    setItems((assignments ?? []).filter(a => a.journals).map(a => {
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
        reviewStatus,
      }
    }))
    setLoading(false)
  }

  const total = items.length
  const pending = items.filter(j => j.reviewStatus === 'pending' || j.reviewStatus === 'pending_accept').length
  const completed = items.filter(j => j.reviewStatus === 'completed').length

  const stats = [
    { label: 'Total Assigned', value: total, icon: ClipboardList, color: 'var(--primary)' },
    { label: 'Assigned', value: pending, icon: Clock, color: '#d97706' },
    { label: 'Completed', value: completed, icon: CheckCircle, color: '#059669' },
  ]

  const pendingJournals = items.filter(j => j.reviewStatus === 'pending_accept' || j.reviewStatus === 'pending').slice(0, 3)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Reviewer Dashboard</h1>
        <p className="page-subtitle">Manage your assigned journal reviews</p>
      </div>

      <div className="stats-grid stats-grid-3">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card">
            <div className="card-content stat-card">
              <div className="stat-icon" style={{ color }}><Icon size={24} /></div>
              <div>
                <p className="stat-val">{loading ? '—' : value}</p>
                <p className="stat-label">{label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Assigned Reviews */}
      <div className="card">
        <div className="card-header">
          <div className="section-card-header">
            <div>
              <div className="card-title">Assigned Reviews</div>
              <div className="card-description">Journals awaiting your review</div>
            </div>
            <Link to="/reviewer/assigned" className="btn btn-outline btn-sm">
              View All
            </Link>
          </div>
        </div>
        <div className="card-content space-y-4">
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : fetchError ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--destructive)' }}>
              <p className="text-sm">Failed to load assigned reviews. Please check your connection.</p>
              <button className="btn btn-outline btn-sm" style={{ marginTop: '0.75rem' }} onClick={fetchAssigned}>Retry</button>
            </div>
          ) : pendingJournals.length === 0 ? (
            <p className="text-sm text-muted">No assigned reviews</p>
          ) : pendingJournals.map(j => (
            <div key={j.id} className="submission-item">
              <div>
                <h3 className="font-medium">{j.title}</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <span className="text-xs text-muted">Submitted Date: {new Date(j.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className={j.reviewStatus === 'pending_accept' ? 'status-under_review' : 'status-pending'}>
                  {j.reviewStatus === 'pending_accept' ? 'Pending Acceptance' : 'Assigned Review'}
                </span>
                <Link to="/reviewer/assigned" className="btn btn-primary btn-sm">
                  View
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">Review Guidelines</div></div>
        <div className="card-content">
          <p className="text-sm text-muted" style={{ marginBottom: '0.5rem' }}>Please evaluate each submission based on:</p>
          <ul className="list-disc text-sm text-muted">
            <li>Originality and contribution to the field</li>
            <li>Methodology and research design</li>
            <li>Clarity and organization</li>
            <li>Proper citations and references</li>
            <li>Overall quality and presentation</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
