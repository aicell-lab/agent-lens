import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

const ChatbotButton = ({ microscopeControlService, appendLog }) => {
    const [chatUrl, setChatUrl] = useState(null);
    const [isHyphaReady, setIsHyphaReady] = useState(false);

    useEffect(() => {
        const initializeHyphaCore = async () => {
            if (!window.hyphaCore || !window.hyphaApi) {
                const module = await import('https://cdn.jsdelivr.net/npm/hypha-core@0.20.60/dist/hypha-core.mjs');
                const { HyphaCore } = module;
                window.hyphaCore = new HyphaCore();
                await window.hyphaCore.start();
                window.hyphaApi = window.hyphaCore.api;
            }
            setIsHyphaReady(true);
        };
        
        initializeHyphaCore();
    }, []);

    // Automatically load chatbot when component mounts
    useEffect(() => {
        let cancelled = false;
        const loadChatbot = async () => {
            if (!microscopeControlService || chatUrl || !isHyphaReady) return;
            try {
                if (!window.hyphaCore || !window.hyphaApi) {
                    appendLog('HyphaCore is not initialized yet, waiting...');
                    return;
                }

                appendLog('Loading chatbot automatically...');
                const maxAttempts = 20; // ~10s total with 500ms delay
                const delayMs = 500;
                for (let attempt = 1; attempt <= maxAttempts && !cancelled; attempt++) {
                    const url = await microscopeControlService.get_chatbot_url();
                    if (url && typeof url === 'string' && url.trim() !== '') {
                        if (!cancelled) setChatUrl(url);
                        appendLog('Chatbot is ready.');
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
                if (!cancelled) appendLog('Chatbot URL not available yet (timeout).');
            } catch (error) {
                if (!cancelled) appendLog(`Failed to load chatbot: ${error.message}`);
            }
        };
        loadChatbot();
        return () => { cancelled = true; };
    }, [microscopeControlService, chatUrl, appendLog, isHyphaReady]);

    return (
        <div>
            {chatUrl ? (
                <div className="chat-window">
                    <iframe
                        src={chatUrl}
                        style={{ width: '100%', height: '100%', border: 'none' }}
                        title="Chatbot"
                    ></iframe>
                </div>
            ) : (
                <div className="chat-loading">
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading chatbot...</span>
                </div>
            )}
        </div>
    );
}

ChatbotButton.propTypes = {
    microscopeControlService: PropTypes.object,
    appendLog: PropTypes.func.isRequired,
};

export default ChatbotButton;