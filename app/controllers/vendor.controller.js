import { AppError } from '../utils/app-error.js';
import { vendorApplySchema, vendorUpdateSchema, adminVendorDecisionSchema, bankAccountSchema } from '../validators/vendor.validator.js';
import { vendorService } from '../services/vendor.service.js';
import { VendorBankAccount } from '../models/vendor-bank.model.js';
import { vendorVerificationService } from '../services/vendor-verification.service.js';

const sanitizeVendor = (vendor) => ({
  id: vendor._id,
  ownerUserId: vendor.ownerUserId,
  businessName: vendor.businessName,
  legalName: vendor.legalName,
  businessType: vendor.businessType,
  description: vendor.description,
  email: vendor.email,
  phone: vendor.phone,
  website: vendor.website,
  address: vendor.address,
  originState: vendor.originState,
  originDistrict: vendor.originDistrict,
  gstNumber: vendor.gstNumber,
  panNumber: vendor.panNumber,
  status: vendor.status,
  verificationStatus: vendor.verificationStatus,
  approvedAt: vendor.approvedAt,
  rejectedAt: vendor.rejectedAt,
  rejectionReason: vendor.rejectionReason,
  createdAt: vendor.createdAt,
  updatedAt: vendor.updatedAt,
});

export const applyVendor = async (req, res, next) => {
  try {
    const payload = vendorApplySchema.parse(req.body);
    const vendor = await vendorService.createApplication({
      ownerUserId: req.user.sub,
      payload,
    });

    res.status(201).json({
      success: true,
      data: sanitizeVendor(vendor),
      message: 'Vendor application submitted',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getMyVendor = async (req, res, next) => {
  try {
    const vendor = await vendorService.getVendorForOwner(req.user.sub);
    res.status(200).json({
      success: true,
      data: sanitizeVendor(vendor),
      message: 'Vendor profile loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const updateMyVendor = async (req, res, next) => {
  try {
    const payload = vendorUpdateSchema.parse(req.body);
    const vendor = await vendorService.updateMyVendor(req.user.sub, payload);

    res.status(200).json({
      success: true,
      data: sanitizeVendor(vendor),
      message: 'Vendor profile updated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getMyVendorStatus = async (req, res, next) => {
  try {
    const vendor = await vendorService.getVendorForOwner(req.user.sub);
    res.status(200).json({
      success: true,
      data: {
        status: vendor.status,
        verificationStatus: vendor.verificationStatus,
      },
      message: 'Vendor status loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getMyVendorVerification = async (req, res, next) => {
  try {
    const verification = await vendorVerificationService.getForOwner(req.user.sub);
    res.status(200).json({
      success: true,
      data: verification,
      message: 'Vendor verification loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const addDocument = async (req, res, next) => {
  try {
    const vendor = await vendorService.getVendorForOwner(req.user.sub);
    const document = await vendorService.createDocument(vendor._id, {
      documentType: req.body.documentType,
      documentNumber: req.body.documentNumber,
      storageKey: req.body.storageKey,
    });

    res.status(201).json({
      success: true,
      data: {
        id: document._id,
        documentType: document.documentType,
        status: document.status,
        submittedAt: document.submittedAt,
        verifiedAt: document.verifiedAt,
        rejectionReason: document.rejectionReason || null,
      },
      message: 'Document submitted',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const addBankAccount = async (req, res, next) => {
  try {
    const payload = bankAccountSchema.parse(req.body);
    const vendor = await vendorService.getVendorForOwner(req.user.sub);

    const bank = await VendorBankAccount.findOneAndUpdate(
      { vendorId: vendor._id },
      {
        vendorId: vendor._id,
        accountHolderName: payload.accountHolderName,
        accountNumber: payload.accountNumber,
        bankName: payload.bankName,
        branchName: payload.branchName,
        ifscCode: payload.ifscCode,
        accountType: payload.accountType ?? 'SAVINGS',
        maskedAccountNumber: `****${String(payload.accountNumber).slice(-4)}`,
      },
      { new: true, upsert: true, runValidators: true },
    );

    res.status(201).json({
      success: true,
      data: {
        id: bank._id,
        accountHolderName: bank.accountHolderName,
        bankName: bank.bankName,
        maskedAccountNumber: bank.maskedAccountNumber,
        ifscCode: bank.ifscCode,
        accountType: bank.accountType,
      },
      message: 'Bank account saved',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listAdminVendors = async (req, res, next) => {
  try {
    const result = await vendorService.listForAdmin({
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
      status: req.query.status,
      search: req.query.search,
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Vendor list loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminVendor = async (req, res, next) => {
  try {
    const vendor = await vendorService.getById(req.params.id);
    res.status(200).json({
      success: true,
      data: sanitizeVendor(vendor),
      message: 'Vendor detail loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const approveVendor = async (req, res, next) => {
  try {
    const payload = adminVendorDecisionSchema.parse(req.body);
    const vendor = await vendorService.transitionStatus(req.params.id, 'APPROVED', req.user.sub, payload.reason);

    res.status(200).json({
      success: true,
      data: sanitizeVendor(vendor),
      message: 'Vendor approved',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const rejectVendor = async (req, res, next) => {
  try {
    const payload = adminVendorDecisionSchema.parse(req.body);
    const vendor = await vendorService.transitionStatus(req.params.id, 'REJECTED', req.user.sub, payload.reason);

    res.status(200).json({
      success: true,
      data: sanitizeVendor(vendor),
      message: 'Vendor rejected',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const suspendVendor = async (req, res, next) => {
  try {
    const payload = adminVendorDecisionSchema.parse(req.body);
    const vendor = await vendorService.transitionStatus(req.params.id, 'SUSPENDED', req.user.sub, payload.reason);

    res.status(200).json({
      success: true,
      data: sanitizeVendor(vendor),
      message: 'Vendor suspended',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const blockVendor = async (req, res, next) => {
  try {
    const payload = adminVendorDecisionSchema.parse(req.body);
    const vendor = await vendorService.transitionStatus(req.params.id, 'BLOCKED', req.user.sub, payload.reason);

    res.status(200).json({
      success: true,
      data: sanitizeVendor(vendor),
      message: 'Vendor blocked',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const restoreVendor = async (req, res, next) => {
  try {
    const payload = adminVendorDecisionSchema.parse(req.body);
    const vendor = await vendorService.transitionStatus(req.params.id, 'APPROVED', req.user.sub, payload.reason);
    res.status(200).json({
      success: true,
      data: sanitizeVendor(vendor),
      message: 'Vendor restored',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listVendorDocuments = async (req, res, next) => {
  try {
    const documents = await vendorService.listDocuments(req.params.id);
    res.status(200).json({
      success: true,
      data: documents,
      message: 'Vendor documents loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const approveDocument = async (req, res, next) => {
  try {
    const payload = adminVendorDecisionSchema.parse(req.body);
    const document = await vendorService.updateDocumentStatus(req.params.id, req.params.documentId, { status: 'APPROVED', reason: payload.reason }, req.user.sub);
    res.status(200).json({
      success: true,
      data: document,
      message: 'Document approved',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const rejectDocument = async (req, res, next) => {
  try {
    const payload = adminVendorDecisionSchema.parse(req.body);
    const document = await vendorService.updateDocumentStatus(req.params.id, req.params.documentId, { status: 'REJECTED', reason: payload.reason }, req.user.sub);
    res.status(200).json({
      success: true,
      data: document,
      message: 'Document rejected',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};
