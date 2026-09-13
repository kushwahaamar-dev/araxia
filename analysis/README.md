# analysis/ — MATLAB threshold derivation

`presence_thresholds.m` reproduces the numbers in `capture/hardware_gate.md`
from the raw Fitbit Air captures and plots them. It is the offline analysis
behind the 8-second freeze gate; the live bridge is Python and does not
depend on MATLAB.

## Run it

MATLAB R2020a+ or [MATLAB Online](https://matlab.mathworks.com/) (free with a
MathWorks account; hackathon licenses also work).

1. Upload the repo (or just `analysis/` and `capture/hr_*.jsonl`, keeping the
   folder layout).
2. In the command window:
   ```matlab
   cd analysis
   presence_thresholds
   ```
3. It prints a summary table and writes `capture/presence_thresholds.png`.

## Expected output

Cross-checked against the same captures with a Python script on 2026-09-13.

| capture | packets | span (s) | median dt (s) | longest identical run | distinct-in-30s min / max |
|---|---|---|---|---|---|
| worn | 191 | 192 | 1.019 | 7 pkts / ~6.1 s | 5 / 11 |
| off-wrist | 177 | 178 | 1.019 | 167 pkts / ~167.7 s (frozen at 112 from t≈18.7 s) | 1 / 2 |
| re-wear | 58 | 58 | 1.019 | 21 pkts / ~20.2 s (stale 112 before live values return) | 1 / 4 |

Freeze gate 8 s sits above the worst worn plateau (~6–7 s in these captures,
up to 15 s seen while calm and seated per `hardware_gate.md`) and far below
the off-wrist behaviour, which never recovers on its own.

## What this is and is not

- It is the analysis that justified `STALE` = same value for ≥ 8 s and
  `READY` = ≥ 2 distinct values in 30 s.
- It is not part of the runtime. Nothing in the demo calls MATLAB.
- Tag `MATLAB` on Devpost only after you have actually run this in MATLAB
  Online and attached the PNG. Do not submit to the MathWorks prize; its
  criteria (bulk of the project in MATLAB, in-silico medicine model) are not
  met and we do not claim otherwise.
