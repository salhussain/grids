import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountPage } from './pages/Account';
import { InteractionPage } from './pages/Interaction';
import { PasswordTokenPage } from './pages/PasswordToken';
import { I18nProvider, useT } from './i18n';
import { Shell } from './Shell';
import { StepHeader } from './widgets';
import './styles.css';

function NotFound() {
  const t = useT();
  return <StepHeader title={t('auth.errors.invalid_link')} />;
}

/** Four pages, so a path switch is enough (no router dependency). */
function App() {
  const path = location.pathname.replace(/\/+$/, '');
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/ui\/interaction\/([\w-]+)$/))) return <InteractionPage uid={m[1]!} />;
  if ((m = path.match(/^\/ui\/(?:reset|setup)\/([\w-]+)$/))) return <PasswordTokenPage token={m[1]!} />;
  if (path === '/ui/account') return <AccountPage />;
  return (
    <I18nProvider>
      <Shell org={null}>
        <NotFound />
      </Shell>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
