import React, {useState} from 'react';
import ReactDOM from 'react-dom';
import {McpChatDrawer} from './McpChatDrawer';

export const McpChatAction = ({render: Render, ...rest}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Render {...rest} onClick={() => setIsOpen(o => !o)} />
            {ReactDOM.createPortal(
                <McpChatDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />,
                document.body
            )}
        </>
    );
};
