import { bulkProductService } from '../services/bulk-product.service.js';
import { AppError } from '../utils/app-error.js';

export const downloadTemplate = async (req, res, next) => {
  try {
    const format = String(req.query.format ?? 'xlsx').toLowerCase().trim();

    if (format === 'csv') {
      const csvData = await bulkProductService.generateCsvTemplate();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="rupakar-product-upload-template.csv"');
      return res.status(200).send(csvData);
    }

    const xlsxBuffer = await bulkProductService.generateXlsxTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="rupakar-product-upload-template.xlsx"');
    return res.status(200).send(xlsxBuffer);
  } catch (error) {
    next(error);
  }
};

export const validateBatch = async (req, res, next) => {
  try {
    const files = req.files || {};
    const spreadsheetFile = files.spreadsheet?.[0] || files.file?.[0] || (req.file?.fieldname === 'spreadsheet' || req.file?.fieldname === 'file' ? req.file : null);
    const zipFile = files.zip?.[0] || files.images?.[0] || (req.file?.fieldname === 'zip' ? req.file : null);

    if (!spreadsheetFile) {
      throw new AppError(400, 'SPREADSHEET_REQUIRED', 'A CSV or Excel spreadsheet file is required');
    }

    const result = await bulkProductService.validateBatch(req.user.sub, {
      spreadsheetBuffer: spreadsheetFile.buffer,
      spreadsheetFilename: spreadsheetFile.originalname,
      zipBuffer: zipFile ? zipFile.buffer : null,
      zipFilename: zipFile ? zipFile.originalname : '',
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Batch validated successfully',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const submitBatch = async (req, res, next) => {
  try {
    const { batchId, rowNumbers } = req.body ?? {};

    if (!batchId || !String(batchId).trim()) {
      throw new AppError(400, 'BATCH_ID_REQUIRED', 'batchId is required');
    }

    const result = await bulkProductService.submitBatch(req.user.sub, String(batchId).trim(), {
      rowNumbers: Array.isArray(rowNumbers) ? rowNumbers : null,
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Eligible products submitted for admin review',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getBatch = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const batch = await bulkProductService.getBatch(req.user.sub, batchId);

    res.status(200).json({
      success: true,
      data: batch,
      message: 'Batch details loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listBatches = async (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);

    const result = await bulkProductService.listBatches(req.user.sub, { page, limit });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Bulk upload batches loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const downloadErrorReport = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const csvReport = await bulkProductService.generateErrorReport(req.user.sub, batchId);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bulk-upload-${batchId}-errors.csv"`);
    return res.status(200).send(csvReport);
  } catch (error) {
    next(error);
  }
};
