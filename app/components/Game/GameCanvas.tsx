import React, { useCallback, useRef, useEffect } from 'react';
import { GameStatus, PlayerState, GameConfig, LevelEntity, MonsterState, ScoreState } from './types';
import { GameSFX } from '@/app/lib/sfx';

const INPUT_EVENT_NAME = 'kiloman:input';
const MENU_EVENT_NAME = 'kiloman:menu-action';
const MENU_NAV_EVENT_NAME = 'kiloman:menu-nav';
const CHUNK_WIDTH = 900;
const RENDER_BUFFER = 1400;
const MONSTER_POINTS = 10;
const SCORE_POPUP_LIFETIME = 55;
const GROUND_Y = 550;
const PLATFORM_HEIGHT = 22;
const MAX_REACHABLE_GAP = 120;
const MAX_REACHABLE_CLIMB = 55;
const PLAYER_MAX_SPEED = 8.0;
const AUTOSCROLL_START_SPEED = 0.84;
const AUTOSCROLL_MAX_SPEED = PLAYER_MAX_SPEED * 0.9;
const WALL_PADDING = 18;
const MONSTER_PLATFORM_WIDTH_BONUS = 35;
const FALL_DEATH_SCREEN_MARGIN = 220;
const START_PLATFORM_X = 40;
const START_PLATFORM_Y = GROUND_Y - 40;
const START_PLATFORM_WIDTH = 520;
const START_CHUNK_PLATFORM_SHIFT = 430;
const VEGAS_SCENE_WIDTH = 1400;

const seededRandom = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const range = (seed: number, min: number, max: number) => min + seededRandom(seed) * (max - min);

const difficultyForChunk = (chunk: number) => Math.min(1, chunk / 18);

const enemySpeedForX = (x: number) => Math.min(6.5, 0.75 + x / 3200);

const chipValueForChunk = (chunk: number) => 5 + Math.min(20, Math.floor(chunk / 5) * 5);

const wrapSceneX = (x: number, width: number) => ((x % width) + width) % width;

interface GameCanvasProps {
  gameState: GameStatus;
  setGameState: (status: GameStatus) => void;
  onScoreChange: (score: ScoreState) => void;
}

interface ScorePopup {
  id: number;
  x: number;
  y: number;
  value: number;
  age: number;
}

const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, setGameState, onScoreChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const [dimensions, setDimensions] = React.useState({ width: 800, height: 600 });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    // Initial resize
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Game Constants
  const CONFIG: GameConfig = {
    gravity: 0.66,
    friction: 0.85,
    moveSpeed: 0.8,
    maxSpeed: PLAYER_MAX_SPEED,
    baseJumpForce: -14,
    levelWidth: CHUNK_WIDTH,
  };

  // Mutable Game State
  const playerRef = useRef<PlayerState>({
    x: 50,
    y: 350,
    vx: 0,
    vy: 0,
    width: 30,
    height: 50, // Taller for humanoid
    isGrounded: false,
    facing: 1,
    frame: 0,
  });

  const cameraRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scrollXRef = useRef<number>(0);
  const monstersRef = useRef<MonsterState[]>([]);
  const entitiesRef = useRef<LevelEntity[]>([]);
  const scorePopupsRef = useRef<ScorePopup[]>([]);
  const generatedChunksRef = useRef<Set<number>>(new Set());
  const scoreRef = useRef<ScoreState>({ current: 0, best: 0, distance: 0 });
  const bonusScoreRef = useRef<number>(0);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const logoRef = useRef<HTMLImageElement | null>(null);
  const gameStateRef = useRef<GameStatus>(gameState);
  const setGameStateRef = useRef(setGameState);
  const lastScorePublishFrameRef = useRef<number>(0);
  const updateRef = useRef<() => void>(() => {});
  const drawRef = useRef<(ctx: CanvasRenderingContext2D) => void>(() => {});
  const sfxRef = useRef<GameSFX | null>(null);

  useEffect(() => {
    sfxRef.current = new GameSFX();
    return () => { sfxRef.current?.dispose(); sfxRef.current = null; };
  }, []);

  useEffect(() => {
    gameStateRef.current = gameState;
    setGameStateRef.current = setGameState;
  }, [gameState, setGameState]);

  const publishScore = useCallback((score: ScoreState) => {
    scoreRef.current = score;
    onScoreChange(score);
  }, [onScoreChange]);

  const appendChunk = useCallback((chunk: number) => {
    if (generatedChunksRef.current.has(chunk)) return;

    const x0 = chunk * CHUNK_WIDTH;
    const difficulty = difficultyForChunk(chunk);
    const entities: LevelEntity[] = [];

    if (chunk === 0) {
      entities.push(
        { id: 'starter-platform', x: START_PLATFORM_X, y: START_PLATFORM_Y, w: START_PLATFORM_WIDTH, h: PLATFORM_HEIGHT, type: 'platform', showStartArrow: true },
        { id: 'start-0', x: 0 + START_CHUNK_PLATFORM_SHIFT, y: GROUND_Y - 40, w: 260, h: PLATFORM_HEIGHT, type: 'platform' },
        { id: 'step-0-0', x: 330 + START_CHUNK_PLATFORM_SHIFT, y: 455, w: 170, h: PLATFORM_HEIGHT, type: 'platform' },
        { id: 'step-0-1', x: 580 + START_CHUNK_PLATFORM_SHIFT, y: 420, w: 170, h: PLATFORM_HEIGHT, type: 'platform' },
        { id: 'step-0-2', x: 825 + START_CHUNK_PLATFORM_SHIFT, y: 440, w: 150, h: PLATFORM_HEIGHT, type: 'platform' }
      );
      entitiesRef.current.push(...entities);
      generatedChunksRef.current.add(chunk);
      return;
    }

    const platformCount = 5 + Math.floor(range(chunk * 19, 0, 2 + difficulty * 2));
    let lastRight = x0 - 20;
    let lastY = GROUND_Y - 80 + range(chunk * 17, -25, 25);

    const chunkStart = Math.max(x0 + 45, lastRight + range(chunk * 13, 55, 105));
    const firstWidth = range(chunk * 31, 160 - difficulty * 20, 210 - difficulty * 20);
    const firstY = Math.max(330, Math.min(GROUND_Y - 70, lastY + range(chunk * 17, -35, 35)));
    entities.push({ id: `platform-${chunk}-start`, x: chunkStart, y: firstY, w: firstWidth, h: PLATFORM_HEIGHT, type: 'platform' });
    lastRight = chunkStart + firstWidth;
    lastY = firstY;

    for (let i = 0; i < platformCount; i++) {
      const gap = range(chunk * 23 + i, 50 + difficulty * 10, MAX_REACHABLE_GAP - difficulty * 12);
      const px = lastRight + gap;
      if (px > x0 + CHUNK_WIDTH - 130) break;

      const verticalDelta = range(chunk * 29 + i, -55 - difficulty * 10, MAX_REACHABLE_CLIMB - difficulty * 10);
      const py = Math.max(315, Math.min(GROUND_Y - 65, lastY - verticalDelta));
      const pw = range(chunk * 31 + i, 135 - difficulty * 18, 200 - difficulty * 35);
      const platformWidth = Math.max(112, pw);
      entities.push({ id: `platform-${chunk}-${i}`, x: px, y: py, w: platformWidth, h: PLATFORM_HEIGHT, type: 'platform' });
      lastRight = px + platformWidth;
      lastY = py;
    }

    while (lastRight < x0 + CHUNK_WIDTH - 125) {
      const bridgeX = lastRight + 65;
      const bridgeY = Math.max(320, Math.min(GROUND_Y - 75, lastY + range(chunk * 53 + entities.length, -35, MAX_REACHABLE_CLIMB)));
      entities.push({
        id: `bridge-${chunk}-${entities.length}`,
        x: bridgeX,
        y: bridgeY,
        w: 170,
        h: PLATFORM_HEIGHT,
        type: 'platform',
      });
      lastRight = bridgeX + 170;
      lastY = bridgeY;
    }

    const platforms = entities.filter(e => e.type === 'platform' && e.w >= 135);
    platforms.forEach((platform, i) => {
      if (chunk > 0 && i % 2 === 1 && range(chunk * 71 + i, 0, 1) > 0.22) {
        const value = chipValueForChunk(chunk);
        entities.push({
          id: `chip-${chunk}-${i}`,
          x: platform.x + platform.w / 2 - 14,
          y: platform.y - 95 - range(chunk * 73 + i, 0, 45),
          w: 28,
          h: 28,
          type: 'chip',
          value,
        });
      }
    });
    const monsterCount = chunk < 2 ? 0 : Math.min(platforms.length, 1 + Math.floor(range(chunk * 41, 0, difficulty * 2.2)));
    for (let i = 0; i < monsterCount; i++) {
      const platform = platforms[Math.floor(range(chunk * 43 + i, 0, platforms.length))];
      platform.w += MONSTER_PLATFORM_WIDTH_BONUS;
      const patrolStart = platform.x + 8;
      const patrolEnd = platform.x + platform.w - 48;
      if (patrolEnd <= patrolStart) continue;

      const speed = enemySpeedForX(patrolStart);
      monstersRef.current.push({
        id: `monster-${chunk}-${i}`,
        x: patrolStart,
        y: platform.y - 40,
        w: 40,
        h: 40,
        vx: speed,
        patrolStart,
        patrolEnd,
        speed,
      });
    }

    entitiesRef.current.push(...entities);
    generatedChunksRef.current.add(chunk);
  }, []);

  const maintainEndlessLevel = (playerX: number) => {
    const currentChunk = Math.floor(playerX / CHUNK_WIDTH);
    appendChunk(currentChunk);
    appendChunk(currentChunk + 1);
    appendChunk(currentChunk + 2);
    appendChunk(currentChunk + 3);

    const cutoff = Math.min(playerX, scrollXRef.current) - RENDER_BUFFER;
    entitiesRef.current = entitiesRef.current.filter(e => e.x + e.w > cutoff);
    monstersRef.current = monstersRef.current.filter(m => m.x + m.w > cutoff);
  };

  // Load Logo
  useEffect(() => {
    const img = new Image();
    img.src = '/KiloLogo.png';
    img.onload = () => {
      logoRef.current = img;
    };
  }, []);

  // Initialize Input Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Touch/mobile integration: TouchControls dispatches a CustomEvent that we translate into key state.
    const handleVirtualInput = (e: Event) => {
      const ev = e as CustomEvent<{ code: string; pressed: boolean }>;
      if (!ev.detail) return;

      // Only accept the small set of virtual inputs we actually support.
      if (!['ArrowLeft', 'ArrowRight', 'Space'].includes(ev.detail.code)) return;
      keysRef.current[ev.detail.code] = ev.detail.pressed;
    };

    window.addEventListener(INPUT_EVENT_NAME, handleVirtualInput as EventListener);

    let animationFrameId = 0;
    let gamepadLeft = false;
    let gamepadRight = false;
    let gamepadJump = false;
    let gamepadUp = false;
    let gamepadDown = false;

    const setGamepadKey = (code: 'ArrowLeft' | 'ArrowRight' | 'Space', pressed: boolean) => {
      keysRef.current[code] = pressed;
    };

    const pollGamepads = () => {
      const gamepads = navigator.getGamepads?.() ?? [];
      const gamepad = Array.from(gamepads).find((pad): pad is Gamepad => Boolean(pad));

      const stickX = gamepad?.axes[0] ?? 0;
      const stickY = gamepad?.axes[1] ?? 0;
      const anyButtonPressed = gamepad?.buttons.some((button) => button.pressed) ?? false;
      const left = Boolean(gamepad?.buttons[14]?.pressed) || stickX < -0.35;
      const right = Boolean(gamepad?.buttons[15]?.pressed) || stickX > 0.35;
      const up = Boolean(gamepad?.buttons[12]?.pressed) || stickY < -0.35;
      const down = Boolean(gamepad?.buttons[13]?.pressed) || stickY > 0.35;
      const jump = anyButtonPressed;

      if (left !== gamepadLeft) {
        gamepadLeft = left;
        setGamepadKey('ArrowLeft', left);
        if (left) window.dispatchEvent(new CustomEvent(MENU_NAV_EVENT_NAME, { detail: { direction: 'left' } }));
      }
      if (right !== gamepadRight) {
        gamepadRight = right;
        setGamepadKey('ArrowRight', right);
        if (right) window.dispatchEvent(new CustomEvent(MENU_NAV_EVENT_NAME, { detail: { direction: 'right' } }));
      }
      if (up !== gamepadUp) {
        gamepadUp = up;
        if (up) window.dispatchEvent(new CustomEvent(MENU_NAV_EVENT_NAME, { detail: { direction: 'up' } }));
      }
      if (down !== gamepadDown) {
        gamepadDown = down;
        if (down) window.dispatchEvent(new CustomEvent(MENU_NAV_EVENT_NAME, { detail: { direction: 'down' } }));
      }
      if (jump !== gamepadJump) {
        gamepadJump = jump;
        setGamepadKey('Space', jump);
        if (jump) {
          window.dispatchEvent(new CustomEvent(MENU_EVENT_NAME));
        }
      }

      animationFrameId = window.requestAnimationFrame(pollGamepads);
    };

    pollGamepads();

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      setGamepadKey('ArrowLeft', false);
      setGamepadKey('ArrowRight', false);
      setGamepadKey('Space', false);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener(INPUT_EVENT_NAME, handleVirtualInput as EventListener);
    };
  }, []);

  // Reset Game State
  useEffect(() => {
    if (gameState === 'countdown') {
      playerRef.current = {
        x: 50,
        y: 350,
        vx: 0,
        vy: 0,
        width: 30,
        height: 50,
        isGrounded: false,
        facing: 1,
        frame: 0,
      };
      cameraRef.current = { x: 0, y: 0 };
      scrollXRef.current = 0;
      entitiesRef.current = [];
      monstersRef.current = [];
      scorePopupsRef.current = [];
      generatedChunksRef.current = new Set();
      bonusScoreRef.current = 0;
      publishScore({ current: 0, best: scoreRef.current.best, distance: 0 });
      appendChunk(0);
      appendChunk(1);
      appendChunk(2);
    }
  }, [appendChunk, gameState, publishScore]);

  // --- RENDERING HELPERS ---

  const drawBackground = (ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // Sky Gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#0f172a'); // Dark Blue/Black
    gradient.addColorStop(1, '#3b0764'); // Deep Purple
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Kilo Logo Background
    if (logoRef.current) {
      const logo = logoRef.current;
      const scale = 1.5; // Large
      const scaledW = logo.width * scale;
      const scaledH = logo.height * scale;
      
      // Center on screen with parallax offset
      // We want it to stay relatively centered but move slightly to show depth
      const parallaxX = cameraX * 0.05;
      const parallaxY = cameraY * 0.05;
      
      const x = (w / 2) - (scaledW / 2) - parallaxX;
      const y = (h / 2) - (scaledH / 2) - parallaxY;
      
      ctx.save();
      ctx.globalAlpha = 0.2; // Subtle background
      ctx.drawImage(logo, x, y, scaledW, scaledH);
      ctx.restore();
    }

    // Parallax Stars/Particles
    ctx.fillStyle = '#FFF';
    for (let i = 0; i < 50; i++) {
      const x = ((i * 137) - cameraX * 0.1) % w; // Fixed parallax direction
      const finalX = x < 0 ? x + w : x;
      const y = (i * 31) % (h / 2);
      ctx.globalAlpha = Math.random() * 0.5 + 0.2;
      ctx.fillRect(finalX, y, 2, 2);
    }
    ctx.globalAlpha = 1.0;

    const drawVegasStrip = (parallax: number, baseY: number, alpha: number) => {
      const offset = wrapSceneX(cameraX * parallax, VEGAS_SCENE_WIDTH);
      ctx.save();
      ctx.globalAlpha = alpha;

      for (let repeat = -1; repeat <= 1; repeat++) {
        const originX = repeat * VEGAS_SCENE_WIDTH - offset;

        // Layered strip silhouettes with deliberate rooflines instead of loose blocks.
        ctx.fillStyle = '#0b102f';
        ctx.fillRect(originX + 58, baseY - 250, 144, 250);
        ctx.fillRect(originX + 252, baseY - 310, 112, 310);
        ctx.fillRect(originX + 575, baseY - 266, 176, 266);
        ctx.fillRect(originX + 1020, baseY - 335, 138, 335);

        ctx.fillStyle = '#15115a';
        ctx.beginPath();
        ctx.moveTo(originX + 58, baseY - 250);
        ctx.lineTo(originX + 130, baseY - 292);
        ctx.lineTo(originX + 202, baseY - 250);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(originX + 285, baseY - 354, 46, 44);
        ctx.beginPath();
        ctx.moveTo(originX + 575, baseY - 266);
        ctx.lineTo(originX + 663, baseY - 318);
        ctx.lineTo(originX + 751, baseY - 266);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(originX + 1057, baseY - 382, 64, 47);

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 2;
        [58, 252, 575, 1020].forEach((towerX, towerIndex) => {
          const towerW = [144, 112, 176, 138][towerIndex];
          const towerH = [250, 310, 266, 335][towerIndex];
          for (let stripe = 1; stripe < 4; stripe++) {
            const sx = originX + towerX + (towerW / 4) * stripe;
            ctx.beginPath();
            ctx.moveTo(sx, baseY - towerH + 12);
            ctx.lineTo(sx, baseY - 8);
            ctx.stroke();
          }
        });

        ctx.fillStyle = 'rgba(250, 204, 21, 0.62)';
        for (let i = 0; i < 30; i++) {
          ctx.fillRect(originX + 82 + (i % 4) * 28, baseY - 220 + Math.floor(i / 4) * 28, 8, 12);
          ctx.fillRect(originX + 278 + (i % 3) * 28, baseY - 280 + Math.floor(i / 3) * 28, 8, 11);
          ctx.fillRect(originX + 606 + (i % 5) * 28, baseY - 232 + Math.floor(i / 5) * 30, 7, 12);
          ctx.fillRect(originX + 1048 + (i % 4) * 24, baseY - 305 + Math.floor(i / 4) * 30, 7, 12);
        }

        // Welcome sign, with posts and starburst top.
        ctx.strokeStyle = '#7f1d1d';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(originX + 405, baseY - 42);
        ctx.lineTo(originX + 405, baseY);
        ctx.moveTo(originX + 455, baseY - 42);
        ctx.lineTo(originX + 455, baseY);
        ctx.stroke();
        ctx.fillStyle = '#fef3c7';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(originX + 430, baseY - 198);
        ctx.lineTo(originX + 535, baseY - 166);
        ctx.lineTo(originX + 535, baseY - 80);
        ctx.lineTo(originX + 430, baseY - 42);
        ctx.lineTo(originX + 325, baseY - 80);
        ctx.lineTo(originX + 325, baseY - 166);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        for (let point = 0; point < 16; point++) {
          const radius = point % 2 === 0 ? 28 : 10;
          const angle = (Math.PI * 2 * point) / 16;
          const px = originX + 430 + Math.cos(angle) * radius;
          const py = baseY - 214 + Math.sin(angle) * radius;
          if (point === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#7f1d1d';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('WELCOME', originX + 430, baseY - 154);
        ctx.fillText('TO KILO', originX + 430, baseY - 124);
        ctx.fillText('VEGAS', originX + 430, baseY - 94);

        // Casino neon signs with framed detail.
        ctx.fillStyle = '#ec4899';
        ctx.shadowColor = '#ec4899';
        ctx.shadowBlur = 16;
        ctx.fillRect(originX + 792, baseY - 178, 182, 96);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(originX + 804, baseY - 166, 158, 72);
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 24px monospace';
        ctx.fillText('SLOTS', originX + 883, baseY - 124);
        ctx.fillStyle = '#fef3c7';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('OPEN 24H', originX + 883, baseY - 103);

        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(originX + 1240, baseY - 158, 58, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#bfdbfe';
        ctx.font = 'bold 24px monospace';
        ctx.fillText('777', originX + 1240, baseY - 150);
        ctx.font = 'bold 10px monospace';
        ctx.fillText('LUCKY', originX + 1240, baseY - 127);
        ctx.shadowBlur = 0;
      }

      // UFO with tractor beam in place of the old spotlight.
      const ufoX = wrapSceneX(cameraX * 0.06 + frameCountRef.current * 0.85, w + 360) - 180;
      const ufoY = Math.max(72, baseY - 380 + Math.sin(frameCountRef.current * 0.025) * 26);
      const beam = ctx.createLinearGradient(ufoX, ufoY + 18, ufoX, baseY + 40);
      beam.addColorStop(0, 'rgba(125, 249, 255, 0.28)');
      beam.addColorStop(0.55, 'rgba(125, 249, 255, 0.09)');
      beam.addColorStop(1, 'rgba(125, 249, 255, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(ufoX - 36, ufoY + 18);
      ctx.lineTo(ufoX + 36, ufoY + 18);
      ctx.lineTo(ufoX + 122, baseY + 40);
      ctx.lineTo(ufoX - 122, baseY + 40);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.ellipse(ufoX, ufoY, 70, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.ellipse(ufoX, ufoY - 10, 34, 18, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#67e8f9';
      for (let light = -2; light <= 2; light++) {
        ctx.beginPath();
        ctx.arc(ufoX + light * 22, ufoY + 8, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    drawVegasStrip(0.16, h - 82 - cameraY * 0.05, 0.9);

    // Parallax Mountains (Far)
    ctx.fillStyle = '#1e1b4b'; // Dark Indigo
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= w; i += 100) {
      const offset = (i + cameraX * 0.2);
      const height = 100 + Math.sin(offset * 0.01) * 50;
      ctx.lineTo(i, h - height);
    }
    ctx.lineTo(w, h);
    ctx.fill();

    // Parallax Hills (Near)
    ctx.fillStyle = '#312e81'; // Indigo
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= w; i += 50) {
      const offset = (i + cameraX * 0.5);
      const height = 50 + Math.sin(offset * 0.02) * 30;
      ctx.lineTo(i, h - height);
    }
    ctx.lineTo(w, h);
    ctx.fill();
  };

  const drawPlatform = (ctx: CanvasRenderingContext2D, entity: LevelEntity, cameraX: number, cameraY: number) => {
    const x = entity.x - cameraX;
    const y = entity.y - cameraY;
    const isGround = entity.h > 100;
    const visualHeight = Math.max(entity.h, ctx.canvas.height - y + 80);
    if (x + entity.w < -80 || x > ctx.canvas.width + 80 || y > ctx.canvas.height + 80) return;
    
    // 3D Effect: Top Face
    ctx.fillStyle = '#fbbf24'; // Amber 400 (Light Top)
    ctx.fillRect(x, y, entity.w, 5);

    // Front Face
    ctx.fillStyle = isGround ? '#854d0e' : '#b45309';
    ctx.fillRect(x, y + 5, entity.w, visualHeight - 5);

    if (isGround || visualHeight > entity.h) {
      ctx.fillStyle = 'rgba(120, 53, 15, 0.45)';
      for (let dirtY = y + 45; dirtY < y + Math.min(visualHeight, ctx.canvas.height - y + 120); dirtY += 55) {
        ctx.fillRect(x + 12, dirtY, entity.w - 24, 3);
      }
    }

    // Border/Detail
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, entity.w, visualHeight);
  };

  const drawStartArrow = (ctx: CanvasRenderingContext2D, entity: LevelEntity, cameraX: number, cameraY: number) => {
    const blinkOn = Math.floor(frameCountRef.current / 24) % 2 === 0;
    if (!blinkOn) return;

    const centerX = entity.x + entity.w / 2 - cameraX;
    const y = entity.y - cameraY - 82;
    const arrowWidth = 150;
    const arrowHeight = 52;

    ctx.save();
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 6;
    ctx.shadowColor = 'rgba(250, 204, 21, 0.85)';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.moveTo(centerX - arrowWidth / 2, y + arrowHeight * 0.28);
    ctx.lineTo(centerX + arrowWidth * 0.12, y + arrowHeight * 0.28);
    ctx.lineTo(centerX + arrowWidth * 0.12, y);
    ctx.lineTo(centerX + arrowWidth / 2, y + arrowHeight / 2);
    ctx.lineTo(centerX + arrowWidth * 0.12, y + arrowHeight);
    ctx.lineTo(centerX + arrowWidth * 0.12, y + arrowHeight * 0.72);
    ctx.lineTo(centerX - arrowWidth / 2, y + arrowHeight * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GO', centerX - 24, y + arrowHeight / 2);
    ctx.restore();
  };

  const drawHumanoid = (ctx: CanvasRenderingContext2D, p: PlayerState, cameraX: number, cameraY: number) => {
    const x = p.x - cameraX;
    const y = p.y - cameraY;
    const cx = x + p.width / 2;

    ctx.save();
    
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, y + p.height, p.width / 1.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body Color
    ctx.fillStyle = '#eab308'; // Yellow 500

    // Animation Offset
    const bob = Math.sin(frameCountRef.current * 0.2) * (Math.abs(p.vx) > 0.1 ? 3 : 1);

    // Black silhouette pass for readability against neon backgrounds.
    const legOffset = Math.sin(frameCountRef.current * 0.4) * 10 * (Math.abs(p.vx) > 0.1 ? 1 : 0);
    ctx.fillStyle = '#050505';
    ctx.fillRect(cx - 10 + legOffset, y + 28, 10, 24);
    ctx.fillRect(cx + 0 - legOffset, y + 28, 10, 24);
    ctx.fillRect(cx - 13, y + 12 + bob, 26, 26);
    ctx.beginPath();
    ctx.arc(cx, y + 10 + bob, 15, 0, Math.PI * 2);
    ctx.fill();

    // Body Color
    ctx.fillStyle = '#eab308'; // Yellow 500

    // Legs
    ctx.fillRect(cx - 8 + legOffset, y + 30, 6, 20); // Left Leg
    ctx.fillRect(cx + 2 - legOffset, y + 30, 6, 20); // Right Leg

    // Torso
    ctx.fillRect(cx - 10, y + 15 + bob, 20, 20);

    // Head
    ctx.fillStyle = '#fef08a'; // Yellow 200
    ctx.beginPath();
    ctx.arc(cx, y + 10 + bob, 12, 0, Math.PI * 2);
    ctx.fill();

    // Eyes (Directional)
    ctx.fillStyle = '#000';
    const eyeDir = p.facing === 1 ? 4 : -4;
    ctx.fillRect(cx + eyeDir - 2, y + 8 + bob, 4, 4);

    ctx.restore();
  };

  const drawMonster = (ctx: CanvasRenderingContext2D, m: MonsterState, cameraX: number, cameraY: number) => {
    const x = m.x - cameraX;
    const y = m.y - cameraY;
    const cx = x + m.w / 2;
    const cy = y + m.h / 2;

    // Spiky Body
    ctx.fillStyle = '#ef4444'; // Red 500
    ctx.beginPath();
    ctx.moveTo(cx, y); // Top
    ctx.lineTo(x + m.w, cy); // Right
    ctx.lineTo(cx, y + m.h); // Bottom
    ctx.lineTo(x, cy); // Left
    ctx.fill();

    // Inner Core
    ctx.fillStyle = '#7f1d1d'; // Red 900
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();

    // Angry Eyes
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 8, cy - 5, 5, 5);
    ctx.fillRect(cx + 3, cy - 5, 5, 5);
  };

  const drawChip = (ctx: CanvasRenderingContext2D, entity: LevelEntity, cameraX: number, cameraY: number) => {
    const x = entity.x + entity.w / 2 - cameraX;
    const y = entity.y + entity.h / 2 - cameraY + Math.sin((frameCountRef.current + entity.x) * 0.08) * 4;
    const radius = entity.w / 2;
    const value = entity.value ?? 5;
    const chipColor = value >= 25 ? '#a855f7' : value >= 20 ? '#3b82f6' : value >= 15 ? '#22c55e' : value >= 10 ? '#f59e0b' : '#ef4444';

    ctx.save();
    ctx.fillStyle = chipColor;
    ctx.strokeStyle = '#fef3c7';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#fef3c7';
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * (radius - 7), y + Math.sin(angle) * (radius - 7));
      ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      ctx.stroke();
    }

    ctx.fillStyle = '#fef3c7';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7f1d1d';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x, y + 1);
    ctx.restore();
  };

  const drawScorePopups = (ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number) => {
    scorePopupsRef.current.forEach((popup) => {
      const alpha = 1 - popup.age / SCORE_POPUP_LIFETIME;
      const text = `+${popup.value}`;
      const x = popup.x - cameraX;
      const y = popup.y - cameraY;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 4;
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
      ctx.restore();
    });
  };

  // --- GAME LOOP ---

  const update = () => {
    if (gameStateRef.current !== 'playing') return;

    const player = playerRef.current;
    const keys = keysRef.current;
    const monsters = monstersRef.current;

    frameCountRef.current++;

    // --- PLAYER PHYSICS ---
    
    // Horizontal Movement
    if (keys['ArrowLeft']) {
      player.vx -= CONFIG.moveSpeed;
      player.facing = -1;
    }
    if (keys['ArrowRight']) {
      player.vx += CONFIG.moveSpeed;
      player.facing = 1;
    }

    // Friction & Limits
    player.vx *= CONFIG.friction;
    if (player.vx > CONFIG.maxSpeed) player.vx = CONFIG.maxSpeed;
    if (player.vx < -CONFIG.maxSpeed) player.vx = -CONFIG.maxSpeed;

    // Gravity
    player.vy += CONFIG.gravity;

    // Jumping
    if (keys['Space'] && player.isGrounded) {
      player.vy = CONFIG.baseJumpForce;
      player.isGrounded = false;
      sfxRef.current?.jump();
    }

    // Apply Velocity
    player.x += player.vx;
    player.y += player.vy;

    maintainEndlessLevel(player.x);

    const autoScrollProgress = Math.min(1, player.x / 18000);
    const autoScrollSpeed = AUTOSCROLL_START_SPEED + (AUTOSCROLL_MAX_SPEED - AUTOSCROLL_START_SPEED) * autoScrollProgress;
    scrollXRef.current += autoScrollSpeed;

    // --- MONSTER LOGIC ---
    monsters.forEach(m => {
      if (m.defeated) {
        m.vy = (m.vy ?? -3) + CONFIG.gravity;
        m.y += m.vy;
        m.x += m.vx * 0.35;
        return;
      }

      m.x += m.vx;
      // Patrol Logic
      if (m.x <= m.patrolStart) {
        m.x = m.patrolStart;
        m.vx = Math.abs(m.speed);
      } else if (m.x >= m.patrolEnd) {
        m.x = m.patrolEnd;
        m.vx = -Math.abs(m.speed);
      }
    });

    scorePopupsRef.current = scorePopupsRef.current
      .map((popup) => ({ ...popup, age: popup.age + 1, y: popup.y - 0.8 }))
      .filter((popup) => popup.age < SCORE_POPUP_LIFETIME);

    // --- COLLISION DETECTION ---
    
    player.isGrounded = false;
    
    // World Boundaries
    if (player.x < 0) { player.x = 0; player.vx = 0; }
    const wallX = scrollXRef.current + WALL_PADDING;
    if (player.x < wallX) {
      player.x = wallX;
      if (player.vx < autoScrollSpeed) player.vx = autoScrollSpeed;
    }
    const canvas = canvasRef.current;
    const fallDeathY = cameraRef.current.y + (canvas?.height ?? dimensions.height) + FALL_DEATH_SCREEN_MARGIN;
    monstersRef.current = monstersRef.current.filter(m => !m.defeated || m.y < fallDeathY);
    if (player.y > fallDeathY) {
      sfxRef.current?.death();
      setGameStateRef.current('lost');
      return;
    }

    // Monster Collision (Player vs Monster) must run before platform collision.
    // Landing on a monster that is on a platform should count as a stomp before the platform zeroes vy.
    for (let i = monsters.length - 1; i >= 0; i--) {
      const m = monsters[i];
      if (m.defeated) continue;
      if (
        player.x < m.x + m.w &&
        player.x + player.width > m.x &&
        player.y < m.y + m.h &&
        player.y + player.height > m.y
      ) {
        const playerFeet = player.y + player.height;
        const stompZoneBottom = m.y + m.h * 0.7;
        if (playerFeet <= stompZoneBottom) {
          scorePopupsRef.current.push({ id: frameCountRef.current, x: m.x + m.w / 2, y: m.y - 8, value: MONSTER_POINTS, age: 0 });
          m.defeated = true;
          m.vy = -3;
          m.vx = player.facing * 2;
          bonusScoreRef.current += MONSTER_POINTS;
          player.vy = CONFIG.baseJumpForce * 0.55;
          sfxRef.current?.stomp();
          continue;
        }

        sfxRef.current?.death();
        setGameStateRef.current('lost');
        return;
      }
    }

    // Entity Collision
    for (let entityIndex = entitiesRef.current.length - 1; entityIndex >= 0; entityIndex--) {
      const entity = entitiesRef.current[entityIndex];
      // Skip monster entities in static check (handled separately)
      if (entity.type === 'monster') continue;

      if (
        player.x < entity.x + entity.w &&
        player.x + player.width > entity.x &&
        player.y < entity.y + entity.h &&
        player.y + player.height > entity.y
      ) {
        if (entity.type === 'chip') {
          const chipValue = entity.value ?? 5;
          scorePopupsRef.current.push({ id: frameCountRef.current + entityIndex, x: entity.x + entity.w / 2, y: entity.y, value: chipValue, age: 0 });
          bonusScoreRef.current += chipValue;
          entitiesRef.current.splice(entityIndex, 1);
          sfxRef.current?.collect();
          continue;
        }

        if (entity.type === 'hazard') {
          sfxRef.current?.death();
          setGameStateRef.current('lost');
          return;
        }
        
        if (entity.type === 'platform' || entity.type === 'start') {
          const previousX = player.x - player.vx;
          const previousY = player.y - player.vy;
          const previousBottom = previousY + player.height;
          const previousRight = previousX + player.width;
          const landingOnTop = player.vy >= 0 && previousBottom <= entity.y + 6;
          const hittingBottom = player.vy < 0 && previousY >= entity.y + entity.h - 6;
          const hittingLeftSide = player.vx > 0 && previousRight <= entity.x + 4;
          const hittingRightSide = player.vx < 0 && previousX >= entity.x + entity.w - 4;
          const overlapX = (player.width + entity.w) / 2 - Math.abs((player.x + player.width / 2) - (entity.x + entity.w / 2));
          const overlapY = (player.height + entity.h) / 2 - Math.abs((player.y + player.height / 2) - (entity.y + entity.h / 2));

          if (landingOnTop) {
            player.y = entity.y - player.height;
            player.isGrounded = true;
            player.vy = 0;
          } else if (hittingBottom) {
            player.y = entity.y + entity.h;
            player.vy = 0;
            sfxRef.current?.bonk();
          } else if (overlapX < overlapY && hittingLeftSide) {
            player.x = entity.x - player.width;
            player.vx = 0;
          } else if (overlapX < overlapY && hittingRightSide) {
            player.x = entity.x + entity.w;
            player.vx = 0;
          }
        }
      }
    }

    const distance = Math.max(0, Math.floor(player.x / 10));
    const current = distance + bonusScoreRef.current;
    const best = Math.max(scoreRef.current.best, current);
    if (
      (current !== scoreRef.current.current || best !== scoreRef.current.best) &&
      frameCountRef.current - lastScorePublishFrameRef.current >= 10
    ) {
      lastScorePublishFrameRef.current = frameCountRef.current;
      publishScore({ current, best, distance });
    }

    // --- CAMERA UPDATE ---
    if (canvas) {
      const targetX = scrollXRef.current;
      
      // Camera Y Logic (Keep floor near bottom)
      // We want the player to be roughly at 75% of the screen height when on the ground.
      // BUT we don't want it to track every jump.
      
      // Only move camera Y if player is significantly higher than the "ground" level we want to track
      // or if they are falling deep into a pit.
      
      // Define a "deadzone" for Y movement.
      // If player is on ground (y ~ 550), camera should be fixed.
      // If player climbs high (y < 300), camera should move up.
      
      const groundLevel = 600;
      const idealCameraY = groundLevel - canvas.height + 50; // Fixed position for ground level
      
      let targetY = idealCameraY;
      
      // If player goes high up, follow them
      if (player.y < groundLevel - canvas.height * 0.6) {
          targetY = player.y - canvas.height * 0.4;
      }
      
      // If player falls deep (pits), follow them
      if (player.y > groundLevel + 100) {
          targetY = player.y - canvas.height * 0.8;
      }

      // Clamp Camera Y (Don't show below ground)
      const lowestPoint = 800;
      const maxCameraY = lowestPoint - canvas.height;
      if (targetY > maxCameraY) targetY = maxCameraY;
      
      // Smooth Camera (Lerp)
      cameraRef.current.x += (targetX - cameraRef.current.x) * 0.1;
      // Slower Y tracking to avoid jitter
      cameraRef.current.y += (targetY - cameraRef.current.y) * 0.05;
    }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const cameraX = cameraRef.current.x;
    const cameraY = cameraRef.current.y;

    // Draw Background (Parallax)
    drawBackground(ctx, cameraX, cameraY);

    // Draw Level Entities
    entitiesRef.current.forEach(entity => {
      if (entity.type === 'monster') return;
      
      if (entity.type === 'platform') {
        drawPlatform(ctx, entity, cameraX, cameraY);
        if (entity.showStartArrow) drawStartArrow(ctx, entity, cameraX, cameraY);
      } else if (entity.type === 'hazard') {
        ctx.fillStyle = '#ef4444'; // Red
        const x = entity.x - cameraX;
        const y = entity.y - cameraY;
        // Draw spikes
        const spikeWidth = 20;
        const spikes = entity.w / spikeWidth;
        ctx.beginPath();
        for(let i=0; i<spikes; i++) {
            ctx.moveTo(x + (i * spikeWidth), y + entity.h);
            ctx.lineTo(x + (i * spikeWidth) + (spikeWidth/2), y);
            ctx.lineTo(x + ((i+1) * spikeWidth), y + entity.h);
        }
        ctx.fill();
      } else if (entity.type === 'goal') {
        ctx.fillStyle = '#22c55e'; // Green
        const x = entity.x - cameraX;
        const y = entity.y - cameraY;
        ctx.fillRect(x, y, entity.w, entity.h);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, entity.w, entity.h);
      } else if (entity.type === 'chip') {
        drawChip(ctx, entity, cameraX, cameraY);
      }
    });

    // Draw Monsters
    monstersRef.current.forEach(m => {
      drawMonster(ctx, m, cameraX, cameraY);
    });

    drawScorePopups(ctx, cameraX, cameraY);

    // Draw Player
    drawHumanoid(ctx, playerRef.current, cameraX, cameraY);

    const wallScreenX = scrollXRef.current + WALL_PADDING - cameraX;
    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
    ctx.fillRect(wallScreenX - 8, 0, 16, ctx.canvas.height);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wallScreenX, 0);
    ctx.lineTo(wallScreenX, ctx.canvas.height);
    ctx.stroke();
    ctx.restore();
  };

  const loop = useCallback(() => {
    updateRef.current();

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawRef.current(ctx);
      }
    }
    
    requestRef.current = requestAnimationFrame(loop);
  }, []);

  updateRef.current = update;
  drawRef.current = draw;

  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [loop]);

  return (
    <canvas
      ref={canvasRef}
      width={dimensions.width}
      height={dimensions.height}
      className="block bg-black"
    />
  );
};

export default GameCanvas;
