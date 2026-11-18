// An amount in English words, as written on a paper: 1250500 -> "One million two hundred fifty thousand five hundred".
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const below1000 = (n) => {
  const h = Math.floor(n / 100); const r = n % 100; const p = [];
  if (h) p.push(`${ONES[h]} hundred`);
  if (r) p.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''));
  return p.join(' and ');
};
export function inWords(n) {
  n = Math.floor(Number(n) || 0);
  if (n <= 0) return '';
  const parts = [];
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) { if (n >= size) { parts.push(`${below1000(Math.floor(n / size))} ${name}`); n %= size; } }
  if (n) parts.push(below1000(n));
  const s = parts.join(' ');
  return `${s[0].toUpperCase()}${s.slice(1)} Tanzanian shillings only`;
}
