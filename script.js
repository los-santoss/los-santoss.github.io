(() => {
  'use strict';

  // ---------------------------------------------------------------
  // Service worker de Monetag (sw.js, sin modificar).
  // Los formatos de notificaciones push en Android dependen de él.
  // Registrarlo es idempotente: si la etiqueta ya lo registró, no pasa nada.
  // ---------------------------------------------------------------
  function registerPushWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    } catch (_) { /* ignorado */ }
  }
  if (document.readyState === 'complete') {
    registerPushWorker();
  } else {
    window.addEventListener('load', registerPushWorker, { once: true });
  }

  // Si la página vuelve desde la caché "atrás/adelante" del navegador móvil,
  // se recarga para que la publicidad y la comprobación empiecen de cero.
  window.addEventListener('pageshow', event => {
    if (event.persisted) window.location.reload();
  });

  const overlay = document.getElementById('adblock-overlay');
  const title = document.getElementById('adblock-title');
  const message = document.getElementById('adblock-message');
  const status = document.getElementById('adblock-status');
  const reloadButton = document.getElementById('adblock-reload');

  // Si falta alguna pieza del aviso, no se libera la página por seguridad.
  if (!overlay || !title || !message || !status || !reloadButton) return;

  // En redes móviles la etiqueta puede tardar bastante más que en PC.
  const WAIT_LIMIT_MS = 20000;
  let timeoutId = null;
  let finished = false;

  function keepPageLocked() {
    document.body.classList.add('adblock-locked');
    document.body.classList.remove('adblock-ready');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.inert = false;
  }

  function showBlocked(reason) {
    finished = true;
    window.clearTimeout(timeoutId);
    keepPageLocked();
    title.textContent = 'Desactivá tu bloqueador de anuncios';
    message.textContent = reason ||
      'Para usar esta página tenés que desactivar el bloqueador de anuncios para este sitio.';
    status.textContent = 'No vas a poder utilizar la web hasta desactivar el bloqueador y recargar la página.';
    reloadButton.disabled = false;
    reloadButton.textContent = 'Ya desactivé el bloqueador — Recargar página';
  }

  function unlockPage() {
    finished = true;
    window.clearTimeout(timeoutId);
    document.body.classList.remove('adblock-locked');
    document.body.classList.add('adblock-ready');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
  }

  // Los bloqueadores cosméticos suelen ocultar elementos que imitan anuncios.
  function detectsCosmeticBlocking() {
    const bait = document.createElement('div');
    bait.className = 'adsbox ad-banner ad-placement adsbygoogle adunit';
    bait.setAttribute('aria-hidden', 'true');
    bait.style.cssText = 'position:absolute;left:-10000px;top:-10000px;width:12px;height:12px;';
    document.body.appendChild(bait);

    const computed = window.getComputedStyle(bait);
    const rect = bait.getBoundingClientRect();
    const blocked = bait.offsetWidth === 0 || bait.offsetHeight === 0 ||
      rect.width === 0 || rect.height === 0 ||
      computed.display === 'none' || computed.visibility === 'hidden' ||
      Number(computed.opacity) === 0;

    bait.remove();
    return blocked;
  }

  function evaluateLoadedAdScript() {
    // Pequeño margen para que las reglas cosméticas del navegador se apliquen.
    window.setTimeout(() => {
      if (finished) return;
      let cosmeticBlock = false;
      try {
        cosmeticBlock = detectsCosmeticBlocking();
      } catch (error) {
        cosmeticBlock = false;
      }

      if (cosmeticBlock) {
        showBlocked('Detectamos un bloqueador de anuncios activo. Desactivalo para este sitio y después recargá la página.');
      } else {
        unlockPage();
      }
    }, 250);
  }

  function handleAdResource(state) {
    if (state === 'blocked') {
      showBlocked('El navegador impidió cargar la publicidad. Desactivá el bloqueador de anuncios para este sitio y recargá la página.');
      return;
    }
    if (state === 'loaded') {
      evaluateLoadedAdScript();
    }
  }

  reloadButton.addEventListener('click', () => {
    reloadButton.disabled = true;
    reloadButton.textContent = 'Recargando página…';
    window.location.reload();
  });

  // Mientras el aviso está activo, Tab/Escape no permiten saltarlo.
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('adblock-locked')) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      reloadButton.focus({ preventScroll: true });
    }
  }, true);

  window.addEventListener('monetag-resource', event => {
    handleAdResource(event.detail && event.detail.state);
  });

  // Cubre el caso en que load/error ocurrió antes de ejecutar este archivo.
  const initialState = window.__monetagLoadState || 'pending';
  if (initialState === 'loaded' || initialState === 'blocked') {
    handleAdResource(initialState);
  } else {
    keepPageLocked();
    title.textContent = 'Comprobando publicidad';
    message.textContent = 'Estamos comprobando que tu navegador permita cargar los anuncios del sitio.';
    status.textContent = 'La página se habilitará cuando termine la comprobación.';
    reloadButton.disabled = true;
    reloadButton.textContent = 'Comprobando…';

    timeoutId = window.setTimeout(() => {
      if (!finished && (window.__monetagLoadState || 'pending') === 'pending') {
        showBlocked('No pudimos confirmar la carga de los anuncios. Desactivá el bloqueador de anuncios para este sitio y recargá la página. Si ya lo desactivaste, verificá tu conexión e intentá nuevamente.');
      }
    }, WAIT_LIMIT_MS);
  }

  // Desplazamiento suave para los enlaces internos.
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', event => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;
      let target;
      try { target = document.querySelector(href); } catch (_) { return; }
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();

// ===================================================================
// Ventana "Mira todo el anuncio" antes de cada descarga.
// El conteo de 10 s solo avanza mientras esta pestaña está visible:
// si el anuncio se abre en otra pestaña, hay que volver para seguir.
// ===================================================================
(() => {
  'use strict';

  const GATE_SECONDS = 10;

  const gate = document.getElementById('gate-overlay');
  const secondsEl = document.getElementById('gate-seconds');
  const barWrap = gate && gate.querySelector('.gate-bar');
  const barFill = document.getElementById('gate-bar-fill');
  const statusEl = document.getElementById('gate-status');
  const textEl = document.getElementById('gate-text');
  const continueLink = document.getElementById('gate-continue');
  const cancelBtn = document.getElementById('gate-cancel');
  if (!gate || !secondsEl || !barFill || !statusEl || !textEl || !continueLink || !cancelBtn) return;

  let intervalId = null;
  let targetUrl = '';
  let elapsedMs = 0;
  let lastTick = 0;
  let lastFocus = null;

  function stopTimer() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function closeGate() {
    stopTimer();
    gate.hidden = true;
    document.body.classList.remove('gate-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus({ preventScroll: true });
    }
  }

  function render() {
    const left = Math.max(0, GATE_SECONDS - elapsedMs / 1000);
    const pct = Math.min(100, (elapsedMs / (GATE_SECONDS * 1000)) * 100);
    secondsEl.textContent = String(Math.ceil(left));
    barFill.style.width = pct + '%';
    if (barWrap) barWrap.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  function finish() {
    stopTimer();
    elapsedMs = GATE_SECONDS * 1000;
    render();
    statusEl.textContent = 'Anuncio completado. Abriendo la descarga…';

    // Se intenta abrir solo. Si el navegador móvil lo bloquea (no hay toque reciente),
    // queda el botón "Continuar" para abrirlo con un toque.
    let opened = null;
    try { opened = window.open(targetUrl, '_blank'); } catch (_) { opened = null; }

    if (opened) {
      try { opened.opener = null; } catch (_) { /* ignorado */ }
      closeGate();
    } else {
      continueLink.href = targetUrl;
      continueLink.hidden = false;
      statusEl.textContent = 'Anuncio completado. Toca el botón para continuar.';
      continueLink.focus({ preventScroll: true });
    }
  }

  function tick() {
    const now = performance.now();
    const delta = now - lastTick;
    lastTick = now;

    const visible = document.visibilityState === 'visible';
    if (visible) elapsedMs += delta;

    statusEl.textContent = visible
      ? 'Viendo anuncio… no cierres esta ventana.'
      : 'Vuelve a esta pestaña para que continúe el conteo.';

    render();
    if (elapsedMs >= GATE_SECONDS * 1000) finish();
  }

  function openGate(url, label) {
    targetUrl = url;
    elapsedMs = 0;
    lastFocus = document.activeElement;
    continueLink.hidden = true;
    textEl.textContent = 'Tu descarga de ' + label + ' comenzará cuando termine el anuncio.';
    statusEl.textContent = 'Esperando el anuncio…';
    render();

    gate.hidden = false;
    document.body.classList.add('gate-open');
    cancelBtn.focus({ preventScroll: true });

    stopTimer();
    lastTick = performance.now();
    intervalId = window.setInterval(tick, 250);
  }

  // Los dos botones de descarga (APK y datos).
  document.querySelectorAll('a[data-gate]').forEach(link => {
    link.addEventListener('click', event => {
      // Solo se cancela la navegación directa; el clic sigue llegando a Monetag.
      event.preventDefault();
      if (document.body.classList.contains('adblock-locked')) return;
      openGate(link.href, link.getAttribute('data-gate') || 'el archivo');
    });
  });

  continueLink.addEventListener('click', () => {
    window.setTimeout(closeGate, 300);
  });
  cancelBtn.addEventListener('click', closeGate);

  document.addEventListener('keydown', event => {
    if (gate.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeGate();
    } else if (event.key === 'Tab') {
      // Mantiene el foco dentro de la ventana.
      const items = [continueLink, cancelBtn].filter(el => !el.hidden);
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
})();
