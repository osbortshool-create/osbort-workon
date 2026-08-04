/**
 * Utility: class level detection and grading logic.
 * Results use two marks only: CA and Exam.
 * CA is weighted 40% and Exam is weighted 60%, so the total is the sum of
 * the entered CA score and Exam score when these are entered out of 40 and 60.
 */

const PRIMARY_KEYWORDS = [
  'nursery', 'creche', 'kg', 'kindergarten', 'toddler',
  'basic', 'primary', 'pry', 'reception', 'grade', 'preparatory',
  'pre-nursery', 'prenursery', 'pre nursery', 'playgroup',
];

function getClassLevel(className) {
  if (!className) return 'secondary';
  const name = className.toLowerCase();
  if (PRIMARY_KEYWORDS.some(k => name.includes(k))) return 'primary';
  if (/^p\s*\d/.test(name)) return 'primary';
  return 'secondary';
}

function getGradeInfo(total, className) {
  const level = getClassLevel(className);
  if (level === 'primary') {
    if (total >= 90) return { grade: 'A+', remark: 'Excellent' };
    if (total >= 80) return { grade: 'A', remark: 'Excellent' };
    if (total >= 75) return { grade: 'B+', remark: 'Very Good' };
    if (total >= 70) return { grade: 'B', remark: 'Very Good' };
    if (total >= 65) return { grade: 'C+', remark: 'Good' };
    if (total >= 60) return { grade: 'C', remark: 'Fairly Good' };
    if (total >= 55) return { grade: 'D+', remark: 'Fair / Average' };
    if (total >= 50) return { grade: 'D', remark: 'Fair / Average' };
    if (total >= 40) return { grade: 'E', remark: 'Average' };
    return { grade: 'F', remark: 'Weak' };
  }

  if (total >= 75) return { grade: 'A1', remark: 'Excellent' };
  if (total >= 70) return { grade: 'B2', remark: 'Very Good' };
  if (total >= 65) return { grade: 'B3', remark: 'Good' };
  if (total >= 60) return { grade: 'C4', remark: 'Credit' };
  if (total >= 55) return { grade: 'C5', remark: 'Credit' };
  if (total >= 50) return { grade: 'C6', remark: 'Credit' };
  if (total >= 45) return { grade: 'D7', remark: 'Pass' };
  if (total >= 40) return { grade: 'E8', remark: 'Pass' };
  return { grade: 'F9', remark: 'Fail' };
}

function calculateResultSummary(caScore, examScore, className) {
  const ca = Number(caScore) || 0;
  const exam = Number(examScore) || 0;
  const total = ca + exam;
  const { grade, remark } = getGradeInfo(total, className);
  return { ca, exam, total, grade, remark };
}

function getScoreStructure(className) {
  const level = getClassLevel(className);
  return {
    ca1Label: 'CA',
    ca1Max: 40,
    ca2Label: '',
    ca2Max: 0,
    examMax: 60,
    hasCa2: false,
    level
  };
}

module.exports = { getClassLevel, getGradeInfo, calculateResultSummary, getScoreStructure };
