export const COPYRIGHT_NOTICE = '© 2026 SHAIK GOUSE KAREEM. All Rights Reserved.';
export const DEVELOPER_NAME = 'SHAIK GOUSE KAREEM';
export const DEVELOPER_LINKEDIN = 'https://www.linkedin.com/in/gousekareem/';

/**
 * Shared footer rendered once by AppLayout (and on the sign-in page), so every dashboard
 * route shows the same copyright notice and developer attribution.
 */
export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-paper-200 bg-paper-50" aria-label="Site footer">
      <div className="mx-auto flex max-w-7xl flex-col gap-1.5 px-4 py-4 text-xs text-ink-700 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{COPYRIGHT_NOTICE}</p>
        <p>
          <a
            href={DEVELOPER_LINKEDIN}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink-800 underline decoration-paper-200 underline-offset-4 hover:text-ink-600 hover:decoration-ink-600 focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-600"
          >
            Developed by {DEVELOPER_NAME}
            <span className="text-ink-600"> · LinkedIn </span>
            <span aria-hidden="true">↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </div>
      <p className="mx-auto max-w-7xl px-4 pb-4 text-[11px] leading-snug text-ink-600 sm:px-6">
        Academic capstone prototype. Not commissioned, endorsed or operated by Guntur Railway Police
        or any government authority.
      </p>
    </footer>
  );
}
