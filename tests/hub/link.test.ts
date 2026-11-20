import { describe, expect, it, vi } from 'vitest';
import { GAME_IDS } from '@metaverse/hub-sdk/core';
import { HUB_GAME_ID } from '../../src/hub/config';
import { hubExitUrl, startHub, trustedHubUrl, usernameFromToken, type HubApi } from '../../src/hub/link';
import { hubChipText, type HubChip } from '../../src/ui/menus';

/** The hub visit (src/hub/link.ts), as Sproto Shooter's src/hub/link.js. */

const jwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;

function api(session: ReturnType<NonNullable<HubApi['getSession']>>, init: () => Promise<unknown> = () => Promise.resolve({})): HubApi & { exit: ReturnType<typeof vi.fn> } {
  return {
    init: init as HubApi['init'],
    exit: vi.fn(),
    getSession: () => session,
    loadSave: () => Promise.resolve({ data: null, updatedAt: 0 }),
    writeSave: (data) => Promise.resolve({ data, updatedAt: 1 }),
  };
}

const session = (over: Partial<{ playerId: string; game: string; token: string; expiresAt: number }> = {}) => ({
  token: jwt({ usn: 'sprout' }),
  playerId: 'p1',
  game: HUB_GAME_ID,
  ranked: false,
  expiresAt: 0,
  ...over,
}) as NonNullable<ReturnType<NonNullable<HubApi['getSession']>>>;

describe('the hub visit', () => {
  it('the vendored SDK lists this game, so a portal ticket redeems', () => {
    expect((GAME_IDS as readonly string[]).includes(HUB_GAME_ID)).toBe(true);
  });

  it('a signed-in visit is that hub account; a blank username is a hub guest', async () => {
    const { link, ready } = startHub({ api: api(session()), starting: true });
    expect(link.status).toBe('connecting');
    expect(link.settled).toBe(false);
    await ready;
    expect(link).toMatchObject({ status: 'connected', bankable: true, playerId: 'p1', accountLabel: 'sprout', settled: true });

    const guest = await startHub({ api: api(session({ token: jwt({}) })), starting: true }).ready;
    expect(guest).toMatchObject({ status: 'guest', accountLabel: 'Guest', bankable: true });
  });

  it('no ticket and no session is standalone at once; a failed redeem or expired session plays on offline', async () => {
    const plain = startHub({ api: api(null), starting: false });
    expect(plain.link.status).toBe('offline');
    expect(plain.link.settled).toBe(true);
    expect((await plain.ready).bankable).toBe(false);

    const bad = await startHub({ api: api(null, () => Promise.reject(Object.assign(new Error('ticket_used'), { code: 'ticket_used' }))), starting: true }).ready;
    expect(bad).toMatchObject({ status: 'error', code: 'ticket_used', bankable: false });

    const expired = await startHub({ api: api(session({ expiresAt: 5 })), starting: true, now: () => 10 }).ready;
    expect(expired).toMatchObject({ status: 'error', code: 'session_expired', bankable: false });

    const otherGame = await startHub({ api: api(session({ game: 'sproto-shooter' })), starting: true }).ready;
    expect(otherGame.status).toBe('offline');
  });

  it('a dead session turns the chip to an error; other failures do not', async () => {
    const link = await startHub({ api: api(session()), starting: true }).ready;
    expect(link.noteSessionError(Object.assign(new Error('x'), { code: 'network' }))).toBe(false);
    expect(link.status).toBe('connected');
    expect(link.noteSessionError(Object.assign(new Error('x'), { code: 'session_closed' }))).toBe(true);
    expect(link).toMatchObject({ status: 'error', bankable: false });
  });

  it('Return to Hub closes a live session through the SDK, and still leaves standalone', async () => {
    const a = api(session());
    const navigate = vi.fn();
    const link = await startHub({ api: a, starting: true, navigate }).ready;
    link.exitToHub();
    expect(a.exit).toHaveBeenCalledWith('return');
    expect(navigate).not.toHaveBeenCalled();

    const away = vi.fn();
    const solo = await startHub({ api: api(null), starting: false, navigate: away }).ready;
    solo.exitToHub();
    expect(away).toHaveBeenCalledWith('/hub/#from=sproto-open-world');
  });

  it('the hub page is the build’s own, checked like Sproto Shooter’s', () => {
    expect(trustedHubUrl(undefined)).toBe('/hub/');
    expect(trustedHubUrl('/hub')).toBe('/hub/');
    expect(trustedHubUrl('https://hub.example.com/hub/#x')).toBe('https://hub.example.com/hub/');
    expect(trustedHubUrl('http://127.0.0.1:5173/hub/')).toBe('http://127.0.0.1:5173/hub/');
    expect(() => trustedHubUrl('http://evil.example.com/hub/')).toThrow('hub_origin');
    expect(() => trustedHubUrl('//evil.example.com/')).toThrow('hub_url');
    expect(() => trustedHubUrl('https://hub.example.com/?t=abc')).toThrow('hub_url_token');
    expect(hubExitUrl('https://hub.example.com/hub/')).toBe('https://hub.example.com/hub/#from=sproto-open-world');
  });

  it('reads the username from the token', () => {
    expect(usernameFromToken(jwt({ usn: ' ken ' }))).toBe('ken');
    expect(usernameFromToken('nope')).toBe('');
    expect(usernameFromToken(undefined)).toBe('');
  });
});

describe('the title’s hub chip', () => {
  const chip = (over: Partial<HubChip>): HubChip => ({ status: 'connected', label: 'sprout', error: '', owner: 'account', sync: 'synced', ...over });
  it('says who is signed in and where the save lives', () => {
    expect(hubChipText(chip({}))).toBe('sprout · save in the cloud');
    expect(hubChipText(chip({ status: 'guest', label: 'Guest', sync: 'syncing' }))).toBe('Guest · syncing your save…');
    expect(hubChipText(chip({ status: 'offline', owner: 'device', sync: 'local' }))).toBe('Not signed in · saves on this browser');
    expect(hubChipText(chip({ status: 'connecting', owner: 'pending' }))).toBe('Signing in to the hub…');
    expect(hubChipText(chip({ status: 'error', error: 'ticket_used', owner: 'device', sync: 'local' }))).toBe('Hub: ticket_used · saves on this browser');
  });
});
