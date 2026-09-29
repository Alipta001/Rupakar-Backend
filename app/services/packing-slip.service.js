import { PackingSlip } from '../models/packing-slip.model.js';

export class PackingSlipService {
  async createOrGet({ orderId, vendorOrderId, vendorId, customerId }) {
    const sourceKey = `packing-slip:${vendorOrderId}`;
    try {
      const slip = await PackingSlip.create({
        packingSlipNumber: `PS-${new Date().getFullYear()}-${String(vendorOrderId).slice(-8).toUpperCase()}`,
        sourceKey, orderId, vendorOrderId, vendorId, customerId,
      });
      return slip.toObject();
    } catch (error) {
      if (error?.code === 11000) return PackingSlip.findOne({ sourceKey }).lean();
      throw error;
    }
  }

  async setGenerationStatus(id, generationStatus, fields = {}) {
    return PackingSlip.findByIdAndUpdate(id, { $set: { generationStatus, ...fields } }, { new: true }).lean();
  }

  async ensurePackingSlip({ orderId, vendorOrderId, vendorId, customerId }) {
    let slip = await this.createOrGet({ orderId, vendorOrderId, vendorId, customerId });
    if (slip && (slip.generationStatus !== 'AVAILABLE' || !slip.storageKey)) {
      const { Order } = await import('../models/order.model.js');
      const { VendorOrder } = await import('../models/vendor-order.model.js');
      const { Vendor } = await import('../models/vendor.model.js');
      const { Shipment } = await import('../models/shipment.model.js');
      const { pdfService } = await import('./pdf.service.js');
      const { storageService } = await import('./storage.service.js');

      const [order, vendorOrder, vendor, shipment] = await Promise.all([
        Order.findById(orderId).lean(),
        VendorOrder.findById(vendorOrderId).lean(),
        Vendor.findById(vendorId).select('businessName legalName email address gstNumber phone').lean(),
        Shipment.findOne({ vendorOrderId }).lean(),
      ]);

      if (order && vendorOrder) {
        await this.setGenerationStatus(slip._id, 'GENERATING', { errorReason: null });
        const pdf = await pdfService.generatePackingSlipPdf({
          packingSlipNumber: slip.packingSlipNumber,
          order,
          vendorOrder,
          vendor,
          shipment,
        });
        await this.setGenerationStatus(slip._id, 'UPLOADING', { generatedAt: new Date() });
        const storageKey = `packing-slips/${String(orderId)}/${slip.packingSlipNumber}.pdf`;
        await storageService.upload({ key: storageKey, body: pdf.content, contentType: pdf.contentType });
        slip = await this.setGenerationStatus(slip._id, 'AVAILABLE', {
          storageProvider: 's3',
          storageKey,
          fileType: pdf.contentType,
          uploadedAt: new Date(),
          errorReason: null,
        });
      }
    }
    return slip;
  }
}

export const packingSlipService = new PackingSlipService();
