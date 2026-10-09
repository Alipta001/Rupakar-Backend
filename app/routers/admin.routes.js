import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listAdminOrders, getAdminOrder } from '../controllers/order.controller.js';
import {
  listAdminShipments,
  getAdminShipment,
  updateAdminShipmentStatus,
  downloadAdminShippingLabel,
  retryAdminPickup,
  resyncAdminTracking,
  retryAdminFulfillment,
  assignAdminAwb,
  generateAdminLabel,
} from '../controllers/shipping.controller.js';
import { listAdminReturns, getAdminReturn, approveReturn, rejectReturn } from '../controllers/return.controller.js';
import { listAdminInvoices, getAdminInvoiceDetail } from '../controllers/invoice.controller.js';
import { listAdminNotifications } from '../controllers/notification.controller.js';
import { listAdminSupportTickets, getAdminSupportTicket, updateAdminSupportTicket } from '../controllers/support.controller.js';
import {
  getAdminDashboardMetrics,
  listAdminUsers,
  getAdminUser,
  updateAdminUserStatus,
  listAdminInventory,
  listAdminPayments,
  listAdminRefunds,
  listAdminCommissions,
  listAdminCoupons,
  createAdminCoupon,
  updateAdminCouponStatus,
  listAdminReviews,
  updateAdminReviewStatus,
  listAdminAuthenticity,
  verifyAdminAuthenticity,
  getAdminAnalytics,
  listAdminAuditLogs,
  getAdminSettings,
  listAdminVendorPickupLocations,
  getAdminVendorPickupLocation,
  approveAdminVendorPickupLocation,
  deactivateAdminVendorPickupLocation,
  archiveAdminVendorPickupLocation,
  reactivateAdminVendorPickupLocation,
} from '../controllers/admin.controller.js';

const router = Router();

router.use(requireAuth);
router.use(requireRole('admin'));

// Vendor Pickup Locations
router.get('/vendors/pickup-locations', listAdminVendorPickupLocations);
router.get('/vendors/:vendorId/pickup-location', getAdminVendorPickupLocation);
router.patch('/vendors/:vendorId/pickup-location/approve', approveAdminVendorPickupLocation);
router.patch('/vendors/:vendorId/pickup-location/deactivate', deactivateAdminVendorPickupLocation);
router.patch('/vendors/:vendorId/pickup-location/archive', archiveAdminVendorPickupLocation);
router.patch('/vendors/:vendorId/pickup-location/reactivate', reactivateAdminVendorPickupLocation);

// Dashboard
router.get('/dashboard', getAdminDashboardMetrics);

// Users / Customers
router.get('/users', listAdminUsers);
router.get('/users/:id', getAdminUser);
router.patch('/users/:id/status', updateAdminUserStatus);

// Inventory
router.get('/inventory', listAdminInventory);

// Payments & Refunds
router.get('/payments', listAdminPayments);
router.get('/refunds', listAdminRefunds);

// Commissions
router.get('/commissions', listAdminCommissions);

// Coupons
router.get('/coupons', listAdminCoupons);
router.post('/coupons', createAdminCoupon);
router.patch('/coupons/:id', updateAdminCouponStatus);

// Reviews
router.get('/reviews', listAdminReviews);
router.patch('/reviews/:id/status', updateAdminReviewStatus);

// Authenticity
router.get('/authenticity', listAdminAuthenticity);
router.patch('/authenticity/:id/verify', verifyAdminAuthenticity);

// Analytics & Audit
router.get('/analytics', getAdminAnalytics);
router.get('/audit-logs', listAdminAuditLogs);

// Settings
router.get('/settings', getAdminSettings);

// Orders & Shipments (existing)
router.get('/orders', listAdminOrders);
router.get('/orders/:id', getAdminOrder);
router.get('/shipments', listAdminShipments);
router.get('/shipments/:id', getAdminShipment);
router.get('/shipments/:id/label', downloadAdminShippingLabel);
router.post('/shipments/:id/retry-pickup', retryAdminPickup);
router.post('/shipments/:id/resync-tracking', resyncAdminTracking);
router.post('/shipments/:id/retry-fulfillment', retryAdminFulfillment);
router.post('/shipments/:id/assign-awb', assignAdminAwb);
router.post('/shipments/:id/generate-label', generateAdminLabel);
router.patch('/shipments/:id/status', updateAdminShipmentStatus);

// Returns (existing)
router.get('/returns', listAdminReturns);
router.get('/returns/:id', getAdminReturn);
router.patch('/returns/:id/approve', approveReturn);
router.patch('/returns/:id/reject', rejectReturn);

// Invoices & Notifications & Support (existing)
router.get('/invoices', listAdminInvoices);
router.get('/invoices/:id', getAdminInvoiceDetail);
router.get('/notifications', listAdminNotifications);
router.get('/support/tickets', listAdminSupportTickets);
router.get('/support/tickets/:ticketId', getAdminSupportTicket);
router.patch('/support/tickets/:ticketId', updateAdminSupportTicket);

export default router;
