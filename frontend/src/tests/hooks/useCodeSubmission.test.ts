import { renderHook, waitFor, act } from '@testing-library/react';
import useCodeSubmission from '../../hooks/useCodeSubmission';
import { JAVA_STARTER_TEMPLATE } from '../../utils/constants';
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

    it('starts with no language chosen when nothing is cached, so the student picks one', () => {
        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        expect(result.current.language).toBeNull();
        expect(result.current.code).toBe('');
        expect(result.current.isSubmitting).toBe(false);
        expect(result.current.error).toBe('');
    });

    it('loads code from localStorage cache correctly', () => {
        const cacheObj = {
            [`${mockProblemId}:cpp`]: {
                code: 'console.log("cached")',
                timestamp: new Date().getTime() - 1000 // 1 sec ago
            }
        };
        localStorage.setItem('oj-submission-cache', JSON.stringify(cacheObj));

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        // A saved draft brings its language back with it.
        expect(result.current.language).toBe('cpp');
        expect(result.current.code).toBe('console.log("cached")');
    });

    it('a saved Python draft preselects Python', () => {
        localStorage.setItem('oj-submission-cache', JSON.stringify({
            [`${mockProblemId}:python`]: { code: 'print(1)', timestamp: new Date().getTime() - 1000 },
        }));
        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));
        expect(result.current.language).toBe('python');
        expect(result.current.code).toBe('print(1)');
    });

    it('code typed before choosing a language is kept when one is chosen', () => {
        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));
        act(() => { result.current.setCode('int main() {}'); });
        act(() => { result.current.setLanguage('cpp'); });
        expect(result.current.language).toBe('cpp');
        expect(result.current.code).toBe('int main() {}');
    });

    it('refuses to submit before a language is chosen', async () => {
        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));
        act(() => { result.current.setCode('print(1)'); });
        await act(async () => { await result.current.handleSubmit({ preventDefault: jest.fn() } as never); });
        expect(submissionService.submit).not.toHaveBeenCalled();
        expect(result.current.error).toBe('Choose a language first.');
    });

    it('keys the cache per language so switching does not restore the other language\'s code', () => {
        const cacheObj = {
            [`${mockProblemId}:cpp`]: {
                code: '#include <iostream>',
                timestamp: new Date().getTime() - 1000
            },
            [`${mockProblemId}:python`]: {
                code: 'print("py")',
                timestamp: new Date().getTime() - 1000
            }
        };
        localStorage.setItem('oj-submission-cache', JSON.stringify(cacheObj));

        const { result, rerender } = renderHook(
            ({ problemId }) => useCodeSubmission(problemId, undefined),
            { initialProps: { problemId: mockProblemId } }
        );

        // cpp cache is loaded initially.
        expect(result.current.code).toBe('#include <iostream>');

        // Switching to python loads the python cache, not the C++ code.
        act(() => {
            result.current.setLanguage('python');
        });
        rerender({ problemId: mockProblemId });

        expect(result.current.language).toBe('python');
        expect(result.current.code).toBe('print("py")');

        // Switching back to cpp restores the C++ code.
        act(() => {
            result.current.setLanguage('cpp');
        });
        rerender({ problemId: mockProblemId });

        expect(result.current.code).toBe('#include <iostream>');
    });

    it('starts from a blank editor for a language with no cached draft', () => {
        const cacheObj = {
            [`${mockProblemId}:cpp`]: {
                code: '#include <iostream>',
                timestamp: new Date().getTime() - 1000
            }
        };
        localStorage.setItem('oj-submission-cache', JSON.stringify(cacheObj));

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        expect(result.current.code).toBe('#include <iostream>');

        act(() => {
            result.current.setLanguage('python');
        });

        // No python draft: the editor is blank, not the C++ code.
        expect(result.current.code).toBe('');
    });

    it('starts a Java editor with no draft from the class Main template', () => {
        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        act(() => {
            result.current.setLanguage('java');
        });

        expect(result.current.language).toBe('java');
        expect(result.current.code).toBe(JAVA_STARTER_TEMPLATE);
    });

    it('restores a saved Java draft instead of the template', () => {
        localStorage.setItem('oj-submission-cache', JSON.stringify({
            [`${mockProblemId}:java`]: { code: 'public class Main {}', timestamp: new Date().getTime() - 1000 },
        }));

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        expect(result.current.language).toBe('java');
        expect(result.current.code).toBe('public class Main {}');
    });

    it('a dropped .java file switches a standard problem to Java', async () => {
        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));
        const file = new File(['public class Main { }'], 'Main.java', { type: 'text/x-java' });

        await act(async () => { await result.current.loadFile(file); });

        await waitFor(() => expect(result.current.language).toBe('java'));
        expect(result.current.code).toBe('public class Main { }');
    });

    it('ignores expired cache items', () => {
        const cacheObj = {
            [`${mockProblemId}:cpp`]: {
                code: 'console.log("expired")',
                timestamp: new Date().getTime() - (40 * 60 * 1000) // 40 mins ago
            }
        };
        localStorage.setItem('oj-submission-cache', JSON.stringify(cacheObj));

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        // Cache should be ignored since it's > 30 minutes old
        expect(result.current.code).toBe('');
    });

    it('handles successful submission, saves to cache and reports the new id', async () => {
        (jest.mocked(submissionService.submit) as jest.Mock).mockResolvedValueOnce({ message: 'ok', submissionId: 41, isContestSubmission: false });
        const onSubmitted = jest.fn();

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined, null, onSubmitted));

        act(() => { result.current.setLanguage('cpp'); });
        act(() => { result.current.setCode('print("hello")'); });

        const mockEvent = { preventDefault: jest.fn() } as unknown as React.FormEvent<Element>;

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
        expect(cache[`${mockProblemId}:cpp`].code).toBe('print("hello")');
        // The page shows the result in place; no navigation away.
        expect(onSubmitted).toHaveBeenCalledWith(41);
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(result.current.isSubmitting).toBe(false);
    });

    it('submits with the selected language and caches under its own key', async () => {
        (jest.mocked(submissionService.submit) as jest.Mock).mockResolvedValueOnce({ success: true });

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined));

        act(() => {
            result.current.setLanguage('python');
        });
        act(() => {
            result.current.setCode('print("py")');
        });

        const mockEvent = { preventDefault: jest.fn() } as unknown as React.FormEvent<Element>;

        await act(async () => {
            await result.current.handleSubmit(mockEvent);
        });

        expect(submissionService.submit).toHaveBeenCalledWith({
            problemId: mockProblemId,
            language: 'python',
            code: 'print("py")'
        });

        const cache = JSON.parse(localStorage.getItem('oj-submission-cache'));
        expect(cache[`${mockProblemId}:python`].code).toBe('print("py")');
    });

    it('forces cpp for a header problem even if python is selected', async () => {
        (jest.mocked(submissionService.submit) as jest.Mock).mockResolvedValueOnce({ success: true });

        const { result } = renderHook(() => useCodeSubmission(mockProblemId, undefined, 'student.h'));

        act(() => {
            result.current.setLanguage('python');
        });
        act(() => {
            result.current.setCode('int f();');
        });

        expect(result.current.language).toBe('cpp');

        const mockEvent = { preventDefault: jest.fn() } as unknown as React.FormEvent<Element>;
        await act(async () => {
            await result.current.handleSubmit(mockEvent);
        });

        expect(submissionService.submit).toHaveBeenCalledWith({
            problemId: mockProblemId,
            language: 'cpp',
            code: 'int f();'
        });
    });
});
