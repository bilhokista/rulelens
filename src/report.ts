import type { AuthPath, AuthTarget } from './authPaths.js';
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

function describeTarget(target: AuthTarget): string {
  if (target.kind === 'create') return `deploy wasm ${target.wasmHashHex}`;
  return `${target.contract}.${target.fn}()${target.amount === undefined ? '' : ` amount ${target.amount}`}`;
}

export function formatAuthPaths(target: AuthTarget, paths: AuthPath[]): string {
  const lines = [`Who can authorize ${describeTarget(target)}`, ''];
  if (paths.length === 0) {
    lines.push('No active context rule matches this target. The account cannot authorize it.');
    return lines.join('\n');
  }
  for (const path of paths) {
    const status = path.usable === true ? `${path.minSigners} signer(s)` : path.usable === false ? 'BLOCKED' : 'UNDETERMINED';
    lines.push(`rule ${path.ruleId} "${path.ruleName}": ${status}`);
    lines.push(`  ${path.summary}`);
    for (const note of path.notes) lines.push(`  note: ${note}`);
    lines.push('');
  }
  const weakest = paths[0];
  if (weakest.usable === true) {
    lines.push(`Weakest path: rule ${weakest.ruleId} with ${weakest.minSigners} signer(s). This is the real security of the call.`);
  }
  return lines.join('\n');
}
