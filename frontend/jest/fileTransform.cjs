// Replaces asset imports with their file name (adapted from CRA's fileTransform).
const path = require('path');

module.exports = {
  process(_sourceText, filename) {
    return { code: `module.exports = ${JSON.stringify(path.basename(filename))};` };
  },
};
