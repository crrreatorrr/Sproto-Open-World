import { padGlyph, type InputDevice, type PadStyle } from './Gamepad';

/** Readable key name: KeyW -> W, Digit1 -> 1, ShiftLeft -> L Shift, Mouse0 -> LMB, Escape -> Esc. */
export function keyLabel(code: string): string {
  if (!code) return '';
  const named: Record<string, string> = {
    Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB',
    Escape: 'Esc', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    AltLeft: 'L Alt', AltRight: 'R Alt', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[',
    BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab', Enter: 'Enter',
  };
  if (named[code]) return named[code];
  return code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
}

/** The prompt label for an action on the active device: its first bound key or pad button. */
export function promptLabel(device: InputDevice, style: PadStyle, keys: readonly string[], pad: readonly string[]): string {
  if (device === 'gamepad') return pad.length ? padGlyph(pad[0], style) : '—';
  const k = keys.find(Boolean);
  return k ? keyLabel(k) : '—';
}
