import React from 'react';
import i18next from 'i18next';
import {registry} from '@jahia/ui-extender';
import {McpChatAction} from './McpChat/McpChatAction';
import en from '../main/resources/javascript/locales/en.json';
import fr from '../main/resources/javascript/locales/fr.json';

const NS = 'jahia-mcp-chat';

function registerTranslations() {
    [['en', en], ['fr', fr]].forEach(([lang, resource]) => {
        if (!i18next.hasResourceBundle(lang, NS)) {
            i18next.addResourceBundle(lang, NS, resource[NS], true, true);
        }
    });
}

function register() {
    registry.add('action', NS, {
        targets: ['header-secondary-actions:999', 'contentActions:999'],
        buttonIcon: window.jahia?.moonstone?.toIconComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">' +
            '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>' +
            '<circle cx="9" cy="10" r="1"/><circle cx="12" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>' +
            '</svg>'
        ),
        buttonLabel: `${NS}:action.open`,
        requireModuleInstalledOnSite: NS,
        component: McpChatAction
    });
}

export default function () {
    registry.add('callback', NS, {
        targets: ['jahiaApp-init:50'],
        callback: () => {
            registerTranslations();
            register();
        }
    });
    console.info('%c Jahia MCP Chat is activated', 'color: #0072b1');
}
