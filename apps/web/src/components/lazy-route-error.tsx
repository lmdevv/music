import { CatchBoundary } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { ChunkLoadError, lazyChunk } from "@/lib/lazy-chunk";

// Not TanStack's `lazyRouteComponent`: on a missing module it reloads the page, which stops the
// music and, offline, lands on the browser's error page instead of this app's.
const RouteError = lazyChunk(async () => (await import("./route-error")).RouteError).Component;

const PageNotFound = lazyChunk(async () => (await import("./route-error")).PageNotFound).Component;

/**
 * Shown when the error screen itself fails: its code can't load (offline, or the server was upgraded
 * under an open tab), or it threw. Plain markup, so it needs nothing beyond the entry chunk. It says
 * which happened, and it never rethrows: above the root route's error screen nothing would catch it,
 * and the whole app (and the music) would go.
 */
function Unloaded({ error }: ErrorComponentProps): ReactNode {
  const unreachable = error instanceof ChunkLoadError;

  return (
    <div className="flex min-h-dvh-message flex-col items-start justify-center gap-3 px-6 lg:px-12">
      <h1 className="font-sans text-xl/xl font-heavy tracking-tight text-text">
        This screen didn't load
      </h1>
      <p className="max-w-dialog font-sans text-md/md text-text-muted">
        {unreachable
          ? "[music] can't reach the server. Check the connection, then reload the page."
          : "Something went wrong showing what happened. Reload the page to try again."}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="font-sans text-md/md font-semibold text-accent underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Reload
      </button>
    </div>
  );
}

/**
 * The error screen, loaded on demand so it stays out of the entry chunk. If it fails too, a plain
 * message takes its place instead of a blank page; a new error tries the chunk again.
 */
export function LazyRouteError(props: ErrorComponentProps) {
  return (
    <CatchBoundary getResetKey={() => props.error} errorComponent={Unloaded}>
      <Suspense fallback={null}>
        <RouteError {...props} />
      </Suspense>
    </CatchBoundary>
  );
}

/**
 * The not-found screen, loaded on demand like {@link LazyRouteError}. Showing it again after
 * another screen tries the chunk again.
 */
export function LazyPageNotFound() {
  return (
    <CatchBoundary getResetKey={() => 0} errorComponent={Unloaded}>
      <Suspense fallback={null}>
        <PageNotFound />
      </Suspense>
    </CatchBoundary>
  );
}
