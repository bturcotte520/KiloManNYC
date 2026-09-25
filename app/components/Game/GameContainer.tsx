'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import GameCanvas from './GameCanvas';
import UIOverlay from './UIOverlay';
import { GameMusic } from '@/app/lib/music';
import { GameStatus, LeaderboardEntry, PlayerProfile, ScoreState } from './types';

const MAX_LIVES = 3;
const PENDING_KEY = 'nyc-pending-score';
type PendingScore = { submissionId: string; name: string; score: number; distance: number };

const GameContainer: React.FC = () => {
  const [gameState, setGameState] = useState<GameStatus>('start');
  const [score, setScore] = useState<ScoreState>({ current: 0, best: 0, distance: 0 });
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [livesRemaining, setLivesRemaining] = useState<number>(MAX_LIVES);
  const [turnBest, setTurnBest] = useState<ScoreState>({ current: 0, best: 0, distance: 0 });
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [countdown, setCountdown] = useState<number>(3);
  const lastLossHandledRef = useRef(false);
  const quitStateRef = useRef({ score, turnBest, playerProfile, gameState });
  const musicRef = useRef<GameMusic | null>(null);
  const [muted, setMuted] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);
  const [station, setStation] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [stationSecret, setStationSecret] = useState('');
  const [stationError, setStationError] = useState('');
  const [stationBusy, setStationBusy] = useState(false);
  const [pending, setPending] = useState<PendingScore | null>(null);
  const pendingRef = useRef<PendingScore | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [recoveryError, setRecoveryError] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PENDING_KEY);
      if (stored) {
        const entry = JSON.parse(stored) as PendingScore;
        if (!entry || typeof entry.submissionId !== 'string' || typeof entry.name !== 'string' || !Number.isSafeInteger(entry.score) || !Number.isSafeInteger(entry.distance)) throw new Error('Invalid pending score');
        pendingRef.current = entry;
        setPending(entry);
      }
    } catch {
      setRecoveryError('Pending score storage could not be read. Ask event staff to recover this browser before starting another turn.');
    }
    void fetch('/api/station', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('Station check failed');
      const body = await response.json();
      setStation(body.unlocked ? 'unlocked' : 'locked');
    }).catch(() => {
      setStation('locked');
      setStationError('Could not check station access. Try unlocking again.');
    });
  }, []);

  const unlockStation = async (event: React.FormEvent) => {
    event.preventDefault();
    setStationBusy(true);
    setStationError('');
    try {
      const response = await fetch('/api/station', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: stationSecret }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Station unlock failed');
      setStationSecret('');
      setStation('unlocked');
    } catch (error) {
      setStationError(error instanceof Error ? error.message : 'Station unlock failed');
    } finally { setStationBusy(false); }
  };

  const relockStation = async () => {
    if (pendingRef.current || gameState !== 'start') return;
    setStationBusy(true);
    setStationError('');
    try {
      const response = await fetch('/api/station', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not relock station. Please retry.');
      setStation('locked');
    } catch (error) {
      setStationError(error instanceof Error ? error.message : 'Could not relock station');
    } finally { setStationBusy(false); }
  };

  useEffect(() => {
    return () => musicRef.current?.dispose();
  }, []);

  useEffect(() => {
    if (station !== 'unlocked' || pending || recoveryError) {
      musicRef.current?.stop();
      return;
    }
    if (!musicRef.current) musicRef.current = new GameMusic();
    const music = musicRef.current;
    if (gameState === 'lost' || gameState === 'won') {
      music.stop();
    } else if (gameState === 'start') {
      music.start('menu');
    } else {
      music.start('game');
    }
  }, [gameState, station, pending, recoveryError]);

  useEffect(() => {
    musicRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    // Browsers block audio until a user gesture. Any click/tap anywhere
    // in the game resumes the AudioContext so the music can actually play.
    const resumeAudio = () => musicRef.current?.resume();
    window.addEventListener('pointerdown', resumeAudio, true);
    return () => window.removeEventListener('pointerdown', resumeAudio, true);
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  useEffect(() => {
    refreshLeaderboard();
  }, []);

  useEffect(() => {
    quitStateRef.current = { score, turnBest, playerProfile, gameState };
  }, [score, turnBest, playerProfile, gameState]);

  const refreshLeaderboard = async () => {
    try {
      const response = await fetch('/api/scores');
      if (!response.ok) return;

      const body = await response.json() as { scores?: LeaderboardEntry[] };
      setLeaderboard(body.scores ?? []);
    } catch { /* The next successful save refreshes the leaderboard. */ }
  };

  useEffect(() => {
    if (gameState === 'countdown') {
      setCountdown(3);
      const ticks = [2, 1, 0];
      const timers = ticks.map((value, index) => window.setTimeout(() => {
        if (value === 0) {
          setGameState('playing');
        } else {
          setCountdown(value);
        }
      }, (index + 1) * 1000));

      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }

    if (gameState === 'playing') {
      lastLossHandledRef.current = false;
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState !== 'lost' || lastLossHandledRef.current) return;

    lastLossHandledRef.current = true;
    setTurnBest((best) => score.current > best.current ? score : best);
    setLivesRemaining((lives) => Math.max(0, lives - 1));
  }, [gameState, score]);

  const saveLeaderboard = useCallback(async (entry: PendingScore) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch('/api/scores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json();
      if (response.status === 401) setStation('locked');
      if (!response.ok) throw new Error(body.error ?? 'Score save failed. Please retry.');
      // Clear durable storage before releasing the turn. Retrying after a storage
      // failure is safe because the server has already recorded this UUID.
      localStorage.removeItem(PENDING_KEY);
      pendingRef.current = null;
      turnIdRef.current = null;
      setPending(null);
      setPlayerProfile(null);
      setLeaderboard(body.scores ?? []);
      setGameState('start');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Score save failed. Please retry.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  const finishTurn = useCallback(() => {
    if (pendingRef.current || !turnIdRef.current) return;
    const { score: current, turnBest: best, playerProfile: profile } = quitStateRef.current;
    if (!profile) return;
    const result = current.current > best.current ? current : best;
    const entry: PendingScore = { submissionId: turnIdRef.current, name: profile.name, score: result.current, distance: Math.floor(result.distance) };
    pendingRef.current = entry;
    setPending(entry);
    setGameState('start');
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(entry)); } catch {
      setSaveError('Browser storage is unavailable. Keep this tab open and retry saving.');
      return;
    }
    void saveLeaderboard(entry);
  }, [saveLeaderboard]);

  const deleteLeaderboardScore = async (id: string, adminSecret: string) => {
    const response = await fetch(`/api/scores/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-secret': adminSecret },
    });
    if (!response.ok) return false;

    const body = await response.json() as { scores?: LeaderboardEntry[] };
    setLeaderboard(body.scores ?? []);
    return true;
  };

  const verifyAdmin = async (adminSecret: string) => {
    const response = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'x-admin-secret': adminSecret },
    });
    return response.ok;
  };

  const archiveScores = async (adminSecret: string) => {
    const response = await fetch('/api/admin/archive', {
      method: 'POST',
      headers: { 'x-admin-secret': adminSecret },
    });
    if (!response.ok) return false;

    const body = await response.json() as { scores?: LeaderboardEntry[] };
    setLeaderboard(body.scores ?? []);
    return true;
  };

  const purgeScores = async (adminSecret: string) => {
    const response = await fetch('/api/admin/purge', {
      method: 'POST',
      headers: { 'x-admin-secret': adminSecret },
    });
    if (!response.ok) return false;

    const body = await response.json() as { scores?: LeaderboardEntry[] };
    setLeaderboard(body.scores ?? []);
    return true;
  };

  const startTurn = (profile: PlayerProfile) => {
    if (station !== 'unlocked' || stationBusy || pendingRef.current || recoveryError || turnIdRef.current) return;
    turnIdRef.current = crypto.randomUUID();
    setPlayerProfile(profile);
    setLivesRemaining(MAX_LIVES);
    setTurnBest({ current: 0, best: 0, distance: 0 });
    setScore({ current: 0, best: 0, distance: 0 });
    setGameState('countdown');
  };

  const handleContinue = () => {
    if (pendingRef.current || station !== 'unlocked') return;
    if (livesRemaining > 0) {
      setGameState('countdown');
      return;
    }

    finishTurn();
  };

  const handleNewTurn = () => {
    finishTurn();
  };

  // "qq" shortcut: save the current run's best score and return to the menu.
  useEffect(() => {
    const QUIT_KEY_WINDOW_MS = 600;
    let lastQTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyQ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && (e.target.closest('input, textarea, select') || e.target.isContentEditable))) return;

      const now = Date.now();
      if (now - lastQTime > QUIT_KEY_WINDOW_MS) {
        lastQTime = now;
        return;
      }
      lastQTime = 0;
      e.preventDefault();

      const { gameState: currentGameState } = quitStateRef.current;
      if (currentGameState === 'start') return;

      finishTurn();
      (document.activeElement as HTMLElement | null)?.blur();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [finishTurn]);

  if (station !== 'unlocked' || pending || recoveryError) {
    return (
      <div className="w-full h-full overflow-auto bg-black text-white flex items-center justify-center p-6">
        <section className="w-full max-w-md border border-white/25 p-6 space-y-5" aria-labelledby="station-heading">
          <p className="text-xs tracking-widest text-yellow-300">NYC / EVENT STATION</p>
          <h1 id="station-heading" className="text-2xl font-bold">{station === 'checking' ? 'Checking station access' : station === 'locked' ? 'Staff unlock required' : 'Save this turn'}</h1>
          {recoveryError && <p role="alert">{recoveryError}</p>}
          {pending && <p>{pending.name}: {pending.score.toLocaleString()} points. This turn must be saved before another player can start. Keep this tab open until confirmed.</p>}
          {station === 'locked' && <form onSubmit={unlockStation} className="space-y-4">
            <label className="block" htmlFor="station-secret">Station secret</label>
            <input id="station-secret" type="password" autoComplete="off" required value={stationSecret} onChange={(event) => setStationSecret(event.target.value)} className="w-full border border-white/40 bg-black p-3 text-white" />
            <button className="arcade-button" disabled={stationBusy} type="submit">{stationBusy ? 'UNLOCKING...' : 'UNLOCK STATION'}</button>
          </form>}
          {stationError && <p role="alert" className="text-red-300">{stationError}</p>}
          {saveError && <p role="alert" className="text-red-300">{saveError}</p>}
          {pending && station === 'unlocked' && <button className="arcade-button" disabled={saving} onClick={() => void saveLeaderboard(pending)}>{saving ? 'SAVING...' : 'RETRY SAVE'}</button>}
          <a href="/scoreboard" className="block underline">View public scoreboard</a>
        </section>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {gameState === 'start' && <div className="absolute bottom-3 left-3 z-[100] max-w-xs">
        <button className="border border-white/40 bg-black px-3 py-2 text-xs text-white" disabled={stationBusy} onClick={() => void relockStation()}>RELOCK STATION</button>
        {stationError && <p role="alert" className="bg-black text-red-300 text-sm">{stationError}</p>}
      </div>}
      <GameCanvas
        gameState={gameState}
        setGameState={setGameState}
        onScoreChange={setScore}
        speedMultiplier={speedMultiplier}
      />
      <UIOverlay
        gameState={gameState}
        onStartTurn={startTurn}
        onContinue={handleContinue}
        onNewTurn={handleNewTurn}
        score={score}
        playerProfile={playerProfile}
        livesRemaining={livesRemaining}
        maxLives={MAX_LIVES}
        turnBest={turnBest}
        leaderboard={leaderboard}
        countdown={countdown}
        onDeleteScore={deleteLeaderboardScore}
        onVerifyAdmin={verifyAdmin}
        onArchiveScores={archiveScores}
        onPurgeScores={purgeScores}
        muted={muted}
        onToggleMute={toggleMute}
        speedMultiplier={speedMultiplier}
        onSpeedChange={setSpeedMultiplier}
      />
    </div>
  );
};

export default GameContainer;
