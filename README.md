# EduControl NG - Nigerian School Management System

A comprehensive web-based school management system designed specifically for Nigerian primary, junior, and senior secondary schools.

## Features

### Core Functionality
- **Multi-role Authentication**: Admin, Teacher, Result Officer, and Student portals
- **Student Management**: Registration, profile management, and academic tracking
- **Result Management**: Entry, approval, and publishing system with automated calculations
- **Class & Session Management**: Flexible academic year and term management
- **Student Promotion**: End-of-session promotion workflow
- **School Profile**: Customizable school information and branding

### User Roles & Permissions

#### Admin
- Complete system access
- Student and staff management
- Class and session configuration
- Result approval and publishing
- Student promotion
- School profile management

#### Teacher
- Result entry for assigned classes and subjects
- View and manage entered results
- Access to assigned class lists

#### Result Officer
- Result approval and publishing
- View published results
- Result management oversight

#### Student
- View published results
- Download result PDFs
- Access personal academic history

## Technology Stack

- **Backend**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **Frontend**: EJS templating engine
- **Styling**: Custom CSS with responsive design
- **Authentication**: Express sessions with bcrypt
- **File Upload**: Multer for image handling
- **PDF Generation**: PDFKit for result reports

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- MongoDB Atlas account
- Git

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd educontrol-ng
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Create a `.env` file in the root directory:
   ```env
   # MongoDB Configuration
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/educontrol-ng?retryWrites=true&w=majority
   
   # Session Configuration
   SESSION_SECRET=your-super-secret-session-key-change-in-production
   
   # Server Configuration
   PORT=3000
   
   # Upload Configuration
   UPLOAD_PATH=./public/uploads/
   
   # Default Admin Credentials
   DEFAULT_ADMIN_EMAIL=admin@school.edu.ng
   DEFAULT_ADMIN_PASSWORD=admin123
   ```

4. **Create upload directory**
   ```bash
   mkdir -p public/uploads
   ```

5. **Start the application**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

6. **Access the application**
   Open your browser and navigate to `http://localhost:3000`

## Default Login Credentials

### Admin Access
- **Email**: admin@school.edu.ng
- **Password**: admin123

*Note: Change these credentials immediately after first login*

## Database Models

### User (Staff)
- Personal information and authentication
- Role-based permissions (admin, teacher, officer)
- Subject and class assignments

### Student
- Personal and academic information
- Current class and session tracking
- Academic history and promotion records

### Result
- Assessment scores (CA1, CA2, Exam)
- Automated grade and remark calculation
- Publication status and approval workflow

### Class
- Class structure and sections
- Subject assignments
- Academic level categorization

### Session
- Academic year management
- Term tracking and status
- Session activation controls

### School
- Institution profile and branding
- Contact information and settings
- Customizable content management

## Key Features Explained

### Result Management Workflow
1. **Entry**: Teachers enter CA1, CA2, and Exam scores
2. **Calculation**: System automatically calculates totals, grades, and remarks
3. **Approval**: Result Officers or Admins review and approve results
4. **Publishing**: Approved results become visible to students
5. **Access**: Students can view and download their results

### Grading System
- **A**: 80-100 (Excellent)
- **B**: 70-79 (Very Good)
- **C**: 60-69 (Good)
- **D**: 50-59 (Fair)
- **E**: 40-49 (Poor)
- **F**: 0-39 (Fail)

### Student Promotion
- Available only during Third Term
- Batch promotion with class assignment
- Automatic archiving of previous session records
- Maintains complete academic history

## File Structure

```
educontrol-ng/
├── models/           # Database models
├── routes/           # Express route handlers
├── views/            # EJS templates
│   ├── pages/        # Main page templates
│   └── partials/     # Reusable template components
├── public/           # Static assets
│   ├── css/          # Stylesheets
│   ├── js/           # Client-side JavaScript
│   ├── images/       # Image assets
│   └── uploads/      # User uploaded files
├── middleware/       # Custom middleware
├── app.js           # Main application file
├── package.json     # Dependencies and scripts
└── README.md        # This file
```

## API Endpoints

### Authentication
- `GET /` - Landing page
- `GET /login` - Login page
- `POST /login` - Process login
- `GET /logout` - Logout

### Admin Routes
- `GET /admin/students` - Manage students
- `GET /admin/staff` - Manage staff
- `GET /admin/classes` - Manage classes
- `GET /admin/sessions` - Manage sessions
- `GET /admin/promote` - Student promotion

### Teacher Routes
- `GET /teacher/results` - Result entry
- `POST /teacher/results/save` - Save results
- `GET /teacher/my-results` - View entered results

### Student Routes
- `GET /student/portal` - Student dashboard
- `GET /student/results` - View results
- `GET /student/results/download` - Download PDF

### Result Management
- `GET /result/approve` - Approve results
- `POST /result/approve/:id` - Approve single result
- `GET /result/published` - View published results

## Security Features

- **Password Hashing**: bcrypt for secure password storage
- **Session Management**: Secure session handling with MongoDB store
- **Role-based Access**: Middleware-enforced permission system
- **Input Validation**: Server-side validation for all forms
- **File Upload Security**: Restricted file types and size limits

## Responsive Design

The application is fully responsive and works seamlessly across:
- Desktop computers
- Tablets
- Mobile phones

## Customization

### School Branding
- Upload custom school logo
- Set school name, motto, and contact information
- Customize mission, vision, and about sections
- Add photo gallery

### Academic Structure
- Configure class levels (Primary, Junior Secondary, Senior Secondary)
- Set up subjects per class
- Define sections (A, B, C, etc.)
- Manage academic sessions and terms

## Deployment

### Production Considerations
1. **Environment Variables**: Ensure all production values are set
2. **Database**: Use MongoDB Atlas for cloud hosting
3. **File Storage**: Consider cloud storage for uploads
4. **SSL**: Enable HTTPS for secure communication
5. **Process Management**: Use PM2 or similar for process management

### Recommended Hosting
- **Backend**: Heroku, DigitalOcean, or AWS
- **Database**: MongoDB Atlas
- **File Storage**: AWS S3 or Cloudinary

## Support & Maintenance

### Regular Maintenance Tasks
- Database backups
- Log monitoring
- Security updates
- Performance optimization

### Troubleshooting
- Check MongoDB connection
- Verify environment variables
- Review application logs
- Test file upload permissions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contact

For support or inquiries:
- Email: info@educontrol.ng
- Phone: +234-XXX-XXX-XXXX

---

**EduControl NG** - Empowering Nigerian Education Through Technology