export type EntityType = 'platform' | 'hazard' | 'goal' | 'start' | 'monster' | 'chip';

export interface LevelEntity {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: EntityType;
  // Visual properties
  color?: string;
  showStartArrow?: boolean;
  value?: number;
  // Monster specific properties
  patrolStart?: number;
  patrolEnd?: number;
  speed?: number;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  isGrounded: boolean;
  facing: 1 | -1; // 1 = right, -1 = left
  frame: number; // Animation frame counter
}

export interface MonsterState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  patrolStart: number;
  patrolEnd: number;
  speed: number;
  defeated?: boolean;
  vy?: number;
}

export type GameStatus = 'start' | 'countdown' | 'playing' | 'won' | 'lost';

export interface PlayerProfile {
  name: string;
}

export interface LeaderboardEntry extends PlayerProfile {
  id: string;
  score: number;
  distance: number;
  date: string;
}

export interface ScoreState {
  current: number;
  best: number;
  distance: number;
}

export interface CompletionData {
  completionTime: number; // Time in seconds
  points: number;
}

export interface GameConfig {
  gravity: number;
  friction: number;
  moveSpeed: number;
  maxSpeed: number;
  baseJumpForce: number;
  levelWidth: number;
}
