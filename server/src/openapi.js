module.exports = {
  openapi: '3.0.3',
  info: { title: 'LastPlate API', version: '1.0.0', description: 'Marketplace API for food listings, accounts and reservations.' },
  servers: [{ url: 'http://localhost:5000' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', properties: { message: { type: 'string' } } },
      Reservation: { type: 'object', properties: { reference: { type: 'string' }, quantity: { type: 'integer' }, total: { type: 'number' }, status: { type: 'string', enum: ['reserved', 'collected', 'cancelled'] } } }
    }
  },
  paths: {
    '/api/health': { get: { summary: 'API and database health', responses: { 200: { description: 'Health status' } } } },
    '/api/auth/register': { post: { summary: 'Register a customer or provider', responses: { 201: { description: 'Account created' }, 400: { description: 'Invalid registration' } } } },
    '/api/auth/login': { post: { summary: 'Sign in', responses: { 200: { description: 'JWT and profile' }, 401: { description: 'Invalid credentials' } } } },
    '/api/auth/forgot-password': { post: { summary: 'Request a password reset link', responses: { 200: { description: 'Reset instructions sent when an active account matches' }, 503: { description: 'Reset delivery is not configured' } } } },
    '/api/auth/reset-password': { post: { summary: 'Set a new password using a single-use reset token', responses: { 200: { description: 'Password reset' }, 400: { description: 'Invalid or expired token, or password does not meet requirements' } } } },
    '/api/auth/me': { get: { summary: 'Read own profile', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Profile' } } }, patch: { summary: 'Update own profile', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Updated profile' } } } },
    '/api/foods': { get: { summary: 'Search and filter active listings', parameters: [{ in: 'query', name: 'q', schema: { type: 'string' } }, { in: 'query', name: 'category', schema: { type: 'string' } }, { in: 'query', name: 'sort', schema: { type: 'string', enum: ['newest', 'price', 'discount'] } }, { in: 'query', name: 'page', schema: { type: 'integer' } }], responses: { 200: { description: 'Paginated listings' } } }, post: { summary: 'Create a listing (provider)', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Listing created' }, 403: { description: 'Provider role required' } } } },
    '/api/foods/{id}': { get: { summary: 'Read listing details', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Food listing' }, 404: { description: 'Listing not found' } } }, patch: { summary: 'Edit own listing (provider)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Updated listing' }, 403: { description: 'Owner role required' } } } },
    '/api/reservations': { post: { summary: 'Reserve available portions', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Reservation created' }, 409: { description: 'Unavailable stock' } } } },
    '/api/reservations/mine': { get: { summary: 'List own reservations', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Reservations' } } } },
    '/api/reservations/{id}/collect': { patch: { summary: 'Verify pickup (own provider reservation)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Pickup recorded' }, 404: { description: 'Reservation not found' } } } },
    '/api/favorites': { get: { summary: 'List saved food listings', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Saved listings' } } } },
    '/api/admin/overview': { get: { summary: 'Admin metrics and recent audit actions', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Platform overview' }, 403: { description: 'Admin role required' } } } },
    '/api/admin/providers': { get: { summary: 'List food partners', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Providers' } } } },
    '/api/admin/providers/{id}/approval': { patch: { summary: 'Approve or revoke provider approval', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Approval saved' } } } },
    '/api/admin/users': { get: { summary: 'List accounts', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Accounts' } } } },
    '/api/admin/users/{id}/status': { patch: { summary: 'Suspend or reactivate an account', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Account status saved' } } } },
    '/api/admin/listings': { get: { summary: 'List marketplace listings for moderation', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Listings' } } } },
    '/api/admin/listings/{id}/status': { patch: { summary: 'Pause or reactivate a listing', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Listing status saved' } } } },
    '/api/admin/reservations': { get: { summary: 'View platform reservations', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Reservations' } } } },
    '/api/admin/audit': { get: { summary: 'List recent administrative actions', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Audit history' } } } }
  }
};
