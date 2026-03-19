import { renderHook, waitFor, act } from '@testing-library/react';
import useSubmissionModal from '../../hooks/useSubmissionModal';

describe('useSubmissionModal', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        // mock navigator.clipboard
        Object.assign(navigator, {
            clipboard: {
                writeText: jest.fn().mockImplementation(() => Promise.resolve()),
            },
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('initializes default values correctly', () => {
        const { result } = renderHook(() => useSubmissionModal(null));

        expect(result.current.code).toBe('');
        expect(result.current.lineCount).toBe(1);
        expect(result.current.copySuccess).toBe(false);
    });

    it('updates state based on submission prop', () => {
        const mockSubmission = { code: 'console.log("hi");\nreturn true;' };

        const { result } = renderHook(() => useSubmissionModal(mockSubmission));

        expect(result.current.code).toBe('console.log("hi");\nreturn true;');
        expect(result.current.lineCount).toBe(2);
    });

    it('handles copy code button functionality', async () => {
        const mockSubmission = { code: 'test code' };
        const { result } = renderHook(() => useSubmissionModal(mockSubmission));

        await act(async () => {
            await result.current.handleCopyCode();
        });

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test code');
        expect(result.current.copySuccess).toBe(true);

        act(() => {
            jest.advanceTimersByTime(2000);
        });

        expect(result.current.copySuccess).toBe(false);
    });

    it('parses test results correctly from string JSON', () => {
        const mockSubmission = {
            results: JSON.stringify([{ status: 'Accepted', timeMs: 12, memoryKb: 1024 }])
        };

        const { result } = renderHook(() => useSubmissionModal(mockSubmission));

        expect(result.current.parsedResults).toEqual([{ status: 'Accepted', timeMs: 12, memoryKb: 1024 }]);
    });

    it('parses test results correctly from raw JS object', () => {
        const mockObjectResults = [{ status: 'Wrong Answer' }];
        const mockSubmission = {
            results: mockObjectResults
        };

        const { result } = renderHook(() => useSubmissionModal(mockSubmission));

        expect(result.current.parsedResults).toEqual(mockObjectResults);
    });

    it('handles empty results and invalid JSON data', () => {
        const invalidMock = { results: 'invalid { json' };
        const { result: res1 } = renderHook(() => useSubmissionModal(invalidMock));
        expect(res1.current.parsedResults).toBe('error');

        const emptyArrayMock = { results: '[]' };
        const { result: res2 } = renderHook(() => useSubmissionModal(emptyArrayMock));
        expect(res2.current.parsedResults).toEqual([]);

        const undefinedMock = {};
        const { result: res3 } = renderHook(() => useSubmissionModal(undefinedMock));
        expect(res3.current.parsedResults).toBe(null);
    });
});
