// Safe DOM construction for all user-supplied and remote chat content.
(function (global) {
    'use strict';

    const OFFICIAL_SITE_HOSTS = new Set([
        'ecoelectronicsolutions.com.mx',
        'www.ecoelectronicsolutions.com.mx'
    ]);
    const OFFICIAL_MAP_URL = 'https://maps.app.goo.gl/5MztN6VXMfi7YozE6';
    const BUSINESS_PHONE_LINKS = new Map([
        ['2223167820', 'https://wa.me/522223167820'],
        ['2229898801', 'tel:+522229898801']
    ]);

    function asText(value) {
        if (value === null || value === undefined) return '';
        return typeof value === 'string' ? value : String(value);
    }

    function normalizeAssistantName(value) {
        if (typeof value !== 'string') return 'Dalia';
        const clean = value.trim().slice(0, 60);
        return clean || 'Dalia';
    }

    function getOrCreateBubble(chatBody, type, id) {
        const safeType = type === 'user' ? 'user' : 'bot';
        let bubble = id ? document.getElementById(id) : null;

        if (!bubble) {
            bubble = document.createElement('div');
            if (id) bubble.id = id;
            bubble.className = `chat-bubble chat-${safeType}`;
            chatBody.appendChild(bubble);
        }

        return bubble;
    }

    function replaceWithTextAndBreaks(container, value) {
        container.replaceChildren();
        appendTextAndBreaks(container, value);
    }

    function appendTextAndBreaks(container, value) {
        asText(value).split('\n').forEach((line, index) => {
            if (index > 0) container.appendChild(document.createElement('br'));
            container.appendChild(document.createTextNode(line));
        });
    }

    function normalizeBusinessPhone(value) {
        let digits = asText(value).replace(/\D/g, '');
        if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2);
        return BUSINESS_PHONE_LINKS.has(digits) ? digits : '';
    }

    function parseAllowedLink(rawUrl, options = {}) {
        const source = asText(rawUrl).trim();
        if (!source) return null;

        if (/^tel:/i.test(source)) {
            const localPhone = normalizeBusinessPhone(source.slice(4));
            if (!localPhone || !BUSINESS_PHONE_LINKS.get(localPhone).startsWith('tel:')) return null;
            return { href: BUSINESS_PHONE_LINKS.get(localPhone), external: false };
        }

        if (!/^https:\/\//i.test(source) || /^https:\/\/[^/]+:\d+/i.test(source)) return null;

        let url;
        try {
            url = new URL(source);
        } catch {
            return null;
        }

        if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;

        const hostname = url.hostname.toLowerCase();
        let allowed = OFFICIAL_SITE_HOSTS.has(hostname);

        if (hostname === 'wa.me') {
            const isManagedAgentLink = options.allowAgentWhatsApp === true && /^\/\d{10,15}\/?$/.test(url.pathname);
            const isOfficialBusinessLink = /^\/522223167820\/?$/.test(url.pathname);
            allowed = (isOfficialBusinessLink || isManagedAgentLink)
                && [...url.searchParams.keys()].every(key => key === 'text')
                && asText(url.searchParams.get('text')).length <= 500
                && url.href.length <= 800;
        } else if (hostname === 'maps.app.goo.gl') {
            allowed = url.href === OFFICIAL_MAP_URL;
        }

        return allowed ? { href: url.href, external: true } : null;
    }

    function appendSafeLink(container, label, rawUrl, fallbackText, options) {
        const safeUrl = parseAllowedLink(rawUrl, options);
        if (!safeUrl) {
            appendTextAndBreaks(container, fallbackText ?? label);
            return;
        }

        const link = document.createElement('a');
        link.href = safeUrl.href;
        link.className = 'chat-contact-link';
        link.textContent = asText(label);
        if (safeUrl.external) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.referrerPolicy = 'no-referrer';
        }
        container.appendChild(link);
    }

    function findNextAssistantToken(value) {
        const matchers = [
            {
                kind: 'markdown-link',
                regex: /\[([^\]\n]{1,160})\]\((https:\/\/[^)\s]+|tel:[^)\s]+)\)/i
            },
            { kind: 'bold', regex: /\*\*([^*\n]{1,300})\*\*/ },
            { kind: 'url', regex: /https:\/\/[^\s<>"'\])}]+/i },
            {
                kind: 'phone',
                regex: /(?:\+?52[\s.-]?)?222[\s.-]?(?:316[\s.-]?7820|989[\s.-]?8801)/
            }
        ];

        return matchers
            .map((matcher, priority) => {
                const match = matcher.regex.exec(value);
                return match ? { ...matcher, match, priority } : null;
            })
            .filter(Boolean)
            .sort((left, right) => left.match.index - right.match.index || left.priority - right.priority)[0] || null;
    }

    function appendAssistantContent(container, value) {
        let remaining = asText(value);

        while (remaining) {
            const token = findNextAssistantToken(remaining);
            if (!token) {
                appendTextAndBreaks(container, remaining);
                return;
            }

            if (token.match.index > 0) {
                appendTextAndBreaks(container, remaining.slice(0, token.match.index));
            }

            const literal = token.match[0];
            if (token.kind === 'bold') {
                const strong = document.createElement('strong');
                strong.textContent = token.match[1];
                container.appendChild(strong);
            } else if (token.kind === 'markdown-link') {
                appendSafeLink(container, token.match[1], token.match[2], literal);
            } else if (token.kind === 'url') {
                appendSafeLink(container, literal, literal, literal);
            } else {
                const phone = normalizeBusinessPhone(literal);
                appendSafeLink(container, literal, BUSINESS_PHONE_LINKS.get(phone), literal);
            }

            remaining = remaining.slice(token.match.index + literal.length);
        }
    }

    function scrollToLatest(chatBody) {
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function renderPlainMessage(chatBody, message, type, id) {
        const bubble = getOrCreateBubble(chatBody, type, id);
        bubble.removeAttribute('data-welcome-message');
        bubble.replaceChildren();
        if (type === 'user') appendTextAndBreaks(bubble, message);
        else appendAssistantContent(bubble, message);
        scrollToLatest(chatBody);
        return bubble;
    }

    function renderWelcomeMessage(chatBody, assistantName, existingBubble) {
        const bubble = existingBubble || getOrCreateBubble(chatBody, 'bot');
        const safeName = normalizeAssistantName(assistantName);

        bubble.replaceChildren();
        bubble.dataset.welcomeMessage = 'true';
        bubble.appendChild(document.createTextNode('¡Hola! 👋 Soy '));

        const name = document.createElement('strong');
        name.textContent = safeName;
        bubble.appendChild(name);

        bubble.appendChild(document.createTextNode(', tu asesora AI de Eco-Electronic Solutions. ¿En qué te puedo ayudar hoy?'));
        scrollToLatest(chatBody);
        return bubble;
    }

    function updateWelcomeMessage(chatBody, assistantName) {
        const bubble = chatBody.querySelector('[data-welcome-message="true"]');
        if (bubble) renderWelcomeMessage(chatBody, assistantName, bubble);
    }

    function createSafeExternalLink(label, rawUrl, options) {
        const fragment = document.createDocumentFragment();
        appendSafeLink(fragment, label, rawUrl, label, options);
        return fragment;
    }

    function renderContactMessage(chatBody, leadingText, id) {
        const bubble = getOrCreateBubble(chatBody, 'bot', id);
        bubble.removeAttribute('data-welcome-message');
        bubble.replaceChildren(
            document.createTextNode(asText(leadingText)),
            createSafeExternalLink('WhatsApp', 'https://wa.me/522223167820?text=Hola%2C%20Dalia%20est%C3%A1%20en%20mantenimiento.%20Necesito%20ayuda%20con%3A%20'),
            document.createTextNode(' y te atendemos.')
        );
        scrollToLatest(chatBody);
        return bubble;
    }

    function renderHandoffMessage(chatBody, handoff) {
        const name = normalizeAssistantName(handoff?.agentName || 'un asesor');
        const bubble = getOrCreateBubble(chatBody, 'bot');
        bubble.removeAttribute('data-welcome-message');
        bubble.replaceChildren(
            document.createTextNode(`${name} está disponible. `),
            createSafeExternalLink(
                `Hablar con ${name} por WhatsApp`,
                handoff?.url || '',
                { allowAgentWhatsApp: true }
            ),
            document.createTextNode('.')
        );
        scrollToLatest(chatBody);
        return bubble;
    }

    function createTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'typing-indicator';
        indicator.setAttribute('role', 'status');
        indicator.setAttribute('aria-label', 'Dalia está escribiendo');

        for (let index = 0; index < 3; index += 1) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            dot.setAttribute('aria-hidden', 'true');
            indicator.appendChild(dot);
        }

        return indicator;
    }

    function createProactiveBubble(message) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-proactive-bubble';

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'bubble-close';
        close.id = 'bubble-close-btn';
        close.setAttribute('aria-label', 'Cerrar');
        close.textContent = '×';

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'bubble-open';
        open.setAttribute('aria-label', `Abrir chat: ${asText(message)}`);
        open.textContent = asText(message);

        bubble.append(close, open);
        return bubble;
    }

    global.EcoChatRenderer = Object.freeze({
        createProactiveBubble,
        createSafeExternalLink,
        createTypingIndicator,
        normalizeAssistantName,
        renderContactMessage,
        renderHandoffMessage,
        renderPlainMessage,
        renderWelcomeMessage,
        updateWelcomeMessage
    });
}(window));
