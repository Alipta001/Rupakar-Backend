export class AuditService {
  log(event, payload = {}) {
    const safe = {
      event,
      timestamp: new Date().toISOString(),
      ...payload,
    };

    if (process.env.NODE_ENV !== 'production') {
      console.info('[AUDIT]', JSON.stringify(safe));
    }

    return safe;
  }
}

export const auditService = new AuditService();
