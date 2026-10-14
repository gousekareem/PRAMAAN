import { Link } from 'react-router-dom';
export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-3 inline-block text-sm text-ink-700 underline">
        Back to overview
      </Link>
    </div>
  );
}
