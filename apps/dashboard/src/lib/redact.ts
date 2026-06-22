// docs/architecture/07 §8.1 redactor.
//
// Redacts Meowth bearer tokens (mwt_*), setup codes (mws_*), and
// `Authorization: Bearer mwt_*` headers from arbitrary strings.
// Preserves a short prefix so humans can still identify which kind
// of secret was redacted.

const PATTERNS: RegExp[] = [
  /Authorization:\s*Bearer\s+mwt_[A-Z0-9]+/gi,
  /\bmwt_[A-Z0-9]{30,}\b/g,
  /\bmws_[A-Z0-9]{30,}\b/g,
];

export function redact(s: string): string {
  let out = s;
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => {
      if (/^Authorization/i.test(m)) return 'Authorization: Bearer mwt_<redacted>';
      if (/^mwt_/.test(m)) return 'mwt_<redacted>';
      if (/^mws_/.test(m)) return 'mws_<redacted>';
      return '<redacted>';
    });
  }
  return out;
}
