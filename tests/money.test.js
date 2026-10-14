'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAmount, kurusToTL, tlToKurus } = require('../lib/money');

test('12.50 artık 1250 değil 12,50 olarak okunur', () => {
  assert.strictEqual(parseAmount('12.50'), 1250);
  assert.strictEqual(kurusToTL(1250), 12.5);
});

test('TR binlik/ondalık biçimi', () => {
  assert.strictEqual(parseAmount('1.250,50'), 125050);
  assert.strictEqual(parseAmount('1.234.567,89'), 123456789);
  assert.strictEqual(parseAmount('1.250'), 125000);
  assert.strictEqual(parseAmount('12,5'), 1250);
});

test('düz ondalık biçim', () => {
  assert.strictEqual(parseAmount('1250.50'), 125050);
  assert.strictEqual(parseAmount('1250'), 125000);
});

test('belirsiz/karışık ve geçersiz biçimler reddedilir', () => {
  assert.strictEqual(parseAmount('1,250.50'), null);
  assert.strictEqual(parseAmount('abc'), null);
  assert.strictEqual(parseAmount(''), null);
  assert.strictEqual(parseAmount(null), null);
  assert.strictEqual(parseAmount('10.000.001'), null);
});

test('kuruş <-> TL dönüşümü', () => {
  assert.strictEqual(tlToKurus(12.5), 1250);
  assert.strictEqual(kurusToTL(100), 1);
});
