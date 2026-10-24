# Security

Scalar Commons runs a public **testnet**. Tokens have no value and the chain may be reset.

## Reporting a vulnerability

Please report security problems privately through GitHub: open this repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a vulnerability. Include what you found, how to reproduce it, and the runtime version (shown in the footer of every page on scalarnet.io).

## Security posture

This is the public summary of the posture record the operators keep in [`landing/public/posture.json`](landing/public/posture.json). Each line names the document it comes from; nothing here is read from the chain.

| Item | Record | As of | Source |
|---|---|---|---|
| Audit findings examined | 382 findings from 17 auditors over the runtime, the products and the host; every critical and high finding (73) adversarially verified | 2026-09-08 | `TESTNETAUDIT.md` §2 |
| Fixed in runtime 307 | 4 findings from the lab sprint of 26 September (E1, E21, E22, E25), each with a test that was red before and green after | 2026-09-26 | pull request #211 |
| Red-team agent | Phase 1 (propose-only) completed; nothing submitted. A finding about one model's behaviour, not about the chain's defences | 2026-09-29 | `docs/internal/RED-AGENT-PHASE1.md` |
| Last upgrade rehearsal | Runtime 309 rehearsed by the operators on a fork of live state before it was applied | 2026-10-05 | `evidence/day5/309-apply.md` |

The record is updated by the operators; the dates above say when each value was true.
