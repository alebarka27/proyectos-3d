function ensureUI() {
    if (document.getElementById('toastContainer')) return;

    const toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);

    const overlay = document.createElement('div');
    overlay.id = 'uiOverlay';
    overlay.className = 'overlay hidden';
    overlay.innerHTML = `
        <div class="modal modal-confirm">
            <div class="ui-dialog-icon" id="uiDialogIcon"></div>
            <h2 id="uiDialogTitle"></h2>
            <p id="uiDialogMessage" class="ui-dialog-message"></p>
            <input id="uiDialogInput" class="hidden" type="text">
            <div class="form-actions">
                <button id="uiDialogCancel" class="btn-secondary">Cancelar</button>
                <button id="uiDialogConfirm" class="btn-primary">Aceptar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 4000;
    ensureUI();
    const container = document.getElementById('toastContainer');
    const iconName = type === 'success' ? 'check' : type === 'error' ? 'warning' : 'info';
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `${icon(iconName, 'toast-icon')}<span class="toast-message"></span><button class="toast-close" aria-label="Cerrar">${icon('close')}</button>`;
    toast.querySelector('.toast-message').textContent = message;

    function remove() {
        clearTimeout(timer);
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 200);
    }

    toast.querySelector('.toast-close').onclick = remove;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-show'));
    const timer = setTimeout(remove, duration);
}

function showConfirm(message, opts) {
    opts = opts || {};
    ensureUI();
    const overlay = document.getElementById('uiOverlay');
    const title = document.getElementById('uiDialogTitle');
    const msg = document.getElementById('uiDialogMessage');
    const input = document.getElementById('uiDialogInput');
    const btnConfirm = document.getElementById('uiDialogConfirm');
    const btnCancel = document.getElementById('uiDialogCancel');
    const iconBox = document.getElementById('uiDialogIcon');

    title.textContent = opts.title || (opts.danger ? 'Confirmar eliminación' : 'Confirmar');
    msg.textContent = message;
    input.classList.add('hidden');
    iconBox.className = 'ui-dialog-icon' + (opts.danger ? ' ui-icon-danger' : ' ui-icon-info');
    iconBox.innerHTML = icon(opts.danger ? 'warning' : 'info');
    btnConfirm.textContent = opts.confirmLabel || (opts.danger ? 'Eliminar' : 'Confirmar');
    btnCancel.textContent = opts.cancelLabel || 'Cancelar';
    btnConfirm.className = 'btn-primary' + (opts.danger ? ' btn-confirm-danger' : '');

    overlay.classList.remove('hidden');

    return new Promise(resolve => {
        function close(result) {
            overlay.classList.add('hidden');
            btnConfirm.onclick = null;
            btnCancel.onclick = null;
            document.removeEventListener('keydown', onKey);
            resolve(result);
        }
        function onKey(e) {
            if (e.key === 'Escape') close(false);
            if (e.key === 'Enter') close(true);
        }
        btnConfirm.onclick = () => close(true);
        btnCancel.onclick = () => close(false);
        document.addEventListener('keydown', onKey);
        btnConfirm.focus();
    });
}

function showPrompt(message, defaultValue) {
    ensureUI();
    const overlay = document.getElementById('uiOverlay');
    const title = document.getElementById('uiDialogTitle');
    const msg = document.getElementById('uiDialogMessage');
    const input = document.getElementById('uiDialogInput');
    const btnConfirm = document.getElementById('uiDialogConfirm');
    const btnCancel = document.getElementById('uiDialogCancel');
    const iconBox = document.getElementById('uiDialogIcon');

    title.textContent = 'Renombrar';
    msg.textContent = message;
    iconBox.className = 'ui-dialog-icon ui-icon-info';
    iconBox.innerHTML = icon('pencil');
    input.classList.remove('hidden');
    input.value = defaultValue || '';
    btnConfirm.textContent = 'Guardar';
    btnCancel.textContent = 'Cancelar';
    btnConfirm.className = 'btn-primary';

    overlay.classList.remove('hidden');

    return new Promise(resolve => {
        function close(result) {
            overlay.classList.add('hidden');
            input.classList.add('hidden');
            btnConfirm.onclick = null;
            btnCancel.onclick = null;
            input.onkeydown = null;
            document.removeEventListener('keydown', onKey);
            resolve(result);
        }
        function onKey(e) {
            if (e.key === 'Escape') close(null);
        }
        btnConfirm.onclick = () => close(input.value.trim());
        btnCancel.onclick = () => close(null);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); close(input.value.trim()); }
        };
        document.addEventListener('keydown', onKey);
        setTimeout(() => { input.focus(); input.select(); }, 50);
    });
}
