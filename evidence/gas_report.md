# Measured gas usage

gasUsed measured on a local EVM (ganache). Cost columns use ILLUSTRATIVE gas prices, not live market prices: cost_ETH = gas x gwei x 1e-9.

| Operation | Gas used | ETH @1 gwei | ETH @10 gwei | ETH @30 gwei |
|---|---:|---:|---:|---:|
| deploy | 932,121 | 0.000932 | 0.009321 | 0.027964 |
| setAttestor | 36,830 | 0.000037 | 0.000368 | 0.001105 |
| anchorBatchHead | 64,426 | 0.000064 | 0.000644 | 0.001933 |
| anchorPlan | 50,515 | 0.000051 | 0.000505 | 0.001515 |
| issueCertificate | 72,463 | 0.000072 | 0.000725 | 0.002174 |
| retireCertificate | 36,653 | 0.000037 | 0.000367 | 0.001100 |
| per_batch_lifecycle (2 anchors + issue + retire) | 237,968 | 0.000238 | 0.002380 | 0.007139 |
