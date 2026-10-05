import mongoose from 'mongoose';
import { AppError } from '../utils/app-error.js';
import { User } from '../models/user.model.js';
import { Vendor } from '../models/vendor.model.js';
import { VendorDocument } from '../models/vendor-document.model.js';
import { notificationService } from './notification.service.js';

export const VENDOR_VALID_TRANSITIONS = {
  PENDING: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'PENDING'],
  APPROVED: ['SUSPENDED', 'BLOCKED'],
  REJECTED: ['PENDING', 'UNDER_REVIEW'],
  SUSPENDED: ['APPROVED', 'BLOCKED'],
  BLOCKED: ['APPROVED'],
};

const VALID_TRANSITIONS = VENDOR_VALID_TRANSITIONS;

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

    try {
      await notificationService.notifyAdmins({
        type: 'ADMIN_VENDOR_REGISTERED',
        title: 'New Vendor Registration',
        message: `New vendor "${vendor.businessName}" has submitted an application for review.`,
        metadata: { vendorId: vendor._id.toString(), businessName: vendor.businessName },
      });
      await notificationService.createNotification({
        userId: ownerUserId,
        type: 'VENDOR_APPLICATION_SUBMITTED',
        title: 'Application Submitted',
        message: `Your vendor application for "${vendor.businessName}" has been submitted for review.`,
        metadata: { vendorId: vendor._id.toString(), businessName: vendor.businessName },
      });
    } catch {
      // Non-blocking notification dispatch
    }

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

  async getPickupAddress(ownerUserId) {
    const vendor = await Vendor.findOne({ ownerUserId, deletedAt: null }).lean();
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor record not found');
    }
    return (vendor.pickupAddress && vendor.pickupAddress.pincode) ? vendor.pickupAddress : null;
  }

  async updatePickupAddress(ownerUserId, payload) {
    const vendor = await Vendor.findOne({ ownerUserId, deletedAt: null });
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor record not found');
    }
    vendor.pickupAddress = {
      pickupLocationName: payload.pickupLocationName,
      contactPerson: payload.contactPerson,
      phone: payload.phone,
      addressLine1: payload.addressLine1,
      addressLine2: payload.addressLine2 || '',
      city: payload.city,
      state: payload.state,
      pincode: payload.pincode,
      country: payload.country || 'India',
    };
    await vendor.save();
    return vendor.toObject();
  }

  async transitionStatus(vendorId, nextStatus, actorUserId, reason = '', options = {}) {
    const opts = typeof reason === 'object' && reason !== null ? reason : options;
    const reasonText = typeof reason === 'string' ? reason : (opts.reason || '');
    const commissionRate = opts.commissionRate;

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
    if (typeof commissionRate === 'number') {
      vendor.commissionRate = commissionRate;
    }
    if (nextStatus === 'APPROVED') {
      vendor.approvedAt = new Date();
      vendor.approvedBy = actorUserId;
      vendor.verificationStatus = 'VERIFIED';
      if (vendor.ownerUserId) {
        await User.updateOne({ _id: vendor.ownerUserId }, { $set: { role: 'vendor' } });
      }
    }
    if (nextStatus === 'REJECTED') {
      vendor.rejectedAt = new Date();
      vendor.rejectedBy = actorUserId;
      vendor.rejectionReason = reasonText || 'No reason provided';
    }
    if (nextStatus === 'SUSPENDED' || nextStatus === 'BLOCKED') {
      vendor.rejectionReason = reasonText || '';
    }
    await vendor.save();

    try {
      if (nextStatus === 'APPROVED') {
        if (vendor.ownerUserId) {
          await notificationService.createNotification({
            userId: vendor.ownerUserId,
            type: 'VENDOR_APPROVED',
            title: 'Vendor Account Approved',
            message: `Congratulations! Your vendor account for "${vendor.businessName}" has been approved.`,
            metadata: { vendorId: vendor._id.toString(), businessName: vendor.businessName },
          });
        }
        await notificationService.notifyAdmins({
          type: 'ADMIN_VENDOR_APPROVED',
          title: 'Vendor Account Approved',
          message: `Vendor "${vendor.businessName}" has been approved.`,
          metadata: { vendorId: vendor._id.toString(), businessName: vendor.businessName },
        });
      } else if (nextStatus === 'REJECTED') {
        if (vendor.ownerUserId) {
          await notificationService.createNotification({
            userId: vendor.ownerUserId,
            type: 'VENDOR_REJECTED',
            title: 'Vendor Application Decision',
            message: `Your vendor application for "${vendor.businessName}" was not approved. Reason: ${vendor.rejectionReason}`,
            metadata: { vendorId: vendor._id.toString(), businessName: vendor.businessName, reason: vendor.rejectionReason },
          });
        }
        await notificationService.notifyAdmins({
          type: 'ADMIN_VENDOR_REJECTED',
          title: 'Vendor Application Rejected',
          message: `Vendor "${vendor.businessName}" was rejected. Reason: ${vendor.rejectionReason}`,
          metadata: { vendorId: vendor._id.toString(), businessName: vendor.businessName, reason: vendor.rejectionReason },
        });
      } else if (nextStatus === 'SUSPENDED' || nextStatus === 'BLOCKED') {
        if (vendor.ownerUserId) {
          await notificationService.createNotification({
            userId: vendor.ownerUserId,
            type: 'VENDOR_SUSPENDED',
            title: 'Vendor Account Suspended',
            message: `Your vendor account for "${vendor.businessName}" has been suspended. Reason: ${vendor.rejectionReason || 'Policy violation'}`,
            metadata: { vendorId: vendor._id.toString(), businessName: vendor.businessName, reason: vendor.rejectionReason },
          });
        }
        await notificationService.notifyAdmins({
          type: 'ADMIN_VENDOR_SUSPENDED',
          title: 'Vendor Account Suspended',
          message: `Vendor "${vendor.businessName}" has been suspended. Reason: ${vendor.rejectionReason || 'Policy violation'}`,
          metadata: { vendorId: vendor._id.toString(), businessName: vendor.businessName, reason: vendor.rejectionReason },
        });
      }
    } catch {
      // Non-blocking notification dispatch
    }

    return this.getById(vendor._id);
  }

  async listForAdmin({ page = 1, limit = 20, status, search } = {}) {
    const query = { deletedAt: null };
    if (status && status !== 'ALL') {
      query.status = String(status).toUpperCase();
    }
    if (search) {
      query.$or = [
        { businessName: { $regex: search, $options: 'i' } },
        { legalName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    const data = await Vendor.find(query)
      .populate('ownerUserId', 'name email phone firstName lastName role')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const total = await Vendor.countDocuments(query);
    return { data, page, limit, total };
  }

  async getById(vendorId) {
    const vendor = await Vendor.findOne({ _id: vendorId, deletedAt: null })
      .populate('ownerUserId', 'name email phone firstName lastName role')
      .lean();
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
    }
    return vendor;
  }

  async createDocument(vendorId, payload) {
    const query = mongoose.isValidObjectId(vendorId)
      ? { $or: [{ _id: vendorId }, { ownerUserId: vendorId }] }
      : { _id: null };
    const vendor = await Vendor.findOne({ ...query, deletedAt: null });
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
    }

    const doc = await VendorDocument.create({
      vendorId: vendor._id,
      ...payload,
      status: 'PENDING',
      submittedAt: new Date(),
    });

    await Vendor.updateOne({ _id: vendor._id }, { $addToSet: { documents: doc._id } }).catch(() => null);

    try {
      if (vendor.ownerUserId) {
        await notificationService.createNotification({
          userId: vendor.ownerUserId,
          type: 'VENDOR_DOCUMENT_SUBMITTED',
          title: 'Verification Document Submitted',
          message: `Your ${doc.documentType} document has been submitted for verification.`,
          metadata: { vendorId: vendor._id.toString(), documentId: doc._id.toString(), documentType: doc.documentType },
        });
      }
      await notificationService.notifyAdmins({
        type: 'ADMIN_VENDOR_DOCUMENT_SUBMITTED',
        title: 'Vendor Document Submitted',
        message: `Vendor "${vendor.businessName}" submitted a ${doc.documentType} document for review.`,
        metadata: { vendorId: vendor._id.toString(), documentId: doc._id.toString(), documentType: doc.documentType },
      });
    } catch {
      // Non-blocking notification dispatch
    }

    return doc;
  }

  async listDocuments(vendorId) {
    const query = mongoose.isValidObjectId(vendorId)
      ? { $or: [{ _id: vendorId }, { ownerUserId: vendorId }] }
      : { _id: null };
    const vendor = await Vendor.findOne({ ...query, deletedAt: null });
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
    }

    return VendorDocument.find({ vendorId: vendor._id, isDeleted: { $ne: true } })
      .sort({ submittedAt: -1, _id: -1 })
      .limit(100)
      .lean();
  }

  async updateDocumentStatus(vendorId, documentId, decision, actorUserId) {
    const query = mongoose.isValidObjectId(vendorId)
      ? { $or: [{ _id: vendorId }, { ownerUserId: vendorId }] }
      : { _id: null };
    const vendor = await Vendor.findOne({ ...query, deletedAt: null });
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor not found');
    }

    const document = await VendorDocument.findOne({ _id: documentId, vendorId: vendor._id, isDeleted: false });
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
