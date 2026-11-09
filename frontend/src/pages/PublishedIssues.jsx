import { useState, useEffect } from 'react'
import { Search, X, Eye, Quote } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sendNotification } from '../lib/api'
import { useToast } from '../components/Toast'
import { AnimatedSection, StaggerContainer, StaggerItem } from '../components/ui/AnimatedSection'
import { Card3D } from '../components/ui/Card3D'
import { GoldUnderline } from '../components/ui/GoldUnderline'
import { ElegantGridBackground } from '../components/ui/ElegantGridBackground'
import { BackgroundElements } from '../components/ui/BackgroundElements'
import { ParallaxFloatingElements } from '../components/ui/ParallaxFloatingElements'

export default function PublishedIssues() {
  const toast = useToast()
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')


  // Modal state
  const [requestModalOpen, setRequestModalOpen] = useState(false)
  const [selectedJournal, setSelectedJournal] = useState(null)
  const [requesterName, setRequesterName] = useState('')
  const [requesterEmail, setRequesterEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchIssues()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchIssues() {
    setLoading(true)
    const { data, error } = await supabase
      .from('published_issues')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      toast.error('Failed to load issues.')
    } else {
      setIssues(data || [])
    }
    setLoading(false)
  }

  const openRequestModal = (journal) => {
    setSelectedJournal(journal)
    setRequestModalOpen(true)
  }

  const closeRequestModal = () => {
    setRequestModalOpen(false)
    setSelectedJournal(null)
    setRequesterName('')
    setRequesterEmail('')
  }

  const handleRequestSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const res = await sendNotification('/api/notify/paper-request', {
        journalId: selectedJournal.id,
        journalTitle: selectedJournal.title,
        requesterName: requesterName,
        requesterEmail: requesterEmail,
        affiliation: '',
        reason: '',
        website_url: '',
      })

      if (!res || !res.ok) {
        toast.error('Failed to submit request. Please try again later.')
      } else {
        toast.success('Access request submitted! The administrative team will contact you.')
        closeRequestModal()
      }
    } catch (error) {
      console.error(error)
      toast.error('An error occurred. Please try again.')
    }
    setSubmitting(false)
  }

  // Filter local data
  const filteredIssues = issues.filter(issue => {
    const matchesSearch = issue.title.toLowerCase().includes(search.toLowerCase()) ||
      (issue.author_name || '').toLowerCase().includes(search.toLowerCase())
    return matchesSearch
  })

  return (
    <>
      <ElegantGridBackground />
      <BackgroundElements />
      <ParallaxFloatingElements />

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ padding: '4rem 1rem', minHeight: '80vh' }}>

          <div style={{ textAlign: 'center', margin: '2rem auto 3rem auto', maxWidth: '600px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <AnimatedSection direction="up" delay={0}>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--gold)', marginBottom: '1rem' }}>
          </div>
            <span className="section-label" style={{ justifyContent: 'center' }}>Archive</span>
            <h1 className="hero-title" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Published Issues</h1>
            <GoldUnderline width={240} />
          </AnimatedSection>
          <AnimatedSection direction="up" delay={0.1}>
            <p className="section-desc" style={{ marginTop: '1rem' }}>
              Browse our catalogue of approved and published research papers. Full texts are restricted to maintain academic integrity—request access from our admin team to read full editions.
            </p>
          </AnimatedSection>
          </div>

          <AnimatedSection direction="up" delay={0.2}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
          {/* Search */}
          <div style={{
            flex: 1, minWidth: '280px',
            display: 'flex', alignItems: 'center', gap: '0',
            border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(242,236,224,0.04)',
            overflow: 'hidden',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', padding: '0 0.75rem', color: 'var(--muted-foreground)', flexShrink: 0 }}>
              <Search size={16} />
            </span>
            <input
              type="text"
              className="input-unstyled"
              placeholder="Search by title or author..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, height: '3rem', fontSize: '1rem', padding: '0' }}
            />
          </div>


        </div>
          </AnimatedSection>

      {loading ? (
        <div className="spinner" style={{ margin: '4rem auto' }} />
      ) : filteredIssues.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <p className="text-muted text-lg">No published issues match your search.</p>
        </div>
      ) : (
        <StaggerContainer className="grid-2" style={{ gap: '2rem' }}>
          {filteredIssues.map((issue) => (
            <StaggerItem key={issue.id}>
              <Card3D intensity={4}>
                <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div className="card-header" style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '0.5rem' }}>
                      <h2 className="card-title" style={{ fontSize: '1.25rem', lineHeight: 1.3 }}>{issue.title}</h2>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.4rem' }}>
                      <p className="text-sm text-muted" style={{ margin: 0 }}>
                        By <span className="font-medium text-foreground">{issue.author_name || 'Anonymous Researcher'}</span> • {new Date(issue.created_at).toLocaleDateString()}
                      </p>
                      <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Eye size={13} style={{ color: 'var(--primary)' }} /> {issue.views_count || 0} views
                        </span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Quote size={13} style={{ color: 'var(--gold, #d97706)' }} /> {issue.citations_count || 0} citations
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="card-content" style={{ flex: 1 }}>
                    {/* SEC-004: Never use abstract as href — it's plain user text, not a URL.
                        Always render as text to prevent stored XSS / phishing via javascript:
                        or data: URLs. If a PDF link is needed, store a separate validated path. */}
                    <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
                      {issue.abstract || 'No abstract available.'}
                    </p>
                  </div>
                  <div className="card-footer" style={{ paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="text-xs font-semibold text-warning" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                      Full Access Restricted
                    </span>
                    <button className="btn btn-primary" onClick={() => openRequestModal(issue)}>
                      Request Full Paper
                    </button>
                  </div>
                </div>
              </Card3D>
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}

      {/* Request Access Modal */}
      {requestModalOpen && (
        <div className="sidebar-drawer-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={closeRequestModal}>
          <div className="card" style={{ width: '100%', maxWidth: '28rem', position: 'relative', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ position: 'absolute', top: '1rem', right: '1rem' }}>
              <button className="btn btn-primary btn-icon" onClick={closeRequestModal}>
                <X size={20} />
              </button>
            </div>
            <div className="card-header">
              <h3 className="card-title">Request Paper Access</h3>
              <p className="card-description">Admin approval required</p>
            </div>
            <div className="card-content">
              <div style={{ background: 'var(--muted)', padding: '0.75rem', borderRadius: 'var(--radius)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                <span className="font-semibold" style={{ display: 'block', marginBottom: '0.25rem' }}>Requesting:</span>
                "{selectedJournal?.title}"
              </div>

              <form onSubmit={handleRequestSubmit} className="space-y-4">
                <div className="form-group">
                  <label>Your Name</label>
                  <input type="text" className="input" placeholder="e.g. Dr. John Doe" value={requesterName} onChange={e => setRequesterName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Your Email</label>
                  <input type="email" className="input" placeholder="john@university.edu" value={requesterEmail} onChange={e => setRequesterEmail(e.target.value)} required />
                  <p className="text-xs text-muted mt-1">We will send the PDF file to this email.</p>
                </div>
                <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                  {submitting ? 'Sending Request...' : 'Send Request to Admin'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
        </div>
      </div>
    </>
  )
}
