from __future__ import annotations

import base64
import io
import json
import urllib.error
import urllib.request

import pytest
from PIL import Image

from imagegen.normalize import EncodedImage
from imagegen.provider import (
    AuthError,
    GeminiAdapter,
    GenerateRequest,
    GenerationResult,
    MalformedResponseError,
    ModerationError,
    QuotaError,
    RateError,
    ServerError,
    _redact,
)

API_KEY = "super-secret-api-key-123"


def make_encoded_image(width: int = 8, height: int = 6, color=(255, 0, 0)) -> EncodedImage:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    data = buf.getvalue()
    return EncodedImage(
        data=data,
        mime_type="image/png",
        original_width=width,
        original_height=height,
        encoded_width=width,
        encoded_height=height,
    )


def make_request(references=(), prompt="a friendly cat") -> GenerateRequest:
    return GenerateRequest(
        model="gemini-image-test",
        prompt=prompt,
        references=tuple(references),
        aspect_ratio="16:9",
        resolution="1K",
    )


def make_completed_response(image_bytes: bytes, request_id="req-1", usage=None) -> dict:
    return {
        "status": "completed",
        "request_id": request_id,
        "usage": usage,
        "steps": [
            {
                "content": [
                    {"type": "image", "data": base64.b64encode(image_bytes).decode()}
                ]
            }
        ],
    }


class FakeHTTPResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class RecordingTransport:
    """Fake replacement for urllib.request.urlopen that records every call."""

    def __init__(self, response_body: bytes | None = None, http_error=None, exc: Exception | None = None):
        self.requests: list[urllib.request.Request] = []
        self._response_body = response_body
        self._http_error = http_error
        self._exc = exc

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        if self._exc is not None:
            raise self._exc
        if self._http_error is not None:
            code, body = self._http_error
            raise urllib.error.HTTPError(request.full_url, code, "error", None, io.BytesIO(body))
        return FakeHTTPResponse(self._response_body)


def install_transport(monkeypatch, **kwargs) -> RecordingTransport:
    transport = RecordingTransport(**kwargs)
    monkeypatch.setattr(urllib.request, "urlopen", transport)
    return transport


# --- Request body shape ---------------------------------------------------


def test_body_text_only_has_exact_top_level_keys(monkeypatch):
    transport = install_transport(
        monkeypatch, response_body=json.dumps(make_completed_response(b"PNGDATA")).encode()
    )
    adapter = GeminiAdapter(key=API_KEY)
    adapter.generate(make_request(references=()))

    assert len(transport.requests) == 1
    sent = json.loads(transport.requests[0].data)
    assert set(sent.keys()) == {"model", "input", "generation_config", "response_modalities"}
    assert len(sent["input"]) == 1
    assert sent["input"][0]["type"] == "text"
    assert sent["input"][0]["text"] == "a friendly cat"


def test_body_one_reference_has_text_plus_image_entry(monkeypatch):
    transport = install_transport(
        monkeypatch, response_body=json.dumps(make_completed_response(b"PNGDATA")).encode()
    )
    ref = make_encoded_image()
    adapter = GeminiAdapter(key=API_KEY)
    adapter.generate(make_request(references=(ref,)))

    sent = json.loads(transport.requests[0].data)
    assert len(sent["input"]) == 2
    assert sent["input"][0]["type"] == "text"
    image_entry = sent["input"][1]
    assert set(image_entry.keys()) == {"type", "data", "mime_type"}
    assert image_entry["type"] == "image"
    assert base64.b64decode(image_entry["data"]) == ref.data
    assert image_entry["mime_type"] == ref.mime_type


def test_body_three_references_preserve_cli_order(monkeypatch):
    transport = install_transport(
        monkeypatch, response_body=json.dumps(make_completed_response(b"PNGDATA")).encode()
    )
    refs = (
        make_encoded_image(color=(255, 0, 0)),
        make_encoded_image(color=(0, 255, 0)),
        make_encoded_image(color=(0, 0, 255)),
    )
    adapter = GeminiAdapter(key=API_KEY)
    adapter.generate(make_request(references=refs))

    sent = json.loads(transport.requests[0].data)
    assert len(sent["input"]) == 4
    for i, ref in enumerate(refs, start=1):
        entry = sent["input"][i]
        assert entry["type"] == "image"
        assert base64.b64decode(entry["data"]) == ref.data


def test_body_never_contains_api_key(monkeypatch):
    transport = install_transport(
        monkeypatch, response_body=json.dumps(make_completed_response(b"PNGDATA")).encode()
    )
    ref = make_encoded_image()
    adapter = GeminiAdapter(key=API_KEY)
    adapter.generate(make_request(references=(ref,)))

    raw_body = transport.requests[0].data.decode()
    assert API_KEY not in raw_body


def test_body_image_config_has_exact_keys(monkeypatch):
    transport = install_transport(
        monkeypatch, response_body=json.dumps(make_completed_response(b"PNGDATA")).encode()
    )
    adapter = GeminiAdapter(key=API_KEY)
    adapter.generate(make_request())

    sent = json.loads(transport.requests[0].data)
    image_config = sent["generation_config"]["image_config"]
    assert set(image_config.keys()) == {"image_size", "aspect_ratio"}
    assert image_config["image_size"] == "1K"
    assert image_config["aspect_ratio"] == "16:9"


def test_body_response_modalities_is_image_and_text(monkeypatch):
    transport = install_transport(
        monkeypatch, response_body=json.dumps(make_completed_response(b"PNGDATA")).encode()
    )
    adapter = GeminiAdapter(key=API_KEY)
    adapter.generate(make_request())

    sent = json.loads(transport.requests[0].data)
    assert sent["response_modalities"] == ["image", "text"]


# --- Error classification ---------------------------------------------------


@pytest.mark.parametrize(
    "status,body,exc_cls",
    [
        (401, "unauthorized", AuthError),
        (403, "forbidden", AuthError),
        (429, "quota exceeded for this project", QuotaError),
        (429, "rate limit hit, slow down", RateError),
        (500, "internal server error", ServerError),
        (400, "request blocked due to safety filters", ModerationError),
        (400, "malformed request body", MalformedResponseError),
    ],
)
def test_error_classification(monkeypatch, status, body, exc_cls):
    transport = install_transport(monkeypatch, http_error=(status, body.encode()))
    adapter = GeminiAdapter(key=API_KEY)

    with pytest.raises(exc_cls):
        adapter.generate(make_request())

    assert len(transport.requests) == 1


# --- Response decoding ---------------------------------------------------


def test_decode_valid_completed_response_returns_generation_result(monkeypatch):
    image_bytes = b"\x89PNGfake-image-bytes"
    install_transport(
        monkeypatch,
        response_body=json.dumps(
            make_completed_response(image_bytes, request_id="req-42", usage={"tokens": 10})
        ).encode(),
    )
    adapter = GeminiAdapter(key=API_KEY)
    result = adapter.generate(make_request())

    assert isinstance(result, GenerationResult)
    assert result.image == image_bytes
    assert result.mime == "image/png"
    assert result.request_id == "req-42"
    assert result.usage == {"tokens": 10}


def test_decode_status_not_completed_raises_malformed(monkeypatch):
    body = {"status": "in_progress", "steps": []}
    install_transport(monkeypatch, response_body=json.dumps(body).encode())
    adapter = GeminiAdapter(key=API_KEY)

    with pytest.raises(MalformedResponseError):
        adapter.generate(make_request())


def test_decode_no_image_parts_raises_malformed(monkeypatch):
    body = {"status": "completed", "steps": [{"content": [{"type": "text", "text": "no image"}]}]}
    install_transport(monkeypatch, response_body=json.dumps(body).encode())
    adapter = GeminiAdapter(key=API_KEY)

    with pytest.raises(MalformedResponseError):
        adapter.generate(make_request())


def test_decode_invalid_base64_raises_malformed(monkeypatch):
    body = {
        "status": "completed",
        "steps": [{"content": [{"type": "image", "data": "not-valid-base64!!!"}]}],
    }
    install_transport(monkeypatch, response_body=json.dumps(body).encode())
    adapter = GeminiAdapter(key=API_KEY)

    with pytest.raises(MalformedResponseError):
        adapter.generate(make_request())


def test_decode_non_dict_response_raises_malformed(monkeypatch):
    install_transport(monkeypatch, response_body=json.dumps(["not", "a", "dict"]).encode())
    adapter = GeminiAdapter(key=API_KEY)

    with pytest.raises(MalformedResponseError):
        adapter.generate(make_request())


# --- Redaction ---------------------------------------------------


def test_error_message_never_contains_api_key(monkeypatch):
    body = f"invalid credentials, key={API_KEY} rejected"
    install_transport(monkeypatch, http_error=(401, body.encode()))
    adapter = GeminiAdapter(key=API_KEY)

    with pytest.raises(AuthError) as exc_info:
        adapter.generate(make_request())

    assert API_KEY not in str(exc_info.value)


def test_error_message_never_contains_base64_image_data(monkeypatch):
    garbage_data = base64.b64encode(b"\x00\x01\x02" * 500).decode()
    body = {
        "status": "completed",
        "steps": [{"content": [{"type": "image", "data": garbage_data + "!!!not-valid"}]}],
    }
    install_transport(monkeypatch, response_body=json.dumps(body).encode())
    adapter = GeminiAdapter(key=API_KEY)

    with pytest.raises(MalformedResponseError) as exc_info:
        adapter.generate(make_request())

    assert garbage_data not in str(exc_info.value)


def test_redact_strips_query_param_secrets():
    text = "request failed: https://api.example.com/v1?key=ABC123SECRET&other=1"
    redacted = _redact(text)
    assert "ABC123SECRET" not in redacted
    assert "[REDACTED]" in redacted


def test_redact_strips_known_key_value_anywhere():
    text = f"error, offending key was {API_KEY} in payload"
    redacted = _redact(text, key=API_KEY)
    assert API_KEY not in redacted


# --- Single request guarantee ---------------------------------------------------


def test_failing_call_results_in_exactly_one_http_request(monkeypatch):
    transport = install_transport(monkeypatch, http_error=(500, b"server exploded"))
    adapter = GeminiAdapter(key=API_KEY)

    with pytest.raises(ServerError):
        adapter.generate(make_request())

    assert len(transport.requests) == 1


def test_transport_error_results_in_exactly_one_http_request_and_is_server_error(monkeypatch):
    transport = install_transport(monkeypatch, exc=urllib.error.URLError("connection refused"))
    adapter = GeminiAdapter(key=API_KEY)

    with pytest.raises(ServerError):
        adapter.generate(make_request())

    assert len(transport.requests) == 1
