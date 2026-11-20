import './styles.css';
import { enterDataEpoch } from './save/dataEpoch';

/**
 * Title shell: tiny on purpose (plan §3.5 budget). It shows a splash at once, then loads the game
 * (three.js, Rapier and the app) as separate chunks while physics initializes in parallel.
 */
const host = document.getElementById('app')!;
const splash = document.getElementById('splash');

async function boot(): Promise<void> {
  // A new data epoch deletes the old saves and settings once, before anything reads them.
  if (enterDataEpoch()) console.info('[save] new data epoch: local data cleared');
  try {
    if (new URLSearchParams(window.location.search).get('pvp') === '1') {
      const { startPvpArena } = await import('./app/PvpArenaMode');
      startPvpArena(host);
      splash?.remove();
      return;
    }
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
        teleport: (x, z) => app.qaTeleport(x, z),
        app,
      });
    }
    // The placement editor is for the dev server alone: QA and production builds never carry it.
    if (import.meta.env.DEV) {
      const { installPlacementEditor } = await import('./debug/placementEditor');
      installPlacementEditor(app);
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
