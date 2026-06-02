import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense, memo } from 'react';
import { lazyWithRetry as lazy } from './lib/chunkReload';
import { useApp } from './AppContext';
import { 
  Users, 
  Calendar, 
  FileText, 
  Settings as SettingsIcon, 
  LogOut, 
  LayoutDashboard,
  Menu,
  X,
  UserPlus,
  ClipboardList,
  FileStack,
  ClipboardCheck,
  PenTool
} from 'lucide-react';
import { motion } from 'motion/react';
import Login from './components/Login';

// Lazy-load semua menu agar tidak ikut ter-bundle di initial load.
// Tiap menu hanya di-fetch saat user pertama kali membukanya.
const Dashboard            = lazy(() => import('./components/Dashboard'));
const EmployeeList         = lazy(() => import('./components/EmployeeList'));
const TimesheetView        = lazy(() => import('./components/TimesheetView'));
const LeaveForm            = lazy(() => import('./components/LeaveForm'));
const Settings             = lazy(() => import('./components/Settings'));
const SignupRequests       = lazy(() => import('./components/SignupRequests'));
const LeaveRequestList     = lazy(() => import('./components/LeaveRequestList'));
const DocumentTemplates    = lazy(() => import('./components/DocumentTemplates'));
const DocumentForm         = lazy(() => import('./components/DocumentForm'));
const DocumentRequestList  = lazy(() => import('./components/DocumentRequestList'));
const MySignatures         = lazy(() => import('./components/MySignatures'));

function MenuFallback() {
  return (
    <div className="flex items-center justify-center py-20 text-sm text-gray-500">
      Memuat…
    </div>
  );
}

type View = 'dashboard' | 'employees' | 'timesheet' | 'leave' | 'leaveRequests' | 'settings' | 'signups' | 'documentTemplates' | 'document' | 'documentRequests' | 'mySignatures';

export default function App() {
  const { user, logout, loading } = useApp();
  const dashboardRoles = ['ADMIN', 'APPROVAL_HR', 'SUPERUSER'];
  const initialView: View = !user
    ? 'dashboard'
    : dashboardRoles.includes(user.role)
      ? 'dashboard'
      : 'timesheet';
  const [currentView, setCurrentView] = useState<View>(initialView);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Pastikan ketika user baru saja login (transisi null→user), tampilan awal
  // mengikuti rolenya, bukan nilai initialView yang dihitung saat mount.
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    const prev = prevUserIdRef.current;
    const curr = user?.id ?? null;
    if (prev !== curr) {
      if (user) {
        setCurrentView(dashboardRoles.includes(user.role) ? 'dashboard' : 'timesheet');
      }
      prevUserIdRef.current = curr;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  if (loading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="text-sm text-gray-500">Memuat data…</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'APPROVAL_HR', 'SUPERUSER'] },
    { id: 'leaveRequests', label: 'Leave Request List', icon: ClipboardList, roles: ['APPROVAL', 'ADMIN', 'APPROVAL_HR', 'SUPERUSER'] },
    { id: 'timesheet', label: 'My Timesheet', icon: Calendar, roles: ['REGULAR', 'APPROVAL', 'ADMIN', 'APPROVAL_HR', 'SUPERUSER'] },
    { id: 'leave', label: 'Submit Leave', icon: FileText, roles: ['REGULAR', 'APPROVAL', 'ADMIN', 'APPROVAL_HR', 'SUPERUSER'] },
    { id: 'document', label: 'Ajukan Dokumen', icon: FileText, roles: ['REGULAR', 'APPROVAL', 'ADMIN', 'APPROVAL_HR', 'SUPERUSER'] },
    { id: 'documentRequests', label: 'Document Request List', icon: ClipboardCheck, roles: ['APPROVAL', 'ADMIN', 'APPROVAL_HR', 'SUPERUSER'] },
    { id: 'mySignatures', label: 'Tanda Tangan Saya', icon: PenTool, roles: ['REGULAR', 'APPROVAL', 'ADMIN', 'APPROVAL_HR', 'SUPERUSER'] },
    { id: 'documentTemplates', label: 'Template Dokumen', icon: FileStack, roles: ['SUPERUSER'] },
    { id: 'employees', label: 'Employees', icon: Users, roles: ['ADMIN', 'APPROVAL_HR', 'SUPERUSER'] },
    { id: 'signups', label: 'Sign Up Requests', icon: UserPlus, roles: ['SUPERUSER'] },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, roles: ['SUPERUSER'] },
  ];

  const filteredNav = navItems.filter(item => item.roles.includes(user.role));

  // Jaga konsistensi: jika currentView tidak diizinkan untuk role user,
  // alihkan ke menu pertama yang tersedia (mis. timesheet untuk REGULAR/APPROVAL).
  const allowedIds = filteredNav.map(i => i.id);
  if (!allowedIds.includes(currentView) && filteredNav.length > 0) {
    const fallback = (dashboardRoles.includes(user.role) ? 'dashboard' : 'timesheet') as View;
    const next = allowedIds.includes(fallback) ? fallback : (filteredNav[0].id as View);
    setCurrentView(next);
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)] font-sans">
      {/* Mobile backdrop */}
      {isMobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: isSidebarOpen ? 240 : 80 }}
        className={`bg-[var(--sidebar)] text-white flex-col h-full z-40 no-print shadow-xl
          hidden md:flex
          ${isMobileNavOpen ? '!flex fixed inset-y-0 left-0 !w-64' : ''}
        `}
      >
        <div className="p-6 flex items-center justify-between">
          {(isSidebarOpen || isMobileNavOpen) && (
            <div className="flex items-center gap-2 font-black text-lg tracking-tight">
              <span className="text-xl">⛰️</span>
              <span>FlukSite Pro</span>
            </div>
          )}
          <button
            onClick={() => {
              if (isMobileNavOpen) setIsMobileNavOpen(false);
              else setIsSidebarOpen(!isSidebarOpen);
            }}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            {(isSidebarOpen || isMobileNavOpen) ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1">
          {filteredNav.map((item) => (
            <button
              key={item.id}
              onClick={() => { setCurrentView(item.id as View); setIsMobileNavOpen(false); }}
              className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors duration-75 ${
                currentView === item.id 
                  ? 'bg-white/10 text-white font-semibold' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <item.icon size={20} className={(isSidebarOpen || isMobileNavOpen) ? 'mr-3' : 'mx-auto'} />
              {(isSidebarOpen || isMobileNavOpen) && <span className="text-sm">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5 space-y-4">
          {(isSidebarOpen || isMobileNavOpen) && (
            <div className="px-4 py-3 bg-white/5 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold">
                  {user.name.charAt(0)}
                </div>
                <div className="overflow-hidden">
                  <p className="font-bold text-xs truncate">{user.name}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider truncate">{user.role}</p>
                </div>
              </div>
            </div>
          )}
          <button 
            onClick={logout}
            className="w-full flex items-center px-4 py-3 text-red-400 hover:bg-red-500/10 rounded-lg transition-all group"
          >
            <LogOut size={20} className={(isSidebarOpen || isMobileNavOpen) ? 'mr-3' : 'mx-auto'} />
            {(isSidebarOpen || isMobileNavOpen) && <span className="text-sm font-medium">Logout</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-[var(--line)] flex items-center px-4 md:px-8 justify-between no-print shadow-sm gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="md:hidden p-2 -ml-2 hover:bg-gray-100 rounded-lg"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-sm font-bold text-gray-900 capitalize">
              {currentView}
            </h1>
            <span className="text-gray-300 hidden sm:inline">/</span>
            <span className="text-xs text-gray-500 font-medium hidden sm:inline truncate">{user.department}</span>
          </div>
          <div className="flex items-center gap-2 md:gap-6 flex-shrink-0">
            <div className="text-xs font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full hidden sm:block">
              {new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
            {user.role === 'SUPERUSER' && (
              <span className="bg-amber-100 text-amber-800 text-[10px] font-black uppercase px-2 py-0.5 rounded border border-amber-200">
                Superuser
              </span>
            )}
          </div>
        </header>

        <section className="flex-1 overflow-y-auto p-4 md:p-8">
          <Suspense fallback={<MenuFallback />}>
            <CachedView active={currentView} />
          </Suspense>
        </section>
      </main>
    </div>
  );
}

// Render hanya view yang aktif. Cache view sebelumnya di DOM bikin semua
// komponen berat (mis. TimesheetView) tetap subscribe ke AppContext dan
// ikut re-render tiap polling 5 detik — efeknya UI jadi lag, terutama saat
// pindah/aktif di menu Timesheet. Chunk lazy tetap di-cache oleh browser
// sehingga membuka ulang menu tidak perlu fetch ulang.
const VIEW_COMPONENTS: Record<View, React.ComponentType> = {
  dashboard: Dashboard,
  employees: EmployeeList,
  timesheet: TimesheetView,
  leave: LeaveForm,
  settings: Settings,
  signups: SignupRequests,
  leaveRequests: LeaveRequestList,
  document: DocumentForm,
  documentRequests: DocumentRequestList,
  documentTemplates: DocumentTemplates,
  mySignatures: MySignatures,
};

const CachedView = memo(function CachedView({ active }: { active: View }) {
  const Cmp = VIEW_COMPONENTS[active];
  return <Cmp />;
});
