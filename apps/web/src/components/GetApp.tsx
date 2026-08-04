'use client';
/**
 * "Get the app" — three distribution channels:
 *  - PWA install (Android / desktop fire `beforeinstallprompt`; iOS Safari
 *    installs via Share → Add to Home Screen, so it gets a hint instead)
 *  - Android APK download (built by CI, attached to the android-latest release)
 *  - the store shells live in apps/mobile-shell (Play Store / App Store builds)
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

const APK_URL = 'https://github.com/RBKANGISKANG/StyleNow/releases/download/android-latest/stylenow.apk';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export function GetApp() {
  const { t } = useI18n();
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  return (
    <section className="section">
      <h2>📲 {t('getapp_title')}</h2>
      <div className="panel">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {installEvent && (
            <button
              className="btn btn-primary"
              onClick={() => {
                void installEvent.prompt();
                void installEvent.userChoice.then(() => setInstallEvent(null));
              }}
            >
              ⚡ {t('getapp_install')}
            </button>
          )}
          <a className="btn btn-soft" href={APK_URL}>
            🤖 {t('getapp_apk')}
          </a>
        </div>
        {isIos && (
          <p style={{ marginTop: 10, fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
            🍎 {t('getapp_ios_hint')}
          </p>
        )}
        <p style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{t('getapp_note')}</p>
      </div>
    </section>
  );
}
