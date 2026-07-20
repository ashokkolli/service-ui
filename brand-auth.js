/* FASTBREAK auto-login hook — DISABLED by default, no baked credentials.
 *
 * History / decision (2026-07-13): the previous version of this file baked the
 * default superadmin credentials into client JS, hid the whole page with
 * `visibility:hidden` while it tried to auto-submit RP's login form, and — because
 * RP's login field has a client-side email-validator that rejects a non-email login
 * like "superadmin" and blocks submit before any API call — never actually landed
 * the user in the app. The hidden body produced the white/blank-page bug. A 3s
 * failsafe reveal only papered over a path that cannot currently succeed.
 *
 * PM decision: RP's OWN native login is the reliable default path. This file must
 * therefore ship NO credentials and must NEVER hide the page, so the native login
 * form always renders normally (fully visible, ~immediately, no white page, no
 * auto-submit loop). Auto-login is preserved only as an OFF-by-default, env-gated,
 * deploy-time capability.
 *
 * HOW TO RE-ENABLE (future, without committing any secret):
 *   Auto-login runs ONLY if a build/deploy step injects a config global BEFORE this
 *   script, e.g. an inline <script> templated from env at image-build time:
 *
 *     window.__FB_AUTOLOGIN__ = { enabled: true, user: '<RP_AUTOLOGIN_USER>',
 *                                 pass: '<RP_AUTOLOGIN_PASS>' };
 *
 *   Gate that injection behind RP_AUTOLOGIN_ENABLED (default false). With the flag
 *   unset the global is absent, this script is a no-op, and RP's native form shows.
 *   No credential ever lives in this committed file or in the served bundle.
 *
 *   NOTE / dependency: re-enabling is conditioned on a CONFIRMED, form-accepted
 *   credential. RP's login field client-side-validates for an email address, so a
 *   non-email account (e.g. "superadmin") is rejected with "Email is incorrect" and
 *   its submit never fires an API call. This hook does NOT claim to work until a
 *   working, form-accepted credential is supplied via env.
 *
 * This script NEVER applies `visibility:hidden` (or any page-hiding style) under any
 * code path — enabled or not — so there is no white-page risk.
 */
(function () {
  'use strict';

  // Deploy-time, env-driven config. Absent by default -> auto-login stays OFF and
  // the native RP login form renders untouched. Nothing below runs.
  var cfg = window.__FB_AUTOLOGIN__;
  if (!cfg || cfg.enabled !== true || !cfg.user || !cfg.pass) {
    return;  // no-op: native ReportPortal login is the default path
  }

  var USER = String(cfg.user);
  var PASS = String(cfg.pass);

  function onLoginPage() {
    return /login/.test(location.hash || '') ||
      !!document.querySelector('input[name="login"]');
  }

  // React controlled inputs ignore a plain `.value =` — set through the native
  // setter and fire input/change so RP's state updates before we submit.
  function setVal(el, v) {
    var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    desc.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  var lastSubmit = 0;
  function submitLogin() {
    var u = document.querySelector('input[name="login"]');
    var p = document.querySelector('input[name="password"]');
    if (!u || !p) return;
    var now = Date.now();
    if (now - lastSubmit < 2500) return;  // debounce — don't hammer the form
    lastSubmit = now;
    setVal(u, USER);
    setVal(p, PASS);
    var btn = document.querySelector('button[type="submit"]');
    if (!btn) {
      var bs = document.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) {
        if (/login/i.test(bs[i].textContent || '')) { btn = bs[i]; break; }
      }
    }
    if (btn) setTimeout(function () { try { btn.click(); } catch (e) {} }, 80);
  }

  // Bounded watcher: poll for the login form (mounts async) and submit. We NEVER
  // hide the page while doing so. To avoid an infinite hammer loop when the
  // credential is rejected (e.g. the email-validator gate), give up after a small
  // number of attempts and simply leave RP's native form visible for manual login.
  var MAX_ATTEMPTS = 5;
  var attempts = 0;
  var timer = setInterval(function () {
    try {
      if (onLoginPage()) {
        if (attempts++ >= MAX_ATTEMPTS) { clearInterval(timer); return; }
        submitLogin();
      } else {
        clearInterval(timer);  // in the app — done
      }
    } catch (e) {
      clearInterval(timer);
    }
  }, 400);
})();
