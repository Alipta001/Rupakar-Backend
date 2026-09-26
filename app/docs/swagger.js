/**
 * Centralized Swagger / OpenAPI 3.0 configuration for Rupakar Marketplace API.
 * This file is completely decoupled from runtime business logic and routes.
 */

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Rupakar Marketplace API',
    version: '1.0.0',
    description: `
**Rupakar** is an authentic Indian artisan and handcrafted e-commerce marketplace platform.

### Authentication & Authorization
- **Bearer Authentication**: Protected endpoints require a valid JWT Access Token passed in the \`Authorization\` header as \`Bearer <access_token>\`.
- **RBAC (Role-Based Access Control)**:
  - **Public**: Endpoints accessible without authentication (e.g., product catalog, categories, search, review listing, health checks).
  - **Customer**: Authenticated users browsing, ordering, and managing account settings.
  - **Vendor (Seller)**: Authenticated artisans/sellers managing products, inventory, orders, shipments, and finances.
  - **Admin**: Platform administrators with access to moderation, KYC verification, payout management, and commission config.
- **Guest Session**: Anonymous users can use \`x-guest-session-id\` header to maintain carts across sessions before login. Upon login, guest carts are merged automatically.
    `,
    contact: {
      name: 'Rupakar Support',
      email: 'rupakarsupport@gmail.com',
    },
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API v1 Base Endpoint',
    },
  ],
  tags: [
    { name: 'Auth', description: 'User registration, OTP verification, login, token refresh, and Google OAuth' },
    { name: 'Users', description: 'Customer profile, address book, and credential management' },
    { name: 'Products', description: 'Public product catalog, relevance-based search, and vendor product management' },
    { name: 'Categories', description: 'Product categories and taxonomic hierarchy' },
    { name: 'Brands', description: 'Craft brands and artisan collectives' },
    { name: 'Vendors', description: 'Artisan seller onboarding, verification, profile, dashboard, and analytics' },
    { name: 'Cart', description: 'Shopping cart operations supporting authenticated users and guest sessions' },
    { name: 'Wishlist', description: 'Customer saved items and wishlist management' },
    { name: 'Checkout', description: 'Checkout calculations, tax/shipping previews, and order initiation' },
    { name: 'Orders', description: 'Order lifecycle, customer orders, vendor order processing, and tracking' },
    { name: 'Payments', description: 'Payment configuration, verification, webhooks, and mock payment simulation' },
    { name: 'Shipping', description: 'Shipment tracking, courier integrations, and delivery webhooks' },
    { name: 'Returns', description: 'Order returns, replacements, and cancellation workflows' },
    { name: 'Invoices', description: 'Tax invoices and packing slip PDF generation and downloads' },
    { name: 'Reviews', description: 'Artisan product ratings and customer feedback' },
    { name: 'Notifications', description: 'In-app user and administrative alerts' },
    { name: 'Inventory', description: 'Vendor SKU stock levels, reservations, and inventory adjustments' },
    { name: 'Finance', description: 'Vendor ledger, escrow balances, settlements, and payout management' },
    { name: 'Support', description: 'Customer support ticketing and resolution messaging' },
    { name: 'Admin', description: 'Administrative platform management, product approvals, and vendor KYC' },
    { name: 'Health', description: 'System liveness, readiness, and connectivity health probes' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Provide your JWT access token as `Bearer <token>` in the Authorization header.',
      },
      GuestSession: {
        type: 'apiKey',
        in: 'header',
        name: 'x-guest-session-id',
        description: 'Unique client-generated guest session UUID for anonymous carts and wishlists.',
      },
    },
    schemas: {
      StandardResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation completed successfully' },
          requestId: { type: 'string', example: 'req_123456789' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Invalid input data' },
              details: { type: 'object' },
            },
          },
          requestId: { type: 'string', example: 'req_123456789' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d1' },
          name: { type: 'string', example: 'Alipta Ghosh' },
          email: { type: 'string', example: 'user@example.com' },
          role: { type: 'string', enum: ['customer', 'vendor', 'admin'], example: 'customer' },
          isVerified: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Address: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'addr_123' },
          fullName: { type: 'string', example: 'Priya Sharma' },
          phone: { type: 'string', example: '+919876543210' },
          addressLine1: { type: 'string', example: '123 Artisan Lane' },
          addressLine2: { type: 'string', example: 'Near Craft Village' },
          city: { type: 'string', example: 'Kolkata' },
          state: { type: 'string', example: 'West Bengal' },
          postalCode: { type: 'string', example: '700001' },
          country: { type: 'string', example: 'India' },
          isDefaultShipping: { type: 'boolean', example: true },
          isDefaultBilling: { type: 'boolean', example: true },
        },
      },
      ProductVariant: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'var_001' },
          sku: { type: 'string', example: 'RPK-DEC-TER-01' },
          price: { type: 'number', example: 1299 },
          compareAtPrice: { type: 'number', nullable: true, example: 1599 },
          attributes: { type: 'object', example: { size: 'Medium', color: 'Terracotta Red' } },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d2' },
          name: { type: 'string', example: 'Terracotta Wall Hanging' },
          slug: { type: 'string', example: 'terracotta-wall-hanging' },
          shortDescription: { type: 'string', example: 'Handcrafted terracotta wall art for home decor.' },
          description: { type: 'string', example: 'Exquisite clay wall hanging crafted by master artisans.' },
          price: { type: 'number', example: 1299 },
          compareAtPrice: { type: 'number', nullable: true, example: 1599 },
          category: { type: 'string', example: 'Home Decor' },
          craft: { type: 'string', example: 'Terracotta Craft' },
          artisan: { type: 'string', example: 'Rupakar Artisan' },
          rating: { type: 'number', example: 4.9 },
          reviews: { type: 'number', example: 128 },
          image: { type: 'string', example: '/images/product-vase.jpg' },
          images: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' }, example: ['terracotta', 'wall-art', 'decor'] },
          status: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED'], example: 'PUBLISHED' },
        },
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d3' },
          name: { type: 'string', example: 'Home Decor' },
          slug: { type: 'string', example: 'home-decor' },
          description: { type: 'string', example: 'Artisan handcrafted decor for living spaces' },
          image: { type: 'string', example: '/images/category-decor.jpg' },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' },
        },
      },
      CartItem: {
        type: 'object',
        properties: {
          variantId: { type: 'string', example: 'var_001' },
          productId: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d2' },
          quantity: { type: 'integer', example: 2 },
          price: { type: 'number', example: 1299 },
          title: { type: 'string', example: 'Terracotta Wall Hanging' },
        },
      },
      Cart: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/CartItem' } },
          subtotal: { type: 'number', example: 2598 },
          shipping: { type: 'number', example: 0 },
          total: { type: 'number', example: 2598 },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d4' },
          orderNumber: { type: 'string', example: 'RPK-2026-10492' },
          status: { type: 'string', enum: ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'], example: 'PAID' },
          totalAmount: { type: 'number', example: 2598 },
          currency: { type: 'string', example: 'INR' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    // ----------------------------------------------------
    // HEALTH ENDPOINTS
    // ----------------------------------------------------
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Check API service health',
        description: 'Returns basic service timestamp and health status.',
        responses: {
          200: {
            description: 'Service is healthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StandardResponse' } } },
          },
        },
      },
    },
    '/health/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        description: 'Kubernetes/container liveness probe confirming process is alive.',
        responses: { 200: { description: 'Application is live' } },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe',
        description: 'Checks connectivity to MongoDB, Redis, and background worker subsystem.',
        responses: {
          200: { description: 'All database and caching systems are ready' },
          503: { description: 'One or more subsystems are not ready' },
        },
      },
    },

    // ----------------------------------------------------
    // AUTH ENDPOINTS
    // ----------------------------------------------------
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register customer account',
        description: 'Registers a new customer and sends an email verification code.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'Ananya Sen' },
                  email: { type: 'string', format: 'email', example: 'ananya@example.com' },
                  password: { type: 'string', minLength: 8, example: 'SecurePassword123!' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'User registered. Verification OTP sent.' },
          400: { description: 'Validation error or email already in use.' },
        },
      },
    },
    '/auth/register-seller': {
      post: {
        tags: ['Auth'],
        summary: 'Register artisan / seller account',
        description: 'Registers a new artisan/vendor with store details and sends email verification code.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password', 'storeName'],
                properties: {
                  name: { type: 'string', example: 'Bikram Das' },
                  email: { type: 'string', format: 'email', example: 'bikram@bengalcrafts.com' },
                  password: { type: 'string', minLength: 8, example: 'ArtisanSecret123!' },
                  storeName: { type: 'string', example: 'Bengal Terracotta Creations' },
                  mobile: { type: 'string', example: '+919876543210' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Seller registered successfully.' },
          400: { description: 'Invalid input or email already registered.' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'User login with email and password',
        description: 'Authenticates customer or seller, sets HTTP-only refresh cookie, and returns access token.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'user@example.com' },
                  password: { type: 'string', example: 'SecurePassword123!' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful. Returns user profile and accessToken.' },
          401: { description: 'Invalid credentials or unverified email.' },
        },
      },
    },
    '/auth/verify-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Verify email with OTP',
        description: 'Validates 6-digit email verification code for newly registered accounts.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'otp'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'user@example.com' },
                  otp: { type: 'string', example: '123456' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Email verified successfully.' },
          400: { description: 'Invalid or expired OTP.' },
        },
      },
    },
    '/auth/resend-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Resend email verification code',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email', example: 'user@example.com' } },
              },
            },
          },
        },
        responses: { 200: { description: 'OTP resent successfully.' } },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request password reset code',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email', example: 'user@example.com' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Password reset code dispatched to email.' } },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Reset password with OTP',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'otp', 'newPassword'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'user@example.com' },
                  otp: { type: 'string', example: '123456' },
                  newPassword: { type: 'string', minLength: 8, example: 'NewStrongPassword123!' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Password updated successfully.' } },
      },
    },
    '/auth/google': {
      post: {
        tags: ['Auth'],
        summary: 'Google OAuth one-tap / token sign-in',
        description: 'Exchanges Google ID token for Rupakar JWT credentials and merges guest carts.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  credential: { type: 'string', description: 'Google ID token' },
                  guestSessionId: { type: 'string', description: 'Optional guest session ID' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Google login successful.' } },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        description: 'Rotates the refresh token stored in HTTP-only cookie and issues a new access token.',
        responses: {
          200: { description: 'Token refreshed successfully.' },
          401: { description: 'Refresh token invalid or expired.' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Log out user',
        description: 'Revokes the active refresh token and clears auth cookies.',
        responses: { 200: { description: 'Logged out successfully.' } },
      },
    },

    // ----------------------------------------------------
    // USER ACCOUNT ENDPOINTS
    // ----------------------------------------------------
    '/users/me': {
      get: {
        tags: ['Users'],
        summary: 'Get current user profile',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'User profile loaded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          401: { description: 'Unauthorized' },
        },
      },
      patch: {
        tags: ['Users'],
        summary: 'Update current user profile',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Alipta Ghosh' },
                  phone: { type: 'string', example: '+919876543210' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Profile updated.' } },
      },
    },
    '/users/change-password': {
      post: {
        tags: ['Users'],
        summary: 'Change account password',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string', example: 'OldPassword123!' },
                  newPassword: { type: 'string', minLength: 8, example: 'NewPassword123!' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Password changed successfully.' } },
      },
    },
    '/users/addresses': {
      get: {
        tags: ['Users'],
        summary: 'List user saved addresses',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'List of addresses.' } },
      },
      post: {
        tags: ['Users'],
        summary: 'Add shipping/billing address',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Address' } } },
        },
        responses: { 201: { description: 'Address created.' } },
      },
    },
    '/users/addresses/{addressId}': {
      patch: {
        tags: ['Users'],
        summary: 'Update saved address',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'addressId', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Address' } } } },
        responses: { 200: { description: 'Address updated.' } },
      },
      delete: {
        tags: ['Users'],
        summary: 'Delete saved address',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'addressId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Address deleted.' } },
      },
    },

    // ----------------------------------------------------
    // PRODUCTS & CATALOG ENDPOINTS
    // ----------------------------------------------------
    '/products': {
      get: {
        tags: ['Products'],
        summary: 'Public product catalog and relevance search',
        description: `
Browse and search artisan products.
Supports intelligent relevance ranking, domain synonyms (e.g. wall decor -> wall hanging, clay -> terracotta), multi-field searching, category/price filters, and cursor pagination.
        `,
        parameters: [
          { in: 'query', name: 'q', schema: { type: 'string' }, description: 'Search keywords (e.g. "wall decor", "terracotta", "dokra")' },
          { in: 'query', name: 'category', schema: { type: 'string' }, description: 'Category slug or 24-character ObjectId' },
          { in: 'query', name: 'brand', schema: { type: 'string' }, description: 'Brand slug or ObjectId' },
          { in: 'query', name: 'vendor', schema: { type: 'string' }, description: 'Vendor ObjectId' },
          { in: 'query', name: 'minPrice', schema: { type: 'number' }, description: 'Minimum price filter' },
          { in: 'query', name: 'maxPrice', schema: { type: 'number' }, description: 'Maximum price filter' },
          { in: 'query', name: 'sort', schema: { type: 'string', enum: ['relevance', 'newest', 'oldest', 'price_asc', 'price_desc', 'name_asc', 'name_desc'] }, description: 'Sort criteria' },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 }, description: 'Page limit (1 to 50)' },
          { in: 'query', name: 'cursor', schema: { type: 'string' }, description: 'Cursor ID for next page' },
        ],
        responses: {
          200: {
            description: 'Paginated product list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
                        total: { type: 'integer', example: 42 },
                        pagination: {
                          type: 'object',
                          properties: {
                            hasNextPage: { type: 'boolean', example: true },
                            nextCursor: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d2' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/products/{slug}': {
      get: {
        tags: ['Products'],
        summary: 'Get public product details by slug or ID',
        parameters: [{ in: 'path', name: 'slug', required: true, schema: { type: 'string' }, description: 'Product slug or MongoDB ObjectId' }],
        responses: {
          200: { description: 'Product details loaded successfully.' },
          404: { description: 'Product not found.' },
        },
      },
    },
    '/vendor/products': {
      get: {
        tags: ['Products'],
        summary: 'List products owned by active seller',
        security: [{ BearerAuth: [] }],
        description: 'Requires authenticated Vendor account.',
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED'] } },
          { in: 'query', name: 'search', schema: { type: 'string' } },
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'Vendor product list.' }, 401: { description: 'Unauthorized' } },
      },
      post: {
        tags: ['Products'],
        summary: 'Create new product draft (Vendor)',
        security: [{ BearerAuth: [] }],
        description: 'Requires approved Vendor account.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'variants'],
                properties: {
                  name: { type: 'string', example: 'Terracotta Tea Kulhad Set' },
                  shortDescription: { type: 'string', example: 'Set of 6 handmade earthen cups.' },
                  description: { type: 'string', example: 'Crafted with organic riverbed clay.' },
                  categoryId: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  variants: { type: 'array', items: { $ref: '#/components/schemas/ProductVariant' } },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Product draft created.' } },
      },
    },
    '/vendor/products/{id}/submit': {
      post: {
        tags: ['Products'],
        summary: 'Submit product for review (Vendor)',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Product submitted for administrative review.' } },
      },
    },

    // ----------------------------------------------------
    // CATEGORIES & BRANDS
    // ----------------------------------------------------
    '/categories': {
      get: {
        tags: ['Categories'],
        summary: 'List active product categories',
        responses: {
          200: {
            description: 'List of active categories',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Category' } } } },
          },
        },
      },
    },
    '/categories/{slug}': {
      get: {
        tags: ['Categories'],
        summary: 'Get category by slug',
        parameters: [{ in: 'path', name: 'slug', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Category details loaded.' }, 404: { description: 'Category not found.' } },
      },
    },
    '/brands': {
      get: {
        tags: ['Brands'],
        summary: 'List artisan brands & collectives',
        responses: { 200: { description: 'List of brands.' } },
      },
    },

    // ----------------------------------------------------
    // VENDOR ONBOARDING & DASHBOARD
    // ----------------------------------------------------
    '/vendors/apply': {
      post: {
        tags: ['Vendors'],
        summary: 'Apply for seller partnership',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['storeName', 'businessType'],
                properties: {
                  storeName: { type: 'string', example: 'Mithila Folk Studios' },
                  businessType: { type: 'string', enum: ['INDIVIDUAL', 'COOPERATIVE', 'COMPANY'], example: 'COOPERATIVE' },
                  originState: { type: 'string', example: 'Bihar' },
                  craftSpecialization: { type: 'string', example: 'Madhubani Painting' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Vendor onboarding application submitted.' } },
      },
    },
    '/vendors/me': {
      get: {
        tags: ['Vendors'],
        summary: 'Get current vendor profile & verification status',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Vendor details loaded.' } },
      },
    },
    '/vendor/dashboard': {
      get: {
        tags: ['Vendors'],
        summary: 'Get vendor operational dashboard stats',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Dashboard stats (orders, revenues, low stock).' } },
      },
    },
    '/vendor/analytics': {
      get: {
        tags: ['Vendors'],
        summary: 'Get vendor sales analytics and trend data',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Sales analytics data.' } },
      },
    },

    // ----------------------------------------------------
    // CART & WISHLIST
    // ----------------------------------------------------
    '/cart': {
      get: {
        tags: ['Cart'],
        summary: 'Get current cart contents',
        security: [{ BearerAuth: [] }, { GuestSession: [] }],
        description: 'Supports both logged-in users and anonymous sessions via `x-guest-session-id`.',
        responses: {
          200: { description: 'Current cart loaded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Cart' } } } },
        },
      },
      delete: {
        tags: ['Cart'],
        summary: 'Clear all items from cart',
        security: [{ BearerAuth: [] }, { GuestSession: [] }],
        responses: { 200: { description: 'Cart cleared.' } },
      },
    },
    '/cart/items': {
      post: {
        tags: ['Cart'],
        summary: 'Add item to shopping cart',
        security: [{ BearerAuth: [] }, { GuestSession: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['productId', 'variantId', 'quantity'],
                properties: {
                  productId: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d2' },
                  variantId: { type: 'string', example: 'var_001' },
                  quantity: { type: 'integer', minimum: 1, example: 1 },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Item added to cart.' }, 400: { description: 'Insufficient stock or invalid variant.' } },
      },
    },
    '/cart/items/{variantId}': {
      patch: {
        tags: ['Cart'],
        summary: 'Update cart item quantity',
        security: [{ BearerAuth: [] }, { GuestSession: [] }],
        parameters: [{ in: 'path', name: 'variantId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['quantity'],
                properties: { quantity: { type: 'integer', minimum: 1, example: 3 } },
              },
            },
          },
        },
        responses: { 200: { description: 'Cart updated.' } },
      },
      delete: {
        tags: ['Cart'],
        summary: 'Remove item from cart',
        security: [{ BearerAuth: [] }, { GuestSession: [] }],
        parameters: [{ in: 'path', name: 'variantId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Item removed from cart.' } },
      },
    },
    '/wishlist': {
      get: {
        tags: ['Wishlist'],
        summary: 'List user saved wishlist items',
        security: [{ BearerAuth: [] }, { GuestSession: [] }],
        responses: { 200: { description: 'Wishlist items loaded.' } },
      },
    },
    '/wishlist/{productId}': {
      post: {
        tags: ['Wishlist'],
        summary: 'Add product to wishlist',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'productId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Product saved to wishlist.' } },
      },
      delete: {
        tags: ['Wishlist'],
        summary: 'Remove product from wishlist',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'productId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Product removed from wishlist.' } },
      },
    },

    // ----------------------------------------------------
    // CHECKOUT & ORDERS
    // ----------------------------------------------------
    '/checkout/preview': {
      post: {
        tags: ['Checkout'],
        summary: 'Preview order breakdown before payment',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['shippingAddressId'],
                properties: { shippingAddressId: { type: 'string' }, couponCode: { type: 'string' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Checkout calculation with taxes, discounts, and shipping.' } },
      },
    },
    '/orders': {
      get: {
        tags: ['Orders'],
        summary: 'List customer orders',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'List of customer orders.',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } } } },
          },
        },
      },
      post: {
        tags: ['Orders'],
        summary: 'Create order from checkout',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['shippingAddressId', 'billingAddressId', 'paymentMethod'],
                properties: {
                  shippingAddressId: { type: 'string' },
                  billingAddressId: { type: 'string' },
                  paymentMethod: { type: 'string', enum: ['RAZORPAY', 'MOCK', 'COD'], example: 'MOCK' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Order created.' } },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Get order details by ID',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Order details loaded.' }, 404: { description: 'Order not found.' } },
      },
    },
    '/orders/{id}/cancel': {
      post: {
        tags: ['Orders'],
        summary: 'Cancel customer order',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Order cancelled and refund queued.' } },
      },
    },

    // ----------------------------------------------------
    // PAYMENTS
    // ----------------------------------------------------
    '/payments/config': {
      get: {
        tags: ['Payments'],
        summary: 'Get payment gateway client configuration',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Returns public Razorpay Key ID and supported methods.' } },
      },
    },
    '/payments/confirm': {
      post: {
        tags: ['Payments'],
        summary: 'Confirm payment receipt',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['orderId', 'paymentId'],
                properties: {
                  orderId: { type: 'string' },
                  paymentId: { type: 'string' },
                  signature: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Payment confirmed and order marked as paid.' } },
      },
    },
    '/payments/mock/simulate': {
      post: {
        tags: ['Payments'],
        summary: 'Simulate mock payment (Testing & Evaluation)',
        security: [{ BearerAuth: [] }],
        description: 'Simulates instantaneous payment capture for sandbox testing.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['orderId'],
                properties: { orderId: { type: 'string' }, shouldSucceed: { type: 'boolean', default: true } },
              },
            },
          },
        },
        responses: { 200: { description: 'Mock payment processed.' } },
      },
    },

    // ----------------------------------------------------
    // SHIPPING & TRACKING
    // ----------------------------------------------------
    '/shipments/{id}/tracking': {
      get: {
        tags: ['Shipping'],
        summary: 'Get live shipment tracking updates',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Tracking history and current delivery status.' } },
      },
    },

    // ----------------------------------------------------
    // REVIEWS & FEEDBACK
    // ----------------------------------------------------
    '/reviews/product/{productId}': {
      get: {
        tags: ['Reviews'],
        summary: 'List verified product reviews',
        parameters: [{ in: 'path', name: 'productId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Product reviews loaded.' } },
      },
    },
    '/reviews': {
      post: {
        tags: ['Reviews'],
        summary: 'Post product review (Verified Customer)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['productId', 'rating', 'title', 'comment'],
                properties: {
                  productId: { type: 'string' },
                  rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
                  title: { type: 'string', example: 'Authentic and stunning craftsmanship' },
                  comment: { type: 'string', example: 'The terracotta wall hanging exceeded my expectations.' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Review posted.' } },
      },
    },

    // ----------------------------------------------------
    // INVOICES
    // ----------------------------------------------------
    '/invoices': {
      get: {
        tags: ['Invoices'],
        summary: 'List customer order invoices',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Invoice list.' } },
      },
    },
    '/invoices/order/{orderId}/download': {
      get: {
        tags: ['Invoices'],
        summary: 'Download order invoice PDF',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'orderId', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'PDF binary stream.', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
        },
      },
    },

    // ----------------------------------------------------
    // NOTIFICATIONS
    // ----------------------------------------------------
    '/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'List user in-app notifications',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Notifications loaded.' } },
      },
    },
    '/notifications/unread-count': {
      get: {
        tags: ['Notifications'],
        summary: 'Get unread notification count',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Unread count returned.' } },
      },
    },
    '/notifications/{id}/read': {
      patch: {
        tags: ['Notifications'],
        summary: 'Mark single notification as read',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Notification marked as read.' } },
      },
    },

    // ----------------------------------------------------
    // INVENTORY & FINANCE (VENDOR)
    // ----------------------------------------------------
    '/vendor/inventory': {
      get: {
        tags: ['Inventory'],
        summary: 'List seller inventory status across SKUs',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Inventory stock list.' } },
      },
    },
    '/vendor/inventory/{variantId}': {
      patch: {
        tags: ['Inventory'],
        summary: 'Adjust available inventory stock for variant',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'variantId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['quantity'],
                properties: { quantity: { type: 'integer', example: 50 } },
              },
            },
          },
        },
        responses: { 200: { description: 'Stock adjusted.' } },
      },
    },
    '/vendor/finance/ledger': {
      get: {
        tags: ['Finance'],
        summary: 'Get vendor financial ledger entries',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Ledger debits, credits, and escrow transactions.' } },
      },
    },
    '/vendor/finance/balance': {
      get: {
        tags: ['Finance'],
        summary: 'Get vendor available and escrow balance',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Balance breakdown.' } },
      },
    },

    // ----------------------------------------------------
    // SUPPORT & CONTACT
    // ----------------------------------------------------
    '/support/tickets': {
      get: {
        tags: ['Support'],
        summary: 'List user support tickets',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Support ticket history.' } },
      },
      post: {
        tags: ['Support'],
        summary: 'Open a new customer support ticket',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['subject', 'message', 'category'],
                properties: {
                  subject: { type: 'string', example: 'Inquiry regarding shipping to Assam' },
                  message: { type: 'string', example: 'How many days will delivery take for fragile terracotta items?' },
                  category: { type: 'string', enum: ['ORDER', 'SHIPPING', 'RETURN', 'PRODUCT', 'GENERAL'], example: 'SHIPPING' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Support ticket opened.' } },
      },
    },
    '/contact': {
      post: {
        tags: ['Support'],
        summary: 'Public contact form submission',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'message'],
                properties: {
                  name: { type: 'string', example: 'Pooja Roy' },
                  email: { type: 'string', format: 'email', example: 'pooja@example.com' },
                  subject: { type: 'string', example: 'Artisan Workshop Collaboration' },
                  message: { type: 'string', example: 'We would love to feature your Dokra artisans.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Contact inquiry delivered.' } },
      },
    },

    // ----------------------------------------------------
    // ADMIN MANAGEMENT
    // ----------------------------------------------------
    '/admin/dashboard': {
      get: {
        tags: ['Admin'],
        summary: 'Platform administration summary dashboard',
        security: [{ BearerAuth: [] }],
        description: 'Requires active Admin role.',
        responses: { 200: { description: 'Admin platform metrics loaded.' }, 403: { description: 'Forbidden. Admin privileges required.' } },
      },
    },
    '/admin/products': {
      get: {
        tags: ['Admin'],
        summary: 'List all platform products pending review or published',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Product list for admin moderation.' } },
      },
    },
    '/admin/products/{id}/approve': {
      post: {
        tags: ['Admin'],
        summary: 'Approve vendor submitted product',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Product approved for marketplace publishing.' } },
      },
    },
    '/admin/products/{id}/reject': {
      post: {
        tags: ['Admin'],
        summary: 'Reject product with reason',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Product rejected.' } },
      },
    },
    '/vendors/admin': {
      get: {
        tags: ['Admin'],
        summary: 'List all registered vendors for KYC moderation',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Vendor accounts loaded.' } },
      },
    },
    '/vendors/admin/{id}/approve': {
      patch: {
        tags: ['Admin'],
        summary: 'Approve vendor partner and grant seller privileges',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Vendor approved.' } },
      },
    },
  },
};
