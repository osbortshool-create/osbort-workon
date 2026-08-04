const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Create email transporter
const createTransporter = () => {
    return nodemailer.createTransporter({
        service: 'gmail', // You can change this to your preferred email service
        auth: {
            user: process.env.EMAIL_USER || 'your-email@gmail.com',
            pass: process.env.EMAIL_PASS || 'your-app-password'
        }
    });
};

// Generate result PDF
const generateResultPDF = async (student, results, school, term, session) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const chunks = [];
            
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            
            // Add school header with logo
            if (school && school.logo && fs.existsSync(path.join(__dirname, '..', 'public', school.logo))) {
                doc.image(path.join(__dirname, '..', 'public', school.logo), 50, 50, { width: 60 });
            }
            
            // School information
            doc.fontSize(20).text(school ? school.name : 'School Name', 120, 50);
            doc.fontSize(12).text(school ? school.address : 'School Address', 120, 75);
            doc.fontSize(12).text(school ? school.phone : 'Phone Number', 120, 90);
            
            // Title
            doc.fontSize(18).text('STUDENT RESULT REPORT', 50, 130, { align: 'center' });
            doc.moveTo(50, 155).lineTo(550, 155).stroke();
            
            // Student information
            doc.fontSize(12);
            const startY = 180;
            doc.text(`Student Name: ${student.fullName}`, 50, startY);
            doc.text(`Student ID: ${student.studentID}`, 300, startY);
            doc.text(`Class: ${student.currentClass}`, 50, startY + 20);
            doc.text(`Session: ${session}`, 300, startY + 20);
            doc.text(`Term: ${term}`, 50, startY + 40);
            
            // Get student's position if available
            const firstResult = results[0];
            if (firstResult && firstResult.position) {
                doc.text(`Position: ${firstResult.position}`, 300, startY + 40);
            }
            
            // Results table
            const tableStartY = startY + 80;
            doc.fontSize(14).text('ACADEMIC RESULTS', 50, tableStartY, { align: 'center' });
            
            // Table headers
            const headerY = tableStartY + 30;
            doc.fontSize(10);
            doc.text('Subject', 50, headerY);
            doc.text('CA (40)', 150, headerY);
            doc.text('Exam (60)', 250, headerY);
            doc.text('Total (100)', 330, headerY);
            doc.text('Grade', 410, headerY);
            doc.text('Remark', 460, headerY);
            
            // Draw line under headers
            doc.moveTo(50, headerY + 15).lineTo(500, headerY + 15).stroke();
            
            let currentY = headerY + 25;
            let totalMarks = 0;
            
            // Add results
            results.forEach((result) => {
                doc.text(result.subject, 50, currentY);
                doc.text(result.ca1.toString(), 150, currentY);
                doc.text(result.exam.toString(), 250, currentY);
                doc.text(result.total.toString(), 330, currentY);
                doc.text(result.grade, 410, currentY);
                doc.text(result.remark, 460, currentY);
                
                totalMarks += result.total;
                currentY += 20;
            });
            
            // Summary
            const summaryY = currentY + 30;
            doc.fontSize(12);
            const averageScore = (totalMarks / results.length).toFixed(2);
            doc.text(`Total Subjects: ${results.length}`, 50, summaryY);
            doc.text(`Total Marks: ${totalMarks}`, 50, summaryY + 20);
            doc.text(`Average Score: ${averageScore}%`, 50, summaryY + 40);
            
            if (firstResult && firstResult.position) {
                doc.text(`Class Position: ${firstResult.position}`, 50, summaryY + 60);
            }
            
            // Footer
            doc.fontSize(10);
            doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 50, doc.page.height - 100);
            doc.text('This is a computer-generated document.', 50, doc.page.height - 80, { align: 'center' });
            
            // Finalize the PDF
            doc.end();
            
        } catch (error) {
            reject(error);
        }
    });
};

// Send result notification email
const sendResultNotification = async (student, results, school, term, session) => {
    try {
        if (!student.parentEmail) {
            console.log('No parent email found for student:', student.studentID);
            return { success: false, message: 'No parent email available' };
        }
        
        const transporter = createTransporter();
        
        // Generate PDF
        const pdfBuffer = await generateResultPDF(student, results, school, term, session);
        
        // Calculate summary
        const totalMarks = results.reduce((sum, result) => sum + result.total, 0);
        const averageScore = (totalMarks / results.length).toFixed(2);
        
        // Email content
        const mailOptions = {
            from: process.env.EMAIL_USER || 'noreply@school.edu.ng',
            to: student.parentEmail,
            subject: `${student.fullName}'s Academic Result - ${term}, ${session}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                        <h1 style="margin: 0; font-size: 24px;">Academic Result Notification</h1>
                        <p style="margin: 10px 0 0 0; opacity: 0.9;">${school ? school.name : 'School Name'}</p>
                    </div>
                    
                    <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                        <h2 style="color: #1e293b; margin-bottom: 20px;">Dear Parent/Guardian,</h2>
                        
                        <p style="color: #64748b; line-height: 1.6; margin-bottom: 20px;">
                            We are pleased to inform you that your child's academic result for <strong>${term}, ${session}</strong> has been published and is now available.
                        </p>
                        
                        <div style="background: #f1f5f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #38bdf8;">
                            <h3 style="color: #1e293b; margin: 0 0 15px 0;">Student Information</h3>
                            <p style="margin: 5px 0; color: #64748b;"><strong>Name:</strong> ${student.fullName}</p>
                            <p style="margin: 5px 0; color: #64748b;"><strong>Student ID:</strong> ${student.studentID}</p>
                            <p style="margin: 5px 0; color: #64748b;"><strong>Class:</strong> ${student.currentClass}</p>
                            <p style="margin: 5px 0; color: #64748b;"><strong>Term:</strong> ${term}</p>
                            <p style="margin: 5px 0; color: #64748b;"><strong>Session:</strong> ${session}</p>
                        </div>
                        
                        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
                            <h3 style="color: #1e293b; margin: 0 0 15px 0;">Performance Summary</h3>
                            <p style="margin: 5px 0; color: #64748b;"><strong>Total Subjects:</strong> ${results.length}</p>
                            <p style="margin: 5px 0; color: #64748b;"><strong>Total Marks:</strong> ${totalMarks}</p>
                            <p style="margin: 5px 0; color: #64748b;"><strong>Average Score:</strong> ${averageScore}%</p>
                            ${results[0] && results[0].position ? `<p style="margin: 5px 0; color: #64748b;"><strong>Class Position:</strong> ${results[0].position}</p>` : ''}
                        </div>
                        
                        <p style="color: #64748b; line-height: 1.6; margin: 20px 0;">
                            Please find the detailed result report attached to this email. You can also access the result through the student portal using your child's login credentials.
                        </p>
                        
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${process.env.SCHOOL_WEBSITE || '#'}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                                Access Student Portal
                            </a>
                        </div>
                        
                        <p style="color: #64748b; line-height: 1.6; margin-top: 20px;">
                            If you have any questions or concerns about your child's performance, please don't hesitate to contact us.
                        </p>
                        
                        <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 30px;">
                            <p style="color: #64748b; margin: 5px 0;"><strong>Contact Information:</strong></p>
                            <p style="color: #64748b; margin: 5px 0;">📞 ${school && school.phone ? school.phone : 'Phone Number'}</p>
                            <p style="color: #64748b; margin: 5px 0;">📧 ${school && school.email ? school.email : 'Email Address'}</p>
                            <p style="color: #64748b; margin: 5px 0;">📍 ${school && school.address ? school.address : 'School Address'}</p>
                        </div>
                        
                        <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; text-align: center;">
                            This is an automated message. Please do not reply to this email.
                        </p>
                    </div>
                </div>
            `,
            attachments: [
                {
                    filename: `${student.studentID}_Result_${term}_${session}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        };
        
        await transporter.sendMail(mailOptions);
        
        return { 
            success: true, 
            message: `Result notification sent to ${student.parentEmail}` 
        };
        
    } catch (error) {
        console.error('Error sending result notification:', error);
        return { 
            success: false, 
            message: `Failed to send email: ${error.message}` 
        };
    }
};

module.exports = {
    sendResultNotification,
    generateResultPDF
};