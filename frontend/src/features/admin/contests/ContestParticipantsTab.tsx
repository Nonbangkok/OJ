import { useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '../../../components/ui';
import adminService from '../../../services/adminService';
import contestService from '../../../services/contestService';
import { getErrorMessage } from '../../../utils/error';
import { formatBangkokStart } from './bangkokTime';
import type { ContestScoreboardEntry } from '../../../types';
import styles from './ContestEditor.module.css';

interface ParticipantRow {
  user_id: number;
  username: string;
  joined_at: string;
  rank: number | null;
  score: number | null;
}

/** Participants tab (read-only): who joined, when, and where they stand. */
export default function ContestParticipantsTab({ contestId }: { contestId: number }) {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      adminService.getContestParticipants(contestId),
      // Scores only exist once the round has started; a refused board just means no scores yet.
      contestService.getScoreboard(contestId).then((b) => b.scoreboard).catch((): ContestScoreboardEntry[] => []),
    ])
      .then(([participants, board]) => {
        if (cancelled) return;
        const byUser = new Map<string, ContestScoreboardEntry>(board.map((entry) => [String(entry.user_id ?? entry.username), entry]));
        const merged = participants.map((p) => {
          const entry = byUser.get(String(p.user_id)) ?? byUser.get(p.username);
          return { ...p, rank: entry?.rank ?? null, score: entry ? Number(entry.total_score) : null };
        });
        merged.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || Date.parse(a.joined_at) - Date.parse(b.joined_at));
        setRows(merged);
      })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err, 'Could not load the participants.')); });
    return () => { cancelled = true; };
  }, [contestId]);

  const columns: DataTableColumn<ParticipantRow>[] = [
    { key: 'rank', header: '#', align: 'right', width: '48px', mobile: 'meta', cell: (r) => <span className={styles.mono}>{r.rank ?? '—'}</span> },
    { key: 'user', header: 'User', mobile: 'primary', cell: (r) => r.username },
    { key: 'joined', header: 'Joined', mobile: 'meta', cell: (r) => <span className={styles.mono}>{formatBangkokStart(r.joined_at)}</span> },
    { key: 'score', header: 'Score', align: 'right', mobile: 'meta', cell: (r) => <span className={styles.mono}>{r.score ?? '—'}</span> },
  ];

  return (
    <div className={styles.panel}>
      <DataTable<ParticipantRow>
        caption="Participants"
        columns={columns}
        rows={rows ?? []}
        rowKey={(r) => String(r.user_id)}
        rowLabel={(r) => r.username}
        loading={rows === null && !error}
        error={error ? { message: error } : undefined}
        empty="Nobody has joined yet."
      />
    </div>
  );
}
