import React from 'react';
import PropTypes from 'prop-types';
import MapButton from './MapButton';
import WinBox from 'winbox/src/js/winbox';

const ChatbotButton = ({ appendLog, bottom }) => {
    const openChatbot = async () => {
        try {
            console.log('Chatbot button clicked');
            appendLog('Opening chatbot window...');
            
            if (window.chatbotWindow && !window.chatbotWindow.closed) {
                console.log('Existing window found');
                if (window.chatbotWindow.minimized) {
                    window.chatbotWindow.restore();
                } else {
                    window.chatbotWindow.focus();
                }
            } else {
                console.log('Creating new window');
                window.chatbotWindow = new WinBox('BioImage.io Chatbot', {
                    id: 'chatbot-window',
                    background: '#448aff',
                    x: 'center',
                    y: 'center',
                    width: '40%',
                    height: '70%',
                    movable: true,
                    resizable: true,
                    minimizable: true,
                    index: 9999,
                    url: 'http://localhost:9000/public/apps/bioimageio-chatbot-client/index',  // Point to local server
                    onclose: function () {
                        window.chatbotWindow = null;
                    },
                    buttons: ['min', 'max', 'close'],
                });
                console.log('Window created:', window.chatbotWindow);
            }
        } catch (error) {
            console.error('Error opening chatbot:', error);
            appendLog(`Failed to open chatbot window: ${error.message}`);
        }
    };

    return (
        <MapButton onClick={openChatbot} icon="fa-comments" bottom={bottom} />
    );
}

ChatbotButton.propTypes = {
    appendLog: PropTypes.func.isRequired,
    bottom: PropTypes.string,
};

export default ChatbotButton;