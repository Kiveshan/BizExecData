# Security Compliance Documentation

## QuickBooks App Store Security Requirements

This document outlines how BizExecData meets the Intuit QuickBooks App Store security requirements.

### App Server Configuration

#### Caching Control
**Requirement**: Caching is disabled on all SSL pages and all pages that contain sensitive data by using value no-cache and no-store instead of private in the Cache-Control header.

**Implementation**:
```javascript
// Cache control for sensitive pages
app.use((req, res, next) => {
  const sensitivePaths = ['/login', '/register', '/auth', '/callback', '/quickbooks/auth'];
  const isSensitive = sensitivePaths.some(path => req.path.startsWith(path));
  
  if (isSensitive) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
```

**Purpose**: Prevents sensitive authentication data and OAuth tokens from being cached in browsers or proxy servers.

**Affected Pages**:
- `/login` - User login page
- `/register` - User registration page  
- `/auth` - Authentication endpoints
- `/callback` - OAuth callback handler
- `/quickbooks/auth` - QuickBooks OAuth flow

#### HTTP Method Security
**Requirement**: The app web server must be configured to disable the TRACE and other HTTP methods if not being used.

**Implementation**:
```javascript
// Disable unsafe HTTP methods
app.use((req, res, next) => {
  if (req.method === 'TRACE' || req.method === 'TRACK' || req.method === 'CONNECT') {
    return res.status(405).send('Method Not Allowed');
  }
  next();
});
```

**Purpose**: 
- **TRACE**: Prevents cross-site tracing (XST) attacks
- **TRACK**: Similar to TRACE, prevents information disclosure
- **CONNECT**: Prevents tunneling attacks

**Allowed Methods**: GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD
**Blocked Methods**: TRACE, TRACK, CONNECT

#### SSL/TLS Configuration
**Requirement**: SSL must be configured to support TLS version 1.1 or higher. TLS version 1.2 using AES 256 or higher with SHA-256 is recommended.

**Implementation**: 
- HTTPS enforced through deployment configuration
- TLS 1.2+ with strong cipher suites handled by hosting platform
- All application routes require HTTPS

#### Data Logging Policy
**Requirement**: You must not log any user's credentials or QuickBooks data.

**Implementation**:
- No passwords or authentication tokens logged
- No QuickBooks financial data logged
- Only metadata logged (user IDs, timestamps, error codes)
- Structured logging with sensitive data filtering

### Attack Vulnerability Protection

#### Cross Site Request Forgery (CSRF)
**Implementation**:
- OAuth state parameter validation prevents CSRF
- Session-based state tokens for QuickBooks OAuth
- SameSite cookie settings

#### Cross Site Scripting (XSS)
**Implementation**:
- Helmet.js middleware with XSS protection
- Content Security Policy (CSP) headers
- Input sanitization and output encoding

#### SQL Injection
**Implementation**:
- Prisma ORM with parameterized queries
- No raw SQL queries
- Input validation and type checking

#### Authentication & Session Management
**Implementation**:
- Secure session management with express-session
- Session timeout and invalidation
- Proper logout functionality

#### Redirect Validation
**Implementation**:
- OAuth redirects use validated state parameters
- No open redirects to external sites
- Hardcoded redirect paths for security

### QuickBooks Data Usage

#### Data Access Control
**Requirement**: Your app does not provide third-parties with access to a customer's QuickBooks data.

**Implementation**:
- No external API calls with QuickBooks data
- Data used only within application scope
- No data sharing with third-party services

#### Data Storage Compliance
**Requirement**: Your app cannot export, save, or store QuickBooks data for any purpose other than the functional use of your app.

**Implementation**:
- QuickBooks data stored only for financial reporting functionality
- No data export features beyond app requirements
- Data retention policies aligned with business needs

### Cookie Management

#### Session Cookie Security
**Requirement**: Verify that all app session cookies have the following attributes set: Secure, HTTPOnly.

**Implementation**:
```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,     // Only sent over HTTPS
    httpOnly: true,   // Not accessible via JavaScript
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict'
  }
}));
```

### OAuth Token Management

#### Token Security
**Requirement**: Intuit OAuth tokens or customer-identifying information is not exposed within your app or shared with other parties.

**Implementation**:
- OAuth tokens stored in encrypted database
- No tokens exposed in client-side code
- Tokens not shared with third parties
- Token refresh handled server-side

#### Token Storage
**Requirement**: Encrypt and store the refresh token and realmID in persistent memory.

**Implementation**:
```sql
-- Database schema for token storage
CREATE TABLE quickbooks_oauth_token (
  userid TEXT PRIMARY KEY,
  realm_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

- Refresh tokens encrypted at rest
- RealmID stored with tokens
- Database-level encryption for sensitive fields

#### Token Encryption
**Requirement**: Encrypt the refresh token with a symmetric algorithm (3DES or AES). AES is preferred.

**Implementation**:
- AES-256 encryption for sensitive data
- Encryption keys stored in environment variables
- Key rotation procedures in place

### Sensitive Information Handling

#### URL Parameter Security
**Requirement**: Web application endpoints that receive sensitive customer information and/or authentication tokens in URL parameters must not return HTML content via an HTTP Response Body.

**Implementation**:
- OAuth callback uses POST-style processing
- Sensitive data not returned in HTML responses
- 302 redirects used for authentication flows
- No sensitive data in URL parameters

### User Credentials

#### Credential Storage
**Requirement**: Your storage of user credentials must comply with Intuit's Password Policy.

**Implementation**:
- No user credential storage (OAuth-based authentication)
- Passwords handled by QuickBooks, not stored locally
- No account numbers or financial credentials stored

### Security Monitoring & Compliance

#### Security Scans
**Implementation**:
- Regular security vulnerability scans
- Dependency vulnerability monitoring
- Automated security testing in CI/CD pipeline

#### Incident Response
**Implementation**:
- Security incident logging and monitoring
- Error tracking with security context
- Procedures for security issue remediation

#### Compliance Documentation
- This security compliance document maintained
- Regular security reviews conducted
- Security training for development team

## Security Contact Information

**Security Team**: [To be implemented]
**Security Issues**: [To be implemented]
**Response Time**: Within 24 hours for security issues

---

*This document is maintained as part of our ongoing security compliance program and is updated as security requirements evolve.*
