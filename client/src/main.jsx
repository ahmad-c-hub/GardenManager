import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';

import './theme/tokens.css';
import './theme/base.css';
import './theme/components.css';
import './theme/layout.css';
import './theme/pages.css';

import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { ToastProvider } from './lib/toast.jsx';

// Service worker (built from src/sw.js): offline app shell + push notifications.
// Only in production builds, so dev never serves stale cached files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => console.error('Service worker failed:', err));
  // A new version took over: reload once so the page matches the new assets.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload();
  });
}

// iOS Safari ignores user-scalable=no in a browser tab; its proprietary gesture
// events drive pinch-zoom, so cancel them. Scrolling is unaffected.
document.addEventListener('gesturestart', (e) => e.preventDefault());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      {/* Respect the OS "reduce motion" setting across all animations. */}
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>,
);
