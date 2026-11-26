/**
 * 20261031000001-init-schema-indexes.js
 * Initial Migration: Creates core collections, unique indexes, compound query indexes, and TTL indexes.
 * Source of truth: TECH_STACK.md §7.1, §7.2; PRD.md §9.1.
 */

module.exports = {
  async up(db) {
    // 1. Users collection
    await db.createCollection('users');
    await db.collection('users').createIndex({ phone: 1 }, { unique: true, name: 'uniq_user_phone' });
    await db.collection('users').createIndex({ role: 1 }, { name: 'idx_user_role' });

    // 2. Addresses collection
    await db.createCollection('addresses');
    await db.collection('addresses').createIndex({ userId: 1, isDefault: -1 }, { name: 'idx_user_default_addr' });

    // 3. Services collection
    await db.createCollection('services');
    await db.collection('services').createIndex({ active: 1, category: 1 }, { name: 'idx_service_cat_active' });

    // 4. Bookings collection
    await db.createCollection('bookings');
    await db.collection('bookings').createIndex({ userId: 1, createdAt: -1 }, { name: 'idx_booking_user_created' });
    await db.collection('bookings').createIndex({ status: 1 }, { name: 'idx_booking_status' });

    // 5. Orders collection (Order State Machine anchor)
    await db.createCollection('orders');
    await db.collection('orders').createIndex({ userId: 1, createdAt: -1 }, { name: 'idx_order_user_created' });
    await db.collection('orders').createIndex({ status: 1 }, { name: 'idx_order_status' });
    await db.collection('orders').createIndex({ bookingId: 1 }, { unique: true, sparse: true, name: 'uniq_order_booking' });

    // 6. Order Status Events collection (Append-only state machine audit log)
    await db.createCollection('order_status_events');
    await db.collection('order_status_events').createIndex(
      { orderId: 1, timestamp: 1 },
      { name: 'idx_order_event_history' },
    );

    // 7. Delivery Tasks collection (Agent pickup & delivery assignment)
    await db.createCollection('delivery_tasks');
    await db.collection('delivery_tasks').createIndex(
      { agentId: 1, status: 1, scheduledWindow: 1 },
      { name: 'idx_agent_task_schedule' },
    );
    await db.collection('delivery_tasks').createIndex({ orderId: 1 }, { name: 'idx_task_order' });

    // 8. Order Proofs collection (Mandatory POP & POD photo verification)
    await db.createCollection('order_proofs');
    await db.collection('order_proofs').createIndex(
      { orderId: 1, type: 1, taskId: 1 },
      { unique: true, name: 'uniq_order_task_proof' },
    );
    await db.collection('order_proofs').createIndex({ agentId: 1 }, { name: 'idx_proof_agent' });

    // 9. Pickup Slots collection (Atomic slot reservation)
    await db.createCollection('pickup_slots');
    await db.collection('pickup_slots').createIndex(
      { serviceArea: 1, date: 1, timeWindow: 1 },
      { unique: true, name: 'uniq_pickup_slot_window' },
    );

    // 10. Idempotency Records collection (TTL auto-cleanup)
    await db.createCollection('idempotency_records');
    await db.collection('idempotency_records').createIndex(
      { scope: 1, key: 1 },
      { unique: true, name: 'uniq_idempotency_scope_key' },
    );
    await db.collection('idempotency_records').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_idempotency_expiry' },
    );

    // 11. OTP Codes collection (TTL auto-cleanup after 10 mins)
    await db.createCollection('otp_codes');
    await db.collection('otp_codes').createIndex({ phone: 1 }, { name: 'idx_otp_phone' });
    await db.collection('otp_codes').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_otp_expiry' },
    );

    // 12. Refresh Tokens collection (TTL auto-cleanup)
    await db.createCollection('refresh_tokens');
    await db.collection('refresh_tokens').createIndex(
      { tokenHash: 1 },
      { unique: true, name: 'uniq_refresh_token_hash' },
    );
    await db.collection('refresh_tokens').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_refresh_token_expiry' },
    );
  },

  async down(db) {
    const collections = [
      'refresh_tokens',
      'otp_codes',
      'idempotency_records',
      'pickup_slots',
      'order_proofs',
      'delivery_tasks',
      'order_status_events',
      'orders',
      'bookings',
      'services',
      'addresses',
      'users',
    ];

    for (const name of collections) {
      try {
        await db.collection(name).drop();
      } catch (e) {
        // Ignore if collection does not exist
      }
    }
  },
};

