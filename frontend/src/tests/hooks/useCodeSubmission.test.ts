import { renderHook, waitFor, act } from '@testing-library/react';
import useCodeSubmission from '../../hooks/useCodeSubmission';
import submissionService from '../../services/submissionService';
import { useNavigate } from 'react-router-dom';

jest.mock('../../services/submissionService');

// Mock matchMedia for highlight.js which might be imported in useCodeSubmission
if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: ((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => { },
            removeListener: () => { },
            addEventListener: () => { },
            removeEventListener: () => { },
            dispatchEvent: () => false,
        })) as unknown as typeof window.matchMedia,
    });
}

jest.mock('react-router-dom', () => ({
    useNavigate: jest.fn()
}));

describe('useCodeSubmission', () => {
    const mockNavigate = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(useNavigate) as jest.Mock).mockReturnValue(mockNavigate);
        localStorage.clear();
    });

    const mockProblemId = 'problem-1';
    const mockContestId = 'contest-1';

    it('initializes with default values and blank cache', () => {
        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        expect(result.current.language).toBe('cpp');
        expect(result.current.code).toBe('');
        expect(result.current.isSubmitting).toBe(false);
        expect(result.current.error).toBe('');
    });

    it('loads code from localStorage cache correctly', () => {
        const cacheObj = {
            [mockProblemId]: {
                code: 'console.log("cached")',
                timestamp: new Date().getTime() - 1000 // 1 sec ago
            }
        };
        localStorage.setItem('oj-submission-cache', JSON.stringify(cacheObj));

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        expect(result.current.code).toBe('console.log("cached")');
    });

    it('ignores expired cache items', () => {
        const cacheObj = {
            [mockProblemId]: {
                code: 'console.log("expired")',
                timestamp: new Date().getTime() - (40 * 60 * 1000) // 40 mins ago
            }
        };
        localStorage.setItem('oj-submission-cache', JSON.stringify(cacheObj));

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        // Cache should be ignored since it's > 30 minutes old
        expect(result.current.code).toBe('');
    });

    it('handles successful submission, saves to cache and navigates', async () => {
        (jest.mocked(submissionService.submit) as jest.Mock).mockResolvedValueOnce({ success: true });

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        act(() => {
            result.current.setCode('print("hello")');
        });

        const mockEvent = { preventDefault: jest.fn() };

        await act(async () => {
            await result.current.handleSubmit(mockEvent);
        });

        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(submissionService.submit).toHaveBeenCalledWith({
            problemId: mockProblemId,
            language: 'cpp',
            code: 'print("hello")'
        });

        const cache = JSON.parse(localStorage.getItem('oj-submission-cache'));
        expect(cache[mockProblemId].code).toBe('print("hello")');
        expect(mockNavigate).toHaveBeenCalledWith('/submissions');
    });
});
