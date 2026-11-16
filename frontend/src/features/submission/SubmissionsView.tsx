import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './SubmissionsView.module.css';
import XpToast from '../../components/user/XpToast';
import {
    Button,
    DataTable,
    EmptyState,
    FilterBar,
    PageHeader,
    ScoreCell,
    SegmentedControl,
    VerdictText,
    type DataTableColumn,
} from '../../components/ui';
import { useSubmissions, type SubmissionFilter } from '../../hooks/useSubmissions';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { PROBLEMS_PAGE } from '../../config/constants';
import { formatTimeAgo } from '../../utils/formatters';
import { getLanguageDisplayName } from '../../utils/constants';
import type { AuthUser, SubmissionSummary } from '../../types';
import { useRestoreScroll } from '../../hooks/useRestoreScroll';

const NO_CASES = new Set(['Compilation Error', 'System Error']);

/** Verdict chip choices: label → exact overall status. */
const VERDICTS = [
    { value: 'Accepted', label: 'Accepted' },
    { value: 'Wrong Answer', label: 'Wrong answer' },
    { value: 'Time Limit Exceeded', label: 'Time limit' },
    { value: 'Memory Limit Exceeded', label: 'Memory limit' },
    { value: 'Runtime Error', label: 'Runtime error' },
    { value: 'Compilation Error', label: 'Compilation error' },
];
const REVEAL_STEP = 25;

type SubmissionsViewProps = {
    /** Problem context: the viewer's own submissions for this problem. */
    problemId?: string | null;
    /** Contest context: contest submissions; rows open the contest detail route. */
    contestId?: string | null;
    /** Whether the page header renders. */
    showTitle?: boolean;
    title?: string;
    /** 'contest' shows the guard error from the contest wrapper. */
    variant?: 'page' | 'contest';
    guardError?: string;
    user?: AuthUser | null;
};

/** Debounced text box bound to one URL filter. */
function useDebouncedFilter(value: string, commit: (next: string) => void) {
    const [text, setText] = useState(value);
    const [mirrored, setMirrored] = useState(value);
    if (value !== mirrored) { setMirrored(value); setText(value); }
    useEffect(() => {
        if (text === value) return undefined;
        const timer = window.setTimeout(() => commit(text), PROBLEMS_PAGE.SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [text, value, commit]);
    return [text, setText] as const;
}

const SubmissionsView = ({
    problemId = null,
    contestId = null,
    showTitle = true,
    title = 'Submissions',
    variant = 'page',
    guardError,
}: SubmissionsViewProps) => {
    const {
        submissions,
        currentUser,
        isStaff,
        loading,
        error,
        filter,
        setFilter,
        filters,
        setFilterValue,
        lastRealtimeEvent,
    } = useSubmissions(problemId, contestId);
    // Back from a submission returns to the same place in the list (as the problem list does).
    useRestoreScroll(!loading);
    const [problemText, setProblemText] = useDebouncedFilter(filters.problem, (next) => setFilterValue('problem', next));
    const [userText, setUserText] = useDebouncedFilter(filters.user, (next) => setFilterValue('user', next));
    const [visible, setVisible] = useState(REVEAL_STEP);
    const shown = submissions.slice(0, visible);
    const hasMore = submissions.length > visible;
    const showMoreRef = useInfiniteScroll({
        enabled: hasMore,
        observationKey: visible,
        onLoadMore: () => setVisible((v) => v + REVEAL_STEP),
    });

    const detailHref = (s: SubmissionSummary) => (contestId
        ? `/contests/${contestId}/submissions/${s.id}`
        : `/submissions/${s.id}`);

    const columns: DataTableColumn<SubmissionSummary>[] = [
        {
            key: 'id', header: 'ID', mobile: 'meta',
            cell: (s) => <Link to={detailHref(s)} className={styles.mono}>{`#${s.id}`}</Link>,
        },
        { key: 'when', header: 'When', mobile: 'meta', cell: (s) => <span className={styles.muted}>{formatTimeAgo(s.submitted_at)}</span> },
        ...(problemId ? [] : [{
            key: 'user', header: 'User', mobile: 'hidden' as const, width: '14%',
            cell: (s: SubmissionSummary) => <Link to={`/profile/${s.username}`} className={styles.user}>{s.username}</Link>,
        }]),
        {
            key: 'problem', header: 'Problem', mobile: 'primary', width: '30%',
            cell: (s) => (
                <span className={styles.problem}>
                    <span className={styles.mono}>{s.problem_id}</span>
                    {/* Plain text: the row link (to the submission) wraps this cell; the detail page links to the problem. */}
                    <span className={styles.problemTitle}>{s.problem_title ?? s.problem_id}</span>
                </span>
            ),
        },
        {
            key: 'verdict', header: 'Verdict', mobile: 'meta',
            cell: (s) => {
                // A compile log or system message is stored as one result entry, not a testcase.
                const results = NO_CASES.has(s.overall_status) ? [] : (s.case_statuses ?? []).map((status) => ({ status }));
                // The verdict reads "Wrong 1/5" on its own; the per-case strip lives on the detail page.
                return <VerdictText status={s.overall_status} results={results} />;
            },
        },
        { key: 'score', header: 'Score', align: 'right', mobile: 'hidden', cell: (s) => <ScoreCell score={s.score} attempted /> },
        {
            key: 'time', header: 'Time', align: 'right', mobile: 'hidden',
            cell: (s) => (s.max_time_ms == null ? '—' : `${s.max_time_ms} ms`),
        },
        {
            key: 'memory', header: 'Memory', align: 'right', mobile: 'hidden',
            cell: (s) => (s.max_memory_kb == null ? '—' : `${(s.max_memory_kb / 1024).toFixed(1)} MB`),
        },
        { key: 'lang', header: 'Lang', mobile: 'hidden', cell: (s) => getLanguageDisplayName(s.language) },
    ];

    const displayError = variant === 'contest' ? guardError || error : error;

    return (
        <div className={styles.page}>
            {showTitle && (
                <PageHeader
                    title={title}
                    meta={`${submissions.length} shown · ${filter === 'mine' ? 'yours' : 'everyone'}`}
                />
            )}
            {!problemId && (
                <FilterBar
                    search={{ value: problemText, onChange: setProblemText, placeholder: 'Problem id or title' }}
                    segments={currentUser ? (
                        <SegmentedControl<SubmissionFilter>
                            aria-label="Whose submissions"
                            value={filter}
                            onChange={setFilter}
                            options={[{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'All' }]}
                        />
                    ) : undefined}
                    filters={[{
                        key: 'verdict',
                        label: 'Verdict',
                        value: filters.verdict || undefined,
                        options: VERDICTS,
                        onChange: (value) => setFilterValue('verdict', value),
                    }]}
                    trailing={isStaff ? (
                        <input
                            type="search"
                            aria-label="Filter by username"
                            placeholder="Username"
                            className={styles.userInput}
                            value={userText}
                            onChange={(event) => setUserText(event.target.value)}
                        />
                    ) : undefined}
                />
            )}
            <DataTable<SubmissionSummary>
                caption="Submissions"
                columns={columns}
                rows={shown}
                rowKey={(s) => String(s.id)}
                rowLabel={(s) => `#${s.id}`}
                rowHref={detailHref}
                loading={loading}
                error={displayError ? { message: displayError } : undefined}
                empty={<EmptyState title="No submissions yet." description={problemId ? 'Submit a solution to see it here.' : 'Nothing matches these filters.'} />}
            />
            {hasMore && (
                <div className={styles.more} ref={showMoreRef}>
                    <Button variant="secondary" onClick={() => setVisible((v) => v + REVEAL_STEP)}>Show more</Button>
                </div>
            )}
            {currentUser && <XpToast event={lastRealtimeEvent} />}
        </div>
    );
};

export default SubmissionsView;
