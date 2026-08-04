const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateResultSummary, getClassLevel } = require('../utils/classLevel');

test('secondary grading uses CA and Exam totals with A1 scale', () => {
  const summary = calculateResultSummary(36, 54, 'JSS 1');
  assert.equal(summary.total, 90);
  assert.equal(summary.grade, 'A1');
  assert.equal(summary.remark, 'Excellent');
});

test('primary grading uses the primary scale and lower boundary rules', () => {
  const summary = calculateResultSummary(28, 48, 'Primary 4');
  assert.equal(summary.total, 76);
  assert.equal(summary.grade, 'B+');
  assert.equal(summary.remark, 'Very Good');
});

test('secondary F9 applies at 30 and below', () => {
  const summary = calculateResultSummary(15, 15, 'SSS 2');
  assert.equal(summary.total, 30);
  assert.equal(summary.grade, 'F9');
  assert.equal(summary.remark, 'Fail');
});

test('preparatory classes are treated as primary for grading', () => {
  assert.equal(getClassLevel('Preparatory'), 'primary');
});
