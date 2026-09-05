# Chunk 00: Diagnostics System & Self-Test Suite

**Goal:** Establish the baseline self-test diagnostics script that validates environment readiness, directory structures, dependency installations, and connectivity.  
**Estimated Time:** 30 minutes  
**Dependencies:** None  
**Unlocks:** Chunk 01 (Scaffolding)  

---

## 1. Files to Create in this Chunk

### `scripts/diagnostics.js`
```javascript
const fs = require('fs');
const path = require('path');

console.log('====================================================');
console.log('      QUICK BITE PLATFORM - SYSTEM DIAGNOSTICS      ');
console.log('====================================================\n');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function check(title, fn) {
  totalChecks++;
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log('[PASS] ' + title);
      passedChecks++;
    } else {
      console.log('[FAIL] ' + title + ' -> ' + result);
      failedChecks++;
    }
  } catch (err) {
    console.log('[FAIL] ' + title + ' -> ' + err.message);
    failedChecks++;
  }
}

// 1. Node.js Environment Verification
check('Node.js version >= 18', () => {
  const version = process.versions.node.split('.')[0];
  if (parseInt(version, 10) < 18) {
    return 'Detected Node ' + process.version + '. Expected Node >= 18.';
  }
  return true;
});

// 2. Planning Documents Verification
const requiredDocs = [
  'PRD.md', 'TAD.md', 'APP_FLOW.md', 'MENTAL_MODEL.md', 'FEATURE_TICKETS.md',
  'README.md', 'IMPLEMENTATION_PLAN.md', 'CHANGELOG.md', 'COMMANDS.md',
  'AI_RECOVERY.md', 'TEAMMATE_GUIDE.md', 'SLIDES.html', 'FRONTEND_SPEC.md',
  'SECURITY_ACCESS.md', 'OBSERVABILITY.md', 'SEO_PERFORMANCE.md',
  'TESTING_STRATEGY.md', 'DATABASE_SPEC.md'
];

requiredDocs.forEach(doc => {
  check('Document exists: ' + doc, () => {
    if (!fs.existsSync(path.join(__dirname, '..', doc))) {
      return 'File missing. Run document generation before building.';
    }
    return true;
  });
});

// 3. Subdirectory Structure Verification
const requiredDirs = ['build', 'legal', 'design', 'security'];
requiredDirs.forEach(dir => {
  check('Directory exists: ' + dir, () => {
    if (!fs.existsSync(path.join(__dirname, '..', dir))) {
      return 'Directory missing.';
    }
    return true;
  });
});

console.log('\n====================================================');
console.log(`SUMMARY: ${passedChecks}/${totalChecks} Checks Passed (${failedChecks} Failed)`);
console.log('====================================================');

if (failedChecks > 0) {
  process.exit(1);
} else {
  console.log('\n[SUCCESS] Environment is 100% compliant. Ready for next chunk.');
  process.exit(0);
}
```

---

## 2. Verification Commands

```bash
# Run diagnostics check
node scripts/diagnostics.js
```

---

## 3. Rollback Instructions
If chunk fails: Delete `scripts/diagnostics.js`.
