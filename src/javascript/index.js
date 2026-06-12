import {registry} from '@jahia/ui-extender';

export default function () {
    registry.add('callback', 'jahia-mcp-chat', {
        targets: ['jahiaApp-init:50'],
        callback: async () => {
            const {default: register} = await import('./init');
            register();
        }
    });
    console.info('%c Jahia MCP Chat is activated', 'color: #3c8cba');
}
