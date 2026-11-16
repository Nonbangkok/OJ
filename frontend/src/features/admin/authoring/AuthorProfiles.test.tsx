import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import api from '../../../services/api';
import AuthorProfiles from './AuthorProfiles';

jest.mock('../../../services/api');
const profile = {
  id: 'p1',
  userId: 7,
  akaName: 'Writer',
  realName: 'A Writer',
  defaultLanguage: 'Thai',
  countryCode: 'THA',
  hasProfileImage: true,
  createdAt: '2026-09-12T00:00:00Z',
  updatedAt: '2026-09-12T00:00:00Z',
  draftCount: 3,
  linkedUsername: 'writer7',
};
const candidates = [
  { id: 9, username: 'mintra', role: 'user', linkedProfile: null },
  { id: 3, username: 'mint_k', role: 'user', linkedProfile: { id: 'p9', akaName: 'Mint K' } },
];
const runs = [{
  id: 's1', profileId: 'p1', profileAkaName: 'Writer', status: 'succeeded', resultSummary: null,
  createdAt: '2026-09-12T00:00:00Z', finishedAt: null, progress: { total: 4, synced: 4, failed: 0 },
}];
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(api.get).mockImplementation(async (url: string) => ({
    data: url.endsWith('/user-candidates') ? candidates : url.endsWith('/profile-syncs') ? runs : [profile],
  }));
});

/** Opens the row's action menu and clicks one item (Edit / Delete). */
const chooseRowAction = async (label: string, akaName = 'Writer') => {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${akaName}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
};

test('lists profiles as a table with linked user and draft count, and edits in a drawer', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  const row = (await screen.findByRole('button', { name: 'Writer' })).closest('tr') as HTMLElement;
  expect(row).toHaveTextContent('A Writer');
  expect(row).toHaveTextContent('Thai');
  expect(row).toHaveTextContent('THA');
  expect(row).toHaveTextContent('writer7');
  expect(row).toHaveTextContent('3');
  await chooseRowAction('Edit');
  const drawer = await screen.findByRole('dialog', { name: 'Edit Writer' });
  expect(drawer).toHaveTextContent('Used by 3 drafts');
  expect(within(drawer).getByRole('button', { name: 'Remove image' })).toBeEnabled();
  expect(within(drawer).getByRole('button', { name: 'Save profile' })).toHaveAttribute('type', 'submit');
  fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save profile' })).not.toBeInTheDocument());
});

test('links an account by searching usernames; an account linked elsewhere cannot be picked', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await chooseRowAction('Edit');
  const drawer = await screen.findByRole('dialog', { name: 'Edit Writer' });
  expect(within(drawer).getByText('writer7')).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Unlink' }));
  fireEvent.change(within(drawer).getByRole('combobox', { name: 'Linked user' }), { target: { value: 'mint' } });
  const taken = await within(drawer).findByRole('option', { name: /mint_k/ });
  expect(taken).toHaveTextContent('already linked to Mint K');
  expect(taken).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(taken);
  expect(within(drawer).queryByRole('button', { name: 'Unlink' })).toBeNull();
  fireEvent.click(within(drawer).getByRole('option', { name: /mintra/ }));
  expect(within(drawer).getByText('mintra')).toBeInTheDocument();
  jest.mocked(api.patch).mockResolvedValue({ data: { ...profile, userId: 9, linkedUsername: 'mintra' } });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect((jest.mocked(api.patch).mock.calls[0][1] as FormData).get('userId')).toBe('9'));
  expect(api.get).toHaveBeenCalledWith('/admin/author-profiles/user-candidates', { params: { q: 'mint' } });
});

test('a server conflict on the linked account shows under the Linked user field', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await chooseRowAction('Edit');
  const drawer = await screen.findByRole('dialog', { name: 'Edit Writer' });
  jest.mocked(api.patch).mockRejectedValue({
    response: { status: 409, data: { code: 'author_profile_user_conflict', message: 'This user account is already linked to an author profile' } },
  });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save profile' }));
  const error = await within(drawer).findByText('This user account is already linked to an author profile');
  expect(error.closest('[data-field="linked-user"]')).not.toBeNull();
});

test('recent profile syncs are listed on this page', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Recent profile syncs' })).toBeInTheDocument();
  expect(await screen.findByText('4/4 synced')).toBeInTheDocument();
});

test('creates an unlinked profile and shows it in the list after saving', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Actions for Writer' });
  fireEvent.click(screen.getByRole('button', { name: 'New author profile' }));
  expect(await screen.findByRole('dialog', { name: 'New author profile' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('AKA name'), { target: { value: 'New writer' } });
  fireEvent.change(screen.getByLabelText('Real name'), { target: { value: 'New Name' } });
  fireEvent.change(screen.getByLabelText('Default language'), { target: { value: 'English' } });
  fireEvent.change(screen.getByLabelText('Country code'), { target: { value: 'usa' } });
  jest.mocked(api.post).mockResolvedValue({
    data: {
      ...profile,
      id: 'p2',
      userId: null,
      akaName: 'New writer',
      realName: 'New Name',
      defaultLanguage: 'English',
      countryCode: 'USA',
      hasProfileImage: false,
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
  expect(
    await screen.findByRole('button', { name: 'Actions for New writer' })
  ).toBeInTheDocument();
  const [url, body] = jest.mocked(api.post).mock.calls[0];
  expect(url).toBe('/admin/author-profiles');
  expect(Object.fromEntries((body as FormData).entries())).toEqual({
    akaName: 'New writer',
    realName: 'New Name',
    defaultLanguage: 'English',
    countryCode: 'USA',
    userId: '',
  });
});

test('edits metadata, unlinks user and removes image through the profile API', async () => {
  const onChanged = jest.fn();
  render(<MemoryRouter><AuthorProfiles onChanged={onChanged} /></MemoryRouter>);
  await chooseRowAction('Edit');
  fireEvent.change(screen.getByLabelText('AKA name'), { target: { value: 'Updated writer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
  jest.mocked(api.patch).mockResolvedValue({
    data: { ...profile, akaName: 'Updated writer', userId: null, hasProfileImage: false },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(
    await screen.findByRole('button', { name: 'Actions for Updated writer' })
  ).toBeInTheDocument();
  const [url, body] = jest.mocked(api.patch).mock.calls[0];
  expect(url).toBe('/admin/author-profiles/p1');
  expect((body as FormData).get('removeProfileImage')).toBe('true');
  expect((body as FormData).get('userId')).toBe('');
  expect((body as FormData).get('profileImage')).toBeNull();
  expect(onChanged).toHaveBeenCalledTimes(1);
  // The intro hint was removed by design; the list is the page body now.
  expect(screen.queryByText(/cascade to every linked draft/i)).not.toBeInTheDocument();
});

test('retains edits and presents server error on conflicting user link', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await chooseRowAction('Edit');
  fireEvent.change(screen.getByLabelText('Real name'), { target: { value: 'Keep this name' } });
  jest.mocked(api.patch).mockRejectedValue({
    response: { data: { message: 'This user account is already linked to an author profile' } },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already linked');
  expect(screen.getByLabelText('Real name')).toHaveValue('Keep this name');
  expect(screen.getByRole('button', { name: 'Save profile' })).toBeEnabled();
});

test('retries a failed profile list request', async () => {
  // Only the profile list fails (the recent-syncs request still answers).
  let failed = false;
  jest.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/admin/author-profiles' && !failed) { failed = true; throw new Error('Network unavailable'); }
    return { data: url.endsWith('/profile-syncs') ? runs : [profile] };
  });
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  const retry = screen.getByRole('button', { name: 'Retry profiles' });
  expect(retry).toHaveAttribute('type', 'button');
  fireEvent.click(retry);
  expect(
    await screen.findByRole('button', { name: 'Actions for Writer' })
  ).toBeInTheDocument();
});

test('rejects unsupported images and prevents saving while a request is pending', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await chooseRowAction('Edit');
  fireEvent.change(screen.getByLabelText('Profile image'), {
    target: { files: [new File(['svg'], 'test.svg', { type: 'image/svg+xml' })] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(/JPEG, PNG, or WebP/);
  jest.mocked(api.patch).mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Saving profile…' })).toBeDisabled()
  );
});

test('uploads the adjusted square crop as PNG using a CSP-compatible source image', async () => {
  const drawImage = jest.fn();
  let source = '';
  const image = {
    naturalWidth: 800,
    naturalHeight: 400,
    onload: null as null | (() => void),
    onerror: null as null | (() => void),
    set src(value: string) {
      source = value;
      Promise.resolve().then(() => this.onload?.());
    },
  };
  const imageSpy = jest
    .spyOn(window, 'Image')
    .mockImplementation(() => image as unknown as HTMLImageElement);
  const contextSpy = jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const blobSpy = jest
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback) =>
      callback(new Blob(['cropped pixels'], { type: 'image/png' }))
    );
  try {
    render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
    await chooseRowAction('Edit');
    fireEvent.change(screen.getByLabelText('Profile image'), {
      target: { files: [new File(['jpeg pixels'], 'photo.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.change(await screen.findByLabelText('Crop zoom'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Horizontal position'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Vertical position'), { target: { value: '0' } });
    jest.mocked(api.patch).mockResolvedValue({ data: profile });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
    const body = jest.mocked(api.patch).mock.calls[0][1] as FormData;
    expect(body.get('profileImage')).toMatchObject({
      name: 'profile.png',
      type: 'image/png',
      size: 14,
    });
    expect(body.get('removeProfileImage')).toBeNull();
    expect(drawImage).toHaveBeenLastCalledWith(image, 600, 0, 200, 200, 0, 0, 512, 512);
    expect(source).toMatch(/^data:image\/jpeg;base64,/);
  } finally {
    imageSpy.mockRestore();
    contextSpy.mockRestore();
    blobSpy.mockRestore();
  }
});

test('author-relevant edit shows the cascade confirm step, then saves with confirmed', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await chooseRowAction('Edit');
  fireEvent.change(screen.getByLabelText('AKA name'), { target: { value: 'Renamed writer' } });

  // First submit: the server reports cascade impact instead of saving.
  jest.mocked(api.patch).mockResolvedValueOnce({
    data: {
      confirmationRequired: true,
      affectedDrafts: 3,
      affectedPublishedProblems: 12,
      profile,
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

  const confirmBox = await screen.findByRole('dialog', { name: 'Update linked problems?' });
  expect(confirmBox).toHaveTextContent('3 drafts');
  expect(confirmBox).toHaveTextContent('12 published problems');
  expect(screen.getByRole('button', { name: 'Save and sync linked problems' })).toBeInTheDocument();
  // Nothing was saved yet, and the first request carried no confirmation.
  expect((jest.mocked(api.patch).mock.calls[0][1] as FormData).get('confirmed')).toBeNull();

  // Confirmed resubmit saves and starts the cascade.
  jest.mocked(api.patch).mockResolvedValueOnce({
    data: { ...profile, akaName: 'Renamed writer' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save and sync linked problems' }));

  expect(
    await screen.findByRole('button', { name: 'Actions for Renamed writer' })
  ).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/Linked drafts are syncing/i);
  const confirmedBody = jest.mocked(api.patch).mock.calls[1][1] as FormData;
  expect(confirmedBody.get('confirmed')).toBe('true');
  expect(confirmedBody.get('akaName')).toBe('Renamed writer');
  expect(screen.queryByRole('dialog', { name: 'Update linked problems?' })).not.toBeInTheDocument();
});

test('cancel from the confirm step discards the pending cascade without a confirmed request', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await chooseRowAction('Edit');
  fireEvent.change(screen.getByLabelText('Real name'), { target: { value: 'Gate me' } });
  jest.mocked(api.patch).mockResolvedValueOnce({
    data: {
      confirmationRequired: true,
      affectedDrafts: 1,
      affectedPublishedProblems: 0,
      profile,
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await screen.findByRole('dialog', { name: 'Update linked problems?' });

  // Keep editing closes the modal; the edit dialog stays open with the form intact.
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

  expect(screen.queryByRole('dialog', { name: 'Update linked problems?' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save profile' })).toBeInTheDocument();
  expect(api.patch).toHaveBeenCalledTimes(1); // only the gate probe — never a confirmed save
  expect((jest.mocked(api.patch).mock.calls[0][1] as FormData).get('confirmed')).toBeNull();
});

test('no-impact edit (no linked drafts) saves directly with no confirm step', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await chooseRowAction('Edit');
  fireEvent.change(screen.getByLabelText('AKA name'), { target: { value: 'Direct save' } });
  jest.mocked(api.patch).mockResolvedValueOnce({
    data: { ...profile, akaName: 'Direct save' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

  expect(
    await screen.findByRole('button', { name: 'Actions for Direct save' })
  ).toBeInTheDocument();
  // A single save request that carried no confirmation flag (server decided no cascade).
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect((jest.mocked(api.patch).mock.calls[0][1] as FormData).get('confirmed')).toBeNull();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('delete asks for confirmation with the profile identity, then deletes via the API', async () => {
  const onChanged = jest.fn();
  render(<MemoryRouter><AuthorProfiles onChanged={onChanged} /></MemoryRouter>);
  await chooseRowAction('Delete');

  const dialog = await screen.findByRole('dialog', { name: 'Delete Writer?' });
  expect(dialog).toHaveTextContent('A Writer · used by 3 drafts');
  expect(dialog).toHaveTextContent("This can't be undone.");
  // Nothing deleted yet.
  expect(api.delete).not.toHaveBeenCalled();

  jest.mocked(api.delete).mockResolvedValue({ data: { message: 'Author profile deleted', detachedDrafts: 0 } });
  fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Author profile deleted.');
  expect(api.delete).toHaveBeenCalledWith('/admin/author-profiles/p1');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Writer' })).not.toBeInTheDocument());
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('delete confirmation can be cancelled without a request', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await chooseRowAction('Delete');
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('dialog', { name: 'Delete Writer?' })).not.toBeInTheDocument();
  expect(api.delete).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Writer' })).toBeInTheDocument();
});

test('blocked delete (active drafts) renders the server message and keeps the list', async () => {
  render(<MemoryRouter><AuthorProfiles /></MemoryRouter>);
  await chooseRowAction('Delete');
  jest.mocked(api.delete).mockRejectedValue({
    response: {
      status: 409,
      data: {
        message: 'This profile is currently referenced by 2 drafts. Reassign or delete those drafts first.',
        code: 'author_profile_has_active_drafts',
        activeDrafts: 2,
      },
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This profile is currently referenced by 2 drafts. Reassign or delete those drafts first.'
  );
  // The confirmation closes and the profile stays in the list.
  expect(screen.queryByRole('dialog', { name: 'Delete Writer?' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Writer' })).toBeInTheDocument();
});
