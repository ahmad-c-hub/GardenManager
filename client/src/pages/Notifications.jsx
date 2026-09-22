import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, CalendarDays, Droplets, PiggyBank, Send, Users, Wheat } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported } from '../lib/push.js';
import { ErrorBanner, Field, PageHeader, SkeletonRows } from '../components/ui.jsx';

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="switch-thumb" />
    </button>
  );
}

function PrefRow({ icon: Icon, tone, title, description, children }) {
  return (
    <li className="list-row pref-row">
      <span className={`icon-tile sm ${tone}`}><Icon /></span>
      <div className="list-main">
        <div className="list-title">{title}</div>
        <div className="list-meta">{description}</div>
      </div>
      <div className="pref-control">{children}</div>
    </li>
  );
}

/** Enable / disable push on this device. */
function DeviceCard({ settings, onChanged }) {
  const toast = useToast();
  const [subscribed, setSubscribed] = useState(null);
  const [busy, setBusy] = useState(false);
  const permission = pushSupported ? Notification.permission : 'unsupported';

  useEffect(() => {
    currentSubscription().then((sub) => setSubscribed(Boolean(sub)));
  }, []);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      setSubscribed(Boolean(await currentSubscription()));
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  let status;
  if (!pushSupported) {
    status = isIOS && !isStandalone
      ? 'On iPhone and iPad, first add Garden Manager to your Home Screen (Share → Add to Home Screen), then open it from there.'
      : 'This browser doesn’t support push notifications.';
  } else if (!settings.push_enabled) {
    status = 'Notifications aren’t set up on the server yet (missing VAPID keys).';
  } else if (permission === 'denied') {
    status = 'Notifications are blocked for this site. Allow them in your browser settings to turn them on.';
  } else if (subscribed) {
    status = `This device will receive notifications. You have ${settings.device_count} device${settings.device_count === 1 ? '' : 's'} signed up.`;
  } else {
    status = 'Get harvest, watering and garden fund reminders on this device.';
  }

  const canEnable = pushSupported && settings.push_enabled && permission !== 'denied';

  return (
    <div className="card card-pad">
      <div className="card-header">
        <div>
          <h2 className="card-title">This device</h2>
          <p className="card-subtitle">{status}</p>
        </div>
        <span className={`icon-tile ${subscribed ? 'tone-saved' : 'tone-neutral'}`}>
          {subscribed ? <BellRing /> : <BellOff />}
        </span>
      </div>
      <div className="form-actions">
        {subscribed ? (
          <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => run(disablePush, 'Notifications turned off on this device')}>
              <BellOff /> Turn off
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => run(() => api.post('/push/test'), 'Test notification sent')}
            >
              <Send /> Send a test
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary"
            disabled={busy || !canEnable || subscribed === null}
            onClick={() => run(enablePush, 'Notifications enabled')}
          >
            {busy ? <span className="spinner" /> : <><Bell /> Enable notifications</>}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Notifications() {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.get('/notifications/settings').then(
      (s) => { setSettings(s); setError(null); },
      (err) => setError(err),
    );
  useEffect(() => { load(); }, []);

  async function save(patch) {
    const previous = settings;
    setSettings({ ...settings, ...patch }); // optimistic
    setSaving(true);
    try {
      setSettings(await api.put('/notifications/settings', patch));
    } catch (err) {
      setSettings(previous);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Reminders"
        eyebrowIcon={Bell}
        title="Notifications"
        subtitle="Choose what Garden Manager reminds you about. These apply to every device you’ve signed up."
      />

      {error && !settings ? (
        <ErrorBanner error={error} onRetry={load} />
      ) : !settings ? (
        <div className="card card-pad"><SkeletonRows rows={3} /></div>
      ) : (
        <div className="split split-form">
          <div className="sticky-col">
            <DeviceCard settings={settings} onChanged={load} />
          </div>

          <div className="card card-pad">
            <div className="card-header">
              <div>
                <h2 className="card-title">What to notify me about</h2>
                <p className="card-subtitle">Daily reminders go out in the morning.</p>
              </div>
            </div>
            <ul className="list">
              <PrefRow icon={Wheat} tone="tone-kg" title="Harvest reminders" description="When a plant’s expected harvest date is coming up.">
                <Switch label="Harvest reminders" checked={settings.notify_harvest} disabled={saving} onChange={(v) => save({ notify_harvest: v })} />
              </PrefRow>
              {settings.notify_harvest && (
                <li className="pref-sub">
                  <Field label="Remind me this many days before">
                    {(id) => (
                      <select
                        id={id}
                        className="select"
                        value={settings.harvest_lead_days}
                        disabled={saving}
                        onChange={(e) => save({ harvest_lead_days: Number(e.target.value) })}
                      >
                        {[0, 1, 2, 3, 5, 7, 14].map((d) => (
                          <option key={d} value={d}>{d === 0 ? 'On the day' : `${d} day${d === 1 ? '' : 's'} before`}</option>
                        ))}
                      </select>
                    )}
                  </Field>
                </li>
              )}
              <PrefRow icon={Droplets} tone="tone-saved" title="Watering reminders" description="A regular nudge to water the beds.">
                <select
                  className="select"
                  aria-label="Watering reminder frequency"
                  value={settings.watering_interval_days ?? ''}
                  disabled={saving}
                  onChange={(e) => save({ watering_interval_days: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  <option value="">Off</option>
                  <option value="1">Every day</option>
                  {[2, 3, 4, 5, 7, 14].map((d) => (
                    <option key={d} value={d}>Every {d} days</option>
                  ))}
                </select>
              </PrefRow>
              <PrefRow icon={CalendarDays} tone="tone-kg" title="Calendar reminders" description="The day before and the morning of every scheduled garden task.">
                <Switch label="Calendar reminders" checked={settings.notify_calendar} disabled={saving} onChange={(v) => save({ notify_calendar: v })} />
              </PrefRow>
              <PrefRow icon={PiggyBank} tone="tone-saved" title="Monthly savings" description="On the 1st, a reminder to add this month’s deposit.">
                <Switch label="Monthly savings reminder" checked={settings.notify_savings_monthly} disabled={saving} onChange={(v) => save({ notify_savings_monthly: v })} />
              </PrefRow>
              <PrefRow icon={Users} tone="tone-spent" title="Garden activity" description="When someone else logs a deposit, expense or harvest.">
                <Switch label="Garden activity alerts" checked={settings.notify_activity} disabled={saving} onChange={(v) => save({ notify_activity: v })} />
              </PrefRow>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
