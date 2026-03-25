import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ProblemManagement from '../../../features/admin/problems/ProblemManagement';
import adminService from '../../../services/adminService';
import { BrowserRouter } from 'react-router-dom';

// Mock services
jest.mock('../../../services/adminService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../../components/shared/LoadingPage', () => () => <div>Loading Problems...</div>);

// Mock URL and Blob for export tests
window.URL.createObjectURL = jest.fn();
window.URL.revokeObjectURL = jest.fn();

const mockProblems = [
    { id: 'P1', title: 'Problem 1', author: 'admin', is_visible: true, contest_id: null, contest_status: null },
    { id: 'P2', title: 'Problem 2', author: 'admin', is_visible: false, contest_id: null, contest_status: null },
    { id: 'P3', title: 'Problem 3', author: 'admin', is_visible: true, contest_id: 1, contest_status: 'running' },
];

const mockCurrentUser = { id: 1, username: 'admin', role: 'admin' };

const renderProblemManagement = () => {
    return render(
        <BrowserRouter>
            <ProblemManagement currentUser={mockCurrentUser} />
        </BrowserRouter>
    );
};

describe('ProblemManagement Component', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockProblems);
    });

    it('renders loading state initially', () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockReturnValue(new Promise(() => { }));
        renderProblemManagement();
        expect(screen.getByText(/loading problems\.\.\.$/i)).toBeInTheDocument();
    });

    it('renders problem list correctly', async () => {
        renderProblemManagement();

        await waitFor(() => {
            expect(screen.getByText('Problem Management')).toBeInTheDocument();
            expect(screen.getByText('Problem 1')).toBeInTheDocument();
            expect(screen.getByText('Problem 2')).toBeInTheDocument();
        });
    });

    it('handles visibility toggle', async () => {
        (jest.mocked(adminService.updateProblemVisibility) as jest.Mock).mockResolvedValue({ message: 'Updated' });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 2'));

        const hiddenBtn = screen.getByRole('button', { name: /hidden/i });
        fireEvent.click(hiddenBtn);

        expect(adminService.updateProblemVisibility).toHaveBeenCalledWith('P2', true);
    });

    it('disables visibility toggle for problems in active contests', async () => {
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 3'));

        expect(screen.getByText(/in running contest/i)).toBeInTheDocument();
        const p3Row = screen.getAllByRole('row').find(r => r.textContent.includes('Problem 3'));
        const toggleBtn = within(p3Row).queryByRole('button', { name: /visible|hidden/i });
        expect(toggleBtn).not.toBeInTheDocument();
    });

    it('handles bulk actions (Hide All)', async () => {
        (jest.mocked(adminService.updateProblemVisibility) as jest.Mock).mockResolvedValue({ message: 'Updated' });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Hide All'));
        fireEvent.click(screen.getByText('Hide All'));

        // Check confirmation modal
        expect(screen.getByText(/are you sure you want to hide all problems/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

        await waitFor(() => {
            // Should be called for P1 (P3 is in contest, P2 is already hidden)
            expect(adminService.updateProblemVisibility).toHaveBeenCalledWith('P1', false);
            expect(adminService.updateProblemVisibility).not.toHaveBeenCalledWith('P3', false);
        });
    });

    it('handles individual problem deletion', async () => {
        (jest.mocked(adminService.deleteProblem) as jest.Mock).mockResolvedValue({ message: 'Deleted' });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 1'));

        const p1Row = screen.getAllByRole('row').find(r => r.textContent.includes('Problem 1'));
        const deleteBtn = within(p1Row).getByText(/delete/i);
        fireEvent.click(deleteBtn);

        expect(screen.getByText(/confirm deletion/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

        await waitFor(() => {
            expect(adminService.deleteProblem).toHaveBeenCalledWith('P1');
        });
    });

    it('handles problem export', async () => {
        (jest.mocked(adminService.exportProblems) as jest.Mock).mockResolvedValue({
            data: new Blob(),
            headers: { 'content-type': 'application/zip' },
            status: 200,
            statusText: 'OK',
            config: { headers: {} },
        });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 1'));

        // Select a problem
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[1]); // First problem checkbox (index 0 is Select All)

        const exportBtn = screen.getByText(/export selected/i);
        fireEvent.click(exportBtn);

        await waitFor(() => {
            expect(adminService.exportProblems).toHaveBeenCalledWith(['P1']);
        });
    });
});
