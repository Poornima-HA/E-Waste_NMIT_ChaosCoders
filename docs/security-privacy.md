# E-Waste Ledger: Security, Privacy and Responsible Design

This document explains how E-Waste Ledger protects the integrity of e-waste records, who is allowed to do what, which data goes on-chain and which stays off-chain, and how the system behaves when something fails. It also states clearly what the system does **not** guarantee.

---

## 1. Trust model

E-Waste Ledger assumes that **no single participant is fully trusted**. A company, collector, transporter or recycler may misreport weights, a database administrator may try to edit history, and a buyer may try to reuse a certificate. The design therefore relies on three independent layers:

| Layer | What it guarantees |
|---|---|
| **Backend rules** (FastAPI) | Every business rule is enforced server-side: custody, compliance, mass balance, claims, lineage, certificates, roles. The UI only reflects decisions. |
| **Hash chain** (SHA-256, per batch) | Every event is linked to the previous event's hash, so any edit to past records breaks the chain and is detected. |
| **Blockchain anchors** (EWasteAudit.sol) | The chain head, approved dispatch plans and certificate fingerprints are recorded on an EVM chain, so even the database operator cannot silently rewrite history. |

> A hash or a blockchain record proves that a record **has not changed since it was committed**. It does **not** prove the original measurement was honest. That depends on calibrated equipment, procedures, and independent counts, which is why the system also compares independent weighings and physical stock counts.

---

## 2. Permissions

### 2.1 Participants (application layer)

| Role | Allowed actions | Custody rule |
|---|---|---|
| E-waste company | Register and hand over e-waste | Only at its own site |
| Collector | Confirm receipt, register, dispatch, plan dispatch, split/merge | Only batches it currently holds |
| Transporter | Confirm pickup, deliver | Only batches it holds; only to eligible recyclers |
| Recycler | Confirm delivery, process, claim, certify, split/merge | Only its own runs and claims |
| Auditor | Physical counts, alert reviews | Cannot move or process material |
| Material buyer | Verify and use (retire) certificates | Cannot perform any operational action |

- Every participant write is checked by a central **role & custody guard** before it reaches the business logic.
- Violations return `ROLE_NOT_PERMITTED` or `NOT_YOUR_CUSTODY`.
- **Separation of duties:** a recycler cannot audit its own stock, and the party that creates a certificate is not the party that uses it.
- **Demo limitation:** participant identity uses a demo switcher (an `X-Actor` header). In production, each organization would authenticate with SSO, and high-value actions would be signed with the organization's own key.

### 2.2 Smart contract (chain layer)

| Function | Permission | Protection |
|---|---|---|
| `setAttestor` | `onlyAdmin` | Only the admin grants or revokes attestors |
| `anchorBatchHead` | `onlyAttestor` | Event count must strictly increase (replay and rollback rejected); empty hash rejected |
| `anchorPlan` | `onlyAttestor` | Each plan hash can be anchored once |
| `issueCertificate` | `onlyAttestor` | Each certificate ID can be issued once |
| `retireCertificate` | `onlyAttestor` | Certificate must exist, hash must match, and it can be retired **only once** |
| `getBatchAnchor`, `getCertificate` | Public read | Anyone can verify independently |

These guarantees are covered by **9 dedicated smart-contract tests** (`contracts/tests/test_contract.py`, report in `evidence/contract_test_report.xml`), each run against a freshly deployed contract.

---

## 3. On-chain vs off-chain data

| On-chain (public, tamper-evident) | Off-chain (controlled database) |
|---|---|
| Batch audit-chain head hash + event count | Weights, materials, costs, yields |
| Approved QpiAI dispatch-plan hash + scenario hash | Facility details, licences, participant names |
| Certificate fingerprint + issue/retirement timestamps | Evidence documents (only their SHA-256 fingerprint is used) |
| Attestor address, block timestamp | Solver inputs and outputs, audit findings, alert reviews |

**Why:** commercially sensitive and personal data never needs to be public to be verifiable. Publishing only fingerprints keeps transaction costs low and avoids writing personal or confidential business data to an immutable public ledger.

### Privacy notes

- **No personal data is written on-chain.** Participant names stay in the database.
- **Evidence documents are never uploaded to the chain.** On the public verify page, document checking happens **in the browser**: the file is hashed locally and never leaves the device.
- **Public verify pages are read-only** and show only what a buyer or regulator needs: traceability, mass balance, certificate status and proofs.
- **Known limitation, with a production fix:** some demo evidence references are short text strings. A SHA-256 hash of a short, guessable string could in principle be brute-forced. In production, evidence would be hashed as full documents, or with a secret per-document salt, before being fingerprinted.

---

## 4. Threat model

| # | Threat | Control in E-Waste Ledger | Residual risk / production step |
|---|---|---|---|
| 1 | Database admin edits past records | SHA-256 hash chain per batch + on-chain head anchors; independent verification turns the batch **red (mismatch)** | None for anchored events; unanchored new events are flagged as "not yet anchored" |
| 2 | Replay or rollback of an older anchor | Contract requires a strictly increasing event count | None |
| 3 | Unauthorised party writes to the contract | `onlyAttestor` / `onlyAdmin` modifiers (tested) | Attestor key compromise → see #4 |
| 4 | Attestor key theft | Testnet-only key kept in `.env` (never committed); admin can revoke attestors | Production: hardware security module or multi-signature attestor |
| 5 | Same recovered material claimed twice | Integrity Gate: atomic conditional allocation (race-condition tested), unique claim ID, evidence reuse check | None within the system |
| 6 | Certificate used twice | Single-use retirement enforced in the database **and** on-chain | None |
| 7 | Forged or edited certificate | Certificate hash recomputed and compared with the on-chain fingerprint → **TAMPERED** | None |
| 8 | Swapped evidence document | Document SHA-256 recorded at issuance; public page compares any file locally | Depends on the original document being genuine |
| 9 | Misreported weight at a handover | Sender and receiver weigh independently at every hop; gaps beyond tolerance raise alerts; both readings preserved | Collusion between both parties → independent auditor counts, calibrated signed weighbridges (roadmap) |
| 10 | Physically impossible recovery claims | Mass balance: outputs exceeding input are critical and claims from critical runs are blocked | Depends on honest input weighing |
| 11 | Material on paper but not on the floor | Inventory reconciliation against independent physical counts → `GHOST_INVENTORY` | Count frequency is an operational decision |
| 12 | Dispatch to an unlicensed recycler | Compliance gate in the backend, hard constraint in the optimizer, greyed out in the UI | Licence data must be kept current (demo data today) |
| 13 | Acting outside one's role | Central role & custody guard | Demo identity switcher → SSO / signed actions in production |
| 14 | Bypassing the UI | All rules enforced in the backend; tests call the API directly | None |
| 15 | Hiding a dispute behind a split/merge | Disputed batches cannot be split or merged | None |
| 16 | Wrong solver output accepted | Independent verifier re-checks every assignment and recomputes the objective before approval | None |

---

## 5. Failure handling

| Failure | Behaviour |
|---|---|
| Blockchain unreachable | Operations continue off-chain; anchors stay `not_submitted` or `pending`; nothing is shown as verified until checked on-chain; certificate retirement of an anchored certificate is **refused** rather than recorded inconsistently |
| Transaction fails | Receipt stored as `failed` with the error; can be retried |
| Contract missing features after a reset | Certificate issuance stores the certificate but marks the anchor `failed`; public pages report the problem instead of crashing |
| QpiAI service unavailable | The last verified optimization run remains available; no plan is approved without passing the independent verifier |
| QCloud execution unavailable | Reported honestly as "circuit uploaded, execution awaits subscription"; local simulator results are labelled as local |
| Concurrent claims | Conditional database update guarantees only one succeeds |
| Page error | Error boundary shows the message and keeps navigation available |

Every security-relevant decision (accepted and rejected claims, alert reviews, certificate use) is **logged and hash-chained**, so the audit trail covers failures and attacks, not only successes.

---

## 6. Responsible design

- **No black-box decisions.** All fraud and discrepancy checks are deterministic rules with visible thresholds and explanations. No machine-learning model decides whether a participant is honest.
- **Explainability.** Every alert shows the rule, the measured values, the threshold, and the batch it belongs to.
- **Fairness of thresholds.** Fixed percentage tolerances can affect small batches or small facilities with less precise scales differently. Thresholds are configurable and should be calibrated per scale class and material before production use.
- **Human oversight.** Alerts are reviewed by an auditor with a mandatory note; reviews never change original measurements, and closed alerts cannot be reopened.
- **Honest labelling.** The UI and documents clearly label demo data, the local demonstration chain, demonstration thresholds, and the fact that facilities are not government-verified.
- **No quantum overclaiming.** QAOA results are reported as `best_found`, never as proven optimal, and no quantum advantage is claimed.
