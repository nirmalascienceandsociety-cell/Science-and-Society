import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { ToastProvider, useToast } from './components/Toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { DashboardSidebar } from './components/Sidebar'
import { ScrollProgress } from './components/ui/ScrollProgress'
import { IntroAnimation } from './components/ui/IntroAnimation'
import { ElegantGridBackground } from './components/ui/ElegantGridBackground'
import { useState } from 'react'


import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import PublishedIssues from './pages/PublishedIssues'
import PublishedPapers from './pages/PublishedPapers'
import FutureIssues from './pages/FutureIssues'
import PaperDetail from './pages/PaperDetail'
import ForgotPassword from './pages/ForgotPassword'
import PendingApproval from './pages/PendingApproval'
import EditorialBoard from './pages/EditorialBoard'
import About from './pages/About'
import NotFound from './pages/NotFound'

import StudentDashboard from './pages/student/StudentDashboard'
import UploadJournal from './pages/student/UploadJournal'
import { StudentJournals, StudentJournalDetail } from './pages/student/Journals'
import StudentGuidelines from './pages/student/Guidelines'

import ReviewerDashboard from './pages/reviewer/ReviewerDashboard'
import { AssignedJournals, ReviewJournal } from './pages/reviewer/AssignedJournals'

import AdminDashboard from './pages/admin/AdminDashboard'
import AdminJournals from './pages/admin/AdminJournals'
import AdminUsers from './pages/admin/AdminUsers'
import AdminReports, { ReviewReportDetail } from './pages/admin/AdminReports'
import AssignReviewers from './pages/admin/AssignReviewers'
import AcceptedPapers from './pages/admin/AcceptedPapers'
import PaperRequests from './pages/admin/PaperRequests'
import PublishLegacy from './pages/admin/PublishLegacy'
import AdminCompileIssue from './pages/admin/AdminCompileIssue'
import AssignedPapers from './pages/admin/AssignedPapers'

import Settings from './pages/Settings'
import NotificationsPage from './pages/NotificationsPage'

/* ── Auth guards ──────────────────────────────────────────────────── */
function GuestRoute({ children }) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" />
        </div>
      </div>
    )
  }

  if (user && profile) {
    if (profile.status === 'pending' || profile.status === 'inactive') {
      return children
    }
    if (profile.role === 'admin') return <Navigate to="/admin/dashboard" replace />
    if (profile.role === 'reviewer') return <Navigate to="/reviewer/dashboard" replace />
    return <Navigate to="/student/dashboard" replace />
  }

  return children
}

function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading, profileError, signOut } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" />
          <p style={{ marginTop: '1rem', color: 'var(--muted-foreground)' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  
  // SEC-021: If profile load failed (e.g. network error, DB issue, missing row),
  // do not allow access to protected routes. Force sign out and redirect to login.
  // Without this, a null profile would bypass the role check below.
  if (profileError) {
    signOut()
    return <Navigate to="/login" replace />
  }

  if (profile) {
    if (profile.status === 'pending') {
      signOut()
      return <Navigate to="/pending-approval" replace state={{ name: profile.name }} />
    }
    if (profile.status === 'inactive') {
      signOut()
      return <Navigate to="/login" replace />
    }
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    // Wrong role — redirect to their correct dashboard
    if (profile.role === 'admin') return <Navigate to="/admin/dashboard" replace />
    if (profile.role === 'reviewer') return <Navigate to="/reviewer/dashboard" replace />
    return <Navigate to="/student/dashboard" replace />
  }

  return children
}

/* ── Layout wrappers ──────────────────────────────────────────────── */
function PublicLayout({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <main style={{ flex: 1 }}>{children}</main>
      <Footer />
    </div>
  )
}

function DashboardLayout({ role, children }) {
  const toast = useToast()

  useEffect(() => {
    if (localStorage.getItem('account_restored') === '1') {
      localStorage.removeItem('account_restored')
      setTimeout(() => {
        toast.success('Welcome back! Your account has been fully restored. All your history and data remain intact.', { duration: 6000 })
      }, 800)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="dashboard-layout">
      <DashboardSidebar role={role} />
      <div className="dashboard-main">
        <div className="dashboard-content">
          {children}
        </div>
      </div>
    </div>
  )
}

function DynamicDashboardLayout({ children }) {
  const { profile } = useAuth();
  return <DashboardLayout role={profile?.role}>{children}</DashboardLayout>;
}

/* ── App ──────────────────────────────────────────────────────────── */
export default function App() {
  const [showIntro, setShowIntro] = useState(() => {
    // Only show intro if it hasn't been played this session
    return sessionStorage.getItem('intro_played') !== 'true'
  })

  const handleIntroComplete = () => {
    sessionStorage.setItem('intro_played', 'true')
    setShowIntro(false)
  }

  return (
    <>
      {showIntro && <IntroAnimation onComplete={handleIntroComplete} />}
      <ElegantGridBackground />
      <ScrollProgress />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <Routes>
                {/* Public */}
                <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />
                <Route path="/published-issues" element={<PublicLayout><PublishedIssues /></PublicLayout>} />
                <Route path="/published-papers" element={<PublicLayout><PublishedPapers /></PublicLayout>} />
                <Route path="/future-issues" element={<PublicLayout><FutureIssues /></PublicLayout>} />
                <Route path="/editorial-board" element={<PublicLayout><EditorialBoard /></PublicLayout>} />
                <Route path="/about" element={<PublicLayout><About /></PublicLayout>} />
                <Route path="/paper/:id" element={<PublicLayout><PaperDetail /></PublicLayout>} />
                <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
                <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/pending-approval" element={<PendingApproval />} />

                {/* Shared Authenticated Routes */}
                <Route path="/notifications" element={
                  <ProtectedRoute>
                    <DynamicDashboardLayout><NotificationsPage /></DynamicDashboardLayout>
                  </ProtectedRoute>
                } />

                {/* Student */}
                <Route path="/student/dashboard" element={
                  <ProtectedRoute allowedRoles={['student']}>
                    <DashboardLayout role="student"><StudentDashboard /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/student/upload" element={
                  <ProtectedRoute allowedRoles={['student']}>
                    <DashboardLayout role="student"><UploadJournal /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/student/journals" element={
                  <ProtectedRoute allowedRoles={['student']}>
                    <DashboardLayout role="student"><StudentJournals /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/student/journals/:id" element={
                  <ProtectedRoute allowedRoles={['student']}>
                    <DashboardLayout role="student"><StudentJournalDetail /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/student/settings" element={
                  <ProtectedRoute allowedRoles={['student']}>
                    <DashboardLayout role="student"><Settings /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/student/guidelines" element={
                  <ProtectedRoute allowedRoles={['student']}>
                    <DashboardLayout role="student"><StudentGuidelines /></DashboardLayout>
                  </ProtectedRoute>
                } />

                {/* Reviewer */}
                <Route path="/reviewer/dashboard" element={
                  <ProtectedRoute allowedRoles={['reviewer']}>
                    <DashboardLayout role="reviewer"><ReviewerDashboard /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/reviewer/assigned" element={
                  <ProtectedRoute allowedRoles={['reviewer']}>
                    <DashboardLayout role="reviewer"><AssignedJournals /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/reviewer/review/:id" element={
                  <ProtectedRoute allowedRoles={['reviewer']}>
                    <DashboardLayout role="reviewer"><ReviewJournal /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/reviewer/settings" element={
                  <ProtectedRoute allowedRoles={['reviewer']}>
                    <DashboardLayout role="reviewer"><Settings /></DashboardLayout>
                  </ProtectedRoute>
                } />

                {/* Admin */}
                <Route path="/admin/dashboard" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><AdminDashboard /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/journals" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><AdminJournals /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/users" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><AdminUsers /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/reports" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><AdminReports /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/reports/:id" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><ReviewReportDetail /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/reviewers" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><AssignReviewers /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/accepted-papers" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><AcceptedPapers /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/compile-issue" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><AdminCompileIssue /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/publish-legacy" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><PublishLegacy /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/paper-requests" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><PaperRequests /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/settings" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><Settings /></DashboardLayout>
                  </ProtectedRoute>
                } />
                <Route path="/admin/assigned-papers" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <DashboardLayout role="admin"><AssignedPapers /></DashboardLayout>
                  </ProtectedRoute>
                } />

                {/* Fallback */}
                <Route path="*" element={<PublicLayout><NotFound /></PublicLayout>} />
              </Routes>

            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </>
  )
}
