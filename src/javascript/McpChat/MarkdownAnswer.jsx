import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './MarkdownAnswer.module.css';

const MARKDOWN_FENCE = /^```\s*(markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i;

/**
 * Models often send their whole answer inside a ```markdown fence, or indent every line: Markdown then reads it as
 * one code block. Unwrap the fence and remove the indentation the lines share, outside fenced code.
 */
export function normalizeMarkdown(text) {
    // Blank lines around the answer go, the first line's indentation stays: it is measured below
    let s = (text || '').replace(/\r\n/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
    const fenced = MARKDOWN_FENCE.exec(s.trim());
    if (fenced) {
        s = fenced[2];
    }
    const lines = s.split('\n');
    let inFence = false;
    let indent = Infinity;
    for (const line of lines) {
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (!inFence && line.trim()) {
            indent = Math.min(indent, line.match(/^[ \t]*/)[0].length);
        }
    }
    if (indent > 0 && indent !== Infinity) {
        // Every line loses the shared indent, fenced code included; deeper indentation stays
        s = lines.map(line => line.slice(Math.min(indent, line.match(/^[ \t]*/)[0].length))).join('\n');
    }
    return s;
}

// Answers are model output: React elements only (raw HTML is ignored), unsafe link protocols dropped by
// react-markdown's URL transform, links in a new tab, tables in their own scroll box
const COMPONENTS = {
    a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer"/>,
    table: ({node, ...props}) => (
        <div className={styles.tableBox}>
            <table {...props}/>
        </div>
    ),
    code: ({node, className, children, ...props}) => {
        // A fenced block marked markdown is an answer the model wrapped: render it, do not show it as code
        if (/language-(markdown|md)\b/.test(className || '')) {
            return <MarkdownAnswer text={String(children)}/>;
        }
        return <code className={className} {...props}>{children}</code>;
    },
    pre: ({node, children, ...props}) => {
        const child = React.Children.only(children);
        if (/language-(markdown|md)\b/.test(child?.props?.className || '')) {
            return child;
        }
        return <pre {...props}>{children}</pre>;
    }
};

export function MarkdownAnswer({text}) {
    return (
        <div className={styles.markdown}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{normalizeMarkdown(text)}</ReactMarkdown>
        </div>
    );
}
