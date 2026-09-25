import type { Metadata } from 'next';
import Scoreboard from './Scoreboard';

export const metadata: Metadata = {
  title: 'Live Scoreboard | Kilo Man NYC',
  description: 'Follow the Kilo Man NYC event rankings. Search your player name and check your score throughout the day.',
};

export default function ScoreboardPage() {
  return <Scoreboard />;
}
