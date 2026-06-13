function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

function safeHref(url) {
    return /^https?:\/\//i.test(String(url || '').trim()) ? url : '#';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHTML, safeHref };
}
