#!/usr/bin/env python3
"""SmritiAsserts — domain-level assertions for the Smriti portal.

Verifies what the end user sees: headings, summary data, pass codes,
payment gateway. Works alongside SmritiPortal for scenario tests.
"""

from __future__ import annotations

from agent_browser_ui import AgentBrowserUI, UIAssertionError


class SmritiAsserts:
    """What the user should see at each stage of the registration flow."""

    def __init__(self, ui: AgentBrowserUI):
        self.ui = ui

    # ── page health ───────────────────────────────────────────────────────

    def page_loaded(self) -> None:
        """Verify the page actually rendered — not blank, no Vite overlay."""
        title = self.ui.get_title()
        if not title or title == "New Tab":
            raise UIAssertionError(f"Page did not load — title is {title!r}")
        self.ui.assert_no_error_text()

    def no_validation_errors(self) -> None:
        """No ⚠ validation messages visible on the current page."""
        body = self.ui.eval("window.__hasErrorText()").strip('"')
        if body:
            raise UIAssertionError(f"Validation errors visible: {body}")

    # ── headings ──────────────────────────────────────────────────────────

    def sees_heading(self, text: str) -> None:
        """The user sees this heading text on the page."""
        self.ui.assert_text_visible(text)

    # ── registration wizard ───────────────────────────────────────────────

    _STEP_HEADINGS = {
        1: "Choose your reunion plan",
        2: "Tell us about yourself",
        3: "Who’s coming along?",
        4: "My Stay",
        5: "Giving Back",
        6: "Photo & ID",
        7: "You’re almost there",
    }

    def on_registration_step(self, n: int) -> None:
        """Verify the user is on step n of the registration wizard."""
        expected = self._STEP_HEADINGS.get(n)
        if expected is None:
            raise ValueError(f"Unknown step: {n}")
        self.sees_heading(expected)

    # ── review (step 7) ──────────────────────────────────────────────────

    def summary_contains(self, *texts: str) -> None:
        """Each text must appear in the review page body."""
        body_text = self.ui.eval("window.__pageBodyText()").strip('"')
        missing = [t for t in texts if t not in body_text]
        if missing:
            raise UIAssertionError(
                f"Expected in summary but not found: {missing}"
            )

    def pay_button_disabled(self) -> None:
        """Pay button exists and is disabled (incomplete items)."""
        state = self.ui.eval_json(
            "(()=>{const btns=document.querySelectorAll('button');"
            "for(const b of btns){"
            "if(b.textContent.includes('Pay'))"
            "return {disabled:b.disabled,text:b.textContent.trim()}"
            "} return {disabled:null,text:'not found'}})()"
        )
        if state["disabled"] is None:
            raise UIAssertionError("Pay button not found on review page")
        if not state["disabled"]:
            raise UIAssertionError(
                f"Expected Pay button to be disabled, got enabled: {state['text']}"
            )

    # ── payment ───────────────────────────────────────────────────────────

    def payment_gateway_visible(self) -> None:
        """The mock payment gateway page is showing."""
        self.ui.assert_url_contains("payment-mock")
        self.ui.assert_text_visible("Mock Gateway")

    # ── confirmation ─────────────────────────────────────────────────────

    def confirmation_loaded(self) -> None:
        """The confirmation page loaded after successful registration."""
        self.ui.assert_url_contains("confirmation")
        self.sees_heading("You're Registered!")

    def pass_code_visible(self) -> None:
        """A pass code (SMRT-...) is displayed on the confirmation page."""
        body_text = self.ui.eval("window.__pageBodyText()").strip('"')
        if "SMRT" not in body_text:
            raise UIAssertionError("Pass code not visible on confirmation page")
