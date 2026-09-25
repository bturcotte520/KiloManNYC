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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    setResults(null);
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
        if (!response.ok) throw new Error('Scores unavailable');
        const data: Results = await response.json();
        if (!disposed) {
          if (page > 1 && page > Math.max(1, Math.ceil(data.total / data.pageSize))) {
            setPage(1);
          } else {
            setResults(data);
            setError('');
          }
        }
      } catch {
        if (!disposed) setError('Scores could not be updated.');
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
        </header>

        <section className={styles.board} aria-label="Event rankings">
          <div className={styles.toolbar}>
            <h1>Scoreboard</h1>
            <div className={styles.search}>
              <label htmlFor="player-search" className={styles.srOnly}>Search players</label>
              <input id="player-search" type="search" value={search} maxLength={20} placeholder="Search players" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
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
            {loading && <p className={styles.empty} role="status">Loading...</p>}
            {!loading && !error && results?.scores.length === 0 && <p className={styles.empty}>{search.trim() ? 'No matching players.' : 'No scores yet.'}</p>}
          </div>

          {totalPages > 1 && <div className={styles.pagination}>
            <nav aria-label="Scoreboard pages">
              <button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button>
            </nav>
          </div>}
        </section>
      </div>
    </main>
  );
}
