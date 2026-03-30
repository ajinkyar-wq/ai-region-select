import { useState, useEffect } from 'react';

// Shared module-level state so all callers see the same values
let sharedHasCompleted = false;
let sharedIsWaveStopped = false;
let sharedStopWaveCount = 0;
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach(fn => fn());
}

export type WalkthroughStep = 0 | 1 | 2 | 3 | 4;

export function useWalkthrough() {
    const [, rerender] = useState(0);

    useEffect(() => {
        const fn = () => rerender(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);

    const stopWave = () => {
        sharedIsWaveStopped = true;
        sharedStopWaveCount++;
        notify();
    };

    const completeWalkthrough = () => {
        sharedHasCompleted = true;
        sharedIsWaveStopped = false;
        notify();
    };

    const resetWalkthrough = () => {
        sharedHasCompleted = false;
        sharedIsWaveStopped = false;
        sharedStopWaveCount = 0;
        notify();
    };

    // advanceStep kept for compat — not used in simplified flow
    const advanceStep = () => { /* no-op in simplified flow */ };

    return {
        isWalkthroughActive: !sharedHasCompleted,
        isWaveStopped: sharedIsWaveStopped,
        stopWaveCount: sharedStopWaveCount,
        walkthroughStep: 0 as WalkthroughStep,
        stopWave,
        advanceStep,
        completeWalkthrough,
        resetWalkthrough,
    };
}
