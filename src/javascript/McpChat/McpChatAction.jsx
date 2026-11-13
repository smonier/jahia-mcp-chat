import React, {useState} from 'react';
import ReactDOM from 'react-dom';
import {McpChatDrawer} from './McpChatDrawer';

// The drawer exists only while open: it docks beside the page under edit and gives the page its width back on
// close. The conversation itself is kept in localStorage.
export const McpChatAction = ({render: Render, ...rest}) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <>
            <Render {...rest} onClick={() => setIsOpen(o => !o)}/>
            {isOpen && ReactDOM.createPortal(
                <McpChatDrawer onClose={() => setIsOpen(false)}/>,
                document.body
            )}
        </>
    );
};
