import Image from 'next/image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameStatus, LeaderboardEntry, PlayerProfile, ScoreState } from './types';
import TouchControls from './TouchControls';

const MENU_EVENT_NAME = 'kiloman:menu-action';
const MENU_NAV_EVENT_NAME = 'kiloman:menu-nav';
const NAME_MAX_LENGTH = 20;
const DEATH_ACTION_DELAY_MS = 900;
const VEGAS_BULB_COUNT = 40;

type AdminActionType = 'archive' | 'purge';

interface UIOverlayProps {
  gameState: GameStatus;
  onStartTurn: (profile: PlayerProfile) => void;
  onContinue: () => void;
  onNewTurn: () => void;
  score: ScoreState;
  playerProfile: PlayerProfile | null;
  livesRemaining: number;
  maxLives: number;
  turnBest: ScoreState;
  leaderboard: LeaderboardEntry[];
  countdown: number;
  onDeleteScore: (id: string, adminSecret: string) => Promise<boolean>;
  onVerifyAdmin: (adminSecret: string) => Promise<boolean>;
  onArchiveScores: (adminSecret: string) => Promise<boolean>;
  onPurgeScores: (adminSecret: string) => Promise<boolean>;
  muted: boolean;
  onToggleMute: () => void;
  speedMultiplier: number;
  onSpeedChange: (value: number) => void;
}

interface VegasBulbRingProps {
  reverse?: boolean;
  startOffset?: number;
}

const VegasBulbRing: React.FC<VegasBulbRingProps> = ({ reverse = false, startOffset = 0 }) => (
  <div className="vegas-bulb-ring" aria-hidden="true">
    {Array.from({ length: VEGAS_BULB_COUNT }, (_, index) => {
      const progress = index / VEGAS_BULB_COUNT;
      const chaseIndex = reverse
        ? (VEGAS_BULB_COUNT - index + startOffset) % VEGAS_BULB_COUNT
        : (index + startOffset) % VEGAS_BULB_COUNT;
      let style: React.CSSProperties;

      if (progress < 0.25) {
        style = { left: `${progress * 4 * 100}%`, top: '0%' };
      } else if (progress < 0.5) {
        style = { left: '100%', top: `${(progress - 0.25) * 4 * 100}%` };
      } else if (progress < 0.75) {
        style = { left: `${(1 - (progress - 0.5) * 4) * 100}%`, top: '100%' };
      } else {
        style = { left: '0%', top: `${(1 - (progress - 0.75) * 4) * 100}%` };
      }

      return <span key={index} className="vegas-bulb" style={{ ...style, '--bulb-index': chaseIndex } as React.CSSProperties} />;
    })}
  </div>
);

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, message, confirmLabel, onConfirm, onCancel, busy }) => {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Default focus on Cancel so an accidental Enter/joystick press doesn't destroy data.
    cancelButtonRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 pointer-events-auto"
    >
      <div className="arcade-panel arcade-menu text-center max-w-lg w-full mx-4 p-8">
        <h3 className="arcade-title text-3xl mb-4 text-red-400">{title}</h3>
        <p className="arcade-copy mb-8">{message}</p>
        <div className="flex justify-center gap-4">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="arcade-button disabled:opacity-50"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="arcade-button arcade-delete-button disabled:opacity-50"
          >
            {busy ? 'WORKING...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
  onStartTurn,
  onContinue,
  onNewTurn,
  score,
  playerProfile,
  livesRemaining,
  maxLives,
  turnBest,
  leaderboard,
  countdown,
  onDeleteScore,
  onVerifyAdmin,
  onArchiveScores,
  onPurgeScores,
  muted,
  onToggleMute,
  speedMultiplier,
  onSpeedChange,
}) => {
  const [name, setName] = useState('');
  const [deathActionReady, setDeathActionReady] = useState(true);
  const [adminMode, setAdminMode] = useState(false);
  const [adminSecret, setAdminSecret] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminVerified, setAdminVerified] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<AdminActionType | null>(null);
  const [controlExplainer, setControlExplainer] = useState<'joystick' | 'keyboard'>('joystick');
  const primaryActionRef = useRef<(() => void) | null>(null);
  const nextLifeButtonRef = useRef<HTMLButtonElement>(null);
  const isDialogOpenRef = useRef(false);

  const hasLivesAfterDeath = gameState === 'lost' && livesRemaining > 0;
  const turnOver = gameState === 'lost' && livesRemaining === 0;
  const enteredName = name.trim();
  const canStart = enteredName.length >= 2;

  isDialogOpenRef.current = confirmAction !== null;

  const startTurn = useCallback(() => {
    if (!canStart) return;
    onStartTurn({ name: enteredName });
  }, [canStart, enteredName, onStartTurn]);

  const deleteScore = async (id: string) => {
    setAdminError('');
    const deleted = await onDeleteScore(id, adminSecret);
    if (!deleted) {
      setAdminError('BAD ADMIN CODE');
    }
  };

  const verifyAdmin = async () => {
    setAdminError('');
    setAdminBusy(true);
    const verified = await onVerifyAdmin(adminSecret);
    setAdminBusy(false);
    setAdminVerified(verified);
    if (!verified) {
      setAdminError('BAD ADMIN CODE');
    }
  };

  const runAdminAction = async (action: AdminActionType) => {
    setAdminBusy(true);
    setAdminError('');
    const ok = action === 'archive'
      ? await onArchiveScores(adminSecret)
      : await onPurgeScores(adminSecret);
    setAdminBusy(false);
    setConfirmAction(null);
    if (!ok) {
      setAdminError('ACTION FAILED');
    }
  };

  useEffect(() => {
    if (gameState === 'start') {
      setName('');
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState !== 'start') {
      setAdminMode(false);
      setAdminVerified(false);
      setAdminSecret('');
      setAdminError('');
      setConfirmAction(null);
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState !== 'lost') {
      setDeathActionReady(true);
      return;
    }

    setDeathActionReady(false);
    const timeoutId = window.setTimeout(() => setDeathActionReady(true), DEATH_ACTION_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [gameState]);

  // Default-focus the primary action button on the life-lost screen so pressing
  // Enter on the keyboard activates it immediately.
  useEffect(() => {
    if (gameState === 'lost' && deathActionReady) {
      nextLifeButtonRef.current?.focus();
    }
  }, [gameState, deathActionReady]);

  useEffect(() => {
    if (gameState === 'start') {
      primaryActionRef.current = startTurn;
    } else if (gameState === 'lost') {
      primaryActionRef.current = deathActionReady ? onContinue : null;
    } else if (gameState === 'won') {
      primaryActionRef.current = onNewTurn;
    } else {
      primaryActionRef.current = null;
    }
  }, [deathActionReady, gameState, onContinue, onNewTurn, startTurn]);

  useEffect(() => {
    const handleMenuAction = () => {
      // While a confirmation dialog is open, the joystick action button should
      // activate whichever dialog button currently has focus, not the game's
      // primary action (e.g. Start Game).
      if (isDialogOpenRef.current) {
        (document.activeElement as HTMLElement | null)?.click();
        return;
      }
      primaryActionRef.current?.();
    };

    const handleMenuNav = (event: Event) => {
      if (isDialogOpenRef.current) {
        const direction = (event as CustomEvent<{ direction: string }>).detail?.direction;
        if (direction === 'left' || direction === 'right') {
          const dialog = document.querySelector('[role="dialog"]');
          const buttons = dialog ? Array.from(dialog.querySelectorAll('button')) : [];
          if (buttons.length === 0) return;
          const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const nextIndex = direction === 'left'
            ? Math.max(0, activeIndex - 1)
            : Math.min(buttons.length - 1, activeIndex + 1);
          (buttons[nextIndex] as HTMLButtonElement)?.focus();
        }
        return;
      }
    };

    window.addEventListener(MENU_EVENT_NAME, handleMenuAction);
    window.addEventListener(MENU_NAV_EVENT_NAME, handleMenuNav as EventListener);
    return () => {
      window.removeEventListener(MENU_EVENT_NAME, handleMenuAction);
      window.removeEventListener(MENU_NAV_EVENT_NAME, handleMenuNav as EventListener);
    };
  }, [gameState]);

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 arcade-root">
      <div className="flex justify-between items-start pointer-events-auto gap-4">
        <div className="arcade-panel p-5 text-yellow-300 min-w-72">
          <h1 className="arcade-title text-3xl mb-3">KILO MAN</h1>
          <div className="arcade-stat-grid">
            <p>PLAYER {playerProfile?.name ?? '---'}</p>
            <p>LIVES {'♥'.repeat(livesRemaining)}{'♡'.repeat(maxLives - livesRemaining)}</p>
            <p>SCORE {score.current.toLocaleString()}</p>
            <p>BEST {Math.max(turnBest.current, score.current).toLocaleString()}</p>
            <p>DIST {score.distance.toLocaleString()}M</p>
          </div>
        </div>

        <div className="arcade-panel p-5 text-yellow-300 text-right hidden sm:block">
          <p className="arcade-help">MOVE: STICK / D-PAD</p>
          <p className="arcade-help">JUMP / SELECT: BUTTON</p>
          <p className="arcade-help">KEYBOARD: ARROWS + SPACE</p>
        </div>
      </div>

      {gameState === 'lost' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 pointer-events-auto kiloman-death-screen-shake">
          <div className="arcade-panel arcade-menu text-center max-w-3xl w-full mx-4 p-8">
            <Image src="/kman2.png" alt="Kilo Man defeated" width={280} height={280} className="kiloman-death-image mx-auto mb-5 max-h-56 object-contain" />
            <h2 className="arcade-title text-6xl text-red-500 mb-5">
              {turnOver ? 'TURN OVER' : 'LIFE LOST'}
            </h2>
            <div className="arcade-score-card mb-6">
              <div className="text-7xl text-yellow-300">{score.current.toLocaleString()}</div>
              <div className="text-2xl text-yellow-100">RUN SCORE</div>
            </div>
            <p className="arcade-copy mb-6">
              LIVES LEFT {livesRemaining} • BEST RUN {Math.max(turnBest.current, score.current).toLocaleString()}
            </p>
            <button
              ref={nextLifeButtonRef}
              onClick={onContinue}
              disabled={!deathActionReady}
              autoFocus
              className="arcade-button disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
            >
              {hasLivesAfterDeath ? 'NEXT LIFE' : 'SAVE SCORE'}
            </button>
            <p className="arcade-help mt-5">
              {deathActionReady ? 'On joystick, press A button. (or press Enter)' : 'GET READY...'}
            </p>
          </div>
        </div>
      )}

      {gameState === 'countdown' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/65 pointer-events-auto">
          <div className="arcade-panel arcade-countdown-panel text-center p-10">
            <p className="arcade-copy text-3xl mb-4">GET READY</p>
            <div className="arcade-countdown-number" key={countdown}>{countdown}</div>
          </div>
        </div>
      )}

      {gameState === 'start' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/95 pointer-events-auto overflow-y-auto py-8">
          <div className="max-w-6xl w-full mx-4">
            <div className="vegas-title-wrap mb-7 text-center">
              <h1 className="vegas-title-main">KILO MAN</h1>
              <div className="vegas-title-script">in Vegas</div>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_460px] gap-6">
              <div className="vegas-bulb-frame">
                <VegasBulbRing startOffset={VEGAS_BULB_COUNT / 4} />
                <div className="arcade-panel arcade-menu p-8 text-center h-full">
                  <p className="arcade-copy text-2xl mb-4">ENTER YOUR CHARACTER NAME</p>
                  <p className="arcade-help mb-6">Up to {NAME_MAX_LENGTH} characters</p>

                  <div className="flex justify-center mb-8">
                    <input
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value.slice(0, NAME_MAX_LENGTH))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          startTurn();
                        }
                      }}
                      maxLength={NAME_MAX_LENGTH}
                      placeholder="CHARACTER NAME"
                      autoFocus
                      className="arcade-admin-input text-center text-2xl w-full max-w-xs"
                      aria-label="Character name"
                    />
                  </div>

                  <div className="arcade-instructions mb-8">
                    <div className="arcade-control-toggle-row mb-3">
                      <span>Controls:</span>
                      <button
                        type="button"
                        onClick={() => setControlExplainer('joystick')}
                        className={`arcade-control-toggle ${controlExplainer === 'joystick' ? 'arcade-control-toggle--active' : ''}`}
                        aria-label="Show joystick controls"
                      >
                        🕹
                      </button>
                      <button
                        type="button"
                        onClick={() => setControlExplainer('keyboard')}
                        className={`arcade-control-toggle ${controlExplainer === 'keyboard' ? 'arcade-control-toggle--active' : ''}`}
                        aria-label="Show keyboard controls"
                      >
                        ⌨
                      </button>
                    </div>
                    {controlExplainer === 'joystick' ? (
                      <>
                        <p>Jump / Accept: Red Button</p>
                        <p>Move: Joystick</p>
                      </>
                    ) : (
                      <>
                        <p>Type: Enter Character Name</p>
                        <p>Enter: Start Game</p>
                        <p>Space: Jump</p>
                      </>
                    )}
                  </div>

                  <div className="arcade-speed-control mb-8">
                    <label className="arcade-help mb-2 block text-center">
                      SPEED: {speedMultiplier.toFixed(1)}x
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={speedMultiplier}
                      onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
                      className="arcade-slider w-full"
                      aria-label="Game speed"
                    />
                    <div className="flex justify-between text-xs arcade-help">
                      <span>SLOW</span>
                      <span>FAST</span>
                    </div>
                  </div>

                  <button onClick={startTurn} disabled={!canStart} className="arcade-button text-3xl disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none">
                    START GAME
                  </button>
                </div>
              </div>

              <div className="vegas-bulb-frame">
                <VegasBulbRing reverse startOffset={VEGAS_BULB_COUNT / 2} />
                <div className="arcade-panel p-6 text-yellow-300 h-full">
                  <h2 className="arcade-title text-4xl mb-5 text-center">TOP SCORES</h2>
                  {adminError && <p className="arcade-help text-center text-red-300 mb-4">{adminError}</p>}
                  {leaderboard.length === 0 ? (
                    <p className="arcade-copy text-center">NO SCORES YET</p>
                  ) : (
                    <ol className="space-y-3">
                      {leaderboard.map((entry, index) => (
                        <li key={`${entry.name}-${entry.date}`} className="arcade-leader-row">
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <span>{entry.name}</span>
                          <span>{entry.score.toLocaleString()}</span>
                          {adminMode && adminVerified && (
                            <button type="button" onClick={() => void deleteScore(entry.id)} className="arcade-delete-button">
                              DEL
                            </button>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => setAdminMode((value) => {
                  const next = !value;
                  if (!next) {
                    setAdminVerified(false);
                    setAdminSecret('');
                    setAdminError('');
                  }
                  return next;
                })}
                className="arcade-admin-link"
              >
                {adminMode ? 'close admin' : 'admin'}
              </button>
              {adminMode && !adminVerified && (
                <div className="flex flex-col items-center gap-2">
                  <input
                    value={adminSecret}
                    onChange={(event) => setAdminSecret(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void verifyAdmin();
                      }
                    }}
                    type="password"
                    placeholder="ADMIN CODE"
                    className="arcade-admin-input"
                  />
                  <button
                    type="button"
                    onClick={() => void verifyAdmin()}
                    disabled={adminBusy || adminSecret.length === 0}
                    className="arcade-admin-button disabled:opacity-50"
                  >
                    {adminBusy ? 'CHECKING...' : 'UNLOCK ADMIN'}
                  </button>
                </div>
              )}
              {adminMode && adminVerified && (
                <div className="flex flex-col items-center gap-2">
                  <p className="arcade-help text-center text-green-300">ADMIN UNLOCKED</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmAction('archive')}
                      className="arcade-admin-button"
                    >
                      SAVE &amp; CLEAR LEADERBOARD
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAction('purge')}
                      className="arcade-admin-button arcade-delete-button"
                    >
                      DELETE ALL HISTORY
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {gameState === 'won' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 pointer-events-auto">
          <div className="arcade-panel arcade-menu p-8 text-center max-w-xl">
            <h2 className="arcade-title text-6xl mb-6 text-yellow-300">MISSION COMPLETE</h2>
            <p className="arcade-copy mb-8">OBJECTIVE SECURED</p>
            <button onClick={onNewTurn} autoFocus className="arcade-button">NEW GAME</button>
            <p className="arcade-help mt-5">On joystick, press A button. (or press Enter)</p>
          </div>
        </div>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction === 'archive' ? 'SAVE & CLEAR LEADERBOARD?' : 'DELETE ALL HISTORY?'}
          message={
            confirmAction === 'archive'
              ? 'This archives the current leaderboard and starts a fresh group of players. Archived scores are kept in history.'
              : 'This permanently deletes every score, including archived history. This cannot be undone.'
          }
          confirmLabel={confirmAction === 'archive' ? 'SAVE & CLEAR' : 'DELETE ALL'}
          busy={adminBusy}
          onConfirm={() => void runAdminAction(confirmAction)}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <TouchControls active={gameState === 'playing'} />

      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? 'Unmute music' : 'Mute music'}
        aria-pressed={muted}
        className="fixed top-3 right-3 arcade-mute-button text-xs pointer-events-auto select-none z-50"
      >
        {muted ? 'UNMUTE' : 'MUTE'}
      </button>

      <div className="fixed bottom-3 left-3 pointer-events-auto z-50 arcade-speed-hud">
        <label className="arcade-help text-xs block mb-1">{speedMultiplier.toFixed(1)}x</label>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          value={speedMultiplier}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          className="arcade-slider arcade-slider--small"
          aria-label="Game speed"
        />
      </div>

      <p className="absolute bottom-2 left-20 text-gray-500 text-xs pointer-events-none select-none">
        qq to quit
      </p>
    </div>
  );
};

export default UIOverlay;
