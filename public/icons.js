const ICONS = {
    folder: '<path d="M2.5 5.5a1 1 0 0 1 1-1h3.6l1.4 1.6h7a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1V5.5z"/>',

    sliders: '<line x1="3" y1="5" x2="17" y2="5"/><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/>' +
        '<line x1="3" y1="10" x2="17" y2="10"/><circle cx="7" cy="10" r="1.6" fill="currentColor" stroke="none"/>' +
        '<line x1="3" y1="15" x2="17" y2="15"/><circle cx="13" cy="15" r="1.6" fill="currentColor" stroke="none"/>',

    bag: '<path d="M5 7h10l.9 9.5a1 1 0 0 1-1 1.1H5.1a1 1 0 0 1-1-1.1L5 7z"/><path d="M7.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/>',

    clipboard: '<rect x="4" y="3.5" width="12" height="14" rx="1.5"/><path d="M7.5 3.5h5v2h-5z"/>' +
        '<line x1="7" y1="9" x2="13" y2="9"/><line x1="7" y1="12" x2="13" y2="12"/><line x1="7" y1="15" x2="11" y2="15"/>',

    wallet: '<rect x="2.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 8.5h15"/>' +
        '<circle cx="14" cy="11.8" r="1" fill="currentColor" stroke="none"/>',

    calculator: '<rect x="4.5" y="2.5" width="11" height="15" rx="1.5"/><rect x="6.5" y="4.5" width="7" height="3" rx="0.5"/>' +
        '<circle cx="7" cy="11" r="0.9" fill="currentColor" stroke="none"/><circle cx="10" cy="11" r="0.9" fill="currentColor" stroke="none"/><circle cx="13" cy="11" r="0.9" fill="currentColor" stroke="none"/>' +
        '<circle cx="7" cy="14.3" r="0.9" fill="currentColor" stroke="none"/><circle cx="10" cy="14.3" r="0.9" fill="currentColor" stroke="none"/><circle cx="13" cy="14.3" r="0.9" fill="currentColor" stroke="none"/>',

    'link-external': '<path d="M8.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h10a1.5 1.5 0 0 0 1.5-1.5v-3.5"/>' +
        '<path d="M11 3.5h5.5V9"/><path d="M16.5 3.5 9 11"/>',

    pencil: '<path d="M12.9 3.4a1.4 1.4 0 0 1 2 0l1.7 1.7a1.4 1.4 0 0 1 0 2L7 16.7l-3.4.7.7-3.4z"/><path d="M11.5 4.8 15.2 8.5"/>',

    trash: '<path d="M4 6h12"/><path d="M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/>' +
        '<path d="M5.5 6 6.3 16a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9L14.5 6"/>' +
        '<line x1="8.5" y1="9" x2="9" y2="14"/><line x1="11.5" y1="9" x2="11" y2="14"/>',

    printer: '<path d="M6 8V4.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V8"/><rect x="3.5" y="8" width="13" height="6" rx="1.2"/>' +
        '<path d="M6 13.5h8v3.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5z"/><circle cx="13.2" cy="10.5" r=".6" fill="currentColor" stroke="none"/>',

    chat: '<path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H9l-3.5 3v-3H5a2 2 0 0 1-2-2z"/>',

    cart: '<path d="M2.5 3h1.7l1.6 9.4a1.5 1.5 0 0 0 1.5 1.3h7a1.5 1.5 0 0 0 1.5-1.2L17 6.5H5"/>' +
        '<circle cx="7.5" cy="17" r="1.2" fill="currentColor" stroke="none"/><circle cx="14" cy="17" r="1.2" fill="currentColor" stroke="none"/>',

    check: '<path d="M4 10.5 8 14.5 16 5.5"/>',

    box: '<path d="M10 2.5 16.5 6 10 9.5 3.5 6z"/><path d="M3.5 6v8L10 17.5 16.5 14V6"/><path d="M10 9.5V17.5"/>',

    plus: '<line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/>',

    warning: '<path d="M10 2.5 18 16H2z"/><line x1="10" y1="8" x2="10" y2="11.5"/><circle cx="10" cy="14" r=".6" fill="currentColor" stroke="none"/>',

    info: '<circle cx="10" cy="10" r="7.5"/><line x1="10" y1="9" x2="10" y2="13.5"/><circle cx="10" cy="6.3" r=".6" fill="currentColor" stroke="none"/>',

    inbox: '<path d="M3 8 5.5 3h9L17 8"/><path d="M3 8v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M3 8h4.5l.8 2h3.4l.8-2H17"/>',

    close: '<line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/>',
};

function icon(name, cls) {
    const body = ICONS[name];
    if (!body) return '';
    const classAttr = cls ? `icon ${cls}` : 'icon';
    return `<svg class="${classAttr}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ICONS, icon };
}
