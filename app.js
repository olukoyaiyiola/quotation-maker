'use strict';

const byId = id => document.getElementById(id);
const storageKey = 'quotation-maker-v1';
const blankItem = () => ({ description: '', type: '', colour: '', qty: '1', rate: '' });
const localDate = () => {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
};
const newQuote = () => ({
  client: '', date: localDate(),
  contact: '', labor: '', transport: '', discount: false, discountType: 'percent',
  discountValue: '', tax: false, taxType: 'add', taxRate: '', notes: '', items: [blankItem()]
});

let cached = {};
try { cached = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch {}

let quote = { ...newQuote(), ...cached.quote };
const profile = { name: 'Bumick', currency: 'NGN', ...cached.profile };

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ systems, quote, profile }));
    byId('status').textContent = 'Saved on this device';
    return true;
  } catch {
    byId('status').textContent = 'Browser storage unavailable';
    return false;
  }
}

const numeric = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const cents = value => Math.round((value + Number.EPSILON) * 100);
function calculate(q) {
  const lines = q.items.map(item => cents(numeric(item.qty) * numeric(item.rate)));
  const subtotal = lines.reduce((sum, amount) => sum + amount, 0);
  const labor = cents(numeric(q.labor));
  const transport = cents(numeric(q.transport));
  const beforeDiscount = subtotal + labor + transport;
  const discountValue = numeric(q.discountValue);
  const discount = q.discount ? Math.min(beforeDiscount, q.discountType === 'percent'
    ? Math.round(beforeDiscount * discountValue / 100) : cents(discountValue)) : 0;
  const base = beforeDiscount - discount;
  const taxAmount = q.tax ? Math.round(base * numeric(q.taxRate) / 100) : 0;
  const tax = q.taxType === 'deduct' ? -Math.min(taxAmount, base) : taxAmount;
  return { lines, subtotal, labor, transport, discount, tax, total: base + tax };
}

const smallNumbers = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const tensNames = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const scales = ['', 'thousand', 'million', 'billion', 'trillion'];
const currencyWords = {
  NGN: ['naira', 'naira', 'kobo', 'kobo'],
  USD: ['dollar', 'dollars', 'cent', 'cents'],
  GBP: ['pound', 'pounds', 'penny', 'pence'],
  EUR: ['euro', 'euros', 'cent', 'cents'],
  GHS: ['cedi', 'cedis', 'pesewa', 'pesewas']
};

function underThousand(n) {
  if (n < 20) return smallNumbers[n];
  if (n < 100) return tensNames[Math.floor(n / 10)] + (n % 10 ? '-' + smallNumbers[n % 10] : '');
  return smallNumbers[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + underThousand(n % 100) : '');
}

function integerWords(n) {
  if (!n) return 'zero';
  const groups = [];
  const finalGroup = n % 1000;
  for (let scale = 0; n; scale++, n = Math.floor(n / 1000)) {
    const group = n % 1000;
    if (group) groups.unshift([underThousand(group), scales[scale]].filter(Boolean).join(' '));
  }
  if (groups.length > 1 && finalGroup > 0 && finalGroup < 100) groups.splice(-1, 0, 'and');
  return groups.join(' ');
}

function amountInWords(totalCents, currency) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) return 'Amount exceeds the supported range.';
  const major = Math.floor(totalCents / 100), minor = totalCents % 100;
  const units = currencyWords[currency];
  let words = integerWords(major) + ' ' + units[major === 1 ? 0 : 1];
  if (minor) words += ' and ' + integerWords(minor) + ' ' + units[minor === 1 ? 2 : 3];
  return words[0].toUpperCase() + words.slice(1) + ' only';
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const image = (value, name) => /^data:image\/(png|jpeg|webp);base64,/.test(value || '')
  ? '<img class="' + name + '" alt="' + (name === 'logo' ? 'Company logo' : 'Signature') + '" src="' + escape(value) + '">' : '';
const dateLabel = value => value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z')) : '—';

function renderPreview() {
  byId('discount-fields').hidden = !quote.discount;
  byId('tax-fields').hidden = !quote.tax;
  quote.number = nextReference();
  byId('reference').value = quote.number;
  byId('paper').innerHTML = quotationHTML(quote, profile, currentSystem().name);
}
function quotationHTML(quote, profile, systemName) {
  const format = new Intl.NumberFormat('en-NG', { style: 'currency', currency: profile.currency, currencyDisplay: 'narrowSymbol' });
  const money = value => escape(format.format(value / 100));
  const t = calculate(quote);
  const row = (label, value, css = '') => '<div class="sum ' + css + '"><span>' + escape(label) + '</span><span>' + money(value) + '</span></div>';
  const details = [profile.address, profile.phone, profile.email].filter(Boolean).map(escape).join('\n');
  let lines = quote.items.map((item, i) => item.description.trim() || numeric(item.rate) || t.lines[i]
    ? '<tr><td>' + escape(item.description || 'Item') + materialDetails(item) + '</td><td>' + numeric(item.qty) +
      '</td><td>' + money(cents(numeric(item.rate))) + '</td><td>' + money(t.lines[i]) + '</td></tr>' : '').join('');
  if (!lines) lines = '<tr><td colspan="4">Add an item to see it here.</td></tr>';

  return (
    '<div class="paperhead"><div>' + image(profile.logo, 'logo') + '<strong>' + escape(profile.name || 'Your company') +
    '</strong><div class="detail">' + details + '</div></div><div class="right"><h2>Quotation</h2><p class="detail">' +
    escape(quote.number) + '</p><p class="detail">' + escape(systemName) + '</p></div></div>' +
    '<div class="meta"><div><p class="cap">Prepared for</p><strong>' + escape(quote.client || 'Client name') +
    '</strong><p class="detail">' + escape(quote.contact) + '</p></div><div class="right detail"><div>Issued ' +
    dateLabel(quote.date) + '</div>' +
    '</div></div><table><thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Rate</th><th scope="col">Amount</th></tr></thead><tbody>' +
    lines + '</tbody></table><div class="totals">' + row('Items subtotal', t.subtotal) +
    row('Workmanship', t.labor) + row('Transportation', t.transport) +
    (quote.discount ? row('Discount', -t.discount) : '') +
    (quote.tax ? row(quote.taxType === 'deduct' ? 'Tax deduction' : 'Tax', t.tax) : '') +
    row('Grand total', t.total, 'grand') + '</div>' +
    '<div class="foot"><p class="cap">AMOUNT IN WORDS</p><p>' + amountInWords(t.total, profile.currency) + '</p></div>' +
    (quote.notes.trim() ? '<div class="foot"><p class="cap">Notes</p><p class="detail">' + escape(quote.notes) + '</p></div>' : '') +
    (profile.signature || profile.signer || profile.signerPosition ? '<div class="foot"><p class="cap">Authorized signatory</p>' +
    image(profile.signature, 'signature') +
    (profile.signer ? '<p><strong>' + escape(profile.signer) + '</strong></p>' : '') +
    (profile.signerPosition ? '<p class="detail">' + escape(profile.signerPosition) + '</p>' : '') + '</div>' : ''));
}

function update() { persist(); renderPreview(); }

function materialFields(item, binding) {
  return '<div class="material-fields"><label>Type<input ' + binding + '="type" placeholder="e.g. Longspan" value="' +
    escape(item.type) + '"></label><label>Colour<input ' + binding + '="colour" placeholder="e.g. Slate grey" value="' +
    escape(item.colour) + '"></label></div>';
}

function materialDetails(item) {
  return [['Type', item.type], ['Colour', item.colour]]
    .filter(([, value]) => value && value.trim())
    .map(([label, value]) => '<div class="material-detail">' + label + ': ' + escape(value.trim()) + '</div>').join('');
}

function renderItems() {
  byId('items').innerHTML = quote.items.map((item, index) =>
    '<div class="item" data-index="' + index + '"><label>Description<input data-item="description" placeholder="Item or service" value="' +
    escape(item.description) + '"></label><label>Qty<input data-item="qty" type="number" min="0" step="any" value="' +
    escape(item.qty) + '"></label><label>Rate<input data-item="rate" type="number" min="0" step="0.01" placeholder="0.00" value="' +
    escape(item.rate) + '"></label><button class="remove" aria-label="Remove item ' + (index + 1) + '" data-remove>×</button>' + materialFields(item, 'data-item') + '</div>').join('');
}

function fillInputs(selector, attribute, data) {
  document.querySelectorAll(selector).forEach(input => {
    const value = data[input.dataset[attribute]];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? '';
  });
}

document.addEventListener('input', ({ target }) => {
  const { q, p, item } = target.dataset;
  if (q) quote[q] = target.type === 'checkbox' ? target.checked : target.value;
  if (p) profile[p] = target.value;
  if (item) quote.items[target.closest('.item').dataset.index][item] = target.value;
  if (q || p || item) update();
});

byId('items').addEventListener('click', ({ target }) => {
  if (!target.hasAttribute('data-remove')) return;
  quote.items.splice(Number(target.closest('.item').dataset.index), 1);
  if (!quote.items.length) quote.items.push(blankItem());
  renderItems();
  update();
});
byId('add').onclick = () => {
  quote.items.push(blankItem());
  renderItems();
  update();
  byId('items').lastElementChild.querySelector('input').focus();
};
byId('new').onclick = () => {
  if (!window.confirm('Start a new quotation? This replaces the current draft and keeps your company profile.')) return;
  quote = { ...newQuote(), systemId: currentSystem().id };
  fillInputs('[data-q]', 'q', quote);
  renderItems();
  update();
};
byId('company').onclick = () => byId('profile').showModal();
byId('close').onclick = byId('done').onclick = () => byId('profile').close();

const imageEdits = { logo: 0, signature: 0 };
function profileMessage(message) { byId('profile-status').textContent = message; }
document.querySelectorAll('[data-image]').forEach(input => {
  input.addEventListener('change', async () => {
    const file = input.files[0];
    const key = input.dataset.image;
    input.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {
      profileMessage('Choose a PNG, JPG or WebP image up to 1 MB.');
      return;
    }
    const edit = ++imageEdits[key];
    const reader = new FileReader();
    reader.onload = () => {
      if (edit !== imageEdits[key]) return;
      profile[key] = reader.result;
      profileMessage(persist() ? 'Image saved.' : 'Image added for this session. Browser storage is unavailable.');
      renderPreview();
    };
    reader.onerror = () => profileMessage('The image could not be read. Try another file.');
    reader.readAsDataURL(file);
  });
});
document.querySelectorAll('[data-clear]').forEach(button => {
  button.onclick = () => {
    const key = button.dataset.clear;
    imageEdits[key]++;
    delete profile[key];
    update();
    profileMessage('Image removed.');
  };
});

