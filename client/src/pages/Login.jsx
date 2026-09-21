import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail, PiggyBank, Sprout, Wheat } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { BrandMark, LoginIllustration } from '../components/Botanical.jsx';
import { Field, FormError } from '../components/ui.jsx';
import { gentle, stagger, fadeUp } from '../lib/motion.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-art">
        <LoginIllustration />
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={gentle}>
          <span className="brand">
            <span className="brand-mark">
              <BrandMark />
            </span>
            <span className="brand-name">
              Garden Manager
              <em>Fund &amp; harvest log</em>
            </span>
          </span>
        </motion.div>

        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.h2 className="login-quote" variants={fadeUp}>
            Every seed, every coin, <em>every kilo.</em>
          </motion.h2>
          <motion.p className="login-caption" variants={fadeUp}>
            The shared garden fund, our beds and everything they give back, kept together in one quiet place.
          </motion.p>
        </motion.div>

        <motion.div
          className="login-pillars"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
        >
          <span><PiggyBank /> Garden fund</span>
          <span><Sprout /> Beds &amp; plants</span>
          <span><Wheat /> Harvest log</span>
        </motion.div>
      </section>

      <section className="login-panel">
        <motion.div
          className="login-form-wrap"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...gentle, delay: 0.1 }}
        >
          <p className="eyebrow">
            <Lock /> Members only
          </p>
          <h1>Welcome back</h1>
          <p className="lead">Sign in to tend the garden fund.</p>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <Field label="Email">
              {(id) => (
                <div className="input-wrap">
                  <Mail className="input-icon" aria-hidden="true" />
                  <input
                    id={id}
                    className="input has-icon"
                    type="email"
                    autoComplete="username"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              )}
            </Field>

            <Field label="Password">
              {(id) => (
                <div className="input-wrap">
                  <KeyRound className="input-icon" aria-hidden="true" />
                  <input
                    id={id}
                    className="input has-icon has-suffix"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <span className="input-suffix">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </span>
                </div>
              )}
            </Field>

            <FormError error={error} />

            <button className="btn btn-primary btn-block" type="submit" disabled={busy || !email || !password} style={{ minHeight: 50 }}>
              {busy ? (
                <span className="spinner" aria-label="Signing in" />
              ) : (
                <>
                  Sign in <ArrowRight />
                </>
              )}
            </button>
          </form>

          <div className="login-note">
            <Sprout />
            <span>Accounts are created by the garden’s keeper. Ask them if you need access.</span>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
