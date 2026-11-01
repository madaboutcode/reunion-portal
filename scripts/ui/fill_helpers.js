/**
 * Injected helpers for agent-browser — React controlled input workarounds.
 *
 * agent-browser's `fill` command sets DOM values but React 19's synthetic
 * event system requires proper InputEvent / change events to trigger
 * onChange handlers. These helpers dispatch the right events.
 *
 * Usage: inject via AGENT_BROWSER_HELPER_SCRIPTS env var, then call from
 * `agent-browser eval` or `ui.eval()` in Python wrapper.
 *
 *   agent-browser eval "window.__fillReactInput('input[type=email]', 'a@b.com')"
 *   agent-browser eval "window.__clickButton('Continue')"
 */

window.__fillReactInput = function (selector, value) {
  var el = document.querySelector(selector);
  if (!el) return "NOT_FOUND: " + selector;
  var nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  nativeSetter.call(el, value);
  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value,
    })
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return el.value;
};

window.__fillReactSelect = function (selector, value) {
  var el = document.querySelector(selector);
  if (!el) return "NOT_FOUND: " + selector;
  var nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value"
  ).set;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return el.value;
};

window.__clickButton = function (text) {
  var buttons = document.querySelectorAll("button");
  for (var i = 0; i < buttons.length; i++) {
    if (
      buttons[i].textContent &&
      buttons[i].textContent.trim().indexOf(text) !== -1
    ) {
      buttons[i].click();
      return "CLICKED: " + text;
    }
  }
  return "NOT_FOUND: " + text;
};

window.__clickTestId = function (testid) {
  var el = document.querySelector('[data-testid="' + testid + '"]');
  if (el) {
    el.click();
    return "CLICKED: " + testid;
  }
  return "NOT_FOUND: " + testid;
};

window.__fillByTestId = function (testid, value) {
  var el = document.querySelector('[data-testid="' + testid + '"]');
  if (!el) return "NOT_FOUND: " + testid;
  if (el.tagName === "SELECT") return window.__fillReactSelect('[data-testid="' + testid + '"]', value);
  var nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  nativeSetter.call(el, value);
  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value,
    })
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return el.value;
};

window.__toggleSwitch = function () {
  var sw = document.querySelector('[role="switch"]');
  if (sw) {
    sw.click();
    return "TOGGLED";
  }
  return "NOT_FOUND";
};

window.__checkConsent = function () {
  var cb = document.querySelector('input[type="checkbox"]');
  if (cb) {
    cb.click();
    return "CHECKED";
  }
  return "NOT_FOUND";
};

window.__currentStepHeading = function () {
  var h2s = document.querySelectorAll("h2");
  // On step 1, "2006 Batch Reunion" hero heading appears first.
  // The step heading is the last h2 or inside <main>.
  var main = document.querySelector("main");
  if (main) {
    var mh2 = main.querySelector("h2");
    if (mh2) return mh2.textContent;
  }
  return h2s.length > 0 ? h2s[h2s.length - 1].textContent : "";
};

window.__hasErrorText = function () {
  var ps = document.querySelectorAll("p");
  var errs = [];
  for (var i = 0; i < ps.length; i++) {
    var t = ps[i].textContent || "";
    if (t.indexOf("\u26a0") === 0) errs.push(t.substring(0, 100));
  }
  return errs.length ? JSON.stringify(errs) : "";
};

window.__pageBodyText = function () {
  return document.body.innerText || "";
};

window.__patchDraft = function (jsonPatch) {
  try {
    var raw = localStorage.getItem("smriti_reg_v5");
    if (!raw) return "NO_DRAFT";
    var data = JSON.parse(raw);
    var patch = JSON.parse(jsonPatch);
    Object.assign(data, patch);
    localStorage.setItem("smriti_reg_v5", JSON.stringify(data));
    return "PATCHED: " + JSON.stringify(Object.keys(patch));
  } catch (e) {
    return "ERROR: " + e.message;
  }
};

window.__readDraft = function () {
  var raw = localStorage.getItem("smriti_reg_v5");
  if (!raw) return "NO_DRAFT";
  return raw;
};

window.__selectByTestId = function (testid, value) {
  var el = document.querySelector('[data-testid="' + testid + '"]');
  if (!el) return "NOT_FOUND: " + testid;
  var nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value"
  ).set;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return el.value;
};

window.__clickContinueUntilStep = function (targetHeading) {
  var maxTries = 12;
  for (var i = 0; i < maxTries; i++) {
    var current = window.__currentStepHeading();
    if (current.indexOf(targetHeading) !== -1) return "DONE: " + current;

    var buttons = document.querySelectorAll("button");
    var clicked = false;

    // Step 1: select Full Celebration card if on participation step
    if (current.indexOf("reunion plan") !== -1 || current.indexOf("Participation") !== -1) {
      var card = document.querySelector('[data-testid="plan-full_celebration"]');
      if (card) {
        card.click();
        clicked = true;
      }
    }

    // Then click Continue
    if (!clicked) {
      for (var k = 0; k < buttons.length; k++) {
        var t = buttons[k].textContent || "";
        if (t.indexOf("Continue") !== -1 || t.indexOf("Skip") !== -1) {
          buttons[k].click();
          clicked = true;
          break;
        }
      }
    }

    if (!clicked) return "NO_BUTTON: " + current;
  }
  return "TIMEOUT";
};
