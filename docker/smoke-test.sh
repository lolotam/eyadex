#!/bin/sh
# Smoke test for a deployed Eyadex environment (ADR-0021, docs/specs/staging-runbook.md).
# Usage:  sh docker/smoke-test.sh <clinic host> <platform host>
#   e.g.  sh docker/smoke-test.sh staging-app.eyadex.com staging-platform.eyadex.com
# Needs curl. Sends anonymous GETs only: no credentials, no cookies, nothing is written.
# SCHEME (default https) and WEB_MODE (default http; `mock` skips the web anti-framing check, which
# only an http build sends) may be set in the environment.
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: sh docker/smoke-test.sh <clinic host> <platform host>" >&2
  exit 2
fi
app="$1"
platform="$2"
scheme="${SCHEME:-https}"
web_mode="${WEB_MODE:-http}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0

pass() { echo "PASS  $1"; }
fail() {
  echo "FAIL  $1" >&2
  failures=$((failures + 1))
}

# fetch <host> <path>: the status code on stdout; headers and body kept in $work for the checks below.
fetch() {
  curl -sS -m 20 -o "$work/body" -D "$work/headers" -w '%{http_code}' "$scheme://$1$2" 2>"$work/err" ||
    echo "000"
}

expect_status() { # <label> <host> <path> <status> [envelope code]
  got=$(fetch "$2" "$3")
  if [ "$got" != "$4" ]; then
    fail "$1: $2$3 answered $got, expected $4"
    return
  fi
  if [ "$#" -ge 5 ] && ! grep -q "\"code\":\"$5\"" "$work/body"; then
    fail "$1: $2$3 answered $4 without the \"$5\" envelope"
    return
  fi
  pass "$1: $2$3 → $4${5:+ $5}"
}

expect_header() { # <label> <header name> <value fragment>; reads the last fetch
  if grep -i "^$2:" "$work/headers" | grep -qi -- "$3"; then
    pass "$1: $2 has $3"
  else
    fail "$1: $2 missing or without $3"
  fi
}

echo "== web pages (both hosts serve the one web build)"
for host in "$app" "$platform"; do
  expect_status "web" "$host" "/" 200
  expect_status "web" "$host" "/login" 200
  expect_header "web headers ($host)" "x-content-type-options" "nosniff"
  expect_header "web headers ($host)" "referrer-policy" "strict-origin-when-cross-origin"
  expect_header "web headers ($host)" "x-robots-tag" "noindex"
  if [ "$web_mode" != "mock" ]; then
    expect_header "web headers ($host)" "x-frame-options" "DENY"
    expect_header "web headers ($host)" "content-security-policy" "frame-ancestors 'none'"
  fi
done

echo "== api health (the proxy strips /api on both hosts)"
for host in "$app" "$platform"; do
  expect_status "health" "$host" "/api/v1/health" 200
  if grep -q '"status":"ok"' "$work/body"; then pass "health body ($host)"; else fail "health body ($host)"; fi
  expect_header "api headers ($host)" "x-content-type-options" "nosniff"
  expect_header "api headers ($host)" "x-frame-options" "DENY"
  expect_header "api headers ($host)" "cache-control" "no-store"
  expect_header "api headers ($host)" "referrer-policy" "no-referrer"
done

echo "== protected routes without a session"
expect_status "clinic route" "$app" "/api/v1/me" 401 unauthorized
expect_status "platform route" "$platform" "/api/v1/platform/clinics" 401 unauthorized

echo "== each area's routes stay on its own host"
expect_status "platform route on the clinic host" "$app" "/api/v1/platform/clinics" 404 not_found
expect_status "clinic route on the platform host" "$platform" "/api/v1/me" 404 not_found
expect_status "unlisted auth route" "$app" "/api/auth/list-sessions" 404 not_found

if [ "$failures" -gt 0 ]; then
  echo "smoke test: $failures check(s) failed" >&2
  exit 1
fi
echo "smoke test: all checks passed"
