import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
COLLECTOR_DIR = REPO_ROOT / 'collector'
sys.path.insert(0, str(COLLECTOR_DIR))

import main  # noqa: E402


class RawSnapshotRetentionTests(unittest.TestCase):
    def setUp(self):
        self._originals = {
            'RAW_SNAPSHOT_ENABLED': main.RAW_SNAPSHOT_ENABLED,
            'RAW_SNAPSHOT_MIN_INTERVAL_HOURS': main.RAW_SNAPSHOT_MIN_INTERVAL_HOURS,
            'RAW_SNAPSHOT_RETENTION_DAYS': main.RAW_SNAPSHOT_RETENTION_DAYS,
            'RAW_SNAPSHOT_CLEANUP_BATCH_SIZE': main.RAW_SNAPSHOT_CLEANUP_BATCH_SIZE,
            'RAW_SNAPSHOT_CLEANUP_MAX_BATCHES': main.RAW_SNAPSHOT_CLEANUP_MAX_BATCHES,
            'db_client': main.db_client,
            'last_raw_snapshot_cleanup_day': main.last_raw_snapshot_cleanup_day,
        }
        main.RAW_SNAPSHOT_ENABLED = True
        main.RAW_SNAPSHOT_MIN_INTERVAL_HOURS = 24
        main.RAW_SNAPSHOT_RETENTION_DAYS = 3
        main.RAW_SNAPSHOT_CLEANUP_BATCH_SIZE = 1000
        main.RAW_SNAPSHOT_CLEANUP_MAX_BATCHES = 20
        main.db_client = None
        main.last_raw_snapshot_cleanup_day = None

    def tearDown(self):
        for key, value in self._originals.items():
            setattr(main, key, value)

    def test_repeated_collections_do_not_store_full_payload_inside_sample_interval(self):
        first_sync = datetime(2026, 7, 21, 1, 0, tzinfo=timezone.utc)
        second_sync = first_sync + timedelta(minutes=5)
        next_day_sync = first_sync + timedelta(hours=24, minutes=1)

        should_store, reason = main._should_store_raw_snapshot(None, now=first_sync)
        self.assertTrue(should_store)
        self.assertEqual(reason, 'first_raw_snapshot')

        should_store, reason = main._should_store_raw_snapshot(first_sync, now=second_sync)
        self.assertFalse(should_store)
        self.assertEqual(reason, 'sample_interval_not_elapsed')

        should_store, reason = main._should_store_raw_snapshot(first_sync, now=next_day_sync)
        self.assertTrue(should_store)
        self.assertEqual(reason, 'interval_elapsed')

    def test_snapshot_record_keeps_normalized_counters_without_raw_payload(self):
        full_payload = {
            'usage': {
                'total_requests': 12,
                'success_count': 10,
                'failure_count': 2,
                'total_tokens': 3456,
                'apis': {'key': {'models': {'model-a': {'details': ['large history']}}}},
            }
        }

        snapshot = main._build_usage_snapshot_record(
            data=full_payload,
            usage=full_payload['usage'],
            cumulative_cost_usd=1.25,
            store_raw_data=False,
        )

        self.assertIsNone(snapshot['raw_data'])
        self.assertEqual(snapshot['total_requests'], 12)
        self.assertEqual(snapshot['success_count'], 10)
        self.assertEqual(snapshot['failure_count'], 2)
        self.assertEqual(snapshot['total_tokens'], 3456)
        self.assertEqual(snapshot['cumulative_cost_usd'], 1.25)

    def test_raw_snapshot_disabled_never_stores_payload(self):
        main.RAW_SNAPSHOT_ENABLED = False
        should_store, reason = main._should_store_raw_snapshot(None, now=datetime.now(timezone.utc))
        self.assertFalse(should_store)
        self.assertEqual(reason, 'disabled')

    def test_retention_cleanup_uses_bounded_batches_and_cutoff(self):
        class FakeDB:
            def __init__(self):
                self.calls = []

            def null_expired_raw_snapshots(self, cutoff, batch_size, max_batches):
                self.calls.append((cutoff, batch_size, max_batches))
                return {'rows_nullified': 7, 'batches': 2}

        fake_db = FakeDB()
        main.db_client = fake_db
        main.RAW_SNAPSHOT_RETENTION_DAYS = 3
        main.RAW_SNAPSHOT_CLEANUP_BATCH_SIZE = 250
        main.RAW_SNAPSHOT_CLEANUP_MAX_BATCHES = 4

        summary = main._run_raw_snapshot_retention_cleanup(force=True)

        self.assertFalse(summary['skipped'])
        self.assertEqual(summary['rows_nullified'], 7)
        self.assertEqual(summary['batches'], 2)
        self.assertEqual(len(fake_db.calls), 1)
        cutoff, batch_size, max_batches = fake_db.calls[0]
        self.assertEqual(batch_size, 250)
        self.assertEqual(max_batches, 4)
        self.assertLess(cutoff, datetime.now(timezone.utc) - timedelta(days=2, hours=23))


if __name__ == '__main__':
    unittest.main()
