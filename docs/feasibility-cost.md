# E-Waste Ledger: Feasibility, Cost and Deployment

This document covers practicality, transaction costs, performance and maintainability, using **measured** values where available and clearly marking anything illustrative.

---

## 1. Transaction costs (measured)

Gas usage was measured on a local EVM (ganache) by the smart-contract test suite (`contracts/tests/test_contract.py`, output in `evidence/gas_report.json` and `evidence/gas_report.md`).

| Operation | When it happens | Gas used (measured, average) |
|---|---|---:|
| Contract deployment | Once | 932,121 |
| `setAttestor` | When an attestor is added or removed | 36,830 |
| `anchorBatchHead` | When a batch's audit chain is anchored | 64,426 |
| `anchorPlan` | When a QpiAI dispatch plan is approved | 50,515 |
| `issueCertificate` | When a recovery certificate is issued | 72,463 |
| `retireCertificate` | When a buyer uses a certificate | 36,653 |
| **Per batch lifecycle** (2 anchors + issue + retire) | Per batch | **237,968** |

### Converting gas to money

`cost (ETH) = gas used × gas price (gwei) × 10⁻⁹`

| Illustrative gas price | Per batch lifecycle (237,968 gas) |
|---|---:|
| 1 gwei | 0.000238 ETH |
| 10 gwei | 0.002380 ETH |
| 30 gwei | 0.007139 ETH |

> These gas prices are **illustrative**, not live market data. Real cost depends on the chosen network's gas price and the ETH price on the day. Layer-2 networks and sidechains generally charge far less per unit of gas than Ethereum mainnet, which is why an L2 is the intended production target.

### Why costs stay low by design

- **Only fingerprints go on-chain.** A full batch history (registration, every handover, processing, claims, costs, reviews) is summarised in **one 32-byte hash** per anchor, instead of one transaction per event.
- **Anchoring frequency is a business choice.** A batch can be anchored at key milestones (for example, on delivery and on certification) rather than after every event.
- **Planned optimisation, not yet implemented:** anchoring a single Merkle root that covers many batches would divide the anchoring cost by the number of batches per transaction.

---

## 2. Performance (measured in the demo)

| Workload | Measured |
|---|---|
| QpiAI Opt MILP, 6 batches × 4 recyclers | `optimal` / `global_optimum`; solver time about 0.08 s, about 1.3 s wall time including the online key check |
| QAOA benchmark, 8 qubits (local QpiAI simulator) | About 5 s |
| Backend test suite (39 tests) | Runs in seconds |
| Smart-contract test suite (9 tests) | Runs in seconds on a local chain |

**Scaling notes**

- The allocation model grows with batches × eligible facilities. Ineligible pairs are removed before solving, which keeps the model small. Larger real-world instances are a natural fit for QpiAI Opt's MILP solver; we have not benchmarked them yet.
- QAOA is used as a **benchmark on a small sub-instance**, not as the production solver; qubit counts grow quickly with problem size and slack variables.
- The backend is stateless apart from the database, so it can be scaled horizontally behind a load balancer.

---

## 3. Deployment path

| Stage | Database | Chain | Identity |
|---|---|---|---|
| **Demo (today)** | SQLite | Local ganache (labelled "local demo chain") | Demo participant switcher |
| **Pilot** | PostgreSQL (managed) | Public testnet (e.g. Sepolia), same scripts with a different `RPC_URL` | SSO per organization |
| **Production** | PostgreSQL with backups | Low-cost EVM Layer-2, attestor key in an HSM or multi-signature wallet | SSO + signed high-value actions |

- The same deployment and verification code works on any EVM network; only `RPC_URL`, the funded attestor key and the chain ID change.
- The conditional-update allocation used by the Integrity Gate is designed to stay correct under concurrent load on PostgreSQL.

---

## 4. Operating cost drivers

| Driver | Notes |
|---|---|
| Hosting | One API service, one web front end, one PostgreSQL database |
| Blockchain | Per-batch gas as measured above; can be reduced further with milestone-only or Merkle-batched anchoring |
| QpiAI | Opt platform/credit usage for optimization runs; local key-authenticated solving was used in the demo |
| Integration | Weighbridge integration and regulator licence data feeds (roadmap) |

---

## 5. Maintainability

- **Modular backend:** each capability (custody, roles, recovery, certificates, inventory, lineage, costs, governance, analytics, blockchain) is its own router module.
- **Integer accounting:** masses in grams and money in paise, so there are no floating-point accounting errors.
- **Tested rules:** 39 backend tests and 9 smart-contract tests cover every integrity rule, and can be rerun at any time.
- **Reproducible demo:** `reset_demo.py` rebuilds a known dataset through the real API; `smoke_check.py` verifies a running system without changing data.
- **Evidence by default:** solver runs, blockchain receipts, gas usage and test reports are saved under `evidence/`.

---

## 6. Practical adoption

- **Works with existing operations.** Participants record weights they already measure; nothing requires new hardware for the pilot.
- **Gradual rollout.** One collector, one transporter and one recycler can pilot the full journey before other partners join.
- **Clear value per participant:** recyclers get defensible recovery claims and certificates; buyers get single-use, verifiable proof; auditors get explainable findings; companies get proof their e-waste reached a licensed recycler.
