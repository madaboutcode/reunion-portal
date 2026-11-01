#!/usr/bin/env python3
"""SmritiPortal — domain-level API for the Smriti reunion registration app.

Owns the browser session. Domain flows (registration, confirmation, payment)
are accessed as sub-APIs so scenario scripts work at business-concept level:

    portal = create_portal()
    portal.go_home()
    portal.registration.select_participation()
    portal.registration.fill_alumni_details(data)
    ...

Prerequisites:
  - fill_helpers.js in the same directory (injected automatically)
  - Dev servers running (http://localhost:5173, http://localhost:8787)
"""

from __future__ import annotations

import time
from pathlib import Path
from agent_browser_ui import AgentBrowserUI, UIAssertionError

STEPS_DIR = Path(__file__).parent
HELPER_PATH = STEPS_DIR / "fill_helpers.js"

# ── Step heading text ─────────────────────────────────────────────────────────

_STEP_HEADINGS = {
    1: "Choose your reunion plan",
    2: "Tell us about yourself",
    3: "Who’s coming along?",
    4: "My Stay",
    5: "Giving Back",
    6: "Photo & ID",
    7: "You’re almost there",
}

# ── CSS selectors ─────────────────────────────────────────────────────────────
# Text-based selectors (fallback for elements without data-testid)

_S1_NAME = 'input[placeholder*="call you"]'
_S1_BRANCH = "select"
_S1_EMAIL = "input[type=email]"
_S1_WHATSAPP = 'input[placeholder*="98765"]'
_S1_CITY = 'input[placeholder*="city"]'

_S2_SPOUSE_NAME = 'input[placeholder*="Partner"]'
_S2_CHILD_NAME = 'input[placeholder*="Name (optional)"]'
_S2_CHILD_AGE = "input[type=number]"
_S2_GUEST_NAME = 'input[placeholder*="Guest name"]'
_S2_GUEST_RELATION = 'input[placeholder*="Brother"]'

# ── data-testid selectors (preferred — more reliable) ────────────────────────
# These correspond to data-testid attributes added to React components.
#
# Step 1: plan-{full_celebration|campus_only|donation_only}, wizard-continue
# Step 2: step1-continue
# Step 3: spouse-switch, add-child, add-guest, wizard-continue
# Step 4: accom-{none|private|shared_double|shared_triple}, checkin-{iso}, wizard-continue
# Step 5: cause-{green_energy|scholarship}, wizard-continue
# Step 6: upload-photo, upload-id, wizard-continue
# Step 7: step6-advance


# ═══════════════════════════════════════════════════════════════════════════════
# Errors
# ═══════════════════════════════════════════════════════════════════════════════


class PortalError(UIAssertionError):
    """Domain-level failure with app context."""


# ═══════════════════════════════════════════════════════════════════════════════
# SmritiPortal
# ═══════════════════════════════════════════════════════════════════════════════


class SmritiPortal:
    """Top-level API for the Smriti registration portal.

    Owns the browser session. Domain flows are accessed as properties.
    """

    def __init__(self, ui: AgentBrowserUI, base_url: str = "http://localhost:5173"):
        if not HELPER_PATH.exists():
            raise FileNotFoundError(
                f"fill_helpers.js not found at {HELPER_PATH}"
            )
        self.ui = ui
        self.base_url = base_url
        self._registration = RegistrationFlow(self)
        self._step: int = 1

    # ── domain flows ─────────────────────────────────────────────────────

    @property
    def registration(self) -> "RegistrationFlow":
        """The 7-step registration wizard."""
        return self._registration

    # ── shared helpers ────────────────────────────────────────────────────

    def _eval(self, expr: str) -> str:
        return self.ui.eval(expr).strip('"')

    def _sleep(self, secs: float = 1.0) -> None:
        time.sleep(secs)

    @staticmethod
    def _escape_js_str(s: str) -> str:
        """Escape a string for embedding in a double-quoted JS string literal."""
        return s.replace("\\", "\\\\").replace('"', '\\"')

    def _click(self, text: str) -> None:
        """Click a button whose visible text contains `text`."""
        safe = self._escape_js_str(text)
        result = self._eval(f'window.__clickButton("{safe}")')
        if "NOT_FOUND" in result:
            raise PortalError(f"Button not found: {text!r}")

    def _click_id(self, testid: str) -> None:
        """Click an element by its data-testid attribute."""
        result = self._eval(f'window.__clickTestId("{testid}")')
        if "NOT_FOUND" in result:
            raise PortalError(f"Element not found: data-testid={testid!r}")

    def _try_click(self, text: str) -> bool:
        """Click a button if found. Returns True if clicked, False if not."""
        safe = self._escape_js_str(text)
        result = self._eval(f'window.__clickButton("{safe}")')
        return "NOT_FOUND" not in result

    def _try_click_id(self, testid: str) -> bool:
        """Click by testid if found. Returns True if clicked, False if not."""
        result = self._eval(f'window.__clickTestId("{testid}")')
        return "NOT_FOUND" not in result

    def _fill_input(self, selector: str, value: str) -> None:
        safe_sel = self._escape_js_str(selector)
        safe_val = self._escape_js_str(value)
        result = self._eval(
            f'window.__fillReactInput("{safe_sel}", "{safe_val}")'
        )
        if "NOT_FOUND" in result:
            raise PortalError(f"Input not found: {selector!r}")

    def _fill_select(self, selector: str, value: str) -> None:
        safe_sel = self._escape_js_str(selector)
        safe_val = self._escape_js_str(value)
        result = self._eval(
            f'window.__fillReactSelect("{safe_sel}", "{safe_val}")'
        )
        if "NOT_FOUND" in result:
            raise PortalError(f"Select not found: {selector!r}")

    def _heading(self) -> str:
        return self._eval("window.__currentStepHeading()")

    def _wait_stable(self) -> None:
        self.ui.wait_load()

    # ── top-level navigation ──────────────────────────────────────────────

    def go_home(self) -> str:
        """Open the registration wizard at step 1."""
        self.ui.open_and_wait(f"{self.base_url}/register")
        self.ui.assert_no_error_text()
        self.ui.assert_text_visible("Choose your reunion plan")
        self._step = 1
        return self.ui.get_url()

    def screenshot(self, name: str) -> Path:
        """Annotated full-page screenshot with step prefix."""
        full_name = f"s{self._step}_{name}"
        return self.ui.screenshot(full_name, annotate=True, full=True)

    # ── draft manipulation ──────────────────────────────────────────────

    def patch_draft(self, patch: dict) -> str:
        """Patch the wizard draft in localStorage.

        Useful for working around known issues (e.g. setting hasDonation
        or bypassing ID requirement for payment tests). Changes take
        effect after reload_to_step().
        """
        import json

        return self._eval(
            f"window.__patchDraft('{json.dumps(patch).replace(chr(34), chr(92)+chr(34))}')"
        )

    def reload_to_step(self, target: int) -> None:
        """Reload the page and fast-navigate to a wizard step.

        After patching the draft, all field values are preserved in
        localStorage. Reloading resets to step 1, then clicks through
        each step. Each advance waits for React to re-render.
        """
        self._step = 1
        self.ui.open(f"{self.base_url}/register")
        self._wait_stable()

        if target == 1:
            return

        # Step 1 → 2: select plan card + Continue
        self._click_id("plan-full_celebration")
        self._sleep(0.5)
        self._click_id("wizard-continue")
        self._wait_stable()
        self._step = 2

        if target == 2:
            return

        # Step 2 → 3: Continue (all fields preserved from draft)
        self._click_id("wizard-continue")
        self._wait_stable()
        self._step = 3

        if target == 3:
            return

        # Step 3 → 4: Continue (attendees preserved)
        self._click_id("wizard-continue")
        self._wait_stable()
        self._step = 4

        if target == 4:
            return

        # Step 4 → 5: Continue (accommodation preserved)
        self._click_id("wizard-continue")
        self._wait_stable()
        self._step = 5

        if target == 5:
            return

        # Step 5 → 6: Continue (giving back preserved)
        self._click_id("wizard-continue")
        self._wait_stable()
        self._step = 6

        if target == 6:
            return

        # Step 6 → 7: Continue (uploads preserved)
        self._sleep(0.5)
        self._click_id("wizard-continue")
        self._wait_stable()
        self._step = 7


# ═══════════════════════════════════════════════════════════════════════════════
# RegistrationFlow
# ═══════════════════════════════════════════════════════════════════════════════


class RegistrationFlow:
    """The 7-step registration wizard — fill, advance, review.

    Accessed via ``portal.registration``. Each method fills one step,
    advances to the next, and returns a screenshot Path.
    """

    def __init__(self, portal: SmritiPortal):
        self._p = portal

    # ── step 1: plan selection ────────────────────────────────────────────

    def select_participation(self, participation_type: str = "full_celebration") -> Path:
        """Select participation type and advance to step 2.
        Options: full_celebration, campus_only, donation_only
        """
        self._require_step(1)
        self._p._click_id(f"plan-{participation_type}")
        self._p._sleep(0.5)
        # Step 1 Continue is in WizardShell, not WizardStepLayout —
        # fall back to text click if testid not found
        if not self._p._try_click_id("wizard-continue"):
            self._p._click("Continue")
        self._p._wait_stable()
        self._assert_advanced(2)
        self._p._step = 2
        return self._p.screenshot("filled.png")

    # ── step 2: personal details ──────────────────────────────────────────

    def fill_alumni_details(self, data: dict[str, str]) -> Path:
        """Fill personal details and advance to step 3.
        Required: fullName, branch, gender, email, whatsapp, city
        Optional: country (default handled by UI)
        """
        self._require_step(2)
        self._p._fill_input(_S1_NAME, data["fullName"])
        self._p._fill_select(_S1_BRANCH, data["branch"])
        # Gender select — located by testid
        result = self._p._eval(f'window.__selectByTestId("gender", "{self._p._escape_js_str(data["gender"])}")')
        if "NOT_FOUND" in result:
            raise PortalError("Gender select not found")
        self._p._fill_input(_S1_EMAIL, data["email"])
        self._p._fill_input(_S1_WHATSAPP, data["whatsapp"])
        self._p._fill_input(_S1_CITY, data["city"])
        self._p._sleep(0.5)
        self._p._click_id("step1-continue")
        self._p._wait_stable()
        # Email duplicate check may show a modal — wait briefly
        self._p._sleep(1.0)
        self._assert_advanced(3)
        self._p._step = 3
        return self._p.screenshot("filled.png")

    # ── step 3: attendees & meals ─────────────────────────────────────────

    def fill_attendees_meals(self, data: dict) -> Path:
        """Fill attendees (spouse, children, guests) and advance to step 4.
        Keys:
          alumniMeal (str)       — "veg" | "non_veg"  (default "non_veg")
          tshirtSize (str)       — e.g. "L", "M", "XL"
          hasSpouse (bool)
          spouseName (str)       — required if hasSpouse
          spouseMeal (str)       — "veg" | "non_veg"  (default "veg")
          children (list[dict])  — [{name, age, meal}]
          guests (list[dict])    — [{name, relationship, meal}]
        """
        self._require_step(3)

        # Alumni meal
        alumni_meal = data.get("alumniMeal", "non_veg")
        self._p._click("Non-veg" if alumni_meal == "non_veg" else "Veg")
        self._p._sleep(0.3)

        # T-shirt size
        if data.get("tshirtSize"):
            self._p._eval(f'window.__selectByTestId("tshirt-size", "{self._p._escape_js_str(data["tshirtSize"])}")')
            self._p._sleep(0.3)

        # Spouse
        if data.get("hasSpouse"):
            self._p._click_id("spouse-switch")
            self._p._sleep(0.5)
            if data.get("spouseName"):
                self._p._fill_input(_S2_SPOUSE_NAME, data["spouseName"])
                self._p._sleep(0.3)

        # Children
        for child in data.get("children", []):
            self._p._click_id("add-child")
            self._p._sleep(0.5)
            if child.get("name"):
                self._p._fill_input(_S2_CHILD_NAME, child["name"])
            if child.get("age") is not None:
                self._p._fill_input(_S2_CHILD_AGE, str(child["age"]))
            self._p._click("Non-veg" if child.get("meal") == "non_veg" else "Veg")
            self._p._sleep(0.3)

        # Guests
        for guest in data.get("guests", []):
            self._p._click_id("add-guest")
            self._p._sleep(0.5)
            if guest.get("name"):
                self._p._fill_input(_S2_GUEST_NAME, guest["name"])
            if guest.get("relationship"):
                self._p._fill_input(_S2_GUEST_RELATION, guest["relationship"])
            self._p._click("Non-veg" if guest.get("meal") == "non_veg" else "Veg")
            self._p._sleep(0.3)

        self._p._sleep(0.5)
        self._p._click_id("wizard-continue")
        self._p._wait_stable()
        self._assert_advanced(4)
        self._p._step = 4
        return self._p.screenshot("filled.png")

    # ── step 4: accommodation ─────────────────────────────────────────────

    def fill_accommodation(self, data: dict) -> Path:
        """Fill accommodation and advance to step 5.
        Keys:
          accommodation (str) — "none" | "private" | "shared_double" | "shared_triple"
          checkIn (str)       — ISO date e.g. "2026-08-14" (only if accommodation != "none")
          checkOut (str)      — ISO date e.g. "2026-08-16" (only if accommodation != "none")
          extraBed (bool)     — only for private rooms
        """
        self._require_step(4)
        accom = data.get("accommodation", "none")
        self._p._click_id(f"accom-{accom}")
        self._p._sleep(0.5)

        if accom != "none" and data.get("checkIn"):
            self._p._click_id(f"checkin-{data['checkIn']}")
            self._p._sleep(0.3)

        self._p._sleep(0.5)
        self._p._click_id("wizard-continue")
        self._p._wait_stable()
        self._assert_advanced(5)
        self._p._step = 5
        return self._p.screenshot("filled.png")

    # ── step 5: giving back ───────────────────────────────────────────────

    def fill_giving_back(self, data: dict) -> Path:
        """Fill donation/contribution and advance to step 6.
        Keys:
          collegeContributionCause (str) — "green_energy" | "scholarship"
          collegeContribution (int)      — amount in rupees
          donationAmount (int)           — optional reunion donation
          publicAcknowledgement (bool)   — show name publicly
          felicitationConsent (bool)     — consent for on-stage (if donation >= 50000)
        """
        self._require_step(5)

        # Select cause
        cause = data.get("collegeContributionCause", "green_energy")
        self._p._click_id(f"cause-{cause}")
        self._p._sleep(0.3)

        # College contribution amount
        contrib = data.get("collegeContribution")
        if contrib is not None and contrib > 0:
            self._p._eval(f'window.__fillByTestId("college-contribution", "{contrib}")')
            self._p._sleep(0.3)

        # Reunion donation
        donation = data.get("donationAmount")
        if donation is not None and donation > 0:
            self._p._eval(f'window.__fillByTestId("donation-amount", "{donation}")')
            self._p._sleep(0.3)

        if data.get("publicAcknowledgement"):
            self._p._eval("window.__checkConsent()")
            self._p._sleep(0.3)

        self._p._sleep(0.5)
        self._p._click_id("wizard-continue")
        self._p._wait_stable()
        self._assert_advanced(6)
        self._p._step = 6
        return self._p.screenshot("filled.png")

    # ── step 6: photo & ID upload ─────────────────────────────────────────

    def upload_photo_id(self, photo_path: str, id_path: str | None = None) -> Path:
        """Upload photo and ID files, advance to step 7.
        photo_path: path to a JPEG/PNG for the photo upload
        id_path: path to a JPEG/PNG/PDF for ID upload (optional for donation_only)
        """
        self._require_step(6)

        # Upload photo via the hidden input with derived testid
        self._p.ui.run(["upload", '[data-testid="upload-photo-input"]', str(photo_path)])
        self._p._sleep(2)

        # Upload ID if provided
        if id_path:
            self._p.ui.run(["upload", '[data-testid="upload-id-input"]', str(id_path)])
            self._p._sleep(2)

        self._p._click_id("wizard-continue")
        self._p._wait_stable()
        self._assert_advanced(7)
        self._p._step = 7
        return self._p.screenshot("uploaded.png")

    # ── step 7: review ────────────────────────────────────────────────────

    def review_text(self) -> str:
        """Return the full text content of the review page."""
        self._require_step(7)
        return self._p._eval("window.__pageBodyText()")

    def pay_button_state(self) -> dict:
        """Return {disabled, text} for the Pay button."""
        self._require_step(7)
        return self._p.ui.eval_json(
            "(()=>{const btns=document.querySelectorAll('button');"
            "for(const b of btns){"
            "if(b.textContent.includes('Pay'))"
            "return {disabled:b.disabled,text:b.textContent.trim()}"
            "} return {disabled:null,text:'not found'}})()"
        )

    def click_pay(self) -> Path:
        """Click the Pay/Submit button on step 7."""
        self._require_step(7)
        self._p._click_id("step6-advance")
        self._p._sleep(2)
        self._p._wait_stable()
        return self._p.screenshot("payment.png")

    # ── internal ─────────────────────────────────────────────────────────

    def _require_step(self, expected: int) -> None:
        if self._p._step != expected:
            raise PortalError(
                f"Expected registration step {expected}, "
                f"currently on step {self._p._step}"
            )

    def _assert_advanced(self, target: int) -> None:
        heading = self._p._heading()
        expected = _STEP_HEADINGS[target]
        if heading != expected:
            errs = self._p._eval("window.__hasErrorText()")
            detail = f" errors: {errs}" if errs else ""
            raise PortalError(
                f"Expected heading {expected!r}, got {heading!r}{detail}"
            )


# ═══════════════════════════════════════════════════════════════════════════════
# Factory
# ═══════════════════════════════════════════════════════════════════════════════


def create_portal(
    base_url: str = "http://localhost:5173",
    screenshot_dir: str = str(Path(__file__).resolve().parents[2] / "tmp" / "ui-screenshots"),
    session_name: str = "smriti-test",
) -> SmritiPortal:
    """Create a SmritiPortal with the React-fill helper injected."""
    ui = AgentBrowserUI(
        screenshot_dir=screenshot_dir,
        session=session_name,
        extra_env={"AGENT_BROWSER_INIT_SCRIPTS": str(HELPER_PATH)},
    )
    return SmritiPortal(ui, base_url=base_url)
