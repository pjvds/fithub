ALTER TABLE connections ADD COLUMN sync_cursor TEXT;
ALTER TABLE connections ADD COLUMN in_flight_job_id TEXT;
