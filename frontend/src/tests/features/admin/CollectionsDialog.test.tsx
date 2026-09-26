import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CollectionsDialog from '../../../features/admin/problems/CollectionsDialog';
import adminService from '../../../services/adminService';
import type { CollectionWithStats } from '../../../services/admin/problemsAdminService';

jest.mock('../../../services/adminService');

const makeCollection = (overrides: Partial<CollectionWithStats> = {}): CollectionWithStats => ({
    id: 1,
    name: 'Classical Problem',
    problem_count: 51,
    status: 'all_visible',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
});

const renderDialog = (collections: CollectionWithStats[] = [], onChanged = jest.fn()) =>
    render(
        <CollectionsDialog
            open
            onClose={jest.fn()}
            onChanged={onChanged}
            collections={collections}
        />,
    );

describe('CollectionsDialog', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the create form with vertical fields and no edit actions', () => {
        renderDialog();

        // Vertical form: label and input are separate rows; only the create
        // submit button exists — no Cancel while not editing.
        expect(screen.getByText('Create a collection')).toBeInTheDocument();
        expect(screen.getByLabelText('Name')).toBeInTheDocument();
        expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create Collection' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('shows the create-form heading and helper copy', () => {
        renderDialog();
        expect(screen.getByText(/group problems so they can be filtered/i)).toBeInTheDocument();
        expect(screen.queryByText('Edit Collection')).not.toBeInTheDocument();
    });

    it('renders collection rows with count, status and actions', () => {
        const collection = makeCollection();
        renderDialog([collection]);

        expect(screen.getByText('Classical Problem')).toBeInTheDocument();
        expect(screen.getByText('51 problems')).toBeInTheDocument();
        expect(screen.getByText('All Visible')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('renders an empty state when there are no collections', () => {
        renderDialog([]);
        expect(screen.getByText('No collections yet.')).toBeInTheDocument();
    });

    describe('create', () => {
        it('creates a collection with the entered name', async () => {
            const onChanged = jest.fn();
            (jest.mocked(adminService.createCollection) as jest.Mock).mockResolvedValue({});
            renderDialog([], onChanged);

            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Beginner Set' } });
            fireEvent.click(screen.getByRole('button', { name: 'Create Collection' }));

            await waitFor(() => {
                expect(adminService.createCollection).toHaveBeenCalledWith('Beginner Set');
            });
            expect(onChanged).toHaveBeenCalledTimes(1);
        });


        it('refuses to submit an empty name (required validation)', async () => {
            renderDialog();

            const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
            expect(nameInput.required).toBe(true);

            fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
            fireEvent.click(screen.getByRole('button', { name: 'Create Collection' }));

            // Whitespace-only never reaches the service.
            expect(adminService.createCollection).not.toHaveBeenCalled();
        });

        it('surfaces a server error inline without closing the form', async () => {
            (jest.mocked(adminService.createCollection) as jest.Mock).mockRejectedValue({
                response: { data: { message: 'A collection named "X" already exists' } },
            });
            renderDialog();

            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } });
            fireEvent.click(screen.getByRole('button', { name: 'Create Collection' }));

            expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
            expect(screen.getByLabelText('Name')).toHaveValue('X');
        });
    });

    describe('edit', () => {
        it('switches the form to an explicit edit mode and saves changes', async () => {
            const collection = makeCollection({ status: 'mixed' });
            const onChanged = jest.fn();
            (jest.mocked(adminService.updateCollection) as jest.Mock).mockResolvedValue({});
            renderDialog([collection], onChanged);

            fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

            // Edit mode is visually distinct: its own heading and
            // Cancel + Save Changes actions — never Create.
            expect(screen.getByText('Edit Collection')).toBeInTheDocument();
            expect(screen.queryByText('Create a collection')).not.toBeInTheDocument();
            const save = screen.getByRole('button', { name: 'Save Changes' });
            const cancel = screen.getByRole('button', { name: 'Cancel' });
            expect(save).toBeInTheDocument();
            expect(cancel).toBeInTheDocument();

            // The form is prefilled with the collection's current values.
            expect(screen.getByLabelText('Name')).toHaveValue('Classical Problem');

            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
            fireEvent.click(save);

            await waitFor(() => {
                expect(adminService.updateCollection).toHaveBeenCalledWith(1, 'Renamed');
            });
            expect(onChanged).toHaveBeenCalledTimes(1);
        });

        it('cancel returns to create mode with a cleared form', async () => {
            const collection = makeCollection();
            renderDialog([collection]);

            fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft Name' } });
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

            await waitFor(() => {
                expect(screen.getByText('Create a collection')).toBeInTheDocument();
            });
            expect(screen.queryByText('Edit Collection')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Create Collection' })).toBeInTheDocument();
            expect(screen.getByLabelText('Name')).toHaveValue('');
        });

        it('highlights the row being edited', () => {
            const collections = [
                makeCollection({ id: 1, name: 'Alpha' }),
                makeCollection({ id: 2, name: 'Beta' }),
            ];
            const { container } = renderDialog(collections);

            fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);

            // The dialog renders through a portal into document.body.
            const rows = document.body.querySelectorAll('li');
            const alphaRow = Array.from(rows).find(r => r.textContent?.includes('Alpha'));
            const betaRow = Array.from(rows).find(r => r.textContent?.includes('Beta'));
            expect(betaRow?.className).toMatch(/collectionRowEditing/);
            expect(alphaRow?.className).not.toMatch(/collectionRowEditing/);
        });
    });

    describe('delete', () => {
        it('asks for confirmation and states that problems survive', async () => {
            const collection = makeCollection();
            (jest.mocked(adminService.deleteCollection) as jest.Mock).mockResolvedValue(undefined);
            renderDialog([collection]);

            fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

            // Confirmation appears before anything is deleted, and says
            // explicitly that member problems are kept.
            expect(screen.getByText(/delete “classical problem”\?/i)).toBeInTheDocument();
            expect(screen.getByText(/problems in this collection will not be deleted/i)).toBeInTheDocument();
            expect(adminService.deleteCollection).not.toHaveBeenCalled();

            fireEvent.click(screen.getByRole('button', { name: 'Delete Collection' }));

            await waitFor(() => {
                expect(adminService.deleteCollection).toHaveBeenCalledWith(1);
            });
        });

        it('cancel dismisses the confirmation without deleting', () => {
            const collection = makeCollection();
            renderDialog([collection]);

            fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

            expect(screen.queryByText(/problems in this collection will not be deleted/i)).not.toBeInTheDocument();
            expect(adminService.deleteCollection).not.toHaveBeenCalled();
        });

        it('clears edit mode when the collection being edited is deleted', async () => {
            const collection = makeCollection();
            const onChanged = jest.fn();
            (jest.mocked(adminService.deleteCollection) as jest.Mock).mockResolvedValue(undefined);
            renderDialog([collection], onChanged);

            fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
            fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
            fireEvent.click(screen.getByRole('button', { name: 'Delete Collection' }));

            await waitFor(() => {
                expect(screen.getByText('Create a collection')).toBeInTheDocument();
            });
            expect(onChanged).toHaveBeenCalledTimes(1);
        });
    });

    describe('long names', () => {
        it('truncates gracefully and keeps the full name in a title tooltip', () => {
            const longName = 'A'.repeat(100);
            const collection = makeCollection({ name: longName });
            renderDialog([collection]);

            const nameEl = document.body.querySelector('[class*="collectionName"]');
            expect(nameEl).not.toBeNull();
            expect(nameEl?.getAttribute('title')).toBe(longName);
            // CSS enforces the visual truncation.
            expect(nameEl?.className).toMatch(/collectionName/);
        });
    });
});
