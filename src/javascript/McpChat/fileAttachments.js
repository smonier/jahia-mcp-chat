// Shared attachment reader for the chat input (drawer + panel).
//
// Word documents (.docx) are converted to HTML in the browser so the LLM
// receives the real document structure — headings, tables, lists — instead of
// the "binary content not included" stub the generic binary path produces.
// mammoth (~1MB) loads on demand as its own webpack chunk the first time a
// .docx is attached.

const TEXT_EXTENSIONS = /\.(md|txt|csv|json|xml|yaml|yml|ts|tsx|js|jsx|css|html|htm|sql|sh|py|java|c|cpp|h|rs|go|rb|php)$/i;
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function readDocx(file) {
    const mod = await import(/* webpackChunkName: "mammoth" */ 'mammoth/mammoth.browser');
    const mammoth = mod.default || mod;
    const arrayBuffer = await file.arrayBuffer();
    const {value} = await mammoth.convertToHtml({arrayBuffer}, {
        // Embedded photos would explode the prompt as base64 — strip the
        // binary but keep the <img> markers so the model knows where images sat
        convertImage: mammoth.images.imgElement(() => Promise.resolve({src: ''}))
    });
    const imageCount = (value.match(/<img\b/g) || []).length;
    const note = imageCount > 0 ?
        ` The document contains ${imageCount} embedded image(s); their binary content is not included.` :
        '';
    return {
        name: file.name, type: file.type || DOCX_TYPE, size: file.size, kind: 'text',
        text: `[Word document "${file.name}" converted to HTML.${note}]\n${value}`
    };
}

function readGeneric(file) {
    return new Promise(resolve => {
        const reader = new FileReader();
        const isImage = file.type.startsWith('image/');
        const isText = file.type.startsWith('text/') ||
            ['application/json', 'application/xml', 'application/javascript'].includes(file.type) ||
            TEXT_EXTENSIONS.test(file.name);
        if (isImage) {
            reader.onload = e => resolve({name: file.name, type: file.type, size: file.size, kind: 'image', data: e.target.result.split(',')[1]});
            reader.readAsDataURL(file);
        } else if (isText) {
            reader.onload = e => resolve({name: file.name, type: file.type || 'text/plain', size: file.size, kind: 'text', text: e.target.result});
            reader.readAsText(file);
        } else {
            reader.onload = e => resolve({name: file.name, type: file.type, size: file.size, kind: 'binary', data: e.target.result.split(',')[1]});
            reader.readAsDataURL(file);
        }
    });
}

export function readFile(file) {
    if (file.type === DOCX_TYPE || /\.docx$/i.test(file.name)) {
        // Conversion failure (corrupt file, legacy .doc renamed) falls back to
        // the generic binary path rather than blocking the attachment.
        return readDocx(file).catch(() => readGeneric(file));
    }

    return readGeneric(file);
}
