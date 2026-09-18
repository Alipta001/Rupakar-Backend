import { AppError } from '../utils/app-error.js';
import { User } from '../models/user.model.js';
import { Vendor } from '../models/vendor.model.js';
import { VendorDocument } from '../models/vendor-document.model.js';

const VALID_TRANSITIONS = {
  PENDING: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'PENDING'],
  APPROVED: ['SUSPENDED', 'BLOCKED'],
  REJECTED: ['PENDING'],
  SUSPENDED: ['APPROVED', 'BLOCKED'],
  BLOCKED: ['APPROVED'],
};

export class VendorService {
  async getByOwnerUserId(ownerUserId) {
    return Vendor.findOne({ ownerUserId, deletedAt: null }).lean();
  }

  async createApplication({ ownerUserId, payload }) {
    const existing = await this.getByOwnerUserId(ownerUserId);
    if (existing) {
      throw new AppError(409, 'VENDOR_ALREADY_APPLIED', 'Vendor application already exists');
    }

    const user = await User.findById(ownerUserId);
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const vendor = await Vendor.create({
      ownerUserId,
      businessName: payload.businessName,
      legalName: payload.legalName ?? payload.businessName,
      businessType: payload.businessType ?? 'INDIVIDUAL',
      description: payload.description,
      email: payload.email ?? user.email,
      phone: payload.phone ?? user.phone,
      website: payload.website,
      address: payload.address,
      originState: payload.originState,
      originDistrict: payload.originDistrict,
      gstNumber: payload.gstNumber,
      panNumber: payload.panNumber,
      status: 'PENDING',
      verificationStatus: 'UNVERIFIED',
    });

    return vendor.toObject();
  }

  async updateMyVendor(ownerUserId, payload) {
    const vendor = await Vendor.findOne({ ownerUserId, deletedAt: null });
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor record not found');
    }
    Object.assign(vendor, payload);
    await vendor.save();
    return vendor.toObject();
  }

  async getVendorForOwner(ownerUserId) {
    const vendor = await Vendor.findOne({ ownerUserId, deletedAt: null }).lean();
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor record not found');
    }
    return vendor;
  }

  async transitionStatus(vendorId, nextStatus, actorUserId, reason = '') {
    const vendor = await Vendor.findById(vendorId);
    if (!vendor || vendor.deletedAt) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
    }
    const currentStatus = vendor.status;
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(400, 'INVALID_VENDOR_STATUS_TRANSITION', `Cannot transition from ${currentStatus} to ${nextStatus}`);
    }
    vendor.status = nextStatus;
    if (nextStatus === 'APPROVED') {
      vendor.approvedAt = new Date();
      vendor.approvedBy = actorUserId;
      vendor.verificationStatus = 'VERIFIED';
    }
    if (nextStatus === 'REJECTED') {
      vendor.rejectedAt = new Date();
      vendor.rejectedBy = actorUserId;
      vendor.rejectionReason = reason || 'No reason provided';
    }
    if (nextStatus === 'SUSPENDED' || nextStatus === 'BLOCKED') {
      vendor.rejectionReason = reason || '';
    }
    await vendor.save();
    return vendor.toObject();
  }

  async listForAdmin({ page = 1, limit = 20, status, search } = {}) {
    const query = { deletedAt: null };
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { businessName: { $regex: search, $options: 'i' } },
        { legalName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    const data = await Vendor.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean();
    const total = await Vendor.countDocuments(query);
    return { data, page, limit, total };
  }

  async getById(vendorId) {
    const vendor = await Vendor.findOne({ _id: vendorId, deletedAt: null }).lean();
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
    }
    return vendor;
  }

  async createDocument(vendorId, payload) {
    const vendor = await Vendor.findById(vendorId);
    if (!vendor || vendor.deletedAt) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
    }

    return VendorDocument.create({
      vendorId,
      ...payload,
      status: 'PENDING',
      submittedAt: new Date(),
    });
  }

  async listDocuments(vendorId) {
    const vendor = await Vendor.findById(vendorId);
    if (!vendor || vendor.deletedAt) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
    }

    return VendorDocument.find({ vendorId, isDeleted: false }).sort({ submittedAt: -1, _id: -1 }).limit(100).lean();
  }

  async updateDocumentStatus(vendorId, documentId, decision, actorUserId) {
    const document = await VendorDocument.findOne({ _id: documentId, vendorId, isDeleted: false });
    if (!document) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }

    document.status = decision.status;
    document.verifiedAt = new Date();
    document.verifiedBy = actorUserId;
    document.rejectionReason = decision.reason ?? null;
    await document.save();

    return document.toObject();
  }
}

export const vendorService = new VendorService();
