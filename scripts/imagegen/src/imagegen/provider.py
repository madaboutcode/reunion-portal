from __future__ import annotations

import base64
import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from .normalize import EncodedImage


class ProviderError(Exception):
    pass


class AuthError(ProviderError):
    pass


class QuotaError(ProviderError):
    pass


class RateError(ProviderError):
    pass


class ServerError(ProviderError):
    pass


class ModerationError(ProviderError):
    pass


class MalformedResponseError(ProviderError):
    pass


_SECRET_QUERY_RE = re.compile(
    r"[?&](?:key|api[_-]?key|token|access[_-]?token)=[^&\s]*", re.IGNORECASE
)


def _redact(text: str, key: str | None = None) -> str:
    if not text:
        return text
    text = _SECRET_QUERY_RE.sub("[REDACTED]", text)
    if key:
        text = text.replace(key, "[REDACTED]")
    return text


def _elide_image_data(obj):
    if not isinstance(obj, dict):
        return obj
    result = dict(obj)
    if isinstance(result.get("steps"), list):
        new_steps = []
        for step in result["steps"]:
            if not isinstance(step, dict) or not isinstance(step.get("content"), list):
                new_steps.append(step)
                continue
            new_step = dict(step)
            new_content = []
            for part in step["content"]:
                if (isinstance(part, dict) and part.get("type") == "image"
                        and isinstance(part.get("data"), str)):
                    part = dict(part, data="<base64 %d bytes>" % len(part["data"]))
                new_content.append(part)
            new_step["content"] = new_content
            new_steps.append(new_step)
        result["steps"] = new_steps
    if isinstance(result.get("input"), list):
        new_input = []
        for entry in result["input"]:
            if (isinstance(entry, dict) and entry.get("type") == "image"
                    and isinstance(entry.get("data"), str)):
                entry = dict(entry, data="<base64 %d bytes>" % len(entry["data"]))
            new_input.append(entry)
        result["input"] = new_input
    return result


def _transport_detail(e: Exception) -> str:
    reason = getattr(e, "reason", None)
    if reason is not None:
        return str(reason)
    return getattr(e, "strerror", None) or ""


@dataclass(frozen=True)
class GenerateRequest:
    model: str
    prompt: str
    references: tuple[EncodedImage, ...]
    aspect_ratio: str
    resolution: str


@dataclass(frozen=True)
class GenerationResult:
    image: bytes
    mime: str
    elapsed_seconds: float
    request_id: str | None = None
    usage: dict | None = None


class ImageProvider(Protocol):
    def generate(self, request: GenerateRequest) -> GenerationResult: ...


def _classify_gemini(status: int, body: str, key: str | None) -> ProviderError:
    detail = _redact((body or "").strip(), key)
    lower = detail.lower()
    if status in (401, 403):
        return AuthError(f"Gemini auth rejected ({status}): {detail}")
    if status == 429:
        if "quota" in lower or "rate limit" not in lower:
            return QuotaError(f"Gemini quota exceeded ({status}): {detail}")
        return RateError(f"Gemini rate limited ({status}): {detail}")
    if status >= 500:
        return ServerError(f"Gemini server error ({status}): {detail}")
    if status == 400:
        if "safety" in lower or "moderation" in lower or "blocked" in lower:
            return ModerationError(f"Gemini moderation ({status}): {detail}")
    return MalformedResponseError(f"Gemini HTTP {status}: {detail}")


class GeminiAdapter:
    ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"

    def __init__(self, key: str, timeout: int = 420):
        self._key = key
        self._timeout = timeout

    def _build_body(self, request: GenerateRequest) -> dict:
        input_list: list[dict] = [{"type": "text", "text": request.prompt}]
        for ref in request.references:
            input_list.append({
                "type": "image",
                "data": base64.b64encode(ref.data).decode(),
                "mime_type": ref.mime_type,
            })

        return {
            "model": request.model,
            "input": input_list,
            "generation_config": {
                "image_config": {
                    "image_size": request.resolution,
                    "aspect_ratio": request.aspect_ratio,
                },
            },
            "response_modalities": ["image", "text"],
        }

    def _decode_response(self, response: dict) -> tuple[bytes, str | None, dict | None]:
        if not isinstance(response, dict):
            raise MalformedResponseError(
                "response is not a JSON object: %s" % json.dumps(response)
            )
        if response.get("status") != "completed":
            raise MalformedResponseError(
                "incomplete response: %s" % json.dumps(_elide_image_data(response))
            )

        steps = response.get("steps", [])
        if not isinstance(steps, list):
            steps = []

        for step in steps:
            if not isinstance(step, dict):
                continue
            content = step.get("content", [])
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict) or part.get("type") != "image":
                    continue
                try:
                    raw = base64.b64decode(part["data"], validate=True)
                except (KeyError, ValueError, TypeError) as e:
                    raise MalformedResponseError(
                        "image data malformed: %s -- %s"
                        % (e, json.dumps(_elide_image_data(response)))
                    )
                return raw, response.get("request_id"), response.get("usage")

        raise MalformedResponseError(
            "response contains no image: %s" % json.dumps(_elide_image_data(response))
        )

    def generate(self, request: GenerateRequest) -> GenerationResult:
        body = self._build_body(request)
        payload = json.dumps(body).encode()

        url = self.ENDPOINT + "?key=" + self._key
        http_request = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )

        t0 = time.time()
        resp_body = b""
        try:
            with urllib.request.urlopen(http_request, timeout=self._timeout) as r:
                resp_body = r.read()
            result = json.loads(resp_body)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")
            except Exception:
                pass
            raise _classify_gemini(e.code, detail, self._key) from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise ServerError(
                "Gemini %s: %s" % (type(e).__name__, _redact(_transport_detail(e), self._key))
            ) from e
        except (json.JSONDecodeError, ValueError) as e:
            body_text = _redact(resp_body.decode("utf-8", "replace"), self._key)
            raise MalformedResponseError(
                "Gemini response parse failed: %s -- %s" % (e, body_text)
            ) from e

        elapsed = round(time.time() - t0, 2)
        raw, request_id, usage = self._decode_response(result)

        return GenerationResult(
            image=raw,
            mime="image/png",
            elapsed_seconds=elapsed,
            request_id=request_id,
            usage=usage if isinstance(usage, dict) else None,
        )
