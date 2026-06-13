document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    errorEl.classList.add('hidden');
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (res.ok) {
            window.location.href = '/';
        } else {
            errorEl.textContent = 'Contraseña incorrecta';
            errorEl.classList.remove('hidden');
        }
    } catch {
        errorEl.textContent = 'Error de conexión';
        errorEl.classList.remove('hidden');
    }
};
