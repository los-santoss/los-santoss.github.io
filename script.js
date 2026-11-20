(() => {
  'use strict';

  const overlay = document.getElementById('adblock-overlay');
  const title = document.getElementById('adblock-title');
  const message = document.getElementById('adblock-message');
  const status = document.getElementById('adblock-status');
  const retryButton = document.getElementById('adblock-recheck');
  const monetagUrlPart = 'quge5.com/88/tag.min.js';
  const baitClasses = ['adsbox', 'ad-placement', 'ad-banner', 'adsbygoogle'];

  if (!overlay || !title || !message || !status || !retryButton) return;

  let checkTimer = null;
  let gaveUpWaiting = false;
  let lastCheckAt = 0;
  let retryingScript = false;

  function setPageLocked(locked) {
    document.body.classList.toggle('adblock-locked', locked);
    for (const child of document.body.children) {
      if (child === overlay || child.tagName === 'SCRIPT') continue;
      child.inert = locked;
    }
    overlay.setAttribute('aria-hidden', String(!locked));
    if (locked) {
      try { retryButton.focus({ preventScroll: true }); } catch (_) { retryButton.focus(); }
    }
  }

  function showBlocked(reason) {
    // Asegura que el aviso vuelva a ser visible si el bloqueo aparece después de habilitar la página.
    overlay.style.display = '';
    overlay.removeAttribute('aria-hidden');
    title.textContent = 'Desactivá tu bloqueador de anuncios';
    message.textContent = reason || 'Detectamos que tu navegador está bloqueando la publicidad. Desactivá el bloqueador para este sitio y volvé a comprobarlo.';
    status.textContent = 'La página permanecerá bloqueada hasta que la comprobación sea correcta.';
    retryButton.disabled = false;
    retryButton.textContent = 'Ya lo desactivé — Volver a comprobar';
    setPageLocked(true);
  }

  function showChecking(text) {
    title.textContent = 'Comprobando publicidad';
    message.textContent = 'Estamos verificando que el navegador permita cargar los anuncios necesarios para este sitio.';
    status.textContent = text || 'Un momento, por favor…';
    retryButton.disabled = true;
    retryButton.textContent = 'Comprobando…';
    setPageLocked(true);
  }

  function unlockPage() {
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.display = 'none';
    setPageLocked(false);
  }

  function lockOverlayVisible() {
    overlay.style.display = '';
    overlay.removeAttribute('aria-hidden');
  }

  // Prueba local: algunos filtros cosméticos ocultan señuelos habituales de anuncios.
  function hasBlockedAdBait() {
    for (const className of baitClasses) {
      const bait = document.createElement('div');
      bait.className = className;
      bait.setAttribute('aria-hidden', 'true');
      bait.style.cssText = [
        'position:fixed!important',
        'left:-10000px!important',
        'top:0!important',
        'display:block!important',
        'visibility:visible!important',
        'opacity:1!important',
        'width:12px!important',
        'height:12px!important',
        'min-width:12px!important',
        'min-height:12px!important',
        'pointer-events:none!important',
        'z-index:-1!important'
      ].join(';');
      document.body.appendChild(bait);
      const computed = window.getComputedStyle(bait);
      const rect = bait.getBoundingClientRect();
      const hidden = bait.offsetWidth === 0 || bait.offsetHeight === 0 ||
        rect.width === 0 || rect.height === 0 ||
        computed.display === 'none' || computed.visibility === 'hidden' ||
        Number(computed.opacity) === 0;
      bait.remove();
      if (hidden) return true;
    }
    return false;
  }

  function monetagScriptElement() {
    return Array.from(document.scripts).find(script =>
      script.src && script.src.includes(monetagUrlPart)
    );
  }

  function reloadMonetagScript() {
    const oldScript = monetagScriptElement();
    if (!oldScript || retryingScript) return false;

    retryingScript = true;
    window.__monetagLoadState = 'pending';
    const replacement = document.createElement('script');
    // Copia exactamente los atributos del código entregado por Monetag.
    for (const attribute of oldScript.attributes) {
      replacement.setAttribute(attribute.name, attribute.value);
    }
    replacement.addEventListener('load', () => {
      window.__monetagLoadState = 'loaded';
      retryingScript = false;
      evaluatePage();
    }, { once: true });
    replacement.addEventListener('error', () => {
      window.__monetagLoadState = 'blocked';
      retryingScript = false;
      showBlocked('No se pudo cargar el archivo de Monetag. Desactivá el bloqueador para este sitio; si ya lo hiciste, comprobá tu conexión y volvé a intentarlo.');
    }, { once: true });
    oldScript.replaceWith(replacement);
    return true;
  }

  function evaluatePage() {
    if (!document.body) return;
    lastCheckAt = Date.now();

    let baitBlocked = false;
    try {
      baitBlocked = hasBlockedAdBait();
    } catch (_) {
      // Una excepción en la prueba local no se interpreta automáticamente como bloqueo.
    }

    const loadState = window.__monetagLoadState || 'pending';
    if (baitBlocked || loadState === 'blocked') {
      showBlocked(baitBlocked
        ? 'Detectamos señales de un bloqueador de anuncios. Desactivalo para este sitio y volvé a comprobarlo.'
        : 'No se pudo cargar el archivo publicitario de Monetag. Desactivá el bloqueador para este sitio y volvé a comprobarlo.');
      return;
    }

    if (loadState === 'loaded') {
      gaveUpWaiting = false;
      unlockPage();
      return;
    }

    // No liberar el contenido mientras el script principal siga sin confirmar su carga.
    if (gaveUpWaiting) {
      showBlocked('Todavía no pudimos verificar la carga de Monetag. Desactivá cualquier protección o bloqueador para este sitio y volvé a comprobarlo.');
    } else {
      showChecking('Esperando la respuesta del servicio de anuncios…');
    }
  }

  function scheduleEvaluate(delay = 250) {
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(evaluatePage, delay);
  }

  // Estos eventos se capturan desde el <head>, antes de que el script publicitario termine.
  window.addEventListener('monetag-script-ready', () => scheduleEvaluate(150));
  window.addEventListener('monetag-script-error', () => {
    window.__monetagLoadState = 'blocked';
    showBlocked('El navegador impidió cargar la publicidad. Desactivá el bloqueador para este sitio y volvé a comprobarlo.');
  });

  retryButton.addEventListener('click', () => {
    lockOverlayVisible();
    showChecking('Volviendo a comprobar…');
    gaveUpWaiting = false;
    const state = window.__monetagLoadState || 'pending';
    if (state === 'blocked' || state === 'timeout') {
      if (!reloadMonetagScript()) scheduleEvaluate(500);
    } else {
      scheduleEvaluate(500);
    }
  });

  // El usuario no puede cerrar el aviso con Escape ni tabular hacia el contenido bloqueado.
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('adblock-locked')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      retryButton.focus();
    }
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastCheckAt > 1200) scheduleEvaluate(200);
  });
  window.addEventListener('focus', () => {
    if (Date.now() - lastCheckAt > 1200) scheduleEvaluate(200);
  });
  window.addEventListener('online', () => scheduleEvaluate(300));

  // Primera verificación. Si el tag no responde, el sitio permanece bloqueado.
  lockOverlayVisible();
  showChecking('Comprobando que la publicidad pueda cargarse…');
  scheduleEvaluate(300);
  window.setTimeout(() => {
    if ((window.__monetagLoadState || 'pending') === 'pending') {
      gaveUpWaiting = true;
      window.__monetagLoadState = 'timeout';
      showBlocked('No pudimos confirmar la carga de la publicidad. Desactivá el bloqueador para este sitio y volvé a comprobarlo.');
    }
  }, 9000);

  // Desplazamiento suave para enlaces internos, sin romper href vacíos o selectores inválidos.
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
