import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveStickyTransition } from '../dist-electron/shared/status.js';

describe('resolveStickyTransition', () => {
  it('applies initial always-on-top without auto-surfacing or arming auto-return', () => {
    const effect = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: null,
      nextOnTop: true,
      prevAutoReturn: null,
      windowState: { isVisible: false, isMinimized: false, isFocused: false },
      isPreferenceChange: false,
    });

    assert.deepEqual(effect, {
      setAlwaysOnTop: true,
      windowAction: 'none',
      nextAutoReturn: null,
    });
  });

  it('pops on top and arms auto-minimize when unfocused behind other windows and an alert arrives', () => {
    const popped = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: false,
      nextOnTop: true,
      prevAutoReturn: null,
      windowState: { isVisible: true, isMinimized: false, isFocused: false },
      isPreferenceChange: false,
    });

    assert.deepEqual(popped, {
      setAlwaysOnTop: true,
      windowAction: 'move_top',
      nextAutoReturn: 'minimize',
    });

    // Even if the user clicks/focuses the widget to handle the alert, clearing the alert still minimizes.
    const cleared = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: true,
      nextOnTop: false,
      prevAutoReturn: popped.nextAutoReturn,
      windowState: { isVisible: true, isMinimized: false, isFocused: true },
      isPreferenceChange: false,
    });

    assert.deepEqual(cleared, {
      setAlwaysOnTop: false,
      windowAction: 'minimize',
      nextAutoReturn: null,
    });
  });

  it('restores without stealing focus and re-minimizes when initially minimized to taskbar (Windows reports isVisible=false while minimized)', () => {
    const restored = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: false,
      nextOnTop: true,
      prevAutoReturn: null,
      windowState: { isVisible: false, isMinimized: true, isFocused: false },
      isPreferenceChange: false,
    });

    assert.deepEqual(restored, {
      setAlwaysOnTop: true,
      windowAction: 'restore_inactive',
      nextAutoReturn: 'minimize',
    });

    const cleared = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: true,
      nextOnTop: false,
      prevAutoReturn: restored.nextAutoReturn,
      windowState: { isVisible: true, isMinimized: false, isFocused: false },
      isPreferenceChange: false,
    });

    assert.deepEqual(cleared, {
      setAlwaysOnTop: false,
      windowAction: 'minimize',
      nextAutoReturn: null,
    });
  });

  it('shows without stealing focus and hides back to tray when initially hidden to system tray', () => {
    const shown = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: false,
      nextOnTop: true,
      prevAutoReturn: null,
      windowState: { isVisible: false, isMinimized: false, isFocused: false },
      isPreferenceChange: false,
    });

    assert.deepEqual(shown, {
      setAlwaysOnTop: true,
      windowAction: 'show_inactive',
      nextAutoReturn: 'hide',
    });

    const cleared = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: true,
      nextOnTop: false,
      prevAutoReturn: shown.nextAutoReturn,
      windowState: { isVisible: true, isMinimized: false, isFocused: false },
      isPreferenceChange: false,
    });

    assert.deepEqual(cleared, {
      setAlwaysOnTop: false,
      windowAction: 'hide',
      nextAutoReturn: null,
    });
  });

  it('does not auto-minimize when the widget was already focused before the alert arrived', () => {
    const surfaced = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: false,
      nextOnTop: true,
      prevAutoReturn: null,
      windowState: { isVisible: true, isMinimized: false, isFocused: true },
      isPreferenceChange: false,
    });

    assert.deepEqual(surfaced, {
      setAlwaysOnTop: true,
      windowAction: 'none',
      nextAutoReturn: null,
    });

    const cleared = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: true,
      nextOnTop: false,
      prevAutoReturn: surfaced.nextAutoReturn,
      windowState: { isVisible: true, isMinimized: false, isFocused: false },
      isPreferenceChange: false,
    });

    assert.deepEqual(cleared, {
      setAlwaysOnTop: false,
      windowAction: 'none',
      nextAutoReturn: null,
    });
  });

  it('does not auto-minimize when stickyMode is manually changed in settings', () => {
    const effect = resolveStickyTransition({
      stickyMode: 'off',
      prevOnTop: true,
      nextOnTop: false,
      prevAutoReturn: 'minimize',
      windowState: { isVisible: true, isMinimized: false, isFocused: true },
      isPreferenceChange: true,
    });

    assert.deepEqual(effect, {
      setAlwaysOnTop: false,
      windowAction: 'none',
      nextAutoReturn: null,
    });
  });

  it('preserves armed auto-return across intermediate polls while alert remains active', () => {
    const steady = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: true,
      nextOnTop: true,
      prevAutoReturn: 'minimize',
      windowState: { isVisible: true, isMinimized: false, isFocused: true },
      isPreferenceChange: false,
    });

    assert.deepEqual(steady, {
      setAlwaysOnTop: null,
      windowAction: 'none',
      nextAutoReturn: 'minimize',
    });
  });

  it('skips minimize if user already hid the widget to tray while alert was active', () => {
    const cleared = resolveStickyTransition({
      stickyMode: 'on_question',
      prevOnTop: true,
      nextOnTop: false,
      prevAutoReturn: 'minimize',
      windowState: { isVisible: false, isMinimized: false, isFocused: false },
      isPreferenceChange: false,
    });

    assert.deepEqual(cleared, {
      setAlwaysOnTop: false,
      windowAction: 'none',
      nextAutoReturn: null,
    });
  });
});
