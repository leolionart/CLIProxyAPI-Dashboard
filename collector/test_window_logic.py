
from datetime import datetime, timedelta

def calculate_window_start(now, reset_strategy, window_minutes=None, reset_anchor_str=None):
    # Simulated logic from rate_limiter.py
    
    calculated_window_start = now
    if reset_strategy == 'daily':
        calculated_window_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif reset_strategy == 'weekly':
        # Calendar week: Reset on Monday 00:00
        start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        days_since_monday = start_of_today.weekday() # Monday is 0
        calculated_window_start = start_of_today - timedelta(days=days_since_monday)
    elif reset_strategy == 'rolling':
        calculated_window_start = now - timedelta(minutes=window_minutes)
    
    window_start = calculated_window_start
    
    if reset_anchor_str:
        try:
            # remove Z if present for compatibility
            reset_anchor_dt = datetime.fromisoformat(reset_anchor_str.replace('Z', '+00:00'))
            
            # Logic from file
            if reset_anchor_dt > calculated_window_start:
                window_start = reset_anchor_dt
        except ValueError:
            pass
            
    return window_start

def test():
    # Test 1: Weekly Strategy - Basic Monday Reset
    # Wednesday
    now = datetime(2023, 10, 25, 10, 0, 0) # Wed
    expected_monday = datetime(2023, 10, 23, 0, 0, 0)
    result = calculate_window_start(now, 'weekly')
    assert result == expected_monday, f"Test 1 Failed: {result} != {expected_monday}"
    print("Test 1 Passed: Weekly resets to last Monday")

    # Test 2: Weekly Strategy - Reset is today (Monday)
    now = datetime(2023, 10, 23, 10, 0, 0) # Mon
    expected_monday = datetime(2023, 10, 23, 0, 0, 0)
    result = calculate_window_start(now, 'weekly')
    assert result == expected_monday, f"Test 2 Failed: {result} != {expected_monday}"
    print("Test 2 Passed: Weekly on Monday resets to today 00:00")

    # Test 3: Manual Reset Anchor overriding natural start
    # Natural start: Mon Oct 23. Anchor: Tue Oct 24. Now: Wed Oct 25.
    now = datetime(2023, 10, 25, 10, 0, 0)
    anchor = "2023-10-24T12:00:00"
    expected = datetime(2023, 10, 24, 12, 0, 0)
    result = calculate_window_start(now, 'weekly', reset_anchor_str=anchor)
    assert result == expected, f"Test 3 Failed: {result} != {expected}"
    print("Test 3 Passed: Manual anchor overrides natural start if newer")

    # Test 4: Manual Reset Anchor EXPIRED
    # Natural start: Mon Oct 23. Anchor: Sun Oct 22. Now: Wed Oct 25.
    # Should ignore anchor and use natural start
    now = datetime(2023, 10, 25, 10, 0, 0)
    anchor = "2023-10-22T12:00:00"
    expected = datetime(2023, 10, 23, 0, 0, 0) # Natural Monday
    result = calculate_window_start(now, 'weekly', reset_anchor_str=anchor)
    assert result == expected, f"Test 4 Failed: {result} != {expected}"
    print("Test 4 Passed: Expired anchor is ignored")

    print("\nALL TESTS PASSED")

if __name__ == "__main__":
    test()
