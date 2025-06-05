import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

const ChatbotButton = ({ microscopeControlService, appendLog, microscopeBusy}) => {
    const [chatUrl, setChatUrl] = useState(null);

    useEffect(() => {
        const initializeHyphaCore = async () => {
            if (!window.hyphaCore || !window.hyphaApi) {
                const module = await import('https://cdn.jsdelivr.net/npm/hypha-core@0.20.38/dist/hypha-core.mjs');
                const { HyphaCore } = module;
                window.hyphaCore = new HyphaCore();
                await window.hyphaCore.start();
                window.hyphaApi = window.hyphaCore.api;
            }
        };
        
        initializeHyphaCore();
    }, []);

    const openChatbot = async () => {
        try {
            if (!window.hyphaCore || !window.hyphaApi) {
                appendLog('HyphaCore is not initialized.');
                return;
            }
        
            appendLog('Opening chatbot window...');
            const url = await microscopeControlService.get_chatbot_url();
            setChatUrl(url);
        } catch (error) {
            appendLog(`Failed to open chatbot window: ${error.message}`);
        }
    };

    return (
        <div>
            <button
                className="control-button bg-blue-500 text-white hover:bg-blue-600 p-2 rounded mb-4"
                onClick={openChatbot}
                disabled={!microscopeControlService || microscopeBusy}
            >
                <i className="fas fa-comments"></i> Open Chat
            </button>
            {chatUrl && (
                <div className="chat-window border border-gray-300 rounded p-2">
                    <iframe
                        src={chatUrl}
                        style={{ width: '100%', height: '400px', border: 'none' }}
                        title="Chatbot"
                    ></iframe>
                </div>
            )}
        </div>
    );
}

ChatbotButton.propTypes = {
    microscopeControlService: PropTypes.object,
    appendLog: PropTypes.func.isRequired,
    microscopeBusy: PropTypes.bool,
};

export default ChatbotButton;