// Docking from content-governance (drawer/useDock.js): keep the two in step.
import {useCallback, useLayoutEffect, useRef} from 'react';

const STORAGE_KEY = 'jahia-mcp-chat:panelWidth';
const GAP = 16;
// Below this the page under edit is too narrow to work in: the panel covers it instead of docking.
const MIN_CONTENT = 360;
const MIN_WIDTH = 380;
const DEFAULT_MIN = 480;
const DRAGGING_CLASS = 'jahia-mcp-chat-resizing';

function readWidth() {
    try {
        const value = Number(globalThis.localStorage?.getItem(STORAGE_KEY));
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}

function saveWidth(width) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, String(Math.round(width)));
    } catch {
        // A private window or blocked storage only loses the remembered width
    }
}

// jContent's content area: the part of the screen under its header, next to the accordion. Page
// Builder's frame and the content list both sit in it.
const findArea = () => document.querySelector('main .moonstone-layoutContent');

// What gives the panel room: the frame's wrapper in Page Builder (anything above it, a page header,
// keeps the full width), else the area's own content.
const findAnchor = area => document.querySelector('#page-builder-frame-1')?.parentElement || area.lastElementChild;

/**
 * Docks the drawer in jContent's content area, under the header: the page under edit (or the
 * content list) narrows to make room, and stays usable while the panel is open, as jContent's own
 * preview panel does. The width is the editor's, dragged on the left edge and remembered.
 *
 * Geometry is written straight to the elements, never through React state: a drag would otherwise
 * render every section of the drawer on each pointer move.
 *
 * @param {React.RefObject<HTMLElement>} panelRef the drawer
 * @returns {{onPointerDown: Function, onKeyDown: Function}} the handlers of its resize handle, a
 *     button on its left edge
 */
export function useDock(panelRef) {
    const width = useRef(readWidth());
    // Places the panel and returns the width the layout allowed
    const layout = useRef(() => null);

    // A layout effect: the panel is placed before the browser first paints it.
    useLayoutEffect(() => {
        let area = null;
        let anchor = null;
        // The anchor's own inline margin (Page Builder writes margin: 0), put back on close
        let original = null;
        let frame = 0;
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(place);
        };
        // The area changes size with the window and the accordion. The anchor also moves inside it: a
        // bar above the frame (a page header such as Page Insights) that opens or closes shifts the
        // frame and changes its height while the area keeps its own.
        const resize = new ResizeObserver(schedule);
        // Page Builder and the content list replace each other in the area: follow the swap.
        const swap = new MutationObserver(schedule);

        const restore = () => {
            if (original?.value) {
                anchor.style.setProperty('margin-right', original.value, original.priority);
            } else {
                anchor.style.removeProperty('margin-right');
            }
        };
        const release = () => {
            if (anchor) {
                restore();
                resize.unobserve(anchor);
            }
            anchor = null;
        };

        function place() {
            const panel = panelRef.current;
            const nextArea = findArea();
            if (nextArea !== area) {
                if (area) {
                    resize.unobserve(area);
                    swap.disconnect();
                }
                area = nextArea;
                if (area) {
                    resize.observe(area);
                    swap.observe(area, {childList: true});
                }
            }
            if (!panel || !area) {
                return null;
            }
            const next = findAnchor(area);
            if (next !== anchor) {
                release();
                anchor = next;
                if (anchor) {
                    original = {
                        value: anchor.style.getPropertyValue('margin-right'),
                        priority: anchor.style.getPropertyPriority('margin-right')
                    };
                    resize.observe(anchor);
                }
            }
            const box = area.getBoundingClientRect();
            const style = getComputedStyle(area);
            const right = box.right - Number.parseFloat(style.paddingRight);
            const left = box.left + Number.parseFloat(style.paddingLeft);
            const bottom = box.bottom - Number.parseFloat(style.paddingBottom);
            const available = right - left;
            const docked = available - GAP - MIN_WIDTH >= MIN_CONTENT;
            const max = docked ? available - GAP - MIN_CONTENT : available;
            const wanted = width.current || Math.max(DEFAULT_MIN, Math.round(available * 0.35));
            const w = Math.min(Math.max(wanted, Math.min(MIN_WIDTH, max)), max);
            const top = anchor ? anchor.getBoundingClientRect().top : box.top + Number.parseFloat(style.paddingTop);

            if (anchor) {
                if (docked) {
                    anchor.style.setProperty('margin-right', `${w + GAP}px`, 'important');
                } else {
                    restore();
                }
            }
            Object.assign(panel.style, {
                left: `${right - w}px`,
                top: `${top}px`,
                width: `${w}px`,
                height: `${Math.max(bottom - top, 0)}px`
            });
            return w;
        }
        layout.current = place;

        place();
        globalThis.addEventListener('resize', schedule);
        return () => {
            cancelAnimationFrame(frame);
            resize.disconnect();
            swap.disconnect();
            globalThis.removeEventListener('resize', schedule);
            release();
            document.body.classList.remove(DRAGGING_CLASS);
        };
    }, [panelRef]);

    const resizeTo = useCallback(next => {
        width.current = next;
        // Keep what the layout allowed, so a drag past a limit does not store a width never shown
        width.current = layout.current() || next;
    }, []);

    const onPointerDown = useCallback(event => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        const handle = event.currentTarget;
        const right = panelRef.current.getBoundingClientRect().right;
        handle.setPointerCapture?.(event.pointerId);
        // The frame of the page swallows pointer events: the drag would stop over it.
        document.body.classList.add(DRAGGING_CLASS);
        const onMove = e => resizeTo(right - e.clientX);
        const onUp = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            document.body.classList.remove(DRAGGING_CLASS);
            saveWidth(width.current);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    }, [panelRef, resizeTo]);

    const onKeyDown = useCallback(event => {
        const step = event.shiftKey ? 64 : 16;
        const current = panelRef.current.getBoundingClientRect().width;
        const moves = {ArrowLeft: step, ArrowRight: -step};
        if (event.key in moves) {
            event.preventDefault();
            resizeTo(current + moves[event.key]);
            saveWidth(width.current);
        }
    }, [panelRef, resizeTo]);

    return {onPointerDown, onKeyDown};
}
