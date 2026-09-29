import path from 'path';
import { AppError } from '../utils/app-error.js';
import { vendorApplySchema, vendorUpdateSchema, adminVendorDecisionSchema, bankAccountSchema } from '../validators/vendor.validator.js';
import { vendorService } from '../services/vendor.service.js';
import { VendorBankAccount } from '../models/vendor-bank.model.js';
import { vendorVerificationService, REQUIRED_DOCUMENT_TYPES } from '../services/vendor-verification.service.js';
import { Vendor } from '../models/vendor.model.js';
import { VendorDocument } from '../models/vendor-document.model.js';
import { Product } from '../models/product.model.js';
import { Inventory } from '../models/inventory.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Order } from '../models/order.model.js';
import { notificationService } from '../services/notification.service.js';
import { vendorLedgerService } from '../services/vendor-ledger.service.js';
import { settlementService } from '../services/settlement.service.js';
import { storageService } from '../services/storage.service.js';
import { auditService } from '../services/audit.service.js';

const sanitizeVendor = (vendor) => {
  if (!vendor) return vendor;
  const user = vendor.ownerUserId && typeof vendor.ownerUserId === 'object' ? vendor.ownerUserId : null;
  const ownerUserId = user ? (user._id?.toString() ?? user.id) : (vendor.ownerUserId?.toString() ?? vendor.ownerUserId);
  const sellerName = user?.name || vendor.legalName || vendor.businessName;
  const sellerEmail = user?.email || vendor.email || '';
  const sellerPhone = user?.phone || vendor.phone || '';

  return {
    id: (vendor._id ?? vendor.id)?.toString(),
    _id: (vendor._id ?? vendor.id)?.toString(),
    ownerUserId,
    user: user ? {
      id: (user._id ?? user.id)?.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    } : null,
    sellerName,
    sellerEmail,
    sellerPhone,
    ownerName: sellerName,
    name: vendor.businessName,
    businessName: vendor.businessName,
    legalName: vendor.legalName,
    businessType: vendor.businessType,
    description: vendor.description,
    email: sellerEmail,
    phone: sellerPhone,
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
  };
};

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

export const getVendorDashboard = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null }).lean();
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor profile not found');
    }

    const productQuery = { vendorId: vendor._id, deletedAt: null };
    const productCountPromise = Product.countDocuments(productQuery);
    const publishedCountPromise = Product.countDocuments({ ...productQuery, status: 'PUBLISHED' });
    const lowStockItemPromise = Inventory.find({ productId: { $in: await Product.distinct('_id', productQuery) }, deletedAt: null, status: 'LOW_STOCK' }).populate({ path: 'productId', select: 'name' }).sort({ updatedAt: -1 }).limit(5).lean();
    const lowStockCountPromise = Inventory.countDocuments({ productId: { $in: await Product.distinct('_id', productQuery) }, deletedAt: null, status: 'LOW_STOCK' });
    const activeOrderStatuses = ['PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'];
    const activeOrdersPromise = VendorOrder.countDocuments({ vendorId: vendor._id, deletedAt: null, status: { $in: activeOrderStatuses } });
    const recentOrdersPromise = VendorOrder.find({ vendorId: vendor._id, deletedAt: null }).sort({ createdAt: -1, _id: -1 }).limit(5).lean();
    const totalSalesPromise = VendorOrder.aggregate([
      { $match: { vendorId: vendor._id, deletedAt: null } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]);
    const ledgerSummaryPromise = vendorLedgerService.summaryForVendor(vendor._id);
    const balancePromise = settlementService.balanceForVendor(vendor._id);
    const unreadCountPromise = notificationService.getUnreadCount(req.user.sub);

    const [productCount, publishedCount, lowStockItems, lowStockCount, activeOrders, recentOrders, totalSales, ledgerSummary, balance, unreadCount] = await Promise.all([
      productCountPromise,
      publishedCountPromise,
      lowStockItemPromise,
      lowStockCountPromise,
      activeOrdersPromise,
      recentOrdersPromise,
      totalSalesPromise,
      ledgerSummaryPromise,
      balancePromise,
      unreadCountPromise,
    ]);

    const parentOrderIds = [...new Set(recentOrders.map((order) => String(order.parentOrderId)))];
    const parentOrders = parentOrderIds.length ? await Order.find({ _id: { $in: parentOrderIds } }).select('_id status paymentStatus createdAt').lean() : [];
    const parentById = new Map(parentOrders.map((order) => [String(order._id), order]));

    const salesTrend = await VendorOrder.aggregate([
      { $match: { vendorId: vendor._id, deletedAt: null, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', revenue: 1, orders: 1, _id: 0 } },
    ]).then((points) => points.map((point) => ({ ...point, label: new Date(`${point.date}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) })));

    const normalizedRecentOrders = recentOrders.map((order) => ({
      _id: order._id,
      status: order.status,
      total: Number(order.total || 0),
      createdAt: order.createdAt,
      itemCount: Array.isArray(order.items) ? order.items.length : 0,
      itemNames: Array.isArray(order.items) ? order.items.slice(0, 3).map((item) => item.productName).filter(Boolean) : [],
      parent: parentById.get(String(order.parentOrderId)) || null,
    }));

    const normalizedLowStockItems = lowStockItems.map((item) => ({
      _id: item._id,
      productId: item.productId?._id || item.productId,
      productName: item.productId?.name || 'Unknown product',
      availableQuantity: Number(item.availableQuantity || 0),
      lowStockThreshold: Number(item.lowStockThreshold || 0),
    }));

    const grossSales = Number(totalSales[0]?.total || 0);
    const dashboard = {
      vendor: {
        id: vendor._id,
        businessName: vendor.businessName,
        status: vendor.status,
        verificationStatus: vendor.verificationStatus,
      },
      metrics: {
        totalProducts: productCount,
        publishedProducts: publishedCount,
        activeOrders,
        lowStockCount,
        totalSales: grossSales,
        netEarnings: Number(ledgerSummary?.netAmount || 0),
        unreadNotifications: unreadCount,
        settlementLabel: balance.readiness.eligible ? 'Ready for settlement' : 'Review status',
      },
      finance: {
        ledgerNet: Number(balance?.ledgerNet || 0),
        eligibleAmount: Number(balance?.eligibleAmount || 0),
        availableAmount: Number(balance?.availableAmount || 0),
        pendingAmount: Number(balance?.pendingAmount || 0),
        settledAmount: Number(balance?.settledAmount || 0),
        readiness: balance.readiness,
      },
      recentOrders: normalizedRecentOrders,
      lowStockItems: normalizedLowStockItems,
      salesTrend,
    };

    res.status(200).json({
      success: true,
      data: dashboard,
      message: 'Vendor dashboard loaded',
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
    let storageKey = req.body.storageKey;
    const documentType = req.body.documentType;
    const documentNumber = req.body.documentNumber?.trim() || undefined;

    const validTypes = ['GST', 'PAN', 'BUSINESS_REGISTRATION', 'IDENTITY', 'ADDRESS_PROOF', 'BANK_PROOF', 'AUTHENTICITY_PROOF'];
    if (!documentType || !validTypes.includes(documentType)) {
      throw new AppError(400, 'INVALID_DOCUMENT_TYPE', `Document type must be one of: ${validTypes.join(', ')}`);
    }

    if (req.file) {
      const ext = path.extname(req.file.originalname) || (req.file.mimetype === 'application/pdf' ? '.pdf' : '.jpg');
      const safeFilename = `${documentType.toLowerCase()}-${Date.now()}${ext}`;
      storageKey = `vendors/${vendor._id}/documents/${safeFilename}`;
      await storageService.upload({
        key: storageKey,
        body: req.file.buffer,
        contentType: req.file.mimetype,
      });
    }

    if (!storageKey) {
      throw new AppError(400, 'DOCUMENT_FILE_REQUIRED', 'Please select a document file to upload (PDF, PNG, JPG up to 5MB)');
    }

    const document = await vendorService.createDocument(vendor._id, {
      documentType,
      documentNumber,
      storageKey,
    });

    if (vendor.verificationStatus === 'UNVERIFIED') {
      await Vendor.updateOne(
        { _id: vendor._id, verificationStatus: 'UNVERIFIED' },
        { $set: { verificationStatus: 'PENDING' } }
      );
    }

    res.status(201).json({
      success: true,
      data: {
        id: document._id,
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        status: document.status,
        submittedAt: document.submittedAt,
        verifiedAt: document.verifiedAt,
        rejectionReason: document.rejectionReason || null,
      },
      message: 'Document submitted for verification',
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

    const vendors = result.data || [];
    const vendorIds = vendors.map(v => v._id);

    // Batch-fetch bank accounts for all listed vendors in a single query
    const bankAccounts = vendorIds.length
      ? await VendorBankAccount.find({ vendorId: { $in: vendorIds }, isDeleted: false })
          .select('vendorId accountHolderName bankName maskedAccountNumber ifscCode accountType verificationStatus verifiedAt rejectedAt rejectionReason createdAt updatedAt')
          .lean()
      : [];

    const bankByVendorId = new Map(bankAccounts.map(b => [String(b.vendorId), b]));

    const sanitizedItems = vendors.map(v => {
      const sanitized = sanitizeVendor(v);
      const bank = bankByVendorId.get(String(v._id));
      sanitized.bankAccount = bank ? {
        id: bank._id?.toString(),
        accountHolderName: bank.accountHolderName,
        bankName: bank.bankName,
        maskedAccountNumber: bank.maskedAccountNumber,
        ifscCode: bank.ifscCode,
        accountType: bank.accountType,
        verificationStatus: bank.verificationStatus,
        verifiedAt: bank.verifiedAt || null,
        rejectedAt: bank.rejectedAt || null,
        rejectionReason: bank.rejectionReason || null,
        submittedAt: bank.createdAt,
        updatedAt: bank.updatedAt,
      } : null;
      return sanitized;
    });

    res.status(200).json({
      success: true,
      data: {
        ...result,
        items: sanitizedItems,
        data: sanitizedItems,
      },
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
    const bankAccount = await VendorBankAccount.findOne({ vendorId: vendor._id, isDeleted: false })
      .select('accountHolderName bankName branchName ifscCode accountType maskedAccountNumber verificationStatus verifiedAt rejectedAt rejectionReason createdAt updatedAt')
      .lean();

    const sanitized = sanitizeVendor(vendor);
    if (bankAccount) {
      sanitized.bankAccount = {
        id: bankAccount._id?.toString(),
        accountHolderName: bankAccount.accountHolderName,
        bankName: bankAccount.bankName,
        branchName: bankAccount.branchName || null,
        ifscCode: bankAccount.ifscCode,
        accountType: bankAccount.accountType,
        maskedAccountNumber: bankAccount.maskedAccountNumber,
        verificationStatus: bankAccount.verificationStatus,
        verifiedAt: bankAccount.verifiedAt || null,
        rejectedAt: bankAccount.rejectedAt || null,
        rejectionReason: bankAccount.rejectionReason || null,
        submittedAt: bankAccount.createdAt,
        updatedAt: bankAccount.updatedAt,
      };
    } else {
      sanitized.bankAccount = null;
    }

    res.status(200).json({
      success: true,
      data: sanitized,
      message: 'Vendor detail loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminVendorBankAccount = async (req, res, next) => {
  try {
    const vendor = await vendorService.getById(req.params.id);
    const bankAccount = await VendorBankAccount.findOne({ vendorId: vendor._id, isDeleted: false })
      .select('accountHolderName bankName branchName ifscCode accountType maskedAccountNumber verificationStatus verifiedAt rejectedAt rejectionReason createdAt updatedAt')
      .lean();

    res.status(200).json({
      success: true,
      data: bankAccount ? {
        id: bankAccount._id?.toString(),
        accountHolderName: bankAccount.accountHolderName,
        bankName: bankAccount.bankName,
        branchName: bankAccount.branchName || null,
        ifscCode: bankAccount.ifscCode,
        accountType: bankAccount.accountType,
        maskedAccountNumber: bankAccount.maskedAccountNumber,
        verificationStatus: bankAccount.verificationStatus,
        verifiedAt: bankAccount.verifiedAt || null,
        rejectedAt: bankAccount.rejectedAt || null,
        rejectionReason: bankAccount.rejectionReason || null,
        submittedAt: bankAccount.createdAt,
        updatedAt: bankAccount.updatedAt,
      } : null,
      message: bankAccount ? 'Bank account details loaded' : 'No bank account on file',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const verifyBankAccount = async (req, res, next) => {
  try {
    const vendor = await vendorService.getById(req.params.id);
    const bankAccount = await VendorBankAccount.findOne({ vendorId: vendor._id, isDeleted: false });
    if (!bankAccount) {
      throw new AppError(404, 'BANK_ACCOUNT_NOT_FOUND', 'No bank account on file for this vendor');
    }
    bankAccount.verificationStatus = 'VERIFIED';
    bankAccount.verifiedAt = new Date();
    bankAccount.verifiedBy = req.user.sub;
    bankAccount.rejectedAt = null;
    bankAccount.rejectedBy = null;
    bankAccount.rejectionReason = null;
    await bankAccount.save();

    res.status(200).json({
      success: true,
      data: {
        id: bankAccount._id?.toString(),
        verificationStatus: bankAccount.verificationStatus,
        verifiedAt: bankAccount.verifiedAt,
        maskedAccountNumber: bankAccount.maskedAccountNumber,
        accountHolderName: bankAccount.accountHolderName,
        bankName: bankAccount.bankName,
      },
      message: 'Bank account verified',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const rejectBankAccount = async (req, res, next) => {
  try {
    const vendor = await vendorService.getById(req.params.id);
    const bankAccount = await VendorBankAccount.findOne({ vendorId: vendor._id, isDeleted: false });
    if (!bankAccount) {
      throw new AppError(404, 'BANK_ACCOUNT_NOT_FOUND', 'No bank account on file for this vendor');
    }
    const reason = (req.body?.reason || '').trim() || 'Bank details did not pass verification';
    bankAccount.verificationStatus = 'REJECTED';
    bankAccount.rejectedAt = new Date();
    bankAccount.rejectedBy = req.user.sub;
    bankAccount.rejectionReason = reason;
    bankAccount.verifiedAt = null;
    bankAccount.verifiedBy = null;
    await bankAccount.save();

    res.status(200).json({
      success: true,
      data: {
        id: bankAccount._id?.toString(),
        verificationStatus: bankAccount.verificationStatus,
        rejectedAt: bankAccount.rejectedAt,
        rejectionReason: bankAccount.rejectionReason,
        maskedAccountNumber: bankAccount.maskedAccountNumber,
        accountHolderName: bankAccount.accountHolderName,
        bankName: bankAccount.bankName,
      },
      message: 'Bank account rejected',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const approveVendor = async (req, res, next) => {
  try {
    const payload = adminVendorDecisionSchema.parse(req.body ?? {});
    const vendor = await vendorService.transitionStatus(
      req.params.id,
      'APPROVED',
      req.user.sub,
      payload.reason,
      { commissionRate: payload.commissionRate }
    );

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
    const payload = adminVendorDecisionSchema.parse(req.body ?? {});
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
    const payload = adminVendorDecisionSchema.parse(req.body ?? {});
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
    const payload = adminVendorDecisionSchema.parse(req.body ?? {});
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
    const payload = adminVendorDecisionSchema.parse(req.body ?? {});
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
    const enriched = await Promise.all(
      documents.map(async (doc) => {
        let viewUrl = null;
        if (doc.storageKey) {
          try {
            viewUrl = await storageService.getSignedUrl(doc.storageKey, 900);
          } catch {}
        }
        return {
          ...doc,
          id: doc._id,
          viewUrl,
          downloadUrl: viewUrl,
        };
      })
    );
    res.status(200).json({
      success: true,
      data: enriched,
      message: 'Vendor documents loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminVendorDocumentDownload = async (req, res, next) => {
  try {
    const document = await VendorDocument.findOne({
      _id: req.params.documentId,
      vendorId: req.params.id,
      isDeleted: false,
    }).lean();
    if (!document) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Vendor document not found');
    if (!document.storageKey) throw new AppError(404, 'STORAGE_KEY_MISSING', 'Document has no stored file');

    const downloadUrl = await storageService.getSignedUrl(document.storageKey, 900);
    res.status(200).json({
      success: true,
      data: {
        documentId: document._id,
        documentType: document.documentType,
        downloadUrl,
      },
      message: 'Presigned download URL generated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const approveDocument = async (req, res, next) => {
  try {
    const payload = adminVendorDecisionSchema.parse(req.body ?? {});
    const document = await vendorService.updateDocumentStatus(req.params.id, req.params.documentId, { status: 'APPROVED', reason: payload.reason }, req.user.sub);
    await auditService.log({
      event: 'VENDOR_DOCUMENT_APPROVED',
      actorId: req.user.sub,
      vendorId: req.params.id,
      documentId: req.params.documentId,
      reason: payload.reason ?? null,
    }).catch(() => null);

    // Sync vendor verification status if all required documents are approved
    const allDocs = await VendorDocument.find({ vendorId: req.params.id, isDeleted: false }).lean();
    const latestByType = new Map();
    allDocs.forEach((d) => {
      if (!latestByType.has(d.documentType)) latestByType.set(d.documentType, d);
    });
    const allApproved = REQUIRED_DOCUMENT_TYPES.every((type) => latestByType.get(type)?.status === 'APPROVED');
    if (allApproved) {
      await Vendor.updateOne(
        { _id: req.params.id, verificationStatus: { $ne: 'VERIFIED' } },
        { $set: { verificationStatus: 'VERIFIED' } }
      );
    }

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
    const payload = adminVendorDecisionSchema.parse(req.body ?? {});
    const document = await vendorService.updateDocumentStatus(req.params.id, req.params.documentId, { status: 'REJECTED', reason: payload.reason }, req.user.sub);
    await auditService.log({
      event: 'VENDOR_DOCUMENT_REJECTED',
      actorId: req.user.sub,
      vendorId: req.params.id,
      documentId: req.params.documentId,
      reason: payload.reason ?? 'Document rejected',
    }).catch(() => null);

    // If documents are rejected, ensure verificationStatus is not incorrectly marked VERIFIED
    await Vendor.updateOne(
      { _id: req.params.id, verificationStatus: 'VERIFIED' },
      { $set: { verificationStatus: 'PENDING' } }
    );

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

export const getVendorAnalytics = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null }).lean();
    if (!vendor) {
      throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor profile not found');
    }

    const range = ['7d', '30d', '90d', '1y'].includes(req.query.range) ? req.query.range : '30d';
    const now = new Date();
    const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
    const startDate = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);

    const orders = await VendorOrder.find({
      vendorId: vendor._id,
      deletedAt: null,
      createdAt: { $gte: startDate },
    }).lean();

    let totalRevenue = 0;
    let unitsSold = 0;
    const customerSet = new Set();
    const statusMap = new Map();
    const productMap = new Map();
    const dateMap = new Map();

    const cursorDate = new Date(startDate);
    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    while (cursorDate <= endDate) {
      const dateKey = cursorDate.toISOString().slice(0, 10);
      const label = cursorDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      dateMap.set(dateKey, { date: dateKey, label, revenue: 0, orders: 0, units: 0 });
      cursorDate.setDate(cursorDate.getDate() + 1);
    }

    for (const order of orders) {
      const orderTotal = Number(order.total || 0);
      totalRevenue += orderTotal;
      if (order.customerId) customerSet.add(String(order.customerId));

      const st = order.status || 'UNKNOWN';
      const curStatus = statusMap.get(st) || { status: st, count: 0, revenue: 0 };
      curStatus.count += 1;
      curStatus.revenue = Number((curStatus.revenue + orderTotal).toFixed(2));
      statusMap.set(st, curStatus);

      const orderDateKey = new Date(order.createdAt).toISOString().slice(0, 10);
      if (dateMap.has(orderDateKey)) {
        const point = dateMap.get(orderDateKey);
        point.revenue = Number((point.revenue + orderTotal).toFixed(2));
        point.orders += 1;
      }

      for (const item of order.items || []) {
        const qty = Number(item.quantity || 0);
        unitsSold += qty;
        if (dateMap.has(orderDateKey)) {
          dateMap.get(orderDateKey).units += qty;
        }
        const prodKey = String(item.variantId || item.sku || item.productName);
        const prod = productMap.get(prodKey) || {
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          sku: item.sku,
          unitsSold: 0,
          revenue: 0,
        };
        prod.unitsSold += qty;
        prod.revenue = Number((prod.revenue + Number(item.lineTotal || item.unitPrice * qty || 0)).toFixed(2));
        productMap.set(prodKey, prod);
      }
    }

    const salesTrend = Array.from(dateMap.values());
    const statusBreakdown = Array.from(statusMap.values()).sort((a, b) => b.count - a.count);
    const topProducts = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    const orderCount = orders.length;
    const averageOrderValue = orderCount > 0 ? Number((totalRevenue / orderCount).toFixed(2)) : 0;

    res.status(200).json({
      success: true,
      data: {
        range,
        summary: {
          revenue: Number(totalRevenue.toFixed(2)),
          orders: orderCount,
          unitsSold,
          averageOrderValue,
          customerCount: customerSet.size,
        },
        salesTrend,
        statusBreakdown,
        topProducts,
      },
      message: 'Vendor analytics loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};
