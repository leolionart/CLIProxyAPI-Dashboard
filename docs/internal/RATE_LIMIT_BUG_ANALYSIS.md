
# Rate Limit Calculation Logic Analysis (Sliding Window Bug)

> [!NOTE]
> **Status:** Resolved
> **Verification Date:** 2025-12-17
> **Analysis:** The interpolation-based fix described below has been implemented in `collector/rate_limiter.py` (see `_calculate_usage`).

**Date:** 2025-12-16
**Author:** Claude Code
**Issue:** The Rate Limit display on the dashboard, specifically for short sliding windows (e.g., "5 hour usage limit"), reports incorrect data (often incorrect red warnings) after long periods of inactivity.

## 1. Issue Summary

Users report that the dashboard displays an "exceeded limit" warning for OpenAI models in the "5-hour window", even though there was very little actual usage during that period. Further analysis reveals that the current usage calculation logic does not correctly handle cases where usage data has gaps (no activity for a long time).

## 2. Root Cause Analysis

The core issue lies in the `_calculate_usage` function in `collector/rate_limiter.py`. This function is designed to calculate usage within a time window by subtracting the **cumulative total at the baseline (window start)** from the **current cumulative total**.

**The error is in how the "baseline" is determined.**

### Current Logic:

1.  **Define `since`:** The start time of the window (e.g., `now - 5 hours`).
2.  **Find Baseline:** Query for the nearest snapshot with `created_at` **less than (`.lt`)** `since`.

### Error Scenario:

-   **20:00 Yesterday:** Last activity, snapshot records `total_tokens = 1,000,000`.
-   **09:00 Today:** `sync_limits` runs. 5-hour window starts at 04:00.
    -   **Current Snapshot:** Still the snapshot from 20:00 yesterday (`1,000,000 tokens`).
    -   **Baseline Snapshot:** System finds nearest snapshot *before* 04:00. It finds the 20:00 yesterday snapshot.
    -   **Result:** `1,000,000 - 1,000,000 = 0`. **Correct.**
-   **14:05 Today:** New activity occurs, snapshot records `total_tokens = 1,010,000`.
-   **14:10 Today:** `sync_limits` runs. 5-hour window starts at 09:10.
    -   **Current Snapshot:** Snapshot at 14:05 (`1,010,000 tokens`).
    -   **Baseline Snapshot:** System finds nearest snapshot *before* 09:10. Since there was no activity overnight, it finds the snapshot from **20:00 Yesterday** (`1,000,000 tokens`).
    -   **Incorrect Result:** `1,010,000 - 1,000,000 = 10,000`. This `10,000` usage actually occurred over **18 hours**, but is attributed to the **5-hour** window, causing a false alarm.

**Conclusion:** The current logic assumes there is always a snapshot near the start of the window. When this assumption fails, it picks a baseline that is too old, resulting in calculating total usage over a much longer period than intended.

## 3. Impact

-   **False Positives:** Users receive incorrect limit warnings, causing confusion and loss of trust.
-   **Unreliable Display:** Rate limit data on the dashboard becomes unreliable, reducing the value of the monitoring tool.
-   **Inaccurate Reality reflection:** The feature fails to meet the core goal of providing an accurate view of usage within a specific timeframe.

## 4. Proposed Fixes (Preliminary)

The `_calculate_usage` logic needs to be modified to correctly handle data gaps. Approaches could include:

1.  **Modified Baseline Logic:** Instead of just taking the snapshot *before* `since`, fetch the snapshot *after* `since` as well and perform interpolation to estimate the value at exactly `since`.
2.  **Data Structure Change:** Instead of incorrectly storing cumulative data, store individual usage events (e.g., each request is a row). Then `SUM` directly over the window. This is accurate but requires major schema changes and performance considerations.
3.  **Hybrid Approach:** Keep using cumulative data but implement a smarter gap handling mechanism.

Detailed plans will be discussed in the next step of the issue resolution plan.
