'use strict';

/*
 * Motion layer (GSAP). Elements are always visible by default; every helper
 * degrades to the final state when GSAP didn't load or the OS asks for reduced
 * motion, so the UI never depends on an animation finishing.
 */
(function () {
  const g = window.gsap;
  const on = !!g && !matchMedia('(prefers-reduced-motion: reduce)').matches;

  const EASE = { out: 'power3.out', expo: 'expo.out', spring: 'back.out(1.5)', in: 'power2.in' };

  /** Staggered fade/rise for a list of elements (only the first `max` — the rest just appear). */
  function enter(els, { y = 10, duration = 0.5, each = 0.035, max = 14, delay = 0 } = {}) {
    const list = [...els].slice(0, max);
    if (!on || !list.length) return;
    g.fromTo(list, { opacity: 0, y }, { opacity: 1, y: 0, duration, ease: EASE.out, stagger: each, delay, clearProps: 'transform,opacity' });
  }

  /** Content of a view arriving. */
  function viewIn(el) {
    if (!on) return;
    g.killTweensOf(el);
    g.fromTo(el, { opacity: 0, y: 12, scale: 0.995 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: EASE.out, clearProps: 'transform,opacity' });
  }

  /** Centered sheet over a scrim: spring in, quick ease out. */
  function sheetOpen(scrim, sheet) {
    scrim.hidden = false;
    if (!on) return;
    g.killTweensOf([scrim, sheet]);
    g.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1.out' });
    g.fromTo(sheet, { opacity: 0, scale: 0.94, y: 16 }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: EASE.spring });
  }

  function sheetClose(scrim, sheet) {
    if (!on) { scrim.hidden = true; return; }
    g.killTweensOf([scrim, sheet]);
    g.to(sheet, { opacity: 0, scale: 0.97, y: 8, duration: 0.2, ease: EASE.in });
    g.to(scrim, { opacity: 0, duration: 0.22, onComplete: () => { scrim.hidden = true; } });
  }

  /** Pane that opens/closes by animating its width (inner content keeps a fixed width, so text never reflows). */
  function slideWidth(el, to, { onComplete } = {}) {
    if (!on) { el.style.width = `${to}px`; onComplete?.(); return; }
    g.killTweensOf(el);
    g.to(el, { width: to, duration: to ? 0.55 : 0.4, ease: EASE.expo, onComplete });
  }

  /** Transient toast, rising from the bottom edge with a little spring. */
  function toast(el, ms = 3200) {
    const remove = () => el.remove();
    if (!on) { setTimeout(remove, ms); return; }
    g.fromTo(el, { y: 28, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.55, ease: EASE.spring });
    g.to(el, { y: 14, opacity: 0, scale: 0.96, duration: 0.3, ease: EASE.in, delay: ms / 1000, onComplete: remove });
  }

  /** Tween an integer in an element's text. */
  function count(el, to) {
    const from = parseInt(el.textContent, 10) || 0;
    if (!on || from === to) { el.textContent = to; return; }
    const o = { v: from };
    g.to(o, { v: to, duration: 0.7, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(o.v); } });
  }

  /** Slide a selection highlight to `target` (a row inside scrollable `container`). */
  function movePill(pill, target, container, instant) {
    if (!target) { pill.style.opacity = '0'; return; }
    const y = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    const h = target.offsetHeight;
    if (!on || instant || pill.dataset.placed !== '1') {
      if (on) g.set(pill, { y, height: h, opacity: 1 });
      else { pill.style.transform = `translateY(${y}px)`; pill.style.height = `${h}px`; pill.style.opacity = '1'; }
      pill.dataset.placed = '1';
      return;
    }
    g.to(pill, { y, height: h, opacity: 1, duration: 0.5, ease: EASE.expo, overwrite: 'auto' });
  }

  /**
   * Segmented control: buttons carry data-value, the active one gets
   * aria-pressed and a thumb slides underneath it.
   */
  function segmented(el, value, onChange) {
    const thumb = document.createElement('span');
    thumb.className = 'seg-thumb';
    el.prepend(thumb);
    const buttons = () => [...el.querySelectorAll('button')];
    let current = value;

    const place = instant => {
      const active = buttons().find(b => b.dataset.value === current);
      if (!active || !active.offsetWidth) return;
      const vars = { x: active.offsetLeft, width: active.offsetWidth };
      if (on && !instant) g.to(thumb, { ...vars, duration: 0.45, ease: EASE.expo, overwrite: 'auto' });
      else if (on) g.set(thumb, vars);
      else { thumb.style.transform = `translateX(${vars.x}px)`; thumb.style.width = `${vars.width}px`; }
    };
    const set = (v, { silent = false, instant = false } = {}) => {
      current = v;
      buttons().forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === v)));
      place(instant);
      if (!silent) onChange?.(v);
    };

    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-value]');
      if (b && b.dataset.value !== current) set(b.dataset.value);
    });
    new ResizeObserver(() => place(true)).observe(el); // also fires when a hidden view becomes visible
    set(value, { silent: true, instant: true });
    return { set, get: () => current };
  }

  /** Expand/collapse a block (sidebar category). `after` fires every frame so dependent geometry can follow. */
  function toggleOpen(el, open, after) {
    if (!on) { el.hidden = !open; after?.(); return; }
    g.killTweensOf(el);
    if (open) {
      el.hidden = false;
      g.fromTo(el, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.5, ease: EASE.expo, clearProps: 'height,opacity', onUpdate: after, onComplete: after });
    } else {
      g.to(el, { height: 0, opacity: 0, duration: 0.32, ease: 'power3.inOut', onUpdate: after, onComplete: () => { el.hidden = true; g.set(el, { clearProps: 'height,opacity' }); after?.(); } });
    }
  }

  /** Quick attention pulse (e.g. a badge whose count just changed). */
  function pulse(el) {
    if (on) g.fromTo(el, { scale: 1.25 }, { scale: 1, duration: 0.5, ease: EASE.spring });
  }

  window.Motion = { enabled: on, enter, viewIn, sheetOpen, sheetClose, slideWidth, toast, count, movePill, segmented, toggleOpen, pulse };
})();
