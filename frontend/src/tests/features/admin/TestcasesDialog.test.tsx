import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TestcasesDialog from '../../../features/admin/problems/TestcasesDialog';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

const metadata = {
    testcases: [
        { case_number: 1, input_bytes: 12, output_bytes: 34 },
        { case_number: 2, input_bytes: 0, output_bytes: 4 },
    ],
    total: 2,
};

const caseContent = {
    caseNumber: 1,
    input: { bytes: 12, truncated: false, content: '3\n1 2 3\n' },
    output: { bytes: 34, truncated: false, content: '6\n' },
};

describe('TestcasesDialog', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(adminService.getProblemTestcases) as jest.Mock).mockResolvedValue(metadata);
    });

    it('renders the problem id and case count in the header', async () => {
        render(<TestcasesDialog problem={{ id: 'aplusb' }} onClose={jest.fn()} />);

        expect(await screen.findByText('Testcases: aplusb')).toBeInTheDocument();
        expect(screen.getByText('2 testcases')).toBeInTheDocument();
        expect(adminService.getProblemTestcases).toHaveBeenCalledWith('aplusb');
    });

    it('renders metadata rows with sizes and no content fetch', async () => {
        render(<TestcasesDialog problem={{ id: 'aplusb' }} onClose={jest.fn()} />);

        await screen.findByRole('button', { name: /#1/i });
        expect(screen.getByRole('button', { name: /#2/i })).toBeInTheDocument();
        // Byte sizes are formatted for humans.
        expect(screen.getByText('in 12 B')).toBeInTheDocument();
        expect(screen.getByText('out 34 B')).toBeInTheDocument();
        expect(adminService.getProblemTestcase).not.toHaveBeenCalled();
    });

    it('fetches full content only when a case is expanded, with copy buttons', async () => {
        (jest.mocked(adminService.getProblemTestcase) as jest.Mock).mockResolvedValue(caseContent);
        render(<TestcasesDialog problem={{ id: 'aplusb' }} onClose={jest.fn()} />);

        const row = await screen.findByRole('button', { name: /#1/i });
        expect(row).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(row);

        expect(row).toHaveAttribute('aria-expanded', 'true');
        expect(await screen.findByText(/1 2 3/)).toBeInTheDocument();
        expect(screen.getByText(/^6$/)).toBeInTheDocument();
        expect(adminService.getProblemTestcase).toHaveBeenCalledWith('aplusb', 1);

        // Copy button per pane.
        expect(screen.getByRole('button', { name: /copy input of this case/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy output of this case/i })).toBeInTheDocument();

        // Collapsing and re-expanding reuses the cached content (no refetch).
        fireEvent.click(row);
        fireEvent.click(row);
        expect(await screen.findByText(/1 2 3/)).toBeInTheDocument();
        expect(adminService.getProblemTestcase).toHaveBeenCalledTimes(1);
    });

    it('shows a truncated notice when the API truncated a side', async () => {
        (jest.mocked(adminService.getProblemTestcase) as jest.Mock).mockResolvedValue({
            ...caseContent,
            input: { bytes: 2 * 1024 * 1024, truncated: true, content: 'a'.repeat(1024 * 1024) },
        });
        render(<TestcasesDialog problem={{ id: 'aplusb' }} onClose={jest.fn()} />);

        fireEvent.click(await screen.findByRole('button', { name: /#1/i }));

        expect(await screen.findByText(/truncated — showing 1 mb of 2\.00 mb/i)).toBeInTheDocument();
    });

    it('shows an explicit empty state for a problem with no testcases (DB-06)', async () => {
        (jest.mocked(adminService.getProblemTestcases) as jest.Mock).mockResolvedValue({ testcases: [], total: 0 });
        render(<TestcasesDialog problem={{ id: 'empty' }} onClose={jest.fn()} />);

        expect(await screen.findByText(/this problem has no testcases/i)).toBeInTheDocument();
        expect(screen.getByText('0 testcases')).toBeInTheDocument();
    });

    it('shows an error when the metadata list fails', async () => {
        (jest.mocked(adminService.getProblemTestcases) as jest.Mock).mockRejectedValue({
            response: { status: 500, data: { message: 'Database unavailable' } },
        });
        render(<TestcasesDialog problem={{ id: 'aplusb' }} onClose={jest.fn()} />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    });

    it('shows an error inside the row when a single case fails to load', async () => {
        (jest.mocked(adminService.getProblemTestcase) as jest.Mock).mockRejectedValue({
            response: { status: 500, data: { message: 'Case fetch failed' } },
        });
        render(<TestcasesDialog problem={{ id: 'aplusb' }} onClose={jest.fn()} />);

        fireEvent.click(await screen.findByRole('button', { name: /#1/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Case fetch failed');
    });

    it('renders nothing when no problem is selected', () => {
        const { container } = render(<TestcasesDialog problem={null} onClose={jest.fn()} />);
        expect(container).toBeEmptyDOMElement();
        expect(adminService.getProblemTestcases).not.toHaveBeenCalled();
    });

    it('re-fetches when the problem changes', async () => {
        const { rerender } = render(<TestcasesDialog problem={{ id: 'a' }} onClose={jest.fn()} />);
        await screen.findByText('Testcases: a');
        rerender(<TestcasesDialog problem={{ id: 'b' }} onClose={jest.fn()} />);

        await screen.findByText('Testcases: b');
        expect(adminService.getProblemTestcases).toHaveBeenCalledTimes(2);
        expect(adminService.getProblemTestcases).toHaveBeenLastCalledWith('b');
    });

    it('copies pane content via the clipboard', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        (jest.mocked(adminService.getProblemTestcase) as jest.Mock).mockResolvedValue(caseContent);
        render(<TestcasesDialog problem={{ id: 'aplusb' }} onClose={jest.fn()} />);

        fireEvent.click(await screen.findByRole('button', { name: /#1/i }));
        fireEvent.click(await screen.findByRole('button', { name: /copy input of this case/i }));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('3\n1 2 3\n'));
        expect(await screen.findByRole('button', { name: /copy input of this case/i })).toHaveTextContent('Copied');
    });
});
