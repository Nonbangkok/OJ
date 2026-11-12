// Replaces CSS imports with an empty module (adapted from CRA's cssTransform).
module.exports = {
  process() {
    return { code: 'module.exports = {};' };
  },
};
