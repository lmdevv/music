#!/usr/bin/env bash
# Runs the suites that need a live backend, each against a fresh self-hosted Convex of its own
# (scripts/dev-backend.sh), since each signs up the first user and expects to be its admin:
#
#   - packages/backend/test/security.e2e.test.ts  authorization against the real backend
#   - apps/cli/src/e2e.test.ts                    the built `music` binary
#   - apps/media/src/media.e2e.test.ts            the media service's scan and signed streams
#   - apps/web/e2e (Playwright, pnpm test:e2e)    the web app
#
# A suite that skips any test fails the run: without its environment a suite skips itself, and
# CI would pass without testing anything.
#
#   scripts/backend-e2e.sh                       # every suite
#   scripts/backend-e2e.sh security cli          # some of them
#
# Env: BASE_PORT (default 3810): the suites' backends use BASE_PORT, +10, +20, and +30, each also
# taking the next port for HTTP actions and port + 890 for a media service. WEB_PORT and
# E2E_PORT (default 3002) for the Playwright suite's web server, CHROMIUM_PATH for its browser,
# KEEP=1 to leave the backends running.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
base="${BASE_PORT:-3810}"
e2e_port="${E2E_PORT:-3002}"
suites=("$@")
[[ ${#suites[@]} -gt 0 ]] || suites=(security cli media web)
started=()
results="$(mktemp -d)"

cleanup() {
  if [[ "${KEEP:-0}" != "1" ]]; then
    for name in "${started[@]}"; do
      "$root/scripts/dev-backend.sh" stop "$name" >/dev/null 2>&1 || true
      docker volume rm "music-convex-${name}-data" >/dev/null 2>&1 || true
    done
  fi
  rm -rf "$results"
}
trap cleanup EXIT

# Starts an empty backend called e2e-$1 on port $2 and points the .env.local files at it.
fresh_backend() {
  local name="e2e-$1"
  "$root/scripts/dev-backend.sh" stop "$name" >/dev/null 2>&1 || true
  docker volume rm "music-convex-${name}-data" >/dev/null 2>&1 || true
  started+=("$name")
  WEB_PORT="$e2e_port" "$root/scripts/dev-backend.sh" "$name" "$2"
}

convex_env() { (cd "$root/packages/backend" && pnpm exec convex env get "$1"); }

# Runs one Vitest file and fails if any of its tests did not run.
vitest_all() {
  local report
  report="$results/$(basename "$1").json"
  (cd "$root" && pnpm exec vitest run "$1" --reporter=default --reporter=json --outputFile="$report")
  node -e '
    const report = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const skipped = report.testResults.flatMap((file) =>
      file.assertionResults.filter((test) => test.status !== "passed").map((test) => test.fullName));
    if (report.numPassedTests === 0 || skipped.length > 0) {
      console.error(`${process.argv[2]}: ${report.numPassedTests} passed; did not run: ${skipped.join("; ")}`);
      process.exit(1);
    }
  ' "$report" "$1"
}

for suite in "${suites[@]}"; do
  echo "::group::$suite"
  case "$suite" in
    security)
      fresh_backend security "$base"
      MUSIC_SECURITY_E2E_SERVER="http://127.0.0.1:${base}" \
        MUSIC_SECURITY_E2E_MEDIA_SECRET="$(convex_env MEDIA_SERVICE_SECRET)" \
        vitest_all packages/backend/test/security.e2e.test.ts
      ;;
    cli)
      fresh_backend cli "$((base + 10))"
      MUSIC_E2E_SERVER="http://127.0.0.1:$((base + 10))" \
        MUSIC_E2E_MEDIA_SECRET="$(convex_env MEDIA_SERVICE_SECRET)" \
        vitest_all apps/cli/src/e2e.test.ts
      ;;
    media)
      fresh_backend media "$((base + 20))"
      MEDIA_E2E_CONVEX_URL="http://127.0.0.1:$((base + 20))" \
        MEDIA_E2E_SERVICE_SECRET="$(convex_env MEDIA_SERVICE_SECRET)" \
        MEDIA_E2E_SIGNING_KEY="$(convex_env STREAM_SIGNING_KEY)" \
        vitest_all apps/media/src/media.e2e.test.ts
      ;;
    web)
      # The Playwright suite and its seed script read the backend from the .env.local files
      # dev-backend.sh writes, and 01-setup.spec.ts needs an empty backend.
      fresh_backend web "$((base + 30))"
      (cd "$root" && E2E_PORT="$e2e_port" pnpm --filter web exec playwright test)
      ;;
    *)
      echo "unknown suite $suite; expected security, cli, media, or web" >&2
      exit 2
      ;;
  esac
  echo "::endgroup::"
done
