import { useParams } from 'react-router-dom';
import SubmissionsView from '../../features/submission/SubmissionsView';

type SubmissionsProps = {
  problemId?: string | null;
  contestId?: string | null;
  showTitle?: boolean;
};

const Submissions = ({ problemId = null, contestId = null, showTitle = true }: SubmissionsProps) => {
  const { contestId: contestIdFromParams } = useParams();
  const effectiveContestId = contestId ?? contestIdFromParams ?? null;

  return (
    <SubmissionsView
      problemId={problemId}
      contestId={effectiveContestId}
      showTitle={showTitle}
    />
  );
}

export default Submissions;
