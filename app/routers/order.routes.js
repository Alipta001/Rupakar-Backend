import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { createOrder, listOrders, getOrder, cancelOrder } from '../controllers/order.controller.js';
import { listCustomerShipments, getShipmentTracking } from '../controllers/shipping.controller.js';
import { createOrderReturn, listOrderReturns } from '../controllers/return.controller.js';
import { getOrderInvoice } from '../controllers/invoice.controller.js';
import { createOrderCancellationRequest, listOrderCancellationRequests } from '../controllers/cancellation.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', listOrders);
router.post('/', createOrder);
router.get('/:id', getOrder);
router.post('/:id/cancel', cancelOrder);
router.get('/:id/cancellation-requests', listOrderCancellationRequests);
router.post('/:id/cancellation-requests', createOrderCancellationRequest);
router.get('/:id/shipments', listCustomerShipments);
router.get('/:id/returns', listOrderReturns);
router.post('/:id/returns', createOrderReturn);
router.get('/:id/invoice', getOrderInvoice);
router.get('/shipments/:id/tracking', getShipmentTracking);

export default router;
