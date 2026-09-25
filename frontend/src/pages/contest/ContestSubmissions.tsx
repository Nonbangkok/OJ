import { useParams } from 'react-router-dom';
import { useContestGuard } from '../../hooks/useContestGuard';
import { useAuth } from '../../context/AuthContext';
import LoadingPage from '../../components/shared/LoadingPage';
import SubmissionsView from '../../features/submission/SubmissionsView';
import { USER_ROLES } from '../../utils/constants';

const ContestSubmissions = () => {
    const { contestId } = useParams();
    const { user } = useAuth();

    // Contest access guard — handles redirect logic and polling
    const { contest, isAccessible, loading: guardLoading, error: guardError } = useContestGuard(contestId);

    // SUB-002: the contest submission feed is participant/staff-only
    // server-side; non-participants get a friendly explanation here instead
    // of a bare 403 from the API.
    const canViewFeed = isAccessible && (contest?.is_participant
        || user?.role === USER_ROLES.ADMIN
        || user?.role === USER_ROLES.STAFF);

    if (guardLoading) return <LoadingPage />;
    if (isAccessible && !canViewFeed) {
        return (
            <div className="error-message">
                You must join this contest to view its submissions.
            </div>
        );
    }

    // While inaccessible the guard owns the screen; the shared view keeps
    // rendering the contest table (fetching general submissions) exactly as before.
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
