import React, {useState} from 'react';
import ReactDOM from 'react-dom';
import {useSelector} from 'react-redux';
import {useNodeChecks} from '@jahia/data-helper';
import {McpChatDrawer} from './McpChatDrawer';

export const McpChatAction = ({render: Render, ...rest}) => {
    const [isOpen, setIsOpen] = useState(false);
    const siteKey = useSelector(state => state.site);
    const {checksResult} = useNodeChecks(
        {path: `/sites/${siteKey}`},
        {requireModuleInstalledOnSite: ['org.jahia.se.modules.jahiaMcpChat']}
    );

    if (!checksResult) {
        return null;
    }

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
