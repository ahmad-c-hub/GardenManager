import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, CalendarDays, Camera, LayoutDashboard, LogOut, Menu, PiggyBank, Receipt, Sparkles, Sprout, Trophy, Wheat, X } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { currentSubscription } from '../lib/push.js';
import { BrandMark, CornerFrond } from './Botanical.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/savings', label: 'Savings', icon: PiggyBank },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/garden', label: 'Beds & Plants', icon: Sprout },
  { to: '/harvests', label: 'Harvests', icon: Wheat },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/assistant', label: 'Planting Assistant', icon: Sparkles },
  { to: '/moments', label: 'Moments', icon: Camera },
  { to: '/tennis', label: 'Tennis', icon: Trophy },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

function Brand({ light }) {
  return (
    <NavLink to="/" className="brand" aria-label="Garden Manager home">
      <span className="brand-mark">
        <BrandMark light={light} />
      </span>
      <span className="brand-name">
        Garden Manager
        <em>Fund &amp; harvest log</em>
      </span>
    </NavLink>
  );
}

function useIsMobile() {
  const query = '(max-width: 960px)';
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e) => setMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/**
 * Push plumbing that needs the router: open the page a tapped notification
 * points at, and keep this device's subscription linked to whoever is signed in.
 */
function usePushSync(userId) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (event) => {
      if (event.data?.type === 'navigate' && typeof event.data.url === 'string' && event.data.url.startsWith('/')) {
        navigate(event.data.url);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  useEffect(() => {
    if (!userId || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // Re-registers the subscription in case the server pruned it or another person used this device.
    currentSubscription()
      .then((sub) => sub && api.post('/push/subscribe', { subscription: sub.toJSON() }))
      .catch(() => {});
  }, [userId]);
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  usePushSync(user?.id);

  // Close the drawer whenever the route changes, and on Escape.
  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const sidebarVisible = !isMobile || drawerOpen;
  // Full-bleed pages manage their own height and padding, and keep one
  // mounted instance across their sub-routes (e.g. switching conversations).
  const section = location.pathname.startsWith('/assistant') ? '/assistant' : location.pathname;
  const flush = section === '/assistant';
  const initial = (user?.display_name || user?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand light />
        <button className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu" aria-expanded={drawerOpen}>
          <Menu />
        </button>
      </header>

      <AnimatePresence>
        {isMobile && drawerOpen && (
          <motion.div
            className="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawerOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        className="sidebar"
        inert={!sidebarVisible}
        initial={false}
        animate={isMobile ? { x: drawerOpen ? 0 : '-105%' } : { x: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        aria-label="Main navigation"
      >
        <CornerFrond className="sidebar-art" />
        <div className="sidebar-top">
          <Brand light />
          {isMobile && (
            <button className="icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
              <X />
            </button>
          )}
        </div>

        <p className="nav-section-label">Garden</p>
        <nav className="nav">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-active" className="nav-active-bg" transition={{ type: 'spring', stiffness: 460, damping: 36 }} />}
                  <Icon />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">{initial}</span>
          <span className="user-meta">
            <strong>{user?.display_name}</strong>
            <span>{user?.email}</span>
          </span>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
            <LogOut />
          </button>
        </div>
      </motion.aside>

      <main className={`app-main ${flush ? 'is-flush' : ''}`}>
        <motion.div
          key={section}
          className="app-content"
          // No slide for full-bleed pages: a transform would re-anchor their fixed layout mid-animation.
          initial={flush ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={flush ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}

