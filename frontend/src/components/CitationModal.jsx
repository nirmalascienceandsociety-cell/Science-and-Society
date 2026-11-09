import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Copy, Check, Quote } from 'lucide-react'
import { useToast } from './Toast'

export default function CitationModal({ isOpen, onClose, paper }) {
  const toast = useToast()
  const [activeTab, setActiveTab] = useState('apa')
  const [copied, setCopied] = useState(false)

  if (!paper) return null

  // Helpers to parse authors
  const getAuthorsList = () => {
    if (Array.isArray(paper.authors) && paper.authors.length > 0) {
      return paper.authors.map(a => (typeof a === 'string' ? a : a.name || 'Author')).filter(Boolean)
    }
    if (paper.author_name) return [paper.author_name]
    return ['Science & Society Contributor']
  }

  const authors = getAuthorsList()
  const year = paper.published_at || paper.created_at ? new Date(paper.published_at || paper.created_at).getFullYear() : new Date().getFullYear()
  const vol = paper.volume_number || '1'
  const iss = paper.issue_number || '1'
  const title = paper.title || 'Untitled Article'

  // Format Generators
  const generateAPA = () => {
    let authorStr = ''
    if (authors.length === 1) authorStr = authors[0]
    else if (authors.length === 2) authorStr = `${authors[0]} & ${authors[1]}`
    else authorStr = `${authors[0]} et al.`

    return `${authorStr} (${year}). ${title}. Science & Society, ${vol}(${iss}).`
  }

  const generateIEEE = () => {
    const authorStr = authors.join(', ')
    return `${authorStr}, "${title}," Science & Society, vol. ${vol}, no. ${iss}, ${year}.`
  }

  const generateMLA = () => {
    const authorStr = authors.length > 1 ? `${authors[0]}, et al.` : authors[0]
    return `${authorStr}. "${title}." Science & Society, vol. ${vol}, no. ${iss}, ${year}.`
  }

  const generateChicago = () => {
    const authorStr = authors.join(', ')
    return `${authorStr}. "${title}." Science & Society ${vol}, no. ${iss} (${year}).`
  }

  const generateBibTeX = () => {
    const citeKey = (authors[0]?.split(' ').pop() || 'paper') + year + (paper.id?.slice(0, 4) || '')
    return `@article{${citeKey.toLowerCase()},
  author    = {${authors.join(' and ')}},
  title     = {${title}},
  journal   = {Science \\& Society},
  volume    = {${vol}},
  number    = {${iss}},
  year      = {${year}}
}`
  }

  const getCitationText = () => {
    switch (activeTab) {
      case 'apa': return generateAPA()
      case 'ieee': return generateIEEE()
      case 'mla': return generateMLA()
      case 'chicago': return generateChicago()
      case 'bibtex': return generateBibTeX()
      default: return generateAPA()
    }
  }

  const handleCopy = () => {
    const text = getCitationText()
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success('Citation copied to clipboard!')
    setTimeout(() => setCopied(false), 2500)
  }

  const tabs = [
    { id: 'apa', label: 'APA (7th)' },
    { id: 'ieee', label: 'IEEE' },
    { id: 'mla', label: 'MLA (9th)' },
    { id: 'chicago', label: 'Chicago' },
    { id: 'bibtex', label: 'BibTeX' }
  ]

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          key="citation-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem', background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(6px)'
          }}
          onClick={onClose}
        >
          <motion.div
            key="citation-modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.2 }}
            style={{
              width: '100%', maxWidth: '650px',
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: '1.25rem', padding: '2rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              position: 'relative'
            }}
            onClick={e => e.stopPropagation()}
          >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: '2.5rem', height: '2.5rem', borderRadius: '50%',
                background: 'color-mix(in srgb, var(--primary) 15%, transparent)',
                color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Quote size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Cite This Paper</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)', margin: 0 }}>Export bibliographic references in standard formats</p>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', color: 'var(--muted-foreground)',
                cursor: 'pointer', padding: '0.5rem', borderRadius: '50%', display: 'flex'
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--foreground)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--muted-foreground)'}
            >
              <X size={20} />
            </button>
          </div>

          {/* Paper Title Preview */}
          <div style={{
            background: 'var(--muted)', padding: '1rem 1.25rem', borderRadius: '0.75rem',
            border: '1px solid var(--border)', marginBottom: '1.5rem'
          }}>
            <p style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: '0.25rem', lineHeight: 1.4 }}>
              {title}
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', margin: 0 }}>
              {authors.join(', ')} • <em>Science & Society</em> ({year})
            </p>
          </div>

          {/* Format Tabs */}
          <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', overflowX: 'auto' }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '0.45rem 0.9rem', fontSize: '0.85rem', fontWeight: 600,
                  borderRadius: '0.5rem', border: 'none', cursor: 'pointer',
                  background: activeTab === tab.id ? 'var(--primary)' : 'transparent',
                  color: activeTab === tab.id ? '#fff' : 'var(--muted-foreground)',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Citation Output Box */}
          <div style={{
            position: 'relative', background: 'var(--background)',
            border: '1px solid var(--border)', borderRadius: '0.75rem',
            padding: '1.25rem', marginBottom: '1.5rem', minHeight: '100px',
            fontFamily: activeTab === 'bibtex' ? 'monospace' : 'inherit',
            fontSize: activeTab === 'bibtex' ? '0.85rem' : '0.95rem',
            color: 'var(--foreground)', lineHeight: 1.6, whiteSpace: 'pre-wrap'
          }}>
            {getCitationText()}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              onClick={onClose}
              className="btn btn-outline"
              style={{ padding: '0.65rem 1.25rem', fontSize: '0.9rem' }}
            >
              Close
            </button>
            <button
              onClick={handleCopy}
              className="btn btn-primary"
              style={{ padding: '0.65rem 1.25rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied!' : 'Copy Citation'}
            </button>
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  )
}
