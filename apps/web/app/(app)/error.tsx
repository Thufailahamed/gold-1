"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
      <p className="font-medium text-red-800">Something went wrong</p>
      <p className="mt-1 text-sm text-red-600">{error.message || "An unexpected error occurred."}</p>
      <button
        onClick={reset}
        className="mt-4 rounded-md bg-stone-900 px-4 py-2 text-sm text-white"
      >
        Try again
      </button>
    </div>
  );
}
