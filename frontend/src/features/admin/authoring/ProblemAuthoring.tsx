import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import DraftWorkspace from './DraftWorkspace';
import DraftList from './DraftList';
import AuthoringHub from './AuthoringHub';
import StatementEditor from './StatementEditor';
import AuthorProfiles from './AuthorProfiles';
import AiDocs from './AiDocs';


function ProfilesPage() {
  return (
    <AuthoringHub tab="profiles">
      <AuthorProfiles />
    </AuthoringHub>
  );
}

function AiDocsPage() {
  return (
    <AuthoringHub tab="ai-docs">
      <AiDocs inHub />
    </AuthoringHub>
  );
}

export default function ProblemAuthoring({ editorMode = false }: { editorMode?: boolean }) {
  const { user, isLoading } = useAuth();
  const { draftId } = useParams();
  const location = useLocation();
  if (isLoading) return <p role="status">Loading authoring…</p>;
  if (user?.role !== 'admin' && user?.role !== 'staff')
    return <p role="alert">Admin or staff access required for Problem Authoring.</p>;
  if (editorMode) {
    return draftId ? <StatementEditor key={draftId} id={draftId} /> : <DraftList />;
  }
  if (location.pathname === '/admin/authoring/profiles') return <ProfilesPage />;
  if (location.pathname === '/admin/authoring/ai-docs') return <AiDocsPage />;
  if (draftId) return <DraftWorkspace key={draftId} id={draftId} />;
  return <DraftList />;
}
