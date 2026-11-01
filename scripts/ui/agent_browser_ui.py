#!/usr/bin/env python3
"""Reusable agent-browser base library for UI automation testing.

Copy this file into a project and build app-specific navigation and assertions
on top of it. The defaults are tuned for the published Cargo build of
`agent-browser`, where direct route opens and `snapshot -i` are more reliable
than trying to force every interaction through refs.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_TIMEOUT = 30


class AgentBrowserError(RuntimeError):
    """Raised when an agent-browser command exits non-zero."""

    def __init__(self, args: list[str], returncode: int, stdout: str, stderr: str):
        self.args_run = args
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        cmd = "agent-browser " + " ".join(args)
        detail = stderr.strip() or stdout.strip() or "unknown error"
        super().__init__(f"{cmd} failed (exit {returncode}): {detail}")


class UIAssertionError(AssertionError):
    """Assertion failure with captured browser context."""

    def __init__(self, message: str, url: str | None = None, screenshot: str | None = None):
        parts = [message]
        if url:
            parts.append(f"URL: {url}")
        if screenshot:
            parts.append(f"Screenshot: {screenshot}")
        super().__init__("\n  ".join(parts))
        self.url = url
        self.screenshot = screenshot


@dataclass(frozen=True)
class SnapshotRef:
    """Ref discovered in `agent-browser snapshot -i` output."""

    ref: str
    text: str


class AgentBrowserUI:
    """Thin wrapper around the installed `agent-browser` binary."""

    def __init__(
        self,
        executable: str = "agent-browser",
        timeout: int = DEFAULT_TIMEOUT,
        screenshot_dir: str | Path = Path(__file__).resolve().parents[2] / "tmp" / "agent-browser-ui",
        session: str | None = None,
        extra_env: dict[str, str] | None = None,
    ):
        self.executable = executable
        self.timeout = timeout
        self.screenshot_dir = Path(screenshot_dir)
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)
        self.env = os.environ.copy()
        if session:
            self.env["AGENT_BROWSER_SESSION"] = session
        if extra_env:
            self.env.update(extra_env)

    def run(self, args: Iterable[str], timeout: int | None = None) -> str:
        arg_list = list(args)
        result = subprocess.run(
            [self.executable, *arg_list],
            capture_output=True,
            text=True,
            timeout=timeout or self.timeout,
            env=self.env,
        )
        if result.returncode != 0:
            raise AgentBrowserError(arg_list, result.returncode, result.stdout, result.stderr)
        return result.stdout.strip()

    def version(self) -> str:
        return self.run(["--version"])

    def open(self, url: str) -> str:
        return self.run(["open", url])

    def wait_load(self, state: str = "networkidle") -> str:
        return self.run(["wait", "--load", state], timeout=20)

    def wait_ms(self, ms: int) -> str:
        return self.run(["wait", str(ms)], timeout=max(5, int(ms / 1000) + 5))

    def wait_url(self, pattern: str) -> str:
        return self.run(["wait", "--url", pattern], timeout=20)

    def wait_text(self, text: str) -> str:
        return self.run(["wait", "--text", text], timeout=20)

    def get_url(self) -> str:
        return self.run(["get", "url"])

    def get_title(self) -> str:
        return self.run(["get", "title"])

    def get_text(self, target: str) -> str:
        return self.run(["get", "text", target])

    def get_attr(self, target: str, attr: str) -> str:
        return self.run(["get", "attr", target, attr])

    def snapshot(self, interactive: bool = True) -> str:
        args = ["snapshot"]
        if interactive:
            args.append("-i")
        return self.run(args, timeout=20)

    def snapshot_refs(self) -> list[SnapshotRef]:
        raw = self.snapshot(interactive=True)
        refs: list[SnapshotRef] = []
        for line in raw.splitlines():
            match = re.search(r"\[ref=(e\d+)\]", line)
            if not match:
                continue
            refs.append(SnapshotRef(ref=f"@{match.group(1)}", text=line.strip()))
        return refs

    def screenshot(self, name: str, annotate: bool = False, full: bool = False) -> Path:
        path = self.screenshot_dir / name
        if full:
            # --full only expands the body scroll height, not nested scrollable
            # containers. Resize viewport to content height first.
            try:
                height = int(self.eval(
                    "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)"
                ))
                if height > 800:
                    self.run(["set", "viewport", "1280", str(height)])
            except (AgentBrowserError, ValueError):
                pass  # Fall back to default viewport
        args = ["screenshot"]
        if annotate:
            args.append("--annotate")
        if full:
            args.append("--full")
        args.append(str(path))
        self.run(args, timeout=20)
        return path

    def click(self, target: str) -> str:
        return self.run(["click", target])

    def fill(self, target: str, text: str) -> str:
        return self.run(["fill", target, text])

    def eval(self, expr: str) -> str:
        return self.run(["eval", expr], timeout=20)

    def eval_json(self, expr: str):
        return json.loads(self.eval(expr))

    def open_and_wait(self, url: str, title: str | None = None, url_fragment: str | None = None) -> str:
        self.open(url)
        self.wait_load()
        if title is not None:
            self.assert_title(title)
        if url_fragment is not None:
            self.assert_url_contains(url_fragment)
        return self.get_url()

    def click_and_wait_url(self, target: str, expected_fragment: str, settle_ms: int = 500) -> str:
        self.click(target)
        self.wait_ms(settle_ms)
        return self.assert_url_contains(expected_fragment)

    def eval_click_and_wait_url(self, selector: str, expected_fragment: str, settle_ms: int = 500) -> str:
        selector_json = json.dumps(selector)
        expr = (
            f"(()=>{{document.querySelector({selector_json})?.click();"
            "return window.location.pathname}})()"
        )
        self.eval(expr)
        self.wait_ms(settle_ms)
        return self.assert_url_contains(expected_fragment)

    def debug_context(self, label: str = "failure") -> tuple[str, str]:
        url = self.get_url()
        safe = re.sub(r"[^a-zA-Z0-9._-]+", "-", label).strip("-") or "debug"
        shot = self.screenshot(f"{safe}.png", annotate=True)
        return url, str(shot)

    def assert_url_contains(self, fragment: str, msg: str = "") -> str:
        url = self.get_url()
        if fragment not in url:
            current_url, screenshot = self.debug_context("url-mismatch")
            raise UIAssertionError(
                msg or f"Expected URL to contain {fragment!r}, got {url!r}",
                url=current_url,
                screenshot=screenshot,
            )
        return url

    def assert_title(self, expected: str, msg: str = "") -> str:
        title = self.get_title()
        if title != expected:
            url, screenshot = self.debug_context("title-mismatch")
            raise UIAssertionError(
                msg or f"Expected title {expected!r}, got {title!r}",
                url=url,
                screenshot=screenshot,
            )
        return title

    def assert_text_visible(self, text: str, msg: str = "") -> str:
        body = self.eval("(()=>document.body.innerText)()")
        if text not in body:
            url, screenshot = self.debug_context("text-missing")
            raise UIAssertionError(
                msg or f"Expected page text to contain {text!r}",
                url=url,
                screenshot=screenshot,
            )
        return body

    def assert_no_error_text(
        self,
        phrases: Iterable[str] = ("Something went wrong", "500 Internal Server Error", "Cannot GET"),
    ) -> None:
        vite = self.eval("(()=>!!document.querySelector('vite-error-overlay'))()")
        if "true" in vite.lower():
            url, screenshot = self.debug_context("vite-overlay")
            raise UIAssertionError("Vite error overlay detected", url=url, screenshot=screenshot)

        body = self.eval("(()=>document.body.innerText.slice(0, 3000))()")
        for phrase in phrases:
            if phrase in body:
                url, screenshot = self.debug_context("error-text")
                raise UIAssertionError(f"Error text detected: {phrase!r}", url=url, screenshot=screenshot)


__all__ = [
    "AgentBrowserError",
    "AgentBrowserUI",
    "SnapshotRef",
    "UIAssertionError",
]
