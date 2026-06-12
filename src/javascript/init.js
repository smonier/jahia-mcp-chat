import React from 'react';
import i18next from 'i18next';
import {registry} from '@jahia/ui-extender';
import {McpChatPanel} from './McpChat/McpChatPanel';

export default async function () {
    await i18next.loadNamespaces('jahia-mcp-chat');

    registry.addOrReplace('adminRoute', 'jahia-mcp-chat-panel', {
        targets: ['nav-root-top:99'],
        label: 'jahia-mcp-chat:panel.title',
        icon: window.jahia?.moonstone?.toIconComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">' +
            '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>' +
            '<circle cx="9" cy="10" r="1"/><circle cx="12" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>' +
            '</svg>'
        ),
        isSelectable: true,
        requiredPermission: 'administrationAccess',
        render: () => <McpChatPanel />
    });
}
