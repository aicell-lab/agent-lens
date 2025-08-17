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

    // Automatically load chatbot when component mounts
    useEffect(() => {
        const loadChatbot = async () => {
            if (microscopeControlService && !chatUrl) {
                try {
                    if (!window.hyphaCore || !window.hyphaApi) {
                        appendLog('HyphaCore is not initialized.');
                        return;
                    }
                
                    appendLog('Loading chatbot automatically...');
                    const url = await microscopeControlService.get_chatbot_url();
                    setChatUrl(url);
                } catch (error) {
                    appendLog(`Failed to load chatbot: ${error.message}`);
                }
            }
        };
        
        loadChatbot();
    }, [microscopeControlService, chatUrl, appendLog]);

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
    microscopeBusy: PropTypes.bool,
};

export default ChatbotButton;