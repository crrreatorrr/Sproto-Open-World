import { defineConfig } from 'vite';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** `<package version>+<short commit>`: CI's GITHUB_SHA, else git, else `dev`. */
function buildId(): string {
  const version = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  let commit = (process.env.GITHUB_SHA ?? '').trim().slice(0, 7);
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = '';
    }
  }
  return `${version}+${commit || 'dev'}`;
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  // Relative base: the same build works from any sub-path. Asset URLs are BASE_URL + a relative path.
  base: './',
  build: {
    // public/assets holds game assets, so bundled JS/CSS go to their own folder.
    assetsDir: 'build',
    target: 'es2022',
    // Rapier inlines its WebAssembly (~2 MB); vendor chunks load in parallel and stay cached.
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /@dimforge/ },
            { name: 'three', test: /node_modules[\\/]three/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5180,
    watch: { ignored: ['**/.claude/**', '**/art/**'] },
  },
});
