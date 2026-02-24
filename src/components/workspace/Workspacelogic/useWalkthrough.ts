import { useState, useCallback } from 'react';

// Walkthrough state is per image session.
// It resets automatically when a new image URL is provided to ImageCanvas.
// We keep this simple - no localStorage needed since it should show every time.

export function useWalkthrough() {
    const [hasCompletedWalkthrough, setHasCompletedWalkthrough] = useState(false);

    const completeWalkthrough = useCallback(() => {
        setHasCompletedWalkthrough(true);
    }, []);

    const resetWalkthrough = useCallback(() => {
        setHasCompletedWalkthrough(false);
    }, []);

    return {
        isWalkthroughActive: !hasCompletedWalkthrough,
        completeWalkthrough,
        resetWalkthrough,
    };
}
