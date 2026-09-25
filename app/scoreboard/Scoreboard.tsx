'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './scoreboard.module.css';

interface Score {
  id: string;
  name: string;
  score: number;
  distance: number;
  rank: number;
}

interface Results {
  scores: Score[];
  total: number;
  page: number;
  pageSize: number;
}

export default function Scoreboard() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Results | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    setResults(null);
    setUpdated(null);
    setLoading(true);
    setError('');

    const load = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const query = new URLSearchParams({ page: String(page), search: search.trim() });
        const response = await fetch(`/api/scores?${query}`, {
          cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Scores are temporarily unavailable. We will try again automatically.');
        const data: Results = await response.json();
        if (!disposed) {
          if (page > 1 && page > Math.max(1, Math.ceil(data.total / data.pageSize))) {
            setPage(1);
          } else {
            setResults(data);
            setUpdated(new Date());
            setError('');
          }
        }
      } catch {
        if (!disposed) setError('Cannot reach the scoreboard. Showing the last available results, if any. Retrying automatically.');
      } finally {
        clearTimeout(timeout);
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(load, 15000);
        }
      }
    };

    timer = setTimeout(load, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [search, page, refresh]);

  const totalPages = results ? Math.max(1, Math.ceil(results.total / results.pageSize)) : 1;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.masthead}>
          <Link className={styles.brand} href="/" aria-label="Kilo Man NYC event station">
            <span className={styles.route}>K</span>
            <span>KILO MAN <span className={styles.muted}>/ NYC</span></span>
          </Link>
          <span className={styles.edition}>EVENT SCOREBOARD</span>
        </header>

        <section className={styles.intro} aria-labelledby="scoreboard-title">
          <p className={styles.eyebrow}>NEW YORK CITY / LIVE RANKINGS</p>
          <h1 id="scoreboard-title">The city<br />keeps score<span>.</span></h1>
          <p className={styles.description}>You played. Now watch the board. Find your name and follow the event rankings from wherever the day takes you.</p>
          <div className={styles.status} role="status">
            <span className={error ? styles.offline : styles.dot} />
            {loading ? 'Connecting to the board...' : error ? 'Connection interrupted' : 'Connected / refreshes every 15 seconds'}
            {updated && <span>Last update {updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          </div>
        </section>

        <section className={styles.board} aria-label="Event rankings">
          <div className={styles.toolbar}>
            <div><h2>All aboard the leaderboard.</h2><p>Best run per turn. Every completed turn is listed.</p></div>
            <div className={styles.search}>
              <label htmlFor="player-search">Find your player name</label>
              <input id="player-search" type="search" value={search} maxLength={20} placeholder="Search player name" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            </div>
          </div>

          {error && <div className={styles.error} role="alert">{error} <button onClick={() => setRefresh((value) => value + 1)}>Try now</button></div>}

          <div className={styles.tableWrap} aria-busy={loading}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>NYC event rankings, ordered by score. Ties are ordered by earliest submission.</caption>
              <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Score</th><th scope="col" className={styles.distance}>Distance</th></tr></thead>
              <tbody>
                {results?.scores.map((entry) => (
                  <tr key={entry.id} className={entry.rank === 1 ? styles.first : undefined}>
                    <td><span className={styles.rank}>{String(entry.rank).padStart(2, '0')}</span></td>
                    <th scope="row">{entry.name}</th>
                    <td className={styles.score}>{entry.score.toLocaleString()}</td>
                    <td className={styles.distance}>{entry.distance.toLocaleString()} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && <p className={styles.empty} role="status">Loading the latest scores...</p>}
            {!loading && !error && results?.scores.length === 0 && <div className={styles.empty}><h3>{search.trim() ? 'No matching players.' : 'First stop: your name here.'}</h3><p>{search.trim() ? 'Try the name you entered at the event station.' : 'Scores appear here after players save a completed turn at the event.'}</p></div>}
          </div>

          <div className={styles.pagination}>
            <span>{results ? `${results.total.toLocaleString()} ${search.trim() ? 'matching ' : ''}turns` : 'Awaiting scores'} / Rank is event-wide</span>
            <nav aria-label="Scoreboard pages">
              <button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button>
            </nav>
          </div>
        </section>

        <footer className={styles.footer}><span>THREE LIVES. ONE CITY.</span><p>Play in person. Check in anywhere.</p><Link href="/">Event station</Link></footer>
      </div>
    </main>
  );
}
