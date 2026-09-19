import { useParams } from 'react-router-dom';
import { useContestGuard } from '../../hooks/useContestGuard';
import { useAuth } from '../../context/AuthContext';
import LoadingPage from '../../components/shared/LoadingPage';
import SubmissionsView from '../../features/submission/SubmissionsView';

const ContestSubmissions = () => {
    const { contestId } = useParams();
    const { user } = useAuth();

    // Contest access guard — handles redirect logic and polling
    const { isAccessible, loading: guardLoading, error: guardError } = useContestGuard(contestId);

    // While inaccessible the guard owns the screen; the shared view keeps
    // rendering the contest table (fetching general submissions) exactly as before.
    if (guardLoading) return <LoadingPage />;

    return (
        <SubmissionsView
            contestId={isAccessible ? contestId ?? null : null}
            title="Contest Submissions"
            variant="contest"
            guardError={guardError}
            user={user}
        />
    );
}

export default ContestSubmissions;
