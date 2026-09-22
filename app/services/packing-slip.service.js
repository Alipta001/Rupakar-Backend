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
}

export const packingSlipService = new PackingSlipService();
