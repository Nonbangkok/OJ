import {
    isRealtimeSupported,
    subscribeSubmissions,
    subscribeScoreboard,
    type SubmissionUpdatePayload,
    type ScoreboardUpdatePayload,
} from '../../services/realtimeService';

/**
 * Minimal EventSource stand-in. jsdom does not implement EventSource, so the
 * service test installs this per test and drives it by hand.
 */
type EventListener = (event: { data: string }) => void;

class MockEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;

    static instances: MockEventSource[] = [];

    url: string;
    readyState = MockEventSource.CONNECTING;
    onerror: (() => void) | null = null;
    closed = false;
    private listeners = new Map<string, EventListener[]>();

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: EventListener): void {
        const existing = this.listeners.get(type) ?? [];
        existing.push(listener);
        this.listeners.set(type, existing);
    }

    close(): void {
        this.closed = true;
        this.readyState = MockEventSource.CLOSED;
    }

    // --- test helpers ---

    open(): void {
        this.readyState = MockEventSource.OPEN;
    }

    emit(type: string, data: unknown): void {
        this.open();
        for (const listener of this.listeners.get(type) ?? []) {
            listener({ data: JSON.stringify(data) });
        }
    }

    fail(): void {
        this.readyState = MockEventSource.CLOSED;
        this.onerror?.();
    }
}

describe('realtimeService', () => {
    const originalEventSource = (global as { EventSource?: unknown }).EventSource;

    const install = (): void => {
        MockEventSource.instances = [];
        (global as { EventSource?: unknown }).EventSource = MockEventSource;
    };

    const uninstall = (): void => {
        (global as { EventSource?: unknown }).EventSource = originalEventSource;
    };

    afterEach(() => {
        uninstall();
    });

    describe('isRealtimeSupported', () => {
        it('reports support when EventSource exists', () => {
            install();
            expect(isRealtimeSupported()).toBe(true);
        });

        it('reports no support when EventSource is missing', () => {
            uninstall();
            (global as { EventSource?: unknown }).EventSource = undefined;
            expect(isRealtimeSupported()).toBe(false);
        });
    });

    describe('subscribeSubmissions', () => {
        it('opens an EventSource on the realtime submissions endpoint', () => {
            install();

            subscribeSubmissions(jest.fn());

            expect(MockEventSource.instances).toHaveLength(1);
            expect(MockEventSource.instances[0].url).toBe('/api/realtime/submissions');
        });

        it('delivers parsed submission_update payloads to the callback', () => {
            install();
            const onUpdate = jest.fn();

            subscribeSubmissions(onUpdate);
            const source = MockEventSource.instances[0];

            const payload: SubmissionUpdatePayload = {
                type: 'submission_update',
                submissionId: 5,
                table: 'submissions',
                overall_status: 'Accepted',
                score: 100,
                user_id: 42,
            };
            source.emit('submission_update', payload);

            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledWith(payload);
        });

        it('notifies onStreamDown when the connection closes for good', () => {
            install();
            const onStreamDown = jest.fn();

            subscribeSubmissions(jest.fn(), { onStreamDown });
            const source = MockEventSource.instances[0];

            source.fail();
            expect(onStreamDown).toHaveBeenCalledTimes(1);
        });

        it('does not notify onStreamDown while the browser is still retrying', () => {
            install();
            const onStreamDown = jest.fn();

            subscribeSubmissions(jest.fn(), { onStreamDown });
            const source = MockEventSource.instances[0];

            // Transient network drop: readyState stays CONNECTING (native retry).
            source.readyState = MockEventSource.CONNECTING;
            source.onerror?.();
            expect(onStreamDown).not.toHaveBeenCalled();
        });

        it('closes the EventSource when the unsubscribe function is called', () => {
            install();

            const unsubscribe = subscribeSubmissions(jest.fn());
            const source = MockEventSource.instances[0];
            expect(source.closed).toBe(false);

            unsubscribe();

            expect(source.closed).toBe(true);
        });

        it('returns a no-op unsubscribe and reports down when EventSource is unavailable', () => {
            (global as { EventSource?: unknown }).EventSource = undefined;
            const onStreamDown = jest.fn();

            const unsubscribe = subscribeSubmissions(jest.fn(), { onStreamDown });

            expect(onStreamDown).toHaveBeenCalledTimes(1);
            expect(() => unsubscribe()).not.toThrow();
        });
    });

    describe('subscribeScoreboard', () => {
        it('opens an EventSource scoped to the contest', () => {
            install();

            subscribeScoreboard('7', jest.fn());

            expect(MockEventSource.instances).toHaveLength(1);
            expect(MockEventSource.instances[0].url).toBe('/api/realtime/contests/7');
        });

        it('delivers parsed scoreboard_update payloads to the callback', () => {
            install();
            const onUpdate = jest.fn();

            subscribeScoreboard('7', onUpdate);
            const source = MockEventSource.instances[0];

            const payload: ScoreboardUpdatePayload = {
                type: 'scoreboard_update',
                contestId: 7,
            };
            source.emit('scoreboard_update', payload);

            expect(onUpdate).toHaveBeenCalledWith(payload);
        });

        it('ignores unrelated event names', () => {
            install();
            const onUpdate = jest.fn();

            subscribeScoreboard('7', onUpdate);
            const source = MockEventSource.instances[0];

            source.emit('some_other_event', { contestId: 7 });

            expect(onUpdate).not.toHaveBeenCalled();
        });

        it('notifies onStreamDown when the connection closes for good', () => {
            install();
            const onStreamDown = jest.fn();

            subscribeScoreboard('7', jest.fn(), { onStreamDown });
            const source = MockEventSource.instances[0];

            source.fail();
            expect(onStreamDown).toHaveBeenCalledTimes(1);
        });

        it('closes the EventSource when the unsubscribe function is called', () => {
            install();

            const unsubscribe = subscribeScoreboard('7', jest.fn());
            const source = MockEventSource.instances[0];

            unsubscribe();

            expect(source.closed).toBe(true);
        });
    });
});
