# BizExecData

A comprehensive business data management platform that integrates with multiple accounting software providers including QuickBooks, Xero, Sage, and Excel. The application provides centralized financial data analysis, reporting, and visualization capabilities.

## 🚀 Features

- **Multi-Platform Integration**: Connect with QuickBooks, Xero, Sage, and Excel data sources
- **Financial Analytics**: Revenue, expenses, and cost of sales analysis
- **User Management**: Role-based access control with authentication
- **Data Visualization**: Charts and graphs powered by Chart.js and D3.js
- **Secure Authentication**: Passport.js with local authentication strategy
- **RESTful API**: Well-structured API endpoints for data operations
- **Modern Stack**: Node.js, Express, Prisma ORM with PostgreSQL

## 🛠️ Tech Stack

### Backend
- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Passport.js with bcrypt
- **Security**: Helmet, express-rate-limit
- **Logging**: Pino with structured logging
- **Testing**: Jest with Supertest

### Frontend
- **Templating**: EJS
- **Styling**: Custom CSS
- **Charts**: Chart.js, D3.js
- **File Processing**: Excel file handling with xlsx

### Integrations
- **QuickBooks**: intuit-oauth API
- **Xero**: xero-node SDK
- **Sage**: Custom integration
- **Excel**: File upload and processing

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL 12+
- npm or yarn

## 🚀 Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/Kiveshan/BizExecData.git
   cd BizExecData
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your database and API credentials
   ```

4. **Set up the database**
   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

6. **Access the application**
   Open [http://localhost:3000](http://localhost:3000) in your browser

## 📁 Project Structure

```
BizExecData/
├── src/
│   ├── modules/          # Feature modules (auth, user, admin, etc.)
│   ├── config/           # Configuration files
│   ├── utils/            # Utility functions
│   └── app.js           # Main Express app
├── views/               # EJS templates
│   ├── layouts/         # Page layouts
│   ├── pages/           # Page templates
│   └── partials/        # Reusable components
├── public/              # Static assets
├── prisma/              # Database schema and migrations
└── tests/               # Test files
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/bizexecdata"

# Server
PORT=3000
NODE_ENV=development

# Session
SESSION_SECRET=your-secret-key

# QuickBooks OAuth
QUICKBOOKS_CLIENT_ID=your-qb-client-id
QUICKBOOKS_CLIENT_SECRET=your-qb-client-secret

# Xero OAuth
XERO_CLIENT_ID=your-xero-client-id
XERO_CLIENT_SECRET=your-xero-client-secret
```

### Database Setup

1. Create a PostgreSQL database
2. Run migrations: `npx prisma migrate dev`
3. Generate Prisma client: `npx prisma generate`

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## 📜 Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run test suite
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues

## 🔐 Security Features

- Password hashing with bcrypt
- Rate limiting on API endpoints
- CSRF protection
- Security headers with Helmet
- Input validation and sanitization
- Secure session management

## 📊 API Endpoints

### Authentication
- `POST /login` - User login
- `POST /register` - User registration
- `POST /logout` - User logout

### QuickBooks Integration
- `GET /quickbooks/auth` - Initiate OAuth flow
- `GET /quickbooks/callback` - OAuth callback
- `GET /quickbooks/data` - Fetch financial data

### Xero Integration
- `GET /xero/auth` - Initiate OAuth flow
- `GET /xero/callback` - OAuth callback
- `GET /xero/data` - Fetch financial data

### Data Management
- `GET /revenue` - Get revenue data
- `GET /expenses` - Get expense data
- `GET /company` - Get company information

## 🚀 Deployment

### Production Build

1. Set environment variables for production
2. Build the application:
   ```bash
   npm run build
   ```

3. Run database migrations:
   ```bash
   npx prisma migrate deploy
   ```

4. Start the server:
   ```bash
   npm start
   ```


## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines

- Follow ESLint configuration
- Write tests for new features
- Use semantic commit messages
- Update documentation as needed



## 🆘 Support

For support and questions:

- Create an issue on GitHub
- Check the [documentation](docs/)
- Review existing issues and discussions

## 🔄 Version History

- **v1.0.0** - Initial release with core functionality
- **v1.1.0** - Added Sage integration
- **v1.2.0** - Enhanced security features
- **v1.3.0** - Improved data visualization

## 🙏 Acknowledgments

- [Express.js](https://expressjs.com/) - Web framework
- [Prisma](https://www.prisma.io/) - Database ORM
- [Chart.js](https://www.chartjs.org/) - Data visualization
- [Passport.js](http://www.passportjs.org/) - Authentication middleware

---