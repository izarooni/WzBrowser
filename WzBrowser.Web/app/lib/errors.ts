/** What went wrong, for a toast or an error line: an Error's message, or the thrown value as text. */
export function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
