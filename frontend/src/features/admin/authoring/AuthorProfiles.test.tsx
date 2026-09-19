import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(api.get).mockResolvedValue({ data: [profile] });
});

test('uses bounded profile identity and shared action hierarchy', async () => {
  render(<AuthorProfiles />);
  const edit = await screen.findByRole('button', { name: 'Edit Writer' });
  const row = edit.closest('li');

  expect(row).not.toBeNull();
  expect(row?.querySelector('[data-profile-identity]')).toHaveTextContent('Writer');
  expect(edit).toHaveAttribute('type', 'button');
  expect(screen.getByRole('button', { name: 'New author profile' })).toBeEnabled();

  fireEvent.click(edit);

  expect(screen.getByRole('button', { name: 'Remove image' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save profile' })).toHaveAttribute('type', 'submit');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('button', { name: 'Save profile' })).not.toBeInTheDocument();
});

test('creates an unlinked profile and shows it in the list after saving', async () => {
  render(<AuthorProfiles />);
  await screen.findByRole('button', { name: 'Edit Writer' });
  fireEvent.click(screen.getByRole('button', { name: 'New author profile' }));
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
  expect(await screen.findByRole('button', { name: 'Edit New writer' })).toBeInTheDocument();
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
  render(<AuthorProfiles onChanged={onChanged} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Writer' }));
  fireEvent.change(screen.getByLabelText('AKA name'), { target: { value: 'Updated writer' } });
  fireEvent.change(screen.getByLabelText('User account ID (optional)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
  jest.mocked(api.patch).mockResolvedValue({
    data: { ...profile, akaName: 'Updated writer', userId: null, hasProfileImage: false },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(await screen.findByRole('button', { name: 'Edit Updated writer' })).toBeInTheDocument();
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
  render(<AuthorProfiles />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Writer' }));
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
  jest.mocked(api.get).mockRejectedValueOnce(new Error('Network unavailable'));
  render(<AuthorProfiles />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  const retry = screen.getByRole('button', { name: 'Retry profiles' });
  expect(retry).toHaveAttribute('type', 'button');
  fireEvent.click(retry);
  expect(await screen.findByRole('button', { name: 'Edit Writer' })).toBeInTheDocument();
});

test('rejects unsupported images and prevents saving while a request is pending', async () => {
  render(<AuthorProfiles />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Writer' }));
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
    render(<AuthorProfiles />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Writer' }));
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
  render(<AuthorProfiles />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Writer' }));
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

  expect(await screen.findByRole('button', { name: 'Edit Renamed writer' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/Linked drafts are syncing/i);
  const confirmedBody = jest.mocked(api.patch).mock.calls[1][1] as FormData;
  expect(confirmedBody.get('confirmed')).toBe('true');
  expect(confirmedBody.get('akaName')).toBe('Renamed writer');
  expect(screen.queryByRole('dialog', { name: 'Update linked problems?' })).not.toBeInTheDocument();
});

test('cancel from the confirm step discards the pending cascade without a confirmed request', async () => {
  render(<AuthorProfiles />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Writer' }));
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
  render(<AuthorProfiles />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Writer' }));
  fireEvent.change(screen.getByLabelText('AKA name'), { target: { value: 'Direct save' } });
  jest.mocked(api.patch).mockResolvedValueOnce({
    data: { ...profile, akaName: 'Direct save' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

  expect(await screen.findByRole('button', { name: 'Edit Direct save' })).toBeInTheDocument();
  // A single save request that carried no confirmation flag (server decided no cascade).
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect((jest.mocked(api.patch).mock.calls[0][1] as FormData).get('confirmed')).toBeNull();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});
