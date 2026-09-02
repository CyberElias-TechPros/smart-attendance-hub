import { AlertTriangle, RefreshCw, WifiOff, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

import { ApiClientError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./EmptyState";
import { InlineLoader } from "./Loaders";

/**
 * Renders the correct state for an async view: loading, a typed error with a
 * retry affordance, an empty state, or the data. Previously each screen handled
 * (or more often ignored) these cases individually.
 */
export function QueryBoundary<T>({
  isLoading,
  error,
  data,
  onRetry,
  loadingLabel,
  isEmpty,
  empty,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  data: T | undefined;
  onRetry?: () => void;
  loadingLabel?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (isLoading) return <InlineLoader label={loadingLabel} />;

  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  if (data === undefined) return <ErrorState error={new Error("No data")} onRetry={onRetry} />;

  if (isEmpty?.(data) && empty) return <>{empty}</>;

  return <>{children(data)}</>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof ApiClientError ? error : null;

  const isOffline = api?.code === "NETWORK_ERROR";
  const isPermission = api?.code === "FORBIDDEN" || api?.code === "UNAUTHENTICATED";

  const icon = isOffline ? (
    <WifiOff className="h-7 w-7" />
  ) : isPermission ? (
    <ShieldAlert className="h-7 w-7" />
  ) : (
    <AlertTriangle className="h-7 w-7" />
  );

  const title = isOffline
    ? "You appear to be offline"
    : isPermission
      ? "You don't have access to this"
      : "We couldn't load this";

  const description =
    api?.message ??
    (error instanceof Error ? error.message : "An unexpected error occurred.");

  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={
        onRetry && !isPermission ? (
          <Button onClick={onRetry} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}
