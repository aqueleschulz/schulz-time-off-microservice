import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const timeOffBalancesTable = sqliteTable(
  'time_off_balances',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id').notNull(),
    locationId: text('location_id').notNull(),
    amount: integer('amount').notNull(), // Stored in Minutes (Integer)
    lastSync: integer('last_sync', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    empLocIndex: uniqueIndex('emp_loc_idx').on(
      table.employeeId,
      table.locationId,
    ),
  }),
);

export const transactionAuditLogsTable = sqliteTable('transaction_audit_logs', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id'),
  employeeId: text('employee_id').notNull(),
  locationId: text('location_id').notNull(),
  amount: integer('amount').notNull(), // Stored in Minutes (Integer)
  actionType: text('action_type').notNull(),
  sourceSystem: text('source_system'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const idempotencyKeysTable = sqliteTable('idempotency_keys', {
  key: text('key').primaryKey(),
  requestPayload: text('request_payload', { mode: 'json' }),
  responseStatus: integer('response_status'),
  responseBody: text('response_body', { mode: 'json' }),
  processedAt: integer('processed_at', { mode: 'timestamp' }).notNull(),
  internallyProcessed: integer('internally_processed', { mode: 'boolean' }),
});
