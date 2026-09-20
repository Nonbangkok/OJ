import {
    publishRealtime,
    subscribeRealtime,
    type RealtimeEvent,
} from '../../services/realtimeHub';

const submissionEvent = (overrides: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
    type: 'submission_update',
    submissionId: 1,
    table: 'submissions',
    overall_status: 'Running',
    score: 0,
    user_id: 42,
    ...overrides,
} as RealtimeEvent);

describe('realtimeHub', () => {
    // Listener sets are module state; drain between tests so ordering
    // assertions stay local.
    const unsubscribers: Array<() => void> = [];
    const track = (listener: (event: RealtimeEvent) => void): ((event: RealtimeEvent) => void) => {
        const wrapped = (event: RealtimeEvent) => listener(event);
        unsubscribers.push(subscribeRealtime(wrapped));
        return wrapped;
    };
    afterEach(() => {
        while (unsubscribers.length > 0) {
            unsubscribers.pop()!();
        }
    });

    it('delivers a published event to all subscribed listeners', () => {
        const first = jest.fn();
        const second = jest.fn();
        track(first);
        track(second);

        const event = submissionEvent({ submissionId: 7, overall_status: 'Accepted', score: 100 });
        publishRealtime(event);

        expect(first).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledWith(event);
        expect(second).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledWith(event);
    });

    it('does not throw when a listener throws; other listeners still receive the event', () => {
        const broken = jest.fn(() => {
            throw new Error('listener exploded');
        });
        const healthy = jest.fn();
        track(broken);
        track(healthy);

        expect(() => publishRealtime(submissionEvent())).not.toThrow();

        expect(broken).toHaveBeenCalledTimes(1);
        expect(healthy).toHaveBeenCalledTimes(1);
    });

    it('stops delivering events after the unsubscribe function is called', () => {
        const listener = jest.fn();
        const unsubscribe = subscribeRealtime(listener);
        unsubscribe();
        unsubscribe(); // idempotent / no throw on double-unsubscribe

        publishRealtime(submissionEvent());

        expect(listener).not.toHaveBeenCalled();
    });

    it('keeps delivering to remaining listeners after one unsubscribes', () => {
        const gone = jest.fn();
        const stays = jest.fn();
        const unsubscribeGone = subscribeRealtime(gone);
        track(stays);

        unsubscribeGone();
        publishRealtime(submissionEvent());

        expect(gone).not.toHaveBeenCalled();
        expect(stays).toHaveBeenCalledTimes(1);
    });

    it('supports scoreboard_update events', () => {
        const listener = jest.fn();
        track(listener);

        publishRealtime({ type: 'scoreboard_update', contestId: 5 });

        expect(listener).toHaveBeenCalledWith({ type: 'scoreboard_update', contestId: 5 });
    });
});
