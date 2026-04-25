CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`request_payload` text,
	`response_status` integer,
	`response_body` text,
	`processed_at` integer NOT NULL,
	`internally_processed` integer
);
--> statement-breakpoint
CREATE TABLE `time_off_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`location_id` text NOT NULL,
	`amount` integer NOT NULL,
	`last_sync` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emp_loc_idx` ON `time_off_balances` (`employee_id`,`location_id`);--> statement-breakpoint
CREATE TABLE `transaction_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`employee_id` text NOT NULL,
	`location_id` text NOT NULL,
	`amount` integer NOT NULL,
	`action_type` text NOT NULL,
	`source_system` text,
	`created_at` integer NOT NULL
);
