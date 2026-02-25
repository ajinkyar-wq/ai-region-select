import { useState, useCallback } from 'react';

export function useWalkthrough() {
    const [hasCompletedWalkthrough, setHasCompletedWalkthrough] = useState(false);
    const [isWaveStopped, setIsWaveStopped] = useState(false);

    const stopWave = useCallback(() => {
        setIsWaveStopped(true);
    }, []);

    const completeWalkthrough = useCallback(() => {
        setHasCompletedWalkthrough(true);
        setIsWaveStopped(false);
    }, []);

    const resetWalkthrough = useCallback(() => {
        setHasCompletedWalkthrough(false);
        setIsWaveStopped(false);
    }, []);

    return {
        isWalkthroughActive: !hasCompletedWalkthrough,
        isWaveStopped,
        stopWave,
        completeWalkthrough,
        resetWalkthrough,
    };
}
