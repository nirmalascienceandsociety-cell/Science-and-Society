import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Calendar, Users, FileText, AlertCircle, Eye, Quote } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sendNotification, API_BASE } from '../lib/api'
import { AnimatedSection } from '../components/ui/AnimatedSection'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import CitationModal from '../components/CitationModal'

export default function PaperDetail() {
  const toast = useToast()
  const { id } = useParams()
  const { user, profile } = useAuth()
  const [paper, setPaper] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [citationModalOpen, setCitationModalOpen] = useState(false)

  // Request form state
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', affiliation: '', reason: '', website_url: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (user || profile) {
      setForm(prev => ({
        ...prev,
        name: profile?.name || prev.name,
        email: user?.email || prev.email
      }))
    }
  }, [user, profile])

  useEffect(() => {
    async function fetchPaper() {
      const { data, error } = await supabase
        .from('published_issues')
        .select('*')
        .eq('id', id)
        .single()

      if (error || !data) {
        setNotFound(true)
      } else {
        setPaper(data)

        // Session-throttled atomic view count tracking
        const storageKey = `viewed_paper_${id}`
        if (!sessionStorage.getItem(storageKey)) {
          sessionStorage.setItem(storageKey, '1')
          fetch(`${API_BASE}/api/metrics/paper-view/${id}`, { method: 'POST' }).catch(() => {})
          setPaper(prev => prev ? { ...prev, views_count: (prev.views_count || 0) + 1 } : prev)
        }
      }
      setLoading(false)
    }
    fetchPaper()
  }, [id])

  const getAuthorsData = (p) => {
    if (!p) return { allNames: '—', correspondingAuthor: null, otherAuthors: [] }

    let allAuthors = []
    if (Array.isArray(p.authors) && p.authors.length > 0) {
      allAuthors = p.authors.map(a => typeof a === 'string' ? { name: a, is_corresponding: false } : a)
    } else if (p.author_name) {
      allAuthors = [{ name: p.author_name, is_corresponding: false }]
    }

    if (allAuthors.length === 0) return { allNames: '—', correspondingAuthor: null, otherAuthors: [] }

    const allNames = allAuthors.map(a => a.name).join(', ')

    let correspondingAuthor = allAuthors.find(a => a.is_corresponding)
    let otherAuthors = allAuthors.filter(a => !a.is_corresponding)

    if (!correspondingAuthor) {
      correspondingAuthor = allAuthors[0]
      otherAuthors = allAuthors.slice(1)
    }

    return { allNames, correspondingAuthor, otherAuthors }
  }

  async function handleRequestSubmit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) return
    setSubmitting(true)
    try {
      // SEC-002: paper_requests insert is now handled securely in the backend AFTER CAPTCHA validation.
      const res = await sendNotification('/api/notify/paper-request', {
        journalId: paper.id, // Passed to backend for insert
        requesterName: form.name.trim(),
        requesterEmail: form.email.trim(),
        journalTitle: paper.title,
        affiliation: form.affiliation.trim(),
        reason: form.reason.trim(),
        website_url: form.website_url, // HONEYPOT
      })
      if (!res || !res.ok) {
        toast.error('Failed to submit request. Please try again.')
      } else {
        setSubmitted(true)
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to submit request. Please try again.')
    }
    setSubmitting(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '6rem' }}>
      <div className="spinner" />
    </div>
  )

  if (notFound) return (
    <div style={{ textAlign: 'center', padding: '6rem 1.5rem' }}>
      <AlertCircle size={64} style={{ margin: '0 auto 1.5rem', opacity: 0.3 }} />
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Paper Not Found</h2>
      <p className="text-muted">This paper may not be published yet or the link is invalid.</p>
      <Link to="/published-papers" className="btn btn-primary" style={{ marginTop: '1.5rem', display: 'inline-flex' }}>
        Browse All Papers
      </Link>
    </div>
  )

  const { correspondingAuthor, otherAuthors } = getAuthorsData(paper)
  const publishDate = paper.published_at || paper.created_at

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
      {/* Back nav */}
      <AnimatedSection direction="up">
        <Link to="/published-papers" className="btn btn-primary btn-sm" style={{ marginBottom: '1.5rem', display: 'inline-flex' }}>
          Back to All Papers
        </Link>
      </AnimatedSection>

      {/* Paper Header */}
      <AnimatedSection direction="up" delay={0.05}>
        <div style={{ marginBottom: '2rem' }}>
          {/* Volume / Issue badges */}
          {(paper.volume_number || paper.issue_number) && (
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              {paper.volume_number && (
                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.65rem', borderRadius: '999px', background: 'var(--primary)', color: '#fff' }}>
                  {paper.volume_number}
                </span>
              )}
              {paper.issue_number && (
                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.65rem', borderRadius: '999px', background: 'var(--gold, #d97706)', color: '#fff' }}>
                  {paper.issue_number}
                </span>
              )}
            </div>
          )}

          <h1 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 800, lineHeight: 1.3, marginBottom: '1.25rem', color: 'var(--foreground)' }}>
            {paper.title}
          </h1>

          {/* Metadata & Metrics pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem', color: 'var(--muted-foreground)', background: 'var(--muted)', padding: '0.45rem 0.9rem', borderRadius: '999px', border: '1px solid var(--border)' }}>
              <Users size={15} style={{ color: 'var(--primary)' }} />
              <span style={{ fontWeight: 500, color: 'var(--foreground)' }}>{correspondingAuthor ? correspondingAuthor.name : 'Unknown Author'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem', color: 'var(--muted-foreground)', background: 'var(--muted)', padding: '0.45rem 0.9rem', borderRadius: '999px', border: '1px solid var(--border)' }}>
              <Calendar size={15} style={{ color: 'var(--primary)' }} />
              <span style={{ fontWeight: 500, color: 'var(--foreground)' }}>Published {new Date(publishDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>

            {/* Views Metric */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.95rem', color: 'var(--foreground)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)', padding: '0.45rem 0.9rem', borderRadius: '999px' }}>
              <Eye size={15} style={{ color: 'var(--primary)' }} />
              <span style={{ fontWeight: 700 }}>{paper.views_count || 0}</span>
              <span style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem' }}>Views</span>
            </div>

            {/* Citations Metric */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.95rem', color: 'var(--foreground)', background: 'color-mix(in srgb, var(--gold, #d97706) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--gold, #d97706) 30%, transparent)', padding: '0.45rem 0.9rem', borderRadius: '999px' }}>
              <Quote size={15} style={{ color: 'var(--gold, #d97706)' }} />
              <span style={{ fontWeight: 700 }}>{paper.citations_count || 0}</span>
              <span style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem' }}>Citations</span>
            </div>

            {/* Cite Paper Button */}
            <button
              onClick={() => setCitationModalOpen(true)}
              className="btn btn-outline btn-sm"
              style={{
                borderRadius: '999px', fontSize: '0.88rem', fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                borderColor: 'var(--primary)', color: 'var(--primary)', marginLeft: 'auto'
              }}
            >
              <Quote size={14} /> Cite Paper
            </button>
          </div>

          {/* Authors list */}
          {(correspondingAuthor || otherAuthors.length > 0) && (
            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-foreground)', marginBottom: '0.75rem', fontWeight: 600 }}>Authors</p>

              {/* Corresponding Author (Main) */}
              {correspondingAuthor && (
                <div style={{ marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.05rem', padding: '0.45rem 1rem', borderRadius: 'var(--radius)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)', color: 'var(--foreground)', fontWeight: 600, display: 'inline-block' }}>
                    {correspondingAuthor.name}
                  </span>
                </div>
              )}

              {/* Other Authors */}
              {otherAuthors.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                  {otherAuthors.map((author, i) => (
                    <span key={i} style={{ fontSize: '0.95rem', padding: '0.35rem 0.85rem', borderRadius: 'var(--radius)', background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
                      {author.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </AnimatedSection>

      {/* Keywords */}
      {paper.keywords && (
        <AnimatedSection direction="up" delay={0.1}>
          <div style={{ marginBottom: '2.5rem' }}>
            <p style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-foreground)', marginBottom: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Keywords
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              {paper.keywords.split(',').map((kw, i) => (
                <span key={i} style={{ fontSize: '0.95rem', padding: '0.3rem 0.85rem', borderRadius: '999px', background: 'var(--muted)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}>
                  {kw.trim()}
                </span>
              ))}
            </div>
          </div>
        </AnimatedSection>
      )}

      {/* Abstract */}
      <AnimatedSection direction="up" delay={0.15}>
        <div style={{
          marginBottom: '3rem',
          background: 'linear-gradient(to bottom right, var(--card), rgba(255,255,255,0.02))',
          border: '1px solid var(--border)',
          borderRadius: '1.25rem',
          padding: '2.5rem',
          boxShadow: '0 12px 40px rgba(0,0,0,0.03)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Subtle decorative accent */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: 'var(--primary)', opacity: 0.8 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.35rem', fontWeight: 700, color: 'var(--foreground)', marginBottom: '1.5rem', letterSpacing: '-0.01em' }}>
            <FileText size={22} style={{ color: 'var(--primary)' }} /> Abstract
          </div>
          <div style={{ fontSize: '1.12rem', lineHeight: 1.85, color: 'var(--foreground)', letterSpacing: '0.01em' }}>
            {paper.abstract ? paper.abstract.split(/\n\s*\n/).map((paragraph, i, arr) => (
              <p key={i} style={{ marginBottom: i !== arr.length - 1 ? '1.5rem' : '0' }}>
                {paragraph.replace(/\n/g, ' ')}
              </p>
            )) : <p>No abstract available.</p>}
          </div>
        </div>
      </AnimatedSection>

      {/* Request Full Paper (Only if paper has a volume_number assigned) */}
      {paper.volume_number !== null && (
        <AnimatedSection direction="up" delay={0.2}>
          <div className="card" style={{ borderTop: '4px solid var(--primary)' }}>
            <div className="card-header">
              <div className="card-title">Request Full Paper</div>
              <div className="card-description">
                The full article PDF is available upon request. Submit your details below and the editorial board will review your request.
              </div>
            </div>
            <div className="card-content">
              {submitted ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                  <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem', color: 'var(--foreground)' }}>Request Submitted Successfully</h3>
                  <p style={{ color: 'var(--muted-foreground)', fontSize: '0.95rem' }}>The editorial board will review your request. If approved, the full PDF will be emailed to you.</p>
                </div>
              ) : !showForm ? (
                <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                  <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
                    The full PDF is never publicly downloadable. You must request access from the editorial board, who will send it manually via email after review.
                  </p>
                  <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                    Request Full Paper
                  </button>
                </div>
              ) : (
                <form onSubmit={handleRequestSubmit} className="space-y-4">
                  {/* HONEYPOT: Visually hidden field to catch spam bots */}
                  <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
                    <label htmlFor="req-website">Website</label>
                    <input id="req-website" type="text" tabIndex="-1" autoComplete="off"
                      value={form.website_url} onChange={e => setForm(p => ({ ...p, website_url: e.target.value }))} />
                  </div>

                  <div className="grid-2">
                    <div className="form-group">
                      <label htmlFor="req-name">Your Name <span style={{}}>*</span></label>
                      <input id="req-name" className="input" placeholder="Full name"
                        value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label htmlFor="req-email">Email Address <span style={{}}>*</span></label>
                      <input id="req-email" type="email" className="input" placeholder="your@email.com"
                        value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="req-affiliation">Institution / Affiliation</label>
                    <input id="req-affiliation" className="input" placeholder="University, Research Institute, etc."
                      value={form.affiliation} onChange={e => setForm(p => ({ ...p, affiliation: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="req-reason">Reason for Request</label>
                    <textarea id="req-reason" className="input" style={{ minHeight: '90px', resize: 'vertical' }}
                      placeholder="Briefly describe your research purpose or reason for requesting the full paper..."
                      value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                      {submitting ? <><div className="spinner-sm" /> Submitting…</> : 'Submit Request'}
                    </button>
                    <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </AnimatedSection>
      )}

      {/* Citation Generator Modal */}
      <CitationModal
        isOpen={citationModalOpen}
        onClose={() => setCitationModalOpen(false)}
        paper={paper}
      />
    </div>
  )
}
