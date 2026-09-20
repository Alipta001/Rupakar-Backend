import { Vendor } from '../models/vendor.model.js';
import { VendorDocument } from '../models/vendor-document.model.js';
import { VendorBankAccount } from '../models/vendor-bank.model.js';
import { AppError } from '../utils/app-error.js';

const requiredDocumentTypes = ['IDENTITY', 'BUSINESS_REGISTRATION', 'PAN', 'GST', 'ADDRESS_PROOF', 'BANK_PROOF'];

const sanitizeDocument = (document) => ({
  id: document._id,
  documentType: document.documentType,
  status: document.status,
  submittedAt: document.submittedAt,
  verifiedAt: document.verifiedAt,
  rejectionReason: document.rejectionReason || null,
});

export class VendorVerificationService {
  async getForOwner(ownerUserId) {
    const vendor = await Vendor.findOne({ ownerUserId, deletedAt: null }).lean();
    if (!vendor) throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor record not found');
    const [documents, bank] = await Promise.all([
      VendorDocument.find({ vendorId: vendor._id, isDeleted: false }).sort({ submittedAt: -1, _id: -1 }).lean(),
      VendorBankAccount.findOne({ vendorId: vendor._id, isDeleted: false }).select('accountHolderName bankName branchName ifscCode accountType maskedAccountNumber createdAt updatedAt').lean(),
    ]);
    const latestByType = new Map();
    documents.forEach((document) => { if (!latestByType.has(document.documentType)) latestByType.set(document.documentType, document); });
    const missingDocumentTypes = requiredDocumentTypes.filter((type) => !latestByType.has(type));
    const rejectedDocuments = documents.filter((document) => document.status === 'REJECTED');
    const requiredActions = [];
    if (missingDocumentTypes.length) requiredActions.push(`Submit: ${missingDocumentTypes.join(', ')}`);
    if (rejectedDocuments.length) requiredActions.push('Review and resubmit rejected documents');
    if (!bank) requiredActions.push('Submit bank account details');
    if (vendor.status === 'REJECTED') requiredActions.push('Review the vendor rejection reason and update your application');
    return {
      vendor: {
        id: vendor._id,
        businessName: vendor.businessName,
        status: vendor.status,
        verificationStatus: vendor.verificationStatus,
        rejectionReason: vendor.rejectionReason || null,
        approvedAt: vendor.approvedAt,
        rejectedAt: vendor.rejectedAt,
      },
      documents: documents.map(sanitizeDocument),
      bankAccount: bank ? {
        id: bank._id,
        accountHolderName: bank.accountHolderName,
        bankName: bank.bankName,
        branchName: bank.branchName,
        ifscCode: bank.ifscCode,
        accountType: bank.accountType,
        maskedAccountNumber: bank.maskedAccountNumber,
        createdAt: bank.createdAt,
        updatedAt: bank.updatedAt,
      } : null,
      readiness: {
        vendorApproved: vendor.status === 'APPROVED',
        documentsComplete: missingDocumentTypes.length === 0,
        documentsVerified: requiredDocumentTypes.every((type) => latestByType.get(type)?.status === 'APPROVED'),
        bankSubmitted: Boolean(bank),
        providerKycVerified: false,
        payoutProviderReady: false,
      },
      missingDocumentTypes,
      requiredActions,
    };
  }
}

export const vendorVerificationService = new VendorVerificationService();
 