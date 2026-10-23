// Registers the service worker that caches the app's own files for offline use. Production builds only: in development
// a cached file would hide edits. The worker file sits next to the page, so its scope is the app's folder.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = (): void => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // Offline use is an extra: the app works online without it.
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
