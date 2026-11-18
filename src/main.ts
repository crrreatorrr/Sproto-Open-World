import './styles.css';

/**
 * Title shell: tiny on purpose (plan §3.5 budget). It shows a splash at once, then loads the game
 * (three.js, Rapier and the app) as separate chunks while physics initializes in parallel.
 */
const host = document.getElementById('app')!;
const splash = document.getElementById('splash');

async function boot(): Promise<void> {
  try {
    const { App, startPhysics } = await import('./app/App');
    const physics = startPhysics();
    const app = new App(host, physics);
    app.start();
    if (import.meta.env.DEV || import.meta.env.VITE_QA === '1') {
      const { installQa } = await import('./debug/qa');
      installQa({
        ready: true,
        state: () => app.qaState(),
        clips: () => app.player?.animator?.clipNames ?? [],
        playClip: (name) => app.player?.animator?.playOnce(name) ?? false,
        app,
      });
    }
    splash?.remove();
  } catch (err) {
    if (splash) {
      splash.classList.add('failed');
      splash.querySelector('p')!.textContent = `The game could not load: ${err instanceof Error ? err.message : String(err)}. Check your connection and reload.`;
    }
    console.error(err);
  }
}

void boot();
