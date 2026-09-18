import { expect, it } from '@jest/globals';
import { listInvoicesQuerySchema } from '../app/validators/invoice.validators.js';
import { listNotificationsQuerySchema } from '../app/validators/notification.validators.js';
import { returnListQuerySchema } from '../app/validators/return.validators.js';
import { paginationSchema } from '../app/validators/shipping.validators.js';
import { publicProductQuerySchema } from '../app/validators/product.validator.js';

it('enforces the maximum page size on paginated query schemas', () => {
  expect(() => listInvoicesQuerySchema.parse({ limit: 101 })).toThrow();
  expect(() => listNotificationsQuerySchema.parse({ limit: 101 })).toThrow();
  expect(() => returnListQuerySchema.parse({ limit: 101 })).toThrow();
  expect(() => paginationSchema.parse({ limit: 101 })).toThrow();
  expect(() => publicProductQuerySchema.parse({ limit: 51 })).toThrow();
});
