import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import { CaretDown, CaretRight, Copy } from '@phosphor-icons/react';
import { InlineError, PageHeader } from '../../components/ui';
import SubmissionResult from '../../features/submission/SubmissionResult';
import useLiveSubmission from '../../features/submission/useLiveSubmission';
import { getLanguageDisplayName } from '../../utils/constants';
import styles from './SubmissionDetailPage.module.css';
import { judgedLimits, SUPPORTED_LANGUAGES, type SubmissionLanguage } from '../../utils/constants';
import { seedSubmissionDraft } from '../../utils/submissionDrafts';

const isSubmissionLanguage = (value: string): value is SubmissionLanguage => (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);

const highlight = (code: string, language: string): string => {
  try {
    return hljs.highlight(code, { language: hljs.getLanguage(language) ? language : 'cpp' }).value;
  } catch {
    return code.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
  }
};

/** Collapsible, copyable source of a submission; `filename` names a header submission's file. */
function SubmittedCode({ code, language, filename = null }: { code: string; language: string; filename?: string | null }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className={styles.code} aria-label="Submitted code">
      <div className={styles.codeHead}>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <CaretDown size={14} aria-hidden="true" /> : <CaretRight size={14} aria-hidden="true" />}
          Submitted code
        </button>
        <span className={styles.codeMeta}>
          {[filename, getLanguageDisplayName(language), `${lines.length} lines`].filter(Boolean).join(' · ')}
        </span>
        <button type="button" className={styles.copy} onClick={copy}>
          <Copy size={14} aria-hidden="true" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {open && (
        <div className={styles.codeBody}>
          <ol className={styles.gutter} aria-hidden="true">
            {lines.map((_, i) => <li key={i}>{i + 1}</li>)}
          </ol>
          {/* highlight.js output is escaped HTML built from the code text. */}
          <pre className={styles.pre}><code dangerouslySetInnerHTML={{ __html: highlight(code, language) }} /></pre>
        </div>
      )}
    </section>
  );
}

/** /submissions/:id (and the contest variant): the full result plus the code. */
const SubmissionDetailPage = () => {
  const { submissionId, contestId } = useParams();
  const id = Number(submissionId);
  const { submission, error } = useLiveSubmission(Number.isSafeInteger(id) && id > 0 ? id : null, contestId);
  const listHref = contestId ? `/contests/${contestId}/submissions` : '/submissions';
  const problemBase = contestId ? `/contests/${contestId}/problems` : '/problems';

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Submissions', to: listHref }, { label: `#${submissionId}` }]}
        title={`Submission #${submissionId}`}
        meta={submission ? (
          <span className={styles.meta}>
            <Link to={`${problemBase}/${submission.problem_id}`}>{submission.problem_title ?? submission.problem_name ?? submission.problem_id}</Link>
            <Link to={`/profile/${submission.username}`}>{submission.username}</Link>
            <span>{getLanguageDisplayName(submission.language)}</span>
          </span>
        ) : undefined}
      />
      {error && <InlineError message={error} />}
      {submission && (
        <>
          <SubmissionResult
            submission={submission}
            limits={judgedLimits(submission.language, submission.time_limit_ms ?? 1000, submission.memory_limit_mb ?? 256)}
            actions={(
              <>
                <Link to={`${problemBase}/${submission.problem_id}`} className={styles.action}>Open problem</Link>
                <Link
                  to={`${problemBase}/${submission.problem_id}?tab=submit`}
                  className={styles.action}
                  onClick={() => { if (isSubmissionLanguage(submission.language)) seedSubmissionDraft(submission.problem_id, submission.language, submission.code ?? ''); }}
                >
                  Edit &amp; resubmit
                </Link>
              </>
            )}
          />
          <SubmittedCode
            code={submission.code}
            language={submission.language}
            filename={submission.problem_type === 'header' ? submission.submission_filename : null}
          />
        </>
      )}
    </div>
  );
};

export default SubmissionDetailPage;
