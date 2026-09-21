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
