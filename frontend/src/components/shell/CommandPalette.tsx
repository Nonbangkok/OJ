import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { CircleHalf, FlagCheckered, ListChecks, MagnifyingGlass, User } from '@phosphor-icons/react';
import { Dialog } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useTheme } from '../../context/ThemeContext';
import submissionService from '../../services/submissionService';
import contestService from '../../services/contestService';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import type { Contest, ProblemSuggestion, UserSuggestion } from '../../types';
import { navItemsFor } from './navItems';
import styles from './CommandPalette.module.css';

const DEBOUNCE_MS = 200;
const matches = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isPrivateMode } = useSettings();
  const { toggleTheme } = useTheme();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  const [problems, setProblems] = useState<ProblemSuggestion[]>([]);
  const [users, setUsers] = useState<UserSuggestion[]>([]);
  const [contests, setContests] = useState<Contest[]>([]);
  const isStaff = user?.role === 'staff' || user?.role === 'admin';
  const term = debounced.trim();

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    contestService.getAll().then((data) => { if (!cancelled) setContests(data); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!term) return undefined;
    let cancelled = false;
    submissionService.searchProblems(term).then((data) => { if (!cancelled) setProblems(data); }).catch(() => undefined);
    if (isStaff) {
      submissionService.searchUsers(term).then((data) => { if (!cancelled) setUsers(data); }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [term, isStaff]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const pages = navItemsFor(user?.role ?? null, { privateMode: isPrivateMode }).filter((item) => !query || matches(item.label, query));
  const contestHits = query ? contests.filter((c) => matches(c.title, query)).slice(0, 5) : [];
  const problemHits = term ? problems.slice(0, 8) : [];
  const userHits = term && isStaff ? users.slice(0, 5) : [];
  const showTheme = !query || matches('Toggle theme', query);

  return (
    <Dialog open title="Search" onClose={onClose} initialFocusRef={inputRef}>
      <Command shouldFilter={false} label="Search" className={styles.command}>
        <div className={styles.inputRow}>
          <MagnifyingGlass size={16} aria-hidden="true" />
          <Command.Input ref={inputRef} value={query} onValueChange={setQuery} placeholder="Search problems, contests, pages…" className={styles.input} />
        </div>
        <Command.List className={styles.list}>
          <Command.Empty className={styles.empty}>No results</Command.Empty>
          {problemHits.length > 0 && (
            <Command.Group heading="Problems" className={styles.group}>
              {problemHits.map((p) => (
                <Command.Item key={p.id} value={`problem-${p.id}`} onSelect={() => go(`/problems/${p.id}`)} className={styles.item}>
                  <ListChecks size={16} aria-hidden="true" />
                  <span>{p.title}</span>
                  <span className={styles.mono}>{p.id}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {contestHits.length > 0 && (
            <Command.Group heading="Contests" className={styles.group}>
              {contestHits.map((c) => (
                <Command.Item key={c.id} value={`contest-${c.id}`} onSelect={() => go(`/contests/${c.id}`)} className={styles.item}>
                  <FlagCheckered size={16} aria-hidden="true" />
                  <span>{c.title}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {userHits.length > 0 && (
            <Command.Group heading="Users" className={styles.group}>
              {userHits.map((u) => (
                <Command.Item key={u.id} value={`user-${u.id}`} onSelect={() => go(`/profile/${u.username}`)} className={styles.item}>
                  <User size={16} aria-hidden="true" />
                  <span>{u.username}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {pages.length > 0 && (
            <Command.Group heading="Go to" className={styles.group}>
              {pages.map((item) => {
                const Icon = item.icon;
                return (
                  <Command.Item key={item.key} value={`page-${item.key}`} onSelect={() => go(item.to)} className={styles.item}>
                    <Icon size={16} aria-hidden="true" />
                    <span>{item.group === 'manage' ? `Manage · ${item.label}` : item.label}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}
          {showTheme && (
            <Command.Group heading="Actions" className={styles.group}>
              <Command.Item value="action-theme" onSelect={() => { toggleTheme(); onClose(); }} className={styles.item}>
                <CircleHalf size={16} aria-hidden="true" />
                <span>Toggle theme</span>
              </Command.Item>
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Dialog>
  );
}
