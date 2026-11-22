// teacher-web/src/lib/printEngine/cancel.ts

/**
 * Thrown when an in-progress PDF export is cancelled by the teacher.
 */
export class ExportCancelledError extends Error {
    readonly isExportCancelled = true;

    constructor(message: string = 'Export cancelled by user.') {
        super(message);
        this.name = 'ExportCancelledError';
    }
}

/**
 * Type guard to identify cooperative export cancellations so callers
 * can dismiss loading UI cleanly without showing an error alert.
 */
export function isExportCancelledError(err: unknown): boolean {
    if (!err) return false;
    if (err instanceof ExportCancelledError) return true;
    if (typeof err === 'object') {
        const candidate = err as { name?: string; isExportCancelled?: boolean };
        return (
            candidate.isExportCancelled === true ||
            candidate.name === 'ExportCancelledError' ||
            candidate.name === 'AbortError'
        );
    }
    return false;
}

/**
 * Throws ExportCancelledError immediately if the provided AbortSignal has been aborted.
 */
export function throwIfExportAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new ExportCancelledError();
    }
}

/**
 * Promise-based delay that rejects immediately with ExportCancelledError if signal aborts.
 */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.reject(new ExportCancelledError());
    }

    return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(new ExportCancelledError());
        };

        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}
