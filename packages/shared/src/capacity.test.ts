/**
 * The lobby capacity limit (Phase 6.14).
 *
 * The constant is the single source the backend enforces and the dashboard
 * renders, so its value and the state thresholds are pinned here: a change to
 * either must be a deliberate product decision, not a silent drift.
 */

import { describe, expect, it } from 'vitest';

import { freeLobbySeats, lobbyCapacityState, MAX_PLAYERS_PER_LOBBY } from './constants.js';

describe('lobby capacity', () => {
  it('holds 50 players, as decided', () => {
    expect(MAX_PLAYERS_PER_LOBBY).toBe(50);
  });

  it('counts free places from the seated number', () => {
    expect(freeLobbySeats(0)).toBe(50);
    expect(freeLobbySeats(18)).toBe(32);
    expect(freeLobbySeats(49)).toBe(1);
    expect(freeLobbySeats(50)).toBe(0);
  });

  it('never reports a negative number of free places', () => {
    // Defensive: the server refuses a 51st seat, so this cannot happen through
    // the join path, but a bad payload must not render "-1 places free".
    expect(freeLobbySeats(51)).toBe(0);
  });

  it('is normal below 40 seated players', () => {
    expect(lobbyCapacityState(0)).toBe('normal');
    expect(lobbyCapacityState(18)).toBe('normal');
    expect(lobbyCapacityState(39)).toBe('normal');
  });

  it('is high from 40 seated players', () => {
    expect(lobbyCapacityState(40)).toBe('high');
    expect(lobbyCapacityState(49)).toBe('high');
  });

  it('is full at the limit and beyond', () => {
    expect(lobbyCapacityState(50)).toBe('full');
    expect(lobbyCapacityState(51)).toBe('full');
  });
});
