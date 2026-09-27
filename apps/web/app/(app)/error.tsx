"use client";

import { EmptyBlock } from "@/components/ui";
import { AlertCircleIcon } from "@/components/icons";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="g-surface animate-fade-in">
      <EmptyBlock
        icon={<AlertCircleIcon size={22} className="text-rose-700" />}
        title="Something went wrong"
        description={error.message || "An unexpected error occurred."}
        action={
          <button onClick={reset} className="g-btn g-btn-primary h-10 px-4 text-sm">
            Try again
          </button>
        }
      />
    </div>
  );
}
