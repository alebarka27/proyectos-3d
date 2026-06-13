const { test } = require('node:test');
const assert = require('node:assert');
const app = require('../api/index.js');
const { sign, verifyToken } = app._auth;

test('sign/verifyToken: un token recien firmado es valido', () => {
    const expires = Date.now() + 1000 * 60;
    const token = sign(String(expires));
    assert.strictEqual(verifyToken(token), true);
});

test('verifyToken rechaza tokens expirados', () => {
    const expires = Date.now() - 1000;
    const token = sign(String(expires));
    assert.strictEqual(verifyToken(token), false);
});

test('verifyToken rechaza tokens manipulados', () => {
    const expires = Date.now() + 1000 * 60;
    const token = sign(String(expires));
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a');
    assert.strictEqual(verifyToken(tampered), false);
});

test('verifyToken rechaza tokens vacios o sin firma', () => {
    assert.strictEqual(verifyToken(''), false);
    assert.strictEqual(verifyToken(undefined), false);
    assert.strictEqual(verifyToken('sinpunto'), false);
});
