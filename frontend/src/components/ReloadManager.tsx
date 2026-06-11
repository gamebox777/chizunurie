'use client';

import { useEffect, useRef } from 'react';
import { useSession } from '@/lib/auth-client';

async function forceReload() {
  try {
    // 1. Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }
    // 2. Clear all cache storage keys
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }
  } catch (e) {
    console.error('Failed to clear cache before reload:', e);
  } finally {
    // 3. Force reload the page
    window.location.reload();
  }
}

export default function ReloadManager() {
  const { data: session, isPending } = useSession();
  const initialCheckDone = useRef(false);

  // 1. Daily reload logic
  useEffect(() => {
    const checkDailyReload = () => {
      if (typeof window === 'undefined') return;
      const lastReload = localStorage.getItem('chizunurie_last_daily_reload');
      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      
      if (!lastReload) {
        // Set the baseline if not set yet, so we don't reload on the very first load
        localStorage.setItem('chizunurie_last_daily_reload', now.toString());
      } else if (now - parseInt(lastReload, 10) > ONE_DAY_MS) {
        localStorage.setItem('chizunurie_last_daily_reload', now.toString());
        forceReload();
      }
    };

    checkDailyReload();

    // Check when user returns/resumes the app or tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkDailyReload();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // 2. Login state change transition logic
  useEffect(() => {
    if (isPending || typeof window === 'undefined') return;

    const currentIsLoggedIn = !!(session?.user && !session.user.isAnonymous);
    const prevIsLoggedInStr = localStorage.getItem('chizunurie_was_logged_in');

    if (!initialCheckDone.current) {
      initialCheckDone.current = true;
      // Initialize the value if it doesn't exist yet, without reloading.
      if (prevIsLoggedInStr === null) {
        localStorage.setItem('chizunurie_was_logged_in', currentIsLoggedIn ? 'true' : 'false');
        return;
      }
    }

    if (prevIsLoggedInStr !== null) {
      const prevIsLoggedIn = prevIsLoggedInStr === 'true';
      // Transition from NOT logged in to Logged in
      if (!prevIsLoggedIn && currentIsLoggedIn) {
        // Avoid infinite reload loop: set state beforehand
        localStorage.setItem('chizunurie_was_logged_in', 'true');
        localStorage.setItem('chizunurie_last_daily_reload', Date.now().toString());
        forceReload();
        return;
      }
    }

    // Keep the localStorage updated with the current state
    localStorage.setItem('chizunurie_was_logged_in', currentIsLoggedIn ? 'true' : 'false');
  }, [session, isPending]);

  // 3. Deployed version check
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const clientVersion = process.env.NEXT_PUBLIC_BUILD_ID || 'development';
    if (clientVersion === 'development') return; // Skip in local development

    const checkVersion = async () => {
      try {
        const res = await fetch(`/api/version?t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        const serverVersion = data.version;

        if (serverVersion && serverVersion !== 'development' && serverVersion !== clientVersion) {
          console.log(`New version detected (client: ${clientVersion}, server: ${serverVersion}). Force reloading...`);
          // Set daily reload timestamp so we don't trigger that immediately after
          localStorage.setItem('chizunurie_last_daily_reload', Date.now().toString());
          forceReload();
        }
      } catch (err) {
        console.error('Failed to check deployed version:', err);
      }
    };

    checkVersion();

    // Check when user returns/resumes the app or tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
      }
    };

    // Check every 10 minutes
    const interval = setInterval(checkVersion, 10 * 60 * 1000);

    window.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return null;
}
