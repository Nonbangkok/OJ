import { DraftFields, Profile } from './types';
export default function MetadataFields({ value, profiles, onEdit, disabled = false, problemIdLocked = false }: {
  value: DraftFields; profiles: Profile[]; disabled?: boolean; problemIdLocked?: boolean;
  onEdit: <K extends keyof DraftFields>(key: K, value: DraftFields[K]) => void;
}) {
  return <fieldset disabled={disabled}>
    <legend>Problem metadata</legend>
    <label>Problem ID<input required maxLength={50} disabled={problemIdLocked} value={value.problemId} onChange={e => onEdit('problemId', e.target.value)} /></label>
    {problemIdLocked && <p>Problem ID is locked after the first publication to keep the published revision linked to its grader problem.</p>}
    <label>Title<input required maxLength={255} value={value.title} onChange={e => onEdit('title', e.target.value)} /></label>
    <label>Author profile<select value={value.authorProfileId || ''} onChange={e => {
      const profile = profiles.find(p => p.id === e.target.value);
      onEdit('authorProfileId', profile?.id || null);
      if (profile) {
        onEdit('authorAkaName', profile.akaName); onEdit('authorRealName', profile.realName);
        onEdit('language', profile.defaultLanguage); onEdit('countryCode', profile.countryCode);
      }
    }}><option value="">Manual author / fallback avatar</option>
      {value.authorProfileId && !profiles.some(p => p.id === value.authorProfileId) && <option value={value.authorProfileId}>Linked profile</option>}
      {profiles.map(p => <option key={p.id} value={p.id}>{p.akaName} — {p.realName}</option>)}
    </select></label>
    <label>AKA name<input required maxLength={100} value={value.authorAkaName} onChange={e => onEdit('authorAkaName', e.target.value)} /></label>
    <label>Real name<input required maxLength={255} value={value.authorRealName} onChange={e => onEdit('authorRealName', e.target.value)} /></label>
    <label>Language<input required maxLength={50} value={value.language} onChange={e => onEdit('language', e.target.value)} /></label>
    <label>Country code<input required pattern="[A-Z]{3}" maxLength={3} value={value.countryCode} onChange={e => onEdit('countryCode', e.target.value.toUpperCase())} /></label>
    <label>Time limit (ms)<input required type="number" min={1} max={900000} value={value.timeLimitMs || ''} onChange={e => onEdit('timeLimitMs', Number(e.target.value))} /></label>
    <label>Memory limit (MiB)<input required type="number" min={1} max={736} value={value.memoryLimitMb || ''} onChange={e => onEdit('memoryLimitMb', Number(e.target.value))} /></label>
    <p>Template: {value.templateVersion}. Runner supports up to 900000 ms / 736 MiB.</p>
    <p>Author information and avatar are saved as a snapshot. Profile edits do not silently update this draft.</p>
  </fieldset>;
}
