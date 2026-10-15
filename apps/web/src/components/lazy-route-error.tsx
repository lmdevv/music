import { CatchBoundary, lazyRouteComponent } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Suspense } from "react";

const loadRouteError = () => import("./route-error");

const RouteError = lazyRouteComponent(loadRouteError, "RouteError");

const PageNotFound = lazyRouteComponent(loadRouteError, "PageNotFound");

/**
 * Shown when the error screen's own code can't load: offline, or the server was upgraded under an
 * open tab. Plain markup, so it needs nothing beyond the entry chunk.
 */
function Unloaded() {
  return (
    <div className="flex min-h-dvh-message flex-col items-start justify-center gap-3 px-6 lg:px-12">
      <h1 className="font-sans text-xl/xl font-heavy tracking-tight text-text">
        This screen didn't load
      </h1>
      <p className="max-w-dialog font-sans text-md/md text-text-muted">
        [music] can't reach the server. Check the connection, then reload the page.
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
 * The error screen, loaded on demand so it stays out of the entry chunk. If its chunk can't load
 * either, a plain message takes its place instead of a blank page.
 */
export function LazyRouteError(props: ErrorComponentProps) {
  return (
    <CatchBoundary getResetKey={() => 0} errorComponent={Unloaded}>
      <Suspense fallback={null}>
        <RouteError {...props} />
      </Suspense>
    </CatchBoundary>
  );
}

/** The not-found screen, loaded on demand like {@link LazyRouteError}. */
export function LazyPageNotFound() {
  return (
    <CatchBoundary getResetKey={() => 0} errorComponent={Unloaded}>
      <Suspense fallback={null}>
        <PageNotFound />
      </Suspense>
    </CatchBoundary>
  );
}
