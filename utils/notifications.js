const Result = require('../models/Result');
const Announcement = require('../models/Announcement');

async function getAdminNotifications(lastLogin = null, userEmail = null, userRole = 'admin', lastRead = null, campus = null) {
  try {
    const now = new Date();
    const effectiveLastLogin = lastLogin || new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const effectiveLastRead = lastRead ? new Date(lastRead) : new Date(0);

    // Determine which result entries to show (staff see their own entries; admins see all)
    const resultFilter = {
      enteredAt: { $gt: effectiveLastRead }
    };
    if (campus) resultFilter.campus = campus;

    if (userRole && userRole !== 'admin' && userEmail) {
      resultFilter.enteredBy = userEmail;
    }

    const recentResults = await Result.find(resultFilter)
      .sort({ enteredAt: -1 })
      .limit(5)
      .select('studentName subject className enteredAt');

    const resultActivities = recentResults.map(result => ({
      message: `Result entered for ${result.studentName} - ${result.subject} (${result.className})`,
      time: result.enteredAt || now
    }));

    // Recent announcements relevant to staff
    const announcementFilter = {
      isActive: true,
      targetAudience: { $in: ['all', 'teachers'] }
    };
    if (campus) announcementFilter.campus = campus;
    const announcements = await Announcement.find(announcementFilter)
    .sort({ createdAt: -1 })
    .limit(3)
    .select('title createdAt');

    const announcementActivities = announcements.map(announcement => ({
      message: `Announcement: ${announcement.title}`,
      time: announcement.createdAt || now
    }));

    // Combine and sort by most recent first
    const activities = [...resultActivities, ...announcementActivities]
      .sort((a, b) => b.time - a.time)
      .slice(0, 5);

    return { lastLogin: effectiveLastLogin, activities };
  } catch (error) {
    console.error('Error getting admin notifications:', error);
    return { lastLogin: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), activities: [] };
  }
}

async function getStudentNotifications(studentID, lastRead = null, campus = null) {
  try {
    const now = new Date();
    const effectiveLastRead = lastRead ? new Date(lastRead) : new Date(0);

    // Recent announcements for students
    const announcementFilter = {
      isActive: true,
      targetAudience: { $in: ['all', 'students'] },
      createdAt: { $gt: effectiveLastRead }
    };
    if (campus) announcementFilter.campus = campus;
    const announcements = await Announcement.find(announcementFilter)
    .sort({ createdAt: -1 })
    .limit(3)
    .select('title createdAt');

    const announcementActivities = announcements.map(announcement => ({
      message: announcement.title,
      time: announcement.createdAt || now
    }));

    // Recent results for the logged-in student
    let resultActivities = [];
    if (studentID) {
      const resultFilter = {
        studentID,
        enteredAt: { $gt: effectiveLastRead }
      };
      if (campus) resultFilter.campus = campus;
      const recentResults = await Result.find(resultFilter)
        .sort({ enteredAt: -1 })
        .limit(5)
        .select('subject term session enteredAt');

      resultActivities = recentResults.map(result => ({
        message: `New result added for ${result.subject} (${result.term} - ${result.session})`,
        time: result.enteredAt || now
      }));
    }

    const activities = [...announcementActivities, ...resultActivities]
      .sort((a, b) => b.time - a.time)
      .slice(0, 5);

    return { activities };
  } catch (error) {
    console.error('Error getting student notifications:', error);
    return { activities: [] };
  }
}

module.exports = { getAdminNotifications, getStudentNotifications };