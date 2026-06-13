import React, {useState} from 'react';
import ReactDOM from 'react-dom';
import {useNodeChecks} from '@jahia/data-helper';
import {McpChatDrawer} from './McpChatDrawer';

export const McpChatAction = ({path, render: Render, ...rest}) => {
    const [isOpen, setIsOpen] = useState(false);

    const {checksResult} = useNodeChecks(
        {path},
        {requireModuleInstalledOnSite: ['jahia-mcp-chat']}
    );

    if (!checksResult) {
        return null;
    }

    return (
        <>
            <Render
                {...rest}
                onClick={() => setIsOpen(o => !o)}
            />
            {ReactDOM.createPortal(
                <McpChatDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />,
                document.body
            )}
        </>
    );
};
