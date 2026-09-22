import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import { BrandMark } from './components/Botanical.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Savings from './pages/Savings.jsx';
import Expenses from './pages/Expenses.jsx';
import Garden from './pages/Garden.jsx';
import Harvests from './pages/Harvests.jsx';
import Notifications from './pages/Notifications.jsx';
import Moments from './pages/Moments.jsx';
import Calendar from './pages/Calendar.jsx';
import Tennis from './pages/Tennis.jsx';
import TennisMatch from './pages/TennisMatch.jsx';

function Splash() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }} aria-busy="true">
      <div style={{ width: 48, height: 48, opacity: 0.8 }}>
        <BrandMark light={false} />
      </div>
    </div>
  );
}

/** Everything inside requires a signed-in user; otherwise go to /login. */
function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={user === undefined ? <Splash /> : user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="savings" element={<Savings />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="garden" element={<Garden />} />
        <Route path="harvests" element={<Harvests />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="tennis" element={<Tennis />} />
        <Route path="tennis/matches/:matchId" element={<TennisMatch />} />
        <Route path="moments" element={<Moments />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
