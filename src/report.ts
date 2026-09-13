import type { AccountSnapshot, Finding } from './types.js';

export function formatReport(snapshot: AccountSnapshot, findings: Finding[]): string {
  const lines = [
    `RuleLens report for ${snapshot.account}`,
    `Ledger ${snapshot.currentLedger} | ${snapshot.rules.length} context rule(s) | ${findings.length} finding(s)`,
    '',
  ];
  if (findings.length === 0) {
    lines.push('No configuration issues found by the current checks.');
    return lines.join('\n');
  }
  for (const f of findings) {
    lines.push(`[${f.severity.toUpperCase()}] rule ${f.ruleId} · ${f.check}`);
    lines.push(`  ${f.message}`);
    lines.push(`  Fix: ${f.fix}`);
    lines.push('');
  }
  return lines.join('\n');
}
