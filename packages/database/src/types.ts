import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * Validated lifecycle statuses for global platform users.
 * Aligned with UserStatusSchema in @grocery/api-contracts.
 */
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';

/**
 * Validated lifecycle statuses for merchant stores.
 * Aligned with StoreStatusSchema in @grocery/api-contracts.
 */
export type StoreStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

/**
 * Architecture-approved store-scoped roles.
 * Aligned with StoreRoleSchema in @grocery/api-contracts.
 */
export type StoreRole = 'OWNER' | 'MANAGER' | 'STAFF';

/**
 * Validated lifecycle statuses for store memberships.
 * Aligned with MembershipStatusSchema in @grocery/api-contracts.
 */
export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

/**
 * Kysely table interface for identity.users.
 * Represents global platform users (merchants, staff, or registered customers).
 */
export interface UsersTable {
  id: Generated<string>;
  email: string | null;
  phone: string | null;
  full_name: string;
  status: Generated<UserStatus>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

/**
 * Kysely table interface for identity.user_credentials.
 * Stores sensitive password hashes separately from public user profiles.
 */
export interface UserCredentialsTable {
  user_id: string;
  password_hash: string;
  algorithm: Generated<string>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type UserCredentialRow = Selectable<UserCredentialsTable>;
export type NewUserCredential = Insertable<UserCredentialsTable>;
export type UserCredentialUpdate = Updateable<UserCredentialsTable>;

/**
 * Kysely table interface for identity.stores.
 * Represents merchant stores (tenant boundary root).
 */
export interface StoresTable {
  id: Generated<string>;
  name: string;
  code: string | null;
  currency: Generated<string>;
  timezone: Generated<string>;
  status: Generated<StoreStatus>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type StoreRow = Selectable<StoresTable>;
export type NewStore = Insertable<StoresTable>;
export type StoreUpdate = Updateable<StoresTable>;

/**
 * Kysely table interface for identity.store_memberships.
 * Represents explicit user-to-store membership and store-scoped roles.
 */
export interface StoreMembershipsTable {
  id: Generated<string>;
  user_id: string;
  store_id: string;
  role: StoreRole;
  status: Generated<MembershipStatus>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type StoreMembershipRow = Selectable<StoreMembershipsTable>;
export type NewStoreMembership = Insertable<StoreMembershipsTable>;
export type StoreMembershipUpdate = Updateable<StoreMembershipsTable>;

export type RefreshTokenStatus = 'ACTIVE' | 'CONSUMED' | 'REVOKED';

/**
 * Kysely table interface for identity.refresh_tokens.
 * Supports token-family based rotation and reuse detection.
 */
export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  token_hash: string;
  status: Generated<RefreshTokenStatus>;
  consumed_at: Date | string | null;
  revoked_at: Date | string | null;
  revoked_reason: string | null;
  replaced_by_token_id: string | null;
  expires_at: Date | string;
  family_expires_at: Generated<Date | string>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type RefreshTokenRow = Selectable<RefreshTokensTable>;
export type NewRefreshToken = Insertable<RefreshTokensTable>;
export type RefreshTokenUpdate = Updateable<RefreshTokensTable>;

export type CategoryStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

/**
 * Kysely table interface for catalog.categories.
 * Store-scoped category hierarchy with parent_id linkage.
 */
export interface CategoriesTable {
  id: Generated<string>;
  store_id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  sort_order: Generated<number>;
  status: Generated<CategoryStatus>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type CategoryRow = Selectable<CategoriesTable>;
export type NewCategory = Insertable<CategoriesTable>;
export type CategoryUpdate = Updateable<CategoriesTable>;

export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ProductUnit = 'PIECE' | 'KG' | 'GRAM' | 'LITRE' | 'MILLILITRE' | 'PACK' | 'DOZEN';

/**
 * Kysely table interface for catalog.products.
 * Store-scoped product definition with pricing in integer cents/paise.
 */
export interface ProductsTable {
  id: Generated<string>;
  store_id: string;
  category_id: string | null;
  name: string;
  slug: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  price_cents: number | string | bigint;
  currency: Generated<string>;
  unit: Generated<ProductUnit>;
  is_weight_based: Generated<boolean>;
  status: Generated<ProductStatus>;
  image_url: string | null;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type ProductRow = Selectable<ProductsTable>;
export type NewProduct = Insertable<ProductsTable>;
export type ProductUpdate = Updateable<ProductsTable>;

/**
 * Kysely table interface for inventory.stock_balances.
 * Store-scoped product inventory levels tracking on-hand, reserved, and available stock.
 */
export interface StockBalancesTable {
  id: Generated<string>;
  store_id: string;
  product_id: string;
  sku: string | null;
  on_hand_quantity: Generated<number | string>;
  reserved_quantity: Generated<number | string>;
  available_quantity: Generated<number | string>;
  reorder_point: number | string | null;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type StockBalanceRow = Selectable<StockBalancesTable>;
export type NewStockBalance = Insertable<StockBalancesTable>;
export type StockBalanceUpdate = Updateable<StockBalancesTable>;

export type StockReservationStatus = 'ACTIVE' | 'FULFILLED' | 'RELEASED' | 'EXPIRED';

/**
 * Kysely table interface for inventory.stock_reservations.
 * Order-correlated stock reservations with explicit status lifecycle and expiration.
 */
export interface StockReservationsTable {
  id: Generated<string>;
  store_id: string;
  order_id: string;
  status: Generated<StockReservationStatus>;
  expires_at: Date | string;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type StockReservationRow = Selectable<StockReservationsTable>;
export type NewStockReservation = Insertable<StockReservationsTable>;
export type StockReservationUpdate = Updateable<StockReservationsTable>;

/**
 * Kysely table interface for inventory.stock_reservation_items.
 * Itemized product quantities reserved under a reservation record.
 */
export interface StockReservationItemsTable {
  id: Generated<string>;
  reservation_id: string;
  store_id: string;
  product_id: string;
  quantity: number | string;
  created_at: Generated<Date | string>;
}

export type StockReservationItemRow = Selectable<StockReservationItemsTable>;
export type NewStockReservationItem = Insertable<StockReservationItemsTable>;

export type StockMovementReason =
  | 'INFLOW_PURCHASE'
  | 'RESERVATION_HOLD'
  | 'RESERVATION_RELEASE'
  | 'FULFILLMENT_OUTFLOW'
  | 'MANUAL_CORRECTION'
  | 'SHRINKAGE_DAMAGE';

/**
 * Kysely table interface for inventory.stock_movements.
 * Append-only immutable audit ledger recording every inventory modification.
 */
export interface StockMovementsTable {
  id: Generated<string>;
  store_id: string;
  product_id: string;
  delta_quantity: number | string;
  reason: StockMovementReason;
  reference_id: string | null;
  created_at: Generated<Date | string>;
}

export type StockMovementRow = Selectable<StockMovementsTable>;
export type NewStockMovement = Insertable<StockMovementsTable>;

export type OrderStatus =
  | 'RECEIVED'
  | 'AWAITING_SHOPKEEPER_REVIEW'
  | 'CHANGE_REQUESTED'
  | 'REJECTED'
  | 'CONFIRMATION_PENDING_RESERVATION'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'DISPATCHED'
  | 'COMPLETED'
  | 'CANCELLED';

export type FulfillmentType = 'PICKUP' | 'DELIVERY';

/**
 * Kysely table interface for order.orders.
 * Store-scoped order entity with review workflow and fulfillment states.
 */
export interface OrdersTable {
  id: Generated<string>;
  store_id: string;
  customer_id: string | null;
  order_number: string;
  status: Generated<OrderStatus>;
  fulfillment_type: Generated<FulfillmentType>;
  delivery_address: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  total_amount_cents: Generated<number | string | bigint>;
  currency: Generated<string>;
  notes: string | null;
  idempotency_key: string | null;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type OrderRow = Selectable<OrdersTable>;
export type NewOrder = Insertable<OrdersTable>;
export type OrderUpdate = Updateable<OrdersTable>;

export type OrderItemStatus = 'PENDING' | 'CONFIRMED' | 'SUBSTITUTED' | 'REMOVED';

/**
 * Kysely table interface for order.order_items.
 * Immutable price snapshots, quantities, and item substitution tracking.
 */
export interface OrderItemsTable {
  id: Generated<string>;
  order_id: string;
  store_id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string | null;
  unit_snapshot: Generated<string>;
  unit_price_cents: number | string | bigint;
  quantity: number | string;
  total_price_cents: number | string | bigint;
  status: Generated<OrderItemStatus>;
  substituted_product_id: string | null;
  substitution_notes: string | null;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type OrderItemRow = Selectable<OrderItemsTable>;
export type NewOrderItem = Insertable<OrderItemsTable>;
export type OrderItemUpdate = Updateable<OrderItemsTable>;

/**
 * Kysely table interface for order.order_status_history.
 * Audit trail of order state machine transitions.
 */
export interface OrderStatusHistoryTable {
  id: Generated<string>;
  order_id: string;
  store_id: string;
  from_status: string | null;
  to_status: string;
  changed_by_user_id: string | null;
  reason: string | null;
  created_at: Generated<Date | string>;
}

export type OrderStatusHistoryRow = Selectable<OrderStatusHistoryTable>;
export type NewOrderStatusHistory = Insertable<OrderStatusHistoryTable>;

export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'UPI' | 'CARD' | 'NETBANKING' | 'WALLET' | 'COD' | 'OTHER';
export type PaymentProvider = 'RAZORPAY' | 'STRIPE' | 'CASH_ON_DELIVERY' | 'MOCK';

/**
 * Kysely table interface for payment.payments.
 * Store-scoped payment entity tracking processing lifecycle, gateway ids, and method.
 */
export interface PaymentsTable {
  id: Generated<string>;
  store_id: string;
  order_id: string;
  payment_method: Generated<PaymentMethod>;
  provider: Generated<PaymentProvider>;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  amount_cents: number | string | bigint;
  currency: Generated<string>;
  status: Generated<PaymentStatus>;
  idempotency_key: string | null;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type PaymentRow = Selectable<PaymentsTable>;
export type NewPayment = Insertable<PaymentsTable>;
export type PaymentUpdate = Updateable<PaymentsTable>;

export type WebhookStatus = 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'IGNORED';

/**
 * Kysely table interface for payment.payment_webhooks.
 * Append-only idempotent webhook event journal preventing duplicate event execution.
 */
export interface PaymentWebhooksTable {
  id: Generated<string>;
  store_id: string;
  provider: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  signature: string;
  status: Generated<WebhookStatus>;
  processed_at: Date | string | null;
  created_at: Generated<Date | string>;
}

export type PaymentWebhookRow = Selectable<PaymentWebhooksTable>;
export type NewPaymentWebhook = Insertable<PaymentWebhooksTable>;
export type PaymentWebhookUpdate = Updateable<PaymentWebhooksTable>;

export type RefundStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

/**
 * Kysely table interface for payment.refunds.
 * Store-scoped refund records correlating with payments.
 */
export interface RefundsTable {
  id: Generated<string>;
  payment_id: string;
  store_id: string;
  amount_cents: number | string | bigint;
  reason: string | null;
  provider_refund_id: string | null;
  status: Generated<RefundStatus>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type RefundRow = Selectable<RefundsTable>;
export type NewRefund = Insertable<RefundsTable>;
export type RefundUpdate = Updateable<RefundsTable>;

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'DEAD_LETTER';

/**
 * Kysely table interface for events.outbox.
 * Transactional Outbox queue for atomic event publishing and asynchronous worker consumption.
 */
export interface OutboxTable {
  id: Generated<string>;
  store_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  metadata: unknown | null;
  status: Generated<OutboxStatus>;
  retry_count: Generated<number>;
  max_retries: Generated<number>;
  scheduled_at: Generated<Date | string>;
  processed_at: Date | string | null;
  last_error: string | null;
  created_at: Generated<Date | string>;
}

export type OutboxRow = Selectable<OutboxTable>;
export type NewOutbox = Insertable<OutboxTable>;
export type OutboxUpdate = Updateable<OutboxTable>;

export type NotificationChannel = 'WHATSAPP' | 'SMS' | 'EMAIL';
export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';

/**
 * Kysely table interface for events.notification_logs.
 * Multi-channel delivery ledger auditing message dispatches, templates, and provider statuses.
 */
export interface NotificationLogsTable {
  id: Generated<string>;
  store_id: string;
  outbox_id: string | null;
  channel: Generated<NotificationChannel>;
  recipient: string;
  template_name: string;
  payload: unknown;
  status: Generated<NotificationStatus>;
  provider_message_id: string | null;
  sent_at: Date | string | null;
  delivered_at: Date | string | null;
  error_message: string | null;
  created_at: Generated<Date | string>;
}

export type NotificationLogRow = Selectable<NotificationLogsTable>;
export type NewNotificationLog = Insertable<NotificationLogsTable>;
export type NotificationLogUpdate = Updateable<NotificationLogsTable>;

/**
 * Validated lifecycle statuses for inbound WhatsApp messages.
 */
export type InboundMessageStatus =
  'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'QUARANTINED' | 'DEAD_LETTER';

/**
 * Validated lifecycle statuses for provisional WhatsApp quotes.
 */
export type ProvisionalQuoteStatus = 'ACTIVE' | 'CONFIRMING' | 'ORDER_CREATED' | 'EXPIRED';

/**
 * Kysely table interface for whatsapp.store_channels.
 */
export interface StoreChannelsTable {
  id: Generated<string>;
  store_id: string;
  phone_number_id: string;
  display_phone_number: string;
  waba_id: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type StoreChannelRow = Selectable<StoreChannelsTable>;
export type NewStoreChannel = Insertable<StoreChannelsTable>;
export type StoreChannelUpdate = Updateable<StoreChannelsTable>;

/**
 * Kysely table interface for whatsapp.inbound_messages.
 */
export interface InboundMessagesTable {
  id: Generated<string>;
  provider_message_id: string;
  store_id: string | null;
  sender_phone_e164: string;
  payload: unknown;
  status: Generated<InboundMessageStatus>;
  attempt_count: Generated<number>;
  max_retries: Generated<number>;
  locked_until: Date | string | null;
  last_error: string | null;
  created_at: Generated<Date | string>;
  processed_at: Date | string | null;
}

export type InboundMessageRow = Selectable<InboundMessagesTable>;
export type NewInboundMessage = Insertable<InboundMessagesTable>;
export type InboundMessageUpdate = Updateable<InboundMessagesTable>;

/**
 * Kysely table interface for whatsapp.conversations.
 */
export interface ConversationsTable {
  id: Generated<string>;
  store_id: string;
  sender_phone_e164: string;
  state: Generated<string>;
  context: Generated<unknown>;
  last_inbound_at: Generated<Date | string>;
  last_outbound_at: Date | string | null;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type ConversationRow = Selectable<ConversationsTable>;
export type NewConversation = Insertable<ConversationsTable>;
export type ConversationUpdate = Updateable<ConversationsTable>;

/**
 * Kysely table interface for whatsapp.provisional_quotes.
 */
export interface ProvisionalQuotesTable {
  id: Generated<string>;
  conversation_id: string;
  store_id: string;
  quote_version: Generated<number>;
  status: Generated<ProvisionalQuoteStatus>;
  items: unknown;
  subtotal_minor: number;
  tax_minor: Generated<number>;
  delivery_minor: Generated<number>;
  total_minor: number;
  order_id: string | null;
  expires_at: Date | string;
  confirmed_at: Date | string | null;
  created_at: Generated<Date | string>;
}

export type ProvisionalQuoteRow = Selectable<ProvisionalQuotesTable>;
export type NewProvisionalQuote = Insertable<ProvisionalQuotesTable>;
export type ProvisionalQuoteUpdate = Updateable<ProvisionalQuotesTable>;

/**
 * Kysely table interface for whatsapp.customer_phone_links.
 */
export interface CustomerPhoneLinksTable {
  sender_phone_e164: string;
  user_id: string;
  verification_status: Generated<'UNVERIFIED' | 'VERIFIED' | 'REVOKED'>;
  verified_at: Date | string | null;
  created_at: Generated<Date | string>;
}

export type CustomerPhoneLinkRow = Selectable<CustomerPhoneLinksTable>;
export type NewCustomerPhoneLink = Insertable<CustomerPhoneLinksTable>;
export type CustomerPhoneLinkUpdate = Updateable<CustomerPhoneLinksTable>;

/**
 * Composite Kysely database schema interface for platform persistence.
 * Supports both schema-prefixed and direct table access when search_path is configured.
 */
export interface Database {
  'identity.users': UsersTable;
  'identity.user_credentials': UserCredentialsTable;
  'identity.stores': StoresTable;
  'identity.store_memberships': StoreMembershipsTable;
  'identity.refresh_tokens': RefreshTokensTable;
  'catalog.categories': CategoriesTable;
  'catalog.products': ProductsTable;
  'inventory.stock_balances': StockBalancesTable;
  'inventory.stock_reservations': StockReservationsTable;
  'inventory.stock_reservation_items': StockReservationItemsTable;
  'inventory.stock_movements': StockMovementsTable;
  'order.orders': OrdersTable;
  'order.order_items': OrderItemsTable;
  'order.order_status_history': OrderStatusHistoryTable;
  'payment.payments': PaymentsTable;
  'payment.payment_webhooks': PaymentWebhooksTable;
  'payment.refunds': RefundsTable;
  'events.outbox': OutboxTable;
  'events.notification_logs': NotificationLogsTable;
  'whatsapp.store_channels': StoreChannelsTable;
  'whatsapp.inbound_messages': InboundMessagesTable;
  'whatsapp.conversations': ConversationsTable;
  'whatsapp.provisional_quotes': ProvisionalQuotesTable;
  'whatsapp.customer_phone_links': CustomerPhoneLinksTable;
  users: UsersTable;
  user_credentials: UserCredentialsTable;
  stores: StoresTable;
  store_memberships: StoreMembershipsTable;
  refresh_tokens: RefreshTokensTable;
  categories: CategoriesTable;
  products: ProductsTable;
  stock_balances: StockBalancesTable;
  stock_reservations: StockReservationsTable;
  stock_reservation_items: StockReservationItemsTable;
  stock_movements: StockMovementsTable;
  orders: OrdersTable;
  order_items: OrderItemsTable;
  order_status_history: OrderStatusHistoryTable;
  payments: PaymentsTable;
  payment_webhooks: PaymentWebhooksTable;
  refunds: RefundsTable;
  outbox: OutboxTable;
  notification_logs: NotificationLogsTable;
  store_channels: StoreChannelsTable;
  inbound_messages: InboundMessagesTable;
  conversations: ConversationsTable;
  provisional_quotes: ProvisionalQuotesTable;
  customer_phone_links: CustomerPhoneLinksTable;
}
