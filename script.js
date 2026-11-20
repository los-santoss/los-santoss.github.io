(() => {
  'use strict';

  const overlay = document.getElementById('adblock-overlay');
  const title = document.getElementById('adblock-title');
  const message = document.getElementById('adblock-message');
  const status = document.getElementById('adblock-status');
  const reloadButton = document.getElementById('adblock-reload');

  // Si falta alguna pieza del aviso, no se libera la página por seguridad.
  if (!overlay || !title || !message || !status || !reloadButton) return;

  const WAIT_LIMIT_MS = 10000;
  let timeoutId = null;
  let checkStarted = false;
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
  // Los estilos base son normales (no !important) para que los filtros puedan actuar.
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
        // Un error de la prueba no se considera por sí solo un bloqueador.
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

  // Botón único: vuelve a cargar toda la página. La detección comienza otra vez
  // desde cero; si el bloqueador sigue activo, el mismo aviso volverá a aparecer.
  reloadButton.addEventListener('click', () => {
    reloadButton.disabled = true;
    reloadButton.textContent = 'Recargando página…';
    window.location.reload();
  });

  // Bloqueo de teclado mientras el aviso está activo: no permite saltarlo con Tab/Escape.
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

  // Cubre el caso en que el evento load/error ocurrió antes de ejecutar este archivo.
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
