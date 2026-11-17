import * as THREE from 'three';

/**
 * Small procedural sprite textures for combat FX, drawn once on a canvas (no files to load, so a
 * flash can never wait on the network).
 */
let star: THREE.Texture | null = null;
let glow: THREE.Texture | null = null;
let rune: THREE.Texture | null = null;

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A four-point star: the telegraph glint. */
export function starTexture(): THREE.Texture {
  star ??= canvasTexture(128, (g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? c : c * 0.14;
      const a = (i * Math.PI) / 4;
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });
  return star;
}

/** A soft round glow: hit and parry flashes. */
export function glowTexture(): THREE.Texture {
  glow ??= canvasTexture(64, (g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  return glow;
}

/** A rune circle: two rings, a triangle and tick marks (the woven-cast flash). White, tinted by the sprite. */
export function runeTexture(): THREE.Texture {
  rune ??= canvasTexture(128, (g, s) => {
    const c = s / 2;
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.shadowColor = 'rgba(255,255,255,0.9)';
    g.shadowBlur = 6;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(c, c, c * 0.86, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, c * 0.68, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      g.lineTo(c + Math.cos(a) * c * 0.66, c + Math.sin(a) * c * 0.66);
    }
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * c * 0.7, c + Math.sin(a) * c * 0.7);
      g.lineTo(c + Math.cos(a) * c * 0.84, c + Math.sin(a) * c * 0.84);
      g.stroke();
    }
  });
  return rune;
}
