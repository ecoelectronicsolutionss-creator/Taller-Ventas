// Safe DOM construction for all user-supplied and remote chat content.
(function (global) {
    'use strict';

    const ALLOWED_EXTERNAL_HOSTS = new Set(['wa.me']);

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
        asText(value).split('\n').forEach((line, index) => {
            if (index > 0) container.appendChild(document.createElement('br'));
            container.appendChild(document.createTextNode(line));
        });
    }

    function scrollToLatest(chatBody) {
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function renderPlainMessage(chatBody, message, type, id) {
        const bubble = getOrCreateBubble(chatBody, type, id);
        bubble.removeAttribute('data-welcome-message');
        replaceWithTextAndBreaks(bubble, message);
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

    function createSafeExternalLink(label, rawUrl) {
        let url;
        try {
            url = new URL(asText(rawUrl), global.location.origin);
        } catch {
            return document.createTextNode(asText(label));
        }

        const isAllowed =
            url.protocol === 'https:' &&
            ALLOWED_EXTERNAL_HOSTS.has(url.hostname) &&
            !url.username &&
            !url.password &&
            !url.port;

        if (!isAllowed) return document.createTextNode(asText(label));

        const link = document.createElement('a');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'chat-contact-link';
        link.textContent = asText(label);
        return link;
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

    function createTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'typing-indicator';

        for (let index = 0; index < 3; index += 1) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
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

        bubble.appendChild(close);
        bubble.appendChild(document.createTextNode(asText(message)));
        return bubble;
    }

    global.EcoChatRenderer = Object.freeze({
        createProactiveBubble,
        createSafeExternalLink,
        createTypingIndicator,
        normalizeAssistantName,
        renderContactMessage,
        renderPlainMessage,
        renderWelcomeMessage,
        updateWelcomeMessage
    });
}(window));
