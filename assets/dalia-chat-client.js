/**
 * Cliente público seguro para Dalia AI Manager.
 * La clave administrativa nunca se envía al navegador. Cada mensaje usa un
 * token Cloudflare Turnstile de un solo uso que el servidor valida.
 */
(function initializeDaliaChatClient() {
    'use strict';

    const API_BASE = 'https://ai.ecoelectronicsolutions.com.mx';
    const HEALTH_URL = `${API_BASE}/v1/health`;
    const CHAT_URL = `${API_BASE}/v1/chat/completions`;
    const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    const ACTION = 'dalia_chat';

    let healthSnapshot = null;
    let turnstileLoader = null;
    let widgetId = null;
    let widgetSiteKey = '';
    let pendingChallenge = null;

    function errorWithCode(message, code) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const forwardAbort = () => controller.abort();
        if (options.signal) {
            if (options.signal.aborted) forwardAbort();
            else options.signal.addEventListener('abort', forwardAbort, { once: true });
        }

        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener?.('abort', forwardAbort);
        }
    }

    async function checkHealth() {
        const response = await fetchWithTimeout(HEALTH_URL, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        }, 6000);
        if (!response.ok) throw errorWithCode(`Dalia respondió HTTP ${response.status}.`, 'HEALTH_HTTP_ERROR');
        healthSnapshot = await response.json();
        return { ...healthSnapshot };
    }

    function loadTurnstileScript() {
        if (window.turnstile) return Promise.resolve(window.turnstile);
        if (turnstileLoader) return turnstileLoader;

        turnstileLoader = new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${TURNSTILE_SCRIPT}"]`);
            const script = existing || document.createElement('script');
            const timeout = setTimeout(() => reject(errorWithCode('Turnstile tardó demasiado en cargar.', 'TURNSTILE_TIMEOUT')), 15000);
            const complete = () => {
                clearTimeout(timeout);
                if (window.turnstile) resolve(window.turnstile);
                else reject(errorWithCode('Turnstile no quedó disponible.', 'TURNSTILE_UNAVAILABLE'));
            };
            script.addEventListener('load', complete, { once: true });
            script.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(errorWithCode('No se pudo cargar la protección Turnstile.', 'TURNSTILE_UNAVAILABLE'));
            }, { once: true });
            if (!existing) {
                script.src = TURNSTILE_SCRIPT;
                script.async = true;
                script.defer = true;
                document.head.appendChild(script);
            }
        });

        return turnstileLoader;
    }

    function settleChallenge(method, value) {
        if (!pendingChallenge) return;
        const pending = pendingChallenge;
        pendingChallenge = null;
        clearTimeout(pending.timeout);
        pending[method](value);
    }

    function chooseTurnstileSize(container) {
        const styles = window.getComputedStyle(container);
        const horizontalPadding = Number.parseFloat(styles.paddingLeft || '0')
            + Number.parseFloat(styles.paddingRight || '0');
        const availableWidth = Math.max(0, container.clientWidth - horizontalPadding);
        return availableWidth >= 300 ? 'flexible' : 'compact';
    }

    async function ensureTurnstile(siteKey) {
        if (!siteKey) throw errorWithCode('Dalia todavía no tiene una clave pública Turnstile.', 'PUBLIC_CHAT_DISABLED');
        const turnstile = await loadTurnstileScript();
        if (widgetId !== null && widgetSiteKey === siteKey) return turnstile;

        const container = document.getElementById('dalia-turnstile');
        if (!container) throw errorWithCode('Falta el contenedor de seguridad del chat.', 'TURNSTILE_CONTAINER_MISSING');
        container.replaceChildren();
        widgetSiteKey = siteKey;
        widgetId = turnstile.render(container, {
            sitekey: siteKey,
            action: ACTION,
            size: chooseTurnstileSize(container),
            language: 'es',
            theme: 'auto',
            execution: 'execute',
            appearance: 'interaction-only',
            callback: token => settleChallenge('resolve', token),
            'error-callback': code => settleChallenge('reject', errorWithCode(`Turnstile rechazó el reto (${code || 'sin código'}).`, 'TURNSTILE_REJECTED')),
            'expired-callback': () => settleChallenge('reject', errorWithCode('El reto Turnstile expiró.', 'TURNSTILE_EXPIRED')),
            'timeout-callback': () => settleChallenge('reject', errorWithCode('El reto Turnstile excedió el tiempo disponible.', 'TURNSTILE_TIMEOUT')),
        });
        return turnstile;
    }

    async function getTurnstileToken(siteKey) {
        const turnstile = await ensureTurnstile(siteKey);
        if (pendingChallenge) throw errorWithCode('Ya hay una verificación en curso.', 'TURNSTILE_BUSY');

        return new Promise((resolve, reject) => {
            pendingChallenge = {
                resolve,
                reject,
                timeout: setTimeout(() => settleChallenge('reject', errorWithCode('No se completó la verificación de seguridad.', 'TURNSTILE_TIMEOUT')), 30000),
            };
            try {
                turnstile.reset(widgetId);
                turnstile.execute(widgetId);
            } catch (error) {
                settleChallenge('reject', errorWithCode(error.message || 'No se pudo iniciar Turnstile.', 'TURNSTILE_EXECUTION_ERROR'));
            }
        });
    }

    function parseEvent(rawEvent, callbacks, state) {
        const dataText = rawEvent
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).replace(/^ /, ''))
            .join('\n');
        if (!dataText || dataText === '[DONE]') return;

        let event;
        try { event = JSON.parse(dataText); } catch { return; }
        if (event.error) throw errorWithCode(String(event.error), 'DALIA_STREAM_ERROR');
        if (event.handoff) {
            state.handoff = event.handoff;
            callbacks.onHandoff?.(event.handoff);
        }
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
            state.text += delta;
            callbacks.onDelta?.(delta, state.text);
        }
    }

    async function streamChat({ messages, sessionId, onDelta, onHandoff, signal }) {
        const health = healthSnapshot || await checkHealth();
        if (!health.public_chat_enabled || !health.turnstile_site_key) {
            throw errorWithCode('El chat público de Dalia aún no está habilitado.', 'PUBLIC_CHAT_DISABLED');
        }
        if (!health.lmstudio_online) throw errorWithCode('El motor local de Dalia no está disponible.', 'LMSTUDIO_OFFLINE');

        const token = await getTurnstileToken(health.turnstile_site_key);
        const response = await fetchWithTimeout(CHAT_URL, {
            method: 'POST',
            headers: {
                Accept: 'text/event-stream',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: Array.isArray(messages) ? messages.slice(-30) : [],
                stream: true,
                session_id: sessionId,
                turnstile_token: token,
            }),
            signal,
        }, 95000);

        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json()).error || ''; } catch { /* respuesta no JSON */ }
            const code = response.status === 429 ? 'RATE_LIMITED'
                : response.status === 403 ? 'TURNSTILE_REJECTED'
                : response.status === 401 ? 'UNAUTHORIZED'
                : 'CHAT_HTTP_ERROR';
            throw errorWithCode(detail || `Dalia respondió HTTP ${response.status}.`, code);
        }
        if (!response.body) throw errorWithCode('Dalia no devolvió un flujo de respuesta.', 'EMPTY_STREAM');

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        const state = { text: '', handoff: null };
        const callbacks = { onDelta, onHandoff };
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            let separator;
            while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
                const rawEvent = buffer.slice(0, separator);
                const separatorText = buffer.slice(separator).match(/^\r?\n\r?\n/)[0];
                buffer = buffer.slice(separator + separatorText.length);
                parseEvent(rawEvent, callbacks, state);
            }
            if (done) break;
        }
        if (buffer.trim()) parseEvent(buffer, callbacks, state);
        if (!state.text.trim()) throw errorWithCode('Dalia no generó una respuesta.', 'EMPTY_RESPONSE');
        return { text: state.text.trim(), handoff: state.handoff };
    }

    window.DaliaChatClient = Object.freeze({
        apiBase: API_BASE,
        checkHealth,
        streamChat,
    });
})();
