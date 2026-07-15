#!/usr/bin/env python3
"""
Post-deployment verification for host contact settings.

Reads the source-of-truth values (email, fetlife_handle) from the
`site_settings` singleton row, then asserts they appear correctly on:

  1. The public homepage's "Your host" block  (mailto:<email> +
     https://fetlife.com/<handle> links).
  2. The /admin/settings form fields (requires an admin login).

The admin browser check is skipped gracefully when ADMIN_EMAIL /
ADMIN_PASSWORD aren't provided, so this is safe to run in any CI stage.

Exit code:
  0  - every enabled check passed
  1  - one or more checks failed
  2  - configuration / setup problem (missing DB URL, etc.)

Env vars:
  BASE_URL          Public site URL. Default: https://princesspink90.lovable.app
  DATABASE_URL      Full Postgres URL to the Lovable Cloud database.
                    Or set PG* vars (PGHOST/PGUSER/PGPASSWORD/PGDATABASE).
  ADMIN_EMAIL       (optional) Admin account email for the admin-screen check.
  ADMIN_PASSWORD    (optional) Admin account password.
  SKIP_ADMIN=1      (optional) Force-skip the admin-screen check.
  SKIP_PUBLIC=1     (optional) Force-skip the public-homepage check.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


BASE_URL = os.environ.get("BASE_URL", "https://princesspink90.lovable.app").rstrip("/")
TIMEOUT_S = 20


# ---------------------------------------------------------------------------
# Reporting helpers
# ---------------------------------------------------------------------------

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
DIM = "\033[2m"
RESET = "\033[0m"


@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""


def log_pass(name: str, detail: str = "") -> Result:
    print(f"  {GREEN}✓{RESET} {name}" + (f"  {DIM}{detail}{RESET}" if detail else ""))
    return Result(name, True, detail)


def log_fail(name: str, detail: str) -> Result:
    print(f"  {RED}✗{RESET} {name}\n    {detail}")
    return Result(name, False, detail)


def log_skip(name: str, reason: str) -> Result:
    print(f"  {YELLOW}○{RESET} {name}  {DIM}(skipped: {reason}){RESET}")
    return Result(name + " (skipped)", True, reason)


# ---------------------------------------------------------------------------
# Source-of-truth from database
# ---------------------------------------------------------------------------

@dataclass
class Expected:
    email: str
    fetlife_handle: str


def load_expected_from_db() -> Expected:
    dsn = os.environ.get("DATABASE_URL")
    if dsn:
        conn = psycopg2.connect(dsn)
    else:
        # Fall back to standard PG* env vars. Supabase pooler requires TLS.
        conn = psycopg2.connect(sslmode=os.environ.get("PGSSLMODE", "require"))
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                "SELECT email, fetlife_handle FROM public.site_settings WHERE id = 'host'"
            )
            row = cur.fetchone()
            if row is None:
                raise RuntimeError(
                    "site_settings row id='host' not found — migrations may not have run."
                )
            email = (row["email"] or "").strip()
            fet = (row["fetlife_handle"] or "").strip()
            if not email or not fet:
                raise RuntimeError(
                    f"site_settings has blank values (email={email!r}, fetlife_handle={fet!r})"
                )
            return Expected(email=email, fetlife_handle=fet)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Check 1: public homepage renders the expected mailto + fetlife links
# ---------------------------------------------------------------------------

def check_public_homepage(exp: Expected) -> list[Result]:
    print(f"\nPublic homepage  {DIM}{BASE_URL}/{RESET}")
    if os.environ.get("SKIP_PUBLIC") == "1":
        return [log_skip("public host block", "SKIP_PUBLIC=1")]

    try:
        req = Request(BASE_URL + "/", headers={"User-Agent": "host-settings-verifier/1.0"})
        with urlopen(req, timeout=TIMEOUT_S) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except (URLError, HTTPError) as e:
        return [log_fail("fetch homepage", f"{type(e).__name__}: {e}")]

    results: list[Result] = []

    mailto = f"mailto:{exp.email}"
    if mailto in html:
        results.append(log_pass("email link", mailto))
    else:
        # Try to surface whatever mailto is currently rendered.
        found = re.findall(r'mailto:([^"\'\s<>]+)', html)
        results.append(log_fail(
            "email link",
            f"expected {mailto!r}; found mailto(s) in HTML: {found or '<none>'}",
        ))

    fet_url = f"https://fetlife.com/{exp.fetlife_handle}"
    if fet_url in html:
        results.append(log_pass("FetLife link", fet_url))
    else:
        found = re.findall(r'https?://(?:www\.)?fetlife\.com/[A-Za-z0-9_\-]+', html)
        results.append(log_fail(
            "FetLife link",
            f"expected {fet_url!r}; found FetLife URL(s) in HTML: {found or '<none>'}",
        ))

    return results


# ---------------------------------------------------------------------------
# Check 2: /admin/settings renders the same values in its form fields
# ---------------------------------------------------------------------------

async def check_admin_settings(exp: Expected) -> list[Result]:
    print(f"\nAdmin settings   {DIM}{BASE_URL}/admin/settings{RESET}")

    if os.environ.get("SKIP_ADMIN") == "1":
        return [log_skip("admin form fields", "SKIP_ADMIN=1")]

    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        return [log_skip(
            "admin form fields",
            "ADMIN_EMAIL / ADMIN_PASSWORD not set",
        )]

    try:
        from playwright.async_api import async_playwright  # type: ignore
    except ImportError:
        return [log_skip(
            "admin form fields",
            "playwright not installed (pip install playwright && playwright install chromium)",
        )]

    results: list[Result] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        try:
            # Sign in.
            await page.goto(f"{BASE_URL}/auth", wait_until="domcontentloaded")
            await page.get_by_label(re.compile("email", re.I)).first.fill(admin_email)
            await page.get_by_label(re.compile("password", re.I)).first.fill(admin_password)
            await page.get_by_role("button", name=re.compile("sign in|log in", re.I)).first.click()
            # Wait until we're off /auth OR a session token exists.
            await page.wait_for_function(
                "() => !location.pathname.startsWith('/auth')",
                timeout=15_000,
            )

            # Navigate to the admin settings page.
            await page.goto(f"{BASE_URL}/admin/settings", wait_until="domcontentloaded")
            # Form fields hydrate once the site-settings query resolves.
            await page.wait_for_selector('input[type="email"]', timeout=15_000)

            # Read what's actually in the inputs after hydration.
            actual_email = await page.eval_on_selector(
                'input[type="email"]', "el => el.value"
            )
            # The FetLife input is the second free-form text input (email is first).
            # Grab all text-ish inputs and find one whose value normalizes to the handle.
            values = await page.eval_on_selector_all(
                'input:not([type="checkbox"]):not([type="number"]):not([type="time"]):not([type="date"]):not([type="search"])',
                "els => els.map(e => e.value)",
            )
            actual_fetlife: Optional[str] = None
            for v in values:
                if v and v.strip() == exp.fetlife_handle:
                    actual_fetlife = v.strip()
                    break
            if actual_fetlife is None:
                # Fall back to whatever came second so the failure message is useful.
                actual_fetlife = values[1].strip() if len(values) > 1 else "<not found>"

            if (actual_email or "").strip() == exp.email:
                results.append(log_pass("email field", actual_email))
            else:
                results.append(log_fail(
                    "email field",
                    f"expected {exp.email!r}; form shows {actual_email!r}",
                ))

            if actual_fetlife == exp.fetlife_handle:
                results.append(log_pass("FetLife field", actual_fetlife))
            else:
                results.append(log_fail(
                    "FetLife field",
                    f"expected {exp.fetlife_handle!r}; form shows {actual_fetlife!r}",
                ))
        except Exception as e:  # noqa: BLE001
            results.append(log_fail(
                "admin form fields",
                f"{type(e).__name__}: {e}",
            ))
        finally:
            await browser.close()

    return results


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main() -> int:
    print(f"Host settings verification\n  base URL: {BASE_URL}")
    try:
        expected = load_expected_from_db()
    except Exception as e:  # noqa: BLE001
        print(f"{RED}config error:{RESET} {e}", file=sys.stderr)
        return 2

    print(f"  expected email:    {expected.email}")
    print(f"  expected FetLife:  {expected.fetlife_handle}")

    results: list[Result] = []
    results.extend(check_public_homepage(expected))
    results.extend(await check_admin_settings(expected))

    failed = [r for r in results if not r.ok]
    print()
    if failed:
        print(f"{RED}FAIL{RESET}  {len(failed)} of {len(results)} checks failed")
        return 1
    print(f"{GREEN}PASS{RESET}  {len(results)} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
