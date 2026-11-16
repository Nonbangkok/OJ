import { Link, useSearchParams } from 'react-router-dom';
import { Button, DataTable, EmptyState, PageHeader, SegmentedControl, type DataTableColumn } from '../../components/ui';
import UserAvatar from '../../components/user/UserAvatar';
import { useRanking } from '../../hooks/useRanking';
import type { RankingRow, RankingWindow } from '../../types';
import styles from './Scoreboard.module.css';

const TOP = 3;

/** Global ranking (§7.5): XP, competition rank, all-time or this week. */
const Scoreboard = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const window: RankingWindow = searchParams.get('window') === 'week' ? 'week' : 'all';
  const pageParam = Number(searchParams.get('page'));
  const page = Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const { ranking, loading, error, retry } = useRanking(window, page);

  const update = (patch: Record<string, string | null>) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key); else next.set(key, value);
      }
      return next;
    }, { replace: true });
  };

  const rows = ranking?.rows ?? [];
  const viewer = ranking?.viewer ?? null;
  const viewerOnPage = viewer !== null && rows.some((r) => r.username === viewer.username);
  const total = ranking?.total ?? 0;
  const pageSize = ranking?.pageSize ?? 50;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const columns: DataTableColumn<RankingRow>[] = [
    {
      key: 'rank', header: 'Rank', align: 'right', width: '64px', mobile: 'meta',
      cell: (r) => <span className={r.rank <= TOP ? styles.top : undefined}>{r.rank}</span>,
    },
    {
      key: 'user', header: 'User', mobile: 'primary',
      cell: (r) => (
        <span className={styles.user}>
          <UserAvatar username={r.username} hasAvatar={r.hasAvatar} size={24} />
          <Link to={`/profile/${r.username}`} className={r.rank <= TOP ? styles.topName : styles.name}>{r.username}</Link>
        </span>
      ),
    },
    { key: 'tier', header: 'Tier', mobile: 'meta', cell: (r) => <span className={styles.tier}>{`${r.tier} · Lv ${r.level}`}</span> },
    { key: 'solved', header: 'Solved', align: 'right', width: '90px', mobile: 'meta', cell: (r) => r.solved },
    {
      key: 'xp', header: 'XP', align: 'right', width: '110px', mobile: 'meta',
      cell: (r) => <span className={r.rank <= TOP ? styles.top : undefined}>{r.xp.toLocaleString('en-US')}</span>,
    },
  ];

  const meta = ranking
    ? `${window === 'week' ? 'XP earned in the last 7 days' : 'Ranked by total XP'} · ${total.toLocaleString('en-US')} ${total === 1 ? 'student' : 'students'}`
    : undefined;

  return (
    <div className={styles['scoreboard-container']}>
      <PageHeader
        title="Ranking"
        meta={meta}
        actions={(
          <SegmentedControl<RankingWindow>
            aria-label="Ranking window"
            value={window}
            onChange={(value) => update({ window: value === 'all' ? null : value, page: null })}
            options={[{ value: 'all', label: 'All time' }, { value: 'week', label: 'This week' }]}
          />
        )}
      />

      <DataTable<RankingRow>
        caption="Ranking"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.username}
        rowLabel={(r) => r.username}
        highlightKey={viewerOnPage ? viewer?.username : undefined}
        loading={loading && !ranking}
        error={error ? { message: error, onRetry: retry } : undefined}
        empty={<EmptyState title="No one is ranked yet." description={window === 'week' ? 'Nobody has earned XP in the last 7 days.' : 'Solve a problem to earn XP.'} />}
      />

      {total > pageSize && (
        <nav className={styles.pager} aria-label="Ranking pages">
          <span className={styles.range}>{`${first}–${last} of ${total.toLocaleString('en-US')}`}</span>
          <Button variant="secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Previous</Button>
          <Button variant="secondary" disabled={last >= total} onClick={() => update({ page: String(page + 1) })}>Next</Button>
        </nav>
      )}

      {viewer && !viewerOnPage && (
        <section className={styles.pinned} aria-label="Your rank">
          <span className={styles.pinnedRank}>{`#${viewer.rank}`}</span>
          <UserAvatar username={viewer.username} hasAvatar={viewer.hasAvatar} size={24} />
          <span className={styles.pinnedName}>{viewer.username}</span>
          <span className={styles.tier}>{`${viewer.tier} · Lv ${viewer.level}`}</span>
          <span className={styles.pinnedStat}>{`${viewer.solved} solved`}</span>
          <span className={styles.pinnedStat}>{`${viewer.xp.toLocaleString('en-US')} XP`}</span>
        </section>
      )}
    </div>
  );
};

export default Scoreboard;
