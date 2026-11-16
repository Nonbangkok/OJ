import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ui';

/** Holds a Manage route until its page lands in this phase. */
export default function ManagePlaceholder({ backTo, backLabel }: { backTo: string; backLabel: string }) {
  return <EmptyState title="This page is on its way." description={<Link to={backTo}>{backLabel}</Link>} />;
}
