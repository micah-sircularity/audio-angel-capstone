"""Minimal port of convex/lib/safeFetch.ts.

HTTPS only, no IP literals / localhost / internal suffixes / userinfo /
non-default ports. Redirects are followed manually and every hop is
revalidated. Bodies are size-capped.
"""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import urljoin, urlparse

import httpx

_DEFAULT_TIMEOUT = 15.0
_MAX_HOPS = 4
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
_PRIVATE_SUFFIXES = (".localhost", ".local", ".internal", ".lan")
_IPV4_LITERAL = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


class SafeFetchError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _is_ip_literal(hostname: str) -> bool:
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return True


def assert_safe_url(raw: str) -> str:
    """Validate a user-supplied URL; returns it unchanged when safe."""
    try:
        url = urlparse(raw)
    except Exception as exc:
        raise SafeFetchError("not-https", f"Invalid URL: {raw[:120]}") from exc
    if url.scheme != "https":
        raise SafeFetchError(
            "not-https", f"Only https: URLs are allowed (got {url.scheme or 'none'})"
        )
    hostname = (url.hostname or "").lower()
    if not hostname:
        raise SafeFetchError("private-host", "URL has no host")
    if (
        _IPV4_LITERAL.match(hostname)
        or ":" in hostname
        or hostname == "localhost"
        or hostname.endswith(_PRIVATE_SUFFIXES)
        or _is_ip_literal(hostname)
    ):
        raise SafeFetchError("private-host", f"Host {hostname} is not allowed")
    if url.username or url.password:
        raise SafeFetchError("private-host", "URLs with credentials are not allowed")
    if url.port is not None and url.port != 443:
        raise SafeFetchError("private-host", f"Port {url.port} is not allowed")
    return raw


async def _stream_body(
    res: httpx.Response, max_bytes: int, *, truncate: bool = False
) -> bytes:
    """Read the body under max_bytes; with truncate, return the first
    max_bytes instead of failing (used for podcast audio prefixes)."""
    declared = res.headers.get("content-length")
    if not truncate and declared and declared.isdigit() and int(declared) > max_bytes:
        raise SafeFetchError(
            "too-large",
            f"Response is {declared} bytes, over the {max_bytes} byte cap",
        )
    chunks: list[bytes] = []
    total = 0
    async for chunk in res.aiter_bytes():
        if total + len(chunk) > max_bytes:
            if truncate:
                chunks.append(chunk[: max_bytes - total])
                break
            raise SafeFetchError(
                "too-large", f"Response body exceeded {max_bytes} bytes"
            )
        total += len(chunk)
        chunks.append(chunk)
    return b"".join(chunks)


async def _get(
    url: str,
    *,
    client: httpx.AsyncClient,
    max_bytes: int,
    timeout: float,
    truncate: bool = False,
) -> bytes:
    current = assert_safe_url(url)
    for hop in range(_MAX_HOPS + 1):
        try:
            async with client.stream(
                "GET", current, timeout=timeout, follow_redirects=False
            ) as res:
                if res.status_code in _REDIRECT_STATUSES:
                    if hop >= _MAX_HOPS:
                        raise SafeFetchError(
                            "bad-redirect",
                            f"Too many redirects fetching {url[:120]}",
                        )
                    location = res.headers.get("location")
                    if not location:
                        raise SafeFetchError(
                            "bad-redirect",
                            "Redirect response had no Location header",
                        )
                    try:
                        current = assert_safe_url(urljoin(current, location))
                    except SafeFetchError as exc:
                        raise SafeFetchError(
                            "bad-redirect",
                            f"Redirect target was rejected: {exc}",
                        ) from exc
                    continue
                if res.status_code >= 400:
                    raise SafeFetchError(
                        "http-error",
                        f"HTTP {res.status_code} from {current[:120]}",
                    )
                return await _stream_body(res, max_bytes, truncate=truncate)
        except httpx.TimeoutException as exc:
            raise SafeFetchError(
                "timeout", f"Request to {current[:120]} timed out"
            ) from exc
        except httpx.HTTPError as exc:
            raise SafeFetchError("http-error", f"Request failed: {exc}") from exc
    raise SafeFetchError("bad-redirect", f"Too many redirects fetching {url[:120]}")


async def fetch_text(
    url: str,
    *,
    client: httpx.AsyncClient,
    max_bytes: int = 1_048_576,
    timeout: float = _DEFAULT_TIMEOUT,
) -> str:
    """GET a validated URL and return the body as text under max_bytes."""
    body = await _get(url, client=client, max_bytes=max_bytes, timeout=timeout)
    return body.decode("utf-8", errors="replace")


async def fetch_bytes(
    url: str,
    *,
    client: httpx.AsyncClient,
    max_bytes: int = 50 * 1024 * 1024,
    timeout: float = 60.0,
    truncate: bool = False,
) -> bytes:
    """GET a validated URL and return raw bytes under max_bytes.

    With truncate=True, a larger body is cut at max_bytes instead of
    rejected (enough for a trimmed podcast clip).
    """
    return await _get(
        url, client=client, max_bytes=max_bytes, timeout=timeout, truncate=truncate
    )
